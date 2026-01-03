import net from 'net';
import fs from 'fs';

export async function checkTor() {
  const ports = [9050, 9150, 9051]; // Common SOCKS and Control ports
  const sockets = ['/var/run/tor/control'];
  
  const portProbes = ports.map(port => probePort(port));
  const socketProbes = sockets.map(path => probeSocket(path));
  
  const results = await Promise.all([...portProbes, ...socketProbes]);
  
  const isRunning = results.some(r => r.open);
  
  return {
    running: isRunning,
    details: results,
    recommendation: isRunning ? null : "Tor doesn't seem to be reachable on common ports or sockets. Ensure Tor is installed and running."
  };
}

function probeSocket(path) {
  return new Promise((resolve) => {
    fs.access(path, fs.constants.F_OK | fs.constants.R_OK, (err) => {
        resolve({ path, open: !err });
    });
  });
}

function probePort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 1000;

    socket.setTimeout(timeout);
    socket.once('error', () => {
      socket.destroy();
      resolve({ port, open: false });
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve({ port, open: false });
    });
    socket.connect(port, host, () => {
      socket.end();
      resolve({ port, open: true });
    });
  });
}
