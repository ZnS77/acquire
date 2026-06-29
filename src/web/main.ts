// Browser hot-seat (pass-and-play) renderer for the Acquire MVP.
// It drives the SAME pure engine the server would run, and renders the
// per-player redacted view — proving rules + UI without any WeChat tooling.

import { AcquireGame, reduce } from '../engine/acquire';
import { COMPANY_IDS, ROW_LETTERS, stockPrice } from '../engine/data';
import type {
  AcquireState,
  CompanyId,
  PlayerAction,
  PlayerId,
} from '../engine/types';

let state: AcquireState;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function newGame(n: number): void {
  const ids: PlayerId[] = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const names = ids.map((_, i) => `玩家 ${i + 1}`);
  const seed = `seed-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  state = AcquireGame.createInitialState(ids, seed, names) as AcquireState;
  state = reduce(state, ids[0], { type: 'START' }).state;
  render();
}

/** Who the engine currently expects to act (hot-seat actor). */
function activeActor(s: AcquireState): PlayerId | null {
  switch (s.phase) {
    case 'placing':
    case 'buying':
      return s.players[s.currentPlayerIndex].id;
    case 'founding':
      return s.pendingFounding?.founder ?? null;
    case 'merging':
      if (s.pendingMerger?.awaitingResolve) return s.pendingMerger.triggerer;
      return s.pendingMerger?.disposalOrder[s.pendingMerger.disposalIndex] ?? null;
    default:
      return null;
  }
}

function dispatch(action: PlayerAction): void {
  const actor = activeActor(state);
  if (!actor) return;
  const result = reduce(state, actor, action);
  if (result.error) {
    flash(result.error);
    return;
  }
  state = result.state;
  render();
}

let flashTimer: number | undefined;
function flash(msg: string): void {
  const el = $('status');
  el.dataset.flash = msg;
  el.classList.add('flashing');
  render();
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    delete el.dataset.flash;
    el.classList.remove('flashing');
    render();
  }, 2200);
}

// ---------- rendering ----------

function nameOf(id: PlayerId): string {
  return state.players.find((p) => p.id === id)?.name ?? id;
}

function render(): void {
  renderStatus();
  renderBoard();
  renderHand();
  renderActions();
  renderMarket();
  renderPlayers();
  renderLog();
}

const PHASE_LABEL: Record<string, string> = {
  lobby: '等待开始',
  placing: '落子阶段',
  founding: '成立公司',
  merging: '并购处置',
  buying: '购买股票',
  ended: '游戏结束',
};

function renderStatus(): void {
  const el = $('status');
  const flashMsg = el.dataset.flash;
  if (state.phase === 'ended') {
    const winners = (state.winnerIds ?? []).map(nameOf).join('、');
    el.innerHTML = `<span class="winner">🏆 游戏结束 — 获胜：${winners}</span>`;
    return;
  }
  const actor = activeActor(state);
  let line = `<b>${PHASE_LABEL[state.phase]}</b> · 当前操作：<b>${actor ? nameOf(actor) : '—'}</b>`;
  if (state.phase === 'merging' && state.pendingMerger) {
    const pm = state.pendingMerger;
    if (pm.awaitingResolve) line += ` · 请选择保留方`;
    else if (pm.currentDefunct)
      line += ` · 处置 ${state.companies[pm.currentDefunct].name} 股票`;
  }
  if (flashMsg) line = `<span style="color:#ff9a8a">⚠ ${flashMsg}</span><br>` + line;
  el.innerHTML = line;
}

function renderBoard(): void {
  const board = $('board');
  board.innerHTML = '';
  // header row: blank corner + 1..12
  board.appendChild(headCell(''));
  for (let c = 1; c <= 12; c++) board.appendChild(headCell(String(c)));
  for (let r = 0; r < 9; r++) {
    board.appendChild(headCell(ROW_LETTERS[r]));
    for (let c = 0; c < 12; c++) {
      const cell = document.createElement('div');
      const v = state.board[r][c];
      const tileId = `${c + 1}${ROW_LETTERS[r]}`;
      cell.className = 'cell' + (v ? ` ${v}` : '');
      cell.textContent = v && v !== 'unincorp' ? state.companies[v as CompanyId].name[0] : tileId;
      cell.title = tileId;
      board.appendChild(cell);
    }
  }
}

function headCell(text: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'cell head';
  d.textContent = text;
  return d;
}

function renderHand(): void {
  const hand = $('hand');
  hand.innerHTML = '';
  const actor = activeActor(state);
  const view = AcquireGame.redact(state, actor ?? state.players[0].id) as {
    yourHand: string[];
  };
  const canPlace = state.phase === 'placing' && actor != null;
  const label = document.createElement('div');
  label.style.cssText = 'width:100%;color:var(--muted);font-size:12px';
  label.textContent = actor ? `${nameOf(actor)} 的手牌${canPlace ? '（点击打出）' : ''}` : '手牌';
  hand.appendChild(label);
  for (const tile of view.yourHand) {
    const btn = document.createElement('button');
    btn.className = 'tile';
    btn.textContent = tile;
    btn.disabled = !canPlace;
    btn.onclick = () => dispatch({ type: 'PLACE_TILE', tile });
    hand.appendChild(btn);
  }
}

function renderActions(): void {
  const box = $('actions');
  box.innerHTML = '';
  switch (state.phase) {
    case 'founding':
      return renderFounding(box);
    case 'merging':
      return renderMerging(box);
    case 'buying':
      return renderBuying(box);
    case 'placing':
      box.innerHTML = '<h3>从上方手牌中点击一块板打出。</h3>';
      return;
    case 'ended':
      box.innerHTML = '<h3>本局已结束，点右上角「新游戏」再来一局。</h3>';
      return;
    default:
      box.innerHTML = '';
  }
}

function renderFounding(box: HTMLElement): void {
  box.innerHTML = '<h3>选择新成立公司的名称（免费得 1 股）</h3>';
  const row = document.createElement('div');
  row.className = 'row';
  for (const id of COMPANY_IDS) {
    if (state.companies[id].active) continue;
    const b = document.createElement('button');
    b.className = 'primary';
    b.innerHTML = `<span class="swatch" style="background:var(--${id})"></span>${state.companies[id].name}`;
    b.onclick = () => dispatch({ type: 'CHOOSE_FOUNDED_COMPANY', company: id });
    row.appendChild(b);
  }
  box.appendChild(row);
}

function renderMerging(box: HTMLElement): void {
  const pm = state.pendingMerger!;
  if (pm.awaitingResolve) {
    box.innerHTML = '<h3>规模相同，请触发者选择保留方</h3>';
    const row = document.createElement('div');
    row.className = 'row';
    const maxSize = Math.max(...pm.involved.map((id) => state.companies[id].size));
    for (const id of pm.involved) {
      if (state.companies[id].size !== maxSize) continue;
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = `保留 ${state.companies[id].name}`;
      b.onclick = () => {
        const order = pm.involved.filter((x) => x !== id);
        dispatch({ type: 'RESOLVE_MERGER', survivor: id, order });
      };
      row.appendChild(b);
    }
    box.appendChild(row);
    return;
  }

  const defunct = pm.currentDefunct!;
  const actor = pm.disposalOrder[pm.disposalIndex];
  const held = state.players.find((p) => p.id === actor)!.shares[defunct];
  const survivor = pm.survivor!;
  const price = stockPrice(state.companies[defunct].tier, state.companies[defunct].size);
  box.innerHTML = `<h3>${nameOf(actor)} 处置 ${state.companies[defunct].name}（共 ${held} 股，市价 ${price}）→ 存续 ${state.companies[survivor].name}</h3>`;

  const mk = (lbl: string) => {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:inline-flex;gap:6px;align-items:center;margin-right:12px';
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '0';
    inp.value = '0';
    inp.dataset.kind = lbl;
    wrap.append(lbl, inp);
    return { wrap, inp };
  };
  const keep = mk('留');
  const sell = mk('卖');
  const trade = mk('换(2:1)');
  const row = document.createElement('div');
  row.className = 'row';
  row.append(keep.wrap, sell.wrap, trade.wrap);
  box.appendChild(row);

  const hint = document.createElement('div');
  hint.style.cssText = 'color:var(--muted);font-size:12px;margin-bottom:8px';
  hint.textContent = `三者合计须等于 ${held}；换股需为偶数，2 股换 1 股存续公司。`;
  box.appendChild(hint);

  const go = document.createElement('button');
  go.className = 'primary';
  go.textContent = '确认处置';
  go.onclick = () =>
    dispatch({
      type: 'MERGER_DISPOSE',
      keep: +keep.inp.value || 0,
      sell: +sell.inp.value || 0,
      trade: +trade.inp.value || 0,
    });
  box.appendChild(go);
}

function renderBuying(box: HTMLElement): void {
  const actor = state.players[state.currentPlayerIndex];
  box.innerHTML = `<h3>${actor.name} 购买股票（合计 ≤ 3 股，现金 ${actor.cash}）</h3>`;
  const inputs: Partial<Record<CompanyId, HTMLInputElement>> = {};
  const active = COMPANY_IDS.filter((id) => state.companies[id].active);
  if (active.length === 0) {
    box.innerHTML += '<div class="row">场上暂无开业公司，可直接跳过。</div>';
  }
  for (const id of active) {
    const co = state.companies[id];
    const price = stockPrice(co.tier, co.size);
    const row = document.createElement('div');
    row.className = 'row';
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '0';
    inp.max = String(Math.min(3, co.sharesLeft));
    inp.value = '0';
    inputs[id] = inp;
    row.innerHTML = `<span class="name"><span class="swatch" style="background:var(--${id})"></span>${co.name}</span>` +
      `<span class="chip">市价 ${price}</span><span class="chip">余 ${co.sharesLeft}</span>`;
    row.appendChild(inp);
    box.appendChild(row);
  }
  const btnRow = document.createElement('div');
  btnRow.className = 'row';
  const buy = document.createElement('button');
  buy.className = 'primary';
  buy.textContent = '确认购买 / 跳过';
  buy.onclick = () => {
    const order: Partial<Record<CompanyId, number>> = {};
    for (const id of active) order[id] = +(inputs[id]!.value) || 0;
    dispatch({ type: 'BUY_SHARES', buy: order });
  };
  btnRow.appendChild(buy);

  // Offer to declare the end when conditions are met.
  const activeIds = active;
  const canEnd =
    (activeIds.length > 0 && activeIds.every((id) => state.companies[id].safe)) ||
    activeIds.some((id) => state.companies[id].size >= 41);
  if (canEnd) {
    const end = document.createElement('button');
    end.textContent = '宣布游戏结束';
    end.onclick = () => dispatch({ type: 'DECLARE_END' });
    btnRow.appendChild(end);
  }
  box.appendChild(btnRow);
}

function renderMarket(): void {
  const el = $('market');
  let rows = '';
  for (const id of COMPANY_IDS) {
    const co = state.companies[id];
    const price = co.active ? stockPrice(co.tier, co.size) : '—';
    const safe = co.safe ? '<span class="safe-badge">安全</span>' : '';
    rows += `<tr style="opacity:${co.active ? 1 : 0.45}">
      <td><span class="swatch" style="background:var(--${id})"></span>${co.name}${safe}</td>
      <td>${co.active ? co.size : '-'}</td>
      <td>${price}</td>
      <td>${co.sharesLeft}</td></tr>`;
  }
  el.innerHTML = `<h2>股票市场</h2>
    <table><thead><tr><th>公司</th><th>规模</th><th>市价</th><th>余股</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function renderPlayers(): void {
  const el = $('players');
  const actor = activeActor(state);
  let rows = '';
  for (const p of state.players) {
    const holdings = COMPANY_IDS.filter((id) => p.shares[id] > 0)
      .map((id) => `${state.companies[id].name[0]}×${p.shares[id]}`)
      .join(' ') || '—';
    const cls = (p.id === actor ? 'actor-row ' : '');
    rows += `<tr class="${cls}"><td>${p.name}</td><td>${p.cash}</td><td>${p.handCount}</td><td>${holdings}</td></tr>`;
  }
  el.innerHTML = `<h2>玩家</h2>
    <table><thead><tr><th>玩家</th><th>现金</th><th>手牌</th><th>持股</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function renderLog(): void {
  const el = $('log');
  const items = state.log.slice(-40).map((l) => `<li>${l}</li>`).join('');
  el.innerHTML = `<h2>日志</h2><ul>${items}</ul>`;
  const ul = el.querySelector('ul');
  if (ul) ul.scrollTop = ul.scrollHeight;
}

// ---------- wire up ----------

$('newGame').addEventListener('click', () => {
  const n = parseInt(($('numPlayers') as HTMLSelectElement).value, 10);
  newGame(n);
});

newGame(3);
