import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

// Use the project's devDependency or an explicit test host, never personal paths.
export function resolveHost() {
  if (process.env.PI_TEST_HOST) {
    const value = process.env.PI_TEST_HOST;
    const path = value.startsWith('file:') ? fileURLToPath(value) : resolve(value);
    if (!existsSync(join(path, 'dist/core/extensions/loader.js'))) throw new Error('PI_TEST_HOST must identify an installed Pi coding-agent package directory');
    return path;
  }
  try { return dirname(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')))); }
  catch { throw new Error('Pi test SDK missing. Run npm ci, or set PI_TEST_HOST. No automatic downloads or personal-directory probes.'); }
}
export const host = resolveHost();
export const fromHost = relative => import(pathToFileURL(join(host, relative)).href);
