import fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { isInitialized, getConfig, setConfig, getLogs } from './db.js';
import { checkTor } from './tor-check.js';
import { generateKeypair, toNsec } from 'ncc-06-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startWebServer(initialPort = 3000) {
  const server = fastify({ logger: false }); // Reduce noise during port hunting

  await server.register(cors, { origin: true });

  // API Routes
  server.get('/api/setup/status', async () => {
    return { initialized: isInitialized() };
  });

  server.get('/api/tor/status', async () => {
    return await checkTor();
  });

  server.post('/api/setup/init', async (request, reply) => {
    if (isInitialized()) {
      return reply.code(400).send({ error: 'Already initialized' });
    }
    const { adminPubkey, serviceNsec, config } = request.body;
    
    setConfig('admin_pubkey', adminPubkey);
    setConfig('service_nsec', serviceNsec);
    setConfig('app_config', config);
    
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



