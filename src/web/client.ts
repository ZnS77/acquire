// Networked per-player client. Connects to the authoritative server over
// WebSocket, receives ONLY this player's redacted view, sends ONLY actions.
// The engine never runs here — the client is a pure renderer + input collector.

import type { PlayerAction, PlayerId, PlayerView } from '../engine/types';
import { renderApp } from './app';

const byId = (id: string) => document.getElementById(id) as HTMLElement;

let ws: WebSocket | null = null;
let me: PlayerId = 'p1';
let view: PlayerView | null = null;
let lastError: string | undefined;

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // Server port is fixed for the demo; override via ?wsport= if needed.
  const port = new URLSearchParams(location.search).get('wsport') || '8787';
  return `${proto}://${location.hostname}:${port}`;
}

function connect(): void {
  const room = (byId('room') as unknown as HTMLInputElement).value || 'demo';
  me = (byId('me') as unknown as HTMLSelectElement).value as PlayerId;
  ws?.close();
  setConn('连接中…');
  ws = new WebSocket(wsUrl());
  ws.onopen = () => {
    setConn('已连接');
    ws!.send(JSON.stringify({ type: 'join', room, playerId: me }));
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string);
    if (msg.type === 'view') {
      view = msg.view as PlayerView;
      lastError = undefined;
      draw();
    } else if (msg.type === 'error') {
      lastError = msg.message;
      draw();
    }
  };
  ws.onclose = () => setConn('已断开');
  ws.onerror = () => setConn('连接错误');
}

function setConn(text: string): void {
  byId('conn').textContent = text;
}

function dispatch(action: PlayerAction): void {
  ws?.send(JSON.stringify({ type: 'action', action }));
}

function draw(): void {
  if (!view) return;
  renderApp(view, me, dispatch, lastError);
}

byId('connect').addEventListener('click', connect);

// Auto-connect using ?me= / ?room= from the URL so each tab is one player.
const params = new URLSearchParams(location.search);
if (params.get('me')) (byId('me') as unknown as HTMLSelectElement).value = params.get('me')!;
if (params.get('room')) (byId('room') as unknown as HTMLInputElement).value = params.get('room')!;
connect();
