// Admin token 管理
function getToken() {
  let token = localStorage.getItem('admin_token');
  if (!token) {
    token = prompt('请输入管理密码:', '');
    if (token) localStorage.setItem('admin_token', token);
  }
  return token || '';
}

// API 请求封装 (JSON)
async function api(path, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'X-Admin-Token': getToken(),
      'Content-Type': 'application/json',
    },
  };
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }
  return _handleResponse(await fetch('/api' + path, options));
}

// 上传请求封装 (FormData, 不设 Content-Type)
async function apiUpload(path, formData) {
  const resp = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'X-Admin-Token': getToken() },
    body: formData,
  });
  return _handleResponse(resp);
}

// 统一处理响应
async function _handleResponse(resp) {
  if (resp.status === 401) {
    localStorage.removeItem('admin_token');
    alert('认证失败，请重新输入密码');
    location.reload();
    return { code: -1 };
  }
  const contentType = resp.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    console.error('Non-JSON response:', resp.status, contentType);
    return { code: -1, message: '服务器返回异常，请检查服务是否启动' };
  }
  return resp.json();
}

// 状态文本
function statusText(status) {
  const map = {
    pending: '等待中',
    submitted: '已提交',
    processing: '处理中',
    completed: '已完成',
    failed: '失败',
  };
  return map[status] || status;
}
