import fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';

import { 
  isInitialized, getConfig
} from './db.js';
import { isLocalHostname, isLocalAddress, shouldAllowRemoteAccess } from './security.js';

// Route Modules
import adminRoutes from './routes/admin.js';
import serviceRoutes from './routes/services.js';
import configRoutes from './routes/config.js';
import dbRoutes from './routes/db.js';
import networkRoutes from './routes/network.js';
import backupRoutes from './routes/backup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startWebServer(initialPort = 3000, onInitialized, options = {}) {
  const { skipListen = false, bypassRemoteGuard = false } = options;
  const server = fastify({ logger: false });
  const debugSecurity = Boolean(process.env.NCC_SIDECAR_DEBUG_REMOTE);

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

  // Register Routes
  await server.register(adminRoutes, onInitialized);
  await server.register(serviceRoutes);
  await server.register(configRoutes);
  await server.register(dbRoutes);
  await server.register(networkRoutes);
  await server.register(backupRoutes);

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
  const host = process.env.ADMIN_HOST || '127.0.0.1';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await server.listen({ port, host });
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