import { Router } from 'express';
import { getDb } from '../database';
import { executeTask } from '../services/taskPoller';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

const router = Router();

// 创建生成任务
router.post('/tasks', async (req, res) => {
  try {
    const { template_id, user_photo_filename, user_openid = '', category = 'travel', body_type = '', age_range = '' } = req.body;

    if (!template_id || !user_photo_filename) {
      return res.json({ code: -1, message: '缺少参数' });
    }

    const db = getDb();
    const template = db.prepare('SELECT * FROM templates WHERE id = ? AND is_active = 1').get(template_id) as any;
    if (!template) {
      return res.json({ code: -1, message: '模板不存在' });
    }

    const userPhotoUrl = `${config.baseUrl}/uploads/${user_photo_filename}`;

    // 插入任务记录
    const result = db.prepare(`
      INSERT INTO tasks (user_openid, template_id, user_photo_path, user_photo_url, status, category)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(user_openid, template_id, user_photo_filename, userPhotoUrl, category);

    const taskId = result.lastInsertRowid as number;

    // 立即返回任务 ID，后台异步执行生成
    res.json({ code: 0, data: { task_id: taskId } });

    // 如果模板图片是远程URL（image_path为空），先下载到本地
    let templatePath = template.image_path;
    if (!templatePath && template.image_url) {
      try {
        const resp = await fetch(template.image_url);
        const buffer = Buffer.from(await resp.arrayBuffer());
        const ext = path.extname(new URL(template.image_url).pathname) || '.jpg';
        const filename = `${uuidv4()}${ext}`;
        const filepath = path.join(config.paths.templates, filename);
        fs.writeFileSync(filepath, buffer);
        templatePath = filename;
        // 更新数据库，下次不用再下载
        db.prepare('UPDATE templates SET image_path = ? WHERE id = ?').run(filename, template_id);
      } catch (dlErr: any) {
        console.error('[Tasks] Failed to download template image:', dlErr.message);
      }
    }

    // 异步执行（不阻塞响应）
    executeTask(taskId, templatePath, user_photo_filename, category, { body_type, age_range, scene_prompt: template.scene_prompt || '' });
  } catch (err: any) {
    console.error('[Tasks] Create error:', err);
    res.json({ code: -1, message: err.message || '服务器错误' });
  }
});

// 查询任务状态
router.get('/tasks/:id', (req, res) => {
  const db = getDb();
  const task = db.prepare(`
    SELECT t.*, tpl.image_url as template_image_url, tpl.style_name
    FROM tasks t
    LEFT JOIN templates tpl ON tpl.id = t.template_id
    WHERE t.id = ?
  `).get(req.params.id);

  if (!task) {
    return res.json({ code: -1, message: '任务不存在' });
  }
  res.json({ code: 0, data: task });
});

// 用户任务历史
router.get('/tasks', (req, res) => {
  const db = getDb();
  const { openid } = req.query;

  let sql = `
    SELECT t.*, tpl.image_url as template_image_url, tpl.style_name
    FROM tasks t
    LEFT JOIN templates tpl ON tpl.id = t.template_id
  `;
  const params: any[] = [];

  if (openid) {
    sql += ' WHERE t.user_openid = ?';
    params.push(openid);
  }

  sql += ' ORDER BY t.id DESC LIMIT 50';

  const tasks = db.prepare(sql).all(...params);
  res.json({ code: 0, data: tasks });
});

export default router;
