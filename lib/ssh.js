import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readJson, expandHome } from './util.js';
import { listLocalSshHosts } from './ssh-config.js';

/** Quote one shell word. */
export function shQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

/** Expand ~ and $HOME into a shell expression that the remote login shell understands. */
export function remotePathExpr(value) {
  const text = String(value ?? '');
  if (text === '~' || text === '$HOME') return '"$HOME"';
  if (text.startsWith('~/')) return '"$HOME"/' + shQuote(text.slice(2));
  if (text.startsWith('$HOME/')) return '"$HOME"/' + shQuote(text.slice(6));
  return shQuote(text);
}

/** The remote profile directory expression. */
export function remoteProfileExpr(node) {
  return remotePathExpr(node.dshHome || '~/.dsh') + '/profiles/' + shQuote(node.profile || 'web');
}

/** Load the dsh-ssh host record for an alias, if one exists. */
async function dshSshRecord(alias, dshHome) {
  if (!alias) return undefined;
  const resolvedHome = dshHome || process.env.DSH_HOME || join(process.env.HOME || '/root', '.dsh');
  const raw = await readJson(join(resolvedHome, 'dsh-ssh.json'));
  return Array.isArray(raw?.hosts) ? raw.hosts.find((host) => host.alias === alias) : undefined;
}

/** The credential part of a dsh-ssh record. */
function recordAuth(record) {
  if (!record?.auth) return undefined;
  return record.auth.kind === 'password' ? record.auth.password : record.auth.passphrase;
}

/**
 * Resolve a node to an ssh invocation. When the node names an OpenSSH Host
 * (sshHost) or its sshAlias exists in ~/.ssh/config, the alias is handed to
 * ssh directly, so the live ~/.ssh/config is always authoritative. The
 * dsh-ssh inventory remains the fallback for aliases it alone defines.
 */
export async function resolveTarget(node, dshHome) {
  const connectTimeoutMs = node.connectTimeoutMs || 12000;

  if (node.sshHost) {
    const record = await dshSshRecord(node.sshHost, dshHome).catch(() => undefined);
    return { mode: 'alias', alias: node.sshHost, source: 'ssh-config', connectTimeoutMs, password: recordAuth(record), keyPath: node.keyPath };
  }

  let record;
  if (node.sshAlias) {
    record = await dshSshRecord(node.sshAlias, dshHome);
    const configAliases = await listLocalSshHosts().catch(() => []);
    if (configAliases.includes(node.sshAlias)) {
      return { mode: 'alias', alias: node.sshAlias, source: 'ssh-config', connectTimeoutMs, password: recordAuth(record), keyPath: node.keyPath };
    }
    if (!record) {
      throw new Error('SSH 主机别名不存在：' + node.sshAlias + '（不在 ~/.ssh/config，也不在 dsh-ssh 主机列表中）');
    }
  }

  const host = node.host || record?.host;
  if (!host) throw new Error('节点 ' + node.name + ' 没有配置 SSH 主机');
  const auth = record?.auth ?? (node.keyPath ? { kind: 'key', keyPath: node.keyPath } : { kind: 'agent' });
  return {
    mode: 'direct',
    source: node.host ? 'node' : 'dsh-ssh',
    host,
    port: Number(node.port || record?.port || 22),
    user: node.user || record?.user || process.env.USER || 'root',
    keyPath: node.keyPath || auth.keyPath,
    password: recordAuth(record),
    authKind: auth.kind,
    proxyJump: node.proxyJump || record?.proxyJump || [],
    proxyCommand: node.proxyCommand || record?.proxyCommand,
    forwardAgent: Boolean(record?.forwardAgent),
    connectTimeoutMs,
  };
}

