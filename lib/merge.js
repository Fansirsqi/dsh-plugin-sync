import { cloneJson, isModelLike, newId, sameJson, stripMemberModelPins } from './util.js';
import { desiredSpec } from './plan.js';

/**
 * Merge the local dependency and bundle selection into the remote manifest.
 * The remote manifest keeps its unrelated fields and its own model entries.
 */
export function mergePackageJson(local, remote, node, meta, options = {}) {
  const prune = options.prune === true;
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
    const spec = desiredSpec(dep, node, meta);
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

/** Fields that define a member, excluding bookkeeping timestamps and ids. */
function memberShape(member) {
  return {
    name: member?.name,
    permission: member?.permission,
    preset: member?.preset,
    brief: member?.brief,
    workspaceId: member?.workspaceId,
  };
}

/** One member in a merged team, keeping the remote id when the names match. */
function mergeMember(member, existing, teamId, now, usedMemberIds) {
  const base = stripMemberModelPins(member);
  if (existing && sameJson(memberShape(existing), memberShape({ ...base, workspaceId: base.workspaceId }))) return existing;
  let id = existing?.id;
  if (!id) {
    const candidate = typeof member.id === 'string' && member.id ? member.id : undefined;
    id = candidate && !usedMemberIds.has(candidate) ? candidate : newId();
    usedMemberIds.add(id);
  }
  const next = {
    id,
    teamId,
    name: base.name,
    permission: base.permission,
    preset: base.preset,
    brief: base.brief,
    createdAt: existing?.createdAt || member.createdAt || now,
    updatedAt: now,
  };
  // Model pins are the one exception: never copy the local pin, and never
  // erase a pin the other side already made for its own model routes.
  if (existing?.model !== undefined) next.model = existing.model;
  if (existing?.reasoningEffort !== undefined) next.reasoningEffort = existing.reasoningEffort;
  if (base.workspaceId) next.workspaceId = base.workspaceId;
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  return next;
}

/** Merge the local team definitions into the remote ledger, preserving runs. */
export function mergeTeams(localLedger, remoteLedger, options = {}) {
  const prune = options.prune === true;
  const now = Date.now();
  const next = cloneJson(remoteLedger || {});
  if (!Array.isArray(next.teams)) next.teams = [];
  if (!Array.isArray(next.runs)) next.runs = [];
  const localTeams = Array.isArray(localLedger?.teams) ? localLedger.teams : [];
  const byName = new Map(next.teams.map((team) => [team.name, team]));
  const usedTeamIds = new Set(next.teams.map((team) => team.id));
  const usedMemberIds = new Set(next.teams.flatMap((team) => (team.members || []).map((member) => member.id)));
  const localNames = new Set(localTeams.map((team) => team.name));
  const stats = { added: [], updated: [], removed: [], membersAdded: 0, membersUpdated: 0, membersRemoved: 0 };

  for (const team of localTeams) {
    const existing = byName.get(team.name);
    if (!existing) {
      const localId = typeof team.id === 'string' && team.id ? team.id : undefined;
      const teamId = localId && !usedTeamIds.has(localId) ? localId : newId();
      usedTeamIds.add(teamId);
      const members = (team.members || []).map((member) => mergeMember(member, undefined, teamId, now, usedMemberIds));
      next.teams.push({
        id: teamId,
        name: team.name,
        description: team.description,
        workspaceId: team.workspaceId,
        leadPreset: team.leadPreset,
        createdAt: team.createdAt || now,
        updatedAt: now,
        members,
      });
      stats.added.push(team.name);
      stats.membersAdded += members.length;
      continue;
    }
    const before = JSON.stringify(existing);
    const membersByName = new Map((existing.members || []).map((member) => [member.name, member]));
    const members = [];
    for (const member of team.members || []) {
      const current = membersByName.get(member.name);
      const merged = mergeMember(member, current, existing.id, now, usedMemberIds);
      if (current && merged === current) {
        // unchanged member: no updatedAt bump
      } else if (current) stats.membersUpdated += 1;
      else stats.membersAdded += 1;
      members.push(merged);
    }
    const keptNames = new Set((team.members || []).map((member) => member.name));
    stats.membersRemoved += (existing.members || []).filter((member) => !keptNames.has(member.name)).length;
    existing.description = team.description;
    existing.workspaceId = team.workspaceId;
    existing.leadPreset = team.leadPreset;
    existing.members = members;
    for (const key of Object.keys(existing)) if (existing[key] === undefined) delete existing[key];
    if (JSON.stringify(existing) !== before) {
      existing.updatedAt = now;
      stats.updated.push(team.name);
    }
  }

  if (prune) {
    const kept = next.teams.filter((team) => localNames.has(team.name));
    stats.removed = next.teams.filter((team) => !localNames.has(team.name)).map((team) => team.name);
    next.teams = kept;
  }

  const changed = stats.added.length + stats.updated.length + stats.removed.length > 0;
  if (changed) next.revision = (Number(next.revision) || 0) + 1;
  if (!next.schemaVersion) next.schemaVersion = 1;
  return { ledger: next, changed, stats };
}
