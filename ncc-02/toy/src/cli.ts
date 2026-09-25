#!/usr/bin/env node
import { Command } from 'commander';
import { publishDemo } from './publish';
import { resolveCard } from './resolve';

const program = new Command();

program
  .name('toy')
  .description('NCC-02 + NCC-05 Service Card Viewer Toy')
  .version('1.0.0');

program.command('publish')
  .description('Publish NCC-02 and NCC-05 records')
  .action(async () => {
    try {
      await publishDemo();
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });

program.command('rotate-endpoint')
  .description('Rotate the private NCC-05 endpoint')
  .action(async () => {
      try {
          const newEndpoint = `https://rotated-${Date.now()}.demo.com`;
          console.log(`Rotating to ${newEndpoint}...`);
          await publishDemo(newEndpoint);
      } catch (e) {
          console.error(e);
          process.exit(1);
      }
  });

program.command('view')
  .description('View service card as a specific user')
  .requiredOption('--as <user>', 'User to resolve as (authorised|unauthorised)')
  .option('--presented-fingerprint <hex>', 'Simulate a connection handshake fingerprint')
  .action(async (options) => {
    try {
        if (options.as !== 'authorised' && options.as !== 'unauthorised') {
            throw new Error("User must be 'authorised' or 'unauthorised'");
        }
        
        const card = await resolveCard(options.as, options.presentedFingerprint);
        
        console.log("\n--- Service Card ---");
        console.log(`Service: ${card.serviceId}`);
        console.log(`Operator: ${card.operatorPubkey}`);
        
        console.log("\n[Public Trust Layer (NCC-02)]");
        if (card.publicEndpoint) {
            console.log(`  Endpoint: ${card.publicEndpoint}`);
            console.log(`  Fingerprint: ${card.fingerprint}`);
            console.log(`  Expiry: ${card.expiry}`);
        } else {
            console.log("  (No public record found)");
        }
        
        console.log("\n[Private Resolution (NCC-05)]");
        if (card.isPrivateActive) {
            console.log(`  Endpoints: ${card.privateEndpoints?.join(', ')}`);
        } else {
            console.log("  (Private endpoint not available)");
        }
        
        console.log(`\nACTIVE ENDPOINT: ${card.activeEndpoint || "NONE"}`);
        console.log(`STATUS: ${card.status}`);
        
        if (options.presentedFingerprint) {
            console.log("\n[Trust Stub]");
            console.log(`  Presented: ${options.presentedFingerprint}`);
            console.log(`  Expected:  ${card.fingerprint}`);
            if (card.fingerprint === options.presentedFingerprint) {
                console.log("  Result: PASS");
            } else {
                console.log("  Result: FAIL");
            }
        }
        
    } catch (e: any) {
        console.error("Error viewing card:", e.message);
        process.exit(1);
    }
  });

program.parse();
