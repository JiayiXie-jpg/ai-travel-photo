const api = require('../../utils/api');

Page({
  data: {
    templates: [],
    shops: [],
    packageTypes: [],
    subCategories: [],
    currentShopId: '',
    currentPackageType: '',
    currentSubCategory: '',
    searchKeyword: '',
    loading: true,
  },

  onLoad() {
    this.loadShops();
    this.loadCategories();
    this.loadTemplates();
  },

  async loadShops() {
    try {
      const res = await api.getShops();
      if (res.code === 0) {
        this.setData({ shops: res.data });
      }
    } catch (err) {
      console.error('loadShops error', err);
    }
  },

  async loadCategories() {
    try {
      const shopId = this.data.currentShopId || undefined;
      const [pkgRes, subRes] = await Promise.all([
        api.getPackageTypes(shopId),
        api.getSubCategories(shopId),
      ]);
      if (pkgRes.code === 0) {
        this.setData({ packageTypes: pkgRes.data });
      }
      if (subRes.code === 0) {
        this.setData({ subCategories: subRes.data });
      }
    } catch (err) {
      console.error('loadCategories error', err);
    }
  },

  async loadTemplates() {
    this.setData({ loading: true });
    try {
      const res = await api.getTemplates(
        undefined,
        undefined,
        this.data.currentPackageType || undefined,
        this.data.currentSubCategory || undefined,
        this.data.currentShopId || undefined,
      );
      if (res.code === 0) {
        this.setData({ templates: res.data });
      }
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  onShopTap(e) {
    const shopId = e.currentTarget.dataset.shopId || '';
    if (shopId === this.data.currentShopId) return;
    this.setData({
      currentShopId: shopId,
      currentPackageType: '',
      currentSubCategory: '',
    });
    this.loadCategories();
    this.loadTemplates();
  },

  onPackageTypeTap(e) {
    const type = e.currentTarget.dataset.type || '';
    if (type === this.data.currentPackageType) return;
    this.setData({ currentPackageType: type });
    this.loadTemplates();
  },

  onSubCategoryTap(e) {
    const cat = e.currentTarget.dataset.category || '';
    if (cat === this.data.currentSubCategory) return;
    this.setData({ currentSubCategory: cat });
    this.loadTemplates();
  },

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value });
  },

  async onSearchConfirm() {
    const keyword = this.data.searchKeyword.trim();
    if (!keyword) {
      this.loadTemplates();
      return;
    }
    this.setData({ loading: true });
    try {
      const res = await api.searchTemplates(keyword);
      if (res.code === 0) {
        this.setData({ templates: res.data });
      }
    } catch (err) {
      wx.showToast({ title: '搜索失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  onRecommendTap() {
    wx.navigateTo({ url: '/pages/recommend/recommend?shop_id=' + (this.data.currentShopId || '') });
  },

  onTemplateTap(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.templates.find(t => t.id === id);
    const category = item && item.category ? item.category : 'tryon';
    wx.navigateTo({ url: '/pages/template-detail/template-detail?id=' + id + '&category=' + category });
  },

  onPullDownRefresh() {
    this.loadTemplates().then(() => wx.stopPullDownRefresh());
  },
});
