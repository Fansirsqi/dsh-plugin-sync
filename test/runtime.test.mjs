import test from 'node:test';
import assert from 'node:assert/strict';
import { desiredSpec, isOfficialDshPackage } from '../lib/plan.js';
import { mergePackageJson } from '../lib/merge.js';

const node = { dshHome: '~/.dsh' };
const meta = { DSH_VER: '0.2.1-rc.5', HOME_DIR: '/home/test' };

test('recognizes official DSH packages', () => {
  assert.equal(isOfficialDshPackage('@deepseek-ai/dsh-subagent-codex'), true);
  assert.equal(isOfficialDshPackage('@linxin666/dsh-agents'), false);
});

test('official package spec follows the remote runtime on mismatch', () => {
  const dep = { name: '@deepseek-ai/dsh-subagent-codex', version: '0.2.2-rc.1', spec: '0.2.2-rc.1' };
  assert.equal(desiredSpec(dep, node, meta, { runtimeMismatch: true }), '0.2.1-rc.5');
  assert.equal(desiredSpec(dep, node, meta, { runtimeMismatch: false }), '0.2.2-rc.1');
});

test('mismatched runtime keeps existing core versions and adds missing plugins', () => {
  const local = {
    dshVersion: '0.2.2-rc.1',
    dependencies: [
      { name: '@deepseek-ai/dsh-subagent-codex', version: '0.2.2-rc.1', spec: '0.2.2-rc.1' },
      { name: '@linxin666/dsh-agents', version: '0.4.14', spec: '0.4.14' },
    ],
    bundles: [],
  };
  const remote = {
    pkg: {
      dependencies: { '@deepseek-ai/dsh-subagent-codex': '0.2.1-rc.5' },
      dsh: { profile: { bundles: [] } },
    },
    meta,
    bundles: [],
  };
  const merged = mergePackageJson(local, remote, node, meta, { prune: true, runtimeMismatch: true });
  assert.equal(merged.pkg.dependencies['@deepseek-ai/dsh-subagent-codex'], '0.2.1-rc.5');
  assert.equal(merged.pkg.dependencies['@linxin666/dsh-agents'], '0.4.14');
  assert.deepEqual(merged.dependencyChanges.map((change) => change.name), ['@linxin666/dsh-agents']);
});
