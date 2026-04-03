import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { config } from '../config';

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.paths.uploads),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSize },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件'));
    }
  },
});

router.post('/upload', (req: Request, res: Response, next: NextFunction) => {
  upload.single('photo')(req, res, (err: any) => {
    if (err) {
      console.error('[Upload] Error:', err.message);
      return res.json({ code: -1, message: err.message || '上传失败' });
    }
    if (!req.file) {
      return res.json({ code: -1, message: '请选择图片' });
    }
    const fileUrl = `${config.baseUrl}/uploads/${req.file.filename}`;
    res.json({ code: 0, data: { file_url: fileUrl, filename: req.file.filename } });
  });
});

export default router;
