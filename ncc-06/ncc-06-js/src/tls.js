import fs from 'fs';
import path from 'path';
import selfsigned from 'selfsigned';

const DEFAULT_KEY_NAME = 'server.key';
const DEFAULT_CERT_NAME = 'server.crt';

/**
 * Ensure a TLS key/cert pair exists (used for local WSS testing).
 */
export async function ensureSelfSignedCert({
  targetDir = process.cwd(),
  keyFileName = DEFAULT_KEY_NAME,
  certFileName = DEFAULT_CERT_NAME,
  altNames = ['localhost', '127.0.0.1', '::1']
} = {}) {
  const keyPath = path.resolve(targetDir, keyFileName);
  const certPath = path.resolve(targetDir, certFileName);

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { keyPath, certPath };
  }

  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.mkdirSync(path.dirname(certPath), { recursive: true });

  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const altNameObjects = altNames.map(name => {
    if (name.includes(':')) {
      return { type: 7, ip: name };
    }
    return { type: 2, value: name };
  });

  const generated = await selfsigned.generate(attrs, {
    algorithm: 'rsa',
    keySize: 2048,
    days: 365,
    extensions: [{ name: 'subjectAltName', altNames: altNameObjects }]
  });

  const privateKey = generated.private || generated.privateKey;
  const certificate = generated.cert || generated.certificate;

  if (!privateKey || !certificate) {
    throw new Error(`Self-signed cert generation failed. Keys returned: ${Object.keys(generated).join(', ')}`);
  }

  fs.writeFileSync(keyPath, privateKey, 'utf-8');
  fs.writeFileSync(certPath, certificate, 'utf-8');

  return { keyPath, certPath };
}
