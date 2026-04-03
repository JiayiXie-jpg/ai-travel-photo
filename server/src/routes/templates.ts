import { Router } from 'express';
import { getDb } from '../database';

const router = Router();

// 获取所有风格（含图片数量）
router.get('/styles', (req, res) => {
  const db = getDb();
  const { category, package_type, sub_category } = req.query;

  let sql = `
    SELECT style_name, COUNT(*) as count,
           MIN(image_url) as cover_url
    FROM templates
    WHERE is_active = 1`;
  const params: any[] = [];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (package_type) {
    sql += ' AND package_type = ?';
    params.push(package_type);
  }
  if (sub_category) {
    sql += ' AND sub_category = ?';
    params.push(sub_category);
  }

  sql += ' GROUP BY style_name ORDER BY MAX(id) DESC';

  const styles = db.prepare(sql).all(...params);
  res.json({ code: 0, data: styles });
});

// 获取套餐类型列表
router.get('/package-types', (_req, res) => {
  const db = getDb();
  const types = db.prepare(`
    SELECT DISTINCT package_type FROM templates
    WHERE is_active = 1 AND package_type != ''
    ORDER BY package_type
  `).all() as { package_type: string }[];
  res.json({ code: 0, data: types.map(t => t.package_type) });
});

// 获取服装子类列表
router.get('/sub-categories', (_req, res) => {
  const db = getDb();
  const cats = db.prepare(`
    SELECT DISTINCT sub_category FROM templates
    WHERE is_active = 1 AND sub_category != ''
    ORDER BY sub_category
  `).all() as { sub_category: string }[];
  res.json({ code: 0, data: cats.map(c => c.sub_category) });
});

// 获取模板列表（支持按风格筛选 + 搜索 + 分类过滤）
router.get('/templates', (req, res) => {
  const db = getDb();
  const { style, keyword, category, package_type, sub_category } = req.query;

  let sql = 'SELECT * FROM templates WHERE is_active = 1';
  const params: any[] = [];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  if (package_type) {
    sql += ' AND package_type = ?';
    params.push(package_type);
  }

  if (sub_category) {
    sql += ' AND sub_category = ?';
    params.push(sub_category);
  }

  if (style) {
    sql += ' AND style_name = ?';
    params.push(style);
  }

  if (keyword) {
    sql += ' AND style_name LIKE ?';
    params.push(`%${keyword}%`);
  }

  sql += ' ORDER BY id DESC';

  const templates = db.prepare(sql).all(...params);
  res.json({ code: 0, data: templates });
});

// 获取模板详情
router.get('/templates/:id', (req, res) => {
  const db = getDb();
  const template = db.prepare('SELECT * FROM templates WHERE id = ? AND is_active = 1').get(req.params.id);

  if (!template) {
    return res.json({ code: -1, message: '模板不存在' });
  }
  res.json({ code: 0, data: template });
});

export default router;
