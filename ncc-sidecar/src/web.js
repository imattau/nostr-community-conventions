import fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { Buffer } from 'buffer';
import { fileURLToPath } from 'url';
import { 
  isInitialized, getConfig, setConfig, getLogs, addAdmin, getAdmins, removeAdmin,
  addService, updateService, getServices, deleteService, addLog, getDbPath, closeDb,
  initDb, setDbPassword, verifyDbPassword, isDbPasswordProtected, wipeDb
} from './db.js';
import { checkTor } from './tor-check.js';
import { generateKeypair, toNpub, fromNpub, fromNsec, getPublicKey, detectGlobalIPv6, getPublicIPv4, ensureSelfSignedCert } from 'ncc-06-js';
import { sendInviteDM } from './dm.js';
import { runPublishCycle } from './app.js';
import { provisionOnion } from './onion-service.js';
import { isLocalHostname, isLocalAddress, shouldAllowRemoteAccess } from './security.js';
import { buildBackupPayload, createBackupEvent, parseBackupEvent } from './list-backup.js';
import { restoreBackupPayload, fetchRemoteBackup } from './list-sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startWebServer(initialPort = 3000, onInitialized, options = {}) {
  const { skipListen = false, bypassRemoteGuard = false } = options;
  const server = fastify({ logger: false });
  const debugSecurity = Boolean(process.env.NCC_SIDECAR_DEBUG_REMOTE);

  const assertDbPassword = (password, reply) => {
    if (verifyDbPassword(password)) return true;
    reply.code(403).send({ error: 'Invalid database password' });
    return false;
  };

  await server.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      try {
        const parsed = new URL(origin);
        if (isLocalHostname(parsed.hostname)) {
          return callback(null, true);
        }
      } catch (_err) {
        console.warn("[CORS] Origin parsing failed:", _err.message);
        return callback(new Error('CORS origin denied'));
      }
      callback(new Error('CORS origin denied'));
    },
    credentials: true
  });

  if (!bypassRemoteGuard) {
    server.addHook('onRequest', (request, reply, done) => {
      if (!isInitialized()) {
        done();
        return;
      }
      const appConfig = getConfig('app_config') || {};
      if (shouldAllowRemoteAccess(appConfig)) {
        done();
        return;
      }
      const forwarded = request.headers['x-forwarded-for'];
      const remoteAddress = typeof forwarded === 'string' && forwarded.length
        ? forwarded.split(',')[0].trim()
        : request.ip;
      if (debugSecurity) {
        console.log(`[Security] ${request.method} ${request.url} from ${remoteAddress}`);
      }
      if (!isLocalAddress(remoteAddress)) {
        reply.code(403).send({ error: 'Remote access disabled. Set NCC_SIDECAR_ALLOW_REMOTE=true to override.' });
        done();
        return;
      }
      done();
    });
  }

  // API Routes
  server.get('/api/setup/status', async () => {
    return { initialized: isInitialized() };
  });

  server.get('/api/tor/status', async () => {
    return await checkTor();
  });

  server.get('/api/network/probe', async () => {
    const ipv6 = detectGlobalIPv6();
    const ipv4 = await getPublicIPv4();
    return { ipv6, ipv4 };
  });

  server.get('/api/network/detect-proxy', async (request) => {
    const forwardedFor = request.headers['x-forwarded-for'];
    const forwardedProto = request.headers['x-forwarded-proto'];
    const host = request.headers['host'];
    
    // Simple heuristic: if x-forwarded headers exist, likely behind proxy.
    // Also if host doesn't match localhost/127.0.0.1 (though that might just mean bound to 0.0.0.0 and accessed via IP)
    
    return {
      detected: !!(forwardedFor || forwardedProto),
      details: {
        'x-forwarded-for': forwardedFor,
        'x-forwarded-proto': forwardedProto,
        'host': host
      }
    };
  });

  server.post('/api/setup/init', async (request, reply) => {
    if (isInitialized()) {
      return reply.code(400).send({ error: 'Already initialized' });
    }
    const { adminPubkey, config: userConfig } = request.body;
    
    if (!adminPubkey) {
      return reply.code(400).send({ error: 'Admin Pubkey is required' });
    }

    const sidecarKeys = generateKeypair();
    const defaultConfig = {
      refresh_interval_minutes: 360,
      ncc02_expiry_days: 14,
      ncc05_ttl_hours: 12,
      service_mode: 'private',
      generate_self_signed: true,
      protocols: { ipv4: true, ipv6: true, tor: true },
      primary_protocol: 'ipv4',
      preferred_protocol: 'auto',
      allow_remote: false,
      ...userConfig
    };

    addAdmin(adminPubkey, 'active');
    setConfig('app_config', defaultConfig);
    
    // Automatically add the Sidecar's own discovery profile
    addService({
      type: 'sidecar',
      name: 'Sidecar Node',
      service_id: 'manager',
      service_nsec: sidecarKeys.nsec,
      config: defaultConfig
    });

    if (onInitialized) onInitialized();
    
    return { 
      success: true, 
      sidecar_nsec: sidecarKeys.nsec,
      sidecar_npub: sidecarKeys.npub 
    };
  });

  server.get('/api/services', async () => {
    return getServices();
  });

  server.post('/api/service/add', async (request) => {
    return addService(request.body);
  });

  server.put('/api/service/:id', async (request) => {
    const services = getServices();
    const service = services.find(s => String(s.id) === String(request.params.id));
    const updates = { ...request.body };
    if (service?.state?.pending_onion) {
      const pending = service.state.pending_onion;
      updates.config = {
        ...updates.config,
        onion_private_key: pending.privateKey
      };
      updates.state = {
        ...service.state,
        pending_onion: null
      };
    }
    updateService(request.params.id, updates);
    return { success: true };
  });

  server.post('/api/service/:id/rotate-onion', async (request, reply) => {
    const services = getServices();
    const service = services.find(s => String(s.id) === String(request.params.id));
    if (!service) {
      return reply.code(404).send({ error: 'Service not found' });
    }
    const localPort = service.config?.local_port || service.config?.port || 3000;
    try {
      const torRes = await provisionOnion({
        serviceId: service.id,
        torControl: service.config?.tor_control,
        privateKey: null,
        localPort
      });
      const pending = {
        address: torRes.address,
        privateKey: torRes.privateKey,
        verification: { success: true }
      };
      updateService(service.id, {
        state: {
          ...service.state,
          pending_onion: pending
        }
      });
      return { success: true, pending };
    } catch (err) {
      console.error(`[Web] Onion rotation failed for ${service.name}: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });

  server.delete('/api/service/:id', async (request) => {
    deleteService(request.params.id);
    return { success: true };
  });

  server.post('/api/service/:id/regenerate-tls', async (request, reply) => {
    const services = getServices();
    const service = services.find(s => String(s.id) === String(request.params.id));
    if (!service) {
      return reply.code(404).send({ error: 'Service not found' });
    }

    if (service.config?.generate_self_signed === false) {
      return reply.code(400).send({ error: 'TLS regeneration is only available for services using self-signed certificates' });
    }

    const targetDir = path.join(process.cwd(), 'certs', String(service.id));
    const altNames = [];
    if (service.config?.probe_url) {
      try {
        altNames.push(new URL(service.config.probe_url).hostname);
      } catch (_err) {
        console.warn(`[Web] Invalid probe URL for ${service.name}:`, _err.message);
      }
    }
    if (altNames.length === 0) altNames.push('localhost');

    try {
      await fs.promises.rm(targetDir, { recursive: true, force: true });
    } catch (_err) {
      console.warn(`[Web] Failed to clear TLS cert for ${service.name}:`, _err.message);
    }

    try {
      await ensureSelfSignedCert({ targetDir, altNames });
      addLog('info', `Regenerated TLS cert for ${service.name}`, { serviceId: service.id });
      return { success: true };
    } catch (err) {
      console.error(`[Web] Failed to regenerate TLS cert for ${service.name}: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });

  server.post('/api/services/republish', async () => {
    const services = getServices().filter(s => s.status === 'active');
    const details = [];
    addLog('info', 'Manual republish triggered', { initiatedBy: 'admin' });
    for (const service of services) {
      try {
        const updatedState = await runPublishCycle(service, { forcePublish: true });
        details.push({ serviceId: service.id, success: true });
        addLog('info', `Forced publish succeeded for ${service.name}`, {
          serviceId: service.id,
          reason: 'manual republish',
          ncc02: updatedState.last_published_ncc02_id,
          ncc05: updatedState.last_published_ncc05_id,
          kind0: updatedState.last_published_kind0_id,
          publishResults: updatedState.last_success_per_relay
        });
      } catch (err) {
        addLog('error', `Forced publish failed for ${service.name}: ${err.message}`, { serviceId: service.id });
        details.push({ serviceId: service.id, success: false, error: err.message });
      }
    }
    return { success: true, details };
  });

  server.get('/api/admins', async () => {
    return getAdmins();
  });

  server.post('/api/admin/invite', async (request, reply) => {
    const { npub, publicUrl } = request.body;
    const pubkey = fromNpub(npub);
    const services = getServices();
    if (services.length === 0) return reply.code(400).send({ error: 'No services configured' });
    
    const serviceNsec = services[0].service_nsec;
    const appConfig = getConfig('app_config');
    const keys = { nsec: serviceNsec, npub: toNpub(getPublicKey(fromNsec(serviceNsec))) };

    const inviteMsg = `You are invited to manage NCC-06 Sidecar for ${keys.npub}. 
Login here: ${publicUrl || 'http://' + request.headers.host}`;

    const sent = await sendInviteDM({
      secretKey: fromNsec(serviceNsec),
      recipientPubkey: pubkey,
      message: inviteMsg,
      relays: appConfig.publication_relays || []
    });

    if (sent) {
      addAdmin(pubkey, 'pending');
      return { success: true };
    } else {
      return reply.code(500).send({ error: 'Failed to send DM' });
    }
  });

  server.delete('/api/admin/:pubkey', async (request) => {
    removeAdmin(request.params.pubkey);
    return { success: true };
  });

  server.put('/api/config/publication-relays', async (request, reply) => {
    const { relays } = request.body;
    if (!Array.isArray(relays)) {
      return reply.code(400).send({ error: 'relays must be an array of strings' });
    }
    const normalized = relays
      .map(entry => String(entry || '').trim())
      .filter(Boolean)
      .map(entry => {
        let candidate = entry;
        if (/^https?:\/\//i.test(candidate)) {
          candidate = candidate.replace(/^https?:\/\//i, match => (match.toLowerCase() === 'https://' ? 'wss://' : 'ws://'));
        } else if (!/^wss?:\/\//i.test(candidate)) {
          candidate = `wss://${candidate}`;
        }
        return candidate;
      });

    const appConfig = getConfig('app_config') || {};
    appConfig.publication_relays = [...new Set(normalized)];
    setConfig('app_config', appConfig);
    
    // propagate to existing services so their stored config stays in sync
    const services = getServices();
    for (const service of services) {
      updateService(service.id, {
        config: {
          ...service.config,
          publication_relays: appConfig.publication_relays
        }
      });
    }
    return { success: true, publication_relays: appConfig.publication_relays };
  });

  server.put('/api/config/allow-remote', async (request, reply) => {
    const { allowRemote } = request.body;
    if (typeof allowRemote !== 'boolean') {
      return reply.code(400).send({ error: 'allowRemote must be a boolean' });
    }
    const appConfig = getConfig('app_config') || {};
    appConfig.allow_remote = allowRemote;
    setConfig('app_config', appConfig);
    return { success: true, allow_remote: appConfig.allow_remote };
  });

  server.put('/api/config/protocols', async (request, reply) => {
    const { protocols } = request.body;
    if (!protocols || typeof protocols !== 'object') {
      return reply.code(400).send({ error: 'protocols must be an object' });
    }
    const allowed = ['ipv4', 'ipv6', 'tor'];
    const normalized = allowed.reduce((acc, key) => {
      acc[key] = Boolean(protocols[key]);
      return acc;
    }, {});
    const appConfig = getConfig('app_config') || {};
    appConfig.protocols = { ...appConfig.protocols, ...normalized };
    setConfig('app_config', appConfig);
    
    const services = getServices();
    const sidecar = services.find(s => s.type === 'sidecar');
    if (sidecar) {
      updateService(sidecar.id, {
        config: {
          ...sidecar.config,
          protocols: appConfig.protocols
        }
      });
    }
    return { success: true, protocols: appConfig.protocols };
  });

  server.put('/api/config/service-mode', async (request, reply) => {
    const { service_mode } = request.body;
    if (!['public', 'private'].includes(service_mode)) {
      return reply.code(400).send({ error: 'service_mode must be public or private' });
    }
    const appConfig = getConfig('app_config') || {};
    appConfig.service_mode = service_mode;
    setConfig('app_config', appConfig);

    const services = getServices();
    const sidecar = services.find(s => s.type === 'sidecar');
    if (sidecar) {
      const existingRecipients = Array.isArray(sidecar.config?.ncc05_recipients)
        ? sidecar.config.ncc05_recipients
        : [];
      let updatedConfig = {
        ...sidecar.config,
        service_mode
      };
      if (service_mode === 'private') {
        const admins = getAdmins().map(admin => admin.pubkey).filter(Boolean);
        const normalizedRecipients = Array.from(new Set([...existingRecipients, ...admins]));
        updatedConfig = {
          ...updatedConfig,
          ncc05_recipients: normalizedRecipients
        };
      }
      updateService(sidecar.id, { config: updatedConfig });
    }
    return { success: true, service_mode: appConfig.service_mode };
  });

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
      return reply.code(500).send({ error: err.message });
    }
  });

  server.post('/api/db/password', async (request, reply) => {
    const { currentPassword, newPassword } = request.body;
    if (isDbPasswordProtected() && !verifyDbPassword(currentPassword)) {
      return reply.code(403).send({ error: 'Invalid current password' });
    }
    setDbPassword(newPassword);
    const status = isDbPasswordProtected();
    addLog('info', newPassword ? 'Database password updated via admin UI' : 'Database password cleared via admin UI');
    return { success: true, passwordProtected: status };
  });

  server.get('/api/service/generate-key', async () => {
    const keys = generateKeypair();
    return { nsec: keys.nsec, npub: keys.npub };
  });

  server.get('/api/status', async () => {
    if (!isInitialized()) return { status: 'uninitialized' };
    return {
      status: 'running',
      config: getConfig('app_config'),
      services: getServices().length,
      logs: getLogs(20)
    };
  });

  // Serve Frontend
  const uiPath = path.join(__dirname, '../ui/dist');
  try {
    await server.register(staticFiles, {
      root: uiPath,
      prefix: '/',
    });
    server.setNotFoundHandler((request, reply) => {
      reply.sendFile('index.html');
    });
  } catch (_err) {
    console.warn("[Web] UI build not found, skipping static host:", _err.message);
  }

  if (skipListen) {
    await server.ready();
    return server;
  }

  let port = initialPort;
  let success = false;
  const maxAttempts = 20;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await server.listen({ port, host: '127.0.0.1' });
      success = true;
      break;
    } catch (err) {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Web] Port ${port} in use, trying ${port + 1}...`);
        port++;
      } else {
        throw err;
      }
    }
  }

  if (!success) {
    console.error(`[Web] Failed to find an available port after ${maxAttempts} attempts.`);
    process.exit(1);
  }

  console.log(`--- NCC-06 Admin Interface ---`);
  console.log(`URL: http://127.0.0.1:${port}`);
  console.log(`------------------------------`);

  return server;
}
