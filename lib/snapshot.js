import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readJson, readText, isLocalPathSpec, localPathFromSpec, isModelLike, hashDirectory } from './util.js';
import { loadYaml, parsePatchDocument, patchRows } from './yaml.js';
import { readRemoteFiles } from './ssh.js';

let cachedLocalDshVersion;

/** Read the running DSH version, without depending on a shell PATH. */
async function localDshVersion() {
  if (cachedLocalDshVersion !== undefined) return cachedLocalDshVersion;
  const candidates = [];
  if (process.argv[1]) {
    candidates.push(join(dirname(process.argv[1]), '..', 'package.json'));
    candidates.push(join(dirname(process.argv[1]), 'package.json'));
  }
  for (const candidate of candidates) {
    const pkg = await readJson(candidate).catch(() => undefined);
    if (pkg?.name === '@deepseek-ai/dsh' && pkg.version) {
      cachedLocalDshVersion = String(pkg.version);
      return cachedLocalDshVersion;
    }
  }
  try {
    const output = execFileSync('dsh', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
    const match = output.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
    if (match) {
      cachedLocalDshVersion = match[0];
      return cachedLocalDshVersion;
    }
  } catch {
    // fall through: an unknown local version only disables the mismatch guard
  }
  cachedLocalDshVersion = undefined;
  return cachedLocalDshVersion;
}

/** Join a remote path without collapsing a leading ~. */
export function remoteJoin(base, ...parts) {
  return String(base).replace(/\/+$/, '') + '/' + parts.join('/');
}

/** Read the installed package.json version of one dependency. */
async function installedVersion(profileDir, name) {
  try {
    const pkg = await readJson(join(profileDir, 'node_modules', name, 'package.json'));
    return pkg?.version;
  } catch {
    return undefined;
  }
}

/** Normalize one dependency record. */
async function describeDependency(profileDir, name, spec, bundles, skipHashes) {
  const version = await installedVersion(profileDir, name);
  const localPath = isLocalPathSpec(spec) ? localPathFromSpec(spec) : undefined;
  const fingerprint = localPath && !skipHashes ? await hashDirectory(localPath).catch(() => undefined) : undefined;
  return {
    name,
    spec,
    version,
    localPath,
    fingerprint,
    modelLike: isModelLike(name),
    selected: bundles.includes(name),
  };
}

/** Read the local profile and patch. */
export async function readLocalSnapshot({ dshHome, profileDir, profile, skipHashes = false }) {
  const YAML = await loadYaml(profileDir);
  const packageText = await readText(join(profileDir, 'package.json'));
  if (packageText === undefined) throw new Error('当前 profile 缺少 package.json：' + profileDir);
  const pkg = JSON.parse(packageText);
  const patchText = await readText(join(profileDir, 'cordis.patch.yml')) ?? '[]';
  const patchDoc = parsePatchDocument(YAML, patchText);
  const rowsInfo = patchRows(patchDoc, YAML);

  const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles.slice() : [];
  const dependencies = [];
  for (const [name, spec] of Object.entries(pkg.dependencies || {})) {
    dependencies.push(await describeDependency(profileDir, name, spec, bundles, skipHashes));
  }

  const dshVersion = await localDshVersion();

  return {
    dshHome,
    profileDir,
    profile,
    dshVersion,
    packageText,
    pkg,
    bundles,
    dependencies,
    patchText,
    patchDoc,
    rows: rowsInfo.rows,
    modelRowIds: rowsInfo.modelRowIds,
    YAML,
  };
}

/** Read the remote profile, patch, and installed versions in two round trips. */
export async function readRemoteSnapshot(node, options = {}) {
  const dshHome = node.dshHome || '~/.dsh';
  const profileDir = remoteJoin(dshHome, 'profiles', node.profile || 'web');
  const baseSpecs = [
    { key: 'PACKAGE', path: remoteJoin(profileDir, 'package.json') },
    { key: 'PATCH', path: remoteJoin(profileDir, 'cordis.patch.yml') },
    { key: 'CORDIS', path: remoteJoin(profileDir, 'cordis.yml') },
    { key: 'SETTINGS', path: remoteJoin(dshHome, 'settings.yaml') },
    ...(options.bundleSpecs || []).map((bundle) => ({ key: 'BUNDLE::' + bundle.name, path: remoteJoin(bundle.path, '.dsh-plugin-sync.json') })),
  ];
  const first = await readRemoteFiles(node, baseSpecs, options);
  if (first.meta.PROFILE_EXISTS !== 'yes') {
    throw new Error('远端 profile 不存在：' + profileDir + '（' + (first.meta.HOME_DIR || '?') + '）');
  }
  let pkg;
  try {
    pkg = first.files.PACKAGE ? JSON.parse(first.files.PACKAGE) : {};
  } catch (error) {
    throw new Error('远端 package.json 解析失败：' + error.message);
  }
  const packageText = first.files.PACKAGE ?? '{}';
  const patchText = first.files.PATCH ?? '[]';
  const YAML = await loadYaml(options.localProfileDir);
  const patchDoc = parsePatchDocument(YAML, patchText);
  const rowsInfo = patchRows(patchDoc, YAML);
  const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles.slice() : [];
  const depNames = Object.keys(pkg.dependencies || {});
  let versions = {};
  if (depNames.length > 0) {
    const versionSpecs = depNames.slice(0, 80).map((name) => ({
      key: 'VER::' + name,
      path: remoteJoin(profileDir, 'node_modules', name, 'package.json'),
    }));
    const second = await readRemoteFiles(node, versionSpecs, options);
    for (const name of depNames) {
      const text = second.files['VER::' + name];
      if (!text) continue;
      try {
        versions[name] = JSON.parse(text)?.version;
      } catch {
        versions[name] = undefined;
      }
    }
  }
  const dependencies = depNames.map((name) => ({
    name,
    spec: pkg.dependencies[name],
    version: versions[name],
    localPath: undefined,
    modelLike: isModelLike(name),
    selected: bundles.includes(name),
  }));

  const bundleManifests = {};
  for (const bundle of options.bundleSpecs || []) {
    const text = first.files['BUNDLE::' + bundle.name];
    if (!text) continue;
    try {
      bundleManifests[bundle.name] = JSON.parse(text);
    } catch {
      // a corrupt manifest just means the bundle is uploaded again
    }
  }

  return {
    node,
    dshHome,
    profileDir,
    profile: node.profile || 'web',
    packageText,
    pkg,
    bundles,
    dependencies,
    patchText,
    patchDoc,
    rows: rowsInfo.rows,
    modelRowIds: rowsInfo.modelRowIds,
    bundleManifests,
    meta: first.meta,
    YAML,
  };
}
