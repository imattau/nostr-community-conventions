import net from 'net';

export async function checkTor() {
  const ports = [9050, 9150, 9051]; // Common SOCKS and Control ports
  const results = await Promise.all(ports.map(port => probePort(port)));
  
  const isRunning = results.some(r => r.open);
  
  return {
    running: isRunning,
    details: results,
    recommendation: isRunning ? null : "Tor doesn't seem to be reachable on common ports (9050, 9051, 9150). If you want to offer onion services, please ensure Tor is installed and running."
  };
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
