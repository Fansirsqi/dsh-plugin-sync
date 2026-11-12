import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSshConfig, hostAliases } from '../lib/ssh-config.js';

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

test('parses Host aliases and settings', () => {
  const parsed = parseSshConfig(local);
  assert.deepEqual(hostAliases(parsed), ['fedora', 'dev']);
  assert.equal(parsed.blocks[0].patterns[0], 'fedora');
});

test('skips wildcard aliases', () => {
  const parsed = parseSshConfig('Host *\n    ServerAliveInterval 30\nHost fedora\n    HostName 192.0.2.10\n');
  assert.deepEqual(hostAliases(parsed), ['fedora']);
});

test('keeps Include and Match findings for diagnostics', () => {
  const parsed = parseSshConfig('Include ~/.ssh/config.d/*\nHost fedora\n    HostName 192.0.2.10\nMatch host example.com\n    User root\n');
  assert.deepEqual(parsed.includes, ['~/.ssh/config.d/*']);
  assert.equal(parsed.blocks.some((block) => block.kind === 'match'), true);
});
