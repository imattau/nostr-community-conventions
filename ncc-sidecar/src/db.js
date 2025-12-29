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

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      name TEXT,
      service_id TEXT,
      service_nsec TEXT,
      config TEXT,
      state TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

export function addAdmin(pubkey, status = 'active') {
  db.prepare('INSERT OR REPLACE INTO admins (pubkey, status) VALUES (?, ?)').run(pubkey, status);
}

export function getAdmins() {
  return db.prepare('SELECT * FROM admins ORDER BY created_at ASC').all();
}

export function removeAdmin(pubkey) {
  db.prepare('DELETE FROM admins WHERE pubkey = ?').run(pubkey);
}

// Service Management
export function addService(service) {
  const { type, name, service_id, service_nsec, config } = service;
  return db.prepare(`
    INSERT INTO services (type, name, service_id, service_nsec, config, state)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(type, name, service_id, service_nsec, JSON.stringify(config), JSON.stringify({}));
}

export function updateService(id, updates) {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates).map(v => typeof v === 'object' ? JSON.stringify(v) : v);
  db.prepare(`UPDATE services SET ${fields} WHERE id = ?`).run(...values, id);
}

export function getServices() {
  const rows = db.prepare('SELECT * FROM services').all();
  return rows.map(r => ({
    ...r,
    config: JSON.parse(r.config),
    state: JSON.parse(r.state)
  }));
}

export function deleteService(id) {
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
}

export function addLog(level, message, metadata = {}) {
  db.prepare('INSERT INTO logs (level, message, metadata) VALUES (?, ?, ?)')
    .run(level, message, JSON.stringify(metadata));
}

export function getLogs(limit = 100) {
  return db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?').all(limit);
}

export function isInitialized() {
  const row = db.prepare('SELECT pubkey FROM admins LIMIT 1').get();
  return !!row;
}

export function wipeDb() {
  db.exec(`
    DELETE FROM config;
    DELETE FROM state;
    DELETE FROM admins;
    DELETE FROM services;
    DELETE FROM logs;
  `);
}
