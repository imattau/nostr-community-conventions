#!/usr/bin/env node
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import open from "open";

const args = process.argv.slice(2);
const options = {
  port: 5179,
  host: "127.0.0.1",
  open: true
};
const extras = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--port" && args[i + 1]) {
    options.port = Number(args[++i]);
    continue;
  }
  if (arg.startsWith("--port=")) {
    options.port = Number(arg.split("=")[1]);
    continue;
  }
  if (arg === "--host" && args[i + 1]) {
    options.host = args[++i];
    continue;
  }
  if (arg.startsWith("--host=")) {
    options.host = arg.split("=")[1];
    continue;
  }
  if (arg === "--no-open") {
    options.open = false;
    continue;
  }
  extras.push(arg);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.join(__dirname, "..", "server.js");

const env = {
  ...process.env,
  PORT: String(options.port),
  HOST: options.host
};

const child = spawn(process.execPath, [serverPath, ...extras], {
  env,
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error("Failed to start NCC Manager server:", error);
  process.exit(1);
});

if (options.open) {
  const url = `http://${options.host}:${options.port}`;
  setTimeout(() => {
    open(url).catch(() => {
      console.log(`NCC Manager is running at ${url}`);
    });
  }, 500);
}

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

["SIGINT", "SIGTERM", "SIGHUP"].forEach((signal) => {
  process.on(signal, () => forwardSignal(signal));
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
