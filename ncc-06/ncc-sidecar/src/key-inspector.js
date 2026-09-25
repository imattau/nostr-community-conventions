import tls from 'tls';
import { computeKFromCertPem } from 'ncc-06-js';

/**
 * Connects to a secure endpoint and retrieves its TLS certificate SPKI fingerprint.
 */
export async function getEndpointFingerprint(url) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const port = parsed.port || (parsed.protocol === 'wss:' || parsed.protocol === 'https:' ? 443 : 80);
      const host = parsed.hostname;

      if (!['wss:', 'https:', 'tls:', 'tcps:'].includes(parsed.protocol)) {
        return resolve(null);
      }

      const socket = tls.connect(port, host, { servername: host, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate();
        if (cert && cert.raw) {
          // computeKFromCertPem expects PEM format or similar
          // Actually, we can just wrap the DER in PEM headers or check what computeKFromCertPem expects.
          const pem = `-----BEGIN CERTIFICATE-----\n${cert.raw.toString('base64')}\n-----END CERTIFICATE-----`;
          const k = computeKFromCertPem(pem);
          socket.destroy();
          resolve(k);
        } else {
          socket.destroy();
          resolve(null);
        }
      });

      socket.on('error', (err) => {
        reject(new Error(`TLS connection to ${host}:${port} failed: ${err.message}`));
      });

      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error(`TLS handshake with ${host} timed out`));
      });
    } catch (err) {
      reject(err);
    }
  });
}
