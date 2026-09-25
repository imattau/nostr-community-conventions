import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import selfsigned from 'selfsigned';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const DEFAULT_KEY_PATH = path.resolve(projectRoot, 'certs/server.key');
const DEFAULT_CERT_PATH = path.resolve(projectRoot, 'certs/server.crt');

export const ensureTlsCertificates = async (config = {}) => {
  const keyPath = config.relayTlsKey
    ? path.resolve(process.cwd(), config.relayTlsKey)
    : DEFAULT_KEY_PATH;
  const certPath = config.relayTlsCert
    ? path.resolve(process.cwd(), config.relayTlsCert)
    : DEFAULT_CERT_PATH;

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { keyPath, certPath };
  }

  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.mkdirSync(path.dirname(certPath), { recursive: true });

  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    { type: 7, ip: '::1' }
  ];

  const generated = selfsigned.generate(attrs, {
    algorithm: 'rsa',
    keySize: 2048,
    days: 365,
    extensions: [{ name: 'subjectAltName', altNames }]
  });

  fs.writeFileSync(keyPath, generated.private, 'utf-8');
  fs.writeFileSync(certPath, generated.cert, 'utf-8');
  console.log(`[setup] Generated TLS material at ${path.relative(projectRoot, keyPath)} and ${path.relative(projectRoot, certPath)}.`);

  return { keyPath, certPath };
};

const main = async () => {
  const configPath = path.resolve(projectRoot, 'config.json');
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
      console.warn('[setup] Failed to parse config.json while ensuring certs. Falling back to defaults.');
    }
  }
  await ensureTlsCertificates(config);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('[setup] TLS certificate generation failed:', err);
    process.exit(1);
  });
}
