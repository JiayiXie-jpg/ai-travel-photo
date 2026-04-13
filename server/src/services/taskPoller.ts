import { getDb } from '../database';
import { generateTravelPhoto } from './volcengine';
import { config } from '../config';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// 下载远程图片到本地
async function downloadImage(url: string): Promise<string> {
  const resp = await fetch(url);
  const buffer = Buffer.from(await resp.arrayBuffer());
  const filename = `${uuidv4()}.jpg`;
  const filepath = path.join(config.paths.results, filename);
  fs.writeFileSync(filepath, buffer);
  return filename;
}

// 执行生成任务（同步调用 Ark API）
export interface TaskExtra {
  body_type?: string;
  age_range?: string;
  scene_prompt?: string;
}

export async function executeTask(taskId: number, templatePath: string, userPhotoPath: string, category: string = 'travel', extra: TaskExtra = {}): Promise<void> {
  const db = getDb();

  try {
    db.prepare(`UPDATE tasks SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(taskId);

    const result = await generateTravelPhoto(templatePath, userPhotoPath, category, extra);

    if (result.success && (result.imageUrl || result.localPath)) {
      let localFile: string;
      let localUrl: string;

      if (result.localPath) {
        // 裁剪换贴方案已经保存到本地
        localFile = result.localPath;
        localUrl = result.imageUrl || `${config.baseUrl}/results/${localFile}`;
      } else {
        // 全图换脸方案需要下载
        localFile = await downloadImage(result.imageUrl!);
        localUrl = `${config.baseUrl}/results/${localFile}`;
      }

      db.prepare(`
        UPDATE tasks SET status = 'completed', result_image_url = ?, result_local_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(localUrl, localFile, taskId);

      console.log(`[Task] Task ${taskId} completed, saved to ${localFile}`);
    } else {
      db.prepare(`
        UPDATE tasks SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(result.error || '生成失败', taskId);
      console.log(`[Task] Task ${taskId} failed: ${result.error}`);
    }
  } catch (err: any) {
    console.error(`[Task] Task ${taskId} error:`, err.message);
    db.prepare(`
      UPDATE tasks SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(err.message || '服务器错误', taskId);
  }
}

// 服务器启动时重试未完成的任务
export function resumePendingTasks(): void {
  const db = getDb();
  const tasks = db.prepare(`
    SELECT t.id, t.user_photo_path, t.category, tpl.image_path as template_path
    FROM tasks t
    LEFT JOIN templates tpl ON tpl.id = t.template_id
    WHERE t.status IN ('pending', 'submitted', 'processing')
  `).all() as { id: number; user_photo_path: string; template_path: string; category: string }[];

  for (const task of tasks) {
    if (task.template_path && task.user_photo_path) {
      console.log(`[Task] Retrying task ${task.id}`);
      executeTask(task.id, task.template_path, task.user_photo_path, task.category || 'travel');
    }
  }

  if (tasks.length > 0) {
    console.log(`[Task] Retrying ${tasks.length} pending tasks`);
  }
}
