// test/ncc06.test.js
import { strict as assert } from 'assert';
import { test, before, beforeEach, after, describe } from 'node:test';
import { startRelay, stopRelay, queryRelay, RELAY_CONSTANTS } from './helpers.js';
import { spawn } from 'child_process';
import path from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const sidecarConfigPath = path.resolve(projectRoot, 'sidecar/config.json');
const sidecarConfig = JSON.parse(readFileSync(sidecarConfigPath, 'utf-8'));
const SERVICE_PUBKEY = sidecarConfig.servicePk;
const SERVICE_ID = sidecarConfig.serviceId;
const LOCATOR_ID = sidecarConfig.locatorId;
const NCC02_EXPECTED_KEY = sidecarConfig.ncc02ExpectedKey;

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

describe('NCC-06 Relay, Sidecar, Client Integration Tests', () => {
  let originalSidecarConfigContent;
  let originalClientConfigContent;

  before(async () => {
    console.log('Storing original config files...');
    originalSidecarConfigContent = readFileSync(sidecarConfigPath, 'utf-8');
    originalClientConfigContent = readFileSync(path.resolve(projectRoot, 'client/config.json'), 'utf-8');

    console.log('Starting relay for tests...');
    await startRelay();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Give relay a moment to fully start up
    console.log('Relay started.');
  });

  beforeEach(async () => {
    console.log('Resetting config files to original state for new test...');
    await new Promise(resolve => setTimeout(resolve, 50));
    writeFileSync(sidecarConfigPath, originalSidecarConfigContent);
    await new Promise(resolve => setTimeout(resolve, 50));
    writeFileSync(path.resolve(projectRoot, 'client/config.json'), originalClientConfigContent);
    // Give file system a moment to catch up
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  after(async () => {
    console.log('Stopping relay...');
    stopRelay();
    console.log('Relay stopped.');
  });

  test('1. Relay stores and serves NCC-02 Service Record (30059) via #d filter', async () => {
    console.log('Running sidecar to publish events...');
    await runScript('sidecar/index.js');
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
    console.log('Test 1 passed.');
  });

  test('2. Relay stores and serves NCC-05 Locator (30058) and client prefers it when fresh', async () => {
    // Sidecar already ran in test 1, so events should be in the relay
    // Now run the client, which should prefer NCC-05 if fresh
    const clientOutput = await runScript('client/index.js');
    console.log('Client Output:', clientOutput);

    assert.ok(clientOutput.includes('Fresh NCC-05 locator found.'), 'Client should prefer fresh NCC-05');
    assert.ok(clientOutput.includes('Service endpoint resolved to: wss://127.0.0.1:7447'), 'Client should resolve to NCC-05 endpoint');
    assert.ok(clientOutput.includes('REQ roundtrip successful'), 'Client should successfully perform REQ roundtrip');
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
    await runScript('sidecar/index.js');
    await new Promise(resolve => setTimeout(resolve, 500)); // Give relay time to process

    // Run client, expecting fallback
    console.log('Running client, expecting fallback to NCC-02...');
    const clientOutput = await runScript('client/index.js');
    console.log('Client Output:', clientOutput);

    assert.ok(clientOutput.includes('NCC-05 locator found but it is expired or not fresh.'), 'Client should detect expired NCC-05');
    assert.ok(clientOutput.includes('Falling back to NCC-02 URL: wss://127.0.0.1:7447'), 'Client should fall back to NCC-02 URL');
    assert.ok(clientOutput.includes('REQ roundtrip successful'), 'Client should successfully perform REQ roundtrip with fallback');

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
    await runScript('sidecar/index.js');
    await new Promise(resolve => setTimeout(resolve, 500)); // Give relay time to process

    // Run client, expecting rejection due to 'k' mismatch
    console.log('Running client, expecting WSS endpoint rejection due to `k` mismatch...');
    let clientOutput = '';
    let clientError = null;
    try {
      clientOutput = await runScript('client/index.js');
    } catch (e) {
      clientError = e;
      clientOutput = e.message; // Capture output from error
    }
    console.log('Client Output:', clientOutput);
    
    assert.ok(
      clientOutput.includes('K mismatch for WSS endpoint. Expected: TESTKEY:relay-local-dev-1, Got: MISMATCHED_KEY. Rejecting.'),
      'Client should report K mismatch for WSS endpoint'
    );
    assert.ok(
      clientOutput.includes('Falling back to NCC-02 URL: wss://127.0.0.1:7447'),
      'Client should fall back to NCC-02 URL'
    );
    assert.ok(
      clientOutput.includes("WSS endpoint from NCC-02 fallback missing or mismatched 'k' value. Expected: TESTKEY:relay-local-dev-1, Got: MISMATCHED_KEY. Rejecting fallback."),
      'Client should reject fallback wss endpoint when k mismatch persists'
    );
    assert.ok(
      clientOutput.includes('Failed to resolve service endpoint.'),
      'Client should stop after untrusted endpoints'
    );
    
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

    console.log('Test 5 passed.');
  });

  test('6. Relay emits EOSE for REQ', async () => {
    const filters = [{ kinds: [1] }]; // Request some common kind
    const events = await queryRelay(filters); // queryRelay already waits for EOSE

    assert.ok(true, 'queryRelay successfully completed, implying EOSE was received.');
    console.log('Test 6 passed.');
  });
});
