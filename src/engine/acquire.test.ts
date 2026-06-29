import { describe, it, expect } from 'vitest';
import { createInitialState, reduce } from './acquire';
import { stockPrice } from './data';
import type { AcquireState, CompanyId, PlayerAction, TileId } from './types';

// Helpers ------------------------------------------------------------

function setup(numPlayers = 3): AcquireState {
  const ids = Array.from({ length: numPlayers }, (_, i) => `p${i + 1}`);
  let s = createInitialState(ids, 'test-seed');
  s = reduce(s, 'p1', { type: 'START' }).state;
  return s;
}

/** Place a tile directly on the board (test fixture, bypasses turn rules). */
function place(s: AcquireState, tile: TileId, value: CompanyId | 'unincorp'): void {
  const m = /^(\d{1,2})([A-I])$/.exec(tile)!;
  const col = parseInt(m[1], 10) - 1;
  const row = 'ABCDEFGHI'.indexOf(m[2]);
  s.board[row][col] = value;
}

function giveTile(s: AcquireState, pid: string, tile: TileId): void {
  if (!s.hands[pid].includes(tile)) s.hands[pid].push(tile);
  // Make sure the cell is free.
  const m = /^(\d{1,2})([A-I])$/.exec(tile)!;
  const col = parseInt(m[1], 10) - 1;
  const row = 'ABCDEFGHI'.indexOf(m[2]);
  s.board[row][col] = null;
  s.players.find((p) => p.id === pid)!.handCount = s.hands[pid].length;
}

function act(s: AcquireState, pid: string, a: PlayerAction): AcquireState {
  const r = reduce(s, pid, a);
  expect(r.error, `unexpected error: ${r.error}`).toBeUndefined();
  return r.state;
}

// Tests --------------------------------------------------------------

describe('price table', () => {
  it('matches the standard chart', () => {
    expect(stockPrice('low', 2)).toBe(200);
    expect(stockPrice('mid', 2)).toBe(300);
    expect(stockPrice('high', 2)).toBe(400);
    expect(stockPrice('low', 6)).toBe(600);
    expect(stockPrice('high', 11)).toBe(900);
    expect(stockPrice('low', 41)).toBe(1000);
  });
});

describe('founding a company', () => {
  it('incorporates an adjacent blob and grants the founder a free share', () => {
    let s = setup();
    // Pre-place a lone unincorporated tile next to where p1 will play.
    place(s, '1B', 'unincorp');
    giveTile(s, 'p1', '1A');

    s = act(s, 'p1', { type: 'PLACE_TILE', tile: '1A' });
    expect(s.phase).toBe('founding');

    s = act(s, 'p1', { type: 'CHOOSE_FOUNDED_COMPANY', company: 'tower' });
    expect(s.companies.tower.active).toBe(true);
    expect(s.companies.tower.size).toBe(2);
    expect(s.companies.tower.sharesLeft).toBe(24); // 25 - 1 free
    expect(s.players[0].shares.tower).toBe(1);
    expect(s.phase).toBe('buying');
  });
});

describe('buying shares', () => {
  it('caps at 3 shares and charges market price', () => {
    let s = setup();
    place(s, '1B', 'unincorp');
    giveTile(s, 'p1', '1A');
    s = act(s, 'p1', { type: 'PLACE_TILE', tile: '1A' });
    s = act(s, 'p1', { type: 'CHOOSE_FOUNDED_COMPANY', company: 'tower' });

    const cashBefore = s.players[0].cash;
    s = act(s, 'p1', { type: 'BUY_SHARES', buy: { tower: 2 } });
    // tower size 2 low tier = 200 each
    expect(s.players[0].cash).toBe(cashBefore - 400);
    expect(s.players[0].shares.tower).toBe(3); // 1 founder + 2 bought
    // After buying, the player draws and pauses to confirm the new tile.
    expect(s.phase).toBe('confirm');
    expect(s.pendingDraw?.player).toBe('p1');
    expect(s.currentPlayerIndex).toBe(0);
    // Confirming ends the turn → next player places.
    s = act(s, 'p1', { type: 'END_TURN' });
    expect(s.phase).toBe('placing');
    expect(s.currentPlayerIndex).toBe(1);
  });

  it('rejects buying more than 3', () => {
    let s = setup();
    place(s, '1B', 'unincorp');
    giveTile(s, 'p1', '1A');
    s = act(s, 'p1', { type: 'PLACE_TILE', tile: '1A' });
    s = act(s, 'p1', { type: 'CHOOSE_FOUNDED_COMPANY', company: 'tower' });
    const r = reduce(s, 'p1', { type: 'BUY_SHARES', buy: { tower: 4 } });
    expect(r.error).toBeTruthy();
  });
});

