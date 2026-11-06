import { listSshHosts, loadStore } from './store.js';
import { SyncError } from './service.js';

/** Render one canonical JSON value as model-facing text. */
function textResult(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}

/** Drop undefined fields so the canonical result is lossless JSON. */
function lossless(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Find a configured node by id, name, or SSH alias. */
async function resolveNode(service, reference) {
  if (!reference || typeof reference !== 'string') throw new SyncError('invalid-request', '请提供节点 id 或名称');
  const store = await loadStore(service.dshHome);
  const node = store.nodes.find((item) => item.id === reference || item.name === reference || item.sshAlias === reference);
  if (!node) throw new SyncError('not-found', '节点不存在：' + reference);
  return node;
}

const commonOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => textResult(value),
};

/** The five model-facing tools. */
export function createTools(service) {
  return [
    {
      name: 'plugin_sync_status',
      description: '列出本机已安装插件、插件配置/开关与智能体中心团队的数量，以及已配置的同步节点和最近同步记录。用于开始一次插件同步前了解两端现状。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: commonOutput,
      async execute() {
        return lossless(await service.state());
      },
    },
    {
      name: 'plugin_sync_plan',
      description: '连接一个已配置的 DSH 节点，对比两端的插件安装、插件版本、启用开关、cordis.patch.yml 配置行和智能体中心团队，返回将要安装/更新/删除的内容。模型相关配置会被跳过。先用它向用户说明影响，再调用 plugin_sync_apply。',
      parameters: {
        type: 'object',
        properties: {
          node: { type: 'string', description: '节点 id、名称或 SSH 别名。' },
        },
        required: ['node'],
        additionalProperties: false,
      },
      output: commonOutput,
      async execute(args, exec) {
        const node = await resolveNode(service, args?.node);
        return lossless(await service.plan(node.id, { signal: exec.signal }));
      },
    },
    {
      name: 'plugin_sync_apply',
      description: '把本机的插件安装、版本、启用开关、插件配置和智能体中心团队同步到一个节点。远端缺少的插件会先安装，再写入配置；远端已有的插件版本不一致时会按本机版本重装。默认保留远端独有的配置与插件（prune=true 时完全镜像并删除）。模型相关配置不会同步。',
      parameters: {
        type: 'object',
        properties: {
          node: { type: 'string', description: '节点 id、名称或 SSH 别名。' },
          prune: { type: 'boolean', description: '完全镜像：删除远端本机没有的插件、配置行和团队。默认 false。' },
          syncTeams: { type: 'boolean', description: '是否同步智能体中心团队，默认 true。' },
          includeSecrets: { type: 'boolean', description: '是否同步 token / apiKey / password 等密钥字段，默认 true。' },
          force: { type: 'boolean', description: '即使没有差异也执行一次（用于重传本地目录插件）。' },
        },
        required: ['node'],
        additionalProperties: false,
      },
      output: commonOutput,
      async execute(args, exec) {
        const node = await resolveNode(service, args?.node);
        const { node: _node, ...options } = args || {};
        return lossless(await service.apply(node.id, { ...options, signal: exec.signal }));
      },
    },
    {
      name: 'plugin_sync_backup',
      description: '导出本机插件状态备份（package.json、cordis.patch.yml、智能体中心团队账本）；传入节点时还会在远端生成一份带时间戳的备份。返回备份目录。',
      parameters: {
        type: 'object',
        properties: {
          node: { type: 'string', description: '可选：同时备份该节点的远端文件。' },
        },
        additionalProperties: false,
      },
      output: commonOutput,
      async execute(args) {
        let nodeId;
        if (args?.node) nodeId = (await resolveNode(service, args.node)).id;
        return lossless(await service.backup(nodeId));
      },
    },
    {
      name: 'plugin_sync_nodes',
      description: '管理插件同步节点：list 查看、add 新增或更新、remove 删除。add 需要 name，并提供 sshAlias（来自 dsh-ssh 主机列表）或 host/user/port/keyPath；可选 profile、dshHome、dshCommand。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'add', 'remove'], description: '要执行的操作。' },
          id: { type: 'string', description: 'remove 时的节点 id。' },
          name: { type: 'string', description: 'add 时的节点名称。' },
          sshAlias: { type: 'string', description: '来自 dsh-ssh 的主机别名。' },
          host: { type: 'string', description: '直接填写 SSH 主机地址。' },
          user: { type: 'string', description: 'SSH 用户名。' },
          port: { type: 'number', description: 'SSH 端口。' },
          keyPath: { type: 'string', description: 'SSH 私钥路径。' },
          profile: { type: 'string', description: '远端 dsh profile，默认 web。' },
          dshHome: { type: 'string', description: '远端 DSH_HOME，默认 ~/.dsh。' },
          dshCommand: { type: 'string', description: '远端 dsh 命令，默认 dsh。' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: commonOutput,
      async execute(args) {
        const action = args?.action;
        if (action === 'list') {
          const store = await loadStore(service.dshHome);
          return lossless({ ok: true, nodes: store.nodes, sshHosts: await listSshHosts(service.dshHome) });
        }
        if (action === 'remove') {
          if (!args?.id) throw new SyncError('invalid-request', 'remove 需要 id');
          return lossless({ ok: true, deleted: await service.deleteNode(args.id) });
        }
        if (action === 'add') {
          const { action: _action, ...node } = args || {};
          return lossless({ ok: true, node: await service.saveNode(node) });
        }
        throw new SyncError('invalid-request', 'action 必须是 list、add 或 remove');
      },
    },
  ];
}
