import { checkTor } from './src/tor-check.js';

checkTor().then(res => {
  console.log('Tor Status:', res);
}).catch(console.error);
