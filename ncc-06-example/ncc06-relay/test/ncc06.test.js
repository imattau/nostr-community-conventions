// test/ncc06.test.js
import { strict as assert } from 'assert';
import { test, before, beforeEach, after, describe } from 'node:test';
import { resolveServiceEndpoint } from '../ncc06-client/index.js';
import { startRelay, stopRelay, queryRelay, startAuxRelay, stopAuxRelay, publishEventToRelay, AUX_RELAY_URL } from './helpers.js';
import WebSocket from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { spawn } from 'child_process';
import path from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { NCC05Publisher } from 'ncc-05';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const rootConfig = JSON.parse(readFileSync(path.resolve(projectRoot, 'config.json'), 'utf-8'));

const sidecarConfigPath = path.resolve(projectRoot, 'ncc06-sidecar/config.json');
const clientConfigPath = path.resolve(projectRoot, 'ncc06-client/config.json');
const sidecarConfig = JSON.parse(readFileSync(sidecarConfigPath, 'utf-8'));
const SERVICE_PUBKEY = sidecarConfig.servicePk;
const SERVICE_ID = sidecarConfig.serviceId;
const PUBLICATION_RELAY_LIST = [sidecarConfig.relayUrl, AUX_RELAY_URL];

let originalSidecarConfigContent = '';
let originalClientConfigContent = '';
let baselineExpectedKey = 'TESTKEY:relay-local-dev-1';

const getPublicationOverrides = () => ({
  sidecar: {
    ...JSON.parse(originalSidecarConfigContent || ''),
    publicationRelays: PUBLICATION_RELAY_LIST
  },
  client: {
    ...JSON.parse(originalClientConfigContent || ''),
    publicationRelays: PUBLICATION_RELAY_LIST
  }
});

class DummyPublisherPool {
  publish(relays, event) {
    return relays.map(() => Promise.resolve(event));
  }
  close() {}
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const restoreBaselineConfigs = async () => {
  await delay(50);
  writeFileSync(sidecarConfigPath, originalSidecarConfigContent);
  await delay(50);
  writeFileSync(clientConfigPath, originalClientConfigContent);
  await delay(100);
  const overrides = getPublicationOverrides();
  writeFileSync(sidecarConfigPath, JSON.stringify(overrides.sidecar, null, 2));
  writeFileSync(clientConfigPath, JSON.stringify(overrides.client, null, 2));
};

// Helper to run sidecar or client
const runScript = (scriptPath, args = []) => {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [scriptPath, ...args], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => {
      stdout += data.toString();
      // process.stdout.write(`[Script STDOUT] ${data}`);
    });
    proc.stderr.on('data', data => {
      stderr += data.toString();
      // process.stderr.write(`[Script STDERR] ${data}`);
    });

