import { selectEndpoints, NCC05Endpoint } from 'ncc-05-js';
import chalk from 'chalk';

function runSelectionTest() {
    console.log(chalk.bold("Testing NCC-05 Endpoint Selection Logic..."));

    const endpoints: NCC05Endpoint[] = [
        { type: 'tcp', url: 'tcp://1.2.3.4', family: 'ipv4', priority: 10 },
        { type: 'tcp', url: 'tcp://[2001:db8::1]', family: 'ipv6', priority: 10 },
        { type: 'tcp', url: 'tcp://xyz.onion', family: 'onion', priority: 10 },
        // A lower priority (higher number) ipv4 should be last regardless of family
        { type: 'tcp', url: 'tcp://5.6.7.8', family: 'ipv4', priority: 20 } 
    ];

    console.log(chalk.gray("Input Order: IPv4, IPv6, Onion, IPv4(LowPrio)"));

    const sorted = selectEndpoints(endpoints);

    console.log(chalk.bold("\nSorted Results:"));
    sorted.forEach((e, i) => {
        let color = chalk.white;
        if (e.family === 'onion') color = chalk.magenta;
        if (e.family === 'ipv6') color = chalk.cyan;
        if (e.family === 'ipv4') color = chalk.yellow;
        
        console.log(`${i + 1}. ${color(e.family)} (Prio: ${e.priority}) -> ${e.url}`);
    });

    // Assertions
    let failed = false;

    // 1. First should be Onion (Family Score 1)
    if (sorted[0].family !== 'onion') {
        console.error(chalk.red("FAIL: First endpoint is not Onion"));
        failed = true;
    }

    // 2. Second should be IPv6 (Family Score 2)
    if (sorted[1].family !== 'ipv6') {
        console.error(chalk.red("FAIL: Second endpoint is not IPv6"));
        failed = true;
    }

    // 3. Third should be IPv4 (Family Score 3)
    if (sorted[2].family !== 'ipv4') {
         console.error(chalk.red("FAIL: Third endpoint is not IPv4"));
         failed = true;
    }

    // 4. Fourth should be the Low Priority IPv4
    if (sorted[3].priority !== 20) {
        console.error(chalk.red("FAIL: Low priority endpoint did not sort last"));
        failed = true;
    }

    if (!failed) {
        console.log(chalk.green("\nSUCCESS: Endpoint selection follows NCC-05 Specification (Onion > IPv6 > IPv4)."));
    } else {
        process.exit(1);
    }
}

runSelectionTest();
