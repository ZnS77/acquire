// Authoritative game server — the platform-neutral analog of the WeChat
// `dispatch` cloud function. It holds the FULL state per room (including all
// hands and the bag), runs the SAME engine the tests use, and sends every
// connected client ONLY its own redacted view. Clients send only actions.
//
// This is the "self-hosted ws" host the design doc names as the migration
// path: swap this file for a CloudBase cloud function and nothing in the
// engine or client changes.

import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { AcquireGame, redact, reduce } from '../engine/acquire';
import type { AcquireState, PlayerAction, PlayerId } from '../engine/types';

const PORT = Number(process.env.PORT ?? 8787);
const DEFAULT_PLAYERS = Number(process.env.ACQUIRE_PLAYERS ?? 3);

interface Room {
  id: string;
  state: AcquireState;
  roster: PlayerId[];
  sockets: Set<WebSocket>;
}

const rooms = new Map<string, Room>();
const socketInfo = new Map<WebSocket, { room: string; playerId: PlayerId }>();

function createRoom(id: string, numPlayers: number): Room {
  const roster: PlayerId[] = Array.from({ length: numPlayers }, (_, i) => `p${i + 1}`);
  const names = roster.map((_, i) => `玩家 ${i + 1}`);
  const seed = `room-${id}-${Date.now()}`;
  let state = AcquireGame.createInitialState(roster, seed, names) as AcquireState;
  // Auto-start so players can act as soon as they connect.
  state = reduce(state, roster[0], { type: 'START' }).state;
  const room: Room = { id, state, roster, sockets: new Set() };
  rooms.set(id, room);
  console.log(`[room ${id}] created with ${numPlayers} players`);
  return room;
}

function sendView(ws: WebSocket, room: Room, playerId: PlayerId): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const view = redact(room.state, playerId);
  ws.send(JSON.stringify({ type: 'view', view }));
}

/** Push each connected client its own redacted view. */
function broadcast(room: Room): void {
  for (const ws of room.sockets) {
    const info = socketInfo.get(ws);
    if (info) sendView(ws, room, info.playerId);
  }
}

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Acquire authoritative server. Connect a WebSocket and send {type:"join"}.');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg: { type: string; room?: string; playerId?: PlayerId; action?: PlayerAction };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'bad json' }));
      return;
    }

    if (msg.type === 'join') {
      const roomId = msg.room || 'demo';
      const playerId = (msg.playerId || 'p1') as PlayerId;
      let room = rooms.get(roomId);
      if (!room) room = createRoom(roomId, DEFAULT_PLAYERS);
      room.sockets.add(ws);
      socketInfo.set(ws, { room: roomId, playerId });
      console.log(`[room ${roomId}] ${playerId} joined (${room.sockets.size} sockets)`);
      sendView(ws, room, playerId);
      return;
    }

    if (msg.type === 'action') {
      const info = socketInfo.get(ws);
      if (!info) {
        ws.send(JSON.stringify({ type: 'error', message: '尚未加入房间' }));
        return;
      }
      const room = rooms.get(info.room);
      if (!room) return;
      const result = reduce(room.state, info.playerId, msg.action as PlayerAction);
      if (result.error) {
        // Validation failures go back only to the actor.
        ws.send(JSON.stringify({ type: 'error', message: result.error }));
        return;
      }
      room.state = result.state;
      broadcast(room);
      return;
    }
  });

  ws.on('close', () => {
    const info = socketInfo.get(ws);
    if (info) {
      rooms.get(info.room)?.sockets.delete(ws);
      socketInfo.delete(ws);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Acquire server listening on :${PORT} (default room players: ${DEFAULT_PLAYERS})`);
});
