const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    tasks: [],
    loading: true,
  },

  onShow() {
    this.loadTasks();
  },

  async loadTasks() {
    this.setData({ loading: true });
    try {
      const res = await api.getMyTasks(app.globalData.userId);
      if (res.code === 0) {
        this.setData({ tasks: res.data });
      }
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  onTaskTap(e) {
    const taskId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: '/pages/processing/processing?task_id=' + taskId,
    });
  },

  statusText(status) {
    const map = {
      pending: '等待中',
      submitted: '已提交',
      processing: '处理中',
      completed: '已完成',
      failed: '失败',
    };
    return map[status] || status;
  },
});