describe('merger payouts', () => {
  it('pays majority 10x and minority 5x, larger survives', () => {
    let s = setup(3);
    // Tower: tiles 1A,1B (size 2). Luxor: tiles 3A,4A,5A (size 3).
    place(s, '1A', 'tower');
    place(s, '1B', 'tower');
    s.companies.tower.active = true;
    s.companies.tower.size = 2;
    place(s, '3A', 'luxor');
    place(s, '4A', 'luxor');
    place(s, '5A', 'luxor');
    s.companies.luxor.active = true;
    s.companies.luxor.size = 3;

    // Shareholdings in tower (the company that will be absorbed):
    // p1 = 5 (majority), p2 = 2 (minority), p3 = 1.
    s.players[0].shares.tower = 5;
    s.players[1].shares.tower = 2;
    s.players[2].shares.tower = 1;
    s.companies.tower.sharesLeft = 25 - 8;

    // p1 plays 2A connecting tower(1A/1B) and luxor(3A..). Gap at 2A bridges them.
    giveTile(s, 'p1', '2A');
    const cash1 = s.players[0].cash;
    const cash2 = s.players[1].cash;

    s = act(s, 'p1', { type: 'PLACE_TILE', tile: '2A' });
    // Luxor (size 3) survives over Tower (size 2). Now disposal of tower.
    expect(s.phase).toBe('merging');
    expect(s.pendingMerger?.survivor).toBe('luxor');
    expect(s.pendingMerger?.currentDefunct).toBe('tower');

    const price = stockPrice('low', 2); // tower size 2 = 200
    expect(s.players[0].cash).toBe(cash1 + price * 10); // majority
    expect(s.players[1].cash).toBe(cash2 + price * 5); // minority
  });

  it('sole shareholder collects both bonuses', () => {
    let s = setup(2);
    place(s, '1A', 'tower');
    place(s, '1B', 'tower');
    s.companies.tower.active = true;
    s.companies.tower.size = 2;
    place(s, '3A', 'luxor');
    place(s, '4A', 'luxor');
    place(s, '5A', 'luxor');
    s.companies.luxor.active = true;
    s.companies.luxor.size = 3;

    s.players[0].shares.tower = 3;
    s.companies.tower.sharesLeft = 25 - 3;

    giveTile(s, 'p1', '2A');
    const cash1 = s.players[0].cash;
    s = act(s, 'p1', { type: 'PLACE_TILE', tile: '2A' });
    const price = stockPrice('low', 2);
    expect(s.players[0].cash).toBe(cash1 + price * 15); // 10x + 5x
  });
});

describe('merger disposal: 2:1 trade', () => {
  it('converts 2 defunct shares into 1 survivor share', () => {
    let s = setup(2);
    place(s, '1A', 'tower');
    place(s, '1B', 'tower');
    s.companies.tower.active = true;
    s.companies.tower.size = 2;
    place(s, '3A', 'luxor');
    place(s, '4A', 'luxor');
    place(s, '5A', 'luxor');
    s.companies.luxor.active = true;
    s.companies.luxor.size = 3;

    s.players[0].shares.tower = 4;
    s.companies.tower.sharesLeft = 25 - 4;
    const luxorLeftBefore = s.companies.luxor.sharesLeft;

    giveTile(s, 'p1', '2A');
    s = act(s, 'p1', { type: 'PLACE_TILE', tile: '2A' });
    expect(s.pendingMerger?.currentDefunct).toBe('tower');

    // Keep 0, sell 2, trade 2 → +1 luxor share, +2*200 cash from sale.
    const cashBefore = s.players[0].cash;
    s = act(s, 'p1', { type: 'MERGER_DISPOSE', keep: 0, sell: 2, trade: 2 });

    expect(s.players[0].shares.tower).toBe(0);
    expect(s.players[0].shares.luxor).toBe(1);
    expect(s.companies.luxor.sharesLeft).toBe(luxorLeftBefore - 1);
    expect(s.players[0].cash).toBe(cashBefore + 2 * stockPrice('low', 2));
    // Merger complete → buying phase.
    expect(s.phase).toBe('buying');
    expect(s.companies.tower.active).toBe(false);
    expect(s.companies.luxor.size).toBe(6); // 2 + 3 + bridging tile
  });

  it('rejects an odd trade amount', () => {
    let s = setup(2);
    place(s, '1A', 'tower');
    place(s, '1B', 'tower');
    s.companies.tower.active = true;
    s.companies.tower.size = 2;
    place(s, '3A', 'luxor');
    place(s, '4A', 'luxor');
    place(s, '5A', 'luxor');
    s.companies.luxor.active = true;
    s.companies.luxor.size = 3;
    s.players[0].shares.tower = 3;
    giveTile(s, 'p1', '2A');
    s = act(s, 'p1', { type: 'PLACE_TILE', tile: '2A' });
    const r = reduce(s, 'p1', { type: 'MERGER_DISPOSE', keep: 0, sell: 0, trade: 3 });
    expect(r.error).toBeTruthy();
  });
});

