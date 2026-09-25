import Database from 'better-sqlite3';
const db = new Database('./sidecar.db');
const services = db.prepare('SELECT id, name, type, state FROM services').all();
console.log(JSON.stringify(services, null, 2));
