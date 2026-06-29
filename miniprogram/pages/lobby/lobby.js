const app = getApp();

Page({
  data: { name: '', joinId: '', busy: false, tip: '' },

  onName(e) { this.setData({ name: e.detail.value }); },
  onJoinId(e) { this.setData({ joinId: e.detail.value }); },

  async create() {
    if (this.data.busy) return;
    this.setData({ busy: true, tip: '创建中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'dispatch',
        data: { cmd: 'create', name: this.data.name || '玩家' },
      });
      const r = res.result;
      if (r.error) return this.setData({ tip: r.error });
      app.globalData.openid = r.openid;
      app.globalData.roomId = r.roomId;
      wx.navigateTo({ url: '/pages/game/game?roomId=' + r.roomId });
    } catch (e) {
      this.setData({ tip: '调用失败：' + (e.errMsg || e) });
    } finally {
      this.setData({ busy: false });
    }
  },

  async join() {
    const roomId = (this.data.joinId || '').trim();
    if (!roomId) return this.setData({ tip: '请输入房间号' });
    this.setData({ busy: true, tip: '加入中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'dispatch',
        data: { cmd: 'join', roomId, name: this.data.name || '玩家' },
      });
      const r = res.result;
      if (r.error) return this.setData({ tip: r.error });
      app.globalData.openid = r.openid;
      app.globalData.roomId = roomId;
      wx.navigateTo({ url: '/pages/game/game?roomId=' + roomId });
    } catch (e) {
      this.setData({ tip: '调用失败：' + (e.errMsg || e) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
