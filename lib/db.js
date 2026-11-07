import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// DATA_DIR should point at a persistent disk in production. If it isn't
// writable (e.g. the disk isn't attached), fall back to ./data so the app
// still starts — but warn loudly, because that storage is wiped on redeploy.
function resolveDataDir() {
  const fallback = path.resolve('data');
  const wanted = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : fallback;
  try {
    fs.mkdirSync(wanted, { recursive: true });
    fs.accessSync(wanted, fs.constants.W_OK);
    return wanted;
  } catch (error) {
    if (wanted === fallback) throw error;
    console.warn(`\n[db] WARNING: DATA_DIR "${wanted}" is not writable (${error.code}).`);
    console.warn('[db] Is a persistent disk mounted at that path? Falling back to ./data,');
    console.warn('[db] which is NOT persistent: accounts and data will be lost on redeploy.\n');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const dataDir = resolveDataDir();
console.log(`[db] storing data in ${dataDir}`);

export const db = new DatabaseSync(path.join(dataDir, 'jobhunter.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT DEFAULT '',
  contact_email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  location TEXT DEFAULT '',
  links TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  skills TEXT DEFAULT '[]',
  experience_level TEXT DEFAULT '',
  years_experience REAL DEFAULT 0,
  job_titles TEXT DEFAULT '[]',
  preferred_roles TEXT DEFAULT '[]',
  resume_text TEXT DEFAULT '',
  resume_filename TEXT DEFAULT '',
  parsed_with TEXT DEFAULT '',
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT DEFAULT 'job',
  keywords TEXT DEFAULT '',
  location_mode TEXT DEFAULT 'city',
  city TEXT DEFAULT '',
  radius_km INTEGER DEFAULT 25,
  work_types TEXT DEFAULT '["onsite","remote","hybrid"]',
  min_salary INTEGER DEFAULT 0,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT DEFAULT '',
  location TEXT DEFAULT '',
  work_type TEXT DEFAULT '',
  kind TEXT DEFAULT 'job',
  salary_min REAL,
  salary_max REAL,
  salary_text TEXT DEFAULT '',
  salary_period TEXT DEFAULT 'year',
  description TEXT DEFAULT '',
  url TEXT DEFAULT '',
  posted_at TEXT,
  score INTEGER,
  reasons TEXT DEFAULT '[]',
  missing_skills TEXT DEFAULT '[]',
  scored_with TEXT DEFAULT '',
  scored_profile_at TEXT,
  dismissed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, source, external_id)
);
CREATE TABLE IF NOT EXISTS digests (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  job_ids TEXT NOT NULL,
  source TEXT NOT NULL,
  scored_with TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'saved',
  review_state TEXT NOT NULL DEFAULT 'none',
  cover_letter TEXT DEFAULT '',
  answers TEXT DEFAULT '[]',
  prepared_with TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  history TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, job_id)
);
`);

export const json = (s, fallback = []) => {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
};

export const now = () => new Date().toISOString();

/** Local calendar date (server timezone) used as the digest key. */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
