import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers['x-admin-token'] as string;
  if (token !== config.adminToken) {
    res.status(401).json({ code: -1, message: '未授权' });
    return;
  }
  next();
}
