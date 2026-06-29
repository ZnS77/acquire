// Shared renderer: draws a per-player redacted PlayerView and emits actions.
// Used by BOTH the hot-seat driver (local engine) and the networked client
// (authoritative server over WebSocket) — proving the client only ever needs
// the redacted view + an action channel.

import { COMPANY_IDS, ROW_LETTERS, stockPrice } from '../engine/data';
import type { CompanyId, PlayerAction, PlayerId, PlayerView } from '../engine/types';

export type Dispatch = (action: PlayerAction) => void;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const PHASE_LABEL: Record<string, string> = {
  lobby: '等待开始',
  placing: '落子阶段',
  founding: '成立公司',
  merging: '并购处置',
  buying: '购买股票',
  ended: '游戏结束',
};

/** Who the engine currently expects to act — derivable from public state only. */
export function activeActor(v: PlayerView): PlayerId | null {
  switch (v.phase) {
    case 'placing':
    case 'buying':
      return v.players[v.currentPlayerIndex].id;
    case 'founding':
      return v.pendingFounding?.founder ?? null;
    case 'merging':
      if (v.pendingMerger?.awaitingResolve) return v.pendingMerger.triggerer;
      return v.pendingMerger?.disposalOrder[v.pendingMerger.disposalIndex] ?? null;
    default:
      return null;
  }
}

function nameOf(v: PlayerView, id: PlayerId): string {
  return v.players.find((p) => p.id === id)?.name ?? id;
}

export function renderApp(
  v: PlayerView,
  me: PlayerId,
  dispatch: Dispatch,
  error?: string,
): void {
  const myTurn = activeActor(v) === me;
  renderStatus(v, me, error);
  renderBoard(v);
  renderHand(v, me, myTurn, dispatch);
  renderActions(v, me, myTurn, dispatch);
  renderMarket(v);
  renderPlayers(v, me);
  renderLog(v);
}

function renderStatus(v: PlayerView, me: PlayerId, error?: string): void {
  const el = $('status');
  if (v.phase === 'ended') {
    const winners = (v.winnerIds ?? []).map((id) => nameOf(v, id)).join('、');
    el.innerHTML = `<span class="winner">🏆 游戏结束 — 获胜：${winners}</span>`;
    return;
  }
  const actor = activeActor(v);
  const meName = nameOf(v, me);
  let line = `你是 <b>${meName}</b> · <b>${PHASE_LABEL[v.phase]}</b> · 当前操作：<b>${actor ? nameOf(v, actor) : '—'}</b>`;
  line += actor === me ? ` · <span style="color:#7fe08a">轮到你了</span>` : ` · <span style="color:var(--muted)">等待其他玩家…</span>`;
  if (v.phase === 'merging' && v.pendingMerger) {
    const pm = v.pendingMerger;
    if (pm.awaitingResolve) line += ` · 请选择保留方`;
    else if (pm.currentDefunct) line += ` · 处置 ${v.companies[pm.currentDefunct].name} 股票`;
  }
  if (error) line = `<span style="color:#ff9a8a">⚠ ${error}</span><br>` + line;
  el.innerHTML = line;
}

