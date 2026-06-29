// 并购风云 (Acquire) — pure rule engine: (state, action) => newState.
// Server-authoritative, deterministic, zero transport dependencies.

import {
  COLS,
  COMPANY_IDS,
  COMPANY_META,
  END_SIZE,
  HAND_SIZE,
  MAX_BUY_PER_TURN,
  ROWS,
  SAFE_SIZE,
  SHARES_PER_COMPANY,
  STARTING_CASH,
  allTiles,
  makeTile,
  parseTile,
  stockPrice,
} from './data';
import { makeRng, shuffle } from './rng';
import type {
  AcquireState,
  Cell,
  Company,
  CompanyId,
  GameDefinition,
  PlayerAction,
  PlayerId,
  PlayerPublic,
  PlayerView,
  ReduceResult,
  TileId,
} from './types';

// ---------- small helpers ----------

function clone(state: AcquireState): AcquireState {
  // JSON clone (state is plain JSON data). Portable across Node runtimes,
  // including the older Node the WeChat cloud function may run on.
  return JSON.parse(JSON.stringify(state)) as AcquireState;
}

function emptyShares(): Record<CompanyId, number> {
  const s = {} as Record<CompanyId, number>;
  for (const id of COMPANY_IDS) s[id] = 0;
  return s;
}

function err(state: AcquireState, message: string): ReduceResult {
  return { state, error: message };
}

function cellAt(state: AcquireState, tile: TileId): Cell {
  const { col, row } = parseTile(tile);
  return state.board[row][col];
}

function setCell(state: AcquireState, tile: TileId, value: Cell): void {
  const { col, row } = parseTile(tile);
  state.board[row][col] = value;
}

function neighbors(tile: TileId): TileId[] {
  const { col, row } = parseTile(tile);
  const out: TileId[] = [];
  if (col > 0) out.push(makeTile(col - 1, row));
  if (col < COLS - 1) out.push(makeTile(col + 1, row));
  if (row > 0) out.push(makeTile(col, row - 1));
  if (row < ROWS - 1) out.push(makeTile(col, row + 1));
  return out;
}

