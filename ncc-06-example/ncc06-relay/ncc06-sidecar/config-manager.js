import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const CONFIG_PATH = path.resolve(__dirname, 'config.json');

export function getConfigPath() {
  return CONFIG_PATH;
}

export function loadConfig() {
  const contents = readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(contents);
}

export function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function updateConfig(mutator) {
  const current = loadConfig();
  const updated = mutator({ ...current });
  saveConfig(updated);
  return updated;
}
