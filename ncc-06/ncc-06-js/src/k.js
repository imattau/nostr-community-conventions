import crypto from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

function base64url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

function resolveConfigPath(filePath, baseDir) {
  if (!filePath) return null;
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(baseDir ?? process.cwd(), filePath);
}

/**
 * Generate an expected `k` token for NCC-02/NCC-05 pinning.
 */
export function generateExpectedK({ prefix = 'TESTKEY', label = 'ncc06', suffix } = {}) {
  const resolvedSuffix = suffix ?? randomSuffix();
  return `${prefix}:${label}-${resolvedSuffix}`;
}

/**
 * Validate the basic formatting of a `k` token.
 */
export function validateExpectedKFormat(k) {
  return typeof k === 'string' && /^[A-Z0-9_-]+:[^\s]+$/.test(k);
}

export function computeKFromCertPem(pem) {
  if (typeof pem !== 'string' && !Buffer.isBuffer(pem)) {
    throw new Error('PEM certificate is required to compute `k`');
  }
  const publicKey = crypto.createPublicKey(pem);
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const hash = crypto.createHash('sha256').update(spki).digest();
  return base64url(hash);
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function hasWssEndpoints(cfg) {
  const endpoints = cfg.externalEndpoints || {};
  const entries = ['ipv4', 'ipv6', 'onion'];
  return entries.some(key => {
    const entry = endpoints[key];
    if (!entry || entry.enabled === false) return false;
    const protocol = (entry.protocol || entry.type || 'ws').toLowerCase();
    return protocol === 'wss';
  });
}

/**
 * Determine the expected `k` value based on the sidecar k configuration.
 */
export function getExpectedK(cfg = {}, options = {}) {
  const { baseDir } = options;
  const kConfig = cfg.k || {};
  const implicitMode = hasWssEndpoints(cfg) ? 'tls_spki' : 'generate';
  const mode = kConfig.mode || implicitMode;

  switch (mode) {
    case 'static': {
      if (!kConfig.value) {
        throw new Error('k.value is required when k.mode is "static"');
      }
      return kConfig.value;
    }
    case 'generate': {
      if (!kConfig.persistPath) {
        throw new Error('k.persistPath is required when k.mode is "generate"');
      }
      const persistPath = resolveConfigPath(kConfig.persistPath, baseDir);
      if (existsSync(persistPath)) {
        return readFileSync(persistPath, 'utf-8').trim();
      }
      ensureDir(persistPath);
      const random = crypto.randomBytes(32);
      const token = base64url(random);
      writeFileSync(persistPath, token, { mode: 0o600 });
      return token;
    }
    case 'tls_spki': {
      if (!kConfig.certPath) {
        throw new Error('k.certPath is required when k.mode is "tls_spki"');
      }
      const certPath = resolveConfigPath(kConfig.certPath, baseDir);
      const pem = readFileSync(certPath, 'utf-8');
      return computeKFromCertPem(pem);
    }
    default:
      throw new Error(`Unsupported k.mode "${mode}"`);
  }
}
