// Static game data: companies, board geometry, stock-price table.
import type { CompanyId, PriceTier, TileId } from './types';

export const ROWS = 9; // A–I
export const COLS = 12; // 1–12
export const ROW_LETTERS = 'ABCDEFGHI';
export const SHARES_PER_COMPANY = 25;
export const STARTING_CASH = 6000;
export const HAND_SIZE = 6;
export const SAFE_SIZE = 11;
export const END_SIZE = 41;
export const MAX_BUY_PER_TURN = 3;

export interface CompanyMeta {
  id: CompanyId;
  name: string;
  tier: PriceTier;
}

// Classic Acquire grouping: 2 cheap, 3 medium, 2 expensive.
export const COMPANY_META: CompanyMeta[] = [
  { id: 'tower', name: 'Tower 通天', tier: 'low' },
  { id: 'luxor', name: 'Luxor 卢克索', tier: 'low' },
  { id: 'american', name: 'American 美洲', tier: 'mid' },
  { id: 'worldwide', name: 'Worldwide 环球', tier: 'mid' },
  { id: 'festival', name: 'Festival 嘉年华', tier: 'mid' },
  { id: 'imperial', name: 'Imperial 帝国', tier: 'high' },
  { id: 'continental', name: 'Continental 大陆', tier: 'high' },
];

export const COMPANY_IDS: CompanyId[] = COMPANY_META.map((c) => c.id);

/** Tier offset added on top of the size-bracket base price. */
const TIER_OFFSET: Record<PriceTier, number> = { low: 0, mid: 100, high: 200 };

/**
 * Standard Acquire stock-price table. Price is a derived quantity (never stored).
 * Returns the per-share market price for a company of `size` tiles in `tier`.
 */
export function stockPrice(tier: PriceTier, size: number): number {
  if (size < 2) return 0;
  let base: number;
  if (size === 2) base = 200;
  else if (size === 3) base = 300;
  else if (size === 4) base = 400;
  else if (size === 5) base = 500;
  else if (size <= 10) base = 600;
  else if (size <= 20) base = 700;
  else if (size <= 30) base = 800;
  else if (size <= 40) base = 900;
  else base = 1000;
  return base + TIER_OFFSET[tier];
}

// Sizes at which the per-share price steps up to the next bracket.
const PRICE_THRESHOLDS = [3, 4, 5, 6, 11, 21, 31, 41];

/** Tiles a company must still gain before its share price rises; null at the cap. */
export function tilesToNextPriceBracket(size: number): number | null {
  if (size < 2) return 2 - size; // not founded yet → tiles until it could exist
  for (const t of PRICE_THRESHOLDS) if (t > size) return t - size;
  return null;
}

/** All 108 tile ids, "1A" … "12I". */
export function allTiles(): TileId[] {
  const tiles: TileId[] = [];
  for (let c = 1; c <= COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      tiles.push(`${c}${ROW_LETTERS[r]}`);
    }
  }
  return tiles;
}

/** Parse "12I" → { col: 11, row: 8 } (0-based indices). */
export function parseTile(tile: TileId): { col: number; row: number } {
  const m = /^(\d{1,2})([A-I])$/.exec(tile);
  if (!m) throw new Error(`bad tile id: ${tile}`);
  const col = parseInt(m[1], 10) - 1;
  const row = ROW_LETTERS.indexOf(m[2]);
  return { col, row };
}

export function makeTile(col: number, row: number): TileId {
  return `${col + 1}${ROW_LETTERS[row]}`;
}
