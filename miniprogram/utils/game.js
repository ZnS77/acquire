// Small client-side helpers for rendering a redacted PlayerView in the
// mini-program. The authoritative rules live in the cloud function; this file
// only mirrors the two pure pricing helpers + presentation metadata.

const ROW_LETTERS = 'ABCDEFGHI';
const COMPANY_IDS = [
  'tower', 'luxor', 'american', 'worldwide', 'festival', 'imperial', 'continental',
];
const TIER_OFFSET = { low: 0, mid: 100, high: 200 };
const PRICE_THRESHOLDS = [3, 4, 5, 6, 11, 21, 31, 41];

// Board cell colours by company (kept in sync with the web renderer).
const COLOR = {
  tower: '#d98c3f', luxor: '#c9b03a', american: '#4f7fd6', worldwide: '#8d5fd3',
  festival: '#d65f9b', imperial: '#3fb0a0', continental: '#5fb84d',
  unincorp: '#5b6478', empty: '#1f2c42',
};

function stockPrice(tier, size) {
  if (size < 2) return 0;
  let base;
  if (size === 2) base = 200;
  else if (size === 3) base = 300;
  else if (size === 4) base = 400;
  else if (size === 5) base = 500;
  else if (size <= 10) base = 600;
  else if (size <= 20) base = 700;
  else if (size <= 30) base = 800;
  else if (size <= 40) base = 900;
  else base = 1000;
  return base + (TIER_OFFSET[tier] || 0);
}

function tilesToNextPriceBracket(size) {
  if (size < 2) return null;
  for (const t of PRICE_THRESHOLDS) if (t > size) return t - size;
  return null;
}

function shortName(name) { return (name || '').replace('玩家 ', '玩').replace('玩家', '玩'); }

/** Flatten the 9×12 board into 108 cells with colour + label for wx:for. */
function buildCells(view) {
  const cells = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 12; c++) {
      const v = view.board[r][c];
      const tile = (c + 1) + ROW_LETTERS[r];
      let color = COLOR.empty;
      let label = tile;
      if (v === 'unincorp') { color = COLOR.unincorp; }
      else if (v) { color = COLOR[v]; label = view.companies[v].name[0]; }
      cells.push({ tile, color, label, occupied: !!v });
    }
  }
  return cells;
}

/** Per-company stock-status rows (price, bonus, tiles-to-next, holders). */
function buildCompanies(view) {
  return COMPANY_IDS.map((id) => {
    const co = view.companies[id];
    const price = co.active ? stockPrice(co.tier, co.size) : 0;
    const toNext = co.active ? tilesToNextPriceBracket(co.size) : null;
    const holders = view.players
      .filter((p) => p.shares[id] > 0)
      .map((p) => shortName(p.name) + '×' + p.shares[id])
      .join(' ');
    return {
      id, name: co.name, color: COLOR[id], active: co.active, safe: co.safe,
      size: co.size, price, sharesLeft: co.sharesLeft,
      toNext: toNext == null ? '顶' : '+' + toNext,
      majority: price * 10, minority: price * 5,
      holders: holders || '—',
    };
  });
}

function activeActor(view) {
  switch (view.phase) {
    case 'placing':
    case 'buying':
    case 'confirm':
      return view.players[view.currentPlayerIndex].id;
    case 'founding':
      return view.pendingFounding ? view.pendingFounding.founder : null;
    case 'merging':
      if (view.pendingMerger && view.pendingMerger.awaitingResolve) return view.pendingMerger.triggerer;
      return view.pendingMerger ? view.pendingMerger.disposalOrder[view.pendingMerger.disposalIndex] : null;
    default:
      return null;
  }
}

const PHASE_LABEL = {
  lobby: '等待开始', placing: '落子阶段', founding: '成立公司',
  merging: '并购处置', buying: '购买股票', confirm: '确认手牌', ended: '游戏结束',
};

module.exports = {
  ROW_LETTERS, COMPANY_IDS, COLOR, PHASE_LABEL,
  stockPrice, tilesToNextPriceBracket, shortName,
  buildCells, buildCompanies, activeActor,
};
