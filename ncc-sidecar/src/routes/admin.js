import {
  isInitialized, getConfig, setConfig, getLogs, addAdmin, getAdmins, removeAdmin,
  addService, getServices
} from '../db.js';
import { generateKeypair, toNpub, fromNpub, fromNsec, getPublicKey } from 'ncc-06-js';
import { sendInviteDM } from '../dm.js';

export default async function adminRoutes(server, onInitialized) {
  server.get('/api/setup/status', async () => {
    return { initialized: isInitialized() };
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

  server.get('/api/status', async () => {
    if (!isInitialized()) return { status: 'uninitialized' };
    return {
      status: 'running',
      config: getConfig('app_config'),
      services: getServices().length,
      logs: getLogs(20)
    };
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

    const inviteMsg = `You are invited to manage NCC-06 Sidecar for ${keys.npub}. \nLogin here: ${publicUrl || 'http://' + request.headers.host}`;

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
}
