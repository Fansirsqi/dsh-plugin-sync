import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { execFileSync } from 'node:child_process';
import { computePlan } from '../lib/plan.js';
import { emptyStore, loadStore, saveStore, storePath } from '../lib/store.js';

const legacy = '@linxin666/dsh-agents';
const official = '@deepseek-ai/dsh-experimental-agent-team-profile';
const packageText = JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [legacy, official] } } }, null, 2) + '\n';
const patchText = '- id: agent-team\n  config:\n    maxMembers: 8\n';

async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'dsh-sync-regression-'));
  t.after(async () => {
    assert.equal(dirname(root), tmpdir());
    assert.ok(basename(root).startsWith('dsh-sync-regression-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const profileDir = join(root, 'profiles', 'web');
  await fs.mkdir(profileDir, { recursive: true });
  await fs.mkdir(join(root, 'dsh-agents'));
  await fs.writeFile(join(profileDir, 'package.json'), packageText);
  await fs.writeFile(join(profileDir, 'cordis.patch.yml'), patchText);
  await fs.writeFile(join(root, 'dsh-agents', 'ledger.json'), 'invalid stale ledger');
  return { root, profileDir };
}

test('cold YAML load uses the plugin dependency without a profile parser', async (t) => {
  const { profileDir } = await fixture(t);
  const source = `
    import assert from 'node:assert/strict';
    import { loadYaml, parsePatchDocument, patchRows } from ${JSON.stringify(new URL('../lib/yaml.js', import.meta.url).href)};
    const YAML = await loadYaml(process.argv[1]);
    const rows = patchRows(parsePatchDocument(YAML, '- id: cold-parser\\n'), YAML).rows;
    assert.equal(rows[0].id, 'cold-parser');
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', source, profileDir], {
    cwd: profileDir,
    env: { ...process.env, DSH_PROFILE_DIR: profileDir },
    stdio: 'pipe',
  });
});

test('stale syncTeams settings are stripped on load and ignored by option updates', async (t) => {
  const { root, profileDir } = await fixture(t);
  const { SyncService } = await import('../lib/service.js');
  assert.equal(Object.hasOwn(emptyStore().options, 'syncTeams'), false);
  for (const syncTeams of [true, false]) {
    const store = emptyStore();
    store.options = { ...store.options, syncTeams, readSshConfig: false, prune: true };
    await saveStore(store, root);
    const loaded = await loadStore(root);
    assert.equal(Object.hasOwn(loaded.options, 'syncTeams'), false);
    assert.equal(loaded.options.prune, true);
    const service = new SyncService({ dshHome: root, profileDir, profile: 'web' });
    const options = await service.setOptions({ syncTeams, includeSecrets: false });
    assert.equal(Object.hasOwn(options, 'syncTeams'), false);
    assert.equal(options.includeSecrets, false);
    const saved = JSON.parse(await fs.readFile(storePath(root), 'utf8'));
    assert.equal(Object.hasOwn(saved.options, 'syncTeams'), false);
  }
});

test('plan ignores stale team data and options even in mirror mode', () => {
  const snapshot = { dependencies: [], bundles: [legacy, official], rows: [], modelRowIds: [], meta: { DSH_BIN: '/bin/dsh' } };
  const local = { ...snapshot, ledgerExists: true, teams: [{ name: 'local', members: [{ model: 'private' }] }] };
  const remote = { ...snapshot, ledgerCorrupt: true, teams: [{ name: 'remote' }] };
  for (const syncTeams of [true, false]) {
    const plan = computePlan(local, remote, {}, { prune: true, syncTeams });
    assert.equal(plan.changeCount, 0);
    assert.deepEqual(plan.warnings, []);
    assert.equal(Object.hasOwn(plan.options, 'syncTeams'), false);
    assert.equal(Object.hasOwn(plan.changes, 'teams'), false);
    assert.equal(Object.hasOwn(plan.remote, 'hasAgentsPackage'), false);
  }
});

// Substitute only SSH transport. Snapshot, merge, apply, verification and backup
// run normally against temporary profiles; no network connection is possible.
const transport = { calls: [], files: { PACKAGE: packageText, PATCH: patchText.replace('maxMembers: 8', 'maxMembers: 4') } };
globalThis.__pluginSyncTestTransport = transport;
const sshUrl = new URL('../lib/ssh.js', import.meta.url).href;
const fakeSsh = `
  const state = globalThis.__pluginSyncTestTransport;
  export async function readRemoteFiles(node, specs) {
    state.calls.push({ operation: 'read', specs });
    return { files: { ...state.files }, meta: { PROFILE_EXISTS: 'yes', DSH_BIN: '/bin/dsh', HOME_DIR: '/remote' } };
  }
  export async function runRemote(node, script) {
    state.calls.push({ operation: 'command', script });
    return { code: 0, stdout: '', stderr: '' };
  }
  export async function writeRemoteFile(node, path, text) {
    state.calls.push({ operation: 'write', path });
    if (path.endsWith('/package.json')) state.files.PACKAGE = text;
    if (path.endsWith('/cordis.patch.yml')) state.files.PATCH = text;
  }
  export async function backupRemoteFile(node, path) { state.calls.push({ operation: 'backup', path }); return true; }
  export async function copyDirectory() { throw new Error('Unexpected bundle copy'); }
  export async function installRemoteProfile() { throw new Error('Unexpected dependency install'); }
  export async function installBundleDependencies() { throw new Error('Unexpected bundle install'); }
  export function remotePathExpr(path) { return JSON.stringify(path); }
`;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && new URL(specifier, context.parentURL).href === sshUrl) {
      return { url: 'data:text/javascript,' + encodeURIComponent(fakeSsh), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

test('snapshot, status, apply and backups never read or write a team ledger', async (t) => {
  const { root, profileDir } = await fixture(t);
  const { SyncService } = await import('../lib/service.js');
  const { readLocalSnapshot, readRemoteSnapshot } = await import('../lib/snapshot.js');
  const { createTools } = await import('../lib/tools.js');
  const ledgerPath = join(root, 'dsh-agents', 'ledger.json');
  const originalReadFile = fs.readFile;
  const originalWriteFile = fs.writeFile;
  t.mock.method(fs, 'readFile', (path, ...args) => {
    assert.ok(!String(path).includes('ledger'), 'must not read a ledger: ' + path);
    return originalReadFile(path, ...args);
  });
  t.mock.method(fs, 'writeFile', (path, ...args) => {
    assert.ok(!String(path).includes('ledger'), 'must not write a ledger: ' + path);
    return originalWriteFile(path, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); hook.deregister(); delete globalThis.__pluginSyncTestTransport; });
  const store = emptyStore();
  store.options = { ...store.options, syncTeams: true, readSshConfig: false };
  store.nodes = [{ id: 'fixture', name: 'fixture', host: 'never-connect.invalid', dshHome: '/remote/.dsh', profile: 'web' }];
  await saveStore(store, root);
  const service = new SyncService({ dshHome: root, profileDir, profile: 'web' });
  const local = await readLocalSnapshot({ dshHome: root, profileDir, profile: 'web' });
  const remote = await readRemoteSnapshot(store.nodes[0], { localProfileDir: profileDir });
  for (const snapshot of [local, remote]) {
    assert.equal(snapshot.rows[0].id, 'agent-team');
    for (const key of ['teams', 'teamCount', 'memberCount', 'ledger', 'ledgerPath', 'ledgerExists', 'ledgerCorrupt', 'ledgerRawText', 'hasAgentsPackage']) {
      assert.equal(Object.hasOwn(snapshot, key), false, key);
    }
  }
  const state = await service.state();
  for (const key of ['teams', 'members', 'legacyTeamsEnabled', 'ledgerPath']) assert.equal(Object.hasOwn(state.local, key), false);
  const result = await service.apply('fixture', { force: true, prune: true, syncTeams: true });
  assert.equal(result.ok, true);
  assert.equal(result.verification.ok, true);
  assert.equal(Object.hasOwn(result.applied, 'teams'), false);
  assert.deepEqual(result.applied.patch.updated, ['agent-team']);
  assert.match(transport.files.PATCH, /maxMembers: 8/);
  assert.ok(transport.calls.some((call) => call.operation === 'write' && call.path.endsWith('/cordis.patch.yml')));
  const backup = await service.backup('fixture');
  assert.deepEqual((await fs.readdir(backup.localDir)).sort(), ['cordis.patch.yml', 'manifest.json', 'package.json']);
  const manifest = JSON.parse(await fs.readFile(join(backup.localDir, 'manifest.json'), 'utf8'));
  assert.equal(Object.hasOwn(manifest, 'teams'), false);
  assert.equal(await originalReadFile(ledgerPath, 'utf8'), 'invalid stale ledger');
  assert.ok(transport.calls.some((call) => call.operation === 'read'));
  assert.ok(transport.calls.some((call) => call.operation === 'command'));
  assert.doesNotMatch(JSON.stringify(transport.calls), /ledger|dsh-agents\/|AGENTS_PKG/);
  const history = (await loadStore(root)).history;
  assert.ok(history.some((entry) => entry.plan));
  assert.doesNotMatch(JSON.stringify(history), /syncTeams|teamsAdd|teamsUpdate|teamsRemove|sync-teams/);
  const tools = createTools(service);
  assert.equal(Object.hasOwn(tools.find((tool) => tool.name === 'plugin_sync_apply').parameters.properties, 'syncTeams'), false);
  assert.doesNotMatch(JSON.stringify(tools), /团队|账本|syncTeams/);
});
