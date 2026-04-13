import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getDb, getSetting, setSetting } from '../database';
import { config } from '../config';
import { adminAuth } from '../middleware/adminAuth';
import { syncFromRemote } from '../services/syncRemote';

const router = Router();

router.use(adminAuth);

const templateStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.paths.templates),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  },
});
const templateUpload = multer({ storage: templateStorage, limits: { fileSize: config.maxFileSize } });

// === 同步远程模板 ===
router.post('/sync', async (_req, res) => {
  try {
    const result = await syncFromRemote();
    res.json({ code: 0, data: result, message: `同步完成：${result.albumsSync} 个相册，${result.imagesSync} 张图片，跳过 ${result.skipped} 个已存在` });
  } catch (err: any) {
    res.json({ code: -1, message: '同步失败: ' + err.message });
  }
});

// === 店铺列表 ===
router.get('/shops', (_req, res) => {
  const db = getDb();
  const shops = db.prepare('SELECT * FROM shops ORDER BY id').all();
  res.json({ code: 0, data: shops });
});

// === 风格列表（去重） ===
router.get('/styles', (_req, res) => {
  const db = getDb();
  const styles = db.prepare(`
    SELECT style_name, COUNT(*) as count,
           SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count
    FROM templates
    GROUP BY style_name
    ORDER BY MAX(id) DESC
  `).all();
  res.json({ code: 0, data: styles });
});

// === 模板管理 ===

// 查询模板（支持按风格筛选 + 关键词搜索）
router.get('/templates', (req, res) => {
  const db = getDb();
  const { style, keyword, show_inactive, shop_id, category } = req.query;

  let sql = 'SELECT * FROM templates WHERE 1=1';
  const params: any[] = [];

  if (!show_inactive) {
    sql += ' AND is_active = 1';
  }

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  if (shop_id !== undefined) {
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

  sql += ' ORDER BY id DESC';

  const templates = db.prepare(sql).all(...params);
  res.json({ code: 0, data: templates });
});

// 上传模板图片（支持多图上传，同一风格）
router.post('/templates', (req, res, next) => {
  templateUpload.array('images', 20)(req, res, (err: any) => {
    if (err) {
      console.error('[Admin Upload] Error:', err.message);
      return res.json({ code: -1, message: err.message || '上传失败' });
    }
    handleTemplateUpload(req, res);
  });
});

function handleTemplateUpload(req: any, res: any) {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) return res.json({ code: -1, message: '请上传图片' });

  const { style_name, scene_prompt, category, package_type, sub_category } = req.body;
  if (!style_name) return res.json({ code: -1, message: '风格名称必填' });

  const db = getDb();
  const stmt = db.prepare('INSERT INTO templates (style_name, image_path, image_url, scene_prompt, category, package_type, sub_category) VALUES (?, ?, ?, ?, ?, ?, ?)');

  const inserted: { id: number; image_url: string }[] = [];
  const insertMany = db.transaction(() => {
    for (const file of files) {
      const imageUrl = `${config.baseUrl}/templates/${file.filename}`;
      const result = stmt.run(style_name, file.filename, imageUrl, scene_prompt || '', category || 'travel', package_type || '', sub_category || '');
      inserted.push({ id: result.lastInsertRowid as number, image_url: imageUrl });
    }
  });
  insertMany();

  res.json({ code: 0, data: inserted, message: `成功上传 ${inserted.length} 张图片` });
}

// 更新模板的场景描述 prompt
router.put('/templates/:id/prompt', (req, res) => {
  const { scene_prompt } = req.body;
  if (scene_prompt === undefined) return res.json({ code: -1, message: 'scene_prompt 必填' });
  const db = getDb();
  db.prepare('UPDATE templates SET scene_prompt = ? WHERE id = ?').run(scene_prompt, req.params.id);
  res.json({ code: 0 });
});

// 下架/上架
router.put('/templates/:id/toggle', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE templates SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?')
    .run(req.params.id);
  res.json({ code: 0 });
});

// 批量下架某风格
router.put('/styles/:name/toggle', (req, res) => {
  const db = getDb();
  const { active } = req.body; // 0 下架, 1 上架
  db.prepare('UPDATE templates SET is_active = ? WHERE style_name = ?')
    .run(active ?? 0, req.params.name);
  res.json({ code: 0 });
});

// 删除单张模板
router.delete('/templates/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  res.json({ code: 0 });
});

// 删除整个风格
router.delete('/styles/:name', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM templates WHERE style_name = ?').run(req.params.name);
  res.json({ code: 0 });
});

// 重命名风格
router.put('/styles/:name', (req, res) => {
  const { new_name } = req.body;
  if (!new_name) return res.json({ code: -1, message: '名称不能为空' });
  const db = getDb();
  db.prepare('UPDATE templates SET style_name = ? WHERE style_name = ?')
    .run(new_name, req.params.name);
  res.json({ code: 0 });
});

// === 任务查看 ===
router.get('/tasks', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const tasks = db.prepare(`
    SELECT t.*, tpl.style_name, tpl.image_url as template_image_url
    FROM tasks t
    LEFT JOIN templates tpl ON tpl.id = t.template_id
    ORDER BY t.id DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, offset);

  const total = (db.prepare('SELECT COUNT(*) as c FROM tasks').get() as any).c;
  res.json({ code: 0, data: { tasks, total, page, pageSize } });
});

// === 统计 ===
router.get('/stats', (_req, res) => {
  const db = getDb();
  const stats = {
    totalStyles: (db.prepare('SELECT COUNT(DISTINCT style_name) as c FROM templates WHERE is_active = 1').get() as any).c,
    totalTemplates: (db.prepare('SELECT COUNT(*) as c FROM templates WHERE is_active = 1').get() as any).c,
    totalTasks: (db.prepare('SELECT COUNT(*) as c FROM tasks').get() as any).c,
    completedTasks: (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'completed'").get() as any).c,
    failedTasks: (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'failed'").get() as any).c,
  };
  res.json({ code: 0, data: stats });
});

// === 系统设置 ===
router.get('/settings', (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  res.json({ code: 0, data: settings });
});

router.put('/settings', (req, res) => {
  const entries = req.body;
  if (!entries || typeof entries !== 'object') {
    return res.json({ code: -1, message: '参数错误' });
  }
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value === 'string') {
      setSetting(key, value);
    }
  }
  res.json({ code: 0, message: '设置已保存' });
});

export default router;
