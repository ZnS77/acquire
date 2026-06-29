// Hot-seat (pass-and-play) driver: ONE browser holds the full state and runs
// the engine locally, rendering whoever's turn it is. Good for verifying rules
// + UI on a single screen. For real multiplayer (each player on their own page),
// see client.ts + the authoritative server in src/server.

import { AcquireGame, redact, reduce } from '../engine/acquire';
import type { AcquireState, PlayerAction, PlayerId } from '../engine/types';
import { activeActor, renderApp } from './app';

let state: AcquireState;
let lastError: string | undefined;

const byId = (id: string) => document.getElementById(id) as HTMLElement;

function newGame(n: number): void {
  const ids: PlayerId[] = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const names = ids.map((_, i) => `玩家 ${i + 1}`);
  const seed = `seed-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  state = AcquireGame.createInitialState(ids, seed, names) as AcquireState;
  state = reduce(state, ids[0], { type: 'START' }).state;
  lastError = undefined;
  draw();
}

function draw(): void {
  const view = redact(state, activeActor(view0()) ?? state.players[0].id);
  renderApp(view, view.you, dispatch, lastError);
}

// activeActor needs a view; build a throwaway public view to compute it.
function view0() {
  return redact(state, state.players[0].id);
}

function dispatch(action: PlayerAction): void {
  const actor = activeActor(view0());
  if (!actor) return;
  const result = reduce(state, actor, action);
  if (result.error) {
    lastError = result.error;
    draw();
    return;
  }
  state = result.state;
  lastError = undefined;
  draw();
}

byId('newGame').addEventListener('click', () => {
  const n = parseInt((byId('numPlayers') as unknown as HTMLSelectElement).value, 10);
  newGame(n);
});

newGame(3);
