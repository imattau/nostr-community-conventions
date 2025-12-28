import Database from 'better-sqlite3';
import path from 'path';

let db;

export function initDb(dbPath = './sidecar.db') {
  const absolutePath = path.resolve(process.cwd(), dbPath);
  db = new Database(absolutePath);
  
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      level TEXT,
      message TEXT,
      metadata TEXT
    );
  `);

  return db;
}

export function getConfig(key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : defaultValue;
}

export function setConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

export function getState(key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM state WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : defaultValue;
}

export function setState(key, value) {
  db.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

export function addLog(level, message, metadata = {}) {
  db.prepare('INSERT INTO logs (level, message, metadata) VALUES (?, ?, ?)')
    .run(level, message, JSON.stringify(metadata));
}

export function getLogs(limit = 100) {
  return db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?').all(limit);
}

export function isInitialized() {
  const admin = getConfig('admin_pubkey');
  return !!admin;
}
