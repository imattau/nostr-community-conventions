import { 
  getServices, addService, updateService, deleteService, addLog 
} from '../db.js';
import { runPublishCycle } from '../app.js';
import { provisionOnion } from '../onion-service.js';
import { generateKeypair, ensureSelfSignedCert } from 'ncc-06-js';
import path from 'path';
import fs from 'fs';

export default async function serviceRoutes(server) {
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

  server.delete('/api/service/:id', async (request) => {
    deleteService(request.params.id);
    return { success: true };
  });

  server.get('/api/service/generate-key', async () => {
    const keys = generateKeypair();
    return { nsec: keys.nsec, npub: keys.npub };
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
}
