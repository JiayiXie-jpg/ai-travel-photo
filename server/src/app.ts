import fs from 'fs';
import path from 'path';
import https from 'https';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { initDatabase } from './database';
import { resumePendingTasks } from './services/taskPoller';
import { loadModels } from './services/faceDetect';
import uploadRouter from './routes/upload';
import templatesRouter from './routes/templates';
import tasksRouter from './routes/tasks';
import adminRouter from './routes/admin';

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 静态文件
app.use('/uploads', express.static(config.paths.uploads));
app.use('/templates', express.static(config.paths.templates));
app.use('/results', express.static(config.paths.results));
app.use('/admin', express.static(config.paths.admin));

// 路由
app.use('/api', uploadRouter);
app.use('/api', templatesRouter);
app.use('/api', tasksRouter);
app.use('/api/admin', adminRouter);

// 根路径重定向到管理后台
app.get('/', (_req, res) => {
  res.redirect('/admin/');
});

// 全局错误处理 - 确保所有错误都返回 JSON 而不是 HTML
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Error]', err.message || err);

  // multer 文件大小超限
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ code: -1, message: `文件太大，最大允许 ${config.maxFileSize / 1024 / 1024}MB` });
  }

  // multer 其他错误
  if (err.name === 'MulterError') {
    return res.status(400).json({ code: -1, message: err.message });
  }

  res.status(500).json({ code: -1, message: err.message || '服务器内部错误' });
});

// 初始化
initDatabase();
loadModels().then(() => {
  resumePendingTasks();
});

// HTTPS 证书路径（生产环境）
// HTTPS 证书文件名 - 替换为你的域名证书
const certPath = path.join(__dirname, '..', process.env.SSL_CERT || 'server.pem');
const keyPath = path.join(__dirname, '..', process.env.SSL_KEY || 'server.key');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsOptions = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
  https.createServer(httpsOptions, app).listen(config.port, () => {
    console.log(`🚀 AI旅拍服务器运行中(HTTPS): https://localhost:${config.port}`);
    console.log(`📋 管理后台: https://localhost:${config.port}/admin/`);
  });
} else {
  app.listen(config.port, () => {
    console.log(`🚀 AI旅拍服务器运行中: http://localhost:${config.port}`);
    console.log(`📋 管理后台: http://localhost:${config.port}/admin/`);
  });
}
