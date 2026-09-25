import { getDb } from '../index.js';

export class ServiceRepository {
  static getAll() {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM services');
    return stmt.all().map(this._parseService);
  }

  static getActive() {
    const db = getDb();
    const stmt = db.prepare("SELECT * FROM services WHERE status = 'active'");
    return stmt.all().map(this._parseService);
  }

  static getById(id) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM services WHERE id = ?');
    const result = stmt.get(id);
    return result ? this._parseService(result) : null;
  }

  static add(service) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO services (type, name, service_id, service_nsec, config, state)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      service.type,
      service.name,
      service.service_id,
      service.service_nsec,
      JSON.stringify(service.config || {}),
      JSON.stringify(service.state || {})
    );
    return { ...service, id: info.lastInsertRowid };
  }

  static update(id, updates) {
    const db = getDb();
    const current = this.getById(id);
    if (!current) throw new Error('Service not found');

    const merged = { ...current, ...updates };
    
    // Deep merge config and state if provided
    if (updates.config) merged.config = { ...current.config, ...updates.config };
    if (updates.state) merged.state = { ...current.state, ...updates.state };

    const stmt = db.prepare(`
      UPDATE services 
      SET name = ?, service_id = ?, service_nsec = ?, config = ?, state = ?, status = ?
      WHERE id = ?
    `);
    
    stmt.run(
      merged.name,
      merged.service_id,
      merged.service_nsec,
      JSON.stringify(merged.config),
      JSON.stringify(merged.state),
      merged.status || 'active',
      id
    );
    
    return merged;
  }

  static delete(id) {
    const db = getDb();
    const stmt = db.prepare('DELETE FROM services WHERE id = ?');
    stmt.run(id);
  }

  static _parseService(row) {
    return {
      ...row,
      config: JSON.parse(row.config || '{}'),
      state: JSON.parse(row.state || '{}')
    };
  }
}
