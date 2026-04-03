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

  console.log('Database initialized');
}