/** Flood-fill all occupied (non-null) cells connected to `start`, inclusive. */
function connectedTiles(state: AcquireState, start: TileId): TileId[] {
  const seen = new Set<TileId>([start]);
  const stack = [start];
  while (stack.length) {
    const t = stack.pop()!;
    for (const n of neighbors(t)) {
      if (!seen.has(n) && cellAt(state, n) !== null) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return [...seen];
}

function companySize(state: AcquireState, id: CompanyId): number {
  let n = 0;
  for (const row of state.board) for (const c of row) if (c === id) n++;
  return n;
}

function refreshCompany(state: AcquireState, id: CompanyId): void {
  const co = state.companies[id];
  co.size = companySize(state, id);
  co.active = co.size > 0;
  co.safe = co.size >= SAFE_SIZE;
}

function currentPlayer(state: AcquireState): PlayerPublic {
  return state.players[state.currentPlayerIndex];
}

function playerById(state: AcquireState, id: PlayerId): PlayerPublic | undefined {
  return state.players.find((p) => p.id === id);
}

function roundTo100(x: number): number {
  return Math.round(x / 100) * 100;
}

function log(state: AcquireState, line: string): void {
  state.log.push(line);
}

// ---------- setup ----------

function createInitialState(
  players: PlayerId[],
  seed: string,
  names?: string[],
): AcquireState {
  const board: Cell[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => null),
  );

  const companies = {} as Record<CompanyId, Company>;
  for (const meta of COMPANY_META) {
    companies[meta.id] = {
      id: meta.id,
      name: meta.name,
      tier: meta.tier,
      size: 0,
      safe: false,
      active: false,
      sharesLeft: SHARES_PER_COMPANY,
    };
  }

  const rng = makeRng(seed);
  let bag = shuffle(allTiles(), rng);

  const hands: Record<PlayerId, TileId[]> = {};
  const pubPlayers: PlayerPublic[] = players.map((id, i) => ({
    id,
    name: names?.[i] ?? id,
    cash: STARTING_CASH,
    shares: emptyShares(),
    handCount: 0,
    connected: true,
  }));

  for (const p of pubPlayers) {
    const hand = bag.slice(0, HAND_SIZE);
    bag = bag.slice(HAND_SIZE);
    hands[p.id] = hand;
    p.handCount = hand.length;
  }

  return {
    phase: 'lobby',
    board,
    companies,
    players: pubPlayers,
    hands,
    bag,
    seed,
    currentPlayerIndex: 0,
    log: ['房间已创建，等待开始。'],
  };
}

// ---------- placement ----------

function availableCompanies(state: AcquireState): CompanyId[] {
  return COMPANY_IDS.filter((id) => !state.companies[id].active);
}

function activeCompanies(state: AcquireState): CompanyId[] {
  return COMPANY_IDS.filter((id) => state.companies[id].active);
}

/** Draw one tile from the bag into a player's hand (if any remain). */
function drawTile(state: AcquireState, pid: PlayerId): void {
  if (state.bag.length === 0) return;
  const t = state.bag.shift()!;
  state.hands[pid].push(t);
  playerById(state, pid)!.handCount = state.hands[pid].length;
}

/** End of turn: draw a replacement tile, then PAUSE so the player can see it. */
function drawAndPause(state: AcquireState): void {
  const pid = currentPlayer(state).id;
  const before = state.hands[pid].length;
  drawTile(state, pid);
  const hand = state.hands[pid];
  const tile = hand.length > before ? hand[hand.length - 1] : null;
  state.pendingDraw = { player: pid, tile };
  state.phase = 'confirm';
  log(state, tile ? `${nameOf(state, pid)} 补抽了 1 块板。` : `牌库已空，无法补抽。`);
}

/** Player confirmed their drawn tile → resolve endgame or pass to next player. */
function endTurn(state: AcquireState, pid: PlayerId): ReduceResult {
  if (state.phase !== 'confirm') return err(state, '当前不是回合确认阶段。');
  if (currentPlayer(state).id !== pid) return err(state, '还没轮到你。');
  state.pendingDraw = undefined;
  if (isGameOver(state)) {
    finalizeGame(state);
    return { state };
  }
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  state.phase = 'placing';
  return { state };
}

function handlePlacement(state: AcquireState, pid: PlayerId, tile: TileId): ReduceResult {
  // Provisionally mark the cell so adjacency reasoning includes it.
  setCell(state, tile, 'unincorp');

  const adjCompanies = new Set<CompanyId>();
  let adjUnincorp = false;
  for (const n of neighbors(tile)) {
    const c = cellAt(state, n);
    if (c && c !== 'unincorp') adjCompanies.add(c);
    else if (c === 'unincorp') adjUnincorp = true;
  }
  const involved = [...adjCompanies];

  if (involved.length >= 2) {
    return beginMerger(state, pid, tile);
  }

  if (involved.length === 1) {
    // Grow the single adjacent company over the whole connected blob.
    const id = involved[0];
    for (const t of connectedTiles(state, tile)) setCell(state, t, id);
    refreshCompany(state, id);
    log(state, `${nameOf(state, pid)} 扩张了 ${state.companies[id].name}（规模 ${state.companies[id].size}）。`);
    state.phase = 'buying';
    return { state };
  }

  // No adjacent company. A blob of >=2 unincorporated tiles founds a company.
  if (adjUnincorp) {
    const blob = connectedTiles(state, tile);
    if (blob.length >= 2) {
      if (availableCompanies(state).length === 0) {
        // All 7 companies are on the board: the group stays unincorporated.
        log(state, `${nameOf(state, pid)} 放置了 ${tile}，但已无可成立公司，板群保持未注册。`);
        state.phase = 'buying';
        return { state };
      }
      state.phase = 'founding';
      state.pendingFounding = { componentTiles: blob, founder: pid };
      log(state, `${nameOf(state, pid)} 放置了 ${tile}，可成立新公司。`);
      return { state };
    }
  }

  // Lone tile.
  log(state, `${nameOf(state, pid)} 放置了 ${tile}。`);
  state.phase = 'buying';
  return { state };
}

function nameOf(state: AcquireState, pid: PlayerId): string {
  return playerById(state, pid)?.name ?? pid;
}

function chooseFoundedCompany(
  state: AcquireState,
  pid: PlayerId,
  company: CompanyId,
): ReduceResult {
  if (state.phase !== 'founding' || !state.pendingFounding) {
    return err(state, '当前不是成立公司阶段。');
  }
  if (state.pendingFounding.founder !== pid) {
    return err(state, '不是你成立公司。');
  }
  const co = state.companies[company];
  if (co.active) return err(state, '该公司已在场上。');

  for (const t of state.pendingFounding.componentTiles) setCell(state, t, company);
  refreshCompany(state, company);
  // Founder gets one free share if any remain.
  if (co.sharesLeft > 0) {
    co.sharesLeft -= 1;
    playerById(state, pid)!.shares[company] += 1;
  }
  log(state, `${nameOf(state, pid)} 成立了 ${co.name}，获得 1 股创始股。`);
  state.pendingFounding = undefined;
  state.phase = 'buying';
  return { state };
}

// ---------- merger ----------

/** Is placing `tile` illegal because it would merge two safe companies? */
export function wouldMergeSafes(state: AcquireState, tile: TileId): boolean {
  const seen = new Set<TileId>([tile]);
  const stack = [tile];
  const safes = new Set<CompanyId>();
  while (stack.length) {
    const t = stack.pop()!;
    for (const n of neighbors(t)) {
      const c = cellAt(state, n);
      if (c && c !== 'unincorp' && state.companies[c].safe) safes.add(c);
      if (!seen.has(n) && cellAt(state, n) !== null) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return safes.size >= 2;
}

function beginMerger(state: AcquireState, pid: PlayerId, tile: TileId): ReduceResult {
  const component = connectedTiles(state, tile);
  const involved = [
    ...new Set(
      component
        .map((t) => cellAt(state, t))
        .filter((c): c is CompanyId => !!c && c !== 'unincorp'),
    ),
  ];

  const sizes = involved.map((id) => ({ id, size: state.companies[id].size }));
  const maxSize = Math.max(...sizes.map((s) => s.size));
  const top = sizes.filter((s) => s.size === maxSize).map((s) => s.id);
  const safeInvolved = involved.filter((id) => state.companies[id].safe);

  // House rule: when 2+ SAFE companies meet, the placing player chooses which
  // one survives (in official Acquire such a tile is simply unplayable).
  // Otherwise the largest survives; an exact size tie also lets the placer pick.
  let awaitingResolve: boolean;
  let candidates: CompanyId[];
  let survivor: CompanyId | undefined;
  if (safeInvolved.length >= 2) {
    awaitingResolve = true;
    candidates = involved.slice();
    survivor = undefined;
  } else if (top.length > 1) {
    awaitingResolve = true;
    candidates = top;
    survivor = undefined;
  } else {
    awaitingResolve = false;
    candidates = [top[0]];
    survivor = top[0];
  }

  state.phase = 'merging';
  state.pendingMerger = {
    tile,
    triggerer: pid,
    componentTiles: component,
    involved,
    awaitingResolve,
    candidates,
    survivor,
    defunctQueue: [],
    disposalOrder: [],
    disposalIndex: 0,
  };

  if (awaitingResolve) {
    const why = safeInvolved.length >= 2 ? '两家安全公司相遇' : '规模相同';
    log(state, `${nameOf(state, pid)} 触发并购，${why}，由放置者选择保留方。`);
    return { state };
  }
  finalizeMergerSurvivor(state, survivor!, involved);
  return { state };
}

function resolveMerger(
  state: AcquireState,
  pid: PlayerId,
  survivor: CompanyId,
  order: CompanyId[],
): ReduceResult {
  const pm = state.pendingMerger;
  if (!pm || !pm.awaitingResolve) return err(state, '当前无需选择保留方。');
  if (pm.triggerer !== pid) return err(state, '只有触发者可选择保留方。');
  if (!pm.candidates.includes(survivor)) return err(state, '保留方必须是可选公司之一。');
  const defunct = pm.involved.filter((id) => id !== survivor);
  // `order` (optional) lets the triggerer set processing order of the defunct.
  const ordered =
    order.length === defunct.length && order.every((id) => defunct.includes(id))
      ? order
      : [...defunct].sort((a, b) => state.companies[b].size - state.companies[a].size);
  pm.awaitingResolve = false;
  finalizeMergerSurvivor(state, survivor, [survivor, ...ordered]);
  return { state };
}

function finalizeMergerSurvivor(
  state: AcquireState,
  survivor: CompanyId,
  involved: CompanyId[],
): void {
  const pm = state.pendingMerger!;
  pm.survivor = survivor;
  pm.defunctQueue = involved
    .filter((id) => id !== survivor)
    .sort((a, b) => state.companies[b].size - state.companies[a].size);
  log(state, `保留方：${state.companies[survivor].name}。`);
  beginNextDefunct(state);
}

/** Pay bonuses for the next defunct company and set up its disposal queue. */
function beginNextDefunct(state: AcquireState): void {
  const pm = state.pendingMerger!;
  if (pm.defunctQueue.length === 0) {
    completeMerger(state);
    return;
  }
  const defunct = pm.defunctQueue[0];
  pm.currentDefunct = defunct;
  payMergerBonuses(state, defunct);

  // Disposal order: from triggerer clockwise, only those holding defunct shares.
  const n = state.players.length;
  const startIdx = state.players.findIndex((p) => p.id === pm.triggerer);
  const order: PlayerId[] = [];
  for (let k = 0; k < n; k++) {
    const p = state.players[(startIdx + k) % n];
    if (p.shares[defunct] > 0) order.push(p.id);
  }
  pm.disposalOrder = order;
  pm.disposalIndex = 0;

  if (order.length === 0) {
    // Nobody holds shares — straight to the next defunct.
    pm.defunctQueue.shift();
    beginNextDefunct(state);
  }
}

function payMergerBonuses(state: AcquireState, defunct: CompanyId): void {
  const co = state.companies[defunct];
  const price = stockPrice(co.tier, co.size);
  const majority = price * 10;
  const minority = price * 5;

  const holders = state.players
    .filter((p) => p.shares[defunct] > 0)
    .map((p) => ({ id: p.id, n: p.shares[defunct] }))
    .sort((a, b) => b.n - a.n);

  if (holders.length === 0) return;

  if (holders.length === 1) {
    // Sole shareholder collects both bonuses.
    pay(state, holders[0].id, majority + minority);
    return;
  }

  const topN = holders[0].n;
  const majorityHolders = holders.filter((h) => h.n === topN);
  if (majorityHolders.length > 1) {
    const each = roundTo100((majority + minority) / majorityHolders.length);
    for (const h of majorityHolders) pay(state, h.id, each);
    return;
  }
  // Single majority holder.
  pay(state, majorityHolders[0].id, majority);
  const rest = holders.slice(1);
  const secondN = rest[0].n;
  const minorityHolders = rest.filter((h) => h.n === secondN);
  const each = roundTo100(minority / minorityHolders.length);
  for (const h of minorityHolders) pay(state, h.id, each);
}

function pay(state: AcquireState, pid: PlayerId, amount: number): void {
  playerById(state, pid)!.cash += amount;
  log(state, `${nameOf(state, pid)} 获得分红 ${amount} 元。`);
}

function mergerDispose(
  state: AcquireState,
  pid: PlayerId,
  keep: number,
  sell: number,
  trade: number,
): ReduceResult {
  const pm = state.pendingMerger;
  if (!pm || pm.awaitingResolve || !pm.currentDefunct) {
    return err(state, '当前不是处置阶段。');
  }
  const expected = pm.disposalOrder[pm.disposalIndex];
  if (expected !== pid) return err(state, '还没轮到你处置股票。');

  const defunct = pm.currentDefunct;
  const survivor = pm.survivor!;
  const player = playerById(state, pid)!;
  const held = player.shares[defunct];

  if (keep < 0 || sell < 0 || trade < 0) return err(state, '处置数量不能为负。');
  if (keep + sell + trade !== held) return err(state, `处置数量必须合计为 ${held} 股。`);
  if (trade % 2 !== 0) return err(state, '换股必须以 2 股为单位（2:1）。');
  const survivorOut = trade / 2;
  if (survivorOut > state.companies[survivor].sharesLeft) {
    return err(state, '存续公司股票发行不足，无法换股。');
  }

  const co = state.companies[defunct];
  const price = stockPrice(co.tier, co.size);

  // Sell → bank pays market price, shares return to the bank.
  if (sell > 0) {
    player.cash += sell * price;
    co.sharesLeft += sell;
  }
  // Trade 2:1 → defunct shares back to bank, survivor shares out.
  if (trade > 0) {
    co.sharesLeft += trade;
    state.companies[survivor].sharesLeft -= survivorOut;
    player.shares[survivor] += survivorOut;
  }
  // Keep → shares stay with the player (a defunct company may be re-founded).
  player.shares[defunct] = keep;

  log(
    state,
    `${nameOf(state, pid)} 处置 ${co.name}：留 ${keep} / 卖 ${sell} / 换 ${survivorOut}。`,
  );

  pm.disposalIndex += 1;
  if (pm.disposalIndex >= pm.disposalOrder.length) {
    pm.defunctQueue.shift();
    beginNextDefunct(state);
  }
  return { state };
}

function completeMerger(state: AcquireState): void {
  const pm = state.pendingMerger!;
  const survivor = pm.survivor!;
  // Survivor takes over the entire connected blob.
  for (const t of pm.componentTiles) setCell(state, t, survivor);
  refreshCompany(state, survivor);
  for (const id of pm.involved) if (id !== survivor) refreshCompany(state, id);
  log(state, `并购完成，${state.companies[survivor].name} 规模 ${state.companies[survivor].size}。`);
  state.pendingMerger = undefined;
  state.phase = 'buying';
}

// ---------- buying ----------

function buyShares(
  state: AcquireState,
  pid: PlayerId,
  buy: Partial<Record<CompanyId, number>>,
): ReduceResult {
  const player = playerById(state, pid)!;
  let total = 0;
  let cost = 0;
  for (const id of COMPANY_IDS) {
    const want = buy[id] ?? 0;
    if (want < 0) return err(state, '购买数量不能为负。');
    if (want === 0) continue;
    const co = state.companies[id];
    if (!co.active) return err(state, `${co.name} 未开业，不能购买。`);
    if (want > co.sharesLeft) return err(state, `${co.name} 发行余量不足。`);
    total += want;
    cost += want * stockPrice(co.tier, co.size);
  }
  if (total > MAX_BUY_PER_TURN) return err(state, `单回合最多购买 ${MAX_BUY_PER_TURN} 股。`);
  if (cost > player.cash) return err(state, '现金不足。');

  for (const id of COMPANY_IDS) {
    const want = buy[id] ?? 0;
    if (want > 0) {
      state.companies[id].sharesLeft -= want;
      player.shares[id] += want;
    }
  }
  player.cash -= cost;
  if (total > 0) log(state, `${nameOf(state, pid)} 购买了 ${total} 股，花费 ${cost} 元。`);
  else log(state, `${nameOf(state, pid)} 跳过购买。`);

  drawAndPause(state);
  return { state };
}

// ---------- endgame ----------

export function isGameOver(state: AcquireState): boolean {
  if (state.phase === 'ended') return true;
  const active = activeCompanies(state);
  if (active.some((id) => state.companies[id].size >= END_SIZE)) return true;
  if (active.length > 0 && active.every((id) => state.companies[id].safe)) return true;
  if (state.bag.length === 0) {
    // No tiles left to draw and current player can't continue meaningfully.
    return true;
  }
  return false;
}

function declareEnd(state: AcquireState, pid: PlayerId): ReduceResult {
  if (currentPlayer(state).id !== pid) return err(state, '还没轮到你。');
  const active = activeCompanies(state);
  const canEnd =
    (active.length > 0 && active.every((id) => state.companies[id].safe)) ||
    active.some((id) => state.companies[id].size >= END_SIZE);
  if (!canEnd) return err(state, '当前不满足终局条件，不能宣布结束。');
  finalizeGame(state);
  return { state };
}

/** Settle all bonuses and stock at end of game, then rank by cash. */
function finalizeGame(state: AcquireState): void {
  for (const id of activeCompanies(state)) {
    payMergerBonuses(state, id);
    const co = state.companies[id];
    const price = stockPrice(co.tier, co.size);
    for (const p of state.players) {
      if (p.shares[id] > 0) {
        p.cash += p.shares[id] * price;
        p.shares[id] = 0;
      }
    }
  }
  const maxCash = Math.max(...state.players.map((p) => p.cash));
  state.winnerIds = state.players.filter((p) => p.cash === maxCash).map((p) => p.id);
  state.phase = 'ended';
  log(state, `游戏结束。获胜：${state.winnerIds.map((id) => nameOf(state, id)).join('、')}。`);
}

// ---------- redaction ----------

/** Per-player view: own hand revealed, others' hands and the bag hidden. */
function redact(state: AcquireState, viewerId: PlayerId): PlayerView {
  return {
    phase: state.phase,
    board: state.board,
    companies: state.companies,
    players: state.players,
    currentPlayerIndex: state.currentPlayerIndex,
    pendingMerger: state.pendingMerger,
    pendingFounding: state.pendingFounding,
    log: state.log,
    winnerIds: state.winnerIds,
    bagCount: state.bag.length,
    you: viewerId,
    yourHand: state.hands[viewerId] ?? [],
    // A drawn tile is only revealed to the player who drew it (hidden from others).
    yourLastDraw:
      state.pendingDraw && state.pendingDraw.player === viewerId
        ? state.pendingDraw.tile
        : null,
    // `hands` (others), `bag` contents and `seed` are deliberately omitted.
  };
}

// ---------- reducer ----------

function reduce(
  state: AcquireState,
  playerId: PlayerId,
  action: PlayerAction,
): ReduceResult {
  const next = clone(state);

  if (action.type === 'START') {
    if (next.phase !== 'lobby') return err(state, '游戏已经开始。');
    if (next.players.length < 2) return err(state, '至少需要 2 名玩家。');
    next.phase = 'placing';
    log(next, `游戏开始，由 ${nameOf(next, currentPlayer(next).id)} 先手。`);
    return { state: next };
  }

  if (next.phase === 'ended') return err(state, '游戏已结束。');

  switch (action.type) {
    case 'PLACE_TILE': {
      if (next.phase !== 'placing') return err(state, '现在不是落子阶段。');
      if (currentPlayer(next).id !== playerId) return err(state, '还没轮到你。');
      const hand = next.hands[playerId] ?? [];
      if (!hand.includes(action.tile)) return err(state, '你手上没有这块板。');
      if (cellAt(next, action.tile) !== null) return err(state, '该位置已被占用。');
      // House rule: tiles that connect two safe companies ARE playable here;
      // beginMerger routes them to a placer-decides-survivor choice.
      // Remove tile from hand and place.
      next.hands[playerId] = hand.filter((t) => t !== action.tile);
      playerById(next, playerId)!.handCount = next.hands[playerId].length;
      return handlePlacement(next, playerId, action.tile);
    }
    case 'CHOOSE_FOUNDED_COMPANY':
      return chooseFoundedCompany(next, playerId, action.company);
    case 'RESOLVE_MERGER':
      return resolveMerger(next, playerId, action.survivor, action.order);
    case 'MERGER_DISPOSE':
      return mergerDispose(next, playerId, action.keep, action.sell, action.trade);
    case 'BUY_SHARES': {
      if (next.phase !== 'buying') return err(state, '现在不是购买阶段。');
      if (currentPlayer(next).id !== playerId) return err(state, '还没轮到你。');
      return buyShares(next, playerId, action.buy);
    }
    case 'END_TURN':
      return endTurn(next, playerId);
    case 'DECLARE_END':
      return declareEnd(next, playerId);
    default:
      return err(state, '未知动作。');
  }
}

function finalScores(state: AcquireState): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {};
  for (const p of state.players) out[p.id] = p.cash;
  return out;
}

export const AcquireGame: GameDefinition<AcquireState, PlayerAction> = {
  id: 'acquire',
  minPlayers: 2,
  maxPlayers: 6,
  createInitialState,
  reduce,
  redact,
  isGameOver,
  finalScores,
};

// Re-export selected helpers for tests and the renderer.
export { createInitialState, reduce, redact, stockPrice };
