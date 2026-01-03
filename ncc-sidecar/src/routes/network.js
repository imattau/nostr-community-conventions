import { checkTor } from '../tor-check.js';
import { detectGlobalIPv6, getPublicIPv4 } from 'ncc-06-js';

export default async function networkRoutes(server) {
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
    
    return {
      detected: !!(forwardedFor || forwardedProto),
      details: {
        'x-forwarded-for': forwardedFor,
        'x-forwarded-proto': forwardedProto,
        'host': host
      }
    };
  });
}
