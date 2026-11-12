import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSshConfig, hostAliases, mergeSshConfig } from '../lib/ssh-config.js';

const local = [
  'Host fedora',
  '    HostName 192.0.2.10',
  '    User fansir',
  '    IdentityFile ~/.ssh/id_ed25519',
  '',
  'Host dev',
  '    HostName 198.51.100.20',
  '    Port 41987',
  '    User root',
  '',
].join('\n');

const remote = [
  'Host cachyos',
  '    HostName 192.0.2.11',
  '    User fansir',
  '',
  'Host fedora',
  '    HostName 203.0.113.20',
  '    User old',
  '',
].join('\n');

test('parses Host aliases and settings', () => {
  const parsed = parseSshConfig(local);
  assert.deepEqual(hostAliases(parsed), ['fedora', 'dev']);
  assert.equal(parsed.blocks[0].patterns[0], 'fedora');
});

test('keeps remote-only blocks and adds local-only blocks', () => {
  const merged = mergeSshConfig(local, remote, { prune: false });
  assert.deepEqual(merged.changes.added, ['dev']);
  assert.deepEqual(merged.changes.updated, ['fedora']);
  assert.ok(merged.text.includes('Host cachyos'));
  assert.ok(merged.text.includes('Host dev'));
  assert.ok(merged.text.includes('HostName 192.0.2.10'));
  assert.ok(!merged.text.includes('HostName 203.0.113.20'));
});

test('prune removes remote-only Host blocks', () => {
  const merged = mergeSshConfig(local, remote, { prune: true });
  assert.deepEqual(merged.changes.removed, ['cachyos']);
  assert.ok(!merged.text.includes('Host cachyos'));
  assert.ok(merged.text.includes('Host fedora'));
});

test('empty remote copies the local file', () => {
  const merged = mergeSshConfig(local, '', {});
  assert.deepEqual(merged.changes.added, ['fedora', 'dev']);
  assert.equal(merged.text, local.replace(/\n+$/, '') + '\n');
});

test('empty local leaves the remote alone', () => {
  const merged = mergeSshConfig('', remote, {});
  assert.equal(merged.text, remote.replace(/\n+$/, '') + '\n');
  assert.ok(merged.warnings.length > 0);
});
