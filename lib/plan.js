import { slug, sameJson, isModelLike, stripMemberModelPins } from './util.js';
import { isModelRow } from './yaml.js';

/** Absolute remote base for this plugin's copied bundles. */
export function remoteSyncBase(node, meta) {
  const home = meta?.HOME_DIR || '/root';
  let base = node.dshHome || '~/.dsh';
  if (base === '~') base = home;
  else if (base.startsWith('~/')) base = home + base.slice(1);
  else if (base === '$HOME') base = home;
  else if (base.startsWith('$HOME/')) base = home + base.slice(5);
  return String(base).replace(/\/+$/, '');
}

/** Where a local bundle directory is mirrored on the node. */
export function remoteBundleDir(node, meta, packageName) {
  return remoteSyncBase(node, meta) + '/plugin-sync/bundles/' + slug(packageName);
}

/** The dependency spec to write on the remote side. */
export function desiredSpec(localDep, node, meta) {
  if (localDep.localPath) return 'link:' + remoteBundleDir(node, meta, localDep.name);
  return localDep.version || String(localDep.spec).replace(/^[\^~]/, '');
}

/** Teammate comparison shape: ids and timestamps are local bookkeeping. */
export function teamCompareShape(team) {
  return {
    name: team.name,
    description: team.description,
    workspaceId: team.workspaceId,
    leadPreset: team.leadPreset,
    members: (team.members || []).map((member) => {
      const stripped = stripMemberModelPins(member);
      return {
        name: stripped.name,
        preset: stripped.preset,
        permission: stripped.permission,
        brief: stripped.brief,
      };
    }),
  };
}

