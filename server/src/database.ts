import Database from 'better-sqlite3';
import path from 'path';
import { config } from './config';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(path.join(config.paths.data, 'travel_photo.db'));
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export function initDatabase(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      style_name TEXT NOT NULL,
      image_path TEXT NOT NULL,
      image_url TEXT NOT NULL,
      scene_prompt TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_openid TEXT DEFAULT '',
      template_id INTEGER NOT NULL,
      user_photo_path TEXT NOT NULL,
      user_photo_url TEXT NOT NULL,
      volcano_task_id TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      result_image_url TEXT DEFAULT '',
      result_local_path TEXT DEFAULT '',
      error_message TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES templates(id)
    );
  `);

  // Migration: add scene_prompt column if missing
  const cols = db.prepare("PRAGMA table_info(templates)").all() as { name: string }[];
  if (!cols.find(c => c.name === 'scene_prompt')) {
    db.exec("ALTER TABLE templates ADD COLUMN scene_prompt TEXT DEFAULT ''");
  }

  // Migration: add category column to templates and tasks
  if (!cols.find(c => c.name === 'category')) {
    db.exec("ALTER TABLE templates ADD COLUMN category TEXT DEFAULT 'travel'");
  }
  const taskCols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  if (!taskCols.find(c => c.name === 'category')) {
    db.exec("ALTER TABLE tasks ADD COLUMN category TEXT DEFAULT 'travel'");
  }

  // Migration: add package_type and sub_category columns
  if (!cols.find(c => c.name === 'package_type')) {
    db.exec("ALTER TABLE templates ADD COLUMN package_type TEXT DEFAULT ''");
  }
  if (!cols.find(c => c.name === 'sub_category')) {
    db.exec("ALTER TABLE templates ADD COLUMN sub_category TEXT DEFAULT ''");
  }

  // Migration: add shop_id, shop_name, remote_album_id to templates
  const cols2 = db.prepare("PRAGMA table_info(templates)").all() as { name: string }[];
  if (!cols2.find(c => c.name === 'shop_id')) {
    db.exec("ALTER TABLE templates ADD COLUMN shop_id INTEGER DEFAULT 0");
  }
  if (!cols2.find(c => c.name === 'shop_name')) {
    db.exec("ALTER TABLE templates ADD COLUMN shop_name TEXT DEFAULT ''");
  }
  if (!cols2.find(c => c.name === 'remote_album_id')) {
    db.exec("ALTER TABLE templates ADD COLUMN remote_album_id INTEGER DEFAULT 0");
  }

  // shops 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS shops (
      id INTEGER PRIMARY KEY,
      shop_code TEXT NOT NULL DEFAULT '',
      shop_name TEXT NOT NULL,
      home_image TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // settings 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 预置默认 prompt（仅首次插入）
  const upsertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  upsertSetting.run('prompt_travel_full', 'Replace the face in image 2 with the face in image 1. The facial contour and facial details must be completely consistent with the character in image 1 to ensure a high degree of similarity. The hairstyle and makeup must perfectly match the character in image 2. Keep the hairstyle, clothing, pose, background, and lighting from image 2 unchanged. Maintain the aspect ratio of image 2. Generate 4K images. The facial contours and details must perfectly match the person in Image 1 to ensure high similarity.');
  upsertSetting.run('prompt_travel_face', 'Replace the face in image 2 with the face in image 1. The output face must be 100% identical to image 1: same face shape, same eyes (size, shape, double/single eyelid), same nose (bridge height, tip shape), same mouth (lip thickness, shape), same jawline, same skin tone, same facial proportions. The person in the output must be immediately recognizable as the same person in image 1. Keep the angle, lighting, and hair from image 2 unchanged. Generate the highest possible facial similarity to image 1.');
  upsertSetting.run('prompt_tryon', 'Replace the person in image 2 with ${personDesc}. The face, hairstyle, hair color, body shape, body proportions, and skin tone must be completely consistent with the person in image 1. The hairstyle must come from image 1 (the user\'s photo), NOT from image 2. The body type must appear ${bodyDesc} and match the user\'s actual physique. Keep the clothing, pose, background, and lighting from image 2 unchanged. Maintain the aspect ratio of image 2. Generate 4K images. The facial contours, hairstyle, and details must perfectly match the person in Image 1 to ensure high similarity.');

  console.log('Database initialized');
}

// 读取设置
export function getSetting(key: string): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || '';
}

// 写入设置
export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP').run(key, value);
}
