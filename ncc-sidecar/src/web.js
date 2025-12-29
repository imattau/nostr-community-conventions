import fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { isInitialized, getConfig, setConfig, getLogs, addAdmin, getAdmins, removeAdmin, addService, getServices, deleteService } from './db.js';
import { checkTor } from './tor-check.js';
import { generateKeypair, toNsec, fromNpub, detectGlobalIPv6, getPublicIPv4 } from 'ncc-06-js';
import { sendInviteDM } from './dm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startWebServer(initialPort = 3000, onInitialized) {
  const server = fastify({ logger: false });

  await server.register(cors, { origin: true });

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
      service_mode: 'public',
      generate_self_signed: true,
      protocols: { ipv4: true, ipv6: true, tor: true },
      primary_protocol: 'ipv4',
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

  server.delete('/api/service/:id', async (request) => {
    deleteService(request.params.id);
    return { success: true };
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
  } catch (err) {
    // ignore
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