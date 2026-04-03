const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    template: null,
    userPhoto: '',
    userPhotoFilename: '',
    submitting: false,
    category: 'travel',
    bodyType: '瘦',
    ageIndex: 0,
    ageOptions: ['10岁及以下', '11-18岁', '19-30岁', '31-45岁', '46-60岁', '60岁以上'],
  },

  onLoad(options) {
    if (options.category) {
      this.setData({ category: options.category });
    }
    if (options.id) {
      this.loadTemplate(options.id);
    }
  },

  async loadTemplate(id) {
    wx.showLoading({ title: '加载中' });
    try {
      const res = await api.getTemplateDetail(id);
      if (res.code === 0) {
        this.setData({ template: res.data });
      }
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    wx.hideLoading();
  },

  onBodyTypeTap(e) {
    this.setData({ bodyType: e.currentTarget.dataset.type });
  },

  onAgePicker(e) {
    this.setData({ ageIndex: e.detail.value });
  },

  onUploadTap() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempPath = res.tempFiles[0].tempFilePath;
        wx.compressImage({
          src: tempPath,
          quality: 80,
          success: (compressed) => {
            this.setData({ userPhoto: compressed.tempFilePath });
            this.uploadPhoto(compressed.tempFilePath);
          },
          fail: () => {
            this.setData({ userPhoto: tempPath });
            this.uploadPhoto(tempPath);
          },
        });
      },
    });
  },

  async uploadPhoto(filePath) {
    wx.showLoading({ title: '上传中...' });
    try {
      const res = await api.uploadPhoto(filePath);
      if (res.code === 0) {
        this.setData({ userPhotoFilename: res.data.filename });
        wx.showToast({ title: '上传成功', icon: 'success' });
      } else {
        wx.showToast({ title: res.message || '上传失败', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: '上传失败', icon: 'none' });
    }
    wx.hideLoading();
  },

  async onSubmitTap() {
    if (!this.data.userPhotoFilename) {
      return wx.showToast({ title: '请先上传照片', icon: 'none' });
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });

    wx.showLoading({ title: '提交中...' });
    try {
      const extraData = {};
      if (this.data.category === 'tryon') {
        extraData.body_type = this.data.bodyType;
        extraData.age_range = this.data.ageOptions[this.data.ageIndex];
      }

      const res = await api.createTask(
        this.data.template.id,
        this.data.userPhotoFilename,
        app.globalData.userId,
        this.data.category,
        extraData
      );
      wx.hideLoading();

      if (res.code === 0) {
        wx.navigateTo({
          url: '/pages/processing/processing?task_id=' + res.data.task_id,
        });
      } else {
        wx.showToast({ title: res.message || '提交失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
    this.setData({ submitting: false });
  },
});
