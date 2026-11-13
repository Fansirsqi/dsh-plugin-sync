import { cloneJson, isModelLike, sameJson } from './util.js';
import { desiredSpec } from './plan.js';

/**
 * Merge the local dependency and bundle selection into the remote manifest.
 * The remote manifest keeps its unrelated fields and its own model entries.
 */
export function mergePackageJson(local, remote, node, meta, options = {}) {
  const prune = options.prune === true;
  const runtimeMismatch = options.runtimeMismatch === true;
  const next = cloneJson(remote.pkg || {});
  next.dependencies = { ...(next.dependencies || {}) };
  next.dsh = { ...(next.dsh || {}) };
  next.dsh.profile = { ...(next.dsh.profile || {}) };

  const localDeps = local.dependencies.filter((dep) => !dep.modelLike);
  const localDepsByName = new Map(localDeps.map((dep) => [dep.name, dep]));
  const localDepNames = new Set(localDeps.map((dep) => dep.name));
  const remoteDepNames = new Set(Object.keys(next.dependencies));

  const dependencyChanges = [];
  for (const dep of localDeps) {
    const spec = desiredSpec(dep, node, meta, { runtimeMismatch });
    if (runtimeMismatch && !dep.localPath && next.dependencies[dep.name] !== undefined) continue;
    if (next.dependencies[dep.name] !== spec) {
      dependencyChanges.push({ name: dep.name, from: next.dependencies[dep.name], to: spec });
      next.dependencies[dep.name] = spec;
    }
  }
  if (prune) {
    for (const name of remoteDepNames) {
      if (isModelLike(name)) continue;
      if (localDepNames.has(name)) continue;
      delete next.dependencies[name];
      dependencyChanges.push({ name, from: remote.pkg.dependencies?.[name], to: null });
    }
  }

  const localBundles = local.bundles.filter((name) => !isModelLike(name));
  const localBundleSet = new Set(localBundles);
  const remoteBundles = Array.isArray(remote.bundles) ? remote.bundles : [];
  const modelBundles = remoteBundles.filter((name) => isModelLike(name));
  const keptForeign = prune
    ? []
    : remoteBundles.filter((name) => !isModelLike(name) && !localBundleSet.has(name) && !localDepNames.has(name));
  const bundles = [];
  for (const name of [...localBundles, ...modelBundles, ...keptForeign]) {
    if (!bundles.includes(name)) bundles.push(name);
  }
  const bundleChanges = [];
  for (const name of bundles) if (!remoteBundles.includes(name)) bundleChanges.push({ name, action: 'enable' });
  for (const name of remoteBundles) if (!bundles.includes(name)) bundleChanges.push({ name, action: 'disable' });
  next.dsh.profile.bundles = bundles;

  return {
    pkg: next,
    changed: !sameJson(next, remote.pkg),
    dependencyChanges,
    bundleChanges,
    text: JSON.stringify(next, null, 2) + '\n',
  };
}
