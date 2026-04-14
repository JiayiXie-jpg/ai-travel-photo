import { Router } from 'express';
import { getDb } from '../database';

const router = Router();

// 获取店铺列表
router.get('/shops', (_req, res) => {
  const db = getDb();
  const shops = db.prepare('SELECT * FROM shops WHERE is_active = 1 ORDER BY id').all();
  res.json({ code: 0, data: shops });
});

// 获取所有风格（含图片数量）
router.get('/styles', (req, res) => {
  const db = getDb();
  const { category, package_type, sub_category, shop_id } = req.query;

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
  if (shop_id) {
    sql += ' AND shop_id = ?';
    params.push(Number(shop_id));
  }

  sql += ' GROUP BY style_name ORDER BY MAX(id) DESC';

  const styles = db.prepare(sql).all(...params);
  res.json({ code: 0, data: styles });
});

// 获取套餐类型列表
router.get('/package-types', (req, res) => {
  const db = getDb();
  const { shop_id } = req.query;
  let sql = `SELECT DISTINCT package_type FROM templates WHERE is_active = 1 AND package_type != ''`;
  const params: any[] = [];
  if (shop_id) {
    sql += ' AND shop_id = ?';
    params.push(Number(shop_id));
  }
  sql += ' ORDER BY package_type';
  const types = db.prepare(sql).all(...params) as { package_type: string }[];
  res.json({ code: 0, data: types.map(t => t.package_type) });
});

// 获取服装子类列表
router.get('/sub-categories', (req, res) => {
  const db = getDb();
  const { shop_id } = req.query;
  let sql = `SELECT DISTINCT sub_category FROM templates WHERE is_active = 1 AND sub_category != ''`;
  const params: any[] = [];
  if (shop_id) {
    sql += ' AND shop_id = ?';
    params.push(Number(shop_id));
  }
  sql += ' ORDER BY sub_category';
  const cats = db.prepare(sql).all(...params) as { sub_category: string }[];
  res.json({ code: 0, data: cats.map(c => c.sub_category) });
});

// 获取模板列表（支持按风格筛选 + 搜索 + 分类过滤）
router.get('/templates', (req, res) => {
  const db = getDb();
  const { style, keyword, category, package_type, sub_category, shop_id, gender } = req.query;

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

  if (shop_id) {
    sql += ' AND shop_id = ?';
    params.push(Number(shop_id));
  }

  if (style) {
    sql += ' AND style_name = ?';
    params.push(style);
  }

  if (keyword) {
    sql += ' AND style_name LIKE ?';
    params.push(`%${keyword}%`);
  }

  // gender 过滤：排除明确异性的模板
  if (gender === 'male') {
    sql += " AND gender != 'female'";
  } else if (gender === 'female') {
    sql += " AND gender != 'male'";
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
