import { SyncError } from './service.js';
import { isLoopbackAddress } from './trust.js';

/** JSON response helper. */
function writeJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

/** Refusal helper with a stable code. */
function refuse(res, status, code, message) {
  writeJson(res, status, { ok: false, code, error: message });
}

/** Read a bounded JSON body. */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new SyncError('body-too-large', '请求体超过 1MB');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SyncError('invalid-request', '请求体不是合法 JSON');
  }
}

/** Same-origin tripwire plus the loopback authority. */
function isTrusted(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  const host = req.headers.host;
  const sameOrigin = req.headers['sec-fetch-site'] === 'same-origin'
    || (typeof origin === 'string' && typeof host === 'string' && safeHost(origin) === host)
    || (typeof req.headers.cookie === 'string' && req.headers.cookie.split(';').some((part) => part.trim().startsWith('dsh_')));
  if (!sameOrigin) return false;
  return isLoopbackAddress(req.socket?.remoteAddress);
}

function safeHost(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return undefined;
  }
}

/** One exact route. */
function route(path, handler) {
  return { kind: 'exact', path, handler };
}

/** Build the /plugin-sync/api route table. */
export function createRoutes(service) {
  const guard = (req, res) => {
    if (isTrusted(req)) return true;
    refuse(res, 403, 'forbidden', '该接口只对本机页面开放');
    return false;
  };
  const body = async (req, res) => {
    if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      refuse(res, 415, 'json-required', '该接口只接受 application/json');
      return undefined;
    }
    return await readJsonBody(req);
  };
  const fail = (res, error) => {
    if (error instanceof SyncError) {
      const status = error.code === 'not-found' ? 404 : error.code === 'busy' ? 409 : error.code === 'invalid-request' ? 400 : 500;
      return refuse(res, status, error.code, error.message);
    }
    return refuse(res, 500, 'internal-error', error?.message || '插件同步失败');
  };

  return [
    route('/plugin-sync/api/state', async (req, res) => {
      if (req.method !== 'GET') return refuse(res, 405, 'method-not-allowed', '只接受 GET');
      if (!guard(req, res)) return;
      try {
        writeJson(res, 200, await service.state());
      } catch (error) {
        fail(res, error);
      }
    }),
    route('/plugin-sync/api/plan', async (req, res) => {
      if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed', '只接受 POST');
      if (!guard(req, res)) return;
      try {
        const input = await body(req, res);
        if (!input) return;
        writeJson(res, 200, { ok: true, plan: await service.plan(input.nodeId, input) });
      } catch (error) {
        fail(res, error);
      }
    }),
    route('/plugin-sync/api/apply', async (req, res) => {
      if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed', '只接受 POST');
      if (!guard(req, res)) return;
      try {
        const input = await body(req, res);
        if (!input) return;
        writeJson(res, 200, await service.apply(input.nodeId, input));
      } catch (error) {
        fail(res, error);
      }
    }),
    route('/plugin-sync/api/probe', async (req, res) => {
      if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed', '只接受 POST');
      if (!guard(req, res)) return;
      try {
        const input = await body(req, res);
        if (!input) return;
        writeJson(res, 200, await service.probe(input.nodeId));
      } catch (error) {
        fail(res, error);
      }
    }),
    route('/plugin-sync/api/backup', async (req, res) => {
      if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed', '只接受 POST');
      if (!guard(req, res)) return;
      try {
        const input = (await body(req, res)) || {};
        writeJson(res, 200, await service.backup(input.nodeId));
      } catch (error) {
        fail(res, error);
      }
    }),
    route('/plugin-sync/api/history/clear', async (req, res) => {
      if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed', '只接受 POST');
      if (!guard(req, res)) return;
      try {
        await body(req, res);
        writeJson(res, 200, await service.clearHistory());
      } catch (error) {
        fail(res, error);
      }
    }),
    route('/plugin-sync/api/options', async (req, res) => {
      if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed', '只接受 POST');
      if (!guard(req, res)) return;
      try {
        const input = (await body(req, res)) || {};
        writeJson(res, 200, { ok: true, options: await service.setOptions(input.options || input) });
      } catch (error) {
        fail(res, error);
      }
    }),
    route('/plugin-sync/api/node', async (req, res) => {
      if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed', '只接受 POST');
      if (!guard(req, res)) return;
      try {
        const input = (await body(req, res)) || {};
        if (input.action === 'delete') {
          writeJson(res, 200, { ok: true, deleted: await service.deleteNode(input.id) });
          return;
        }
        writeJson(res, 200, { ok: true, node: await service.saveNode(input.node || input) });
      } catch (error) {
        fail(res, error);
      }
    }),
  ];
}
