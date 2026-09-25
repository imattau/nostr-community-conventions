import { getDb } from '../index.js';

export class AdminRepository {
  static getAll() {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM admins');
    return stmt.all();
  }

  static add(pubkey, status = 'active') {
    const db = getDb();
    const stmt = db.prepare('INSERT OR REPLACE INTO admins (pubkey, status) VALUES (?, ?)');
    stmt.run(pubkey, status);
  }

  static remove(pubkey) {
    const db = getDb();
    const stmt = db.prepare('DELETE FROM admins WHERE pubkey = ?');
    stmt.run(pubkey);
  }

  static exists(pubkey) {
    const db = getDb();
    const stmt = db.prepare('SELECT 1 FROM admins WHERE pubkey = ?');
    return !!stmt.get(pubkey);
  }
}
