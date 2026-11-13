import { join } from 'node:path';
import { readJson, ensureDir, timestamp, cloneJson, isModelLike } from './util.js';
import { loadStore, saveStore, upsertNode, removeNode, recordHistory, listSshHosts } from './store.js';
import { readLocalSnapshot, readRemoteSnapshot } from './snapshot.js';
import { computePlan, desiredSpec, remoteSyncBase } from './plan.js';
import { mergePackageJson } from './merge.js';
import { mergePatchDocument } from './yaml.js';
import { readLocalSshConfig, hostAliases } from './ssh-config.js';
import { runRemote, writeRemoteFile, backupRemoteFile, copyDirectory, installRemoteProfile, installBundleDependencies, remotePathExpr } from './ssh.js';

/** A refusal this plugin decided, with a stable code for the API. */
export class SyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
  }
}

/** The host half: snapshot, plan, apply, backup, and node inventory. */
export class SyncService {
  constructor(options = {}) {
    this.dshHome = options.dshHome;
    this.profileDir = options.profileDir;
    this.profile = options.profile;
    this.jobs = new Map();
    this.locks = new Set();
  }

  /** Progress for one running node, if any. */
  jobOf(nodeId) {
    return this.jobs.get(nodeId);
  }

  /** All running jobs. */
  activeJobs() {
    return [...this.jobs.values()];
  }

  progress(nodeId, phase, message) {
    const current = this.jobs.get(nodeId) || { nodeId, startedAt: Date.now() };
    this.jobs.set(nodeId, { ...current, phase, message, updatedAt: Date.now() });
  }

  /** Read everything the settings page needs on first paint. */
  async state() {
    const store = await loadStore(this.dshHome);
    let local;
    try {
      local = await readLocalSnapshot({ dshHome: this.dshHome, profileDir: this.profileDir, profile: this.profile, skipHashes: true });
    } catch (error) {
      local = { error: error.message, dependencies: [], bundles: [], rows: [] };
    }
    const sshConfig = store.options.readSshConfig !== false
      ? await readLocalSshConfig().catch(() => undefined)
      : undefined;
    return {
      ok: true,
      profile: this.profile,
      profileDir: this.profileDir,
      dshHome: this.dshHome,
      options: store.options,
      nodes: store.nodes,
      sshHosts: await listSshHosts(this.dshHome),
      sshConfigHosts: sshConfig ? hostAliases(sshConfig) : [],
      sshConfigPath: sshConfig?.path,
      sshConfigExists: sshConfig?.exists,
      history: store.history.slice().reverse().slice(0, 20),
      jobs: this.activeJobs(),
      local: {
        error: local.error,
        packages: local.dependencies?.length ?? 0,
        selectedBundles: local.bundles?.length ?? 0,
        configRows: local.rows?.length ?? 0,
        modelRows: local.modelRowIds?.length ?? 0,
      },
    };
  }

  /** Update the persisted sync options. */
  async setOptions(patch) {
    const store = await loadStore(this.dshHome);
    store.options = { ...store.options, ...sanitizeOptions(patch) };
    await saveStore(store, this.dshHome);
    return store.options;
  }

  /** Add or update a node. */
  async saveNode(input) {
    const store = await loadStore(this.dshHome);
    if (!input || typeof input.name !== 'string' || input.name.trim() === '') throw new SyncError('invalid-request', '节点名称不能为空');
    if (!input.sshAlias && !input.sshHost && !input.host) throw new SyncError('invalid-request', '节点必须选择一个 SSH 主机或填写主机地址');
    const node = upsertNode(store, input);
    await saveStore(store, this.dshHome);
    return node;
  }

  /** Remove a node. */
  async deleteNode(id) {
    const store = await loadStore(this.dshHome);
    const node = removeNode(store, id);
    if (!node) throw new SyncError('not-found', '节点不存在');
    await saveStore(store, this.dshHome);
    return node;
  }

  /** Compute a plan against one node. */
  async plan(nodeId, options = {}) {
    const store = await loadStore(this.dshHome);
    const node = store.nodes.find((item) => item.id === nodeId);
    if (!node) throw new SyncError('not-found', '节点不存在');
    const merged = { ...store.options, ...sanitizeOptions(options) };
    const local = await readLocalSnapshot({ dshHome: this.dshHome, profileDir: this.profileDir, profile: this.profile });
    const remote = await readRemoteSnapshot(node, { signal: options.signal, localProfileDir: this.profileDir, bundleSpecs: bundleSpecsFor(local, node) });
    return computePlan(local, remote, node, merged);
  }

