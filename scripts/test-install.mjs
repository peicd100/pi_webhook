import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { host, fromHost } from '../tests/runtime.mjs';

// CLI Git operations are real; personal settings/auth and real POSTs are never used.
const remote = process.argv.includes('--remote');
const root = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'pi webhook 安裝 '));
const fixture = join(temp, 'source'), agent = join(temp, 'agent'), cwd = join(temp, 'work');
for (const path of [fixture, agent, cwd]) mkdirSync(path);
const repoURL = remote ? 'https://github.com/peicd100/pi_webhook.git' : 'https://example.invalid/pi/webhook.git';
const branchSource = remote ? 'git:github.com/peicd100/pi_webhook' : 'git:' + repoURL;
const tagSource = branchSource + '@v1.0.3';
const installParts = remote ? ['github.com', 'peicd100', 'pi_webhook'] : ['example.invalid', 'pi', 'webhook'];
const installed = join(agent, 'git', ...installParts);
const env = { ...process.env, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1',
  GIT_CONFIG_COUNT: remote ? '0' : '1', GIT_CONFIG_KEY_0: `url.${pathToFileURL(fixture).href.replace(/\/$/, '')}.insteadOf`, GIT_CONFIG_VALUE_0: repoURL,
  GIT_CONFIG_GLOBAL: join(temp, 'empty-gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
  npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
delete env.PI_SESSION_FILE;
writeFileSync(env.GIT_CONFIG_GLOBAL, '');
writeFileSync(join(agent, 'settings.json'), JSON.stringify({ npmCommand: ['npm'] }));
const hostPackage = JSON.parse(readFileSync(join(host, 'package.json')));
const cli = join(host, typeof hostPackage.bin === 'string' ? hostPackage.bin : hostPackage.bin.pi);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const settings = () => JSON.parse(readFileSync(join(agent, 'settings.json')));
function copyTree(source, target) {
  if (statSync(source).isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const item of readdirSync(source)) copyTree(join(source, item), join(target, item));
  } else writeFileSync(target, readFileSync(source));
}
function run(command, args, directory = cwd, overrides = {}) {
  const result = spawnSync(command, args, { cwd: directory, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
// Pi deliberately skips package updates in offline mode. Permit only this
// explicit update command in the disposable agent; other invocations stay offline.
const pi = args => run(process.execPath, [cli, ...args], cwd, args[0] === 'update' ? { PI_OFFLINE: '0' } : {});
const declared = source => (settings().packages ?? []).some(p => (typeof p === 'string' ? p : p.source) === source);
async function loadStatus() {
  assert(!existsSync(join(installed, 'node_modules/@earendil-works/pi-coding-agent')), 'Host must not be bundled');
  assert(!existsSync(join(installed, 'node_modules/@earendil-works/pi-tui')), 'TUI host must not be bundled');
  const pkg = JSON.parse(readFileSync(join(installed, 'package.json')));
  assert.equal(pkg.version, '1.0.3');
  const { loadExtensions } = await fromHost('dist/core/extensions/loader.js');
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  try {
    const loaded = await loadExtensions(pkg.pi.extensions.map(p => join(installed, p)), cwd);
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 1);
    assert.deepEqual([...loaded.extensions[0].commands.keys()], ['webhook','webhook-status','webhook-setup','webhook-test','webhook-on','webhook-off','webhook-events','webhook-clear']);
    assert.equal(loaded.extensions[0].tools.size, 0);
    const notices = [];
    // Read-only status only: never setup, test, enabled writes or session lifecycle.
    await loaded.extensions[0].commands.get('webhook-status').handler('', { mode: 'sdk', ui: { notify: text => notices.push(text) } });
    const status = JSON.parse(notices.at(-1));
    assert.equal(status.loaded_version, '1.0.3');
    return status;
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
}
let passed = false;
try {
  if (!remote) {
    for (const path of ['package.json', 'package-lock.json', '.gitattributes', 'extensions', 'src', 'README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE.md', 'docs']) copyTree(join(root, path), join(fixture, path));
    run('git', ['init', '--quiet', '--initial-branch=main'], fixture);
    run('git', ['add', '.'], fixture);
    run('git', ['-c', 'user.name=Webhook install fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Disposable install fixture'], fixture);
    run('git', ['tag', 'v1.0.3'], fixture);
  }
  pi(['install', tagSource]);
  assert(declared(tagSource));
  assert(pi(['list']).includes(installParts[0]));
  const tagHead = run('git', ['rev-parse', 'HEAD'], installed).trim();
  assert.equal(run('git', ['describe', '--tags', '--exact-match'], installed).trim(), 'v1.0.3');
  assert.equal((await loadStatus()).configured, false);
  pi(['update', tagSource]);
  assert.equal(run('git', ['rev-parse', 'HEAD'], installed).trim(), tagHead, 'Pinned tag must not move');

  // Dummy disabled store and receipt are retained across source updates/removal.
  const store = join(agent, 'config/webhook-notifier'), id = 'a'.repeat(64);
  mkdirSync(join(store, 'events', id), { recursive: true, mode: 0o700 });
  const configPath = join(store, 'config.json'), receiptPath = join(store, 'events', id, 'receipt.json');
  writeFileSync(configPath, JSON.stringify({ version: 1, enabled: false, url: 'https://notify.example.invalid/fixture', key: 'dummy-test-only', format: 'generic', notifyOn: ['completed'] }), { mode: 0o600 });
  writeFileSync(receiptPath, JSON.stringify({ notification_id: id, state: 'UNKNOWN', started_at: '2020-01-01T00:00:00Z', test: true }), { mode: 0o600 });
  const configHash = hash(readFileSync(configPath)), receiptHash = hash(readFileSync(receiptPath));
  const retained = () => { assert.equal(hash(readFileSync(configPath)), configHash); assert.equal(hash(readFileSync(receiptPath)), receiptHash); };
  assert.equal((await loadStatus()).enabled, false);
  pi(['remove', tagSource]);
  assert(!declared(tagSource)); assert(!existsSync(installed)); retained();

  pi(['install', branchSource]);
  assert(declared(branchSource));
  const beforeUpdate = run('git', ['rev-parse', 'HEAD'], installed).trim();
  if (!remote) {
    writeFileSync(join(fixture, 'README.md'), readFileSync(join(fixture, 'README.md'), 'utf8') + '\nDisposable update fixture.\n');
    run('git', ['-c', 'user.name=Webhook install fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-am', 'Advance disposable branch'], fixture);
  }
  pi(['update', branchSource]);
  const afterUpdate = run('git', ['rev-parse', 'HEAD'], installed).trim();
  if (!remote) {
    assert.notEqual(afterUpdate, beforeUpdate, 'Branch update must genuinely advance');
    assert.equal(afterUpdate, run('git', ['rev-parse', 'HEAD'], fixture).trim());
  } else {
    const remoteHead = run('git', ['ls-remote', repoURL, 'HEAD']).trim().split(/\s+/)[0];
    assert.equal(afterUpdate, remoteHead, 'Branch update must match public remote HEAD');
  }
  const status = await loadStatus();
  assert.equal(status.configured, true); assert.equal(status.enabled, false);
  assert.equal(status.receipts[0].state, 'UNKNOWN'); retained();
  pi(['remove', branchSource]);
  assert(!declared(branchSource)); assert(!existsSync(installed)); retained();
  passed = true;
  console.log(`PASS: ${remote ? 'public GitHub' : 'local fixture'} Pi tag/branch install/list/load/update/remove; tag HEAD=${tagHead}; branch HEAD=${afterUpdate}; store retained; space/non-ASCII path; no host bundling, providers or real POSTs`);
} finally {
  if (passed) rmSync(temp, { recursive: true, force: true });
  else console.error('Failed installation fixture preserved at:', temp);
}
