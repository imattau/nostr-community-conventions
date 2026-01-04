import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

let db;
let dbAbsolutePath = null;
const DB_SECURITY_KEY = 'db_security';

export function initDb(dbPath = './sidecar.db') {
  const absolutePath = path.resolve(process.cwd(), dbPath);
  db = new Database(absolutePath);
  dbAbsolutePath = absolutePath;
  
  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');
  
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

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function getDbPath() {
  return dbAbsolutePath;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export function wipeDb() {
  if (!db) return;
  db.exec(`
    DELETE FROM config;
    DELETE FROM state;
    DELETE FROM admins;
    DELETE FROM services;
    DELETE FROM logs;
  `);
}

// Security / Password logic
export function isDbPasswordProtected() {
  const stmt = db.prepare('SELECT value FROM config WHERE key = ?');
  const result = stmt.get(DB_SECURITY_KEY);
  return !!result;
}

export function setDbPassword(password) {
  if (!password) {
    const stmt = db.prepare('DELETE FROM config WHERE key = ?');
    stmt.run(DB_SECURITY_KEY);
    return;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  const value = JSON.stringify({ salt, hash });
  const stmt = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  stmt.run(DB_SECURITY_KEY, value);
}

export function verifyDbPassword(password) {
  const stmt = db.prepare('SELECT value FROM config WHERE key = ?');
  const result = stmt.get(DB_SECURITY_KEY);
  if (!result) return true; // No password set
  if (!password) return false;

  try {
    const { salt, hash } = JSON.parse(result.value);
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
  } catch (err) {
    console.error(`[DB-Security] Failed to parse db_security value: ${err.message}`);
    return false;
  }
}
