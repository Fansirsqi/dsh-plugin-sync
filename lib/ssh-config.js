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