function renderBoard(v: PlayerView): void {
  const board = $('board');
  board.innerHTML = '';
  board.appendChild(headCell(''));
  for (let c = 1; c <= 12; c++) board.appendChild(headCell(String(c)));
  for (let r = 0; r < 9; r++) {
    board.appendChild(headCell(ROW_LETTERS[r]));
    for (let c = 0; c < 12; c++) {
      const cell = document.createElement('div');
      const val = v.board[r][c];
      const tileId = `${c + 1}${ROW_LETTERS[r]}`;
      cell.className = 'cell' + (val ? ` ${val}` : '');
      cell.textContent =
        val && val !== 'unincorp' ? v.companies[val as CompanyId].name[0] : tileId;
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

function renderHand(v: PlayerView, me: PlayerId, myTurn: boolean, dispatch: Dispatch): void {
  const hand = $('hand');
  hand.innerHTML = '';
  const canPlace = v.phase === 'placing' && myTurn;
  const label = document.createElement('div');
  label.style.cssText = 'width:100%;color:var(--muted);font-size:12px';
  label.textContent = `${nameOf(v, me)} 的手牌${canPlace ? '（点击打出）' : ''}`;
  hand.appendChild(label);
  for (const tile of v.yourHand) {
    const btn = document.createElement('button');
    btn.className = 'tile';
    btn.textContent = tile;
    btn.disabled = !canPlace;
    btn.onclick = () => dispatch({ type: 'PLACE_TILE', tile });
    hand.appendChild(btn);
  }
}

function renderActions(v: PlayerView, me: PlayerId, myTurn: boolean, dispatch: Dispatch): void {
  const box = $('actions');
  box.innerHTML = '';
  if (!myTurn) {
    const actor = activeActor(v);
    box.innerHTML = `<h3>当前由 ${actor ? nameOf(v, actor) : '—'} 操作，请等待。</h3>`;
    return;
  }
  switch (v.phase) {
    case 'founding':
      return renderFounding(v, box, dispatch);
    case 'merging':
      return renderMerging(v, box, dispatch);
    case 'buying':
      return renderBuying(v, me, box, dispatch);
    case 'placing':
      box.innerHTML = '<h3>从上方手牌中点击一块板打出。</h3>';
      return;
    default:
      box.innerHTML = '';
  }
}

function renderFounding(v: PlayerView, box: HTMLElement, dispatch: Dispatch): void {
  box.innerHTML = '<h3>选择新成立公司的名称（免费得 1 股）</h3>';
  const row = document.createElement('div');
  row.className = 'row';
  for (const id of COMPANY_IDS) {
    if (v.companies[id].active) continue;
    const b = document.createElement('button');
    b.className = 'primary';
    b.innerHTML = `<span class="swatch" style="background:var(--${id})"></span>${v.companies[id].name}`;
    b.onclick = () => dispatch({ type: 'CHOOSE_FOUNDED_COMPANY', company: id });
    row.appendChild(b);
  }
  box.appendChild(row);
}

function renderMerging(v: PlayerView, box: HTMLElement, dispatch: Dispatch): void {
  const pm = v.pendingMerger!;
  if (pm.awaitingResolve) {
    box.innerHTML = '<h3>规模相同，请触发者选择保留方</h3>';
    const row = document.createElement('div');
    row.className = 'row';
    const maxSize = Math.max(...pm.involved.map((id) => v.companies[id].size));
    for (const id of pm.involved) {
      if (v.companies[id].size !== maxSize) continue;
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = `保留 ${v.companies[id].name}`;
      b.onclick = () =>
        dispatch({ type: 'RESOLVE_MERGER', survivor: id, order: pm.involved.filter((x) => x !== id) });
      row.appendChild(b);
    }
    box.appendChild(row);
    return;
  }
  const defunct = pm.currentDefunct!;
  const actor = pm.disposalOrder[pm.disposalIndex];
  const held = v.players.find((p) => p.id === actor)!.shares[defunct];
  const survivor = pm.survivor!;
  const price = stockPrice(v.companies[defunct].tier, v.companies[defunct].size);
  box.innerHTML = `<h3>处置 ${v.companies[defunct].name}（共 ${held} 股，市价 ${price}）→ 存续 ${v.companies[survivor].name}</h3>`;

  const mk = (lbl: string) => {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:inline-flex;gap:6px;align-items:center;margin-right:12px';
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '0';
    inp.value = '0';
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

function renderBuying(v: PlayerView, me: PlayerId, box: HTMLElement, dispatch: Dispatch): void {
  const meP = v.players.find((p) => p.id === me)!;
  box.innerHTML = `<h3>购买股票（合计 ≤ 3 股，现金 ${meP.cash}）</h3>`;
  const inputs: Partial<Record<CompanyId, HTMLInputElement>> = {};
  const active = COMPANY_IDS.filter((id) => v.companies[id].active);
  if (active.length === 0) box.innerHTML += '<div class="row">场上暂无开业公司，可直接跳过。</div>';
  for (const id of active) {
    const co = v.companies[id];
    const price = stockPrice(co.tier, co.size);
    const row = document.createElement('div');
    row.className = 'row';
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '0';
    inp.max = String(Math.min(3, co.sharesLeft));
    inp.value = '0';
    inputs[id] = inp;
    row.innerHTML =
      `<span class="name"><span class="swatch" style="background:var(--${id})"></span>${co.name}</span>` +
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
    for (const id of active) order[id] = +inputs[id]!.value || 0;
    dispatch({ type: 'BUY_SHARES', buy: order });
  };
  btnRow.appendChild(buy);

  const canEnd =
    (active.length > 0 && active.every((id) => v.companies[id].safe)) ||
    active.some((id) => v.companies[id].size >= 41);
  if (canEnd) {
    const end = document.createElement('button');
    end.textContent = '宣布游戏结束';
    end.onclick = () => dispatch({ type: 'DECLARE_END' });
    btnRow.appendChild(end);
  }
  box.appendChild(btnRow);
}

function renderMarket(v: PlayerView): void {
  const el = $('market');
  let rows = '';
  for (const id of COMPANY_IDS) {
    const co = v.companies[id];
    const price = co.active ? stockPrice(co.tier, co.size) : '—';
    const safe = co.safe ? '<span class="safe-badge">安全</span>' : '';
    rows += `<tr style="opacity:${co.active ? 1 : 0.45}">
      <td><span class="swatch" style="background:var(--${id})"></span>${co.name}${safe}</td>
      <td>${co.active ? co.size : '-'}</td><td>${price}</td><td>${co.sharesLeft}</td></tr>`;
  }
  el.innerHTML = `<h2>股票市场</h2>
    <table><thead><tr><th>公司</th><th>规模</th><th>市价</th><th>余股</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function renderPlayers(v: PlayerView, me: PlayerId): void {
  const el = $('players');
  const actor = activeActor(v);
  let rows = '';
  for (const p of v.players) {
    const holdings =
      COMPANY_IDS.filter((id) => p.shares[id] > 0)
        .map((id) => `${v.companies[id].name[0]}×${p.shares[id]}`)
        .join(' ') || '—';
    const cls = (p.id === actor ? 'actor-row ' : '') + (p.id === me ? 'you-row' : '');
    const tag = p.id === me ? ' (你)' : '';
    rows += `<tr class="${cls}"><td>${p.name}${tag}</td><td>${p.cash}</td><td>${p.handCount}</td><td>${holdings}</td></tr>`;
  }
  el.innerHTML = `<h2>玩家</h2>
    <table><thead><tr><th>玩家</th><th>现金</th><th>手牌</th><th>持股</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function renderLog(v: PlayerView): void {
  const el = $('log');
  const items = v.log.slice(-40).map((l) => `<li>${l}</li>`).join('');
  el.innerHTML = `<h2>日志</h2><ul>${items}</ul>`;
  const ul = el.querySelector('ul');
  if (ul) ul.scrollTop = ul.scrollHeight;
}
