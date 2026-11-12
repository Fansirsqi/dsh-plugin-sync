import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homeDir } from './util.js';

/** The user's OpenSSH client configuration. */
export function localSshConfigPath() {
  return join(homeDir(), '.ssh', 'config');
}

/** Strip a trailing comment from a Host pattern list. */
function stripComment(value) {
  return String(value).replace(/\s+#.*$/, '').trim();
}

/** Canonical key for one Host block. */
function hostKey(patterns) {
  return patterns.map((pattern) => pattern.toLowerCase()).join(' ');
}

/**
 * Parse the subset of ssh_config this plugin needs: Host blocks, their raw
 * lines, and global lines before the first Host. Include and Match are
 * reported so the caller can warn instead of silently dropping them.
 */
export function parseSshConfig(text) {
  const source = String(text ?? '').replace(/\r\n/g, '\n');
  const lines = source.split('\n');
  const blocks = [];
  const globalLines = [];
  const includes = [];
  let current;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      (current ? current.lines : globalLines).push(raw);
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9]*)\s+(.*)$/.exec(trimmed);
    if (!match) {
      (current ? current.lines : globalLines).push(raw);
      continue;
    }
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'host') {
      const patterns = stripComment(value).split(/\s+/).filter(Boolean);
      current = {
        kind: 'host',
        patterns,
        key: hostKey(patterns),
        lines: [raw],
        special: patterns.some((pattern) => /[*?!]/.test(pattern)),
      };
      blocks.push(current);
      continue;
    }
    if (key === 'match') {
      current = { kind: 'match', patterns: [], key: 'match:' + blocks.length, lines: [raw], special: true };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(raw);
    else globalLines.push(raw);
    if (key === 'include') includes.push(value);
  }

  return { blocks, globalLines, includes };
}

/** Every literal Host alias in a parsed config. */
export function hostAliases(parsed) {
  const aliases = [];
  for (const block of parsed.blocks) {
    if (block.kind !== 'host') continue;
    for (const pattern of block.patterns) {
      if (/[*?!]/.test(pattern)) continue;
      if (!aliases.includes(pattern)) aliases.push(pattern);
    }
  }
  return aliases;
}

/** Read the local ~/.ssh/config. */
export async function readLocalSshConfig() {
  const path = localSshConfigPath();
  try {
    const text = await readFile(path, 'utf8');
    return { path, exists: true, text, ...parseSshConfig(text) };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { path, exists: false, text: undefined, ...parseSshConfig('') };
  }
}

/** Read the local literal host aliases. */
export async function listLocalSshHosts() {
  const config = await readLocalSshConfig();
  return hostAliases(config);
}

/** Ensure one trailing newline, preserving an empty file as empty. */
function normalizeText(text) {
  const value = String(text ?? '');
  if (value === '') return '';
  return value.replace(/\n+$/, '') + '\n';
}

/**
 * Merge this machine's Host blocks into the target's config. Remote-only
 * blocks are kept unless prune is set; remote global lines, Match blocks, and
 * Include directives are never rewritten.
 */
export function mergeSshConfig(localText, remoteText, options = {}) {
  const prune = options.prune === true;
  const warnings = [];
  const changes = { added: [], updated: [], removed: [] };

  if (!localText || !String(localText).trim()) {
    return { text: normalizeText(remoteText), changes, warnings: ['本机没有 ~/.ssh/config，跳过 SSH 配置同步。'] };
  }

  const local = parseSshConfig(localText);
  if (!remoteText || !String(remoteText).trim()) {
    const aliases = hostAliases(local);
    changes.added = aliases;
    return { text: normalizeText(localText), changes, warnings };
  }

  const remote = parseSshConfig(remoteText);
  if (local.includes.length > 0) warnings.push('本机 ~/.ssh/config 使用 Include，只同步主文件，不展开被包含的文件。');
  if (remote.includes.length > 0) warnings.push('远端 ~/.ssh/config 使用 Include，被包含的文件保持原样。');
  if (local.blocks.some((block) => block.kind === 'match')) warnings.push('本机 ~/.ssh/config 的 Match 段未同步。');
  if (local.globalLines.some((line) => line.trim() !== '' && !line.trim().startsWith('#')) && remote.globalLines.some((line) => line.trim() !== '' && !line.trim().startsWith('#'))) {
    warnings.push('两端 ~/.ssh/config 都有全局指令，远端全局段保持原样。');
  }
  const localTextLower = String(localText);
  if (/^\s*(ProxyCommand|ProxyJump|IdentityFile|UserKnownHostsFile|LocalForward|RemoteForward)\s/im.test(localTextLower)) {
    warnings.push('本机 SSH Host 含 ProxyCommand / IdentityFile 等本机路径或命令，远端需要对应可用的代理与密钥。');
  }

  const localByKey = new Map();
  for (const block of local.blocks) {
    if (block.kind !== 'host') continue;
    localByKey.set(block.key, block);
  }

  const used = new Set();
  const output = [...remote.globalLines];
  for (const block of remote.blocks) {
    if (block.kind === 'host' && localByKey.has(block.key)) {
      const replacement = localByKey.get(block.key);
      used.add(block.key);
      if (replacement.lines.join('\n') !== block.lines.join('\n')) changes.updated.push(block.key);
      output.push(...replacement.lines);
      continue;
    }
    if (block.kind === 'host' && prune && !block.special) {
      changes.removed.push(block.key);
      continue;
    }
    output.push(...block.lines);
  }

  const appended = [];
  for (const block of local.blocks) {
    if (block.kind !== 'host' || used.has(block.key)) continue;
    used.add(block.key);
    appended.push(...block.lines);
    changes.added.push(block.key);
  }
  output.push(...appended);

  return { text: normalizeText(output.join('\n')), changes, warnings };
}
