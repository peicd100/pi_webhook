import assert from 'node:assert/strict';
import { readFileSync, existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
assert.equal(pkg.name, 'pi-webhook-notifier');
assert.equal(pkg.version, '1.0.5');
assert.equal(pkg.private, true);
assert.equal(pkg.license, 'UNLICENSED');
assert(pkg.keywords.includes('pi-package'));
assert.deepEqual(pkg.pi, { extensions: ['./extensions/index.ts'], skills: [], prompts: [], themes: [] });
assert.equal(pkg.repository.url, 'https://github.com/peicd100/pi_webhook.git');
for (const name of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-tui']) {
  assert(pkg.peerDependencies[name]);
  assert(!pkg.dependencies?.[name], 'Do not bundle host packages');
  assert.equal(pkg.devDependencies[name], '1.1.0');
}
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0, 'Runtime needs only Node and host APIs');
for (const path of ['extensions/index.ts', 'src/core.mjs', 'src/core_v1.0.5.mjs', 'src/secret-ui.ts', 'README.md', 'LICENSE', 'NOTICE.md', 'CHANGELOG.md', 'docs/RELEASING.md', 'docs/VERIFICATION.md']) assert(existsSync(join(root, path)), 'Missing ' + path);
const index = readFileSync(join(root, 'extensions/index.ts'), 'utf8');
assert(index.includes("from '../src/core_v1.0.5.mjs'"));
assert(readFileSync(join(root, 'src/core.mjs'), 'utf8').includes("export * from './core_v1.0.5.mjs'"));
assert(readFileSync(join(root, 'src/core_v1.0.5.mjs'), 'utf8').includes("export const VERSION = '1.0.5'"));
const forbidden = [
  /[A-Z]:[\\/]Users[\\/]|\/(?:Users|home)\/[^/]+\/(?:\.pi|\.codex)\b/i,
  /https:\/\/(?:discord(?:app)?\.com\/api\/webhooks\/\d+\/|hooks\.slack\.com\/services\/T[A-Z0-9]+\/)/i,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
const paths = ['package.json', '.gitignore', '.gitattributes', 'README.md', 'LICENSE', 'NOTICE.md', 'CHANGELOG.md', 'extensions', 'src', 'tests', 'scripts', 'docs', '.github'];
function scan(path) {
  assert(!lstatSync(path).isSymbolicLink(), 'Do not publish links: ' + path);
  if (lstatSync(path).isDirectory()) for (const item of readdirSync(path)) scan(join(path, item));
  else {
    const bytes = readFileSync(path), text = bytes.toString('utf8');
    assert(!text.startsWith('\uFEFF'), 'UTF-8 BOM: ' + path);
    assert.equal(Buffer.from(text, 'utf8').equals(bytes), true, 'Invalid UTF-8: ' + path);
    for (const pattern of forbidden) assert(!pattern.test(text), 'Private/secret pattern in ' + path);
  }
}
for (const path of paths) scan(join(root, path));
console.log('PASS: portable manifest, immutable versioned runtime, public file patterns and no bundled host dependencies');
