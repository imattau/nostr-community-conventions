import { getDb } from '../index.js';

export class ConfigRepository {
  static get(key) {
    const db = getDb();
    const stmt = db.prepare('SELECT value FROM config WHERE key = ?');
    const result = stmt.get(key);
    if (!result) return null;
    try {
      return JSON.parse(result.value);
    } catch {
      return result.value;
    }
  }

  static set(key, value) {
    const db = getDb();
    const stmt = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
    stmt.run(key, JSON.stringify(value));
  }

  static getState(key) {
    const db = getDb();
    const stmt = db.prepare('SELECT value FROM state WHERE key = ?');
    const result = stmt.get(key);
    if (!result) return null;
    try {
      return JSON.parse(result.value);
    } catch {
      return result.value;
    }
  }

  static setState(key, value) {
    const db = getDb();
    const stmt = db.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)');
    stmt.run(key, JSON.stringify(value));
  }
}
