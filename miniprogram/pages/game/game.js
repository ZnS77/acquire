const app = getApp();
const G = require('../../utils/game.js');

Page({
  data: {
    roomId: '',
    me: '',
    // lobby
    room: null,
    inLobby: true,
    isHost: false,
    lobbyPlayers: [],
    // game view
    view: null,
    phaseLabel: '',
    actorName: '',
    isMyTurn: false,
    cells: [],
    companies: [],
    playersRow: [],
    logLines: [],
    hand: [],
    foundingChoices: [],
    mergerCandidates: [],
    disposal: null,
    buyList: [],
    buyMap: {},
    keep: 0, sell: 0, trade: 0,
    tip: '',
  },

  async onLoad(q) {
    const roomId = q.roomId;
    let me = app.globalData.openid;
    if (!me) {
      const res = await wx.cloud.callFunction({ name: 'dispatch', data: { cmd: 'whoami' } });
      me = res.result && res.result.openid;
      app.globalData.openid = me;
    }
    this.setData({ roomId, me });
    this.db = wx.cloud.database();
    this.startWatchers();
  },

  onUnload() {
    if (this.roomWatcher) this.roomWatcher.close();
    if (this.privWatcher) this.privWatcher.close();
  },

  startWatchers() {
    const { roomId, me } = this.data;
    this.roomWatcher = this.db.collection('rooms').doc(roomId).watch({
      onChange: (snap) => { const d = snap.docs && snap.docs[0]; if (d) this.applyRoom(d); },
      onError: () => {},
    });
    this.privWatcher = this.db.collection('room_private').doc(roomId + '_' + me).watch({
      onChange: (snap) => { const d = snap.docs && snap.docs[0]; if (d && d.view) this.applyView(d.view); },
      onError: () => {},
    });
  },

  applyRoom(room) {
    const inLobby = room.status === 'lobby';
    const players = (room.players || []).map((id) => ({ id, name: room.names[id] || id }));
    this.setData({
      room, inLobby,
      isHost: room.host === this.data.me,
      lobbyPlayers: players,
    });
  },

  applyView(view) {
    const me = this.data.me;
    const actor = G.activeActor(view);
    const meP = view.players.find((p) => p.id === me);
    const justDrawn = view.phase === 'confirm' && view.you === me ? view.yourLastDraw : null;
    const hand = (view.yourHand || []).map((t) => ({ tile: t, justDrawn: t === justDrawn }));

    let foundingChoices = [];
    if (view.phase === 'founding') {
      foundingChoices = G.COMPANY_IDS
        .filter((id) => !view.companies[id].active)
        .map((id) => ({ id, name: view.companies[id].name, color: G.COLOR[id] }));
    }

    let mergerCandidates = [];
    let disposal = null;
    const pm = view.pendingMerger;
    if (view.phase === 'merging' && pm) {
      if (pm.awaitingResolve) {
        mergerCandidates = pm.candidates.map((id) => ({
          id, name: view.companies[id].name, color: G.COLOR[id],
          size: view.companies[id].size, safe: view.companies[id].safe,
        }));
      } else if (pm.currentDefunct) {
        const held = meP ? meP.shares[pm.currentDefunct] : 0;
        disposal = {
          defunctName: view.companies[pm.currentDefunct].name,
          survivorName: view.companies[pm.survivor].name,
          price: G.stockPrice(view.companies[pm.currentDefunct].tier, view.companies[pm.currentDefunct].size),
          held,
        };
      }
    }

    let buyList = [];
    const buyMap = {};
    if (view.phase === 'buying') {
      buyList = G.COMPANY_IDS
        .filter((id) => view.companies[id].active)
        .map((id) => {
          const co = view.companies[id];
          buyMap[id] = 0;
          return {
            id, name: co.name, color: G.COLOR[id],
            price: G.stockPrice(co.tier, co.size),
            max: Math.min(3, co.sharesLeft), sharesLeft: co.sharesLeft,
          };
        });
    }

    const canEnd =
      view.phase === 'buying' &&
      ((G.COMPANY_IDS.some((id) => view.companies[id].active) &&
        G.COMPANY_IDS.filter((id) => view.companies[id].active).every((id) => view.companies[id].safe)) ||
        G.COMPANY_IDS.some((id) => view.companies[id].active && view.companies[id].size >= 41));

    this.setData({
      view, inLobby: false,
      phaseLabel: G.PHASE_LABEL[view.phase] || view.phase,
      actorName: actor ? (view.players.find((p) => p.id === actor) || {}).name : '—',
      isMyTurn: actor === me,
      cells: G.buildCells(view),
      companies: G.buildCompanies(view),
      playersRow: view.players.map((p) => ({
        id: p.id, name: p.name, cash: p.cash, handCount: p.handCount,
        isMe: p.id === me, isActor: p.id === actor,
        holdings: G.COMPANY_IDS.filter((id) => p.shares[id] > 0)
          .map((id) => view.companies[id].name[0] + '×' + p.shares[id]).join(' ') || '—',
      })),
      logLines: (view.log || []).slice(-30),
      hand, foundingChoices, mergerCandidates, disposal,
      buyList, buyMap, keep: 0, sell: 0, trade: 0, canEnd,
      winner: view.phase === 'ended' && view.winnerIds
        ? view.winnerIds.map((id) => (view.players.find((p) => p.id === id) || {}).name).join('、')
        : '',
    });
  },

  // ---- actions ----
  async dispatch(data) {
    try {
      const res = await wx.cloud.callFunction({ name: 'dispatch', data });
      if (res.result && res.result.error) {
        wx.showToast({ title: res.result.error, icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },
  act(action) { return this.dispatch({ cmd: 'action', roomId: this.data.roomId, action }); },

  startGame() { this.dispatch({ cmd: 'start', roomId: this.data.roomId }); },
  placeTile(e) {
    if (!this.data.isMyTurn || this.data.view.phase !== 'placing') return;
    this.act({ type: 'PLACE_TILE', tile: e.currentTarget.dataset.tile });
  },
  chooseCompany(e) { this.act({ type: 'CHOOSE_FOUNDED_COMPANY', company: e.currentTarget.dataset.id }); },
  resolveMerger(e) {
    const id = e.currentTarget.dataset.id;
    const others = this.data.view.pendingMerger.involved.filter((x) => x !== id);
    this.act({ type: 'RESOLVE_MERGER', survivor: id, order: others });
  },
  onKeep(e) { this.setData({ keep: +e.detail.value || 0 }); },
  onSell(e) { this.setData({ sell: +e.detail.value || 0 }); },
  onTrade(e) { this.setData({ trade: +e.detail.value || 0 }); },
  submitDispose() {
    this.act({ type: 'MERGER_DISPOSE', keep: this.data.keep, sell: this.data.sell, trade: this.data.trade });
  },
  onBuyInput(e) {
    const id = e.currentTarget.dataset.id;
    const map = Object.assign({}, this.data.buyMap);
    map[id] = +e.detail.value || 0;
    this.setData({ buyMap: map });
  },
  submitBuy() { this.act({ type: 'BUY_SHARES', buy: this.data.buyMap }); },
  confirmDraw() { this.act({ type: 'END_TURN' }); },
  declareEnd() { this.act({ type: 'DECLARE_END' }); },
  backToLobby() { wx.navigateBack(); },
});