describe('safe company merge (house rule)', () => {
  function twoSafeBoard() {
    const s = setup(2);
    // tower safe (size 11) on columns 1–2, luxor safe (size 11) on columns 4–5,
    // a one-tile gap at 3A bridges them.
    for (let r = 0; r < 9; r++) place(s, `1${'ABCDEFGHI'[r]}`, 'tower');
    place(s, '2A', 'tower');
    place(s, '2B', 'tower');
    s.companies.tower.active = true;
    s.companies.tower.size = 11;
    s.companies.tower.safe = true;

    for (let r = 0; r < 9; r++) place(s, `4${'ABCDEFGHI'[r]}`, 'luxor');
    place(s, '5A', 'luxor');
    place(s, '5B', 'luxor');
    s.companies.luxor.active = true;
    s.companies.luxor.size = 11;
    s.companies.luxor.safe = true;
    giveTile(s, 'p1', '3A');
    return s;
  }

  it('lets the placing player choose the survivor', () => {
    let s = twoSafeBoard();
    s = act(s, 'p1', { type: 'PLACE_TILE', tile: '3A' });
    expect(s.phase).toBe('merging');
    expect(s.pendingMerger?.awaitingResolve).toBe(true);
    expect(s.pendingMerger?.candidates.sort()).toEqual(['luxor', 'tower']);
  });

  it('keeps the chosen safe company and absorbs the other', () => {
    let s = twoSafeBoard();
    s = act(s, 'p1', { type: 'PLACE_TILE', tile: '3A' });
    // Choose the smaller-by-name tower as survivor even though sizes tie.
    s = act(s, 'p1', { type: 'RESOLVE_MERGER', survivor: 'tower', order: ['luxor'] });
    // No one holds luxor shares here, so disposal is empty → merger completes.
    expect(s.phase).toBe('buying');
    expect(s.companies.tower.active).toBe(true);
    expect(s.companies.luxor.active).toBe(false);
    expect(s.companies.tower.size).toBe(23); // 11 + 11 + bridge tile
  });
});

describe('endgame settlement', () => {
  it('ends when all active companies are safe and settles stock at market', () => {
    let s = setup(2);
    // One safe company, p1 holds 2 shares, p2 holds 1.
    for (let r = 0; r < 9; r++) place(s, `1${'ABCDEFGHI'[r]}`, 'tower');
    place(s, '2A', 'tower');
    place(s, '2B', 'tower');
    s.companies.tower.active = true;
    s.companies.tower.size = 11;
    s.companies.tower.safe = true;
    s.players[0].shares.tower = 2;
    s.players[1].shares.tower = 1;

    const price = stockPrice('low', 11); // 700
    const c1 = s.players[0].cash;
    const c2 = s.players[1].cash;

    s = act(s, 'p1', { type: 'DECLARE_END' });
    expect(s.phase).toBe('ended');
    // p1 majority 10x + 2 shares sold; p2 minority 5x + 1 share sold.
    expect(s.players[0].cash).toBe(c1 + price * 10 + 2 * price);
    expect(s.players[1].cash).toBe(c2 + price * 5 + 1 * price);
    expect(s.winnerIds).toContain('p1');
  });
});

describe('redaction', () => {
  it('hides other hands, the bag and the seed', () => {
    const s = setup(2);
    const view = AcquireRedact(s, 'p1');
    expect(view.yourHand.length).toBe(6);
    expect((view as Record<string, unknown>).hands).toBeUndefined();
    expect((view as Record<string, unknown>).bag).toBeUndefined();
    expect((view as Record<string, unknown>).seed).toBeUndefined();
    expect(view.bagCount).toBeGreaterThan(0);
  });
});

// Imported lazily to keep the redact-specific typing local.
import { redact } from './acquire';
function AcquireRedact(s: AcquireState, id: string): { yourHand: TileId[]; bagCount: number } {
  return redact(s, id) as { yourHand: TileId[]; bagCount: number };
}
