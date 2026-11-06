import { createRequire } from 'node:module';
import { join } from 'node:path';
import { isModelLike, removeSecretValues, sameJson } from './util.js';

let yamlModule;

/**
 * The YAML implementation is borrowed from the running profile: every DSH
 * profile that carries the plugin manager has `yaml` in its node_modules, and
 * that copy already understands the Loader's `!!js` tag through our custom tag.
 * No runtime dependency is declared, so a linked workspace bundle needs no
 * install step of its own.
 */
export async function loadYaml(profileDir) {
  if (yamlModule) return yamlModule;
  const candidates = [];
  if (profileDir) candidates.push(profileDir);
  if (process.env.DSH_PROFILE_DIR) candidates.push(process.env.DSH_PROFILE_DIR);
  for (const dir of candidates) {
    try {
      const req = createRequire(join(dir, 'package.json'));
      yamlModule = req('yaml');
      return yamlModule;
    } catch {
      // try the next candidate
    }
  }
  try {
    yamlModule = await import('yaml');
    return yamlModule;
  } catch {
    throw new Error('无法加载 yaml 解析器：当前 DSH 安装缺少 yaml 依赖，无法合并 cordis.patch.yml');
  }
}

/**
 * The Loader's `!!js` tag is not part of the YAML core schema. Keep the scalar
 * exactly as written so a merged patch still evaluates the same expression.
 */
const jsTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (value) => ({ __jsExpr: String(value) }),
  identify: (value) => Boolean(value) && typeof value === 'object' && typeof value.__jsExpr === 'string',
  stringify: (item) => (typeof item.value === 'string' ? item.value : item.value?.__jsExpr ?? ''),
  default: true,
};

const PARSE_OPTIONS = { customTags: [jsTag], keepSourceTokens: false };

/** Whether a document is empty (a bare `[]` or comments only). */
function hasContents(doc) {
  return doc.contents !== null && doc.contents !== undefined;
}

/** Parse a patch file into a Document, refusing syntax errors loudly. */
export function parsePatchDocument(YAML, text) {
  const doc = YAML.parseDocument(text && text.trim() !== '' ? text : '[]', PARSE_OPTIONS);
  if (doc.errors.length > 0) {
    const message = doc.errors.map((error) => error.message).join('; ');
    throw new Error('cordis.patch.yml 解析失败：' + message);
  }
  if (!hasContents(doc)) doc.contents = doc.createNode([]);
  if (!YAML.isSeq(doc.contents)) {
    throw new Error('cordis.patch.yml 的顶层必须是补丁数组');
  }
  return doc;
}

/** Create an empty patch document. */
export function createPatchDocument(YAML) {
  const doc = new YAML.Document();
  doc.contents = doc.createNode([]);
  return doc;
}

/** Serialize a patch document. */
export function patchDocumentText(doc) {
  let text = doc.toString({ lineWidth: 0, minContentWidth: 0 });
  if (!text.endsWith('\n')) text += '\n';
  return text;
}

/** One row of a patch list: an id-targeted override or an insert. */
export function collectRows(doc, YAML) {
  const rows = [];
  const groups = [];
  if (!hasContents(doc) || !YAML.isSeq(doc.contents)) return { rows, groups };
  for (const item of doc.contents.items) {
    if (!YAML.isMap(item)) continue;
    if (item.has('insert')) {
      const seq = item.get('insert');
      if (!YAML.isSeq(seq)) continue;
      const group = { node: item, seq, id: item.get('id'), rows: [] };
      groups.push(group);
      seq.items.forEach((row, index) => {
        if (!YAML.isMap(row)) return;
        const entry = {
          id: row.get('id'),
          js: row.toJS(doc),
          parent: seq,
          index,
          container: 'insert',
          group: group.id ? group : undefined,
        };
        rows.push(entry);
        group.rows.push(entry);
      });
    } else {
      rows.push({
        id: item.get('id'),
        js: item.toJS(doc),
        parent: doc.contents,
        index: doc.contents.items.indexOf(item),
        container: 'top',
      });
    }
  }
  return { rows, groups };
}

/** Whether a value came from a `!!js` scalar. */
function isJsExpr(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.__jsExpr === 'string';
}

/** Build a YAML node that keeps `!!js` expressions as tagged scalars. */
function nodeFromJs(YAML, doc, value) {
  if (isJsExpr(value)) {
    const scalar = new YAML.Scalar(value.__jsExpr);
    scalar.tag = 'tag:yaml.org,2002:js';
    return scalar;
  }
  if (Array.isArray(value)) {
    const seq = new YAML.YAMLSeq();
    seq.items = value.map((item) => nodeFromJs(YAML, doc, item));
    return seq;
  }
  if (value && typeof value === 'object') {
    const map = new YAML.YAMLMap();
    map.items = Object.entries(value).map(([key, item]) => new YAML.Pair(key, nodeFromJs(YAML, doc, item)));
    return map;
  }
  return doc.createNode(value);
}

