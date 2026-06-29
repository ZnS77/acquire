App({
  globalData: {
    // 在微信开发者工具里开通云开发后，把你的环境 ID 填到这里：
    env: 'TOUCH_YOUR_CLOUD_ENV_ID',
    openid: null,
    roomId: null,
  },
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }
    wx.cloud.init({ env: this.globalData.env, traceUser: true });
  },
});
