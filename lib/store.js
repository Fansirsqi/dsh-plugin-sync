import { join } from 'node:path';
import { readJson, writeJsonAtomic, slug, defaultDshHome, defaultProfileName, ensureDir } from './util.js';

const DEFAULT_OPTIONS = {
  prune: false,
  syncTeams: true,
  includeSecrets: true,
  installLocalDeps: true,
  backupBeforeSync: true,
  copyLocalBundles: true,
  restartRemote: false,
};

/** Where this plugin keeps its own nodes, options and history. */
export function storePath(dshHome = defaultDshHome()) {
  return join(dshHome, 'plugin-sync', 'config.json');
}

/** The default store document. */
export function emptyStore() {
  return { version: 1, options: { ...DEFAULT_OPTIONS }, nodes: [], history: [] };
}

/** Read the store, filling in defaults without writing when the file is absent. */
export async function loadStore(dshHome = defaultDshHome()) {
  const path = storePath(dshHome);
  const raw = await readJson(path);
  if (!raw || typeof raw !== 'object') return emptyStore();
  return {
    version: 1,
    options: { ...DEFAULT_OPTIONS, ...(raw.options || {}) },
    nodes: Array.isArray(raw.nodes) ? raw.nodes.filter(isNode).map((node) => normalizeNode(node)) : [],
    history: Array.isArray(raw.history) ? raw.history.slice(-40) : [],
  };
}

/** Persist the store atomically. */
export async function saveStore(store, dshHome = defaultDshHome()) {
  const path = storePath(dshHome);
  await ensureDir(join(dshHome, 'plugin-sync'));
  await writeJsonAtomic(path, store);
}

/** Whether a value is usable as a node. */
export function isNode(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.name === 'string' && value.name.trim() !== '';
}

/** Fill in a node's optional fields and stable id. */
export function normalizeNode(input, existingIds = []) {
  const name = String(input.name || '').trim().slice(0, 80);
  let id = String(input.id || '').trim() || slug(input.sshAlias || name);
  if (existingIds.includes(id)) {
    let suffix = 2;
    while (existingIds.includes(id + '-' + suffix)) suffix += 1;
    id = id + '-' + suffix;
  }
  const port = Number(input.port);
  const sshAlias = input.sshAlias ? String(input.sshAlias) : undefined;
  return {
    id,
    name,
    sshAlias,
    host: sshAlias ? undefined : input.host ? String(input.host) : undefined,
    user: sshAlias ? undefined : input.user ? String(input.user) : undefined,
    port: sshAlias ? undefined : Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined,
    keyPath: sshAlias ? undefined : input.keyPath ? String(input.keyPath) : undefined,
    proxyJump: Array.isArray(input.proxyJump) ? input.proxyJump.map(String).filter(Boolean) : undefined,
    proxyCommand: input.proxyCommand ? String(input.proxyCommand) : undefined,
    dshHome: input.dshHome ? String(input.dshHome) : '~/.dsh',
    profile: input.profile ? String(input.profile) : defaultProfileName(),
    dshCommand: input.dshCommand ? String(input.dshCommand) : 'dsh',
    restartCommand: input.restartCommand ? String(input.restartCommand) : undefined,
    connectTimeoutMs: Number.isFinite(Number(input.connectTimeoutMs)) ? Number(input.connectTimeoutMs) : 12000,
    createdAt: input.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

/** Read the SSH host inventory written by dsh-ssh, without exposing secrets. */
export async function listSshHosts(dshHome = defaultDshHome()) {
  const raw = await readJson(join(dshHome, 'dsh-ssh.json'));
  const hosts = Array.isArray(raw?.hosts) ? raw.hosts : [];
  return hosts.map((host) => ({
    alias: String(host.alias || ''),
    host: String(host.host || ''),
    port: Number(host.port) || 22,
    user: String(host.user || ''),
    authKind: host.auth?.kind || 'agent',
    tags: Array.isArray(host.tags) ? host.tags : [],
    description: host.description ? String(host.description) : undefined,
    proxyJump: Array.isArray(host.proxyJump) ? host.proxyJump : [],
  }));
}

/** Add or update a node in the store. */
export function upsertNode(store, input) {
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();
  const index = id
    ? store.nodes.findIndex((node) => node.id === id)
    : name
      ? store.nodes.findIndex((node) => node.name === name)
      : -1;
  if (index >= 0) {
    const currentId = store.nodes[index].id;
    const merged = normalizeNode(
      { ...store.nodes[index], ...input, id: currentId, createdAt: store.nodes[index].createdAt },
      store.nodes.filter((node) => node.id !== currentId).map((node) => node.id),
    );
    store.nodes[index] = merged;
    return merged;
  }
  const node = normalizeNode(input, store.nodes.map((item) => item.id));
  store.nodes.push(node);
  return node;
}

/** Remove a node by id. */
export function removeNode(store, id) {
  const index = store.nodes.findIndex((node) => node.id === id);
  if (index < 0) return undefined;
  const [removed] = store.nodes.splice(index, 1);
  return removed;
}

/** Append one run record, keeping the newest 40. */
export function recordHistory(store, entry) {
  store.history.push({ ...entry, at: entry.at || Date.now() });
  if (store.history.length > 40) store.history.splice(0, store.history.length - 40);
  return store;
}

export { DEFAULT_OPTIONS };
