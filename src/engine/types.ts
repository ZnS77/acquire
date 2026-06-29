// 并购风云 (Acquire) — engine type definitions.
// This module has ZERO transport/platform dependencies. It is pure data + logic
// so the same reducer can run in a WeChat cloud function, a self-hosted server,
// or the browser hot-seat preview.

export type PlayerId = string;
export type CompanyId =
  | 'tower'
  | 'luxor'
  | 'american'
  | 'worldwide'
  | 'festival'
  | 'imperial'
  | 'continental';

export type TileId = string; // e.g. "1A" … "12I"

export type PriceTier = 'low' | 'mid' | 'high';

export type Phase =
  | 'lobby'
  | 'placing'
  | 'founding'
  | 'merging'
  | 'buying'
  | 'confirm' // drew a tile; current player confirms before passing
  | 'ended';

/** A single board cell. */
export type Cell = null | 'unincorp' | CompanyId;

export interface Company {
  id: CompanyId;
  name: string;
  tier: PriceTier;
  size: number;
  safe: boolean; // size >= 11
  active: boolean; // is on the board
  sharesLeft: number; // 25 - issued
}

export interface PlayerPublic {
  id: PlayerId;
  name: string;
  cash: number;
  shares: Record<CompanyId, number>;
  handCount: number;
  connected: boolean;
}

/** Disposal progress while a merger is being resolved. */
export interface PendingMerger {
  tile: TileId; // the tile that triggered the merger
  triggerer: PlayerId; // player who placed the tile
  componentTiles: TileId[]; // all tiles that become survivor once merger completes
  involved: CompanyId[]; // every company drawn into the merger
  awaitingResolve: boolean; // true → triggerer must pick survivor
  candidates: CompanyId[]; // valid survivor choices while awaitingResolve
  survivor?: CompanyId; // chosen / largest survivor
  defunctQueue: CompanyId[]; // companies still to be processed, in order
  currentDefunct?: CompanyId; // company whose shareholders are disposing now
  disposalOrder: PlayerId[]; // shareholders of currentDefunct, from triggerer clockwise
  disposalIndex: number; // whose turn it is to dispose
}

/** Founding awaiting a company-name choice. */
export interface PendingFounding {
  componentTiles: TileId[]; // unincorporated group to be incorporated
  founder: PlayerId;
}

/**
 * Full, server-authoritative state. The engine holds everything; `redact`
 * produces the per-player view (hiding other hands and the bag contents).
 */
export interface AcquireState {
  phase: Phase;
  board: Cell[][]; // 9 rows (A–I) × 12 cols (1–12)
  companies: Record<CompanyId, Company>;
  players: PlayerPublic[];
  hands: Record<PlayerId, TileId[]>; // private, never broadcast wholesale
  bag: TileId[]; // private draw pile (contents + order)
  seed: string;
  currentPlayerIndex: number;
  pendingMerger?: PendingMerger;
  pendingFounding?: PendingFounding;
  pendingDraw?: { player: PlayerId; tile: TileId | null }; // tile just drawn
  log: string[];
  winnerIds?: PlayerId[];
}

/**
 * The redacted, per-player view that is safe to send over the wire.
 * Contains the full public state plus only the viewer's own hand —
 * never other players' hands, the bag contents, or the seed.
 */
export interface PlayerView {
  phase: Phase;
  board: Cell[][];
  companies: Record<CompanyId, Company>;
  players: PlayerPublic[];
  currentPlayerIndex: number;
  pendingMerger?: PendingMerger;
  pendingFounding?: PendingFounding;
  log: string[];
  winnerIds?: PlayerId[];
  bagCount: number;
  you: PlayerId;
  yourHand: TileId[];
  yourLastDraw?: TileId | null; // the tile you just drew (only in 'confirm')
}

export type PlayerAction =
  | { type: 'START' }
  | { type: 'PLACE_TILE'; tile: TileId }
  | { type: 'CHOOSE_FOUNDED_COMPANY'; company: CompanyId }
  | { type: 'RESOLVE_MERGER'; survivor: CompanyId; order: CompanyId[] }
  | { type: 'MERGER_DISPOSE'; keep: number; sell: number; trade: number }
  | { type: 'BUY_SHARES'; buy: Partial<Record<CompanyId, number>> }
  | { type: 'END_TURN' } // confirm drawn tile, pass to next player
  | { type: 'DECLARE_END' };

export interface ReduceResult {
  state: AcquireState;
  error?: string;
}

/** The reusable contract between the transport layer and any game. */
export interface GameDefinition<S, A> {
  id: string;
  minPlayers: number;
  maxPlayers: number;
  createInitialState(players: PlayerId[], seed: string, names?: string[]): S;
  reduce(state: S, playerId: PlayerId, action: A): { state: S; error?: string };
  redact(state: S, viewerId: PlayerId): unknown;
  isGameOver(state: S): boolean;
  finalScores(state: S): Record<PlayerId, number>;
}
