import path from 'path';
import fs from 'fs';

// 加载 .env 文件
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  // 部署后改成实际域名，开发时用 ngrok 等工具获取公网地址
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',

  // 火山引擎 Ark API (doubao-seedream)
  ark: {
    apiKey: process.env.ARK_API_KEY || 'xxxxxxxxx',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seedream-4-5-251128',
  },

  // 管理后台密码
  adminToken: process.env.ADMIN_TOKEN || 'admin123',

  // 文件路径
  paths: {
    uploads: path.join(__dirname, '..', 'uploads'),
    templates: path.join(__dirname, '..', 'templates'),
    results: path.join(__dirname, '..', 'results'),
    data: path.join(__dirname, '..', 'data'),
    admin: path.join(__dirname, '..', 'admin'),
  },

  // 上传限制
  maxFileSize: 50 * 1024 * 1024, // 50MB

  // 任务轮询
  pollInterval: 3000,   // 3秒
  maxPollAttempts: 60,   // 最多轮询60次 = 3分钟

  // 豆包 Vision（AI 服饰推荐）
  vision: {
    model: process.env.VISION_MODEL || 'doubao-seed-2-0-pro-260215',
  },

  // 人脸融合后处理（lanmei-ai-fusion）
  fusion: {
    baseUrl: process.env.FUSION_BASE_URL || 'http://127.0.0.1:7860',
    enabled: process.env.FUSION_ENABLED !== 'false',
    timeoutMs: Number(process.env.FUSION_TIMEOUT_MS) || 60000,
  },

  // 蓝莓后台（远程模板同步）
  lanmei: {
    baseUrl: process.env.LANMEI_BASE_URL || 'https://crazyma99.xyz',
    username: process.env.LANMEI_USERNAME || 'platformadmin',
    password: process.env.LANMEI_PASSWORD || 'admin123',
  },
};
