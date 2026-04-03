const api = require('../../utils/api');

Page({
  data: {
    taskId: null,
    status: 'pending',
    resultImageUrl: '',
    templateImageUrl: '',
    templateTitle: '',
    errorMessage: '',
    pollTimer: null,
  },

  onLoad(options) {
    if (options.task_id) {
      this.setData({ taskId: options.task_id });
      this.startPolling();
    }
  },

  startPolling() {
    this.pollTask();
    const timer = setInterval(() => this.pollTask(), 2000);
    this.setData({ pollTimer: timer });
  },

  async pollTask() {
    try {
      const res = await api.getTaskStatus(this.data.taskId);
      if (res.code === 0) {
        const task = res.data;
        this.setData({
          status: task.status,
          resultImageUrl: task.result_image_url,
          templateImageUrl: task.template_image_url,
          templateTitle: task.template_title,
          errorMessage: task.error_message,
        });

        if (task.status === 'completed' || task.status === 'failed') {
          clearInterval(this.data.pollTimer);
        }
      }
    } catch (err) {
      console.error('Poll error:', err);
    }
  },

  onSaveToAlbum() {
    if (!this.data.resultImageUrl) return;

    wx.showLoading({ title: '保存中...' });
    wx.downloadFile({
      url: this.data.resultImageUrl,
      success: (res) => {
        if (res.statusCode === 200) {
          wx.saveImageToPhotosAlbum({
            filePath: res.tempFilePath,
            success: () => {
              wx.hideLoading();
              wx.showToast({ title: '已保存到相册', icon: 'success' });
            },
            fail: (err) => {
              wx.hideLoading();
              if (err.errMsg.indexOf('auth deny') !== -1 || err.errMsg.indexOf('authorize') !== -1) {
                wx.showModal({
                  title: '提示',
                  content: '需要授权保存到相册',
                  success: (modalRes) => {
                    if (modalRes.confirm) {
                      wx.openSetting();
                    }
                  },
                });
              } else {
                wx.showToast({ title: '保存失败', icon: 'none' });
              }
            },
          });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '下载失败', icon: 'none' });
      },
    });
  },

  onTryAgain() {
    wx.navigateBack();
  },

  onShareResult() {
    // 预览图片，用户可以长按分享
    if (this.data.resultImageUrl) {
      wx.previewImage({
        urls: [this.data.resultImageUrl],
        current: this.data.resultImageUrl,
      });
    }
  },

  onUnload() {
    if (this.data.pollTimer) {
      clearInterval(this.data.pollTimer);
    }
  },
});
