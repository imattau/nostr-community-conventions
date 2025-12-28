import fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { isInitialized, getConfig, setConfig, getLogs, addAdmin, getAdmins, removeAdmin } from './db.js';
import { checkTor } from './tor-check.js';
import { generateKeypair, toNsec, fromNpub, detectGlobalIPv6, getPublicIPv4 } from 'ncc-06-js';
import { sendInviteDM } from './dm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startWebServer(initialPort = 3000) {
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

  server.post('/api/setup/init', async (request, reply) => {
    if (isInitialized()) {
      return reply.code(400).send({ error: 'Already initialized' });
    }
    const { adminPubkey, serviceNsec, config } = request.body;
    
    addAdmin(adminPubkey, 'active');
    setConfig('service_nsec', serviceNsec);
    setConfig('app_config', config);
    
    return { success: true };
  });

  server.get('/api/admins', async () => {
    return getAdmins();
  });

  server.post('/api/admin/invite', async (request, reply) => {
    const { npub, publicUrl } = request.body;
    const pubkey = fromNpub(npub);
    const serviceNsec = getConfig('service_nsec');
    const appConfig = getConfig('app_config');
    const keys = generateKeypair(fromNsec(serviceNsec));

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