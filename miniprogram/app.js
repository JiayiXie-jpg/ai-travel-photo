App({
  globalData: {
    userId: ''
  },
  onLaunch() {
    // 生成或读取用户ID
    let userId = wx.getStorageSync('user_id');
    if (!userId) {
      userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      wx.setStorageSync('user_id', userId);
    }
    this.globalData.userId = userId;
  }
});