/** Assemble ssh arguments for a target. */
function sshArgs(target, command, askpass) {
  const args = ['-T', '-o', 'LogLevel=ERROR', '-o', 'ConnectTimeout=' + Math.max(3, Math.ceil(target.connectTimeoutMs / 1000)), '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', '-o', 'StrictHostKeyChecking=accept-new'];
  if (target.mode === 'alias') {
    if (target.keyPath) args.push('-i', expandHome(target.keyPath));
    if (askpass) args.push('-o', 'BatchMode=no', '-o', 'NumberOfPasswordPrompts=1');
    else args.push('-o', 'BatchMode=yes');
    args.push(target.alias);
  } else {
    if (target.keyPath) args.push('-i', expandHome(target.keyPath));
    if (target.port && target.port !== 22) args.push('-p', String(target.port));
    if (Array.isArray(target.proxyJump) && target.proxyJump.length > 0) args.push('-J', target.proxyJump.join(','));
    if (target.proxyCommand) args.push('-o', 'ProxyCommand=' + target.proxyCommand);
    if (target.forwardAgent) args.push('-A');
    if (askpass) {
      args.push('-o', 'BatchMode=no', '-o', 'NumberOfPasswordPrompts=1');
      args.push('-o', 'PreferredAuthentications=' + (target.authKind === 'password' ? 'password,keyboard-interactive' : 'publickey'));
    } else args.push('-o', 'BatchMode=yes');
    args.push(target.user + '@' + target.host);
  }
  args.push('bash -lc ' + shQuote(command));
  return args;
}

/**
 * Run one shell command on the remote node through the system ssh client.
 * @returns {{ code: number | null, stdout: string, stderr: string, timedOut: boolean, durationMs: number }}
 */
