const api = require('../../utils/api');

Page({
  data: {
    step: 'upload', // upload | loading | result
    photoPath: '',
    uploadedFilename: '',
    btnText: '开始AI分析推荐',
    analysis: {},
    recommendations: [],
    shopId: '',
  },

  onLoad(options) {
    if (options.shop_id) {
      this.setData({ shopId: options.shop_id });
    }
  },

  onChoosePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.setData({ photoPath: tempFilePath, btnText: '压缩上传中...' });
        this.uploadPhoto(tempFilePath);
      },
    });
  },

  async uploadPhoto(filePath) {
    try {
      // 压缩
      const compressed = await new Promise((resolve, reject) => {
        wx.compressImage({
          src: filePath,
          quality: 80,
          success: (res) => resolve(res.tempFilePath),
          fail: () => resolve(filePath), // 压缩失败用原图
        });
      });

      const res = await api.uploadPhoto(compressed);
      if (res.code === 0) {
        this.setData({
          uploadedFilename: res.data.filename,
          btnText: '开始AI分析推荐',
        });
      } else {
        wx.showToast({ title: res.message || '上传失败', icon: 'none' });
        this.setData({ btnText: '开始AI分析推荐' });
      }
    } catch (err) {
      wx.showToast({ title: '上传失败', icon: 'none' });
      this.setData({ btnText: '开始AI分析推荐' });
    }
  },

  async onSubmit() {
    if (!this.data.uploadedFilename) return;

    this.setData({ step: 'loading' });

    try {
      const res = await api.recommend(
        this.data.uploadedFilename,
        this.data.shopId || undefined,
      );

      if (res.code === 0 && res.data) {
        this.setData({
          step: 'result',
          analysis: res.data.analysis || {},
          recommendations: res.data.recommendations || [],
        });
      } else {
        wx.showToast({ title: res.message || 'AI分析失败', icon: 'none' });
        this.setData({ step: 'upload' });
      }
    } catch (err) {
      wx.showToast({ title: '请求失败，请重试', icon: 'none' });
      this.setData({ step: 'upload' });
    }
  },

  onRecTap(e) {
    const index = e.currentTarget.dataset.index;
    const rec = this.data.recommendations[index];
    if (rec && rec.template_ids && rec.template_ids.length > 0) {
      wx.navigateTo({
        url: '/pages/template-detail/template-detail?id=' + rec.template_ids[0] + '&category=tryon',
      });
    } else {
      wx.showToast({ title: '暂无匹配模板', icon: 'none' });
    }
  },

  onRetry() {
    this.setData({
      step: 'upload',
      photoPath: '',
      uploadedFilename: '',
      btnText: '开始AI分析推荐',
      analysis: {},
      recommendations: [],
    });
  },
});
