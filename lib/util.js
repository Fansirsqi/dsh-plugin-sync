import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, chmod, readdir, stat, readlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Resolve $HOME without trusting the process environment's HOME. */
export function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || '/root';
}

/** The running profile's home directory (DSH_HOME). */
export function defaultDshHome() {
  return process.env.DSH_HOME || join(homeDir(), '.dsh');
}

/** The running profile name, when the launcher exported it. */
export function defaultProfileName() {
  return process.env.DSH_PROFILE || 'web';
}

/** The running profile directory. */
export function defaultProfileDir() {
  if (process.env.DSH_PROFILE_DIR) return process.env.DSH_PROFILE_DIR;
  return join(defaultDshHome(), 'profiles', defaultProfileName());
}

/** Expand a leading ~ to the local home. */
export function expandHome(value) {
  if (typeof value !== 'string') return value;
  if (value === '~') return homeDir();
  if (value.startsWith('~/')) return join(homeDir(), value.slice(2));
  return value;
}

/** Stable slug for a node or package directory name. */
export function slug(value) {
  const text = String(value ?? '').trim().toLowerCase();
  const cleaned = text.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return cleaned || 'node';
}

/** Stable JSON with sorted keys, used for change detection. */
export function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

/** Deep equality through stable JSON. */
export function sameJson(a, b) {
  return stableJson(a) === stableJson(b);
}

/** Clone a JSON value. */
export function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** SHA-256 hex of a value. */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Read a UTF-8 file, or undefined when absent. */
export async function readText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Read and parse a JSON file, or undefined when absent. */
export async function readJson(path) {
  const text = await readText(path);
  if (text === undefined || text.trim() === '') return undefined;
  return JSON.parse(text);
}

/** Create a directory tree with owner-only permissions on the leaf. */
export async function ensureDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

/** Write a file atomically with an optional mode. */
export async function writeAtomic(path, content, mode = 0o600) {
  await ensureDir(dirname(path));
  const temporary = path + '.tmp-' + process.pid + '-' + Date.now();
  await writeFile(temporary, content, { mode });
  await rename(temporary, path);
  try {
    await chmod(path, mode);
  } catch {
    // best effort: filesystems without chmod still keep the atomic rename
  }
}

/** Write JSON atomically. */
export async function writeJsonAtomic(path, value, mode = 0o600) {
  await writeAtomic(path, JSON.stringify(value, null, 2) + '\n', mode);
}

/** Join a relative path under a base. */
export function under(base, ...parts) {
  return join(base, ...parts);
}

/** Human byte size. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}

/** Whether a plugin id or package name looks model-related. */
const MODEL_RE = /(^|[-_/@.])(llm|llms|model|models|web-search|websearch|embedding|embeddings|rerank|reranker|agent-default-model)([-_/@.]|$)/i;

/** Model-related rows are never synced (the other side keeps its own). */
export function isModelLike(value) {
  const text = String(value ?? '');
  if (text === '') return false;
  return MODEL_RE.test(text) || /(^|[-_/])model([-_/]|$)/i.test(text);
}

/** Whether a dependency is a local directory spec. */
export function isLocalPathSpec(spec) {
  return typeof spec === 'string' && (spec.startsWith('link:') || spec.startsWith('file:') || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('~'));
}

/** The local directory a link:/file: spec names. */
export function localPathFromSpec(spec) {
  if (typeof spec !== 'string') return undefined;
  if (spec.startsWith('link:')) return expandHome(spec.slice(5));
  if (spec.startsWith('file:')) return expandHome(spec.slice(5));
  if (spec.startsWith('~') || spec.startsWith('/') || spec.startsWith('.')) return expandHome(spec);
  return undefined;
}

/** Redact secret-looking keys in a value (for logs and previews). */
export function redactSecrets(value, depth = 0) {
  if (depth > 8) return '[deep]';
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(password|passwd|secret|token|api[-_]?key|authorization|credential|credentials|private[-_]?key)$/i.test(key)) {
      out[key] = typeof item === 'string' && item !== '' ? '[redacted]' : item;
    } else if (/^(env|headers)$/i.test(key) && item && typeof item === 'object') {
      out[key] = redactSecrets(item, depth + 1);
    } else {
      out[key] = redactSecrets(item, depth + 1);
    }
  }
  return out;
}

/** Remove secret-looking keys from config values before syncing when secrets are excluded. */
export function removeSecretValues(value, depth = 0) {
  if (depth > 12) return value;
  if (Array.isArray(value)) return value.map((item) => removeSecretValues(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(password|passwd|secret|token|api[-_]?key|authorization|credential|credentials|private[-_]?key)$/i.test(key)) continue;
    out[key] = removeSecretValues(item, depth + 1);
  }
  return out;
}

const HASH_EXCLUDED = new Set(['node_modules', '.git', 'tmp', '.plugin-manager', '.DS_Store', 'coverage', '.cache']);

/**
 * Content fingerprint of a local bundle directory. Used to decide whether a
 * linked local plugin actually changed since the last upload; version alone
 * misses edits in a workspace checkout.
 */
export async function hashDirectory(dir) {
  const hash = createHash('sha256');
  const walk = async (relative) => {
    const current = join(dir, relative);
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (HASH_EXCLUDED.has(entry.name)) continue;
      const child = relative ? relative + '/' + entry.name : entry.name;
      const full = join(dir, child);
      if (entry.isDirectory()) {
        hash.update('D' + child + '\0');
        await walk(child);
      } else if (entry.isSymbolicLink()) {
        hash.update('L' + child + '\0' + (await readlink(full).catch(() => '')));
      } else if (entry.isFile()) {
        const info = await stat(full).catch(() => undefined);
        if (!info) continue;
        hash.update('F' + child + '\0' + info.size + '\0');
        if (info.size <= 2 * 1024 * 1024) hash.update(await readFile(full));
        else hash.update(String(info.mtimeMs));
      }
    }
  };
  await walk('');
  return hash.digest('hex');
}

/** Current ISO-ish local timestamp used in backup directory names. */
export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
