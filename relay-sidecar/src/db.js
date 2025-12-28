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

    CREATE TABLE IF NOT EXISTS admins (
      pubkey TEXT PRIMARY KEY,
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS logs (
...
export function getLogs(limit = 100) {
  return db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?').all(limit);
}

export function addAdmin(pubkey, status = 'active') {
  db.prepare('INSERT OR REPLACE INTO admins (pubkey, status) VALUES (?, ?)').run(pubkey, status);
}

export function removeAdmin(pubkey) {
  db.prepare('DELETE FROM admins WHERE pubkey = ?').run(pubkey);
}

export function getAdmins() {
  return db.prepare('SELECT * FROM admins').all();
}

export function isInitialized() {
  const row = db.prepare('SELECT pubkey FROM admins LIMIT 1').get();
  return !!row;
}

