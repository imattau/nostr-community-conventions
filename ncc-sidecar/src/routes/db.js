import { 
  getDbPath, isDbPasswordProtected, verifyDbPassword, closeDb, initDb, wipeDb, addLog, setDbPassword
} from '../db.js';
import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';

export default async function dbRoutes(server) {
  const assertDbPassword = (password, reply) => {
    if (verifyDbPassword(password)) return true;
    reply.code(403).send({ error: 'Invalid database password' });
    return false;
  };

  server.get('/api/db/info', async () => {
    const dbFile = getDbPath();
    try {
      const stats = await fs.promises.stat(dbFile);
      return {
        path: path.relative(process.cwd(), dbFile),
        modifiedAt: stats.mtimeMs,
        size: stats.size,
        passwordProtected: isDbPasswordProtected()
      };
    } catch (_err) {
      console.warn("[Web] Failed to read database info:", _err?.message || _err);
      return { error: 'Unable to read database file info' };
    }
  });

  server.get('/api/db/export', (request, reply) => {
    const password = request.query.password;
    if (!assertDbPassword(password, reply)) return;
    const dbFile = getDbPath();
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', 'attachment; filename="sidecar.db"');
    return reply.send(fs.createReadStream(dbFile));
  });

  server.post('/api/db/import', async (request, reply) => {
    const { data, password } = request.body;
    if (!assertDbPassword(password, reply)) return;
    if (!data) {
      return reply.code(400).send({ error: 'Missing database payload' });
    }
    const buffer = Buffer.from(data, 'base64');
    const dbFile = getDbPath();
    const backupPath = `${dbFile}.bak-${Date.now()}`;
    try {
      await fs.promises.copyFile(dbFile, backupPath);
    } catch (err) {
      console.warn(`[Web] Failed to backup current database before import: ${err.message}`);
    }
    closeDb();
    await fs.promises.writeFile(dbFile, buffer);
    initDb(dbFile);
    addLog('info', 'Database replaced via import', { backupPath: path.relative(process.cwd(), backupPath) });
    return { success: true, backupPath: path.relative(process.cwd(), backupPath) };
  });

  server.post('/api/db/wipe', async (request, reply) => {
    const { password } = request.body;
    if (!assertDbPassword(password, reply)) return;
    wipeDb();
    addLog('warn', 'Database wiped via admin UI');
    return { success: true };
  });

  server.post('/api/db/password', async (request, reply) => {
    const { currentPassword = '', newPassword = '' } = request.body || {};
    console.log(`[DB-Password] isProtected: ${isDbPasswordProtected()}, hasCurrent: ${!!currentPassword}`);
    if (isDbPasswordProtected() && !verifyDbPassword(currentPassword)) {
      console.warn(`[DB-Password] 403: Invalid current password provided`);
      return reply.code(403).send({ 
        error: 'Invalid current password',
        details: 'The provided current password does not match the one stored in the database.'
      });
    }
    setDbPassword(newPassword);
    const status = isDbPasswordProtected();
    addLog('info', newPassword ? 'Database password updated via admin UI' : 'Database password cleared via admin UI');
    return { success: true, passwordProtected: status };
  });
}
