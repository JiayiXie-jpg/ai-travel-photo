// 服务器地址 - 开发时改成你的实际地址
// 服务器地址 - 替换为你的实际地址
const BASE_URL = 'https://xxxxxxxxx:8155';

function request(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + '/api' + path,
      method,
      data,
      header: { 'Content-Type': 'application/json' },
      success: (res) => resolve(res.data),
      fail: (err) => reject(err),
    });
  });
}

function uploadFile(filePath) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: BASE_URL + '/api/upload',
      filePath,
      name: 'photo',
      success: (res) => {
        try {
          resolve(JSON.parse(res.data));
        } catch (e) {
          reject(e);
        }
      },
      fail: (err) => reject(err),
    });
  });
}

module.exports = {
  BASE_URL,
  getStyles: (category) => {
    let url = '/styles';
    if (category) url += '?category=' + encodeURIComponent(category);
    return request(url);
  },
  getTemplates: (style, category, packageType, subCategory) => {
    const params = [];
    if (style) params.push('style=' + encodeURIComponent(style));
    if (category) params.push('category=' + encodeURIComponent(category));
    if (packageType) params.push('package_type=' + encodeURIComponent(packageType));
    if (subCategory) params.push('sub_category=' + encodeURIComponent(subCategory));
    return request('/templates' + (params.length ? '?' + params.join('&') : ''));
  },
  searchTemplates: (keyword) => request('/templates?keyword=' + encodeURIComponent(keyword)),
  getPackageTypes: () => request('/package-types'),
  getSubCategories: () => request('/sub-categories'),
  getTemplateDetail: (id) => request('/templates/' + id),
  uploadPhoto: uploadFile,
  createTask: (templateId, userPhotoFilename, openid, category, extra) =>
    request('/tasks', 'POST', Object.assign({ template_id: templateId, user_photo_filename: userPhotoFilename, user_openid: openid, category: category || 'travel' }, extra || {})),
  getTaskStatus: (taskId) => request('/tasks/' + taskId),
  getMyTasks: (openid) => request('/tasks?openid=' + openid),
};