  /** Apply the local state to one node. */
  async apply(nodeId, options = {}) {
    if (this.locks.has(nodeId)) throw new SyncError('busy', '该节点正在同步，请等待当前任务结束');
    this.locks.add(nodeId);
    const startedAt = Date.now();
    const store = await loadStore(this.dshHome);
    const node = store.nodes.find((item) => item.id === nodeId);
    if (!node) {
      this.locks.delete(nodeId);
      throw new SyncError('not-found', '节点不存在');
    }
    const merged = { ...store.options, ...sanitizeOptions(options) };
    const record = { id: nodeId, nodeName: node.name, startedAt, phases: [], ok: false, options: merged };
    const phase = (name, message) => {
      this.progress(nodeId, name, message);
      record.phases.push({ phase: name, message, at: Date.now() });
    };
    try {
      phase('read-local', '读取本机插件与配置');
      const local = await readLocalSnapshot({ dshHome: this.dshHome, profileDir: this.profileDir, profile: this.profile });

      phase('read-remote', '连接 ' + node.name + ' 并读取远端状态');
      const remote = await readRemoteSnapshot(node, { signal: options.signal, localProfileDir: this.profileDir, bundleSpecs: bundleSpecsFor(local, node) });
      const plan = computePlan(local, remote, node, merged);
      const runtimeMismatch = plan.runtimeMismatch === true;
      record.plan = planForHistory(plan);
      if (plan.changeCount === 0 && options.force !== true) {
        phase('done', plan.summary);
        record.ok = true;
        record.changed = false;
        record.summary = plan.summary;
        record.durationMs = Date.now() - startedAt;
        recordHistory(store, record);
        await saveStore(store, this.dshHome);
        return { ok: true, changed: false, plan, applied: [], warnings: plan.warnings };
      }
      if (!remote.meta?.DSH_BIN) {
        throw new SyncError('dsh-missing', '远端未找到 dsh 命令，请先在 ' + node.name + ' 安装 DeepSeek Harness');
      }
      const stamp = timestamp();
      if (merged.backupBeforeSync) {
        phase('backup-remote', '备份远端配置');
        record.remoteBackup = await this.backupRemote(node, remote, stamp, options);
      }

      const mergeLocal = localForMerge(local, remote, merged);
      const applied = { uploadedBundles: [], installed: false, patch: undefined, packageJson: undefined };

      phase('upload-bundles', '上传本地目录插件');
      for (const upload of plan.changes.localBundleUploads) {
        if (merged.copyLocalBundles === false) continue;
        const dep = local.dependencies.find((item) => item.name === upload.name);
        if (!dep?.localPath) continue;
        const target = remoteSyncBase(node, remote.meta) + '/plugin-sync/bundles/' + slugName(dep.name);
        await copyDirectory(node, dep.localPath, target, { signal: options.signal });
        await writeRemoteFile(node, target + '/.dsh-plugin-sync.json', JSON.stringify({
          name: dep.name,
          version: dep.version,
          hash: dep.fingerprint,
          syncedAt: Date.now(),
        }, null, 2) + '\n', { signal: options.signal });
        const bundlePkg = await readJson(join(dep.localPath, 'package.json')).catch(() => undefined);
        if (merged.installLocalDeps !== false && bundlePkg && Object.keys(bundlePkg.dependencies || {}).length > 0) {
          const result = await installBundleDependencies(node, target, { signal: options.signal });
          if (result.code !== 0) record.phases.push({ phase: 'upload-bundles', message: '本地插件依赖安装失败（可稍后手动处理）：' + dep.name, at: Date.now() });
        }
        applied.uploadedBundles.push({ name: dep.name, target });
      }

      phase('install-dependencies', '安装远端缺失或版本不一致的插件');
      const stage = buildDependencyStage(mergeLocal, remote, node, remote.meta, { runtimeMismatch });
      if (stage.text !== remote.packageText) {
        const pkgBackup = await backupRemoteFile(node, remote.profileDir + '/package.json', stamp, { signal: options.signal });
        const lockBackup = await backupRemoteFile(node, remote.profileDir + '/pnpm-lock.yaml', stamp, { signal: options.signal });
        await writeRemoteFile(node, remote.profileDir + '/package.json', stage.text, { signal: options.signal });
        try {
          await installRemoteProfile(node, { signal: options.signal });
        } catch (error) {
          await restoreRemoteFile(node, remote.profileDir + '/package.json', pkgBackup ? '.bak-' + stamp : undefined, options);
          await restoreRemoteFile(node, remote.profileDir + '/pnpm-lock.yaml', lockBackup ? '.bak-' + stamp : undefined, options);
          throw new SyncError('install-failed', error.message + '（已恢复 package.json 与锁文件）');
        }
        applied.installed = true;
      }

      phase('apply-config', '合并插件配置与开关');
      const patchResult = mergePatchDocument(local.YAML, remote.patchDoc, local.patchDoc, { prune: merged.prune, includeSecrets: merged.includeSecrets });
      if (patchResult.changes.added.length + patchResult.changes.updated.length + patchResult.changes.removed.length > 0) {
        await backupRemoteFile(node, remote.profileDir + '/cordis.patch.yml', stamp, { signal: options.signal });
        const text = remote.patchDoc.toString({ lineWidth: 0, minContentWidth: 0 });
        await writeRemoteFile(node, remote.profileDir + '/cordis.patch.yml', text.endsWith('\n') ? text : text + '\n', { signal: options.signal });
        applied.patch = patchResult.changes;
      } else {
        applied.patch = patchResult.changes;
      }

      phase('apply-selection', '同步插件启用状态');
      const finalMerge = mergePackageJson(mergeLocal, remote, node, remote.meta, { prune: merged.prune, runtimeMismatch });
      if (finalMerge.text !== remote.packageText && finalMerge.text !== stage.text) {
        const finalPkgBackup = await backupRemoteFile(node, remote.profileDir + '/package.json', stamp, { signal: options.signal });
        const finalLockBackup = await backupRemoteFile(node, remote.profileDir + '/pnpm-lock.yaml', stamp, { signal: options.signal });
        await writeRemoteFile(node, remote.profileDir + '/package.json', finalMerge.text, { signal: options.signal });
        applied.packageJson = { dependencies: finalMerge.dependencyChanges, bundles: finalMerge.bundleChanges };
        if (finalMerge.dependencyChanges.some((change) => change.to === null) || merged.prune) {
          try {
            await installRemoteProfile(node, { signal: options.signal });
          } catch (error) {
            await restoreRemoteFile(node, remote.profileDir + '/package.json', finalPkgBackup ? '.bak-' + stamp : undefined, options);
            await restoreRemoteFile(node, remote.profileDir + '/pnpm-lock.yaml', finalLockBackup ? '.bak-' + stamp : undefined, options);
            throw new SyncError('install-failed', error.message + '（已恢复 package.json 与锁文件）');
          }
        }
      } else {
        applied.packageJson = { dependencies: finalMerge.dependencyChanges, bundles: finalMerge.bundleChanges };
      }

      if (merged.restartRemote && node.restartCommand) {
        phase('restart', '重启远端 dsh');
        await runRemote(node, node.restartCommand, { timeoutMs: 120000, signal: options.signal });
      }

      phase('verify', '校验同步结果');
      const after = await readRemoteSnapshot(node, { signal: options.signal, localProfileDir: this.profileDir, bundleSpecs: bundleSpecsFor(mergeLocal, node) });
      const verify = verifyRemote(mergeLocal, after);
      record.verification = verify;
      phase('done', verify.ok ? '同步完成' : '同步完成，但有 ' + verify.issues.length + ' 项校验提示');
      record.ok = true;
      record.changed = true;
      record.summary = plan.summary;
      record.durationMs = Date.now() - startedAt;
      recordHistory(store, record);
      await saveStore(store, this.dshHome);
      return {
        ok: true,
        changed: true,
        plan,
        applied,
        verification: verify,
        warnings: [...plan.warnings, ...verify.issues],
        durationMs: record.durationMs,
      };
    } catch (error) {
      record.ok = false;
      record.error = error.message;
      record.durationMs = Date.now() - startedAt;
      recordHistory(store, record);
      await saveStore(store, this.dshHome).catch(() => {});
      if (error instanceof SyncError) throw error;
      throw new SyncError('sync-failed', error.message);
    } finally {
      this.jobs.delete(nodeId);
      this.locks.delete(nodeId);
    }
  }