/** Whether one row is model-related and therefore must not cross nodes. */
export function isModelRow(row) {
  if (!row || typeof row !== 'object') return false;
  return isModelLike(row.id) || isModelLike(row.name);
}

/** Plain JSON snapshot of the syncable rows in a patch document. */
export function patchRows(doc, YAML) {
  const { rows, groups } = collectRows(doc, YAML);
  return {
    rows: rows
      .filter((row) => row.id)
      .map((row) => ({ id: String(row.id), name: row.js?.name, container: row.container, value: row.js })),
    modelRowIds: rows.filter((row) => row.id && isModelRow(row.js)).map((row) => String(row.id)),
    groups: groups.length,
  };
}

/** Find an insert block that targets no existing group, creating one when needed. */
function insertBlock(YAML, doc) {
  if (!hasContents(doc) || !YAML.isSeq(doc.contents)) return undefined;
  for (let index = doc.contents.items.length - 1; index >= 0; index -= 1) {
    const item = doc.contents.items[index];
    if (YAML.isMap(item) && item.has('insert') && !item.has('id')) return item;
  }
  const block = doc.createNode({ insert: [] });
  doc.contents.items.push(block);
  return block;
}

/** Remove one row from its list, cleaning up an emptied insert block. */
function removeRow(doc, YAML, entry) {
  const parent = entry.parent;
  if (!parent || !Array.isArray(parent.items)) return;
  const index = parent.items.indexOf(entry.node ?? parent.items[entry.index]);
  if (index >= 0) parent.items.splice(index, 1);
  if (parent !== doc.contents && parent.items.length === 0) {
    const blockIndex = doc.contents.items.findIndex((item) => YAML.isMap(item) && item.get('insert') === parent);
    if (blockIndex >= 0) doc.contents.items.splice(blockIndex, 1);
  }
}

/**
 * Merge the local syncable rows into the remote document in place.
 *
 * Rows are matched by id, not by position: an override stays at its position,
 * an inserted plugin row stays inside its insert block, and every remote row
 * this side does not know about is left untouched unless `prune` asks for a
 * complete mirror. Model rows are never read from the local side and never
 * removed from the remote side.
 */
export function mergePatchDocument(YAML, remoteDoc, localDoc, options = {}) {
  const includeSecrets = options.includeSecrets !== false;
  const prune = options.prune === true;
  const local = collectRows(localDoc, YAML);
  const remote = collectRows(remoteDoc, YAML);
  const byId = new Map();
  for (const row of remote.rows) {
    if (!row.id || byId.has(String(row.id))) continue;
    byId.set(String(row.id), row);
  }
  const desired = new Set();
  const changes = { added: [], updated: [], removed: [], skippedModel: [] };
  const warnings = [];

  for (const row of local.rows) {
    if (!row.id) continue;
    const js = row.js && typeof row.js === 'object' ? row.js : {};
    if (isModelRow(js)) {
      changes.skippedModel.push(String(row.id));
      continue;
    }
    desired.add(String(row.id));
    const next = includeSecrets ? js : removeSecretValues(js);
    const existing = byId.get(String(row.id));
    if (existing) {
      if (!sameJson(existing.js, next)) {
        existing.parent.items[existing.index] = nodeFromJs(YAML, remoteDoc, next);
        changes.updated.push(String(row.id));
      }
    } else {
      const node = nodeFromJs(YAML, remoteDoc, next);
      if (row.container === 'insert') {
        if (row.group) warnings.push('本地 insert 组 ' + row.group.id + ' 是分组插入，已按普通插入处理');
        const block = insertBlock(YAML, remoteDoc);
        const seq = block.get('insert');
        seq.items.push(node);
      } else {
        remoteDoc.contents.items.push(node);
      }
      changes.added.push(String(row.id));
    }
  }

  if (prune) {
    const removals = remote.rows
      .filter((row) => row.id && !desired.has(String(row.id)) && !isModelRow(row.js))
      .sort((a, b) => b.index - a.index);
    for (const row of removals) {
      const node = row.parent.items[row.index];
      removeRow(remoteDoc, YAML, { ...row, node });
      changes.removed.push(String(row.id));
    }
  }

  return { changes, warnings };
}

/** Deep-clone a parsed document through its text representation. */
export function cloneDocument(YAML, doc) {
  return parsePatchDocument(YAML, patchDocumentText(doc));
}
