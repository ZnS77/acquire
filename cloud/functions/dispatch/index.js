// 并购风云 — 权威云函数（CloudBase）。
//
// 这是设计文档第 6.4 节的 `dispatch` 云函数：服务端权威逻辑的宿主。它持有
// 完整状态（含牌库、手牌、种子），运行与单测同一份纯引擎，按玩家脱敏后下发。
// 客户端从不直接写状态，只调用这个函数发送意图（PlayerAction）。
//
// 数据库映射：
//   rooms/{roomId}        公共状态（大厅信息 + 公共视图），所有人可读、可 watch
//   room_private/{roomId_openid}  某玩家的脱敏视图（含本人手牌），仅本人可读
//   room_secret/{roomId}  完整状态（牌库/种子/全部手牌），任何客户端不可读
//
// 引擎由 `npm run build:cloud` 从 src/engine 编译进 ./engine（纯 JS，无外部依赖）。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const { AcquireGame, reduce, redact } = require('./engine/acquire');

const ROOMS = 'rooms';
const PRIV = 'room_private';
const SECRET = 'room_secret';
const MAX_PLAYERS = 6;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { cmd, roomId, action, name } = event || {};
  try {
    switch (cmd) {
      case 'whoami':
        return { ok: true, openid: OPENID };
      case 'create':
        return await createRoom(OPENID, name);
      case 'join':
        return await joinRoom(roomId, OPENID, name);
      case 'start':
        return await startGame(roomId, OPENID);
      case 'action':
        return await applyAction(roomId, OPENID, action);
      default:
        return { error: '未知命令：' + cmd };
    }
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
};

function newRoomId() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createRoom(openid, name) {
  // Retry a few times in the unlikely event of an id collision.
  for (let i = 0; i < 5; i++) {
    const roomId = newRoomId();
    const exists = await db.collection(ROOMS).doc(roomId).get().catch(() => null);
    if (exists && exists.data) continue;
    await db.collection(ROOMS).doc(roomId).set({
      data: {
        host: openid,
        players: [openid],
        names: { [openid]: name || '玩家1' },
        status: 'lobby',
        public: null,
        createdAt: db.serverDate(),
      },
    });
    return { ok: true, roomId, openid };
  }
  return { error: '房间号分配失败，请重试。' };
}

async function joinRoom(roomId, openid, name) {
  const snap = await db.collection(ROOMS).doc(roomId).get().catch(() => null);
  if (!snap || !snap.data) return { error: '房间不存在。' };
  const room = snap.data;
  if (room.status !== 'lobby') return { error: '游戏已开始，无法加入。' };
  if (!room.players.includes(openid)) {
    if (room.players.length >= MAX_PLAYERS) return { error: '房间已满。' };
    room.players.push(openid);
    room.names[openid] = name || '玩家' + room.players.length;
    await db.collection(ROOMS).doc(roomId).update({
      data: { players: room.players, names: room.names },
    });
  }
  return { ok: true, roomId, openid };
}

async function startGame(roomId, openid) {
  const snap = await db.collection(ROOMS).doc(roomId).get().catch(() => null);
  if (!snap || !snap.data) return { error: '房间不存在。' };
  const room = snap.data;
  if (room.host !== openid) return { error: '只有房主可以开始游戏。' };
  if (room.status !== 'lobby') return { error: '游戏已经开始。' };
  if (room.players.length < AcquireGame.minPlayers) {
    return { error: '至少需要 ' + AcquireGame.minPlayers + ' 名玩家。' };
  }
  const seed = roomId + '-' + Date.now();
  const names = room.players.map((p) => room.names[p] || p);
  let state = AcquireGame.createInitialState(room.players, seed, names);
  state = reduce(state, room.players[0], { type: 'START' }).state;
  await persist(roomId, room, state);
  return { ok: true };
}

async function applyAction(roomId, openid, action) {
  const secretSnap = await db.collection(SECRET).doc(roomId).get().catch(() => null);
  if (!secretSnap || !secretSnap.data) return { error: '对局不存在或尚未开始。' };
  const roomSnap = await db.collection(ROOMS).doc(roomId).get().catch(() => null);
  if (!roomSnap || !roomSnap.data) return { error: '房间不存在。' };

  const state = secretSnap.data.state;
  const result = reduce(state, openid, action);
  if (result.error) return { error: result.error };
  await persist(roomId, roomSnap.data, result.state);
  return { ok: true };
}

/**
 * Write the authoritative state back out, redacted per audience:
 *  - room_secret  : full state (cloud-only)
 *  - rooms.public : public view (no hand) for watching/lobby
 *  - room_private : each player's own redacted view (with their hand)
 */
async function persist(roomId, room, state) {
  const players = room.players;

  await db.collection(SECRET).doc(roomId).set({ data: { state } });

  const publicView = redact(state, '__public__'); // yourHand resolves to []
  await db.collection(ROOMS).doc(roomId).update({
    data: { status: state.phase === 'ended' ? 'ended' : 'playing', public: publicView },
  });

  await Promise.all(
    players.map((openid) =>
      db
        .collection(PRIV)
        .doc(roomId + '_' + openid)
        .set({ data: { roomId, openid, view: redact(state, openid) } }),
    ),
  );
}
