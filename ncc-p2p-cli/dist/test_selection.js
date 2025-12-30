"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ncc_05_js_1 = require("ncc-05-js");
const chalk_1 = __importDefault(require("chalk"));
function runSelectionTest() {
    console.log(chalk_1.default.bold("Testing NCC-05 Endpoint Selection Logic..."));
    const endpoints = [
        { type: 'tcp', url: 'tcp://1.2.3.4', family: 'ipv4', priority: 10 },
        { type: 'tcp', url: 'tcp://[2001:db8::1]', family: 'ipv6', priority: 10 },
        { type: 'tcp', url: 'tcp://xyz.onion', family: 'onion', priority: 10 },
        // A lower priority (higher number) ipv4 should be last regardless of family
        { type: 'tcp', url: 'tcp://5.6.7.8', family: 'ipv4', priority: 20 }
    ];
    console.log(chalk_1.default.gray("Input Order: IPv4, IPv6, Onion, IPv4(LowPrio)"));
    const sorted = (0, ncc_05_js_1.selectEndpoints)(endpoints);
    console.log(chalk_1.default.bold("\nSorted Results:"));
    sorted.forEach((e, i) => {
        let color = chalk_1.default.white;
        if (e.family === 'onion')
            color = chalk_1.default.magenta;
        if (e.family === 'ipv6')
            color = chalk_1.default.cyan;
        if (e.family === 'ipv4')
            color = chalk_1.default.yellow;
        console.log(`${i + 1}. ${color(e.family)} (Prio: ${e.priority}) -> ${e.url}`);
    });
    // Assertions
    let failed = false;
    // 1. First should be Onion (Family Score 1)
    if (sorted[0].family !== 'onion') {
        console.error(chalk_1.default.red("FAIL: First endpoint is not Onion"));
        failed = true;
    }
    // 2. Second should be IPv6 (Family Score 2)
    if (sorted[1].family !== 'ipv6') {
        console.error(chalk_1.default.red("FAIL: Second endpoint is not IPv6"));
        failed = true;
    }
    // 3. Third should be IPv4 (Family Score 3)
    if (sorted[2].family !== 'ipv4') {
        console.error(chalk_1.default.red("FAIL: Third endpoint is not IPv4"));
        failed = true;
    }
    // 4. Fourth should be the Low Priority IPv4
    if (sorted[3].priority !== 20) {
        console.error(chalk_1.default.red("FAIL: Low priority endpoint did not sort last"));
        failed = true;
    }
    if (!failed) {
        console.log(chalk_1.default.green("\nSUCCESS: Endpoint selection follows NCC-05 Specification (Onion > IPv6 > IPv4)."));
    }
    else {
        process.exit(1);
    }
}
runSelectionTest();