export async function runRemote(node, command, options = {}) {
  const target = options.target || (await resolveTarget(node, options.dshHome));
  const timeoutMs = options.timeoutMs ?? 120000;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  let askpassDir;
  let askpassPath;
  if (target.password) {
    askpassDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-ssh-'));
    askpassPath = join(askpassDir, 'askpass.sh');
    await fsWriteFile(askpassPath, '#!/bin/sh\nprintf "%s\\n" "$PLUGIN_SYNC_SSH_PASSWORD"\n', { mode: 0o700 });
  }
  const args = sshArgs(target, command, Boolean(target.password));
  const env = { ...process.env, ...(options.env || {}) };
  if (target.password) {
    env.SSH_ASKPASS = askpassPath;
    env.SSH_ASKPASS_REQUIRE = 'force';
    env.DISPLAY = env.DISPLAY || ':0';
    env.PLUGIN_SYNC_SSH_PASSWORD = target.password;
  }
  const startedAt = Date.now();
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(options.sshBinary || 'ssh', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
      const out = [];
      const err = [];
      let outBytes = 0;
      let errBytes = 0;
      let timedOut = false;
      let killedByAbort = false;
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve({ ...result, durationMs: Date.now() - startedAt });
      };
      const stop = (reason) => {
        if (settled) return;
        if (reason === 'timeout') timedOut = true;
        if (reason === 'abort') killedByAbort = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2000).unref?.();
      };
      const timer = setTimeout(() => stop('timeout'), timeoutMs);
      const onAbort = () => stop('abort');
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      };
      child.stdout.on('data', (chunk) => {
        outBytes += chunk.length;
        if (outBytes <= maxBytes) out.push(chunk);
        else stop('output');
      });
      child.stderr.on('data', (chunk) => {
        errBytes += chunk.length;
        if (errBytes <= maxBytes) err.push(chunk);
      });
      child.on('error', (error) => {
        cleanup();
        reject(new Error('无法启动 ssh：' + error.message));
      });
      child.on('close', (code, signal) => {
        cleanup();
        finish({
          code,
          signal,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
          timedOut,
          aborted: killedByAbort || options.signal?.aborted === true,
        });
      });
      if (options.stdin !== undefined) child.stdin.end(options.stdin);
      else child.stdin.end();
    });
  } finally {
    if (askpassDir) await rm(askpassDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Run a command and throw a bounded, useful error when it fails. */
export async function runRemoteOk(node, command, options = {}) {
  const result = await runRemote(node, command, options);
  if (result.code !== 0) {
    const output = (result.stderr || result.stdout || '').trim().slice(-4000);
    throw new Error('远端命令执行失败（退出码 ' + result.code + '）：' + (output || command.slice(0, 200)));
  }
  return result;
}

/** Read a set of remote files in one round trip. */
export async function readRemoteFiles(node, specs, options = {}) {
  const lines = [];
  lines.push('emit(){ printf \'%s\\t\' "$1"; if [ -f "$2" ]; then base64 "$2" | tr -d "\\n"; fi; printf "\\n"; }');
  for (const spec of specs) {
    if (!spec || !spec.key) continue;
    lines.push('emit ' + shQuote(spec.key) + ' ' + remotePathExpr(spec.path));
  }
  lines.push('printf \'DSH_BIN\\t%s\\n\' "$(command -v dsh 2>/dev/null || true)"');
  lines.push('printf \'DSH_VER\\t%s\\n\' "$(dsh --version 2>/dev/null | head -1 || true)"');
  lines.push('printf \'NODE_BIN\\t%s\\n\' "$(command -v node 2>/dev/null || true)"');
  lines.push('printf \'NODE_VER\\t%s\\n\' "$(node --version 2>/dev/null || true)"');
  lines.push('printf \'PNPM_BIN\\t%s\\n\' "$(command -v pnpm 2>/dev/null || true)"');
  lines.push('printf \'PROFILE_EXISTS\\t%s\\n\' "$(test -d ' + remoteProfileExpr(node) + ' && echo yes || echo no)"');
  lines.push('printf \'HOME_DIR\\t%s\\n\' "$HOME"');
  const result = await runRemote(node, lines.join('\n'), options);
  if (result.code !== 0) {
    const output = (result.stderr || result.stdout || '').trim().slice(-3000);
    throw new Error('无法读取远端状态（退出码 ' + result.code + '）：' + (output || 'ssh 连接失败'));
  }
  const files = {};
  const meta = {};
  for (const line of result.stdout.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const key = line.slice(0, tab);
    const value = line.slice(tab + 1);
    if (/^(DSH_BIN|DSH_VER|NODE_BIN|NODE_VER|PNPM_BIN|PROFILE_EXISTS|HOME_DIR)$/.test(key)) meta[key] = value;
    else files[key] = value ? Buffer.from(value, 'base64').toString('utf8') : undefined;
  }
  return { files, meta, raw: result };
}

/** Write one remote file atomically (cat into a temporary sibling, then mv). */
export async function writeRemoteFile(node, path, content, options = {}) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
  const script = 'umask 077 && mkdir -p ' + remotePathExpr(dir) + ' && cat > ' + remotePathExpr(path) + '.tmp-sync && mv ' + remotePathExpr(path) + '.tmp-sync ' + remotePathExpr(path);
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  const result = await runRemote(node, script, { ...options, stdin: buffer });
  if (result.code !== 0) {
    throw new Error('写入远端文件失败 ' + path + '：' + (result.stderr || result.stdout || '').trim().slice(-2000));
  }
  const digest = createHash('sha256').update(buffer).digest('hex');
  const verify = await runRemote(node, 'sha256sum ' + remotePathExpr(path) + ' 2>/dev/null | cut -d" " -f1', { ...options, timeoutMs: 30000 }).catch(() => undefined);
  if (verify && verify.code === 0 && verify.stdout.trim() && verify.stdout.trim() !== digest) {
    throw new Error('远端文件校验失败：' + path);
  }
  return { bytes: buffer.length, sha256: digest };
}

/** Copy one file to a timestamped backup beside it. */
export async function backupRemoteFile(node, path, stamp, options = {}) {
  const script = 'if [ -f ' + remotePathExpr(path) + ' ]; then cp -p ' + remotePathExpr(path) + ' ' + remotePathExpr(path + '.bak-' + stamp) + '; echo yes; else echo no; fi';
  const result = await runRemote(node, script, { ...options, timeoutMs: 30000 });
  return result.stdout.trim() === 'yes';
}

/** Copy a local directory (without node_modules/.git) to a remote directory. */
export async function copyDirectory(node, localDir, remoteDir, options = {}) {
  const target = options.target || (await resolveTarget(node, options.dshHome));
  const staging = remoteDir + '.new-' + Date.now();
  const remoteCommand = 'rm -rf ' + remotePathExpr(staging) + ' && mkdir -p ' + remotePathExpr(staging) + ' && tar -xzf - -C ' + remotePathExpr(staging) + ' && rm -rf ' + remotePathExpr(remoteDir) + ' && mv ' + remotePathExpr(staging) + ' ' + remotePathExpr(remoteDir);
  const args = sshArgs(target, remoteCommand, Boolean(target.password));
  const env = { ...process.env };
  let askpassDir;
  let askpassPath;
  if (target.password) {
    askpassDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-ssh-'));
    askpassPath = join(askpassDir, 'askpass.sh');
    await fsWriteFile(askpassPath, '#!/bin/sh\nprintf "%s\\n" "$PLUGIN_SYNC_SSH_PASSWORD"\n', { mode: 0o700 });
    env.SSH_ASKPASS = askpassPath;
    env.SSH_ASKPASS_REQUIRE = 'force';
    env.DISPLAY = env.DISPLAY || ':0';
    env.PLUGIN_SYNC_SSH_PASSWORD = target.password;
  }
  try {
    await new Promise((resolve, reject) => {
      const tar = spawn('tar', ['-C', localDir, '-czf', '-', '--exclude=node_modules', '--exclude=.git', '--exclude=.plugin-manager', '--exclude=tmp', '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const ssh = spawn(options.sshBinary || 'ssh', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
      const err = [];
      const tarErr = [];
      tar.stdout.pipe(ssh.stdin);
      tar.stderr.on('data', (chunk) => tarErr.push(chunk));
      ssh.stderr.on('data', (chunk) => err.push(chunk));
      ssh.stdout.resume();
      let tarCode = null;
      let sshCode = null;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        tar.kill('SIGKILL');
        ssh.kill('SIGKILL');
        reject(new Error('上传本地插件超时：' + localDir));
      }, options.timeoutMs ?? 10 * 60 * 1000);
      const done = () => {
        if (tarCode === null || sshCode === null) return;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (tarCode !== 0) return reject(new Error('打包本地插件失败：' + Buffer.concat(tarErr).toString('utf8').slice(-2000)));
        if (sshCode !== 0) return reject(new Error('上传插件失败：' + Buffer.concat(err).toString('utf8').slice(-2000)));
        resolve();
      };
      tar.on('close', (code) => { tarCode = code; done(); });
      ssh.on('close', (code) => { sshCode = code; done(); });
      tar.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
      ssh.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
      options.signal?.addEventListener('abort', () => { tar.kill('SIGTERM'); ssh.kill('SIGTERM'); }, { once: true });
    });
  } finally {
    if (askpassDir) await rm(askpassDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Run pnpm install in the remote profile through dsh plugin. */
export async function installRemoteProfile(node, options = {}) {
  const dshCommand = node.dshCommand || 'dsh';
  const script = 'cd ' + remoteProfileExpr(node) + ' && DSH_HOME=' + remotePathExpr(node.dshHome || '~/.dsh') + ' ' + dshCommand + ' plugin --profile ' + shQuote(node.profile || 'web') + ' install';
  const result = await runRemote(node, script, { ...options, timeoutMs: options.timeoutMs ?? 15 * 60 * 1000, maxBytes: 4 * 1024 * 1024 });
  if (result.code !== 0) {
    const output = (result.stderr || result.stdout || '').trim().slice(-6000);
    throw new Error('远端插件安装失败（退出码 ' + result.code + '）：' + (output || 'dsh plugin install 未成功'));
  }
  return result;
}

/** Install one copied local bundle's own dependencies. */
export async function installBundleDependencies(node, remoteDir, options = {}) {
  const script = 'cd ' + remotePathExpr(remoteDir) + ' && pnpm install --prod --ignore-scripts';
  const result = await runRemote(node, script, { ...options, timeoutMs: options.timeoutMs ?? 10 * 60 * 1000, maxBytes: 2 * 1024 * 1024 });
  return result;
}