  /** Copy the remote profile files into a timestamped backup directory. */
  async backupRemote(node, remote, stamp, options = {}) {
    const base = remoteSyncBase(node, remote.meta) + '/plugin-sync/backups/' + stamp;
    const paths = [remote.profileDir + '/package.json', remote.profileDir + '/pnpm-lock.yaml', remote.profileDir + '/cordis.patch.yml'];
    const quoted = paths.map((path) => remotePathExpr(path));
    const script = 'B=' + quoteRemote(base) + '; mkdir -p "$B" && for f in ' + quoted.join(' ') + '; do if [ -f "$f" ]; then cp -p "$f" "$B"/$(basename "$f"); fi; done; echo "$B"';
    const result = await runRemote(node, script, { timeoutMs: 60000, signal: options.signal });
    if (result.code !== 0) throw new Error('远端备份失败：' + (result.stderr || '').trim().slice(-2000));
    return base;
  }

  /** Write a local backup of everything this plugin syncs. */
  async backup(nodeId) {
    const store = await loadStore(this.dshHome);
    const local = await readLocalSnapshot({ dshHome: this.dshHome, profileDir: this.profileDir, profile: this.profile });
    const stamp = timestamp();
    const dir = join(this.dshHome, 'plugin-sync', 'backups', stamp, 'local');
    await ensureDir(dir);
    const fs = await import('node:fs/promises');
    await fs.writeFile(join(dir, 'package.json'), local.packageText, { mode: 0o600 });
    await fs.writeFile(join(dir, 'cordis.patch.yml'), local.patchText, { mode: 0o600 });
    await fs.writeFile(join(dir, 'manifest.json'), JSON.stringify({
      createdAt: Date.now(),
      profile: this.profile,
      profileDir: this.profileDir,
      dshHome: this.dshHome,
      packages: local.dependencies.map((dep) => ({ name: dep.name, version: dep.version, spec: dep.spec })),
      bundles: local.bundles,
    }, null, 2) + '\n', { mode: 0o600 });
    let remoteBackup;
    if (nodeId) {
      const node = store.nodes.find((item) => item.id === nodeId);
      if (node) {
        const remote = await readRemoteSnapshot(node, { localProfileDir: this.profileDir, bundleSpecs: bundleSpecsFor(local, node) });
        remoteBackup = await this.backupRemote(node, remote, stamp, {});
      }
    }
    recordHistory(store, { id: 'backup', nodeName: nodeId || 'local', startedAt: Date.now(), ok: true, summary: '备份 ' + stamp, durationMs: 0 });
    await saveStore(store, this.dshHome);
    return { ok: true, localDir: dir, remoteBackup, stamp };
  }

