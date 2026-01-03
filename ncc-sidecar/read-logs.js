import Database from 'better-sqlite3';
const db = new Database('./sidecar.db');
const logs = db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 10').all();
console.log(JSON.stringify(logs, null, 2));
