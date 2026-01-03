import { 
  getServices, getAdmins, getConfig, addLog
} from '../db.js';
import { fromNsec } from 'ncc-06-js';
import { buildBackupPayload, createBackupEvent, parseBackupEvent } from '../list-backup.js';
import { restoreBackupPayload, fetchRemoteBackup } from '../list-sync.js';

export default async function backupRoutes(server) {
  server.get('/api/backup/list', async (request, reply) => {
    const services = getServices();
    const sidecarService = services.find(s => s.type === 'sidecar');
    if (!sidecarService) {
      return reply.code(400).send({ error: 'Sidecar service not configured' });
    }
    const payload = buildBackupPayload({
      services,
      admins: getAdmins(),
      appConfig: getConfig('app_config') || {}
    });
    try {
      const secretKey = fromNsec(sidecarService.service_nsec);
      const event = createBackupEvent({ secretKey, payload });
      return { event, payload };
    } catch (err) {
      console.error('[Web] Failed to build list backup event:', err.message);
      return reply.code(500).send({ error: 'Unable to build backup event' });
    }
  });

  server.post('/api/backup/list', async (request, reply) => {
    const { event } = request.body || {};
    if (!event) {
      return reply.code(400).send({ error: 'Missing backup event' });
    }
    try {
      const payload = parseBackupEvent(event);
      const restored = restoreBackupPayload(payload, { log: false });
      addLog('info', 'Restored configuration from Nostr backup', {
        restoredServices: restored.restoredServices,
        restoredAdmins: restored.restoredAdmins
      });
      return { success: true, ...restored };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  server.get('/api/backup/remote', async (request, reply) => {
    try {
      const force = String(request.query.force) === 'true';
      const result = await fetchRemoteBackup({ force });
      return result;
    } catch (err) {
      console.error('[Web] Remote backup sync failed:', err.message);
      addLog('error', `Backup sync failed: ${err.message}`, { endpoint: 'remote_backup' });
      return reply.code(500).send({ error: err.message });
    }
  });
}