/** Build the plan for one node. */
export function computePlan(local, remote, node, options = {}) {
  const prune = options.prune === true;
  const syncTeams = options.syncTeams !== false;
  const includeSecrets = options.includeSecrets !== false;
  const copyLocalBundles = options.copyLocalBundles !== false;
  const warnings = [];
  const localDeps = local.dependencies.filter((dep) => !dep.modelLike);
  const remoteDeps = new Map(remote.dependencies.map((dep) => [dep.name, dep]));
  const localDepNames = new Set(localDeps.map((dep) => dep.name));
  const pluginsToInstall = [];
  const dependencySpecUpdates = [];
  const localBundleUploads = [];
  const pluginsToRemove = [];
  const skippedLocalBundles = new Set();

  for (const dep of localDeps) {
    const remoteDep = remoteDeps.get(dep.name);
    const spec = desiredSpec(dep, node, remote.meta);
    if (dep.localPath) {
      if (!copyLocalBundles && !remoteDep) {
        skippedLocalBundles.add(dep.name);
        continue;
      }
      const remoteManifest = remote.bundleManifests?.[dep.name];
      const needsUpload = copyLocalBundles && (
        !remoteDep ||
        String(remoteDep.spec) !== String(spec) ||
        !dep.fingerprint ||
        remoteManifest?.hash !== dep.fingerprint
      );
      if (needsUpload) localBundleUploads.push({ name: dep.name, version: dep.version, source: dep.localPath, target: spec.slice(5), fingerprint: dep.fingerprint });
      if (!remoteDep) {
        pluginsToInstall.push({ name: dep.name, from: undefined, to: dep.version, spec, source: 'local' });
      } else if (dep.version && remoteDep.version && dep.version !== remoteDep.version) {
        pluginsToInstall.push({ name: dep.name, from: remoteDep.version, to: dep.version, spec, source: 'local' });
      }
      continue;
    }
    if (!remoteDep) {
      pluginsToInstall.push({ name: dep.name, from: undefined, to: dep.version, spec, source: 'registry' });
      continue;
    }
    if (!remoteDep.version || (dep.version && remoteDep.version !== dep.version)) {
      pluginsToInstall.push({ name: dep.name, from: remoteDep.version, to: dep.version, spec, source: 'registry' });
    } else if (String(remoteDep.spec) !== String(spec)) {
      dependencySpecUpdates.push({ name: dep.name, from: remoteDep.spec, to: spec });
    }
  }

  if (prune) {
    for (const [name, dep] of remoteDeps) {
      if (isModelLike(name)) continue;
      if (!localDepNames.has(name)) pluginsToRemove.push({ name, version: dep.version });
    }
  }

  const localBundles = local.bundles.filter((name) => !isModelLike(name) && !skippedLocalBundles.has(name));
  const remoteBundles = remote.bundles.slice();
  const localBundleSet = new Set(localBundles);
  const bundlesToEnable = localBundles.filter((name) => !remoteBundles.includes(name));
  const bundlesToDisable = remoteBundles.filter((name) => {
    if (isModelLike(name) || localBundleSet.has(name)) return false;
    return prune || localDepNames.has(name);
  });

  const localRows = local.rows.filter((row) => !isModelRow(row.value));
  const remoteRows = remote.rows.filter((row) => !isModelRow(row.value));
  const localById = new Map(localRows.map((row) => [row.id, row]));
  const remoteById = new Map(remoteRows.map((row) => [row.id, row]));
  const patchRowsToAdd = localRows.filter((row) => !remoteById.has(row.id)).map((row) => row.id);
  const patchRowsToUpdate = localRows.filter((row) => remoteById.has(row.id) && !sameJson(row.value, remoteById.get(row.id).value)).map((row) => row.id);
  const patchRowsToRemove = prune ? remoteRows.filter((row) => !localById.has(row.id)).map((row) => row.id) : [];

  const teamChanges = { toAdd: [], toUpdate: [], toRemove: [] };
  if (syncTeams) {
    const localTeams = local.teams || [];
    const remoteTeams = remote.teams || [];
    const remoteByName = new Map(remoteTeams.map((team) => [team.name, team]));
    for (const team of localTeams) {
      const existing = remoteByName.get(team.name);
      if (!existing) teamChanges.toAdd.push(team.name);
      else if (!sameJson(teamCompareShape(team), teamCompareShape(existing))) teamChanges.toUpdate.push(team.name);
    }
    if (prune) {
      const localNames = new Set(localTeams.map((team) => team.name));
      for (const team of remoteTeams) if (!localNames.has(team.name)) teamChanges.toRemove.push(team.name);
    }
  }

  if (!remote.meta?.DSH_BIN) warnings.push('远端未找到 dsh 命令，安装插件前需要先在该节点安装 DeepSeek Harness。');
  if (remote.meta?.DSH_VER && local.dshVersion && remote.meta.DSH_VER !== local.dshVersion) {
    warnings.push('两端 DSH 版本不同：本机 ' + local.dshVersion + '，远端 ' + remote.meta.DSH_VER + '。');
  }
  if (syncTeams && local.teams.length > 0 && !remote.hasAgentsPackage) {
    warnings.push('远端未安装 @linxin666/dsh-agents，同步团队前需要先安装它。');
  }
  if (!includeSecrets) warnings.push('已关闭密钥同步：含 token / apiKey / password 的字段不会写入远端。');
  if (!copyLocalBundles) warnings.push('已关闭本地目录插件上传：远端没有的本地插件本次不会安装（跳过 ' + skippedLocalBundles.size + ' 个）。');
  if (!prune) {
    const keptRows = remoteRows.filter((row) => !localById.has(row.id)).length;
    if (keptRows > 0) warnings.push('远端有 ' + keptRows + ' 条本机没有的配置行，保持原样（开启“完全镜像”会删除）。');
    const keptBundles = remoteBundles.filter((name) => !localBundleSet.has(name) && !isModelLike(name)).length;
    if (keptBundles > 0) warnings.push('远端有 ' + keptBundles + ' 个本机没有启用的插件，保持原样（开启“完全镜像”会移除）。');
  }
  const skippedModel = local.rows.filter((row) => isModelRow(row.value)).length;
  if (skippedModel > 0) warnings.push('跳过 ' + skippedModel + ' 条模型相关配置（两端各自保留）。');
  if (syncTeams) {
    const pinned = (local.teams || []).reduce((sum, team) => sum + (team.members || []).filter((member) => 'model' in member || 'reasoningEffort' in member).length, 0);
    if (pinned > 0) warnings.push('本机有 ' + pinned + ' 个团队成员带模型/推理等级配置，按模型配置不同步处理，不会写入远端。');
  }

  const changeCount =
    pluginsToInstall.length +
    pluginsToRemove.length +
    dependencySpecUpdates.length +
    bundlesToEnable.length +
    bundlesToDisable.length +
    patchRowsToAdd.length +
    patchRowsToUpdate.length +
    patchRowsToRemove.length +
    teamChanges.toAdd.length +
    teamChanges.toUpdate.length +
    teamChanges.toRemove.length +
    localBundleUploads.length;

  return {
    version: 1,
    node: { id: node.id, name: node.name, sshAlias: node.sshAlias, profile: node.profile },
    remote: {
      dshVersion: remote.meta?.DSH_VER || undefined,
      profile: remote.profile,
      profileDir: remote.profileDir,
      reachable: true,
      home: remote.meta?.HOME_DIR,
      hasAgentsPackage: remote.hasAgentsPackage,
    },
    options: { prune, syncTeams, includeSecrets, copyLocalBundles },
    changes: {
      pluginsToInstall,
      pluginsToRemove,
      dependencySpecUpdates,
      localBundleUploads,
      bundlesToEnable,
      bundlesToDisable,
      patchRowsToAdd,
      patchRowsToUpdate,
      patchRowsToRemove,
      patchModelRowsPreserved: remote.modelRowIds,
      teams: teamChanges,
    },
    summary: summarize(changesSummary({ pluginsToInstall, pluginsToRemove, bundlesToEnable, bundlesToDisable, patchRowsToAdd, patchRowsToUpdate, patchRowsToRemove, teamChanges, localBundleUploads })),
    changeCount,
    warnings,
  };
}

function changesSummary(parts) {
  return [
    ['插件待安装', parts.pluginsToInstall.length],
    ['插件待移除', parts.pluginsToRemove.length],
    ['插件待启用', parts.bundlesToEnable.length],
    ['插件待停用', parts.bundlesToDisable.length],
    ['配置待新增', parts.patchRowsToAdd.length],
    ['配置待更新', parts.patchRowsToUpdate.length],
    ['配置待移除', parts.patchRowsToRemove.length],
    ['团队待新增', parts.teamChanges.toAdd.length],
    ['团队待更新', parts.teamChanges.toUpdate.length],
    ['团队待移除', parts.teamChanges.toRemove.length],
    ['本地插件待上传', parts.localBundleUploads.length],
  ];
}

function summarize(parts) {
  return parts.filter(([, count]) => count > 0).map(([label, count]) => label + ' ' + count).join('，') || '两端已一致';
}
