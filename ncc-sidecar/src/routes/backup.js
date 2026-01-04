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
      const services = getServices();
      const sidecarService = services.find(s => s.type === 'sidecar');
      if (!sidecarService) throw new Error('Sidecar service missing');
      const secretKey = fromNsec(sidecarService.service_nsec);
      
      const payload = parseBackupEvent(event, secretKey);
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

  server.get('/api/backup/recovery-events', async (request, reply) => {
    const { adminPubkey } = request.query;
    if (!adminPubkey) return reply.code(400).send({ error: 'adminPubkey is required' });

    const relays = getConfig('app_config')?.publication_relays || [];
    if (!relays.length) return { events: [] };

    const pool = new SimplePool();
    try {
      const filter = {
        kinds: [30001],
        '#d': ['ncc-sidecar-recovery'],
        '#p': [adminPubkey]
      };
      const events = await pool.querySync(relays, filter);
      return { events: events || [] };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    } finally {
      pool.close(relays);
    }
  });

  server.post('/api/backup/recover', async (request, reply) => {
    const { event, senderPubkey } = request.body;
    // This is called DURING setup when DB is not initialized yet.
    // We need to use the admin's key to decrypt.
    // But wait, the admin's key is NOT in the DB yet.
    // We'll need to pass the admin's session or something.
    // Actually, the client (UI) can't easily decrypt NIP-44 without the secret key.
    // So the server must do it.
    // The UI must provide the admin's secret key? No, that's not good.
    // If the admin used a browser extension, we can't decrypt on the server.
  });
}
