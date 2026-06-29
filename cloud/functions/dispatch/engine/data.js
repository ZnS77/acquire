"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMPANY_IDS = exports.COMPANY_META = exports.MAX_BUY_PER_TURN = exports.END_SIZE = exports.SAFE_SIZE = exports.HAND_SIZE = exports.STARTING_CASH = exports.SHARES_PER_COMPANY = exports.ROW_LETTERS = exports.COLS = exports.ROWS = void 0;
exports.stockPrice = stockPrice;
exports.tilesToNextPriceBracket = tilesToNextPriceBracket;
exports.allTiles = allTiles;
exports.parseTile = parseTile;
exports.makeTile = makeTile;
exports.ROWS = 9; // A–I
exports.COLS = 12; // 1–12
exports.ROW_LETTERS = 'ABCDEFGHI';
exports.SHARES_PER_COMPANY = 25;
exports.STARTING_CASH = 6000;
exports.HAND_SIZE = 6;
exports.SAFE_SIZE = 11;
exports.END_SIZE = 41;
exports.MAX_BUY_PER_TURN = 3;
// Classic Acquire grouping: 2 cheap, 3 medium, 2 expensive.
exports.COMPANY_META = [
    { id: 'tower', name: 'Tower 通天', tier: 'low' },
    { id: 'luxor', name: 'Luxor 卢克索', tier: 'low' },
    { id: 'american', name: 'American 美洲', tier: 'mid' },
    { id: 'worldwide', name: 'Worldwide 环球', tier: 'mid' },
    { id: 'festival', name: 'Festival 嘉年华', tier: 'mid' },
    { id: 'imperial', name: 'Imperial 帝国', tier: 'high' },
    { id: 'continental', name: 'Continental 大陆', tier: 'high' },
];
exports.COMPANY_IDS = exports.COMPANY_META.map((c) => c.id);
/** Tier offset added on top of the size-bracket base price. */
const TIER_OFFSET = { low: 0, mid: 100, high: 200 };
/**
 * Standard Acquire stock-price table. Price is a derived quantity (never stored).
 * Returns the per-share market price for a company of `size` tiles in `tier`.
 */
function stockPrice(tier, size) {
    if (size < 2)
        return 0;
    let base;
    if (size === 2)
        base = 200;
    else if (size === 3)
        base = 300;
    else if (size === 4)
        base = 400;
    else if (size === 5)
        base = 500;
    else if (size <= 10)
        base = 600;
    else if (size <= 20)
        base = 700;
    else if (size <= 30)
        base = 800;
    else if (size <= 40)
        base = 900;
    else
        base = 1000;
    return base + TIER_OFFSET[tier];
}
// Sizes at which the per-share price steps up to the next bracket.
const PRICE_THRESHOLDS = [3, 4, 5, 6, 11, 21, 31, 41];
/** Tiles a company must still gain before its share price rises; null at the cap. */
function tilesToNextPriceBracket(size) {
    if (size < 2)
        return 2 - size; // not founded yet → tiles until it could exist
    for (const t of PRICE_THRESHOLDS)
        if (t > size)
            return t - size;
    return null;
}
/** All 108 tile ids, "1A" … "12I". */
function allTiles() {
    const tiles = [];
    for (let c = 1; c <= exports.COLS; c++) {
        for (let r = 0; r < exports.ROWS; r++) {
            tiles.push(`${c}${exports.ROW_LETTERS[r]}`);
        }
    }
    return tiles;
}
/** Parse "12I" → { col: 11, row: 8 } (0-based indices). */
function parseTile(tile) {
    const m = /^(\d{1,2})([A-I])$/.exec(tile);
    if (!m)
        throw new Error(`bad tile id: ${tile}`);
    const col = parseInt(m[1], 10) - 1;
    const row = exports.ROW_LETTERS.indexOf(m[2]);
    return { col, row };
}
function makeTile(col, row) {
    return `${col + 1}${exports.ROW_LETTERS[row]}`;
}