    proc.on('close', code => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Script ${scriptPath} exited with code ${code}.\nStdout:\n${stdout}\nStderr:\n${stderr}`));
      }
    });

    proc.on('error', err => {
      reject(new Error(`Failed to start script ${scriptPath}: ${err.message}`));
    });
  });
};

const SUITE_START = Date.now();
const TOTAL_INTEGRATION_TESTS = 12;
let integrationPassCount = 0;

describe('NCC-06 Relay, Sidecar, Client Integration Tests', () => {

before(async () => {
  console.log('Storing original config files...');
  originalSidecarConfigContent = readFileSync(sidecarConfigPath, 'utf-8');
  originalClientConfigContent = readFileSync(clientConfigPath, 'utf-8');
  const parsedSidecar = JSON.parse(originalSidecarConfigContent);
  if (parsedSidecar.ncc02ExpectedKey) {
    baselineExpectedKey = parsedSidecar.ncc02ExpectedKey;
  }

    console.log('Starting relay for tests...');
    await startRelay();
    await startAuxRelay();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Give relay a moment to fully start up
    console.log('Relay started.');
  });

  beforeEach(async () => {
    console.log('Resetting config files to original state for new test...');
    await restoreBaselineConfigs();
  });

  after(async () => {
    console.log('Stopping relay...');
    stopRelay();
    stopAuxRelay();
    console.log('Relay stopped.');
  });

  test('1. Relay stores and serves NCC-02 Service Record (30059) via #d filter', async () => {
    console.log('Running sidecar to publish events...');
    await runScript('ncc06-sidecar/index.js');
    await new Promise(resolve => setTimeout(resolve, 500)); // Give relay time to process

    const filters = [{
      kinds: [30059],
      authors: [SERVICE_PUBKEY],
      "#d": [SERVICE_ID]
    }];
    const events = await queryRelay(filters);

    assert.ok(events.length > 0, 'Should find at least one NCC-02 event');
    const ncc02Event = events.find(e => e.kind === 30059);
    assert.ok(ncc02Event, 'Should find a NCC-02 event');
    assert.equal(ncc02Event.pubkey, SERVICE_PUBKEY, 'NCC-02 event pubkey should match sidecar');
    assert.ok(ncc02Event.tags.some(tag => tag[0] === 'd' && tag[1] === SERVICE_ID), 'NCC-02 event should have #d tag');
    integrationPassCount += 1;
    console.log('Test 1 passed.');
  });

  test('2. Relay stores and serves NCC-05 Locator (30058) and client prefers it when fresh', async () => {
    // Sidecar already ran in test 1, so events should be in the relay
    // Now run the client, which should prefer NCC-05 if fresh
    const clientOutput = await runScript('ncc06-client/index.js');
    console.log('Client Output:', clientOutput);

    assert.ok(clientOutput.includes('Fresh NCC-05 locator found.'), 'Client should prefer fresh NCC-05');
    assert.ok(clientOutput.includes('Service endpoint resolved to: wss://127.0.0.1:7447'), 'Client should resolve to NCC-05 endpoint');
    assert.ok(clientOutput.includes('REQ roundtrip successful'), 'Client should successfully perform REQ roundtrip');
    integrationPassCount += 1;
    console.log('Test 2 passed.');
  });

  test('3. When NCC-05 TTL is expired, client falls back to NCC-02 `u`', async () => {
    // Modify sidecar config to publish an expired NCC-05
    const currentSidecarConfig = JSON.parse(originalSidecarConfigContent);
    const modifiedSidecarConfig = {
        ...currentSidecarConfig,
        ncc05TtlSeconds: -10 // Make it expired
    };
    
    console.log('Overwriting sidecar config for expired NCC-05 test...');
    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay for file system ops
    writeFileSync(sidecarConfigPath, JSON.stringify(modifiedSidecarConfig, null, 2));

    // Re-publish events with expired NCC-05
    console.log('Re-running sidecar to publish expired NCC-05...');
    await runScript('ncc06-sidecar/index.js');
    await new Promise(resolve => setTimeout(resolve, 500)); // Give relay time to process

    // Run client, expecting fallback
    console.log('Running client, expecting fallback to NCC-02...');
    const clientOutput = await runScript('ncc06-client/index.js');
    console.log('Client Output:', clientOutput);

    assert.ok(clientOutput.includes('Falling back to NCC-02 URL: wss://127.0.0.1:7447'), 'Client should fall back to NCC-02 URL');
    assert.ok(clientOutput.includes('REQ roundtrip successful'), 'Client should successfully perform REQ roundtrip with fallback');

    integrationPassCount += 1;
    console.log('Test 3 passed.');
  });

  test('4. Client rejects wss endpoint if `k` missing or mismatched (use test placeholder)', async () => {
    // This test requires modifying the NCC-05 published by the sidecar to remove/mismatch 'k'
    const currentSidecarConfig = JSON.parse(originalSidecarConfigContent);
    const modifiedSidecarConfig = {
        ...currentSidecarConfig,
        ncc02ExpectedKey: "MISMATCHED_KEY" // Mismatched key for the NCC-05 wss endpoint
    };

    console.log('Overwriting sidecar config for mismatched `k` test...');
    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay for file system ops
    writeFileSync(sidecarConfigPath, JSON.stringify(modifiedSidecarConfig, null, 2));

    // Re-publish events with mismatched 'k'
    console.log('Re-running sidecar to publish NCC-05 with mismatched `k`...');
    await runScript('ncc06-sidecar/index.js');
    await new Promise(resolve => setTimeout(resolve, 500)); // Give relay time to process

    // Run client, expecting rejection due to 'k' mismatch
    console.log('Running client, expecting WSS endpoint rejection due to `k` mismatch...');
    let clientOutput = '';
    try {
      clientOutput = await runScript('ncc06-client/index.js');
    } catch (e) {
      clientOutput = e.message; // Capture output from error
    }
    console.log('Client Output:', clientOutput);
    
    assert.ok(
      clientOutput.includes(`K mismatch for NCC-05 WSS endpoint (expected ${baselineExpectedKey} but got MISMATCHED_KEY). Rejecting.`),
      'Client should report K mismatch for NCC-05 WSS endpoint'
    );
    assert.ok(
      clientOutput.includes('Falling back to NCC-02 URL: wss://127.0.0.1:7447'),
      'Client should fall back to NCC-02 URL'
    );
    assert.ok(
      clientOutput.includes(`NCC-02 fallback WSS endpoint 'k' mismatch (expected ${baselineExpectedKey}, got MISMATCHED_KEY).`),
      'Client should reject fallback wss endpoint when k mismatch persists'
    );
    assert.ok(
      clientOutput.includes('Failed to resolve service endpoint.'),
      'Client should stop after untrusted endpoints'
    );
    
    integrationPassCount += 1;
    console.log('Test 4 passed.');
  });

  test('5. Relay stores and serves attestation (30060) and revocation (30061) by #e filter', async () => {
    const serviceFilters = [{
      kinds: [30059],
      authors: [SERVICE_PUBKEY],
      "#d": [SERVICE_ID]
    }];
    const serviceEvents = await queryRelay(serviceFilters);
    assert.ok(serviceEvents.length > 0, 'Should find at least one NCC-02 event for reference');
    const latestServiceEvent = serviceEvents[0];

    const attestationFilters = [{
      kinds: [30060],
      authors: [SERVICE_PUBKEY],
      "#e": [latestServiceEvent.id]
    }];
    const attestationEvents = await queryRelay(attestationFilters);
    assert.ok(attestationEvents.length > 0, 'Should find at least one attestation event referencing the service record');
    const attestationEvent = attestationEvents.find(e => e.tags.some(tag => tag[0] === 'e' && tag[1] === latestServiceEvent.id));
    assert.ok(attestationEvent, 'Should find an attestation referencing the service record');

    const revocationFilters = [{
      kinds: [30061],
      authors: [SERVICE_PUBKEY],
      "#e": [attestationEvent.id]
    }];
    const revocationEvents = await queryRelay(revocationFilters);
    assert.ok(revocationEvents.length > 0, 'Should find at least one revocation event referencing the attestation');
    const revocationEvent = revocationEvents.find(e => e.tags.some(tag => tag[0] === 'e' && tag[1] === attestationEvent.id));
    assert.ok(revocationEvent, 'Should find a revocation referencing the attestation');

    integrationPassCount += 1;
    console.log('Test 5 passed.');
  });

  test('6. Relay emits EOSE for REQ', async () => {
    const filters = [{ kinds: [1] }]; // Request some common kind
    await queryRelay(filters); // queryRelay already waits for EOSE

    assert.ok(true, 'queryRelay successfully completed, implying EOSE was received.');
    integrationPassCount += 1;
    console.log('Test 6 passed.');
  });

  test('7. Client prefers the newest NCC-02 candidate from publication relays', async () => {
    console.log('Running sidecar to prepare events for multi-relay resolution test...');
    await runScript('ncc06-sidecar/index.js');
    await new Promise(resolve => setTimeout(resolve, 500));

    const customEndpoint = 'wss://127.0.0.1:7449';
    const now = Math.floor(Date.now() / 1000);
    const customServiceEvent = finalizeEvent({
      kind: 30059,
      created_at: now + 10,
      pubkey: sidecarConfig.servicePk,
      tags: [
        ['d', SERVICE_ID],
        ['u', customEndpoint],
        ['k', sidecarConfig.ncc02ExpectedKey],
        ['exp', (now + 86400).toString()]
      ],
      content: ''
    }, sidecarConfig.serviceSk);

    await publishEventToRelay(AUX_RELAY_URL, customServiceEvent);
    const clientOutput = await runScript('ncc06-client/index.js');
    assert.ok(
      clientOutput.includes(customEndpoint),
      'Client should select the auxiliary relay NCC-02 service record'
    );
    integrationPassCount += 1;
    console.log('Test 7 passed.');

    await runScript('ncc06-sidecar/index.js');
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  test('8. Client publishes a note after resolving the service', async () => {
    try {
      await restoreBaselineConfigs();
      console.log('Running sidecar to ensure events are available for the note test...');
      await runScript('ncc06-sidecar/index.js');
      await new Promise(resolve => setTimeout(resolve, 500)); // give the relay time to store events

      const endpointUrl = await resolveServiceEndpoint();
      assert.ok(endpointUrl, 'Client should resolve a concrete service endpoint');
      console.log(`Resolved endpoint for note test: ${endpointUrl}`);

      const noteSk = generateSecretKey();
      const notePk = getPublicKey(noteSk);
      const noteEvent = finalizeEvent({
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: notePk,
        tags: [['p', SERVICE_PUBKEY]],
        content: 'integration test note'
      }, noteSk);

      const wsOptions = endpointUrl.startsWith('wss://') ? { rejectUnauthorized: false } : {};
      const ws = new WebSocket(endpointUrl, wsOptions);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for relay OK')), 3000);
        ws.on('open', () => {
          ws.send(JSON.stringify(['EVENT', noteEvent]));
        });
        ws.on('message', data => {
          try {
            const messageText = typeof data === 'string' ? data : data.toString();
            const message = JSON.parse(messageText);
            if (message[0] === 'OK' && message[1] === noteEvent.id) {
              clearTimeout(timeout);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
        ws.once('error', reject);
      });

      ws.close();

      const storedNotes = await queryRelay([{ ids: [noteEvent.id] }]);
      assert.ok(storedNotes.some(event => event.id === noteEvent.id), 'Relay should have stored the note event');
      integrationPassCount += 1;
      console.log('Test 8 passed.');
    } catch (err) {
      console.error('Note publish test failed:', err);
      throw err;
    }
  });

  test('9. Client prefers an onion endpoint when torPreferred is true', async () => {
    console.log('Preparing onion-preference edge case...');
    await runScript('ncc06-sidecar/index.js');
    await new Promise(resolve => setTimeout(resolve, 500));

    const onionUrl = 'ws://example-edge-case.onion:9001';
    const now = Math.floor(Date.now() / 1000);
    const locatorPayload = {
      ttl: 3600,
      updated_at: now,
      endpoints: [
        {
          url: onionUrl,
          protocol: 'ws',
          family: 'onion',
          priority: 1
        },
        {
          url: rootConfig.relayWssUrl,
          protocol: 'wss',
          family: 'ipv4',
          priority: 2,
          k: sidecarConfig.ncc02ExpectedKey
        }
      ]
    };
    const locatorEvent = finalizeEvent({
      kind: 30058,
      pubkey: SERVICE_PUBKEY,
      created_at: now + 5,
      tags: [
        ['d', sidecarConfig.locatorId],
        ['expiration', (now + 3600).toString()]
      ],
      content: JSON.stringify(locatorPayload)
    }, sidecarConfig.serviceSk);

    await publishEventToRelay(sidecarConfig.relayUrl, locatorEvent);
    await publishEventToRelay(AUX_RELAY_URL, locatorEvent);

    const clientConfigState = JSON.parse(readFileSync(clientConfigPath, 'utf-8'));
    clientConfigState.torPreferred = true;
    writeFileSync(clientConfigPath, JSON.stringify(clientConfigState, null, 2));

    const clientOutput = await runScript('ncc06-client/index.js');
    assert.ok(
      clientOutput.includes(`${onionUrl} (ws/onion)`),
      'Client should favor the onion endpoint when torPreferred is enabled'
    );
    integrationPassCount += 1;
    console.log('Test 9 passed.');
  });

  test('10. Client accepts rotated NCC-02 fingerprint when config is updated', async () => {
    console.log('Preparing NCC-02 fingerprint rotation edge case...');
    await runScript('ncc06-sidecar/index.js');
    await new Promise(resolve => setTimeout(resolve, 500));

    const rotatedKey = 'TESTKEY:relay-rotated-edgecase';
    const now = Math.floor(Date.now() / 1000);
    const rotatedServiceEvent = finalizeEvent({
      kind: 30059,
      pubkey: SERVICE_PUBKEY,
      created_at: now + 5,
      tags: [
        ['d', SERVICE_ID],
        ['u', rootConfig.relayWssUrl],
        ['k', rotatedKey],
        ['exp', (now + 86400).toString()]
      ],
      content: ''
    }, sidecarConfig.serviceSk);

    await publishEventToRelay(sidecarConfig.relayUrl, rotatedServiceEvent);
    await publishEventToRelay(AUX_RELAY_URL, rotatedServiceEvent);

    const clientConfigState = JSON.parse(readFileSync(clientConfigPath, 'utf-8'));
    clientConfigState.ncc02ExpectedKey = rotatedKey;
    writeFileSync(clientConfigPath, JSON.stringify(clientConfigState, null, 2));

    const clientOutput = await runScript('ncc06-client/index.js');
    assert.ok(
      clientOutput.includes(rotatedKey),
      'Client should select the NCC-02 service record with the rotated fingerprint'
    );
    integrationPassCount += 1;
    console.log('Test 10 passed.');
  });

  test('11. Multiple clients resolve concurrently', async () => {
    console.log('Preparing concurrent resolver scenario...');
    await runScript('ncc06-sidecar/index.js');
    await delay(500);

    await Promise.all([
      runScript('ncc06-client/index.js'),
      runScript('ncc06-client/index.js')
    ]);

    integrationPassCount += 1;
    console.log('Test 11 passed.');
  });

  test('12. Client resolves group-wrapped NCC-05 locators', async () => {
    console.log('Publishing group-wrapped locator for resolver test...');
    await runScript('ncc06-sidecar/index.js');
    await delay(500);

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      ttl: 3600,
      updated_at: now,
      endpoints: [{
        url: 'wss://group-wrapped.example:7447',
        protocol: 'wss',
        priority: 1,
        k: sidecarConfig.ncc02ExpectedKey
      }]
    };
    const currentClientConfig = JSON.parse(readFileSync(clientConfigPath, 'utf-8'));
    const recipients = [
      currentClientConfig.locatorFriendPubkey,
      getPublicKey(generateSecretKey())
    ];

    const publisher = new NCC05Publisher({
      pool: new DummyPublisherPool(),
      timeout: 1000
    });
    const wrappedEvent = await publisher.publishWrapped(
      [sidecarConfig.relayUrl],
      sidecarConfig.serviceSk,
      recipients,
      payload,
      sidecarConfig.locatorId
    );
    publisher.close();

    await publishEventToRelay(sidecarConfig.relayUrl, wrappedEvent);
    await publishEventToRelay(AUX_RELAY_URL, wrappedEvent);
    await delay(500);

    const clientOutput = await runScript('ncc06-client/index.js');
    assert.ok(
      clientOutput.includes('wss://group-wrapped.example:7447'),
      'Client should resolve the group-wrapped endpoint'
    );
    integrationPassCount += 1;
    console.log('Test 12 passed.');
  });

  after(() => {
    const durationMs = Date.now() - SUITE_START;
    console.log(`[Integration Summary] tests run: ${TOTAL_INTEGRATION_TESTS}, passed: ${integrationPassCount}, failed: ${TOTAL_INTEGRATION_TESTS - integrationPassCount}, duration: ${durationMs}ms`);
  });
});
