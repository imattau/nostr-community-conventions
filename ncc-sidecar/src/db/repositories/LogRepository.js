import { getDb } from '../index.js';

export class LogRepository {
  static add(level, message, metadata = null) {
    const db = getDb();
    const stmt = db.prepare('INSERT INTO logs (level, message, metadata) VALUES (?, ?, ?)');
    stmt.run(level, message, metadata ? JSON.stringify(metadata) : null);
  }

  static getRecent(limit = 50) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(limit).map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null
    }));
  }

  static clear() {
    const db = getDb();
    db.prepare('DELETE FROM logs').run();
  }
}
