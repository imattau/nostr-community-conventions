import { unlinkSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const files = [
  path.resolve(projectRoot, 'ncc06-sidecar/config.json'),
  path.resolve(projectRoot, 'ncc06-client/config.json')
];

for (const file of files) {
  if (existsSync(file)) {
    unlinkSync(file);
    console.log(`[setup] Removed ${path.relative(projectRoot, file)}.`);
  }
}
