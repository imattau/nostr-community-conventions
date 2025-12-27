import { strict as assert } from 'assert';
import { test } from 'node:test';
import {
  buildExternalEndpoints,
  detectGlobalIPv6,
  getPublicIPv4
} from '../src/external-endpoints.js';
import os from 'os';

test('buildExternalEndpoints orders endpoints and adds k when needed', async () => {
  const onion = { address: 'abc123.onion', servicePort: 80 };
  const endpoints = await buildExternalEndpoints({
    tor: { enabled: true },
    ipv6: { enabled: true, protocol: 'wss', port: 8443 },
    ipv4: { enabled: true, protocol: 'wss', address: '1.2.3.4', port: 7447 },
    wsPort: 7000,
    wssPort: 7447,
    ncc02ExpectedKey: 'TESTKEY',
    ensureOnionService: async () => onion
  });

  assert.equal(endpoints.length, 3);
  assert.equal(endpoints[0].family, 'ipv4');
  assert.equal(endpoints[1].family, 'ipv6');
  assert.equal(endpoints[2].family, 'onion');
  assert.equal(endpoints[0].k, 'TESTKEY');
});

test('detectGlobalIPv6 filters private addresses', () => {
  const original = os.networkInterfaces;
  os.networkInterfaces = () => ({
    lo: [{ address: '::1', family: 'IPv6', internal: true }],
    eth0: [
      { address: 'fe80::1', family: 'IPv6', internal: false },
      { address: 'fc00::1', family: 'IPv6', internal: false },
      { address: '2001:db8::1', family: 'IPv6', internal: false }
    ]
  });
  try {
    const addr = detectGlobalIPv6();
    assert.equal(addr, '2001:db8::1');
  } finally {
    os.networkInterfaces = original;
  }
});

test('getPublicIPv4 returns from first reachable source', async () => {
  const original = global.fetch;
  global.fetch = async (_url) => ({
    ok: true,
    text: async () => '{"ip":"5.6.7.8"}'
  });
  try {
    const ip = await getPublicIPv4({ sources: ['https://example.com'] });
    assert.equal(ip, '5.6.7.8');
  } finally {
    global.fetch = original;
  }
});