  /** Clear the sync history without touching nodes or options. */
  async clearHistory() {
    const store = await loadStore(this.dshHome);
    const cleared = store.history.length;
    store.history = [];
    await saveStore(store, this.dshHome);
    return { ok: true, cleared };
  }

  /** Quick reachability probe used by the settings page. */
  async probe(nodeId) {
    const store = await loadStore(this.dshHome);
    const node = store.nodes.find((item) => item.id === nodeId);
    if (!node) throw new SyncError('not-found', '节点不存在');
    const startedAt = Date.now();
    try {
      const remote = await readRemoteSnapshot(node, { localProfileDir: this.profileDir });
      return { ok: true, dshVersion: remote.meta?.DSH_VER, profileDir: remote.profileDir, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { ok: false, error: error.message, latencyMs: Date.now() - startedAt };
    }
  }
}

/** Drop local bundles that are not uploaded and absent remotely. */
function localForMerge(local, remote, options) {
  if (options.copyLocalBundles !== false) return local;
  const remoteNames = new Set(remote.dependencies.map((dep) => dep.name));
  const skipped = new Set(local.dependencies.filter((dep) => dep.localPath && !remoteNames.has(dep.name)).map((dep) => dep.name));
  if (skipped.size === 0) return local;
  return {
    ...local,
    dependencies: local.dependencies.filter((dep) => !skipped.has(dep.name)),
    bundles: local.bundles.filter((name) => !skipped.has(name)),
  };
}

/** The remote manifest paths whose fingerprints decide whether a local bundle changed. */
function bundleSpecsFor(local, node) {
  const base = String(node.dshHome || '~/.dsh').replace(/\/+$/, '');
  return local.dependencies
    .filter((dep) => !dep.modelLike && dep.localPath)
    .map((dep) => ({ name: dep.name, path: base + '/plugin-sync/bundles/' + slugName(dep.name) }));
}

/** Restore a file from its sibling timestamped backup. */
async function restoreRemoteFile(node, path, suffix, options = {}) {
  if (!suffix) return;
  await runRemote(node, 'cp -p ' + remotePathExpr(path + suffix) + ' ' + remotePathExpr(path), { timeoutMs: 30000, signal: options.signal }).catch(() => {});
}

function buildDependencyStage(local, remote, node, meta, options = {}) {
  const next = cloneJson(remote.pkg || {});
  next.dependencies = { ...(next.dependencies || {}) };
  const runtimeMismatch = options.runtimeMismatch === true;
  for (const dep of local.dependencies.filter((item) => !item.modelLike)) {
    if (runtimeMismatch && !dep.localPath && next.dependencies[dep.name] !== undefined) continue;
    next.dependencies[dep.name] = desiredSpec(dep, node, meta, { runtimeMismatch });
  }
  return { pkg: next, text: JSON.stringify(next, null, 2) + '\n' };
}

function planForHistory(plan) {
  const changes = plan?.changes || {};
  return {
    summary: plan?.summary,
    changeCount: plan?.changeCount,
    localDshVersion: plan?.localDshVersion,
    remoteDshVersion: plan?.remote?.dshVersion,
    runtimeMismatch: plan?.runtimeMismatch === true,
    keptRuntimeVersions: plan?.changes?.keptRuntimeVersions || [],
    warnings: plan?.warnings || [],
    changes: {
      install: (changes.pluginsToInstall || []).map((item) => item.name),
      remove: (changes.pluginsToRemove || []).map((item) => item.name),
      enable: changes.bundlesToEnable || [],
      disable: changes.bundlesToDisable || [],
      patchAdd: changes.patchRowsToAdd || [],
      patchUpdate: changes.patchRowsToUpdate || [],
      patchRemove: changes.patchRowsToRemove || [],
      uploads: (changes.localBundleUploads || []).map((item) => item.name),
    },
  };
}

function verifyRemote(local, remote) {
  const issues = [];
  const runtimeMismatch = Boolean(local.dshVersion && remote.meta?.DSH_VER && local.dshVersion !== remote.meta.DSH_VER);
  const remoteDeps = new Map(remote.dependencies.map((dep) => [dep.name, dep]));
  for (const name of local.bundles.filter((item) => !isModelLike(item))) {
    if (!remote.bundles.includes(name)) issues.push('插件未启用：' + name);
  }
  for (const dep of local.dependencies.filter((item) => !item.modelLike)) {
    const found = remoteDeps.get(dep.name);
    if (!found) {
      issues.push('插件未出现在远端清单：' + dep.name);
      continue;
    }
    if (dep.version && found.version && dep.version !== found.version) {
      if (runtimeMismatch && !dep.localPath) continue;
      issues.push('插件版本不一致：' + dep.name + '（本机 ' + dep.version + '，远端 ' + found.version + '）');
    }
  }
  const remoteRows = new Map(remote.rows.map((row) => [row.id, row]));
  for (const row of local.rows.filter((item) => !isModelRowValue(item))) {
    if (!remoteRows.has(row.id)) issues.push('配置行缺失：' + row.id);
  }
  return { ok: issues.length === 0, issues: issues.slice(0, 30) };
}

function isModelRowValue(row) {
  return isModelLike(row?.id) || isModelLike(row?.value?.name);
}

function sanitizeOptions(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of ['prune', 'readSshConfig', 'includeSecrets', 'installLocalDeps', 'backupBeforeSync', 'copyLocalBundles', 'restartRemote']) {
    if (typeof input[key] === 'boolean') out[key] = input[key];
  }
  return out;
}

function slugName(value) {
  return String(value).replace(/^@/, '').replace(/[^a-z0-9._-]+/gi, '-');
}

function quoteRemote(path) {
  return "'" + String(path).replace(/'/g, "'\\''") + "'";
}
