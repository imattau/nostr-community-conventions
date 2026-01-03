import { 
  getConfig, setConfig, getServices, getAdmins, updateService
} from '../db.js';

export default async function configRoutes(server) {
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
}
