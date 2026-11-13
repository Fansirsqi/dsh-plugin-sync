window.__ModuleLoader__.load({
  id: '@fansirsqi/dsh-plugin-sync',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef } = React;

    const NS = 'plugin-sync';
    const COPY = {
      zh: {
        title: '插件同步',
        intro: '把本机已安装的插件、版本、启用开关和插件配置同步到其他 DSH 节点；模型相关配置不会同步。',
        nodes: '节点', addNode: '添加节点', editNode: '编辑节点', deleteNode: '删除',
        noNodes: '还没有配置节点。先添加一台运行 DSH 的 SSH 主机。',
        name: '名称', sshAlias: 'SSH 主机', sshHost: 'SSH 配置别名', host: '主机地址', user: '用户', port: '端口',
        keyPath: '私钥路径', profile: 'Profile', dshHome: 'DSH_HOME', dshCommand: 'dsh 命令',
        chooseHost: '选择 dsh-ssh 主机', chooseSshHost: '跟随 ~/.ssh/config（推荐）', save: '保存', cancel: '取消', probe: '测试连接',
        plan: '检查差异', apply: '立即同步', backup: '备份', syncing: '同步中', checking: '检查中',
        options: '同步选项', optPrune: '完全镜像（删除对端多余的插件和配置行）',
        optSshConfig: '读取本机 SSH 配置（~/.ssh/config）', optSecrets: '同步密钥字段（token / apiKey / password）',
        optLocalDeps: '为上传的本地插件安装依赖', optCopyLocal: '上传本地目录插件',
        optBackup: '同步前备份对端', local: '本机状态', packages: '插件依赖', bundles: '启用插件',
        rows: '配置行', modelRows: '模型配置（跳过）',
        history: '同步记录', noHistory: '还没有同步记录。', sshHint: '连接节点时读取当前 DSH 主机自身的 ~/.ssh/config 解析 Host；不会修改或同步该文件，也读不到浏览器所在电脑的配置。', clearHistory: '清除记录', clearHistoryConfirm: '确定清除全部同步记录？不会删除节点和同步选项。', historyCleared: '同步记录已清除', planTitle: '差异', noChanges: '两端已一致。',
        install: '待安装插件', remove: '待移除插件', enable: '待启用', disable: '待停用',
        patchAdd: '配置待新增', patchUpdate: '配置待更新', patchRemove: '配置待移除',
        upload: '本地插件待上传', sshConfig: 'SSH Host', warnings: '提示', resultOk: '同步完成', resultFail: '同步失败',
        remote: '远端', version: '版本', reachable: '连接正常', unreachable: '无法连接',
        refresh: '刷新', close: '关闭', confirmDelete: '确定删除这个节点？',
        applyConfirm: '将把本机插件状态同步到该节点，继续？', never: '从未', seconds: '秒',
        probeOk: '连接正常', probeFail: '连接失败', back: '返回', noOptions: '暂无',
        selected: '当前节点', planFor: '的差异', running: '正在执行', done: '完成', of: '/',
      },
      en: {
        title: 'Plugin Sync',
        intro: "Sync installed plugins, versions, enable switches, and plugin config to another DSH node. Model-related config stays local.",
        nodes: 'Nodes', addNode: 'Add node', editNode: 'Edit node', deleteNode: 'Delete',
        noNodes: 'No node yet. Add an SSH host running DSH first.',
        name: 'Name', sshAlias: 'SSH host', sshHost: 'SSH config Host', host: 'Host', user: 'User', port: 'Port',
        keyPath: 'Key path', profile: 'Profile', dshHome: 'DSH_HOME', dshCommand: 'dsh command',
        chooseHost: 'Choose a dsh-ssh host', chooseSshHost: 'Follow ~/.ssh/config (recommended)', save: 'Save', cancel: 'Cancel', probe: 'Test',
        plan: 'Check diff', apply: 'Sync now', backup: 'Backup', syncing: 'Syncing', checking: 'Checking',
        options: 'Options', optPrune: 'Mirror exactly (remove extra plugins and rows)',
        optSshConfig: 'Read local SSH config (~/.ssh/config)', optSecrets: 'Sync secret fields (token / apiKey / password)',
        optLocalDeps: 'Install dependencies of uploaded local plugins', optCopyLocal: 'Upload local-directory plugins',
        optBackup: 'Back up the node before syncing', local: 'Local state', packages: 'Plugin dependencies',
        bundles: 'Enabled bundles', rows: 'Config rows', modelRows: 'Model config (skipped)',
        history: 'History', noHistory: 'No sync yet.', sshHint: "Resolve node connections from the current DSH host's ~/.ssh/config. The file is never modified or synced, and the browser machine's config is not readable.", clearHistory: 'Clear history', clearHistoryConfirm: 'Clear all sync records? Nodes and options are kept.', historyCleared: 'Sync history cleared',
        planTitle: 'Diff', noChanges: 'Both sides already match.', install: 'Plugins to install',
        remove: 'Plugins to remove', enable: 'Bundles to enable', disable: 'Bundles to disable',
        patchAdd: 'Config rows to add', patchUpdate: 'Config rows to update', patchRemove: 'Config rows to remove',
        upload: 'Local bundles to upload', sshConfig: 'SSH Hosts', warnings: 'Notes', resultOk: 'Sync complete',
        resultFail: 'Sync failed', remote: 'Remote', version: 'Version', reachable: 'Reachable',
        unreachable: 'Unreachable', refresh: 'Refresh', close: 'Close', confirmDelete: 'Delete this node?',
        applyConfirm: "Sync this machine's plugin state to the node?", never: 'Never', seconds: 's',
        probeOk: 'Reachable', probeFail: 'Unreachable', back: 'Back', noOptions: 'None',
        selected: 'Selected', planFor: ' diff', running: 'Running', done: 'done', of: '/',
      },
    };

    const CSS = `
.ps-page{box-sizing:border-box;block-size:100%;min-block-size:0;overflow:auto;display:flex;flex-direction:column;gap:18px;padding:20px 24px 40px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55}
@media (max-width:720px){.ps-page{padding:14px 14px 28px}}
.ps-head h2{margin:0 0 6px;font-size:18px;font-weight:600;letter-spacing:.01em}
.ps-head p{margin:0;color:var(--dsw-alias-label-secondary);max-width:760px}
.ps-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:16px}
.ps-card h3{margin:0 0 12px;font-size:14px;font-weight:600}
.ps-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.ps-card-head h3{margin:0}
.ps-muted{color:var(--dsw-alias-label-secondary)}
.ps-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.ps-stat{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2)}
.ps-stat b{display:block;font-size:19px;font-weight:600;line-height:1.25}
.ps-stat span{font-size:12px;color:var(--dsw-alias-label-secondary)}
.ps-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--dsw-alias-border-l2)}
.ps-row:first-child{border-top:none}
.ps-row-main{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.ps-row-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ps-row-meta{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ps-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.ps-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 11px;font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
.ps-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed)}
.ps-btn:disabled{opacity:.45;cursor:not-allowed}
.ps-btn-primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-label-primary));color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent;font-weight:600}
.ps-btn-danger{color:var(--dsw-alias-state-error-primary,#b42318)}
.ps-field{display:grid;grid-template-columns:130px minmax(0,1fr);align-items:center;gap:10px;padding:7px 0}
.ps-field label{color:var(--dsw-alias-label-secondary);font-size:12px}
.ps-input,.ps-select{box-sizing:border-box;width:100%;height:32px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:0 10px;font:inherit;font-size:13px}
.ps-input:focus-visible,.ps-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.ps-toggle{display:flex;align-items:center;gap:9px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l2);cursor:pointer}
.ps-toggle:first-of-type{border-top:none}
.ps-switch{appearance:none;border:0;background:0;padding:0;margin:0;flex:none;width:36px;height:20px;border-radius:999px;background:var(--dsw-alias-label-dimmed);position:relative;cursor:pointer}
.ps-switch:after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-3);box-shadow:0 1px 2px rgba(0,0,0,.2);transition:left .16s}
.ps-switch[aria-checked="true"]{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-label-primary))}
.ps-switch[aria-checked="true"]:after{left:18px}
.ps-switch:disabled{opacity:.45;cursor:not-allowed}
.ps-toggle-text{font-size:13px}
.ps-banner{border-radius:10px;padding:10px 12px;font-size:12px;border:1px solid transparent}
.ps-banner-error{background:color-mix(in srgb, var(--dsw-alias-state-error-primary,#b42318) 10%, transparent);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary,#b42318) 35%, transparent);color:var(--dsw-alias-state-error-primary,#b42318)}
.ps-banner-ok{background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#15803d) 10%, transparent);border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary,#15803d) 30%, transparent);color:var(--dsw-alias-state-success-primary,#15803d)}
.ps-banner-warn{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#b45309) 10%, transparent);border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#b45309) 30%, transparent);color:var(--dsw-alias-state-warn-primary,#b45309)}
.ps-chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ps-chip-ok{background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#15803d) 14%, transparent);color:var(--dsw-alias-state-success-primary,#15803d)}
.ps-chip-err{background:color-mix(in srgb, var(--dsw-alias-state-error-primary,#b42318) 14%, transparent);color:var(--dsw-alias-state-error-primary,#b42318)}
.ps-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.ps-list li{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 9px;font-family:var(--ds-font-family-code,monospace);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--dsw-alias-bg-layer-2)}
.ps-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.ps-sub{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:10px 0 6px}
.ps-job{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px}
.ps-spinner{width:12px;height:12px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:ps-spin .8s linear infinite}
@keyframes ps-spin{to{transform:rotate(360deg)}}
.ps-history{display:flex;flex-direction:column;gap:6px}
.ps-history-row{display:flex;align-items:baseline;gap:8px;font-size:12px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:6px}
.ps-history-row:first-child{border-top:none;padding-top:0}
.ps-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

    // Mutable runtime bridge: the settings section component renders after apply().
    const runtime = { ctx: undefined, t: (key) => key };

    function useLang() {
      const locale = runtime.ctx?.locale;
      const [id, setId] = useState(locale?.getSnapshot?.().id || 'zh');
      useEffect(() => {
        if (!locale?.subscribe) return undefined;
        return locale.subscribe(() => setId(locale.getSnapshot().id));
      }, [locale]);
      return id;
    }

    function useT() {
      const id = useLang();
      return (key) => (COPY[id] || COPY.en)[key] || (COPY.en[key] ?? key);
    }

    async function api(path, body) {
      const response = await fetch('/plugin-sync/api/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error('HTTP ' + response.status);
      }
      if (!response.ok || data?.ok === false) throw new Error(data?.error || ('HTTP ' + response.status));
      return data;
    }

    function Button({ children, onClick, disabled, variant }) {
      const cls = 'ps-btn' + (variant === 'primary' ? ' ps-btn-primary' : variant === 'danger' ? ' ps-btn-danger' : '');
      return h('button', { type: 'button', className: cls, onClick, disabled: Boolean(disabled) }, children);
    }

    function Toggle({ checked, onChange, label, disabled }) {
      return h('label', { className: 'ps-toggle' }, [
        h('button', {
          key: 'sw',
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          className: 'ps-switch',
          disabled: Boolean(disabled),
          onClick: () => onChange(!checked),
        }),
        h('span', { key: 'tx', className: 'ps-toggle-text' }, label),
      ]);
    }

    function Stat({ value, label }) {
      return h('div', { className: 'ps-stat' }, [h('b', { key: 'v' }, value), h('span', { key: 'l' }, label)]);
    }

    function Chip({ children, tone }) {
      return h('span', { className: 'ps-chip' + (tone === 'ok' ? ' ps-chip-ok' : tone === 'err' ? ' ps-chip-err' : '') }, children);
    }

    function NodeForm({ hostOptions, sshHostOptions, initial, onCancel, onSave, busy, t }) {
      const [draft, setDraft] = useState(initial || { name: '', sshAlias: '', sshHost: '', profile: 'web', dshHome: '~/.dsh', dshCommand: 'dsh' });
      const update = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));
      const aliasKnown = hostOptions.some((host) => host.alias === draft.sshAlias);
      const sshHostOptionsList = sshHostOptions || [];
      return h('div', { className: 'ps-card', 'data-dsh-part': 'node-form' }, [
        h('h3', { key: 'h' }, initial ? t('editNode') : t('addNode')),
        h('div', { className: 'ps-field', key: 'name' }, [h('label', { key: 'l' }, t('name')), h('input', { key: 'i', className: 'ps-input', value: draft.name, onChange: update('name'), placeholder: 'notebook' })]),
        h('div', { className: 'ps-field', key: 'alias' }, [
          h('label', { key: 'l' }, t('sshAlias')),
          h('select', { key: 's', className: 'ps-select', value: aliasKnown ? draft.sshAlias : '', onChange: update('sshAlias') }, [
            h('option', { key: '', value: '' }, '— ' + t('chooseHost') + ' —'),
            ...hostOptions.map((host) => h('option', { key: host.alias, value: host.alias }, host.alias + ' · ' + host.user + '@' + host.host + ':' + host.port)),
          ]),
        ]),
        h('div', { className: 'ps-field', key: 'sshHost' }, [
          h('label', { key: 'l' }, t('sshHost')),
          h('input', { key: 'i', className: 'ps-input', list: 'ps-ssh-hosts', value: draft.sshHost || '', onChange: update('sshHost'), placeholder: t('chooseSshHost') }),
          h('datalist', { key: 'd', id: 'ps-ssh-hosts' }, sshHostOptionsList.map((alias) => h('option', { key: alias, value: alias }))),
        ]),
        h('div', { className: 'ps-field', key: 'host' }, [h('label', { key: 'l' }, t('host')), h('input', { key: 'i', className: 'ps-input', value: draft.host || '', onChange: update('host'), placeholder: '192.168.1.10（可选）' })]),
        h('div', { className: 'ps-field', key: 'user' }, [h('label', { key: 'l' }, t('user')), h('input', { key: 'i', className: 'ps-input', value: draft.user || '', onChange: update('user'), placeholder: 'root（可选）' })]),
        h('div', { className: 'ps-field', key: 'port' }, [h('label', { key: 'l' }, t('port')), h('input', { key: 'i', className: 'ps-input', value: draft.port || '', onChange: update('port'), placeholder: '22' })]),
        h('div', { className: 'ps-field', key: 'profile' }, [h('label', { key: 'l' }, t('profile')), h('input', { key: 'i', className: 'ps-input', value: draft.profile || '', onChange: update('profile'), placeholder: 'web' })]),
        h('div', { className: 'ps-field', key: 'home' }, [h('label', { key: 'l' }, t('dshHome')), h('input', { key: 'i', className: 'ps-input', value: draft.dshHome || '', onChange: update('dshHome'), placeholder: '~/.dsh' })]),
        h('div', { className: 'ps-field', key: 'cmd' }, [h('label', { key: 'l' }, t('dshCommand')), h('input', { key: 'i', className: 'ps-input', value: draft.dshCommand || '', onChange: update('dshCommand'), placeholder: 'dsh' })]),
        h('div', { key: 'actions', className: 'ps-actions', style: { justifyContent: 'flex-start', marginTop: 8 } }, [
          h(Button, { key: 'save', variant: 'primary', disabled: busy || !draft.name, onClick: () => onSave({ ...draft, port: draft.port ? Number(draft.port) : undefined }) }, t('save')),
          h(Button, { key: 'cancel', onClick: onCancel }, t('cancel')),
        ]),
      ]);
    }

    function PlanView({ plan, t }) {
      if (!plan) return null;
      const c = plan.changes || {};
      const columns = [
        ['install', c.pluginsToInstall || [], (item) => item.name + (item.from ? '  ' + item.from + '→' + (item.to || '?') : '  ' + (item.to || ''))],
        ['upload', c.localBundleUploads || [], (item) => item.name],
        ['remove', c.pluginsToRemove || [], (item) => item.name],
        ['enable', c.bundlesToEnable || [], (name) => name],
        ['disable', c.bundlesToDisable || [], (name) => name],
        ['patchAdd', c.patchRowsToAdd || [], (id) => id],
        ['patchUpdate', c.patchRowsToUpdate || [], (id) => id],
        ['patchRemove', c.patchRowsToRemove || [], (id) => id],
      ].filter(([, items]) => items.length > 0);
      return h('div', { className: 'ps-card', 'data-dsh-part': 'plan' }, [
        h('div', { key: 'head', className: 'ps-card-head' }, [
          h('h3', { key: 'h' }, t('planTitle')),
          h(Chip, { key: 'c', tone: plan.changeCount === 0 ? 'ok' : undefined }, plan.summary),
        ]),
        plan.changeCount === 0 ? h('p', { key: 'none', className: 'ps-muted' }, t('noChanges')) : null,
        (plan.warnings || []).length > 0 ? h('div', { key: 'warn', className: 'ps-banner ps-banner-warn', style: { marginBottom: 10 } }, plan.warnings.map((warning) => h('div', { key: warning }, warning))) : null,
        h('div', { key: 'cols', className: 'ps-columns' }, columns.map(([key, items, format]) => h('div', { key }, [
          h('div', { key: 'h', className: 'ps-sub' }, t(key) + ' · ' + items.length),
          h('ul', { key: 'u', className: 'ps-list' }, items.map((item, index) => h('li', { key: index, title: typeof item === 'string' ? item : JSON.stringify(item) }, format(item)))),
        ]))),
      ]);
    }

    function PluginSyncIcon({ size }) {
      const edge = size || 16;
      return h('svg', {
        viewBox: '0 0 16 16', width: edge, height: edge, fill: 'none',
        stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, [
        h('circle', { key: 'a', cx: '4.8', cy: '4.6', r: '2.2' }),
        h('circle', { key: 'b', cx: '11.2', cy: '11.4', r: '2.2' }),
        h('path', { key: 'c', d: 'M6.9 4.6h2.2a2.2 2.2 0 0 1 2.2 2.2v1.1' }),
        h('path', { key: 'd', d: 'M9.1 11.4H6.9a2.2 2.2 0 0 1-2.2-2.2V8.1' }),
        h('path', { key: 'e', d: 'M10.1 7.3l1.2 1.2 1.2-1.2' }),
        h('path', { key: 'f', d: 'M5.9 8.7L4.7 7.5 3.5 8.7' }),
      ]);
    }

    function Page() {
      const t = useT();
      const [state, setState] = useState(null);
      const [error, setError] = useState('');
      const [notice, setNotice] = useState('');
      const [busy, setBusy] = useState('');
      const [selected, setSelected] = useState('');
      const [plan, setPlan] = useState(null);
      const [result, setResult] = useState(null);
      const [probe, setProbe] = useState({});
      const [form, setForm] = useState(null);
      const [startedAt, setStartedAt] = useState(0);
      const [elapsed, setElapsed] = useState(0);
      const alive = useRef(true);

      const load = useCallback(async () => {
        try {
          const data = await api('state');
          if (!alive.current) return;
          setState(data);
          setError('');
        } catch (loadError) {
          if (alive.current) setError(loadError.message);
        }
      }, []);

      useEffect(() => {
        alive.current = true;
        load();
        const timer = setInterval(() => { if (!document.hidden) load(); }, 5000);
        return () => { alive.current = false; clearInterval(timer); };
      }, [load]);

      useEffect(() => {
        if (!busy) return undefined;
        setElapsed(0);
        const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
        return () => clearInterval(timer);
      }, [busy, startedAt]);

      const options = state?.options || {};
      const nodes = state?.nodes || [];
      const sshHosts = state?.sshHosts || [];
      const sshConfigHosts = state?.sshConfigHosts || [];

      const toggleOption = async (key, value) => {
        try {
          await api('options', { options: { [key]: value } });
          await load();
        } catch (optionError) {
          setError(optionError.message);
        }
      };

      const runPlan = async (nodeId) => {
        setSelected(nodeId);
        setPlan(null);
        setResult(null);
        setBusy('plan:' + nodeId);
        setStartedAt(Date.now());
        try {
          const data = await api('plan', { nodeId });
          if (alive.current) setPlan(data.plan);
        } catch (planError) {
          setError(planError.message);
        } finally {
          setBusy('');
        }
      };

      const runApply = async (nodeId) => {
        if (!window.confirm(t('applyConfirm'))) return;
        setSelected(nodeId);
        setResult(null);
        setBusy('apply:' + nodeId);
        setStartedAt(Date.now());
        try {
          const data = await api('apply', { nodeId });
          if (alive.current) {
            setResult(data);
            setPlan(data.plan || null);
            setNotice(t('resultOk') + ' · ' + (data.plan?.summary || ''));
          }
          await load();
        } catch (applyError) {
          setError(applyError.message);
          setResult({ ok: false, error: applyError.message });
        } finally {
          setBusy('');
        }
      };

      const runProbe = async (nodeId) => {
        setProbe((current) => ({ ...current, [nodeId]: { loading: true } }));
        try {
          const data = await api('probe', { nodeId });
          setProbe((current) => ({ ...current, [nodeId]: data }));
        } catch (probeError) {
          setProbe((current) => ({ ...current, [nodeId]: { ok: false, error: probeError.message } }));
        }
      };

      const runBackup = async (nodeId) => {
        setBusy('backup:' + nodeId);
        try {
          const data = await api('backup', { nodeId });
          setNotice(t('backup') + ': ' + data.localDir);
          await load();
        } catch (backupError) {
          setError(backupError.message);
        } finally {
          setBusy('');
        }
      };

      const clearHistory = async () => {
        if (!window.confirm(t('clearHistoryConfirm'))) return;
        setBusy('history');
        try {
          const data = await api('history/clear', {});
          setNotice(t('historyCleared') + (data.cleared ? ' · ' + data.cleared : ''));
          await load();
        } catch (clearError) {
          setError(clearError.message);
        } finally {
          setBusy('');
        }
      };

      const saveNode = async (node) => {
        try {
          await api('node', { action: 'save', node });
          setForm(null);
          await load();
        } catch (saveError) {
          setError(saveError.message);
        }
      };

      const deleteNode = async (nodeId) => {
        if (!window.confirm(t('confirmDelete'))) return;
        try {
          await api('node', { action: 'delete', id: nodeId });
          if (selected === nodeId) { setSelected(''); setPlan(null); }
          await load();
        } catch (deleteError) {
          setError(deleteError.message);
        }
      };

      const job = (started) => started && nodes.find((node) => node.id === selected) && state?.jobs?.find((item) => item.nodeId === selected);
      const currentJob = job(startedAt);

      return h('div', { className: 'ps-page', 'data-dsh-plugin': 'plugin-sync', 'data-dsh-part': 'plugin-sync' }, [
        h('style', { key: 'css' }, CSS),
        h('div', { key: 'head', className: 'ps-head' }, [
          h('h2', { key: 'h' }, t('title')),
          h('p', { key: 'p' }, t('intro')),
        ]),

        error ? h('div', { key: 'err', className: 'ps-banner ps-banner-error', role: 'alert' }, error) : null,
        notice ? h('div', { key: 'ok', className: 'ps-banner ps-banner-ok', role: 'status' }, notice) : null,

        h('div', { key: 'local', className: 'ps-card' }, [
          h('div', { key: 'head', className: 'ps-card-head' }, [
            h('h3', { key: 'h' }, t('local')),
            h(Button, { key: 'refresh', onClick: load }, t('refresh')),
          ]),
          state?.local?.error ? h('div', { key: 'e', className: 'ps-banner ps-banner-error' }, state.local.error) : null,
          h('div', { key: 'grid', className: 'ps-grid' }, [
            h(Stat, { key: 'p', value: state?.local?.packages ?? '—', label: t('packages') }),
            h(Stat, { key: 'b', value: state?.local?.selectedBundles ?? '—', label: t('bundles') }),
            h(Stat, { key: 'r', value: state?.local?.configRows ?? '—', label: t('rows') }),
            h(Stat, { key: 'm', value: state?.local?.modelRows ?? '—', label: t('modelRows') }),
            h(Stat, { key: 'ssh', value: sshConfigHosts.length, label: t('sshConfig') }),
          ]),
        ]),

        h('div', { key: 'opts', className: 'ps-card' }, [
          h('h3', { key: 'h' }, t('options')),
          h(Toggle, { key: 'ssh', checked: options.readSshConfig !== false, label: t('optSshConfig'), onChange: (value) => toggleOption('readSshConfig', value) }),
          h('p', { key: 'sshHint', className: 'ps-muted', style: { margin: '-4px 0 8px 45px' } }, t('sshHint')),
          h(Toggle, { key: 'secrets', checked: options.includeSecrets !== false, label: t('optSecrets'), onChange: (value) => toggleOption('includeSecrets', value) }),
          h(Toggle, { key: 'local', checked: options.copyLocalBundles !== false, label: t('optCopyLocal'), onChange: (value) => toggleOption('copyLocalBundles', value) }),
          h(Toggle, { key: 'deps', checked: options.installLocalDeps !== false, label: t('optLocalDeps'), onChange: (value) => toggleOption('installLocalDeps', value) }),
          h(Toggle, { key: 'backup', checked: options.backupBeforeSync !== false, label: t('optBackup'), onChange: (value) => toggleOption('backupBeforeSync', value) }),
          h(Toggle, { key: 'prune', checked: options.prune === true, label: t('optPrune'), onChange: (value) => toggleOption('prune', value) }),
        ]),

        h('div', { key: 'nodes', className: 'ps-card' }, [
          h('div', { key: 'head', className: 'ps-card-head' }, [
            h('h3', { key: 'h' }, t('nodes')),
            h(Button, { key: 'add', variant: 'primary', onClick: () => setForm({}) }, t('addNode')),
          ]),
          form ? h(NodeForm, { key: 'form', hostOptions: sshHosts, sshHostOptions: sshConfigHosts, initial: form.id ? form : undefined, t, busy: Boolean(busy), onCancel: () => setForm(null), onSave: saveNode }) : null,
          nodes.length === 0 && !form ? h('p', { key: 'none', className: 'ps-muted' }, t('noNodes')) : null,
          nodes.map((node) => {
            const info = probe[node.id];
            const nodeBusy = busy.endsWith(':' + node.id);
            return h('div', { key: node.id, className: 'ps-row' }, [
              h('div', { key: 'main', className: 'ps-row-main' }, [
                h('div', { key: 'name', className: 'ps-row-name' }, [
                  node.name,
                  info ? h(Chip, { key: 'chip', tone: info.loading ? undefined : info.ok ? 'ok' : 'err' }, info.loading ? '…' : info.ok ? t('probeOk') + ' · ' + (info.dshVersion || '?') : t('probeFail')) : null,
                ]),
                h('div', { key: 'meta', className: 'ps-row-meta' }, (node.sshHost ? '~/.ssh/config:' + node.sshHost + ' · ' : '') + (node.sshAlias ? node.sshAlias + ' · ' : '') + (node.profile || 'web') + ' · ' + (node.dshHome || '~/.dsh') + (info && !info.ok && info.error ? ' · ' + info.error : '')),
              ]),
              h('div', { key: 'actions', className: 'ps-actions' }, [
                h(Button, { key: 'probe', disabled: nodeBusy, onClick: () => runProbe(node.id) }, t('probe')),
                h(Button, { key: 'plan', disabled: nodeBusy, onClick: () => runPlan(node.id) }, busy === 'plan:' + node.id ? t('checking') : t('plan')),
                h(Button, { key: 'apply', variant: 'primary', disabled: nodeBusy, onClick: () => runApply(node.id) }, busy === 'apply:' + node.id ? t('syncing') : t('apply')),
                h(Button, { key: 'backup', disabled: nodeBusy, onClick: () => runBackup(node.id) }, t('backup')),
                h(Button, { key: 'edit', onClick: () => setForm(node) }, t('editNode')),
                h(Button, { key: 'del', variant: 'danger', onClick: () => deleteNode(node.id) }, t('deleteNode')),
              ]),
            ]);
          }),
        ]),

        currentJob ? h('div', { key: 'job', className: 'ps-card ps-job' }, [
          h('span', { key: 's', className: 'ps-spinner' }),
          h('span', { key: 'p' }, t('running') + ': ' + (currentJob.message || currentJob.phase)),
          h('span', { key: 'e', className: 'ps-muted' }, elapsed + ' ' + t('seconds')),
        ]) : null,

        h(PlanView, { key: 'planview', plan, t }),

        result ? h('div', { key: 'result', className: 'ps-card' }, [
          h('h3', { key: 'h' }, result.ok ? t('resultOk') : t('resultFail')),
          h('div', { key: 'sum', className: 'ps-muted' }, result.plan?.summary || result.error || ''),
          (result.warnings || []).length > 0 ? h('div', { key: 'w', className: 'ps-banner ps-banner-warn', style: { marginTop: 10 } }, result.warnings.map((warning) => h('div', { key: warning }, warning))) : null,
        ]) : null,

        h('div', { key: 'history', className: 'ps-card' }, [
          h('div', { key: 'head', className: 'ps-card-head' }, [
            h('h3', { key: 'h' }, t('history')),
            (state?.history || []).length > 0 ? h(Button, { key: 'clear', variant: 'danger', disabled: busy === 'history', onClick: clearHistory }, busy === 'history' ? '…' : t('clearHistory')) : null,
          ]),
          (state?.history || []).length === 0 ? h('p', { key: 'none', className: 'ps-muted' }, t('noHistory')) : null,
          h('div', { key: 'list', className: 'ps-history' }, (state?.history || []).map((item, index) => h('div', { key: item.at + '-' + index, className: 'ps-history-row' }, [
            h(Chip, { key: 'c', tone: item.ok ? 'ok' : 'err' }, item.ok ? 'OK' : 'FAIL'),
            h('span', { key: 'n', style: { fontWeight: 600 } }, item.nodeName || item.id),
            h('span', { key: 's', className: 'ps-grow ps-muted' }, item.summary || item.error || ''),
            h('span', { key: 't', className: 'ps-muted' }, new Date(item.at).toLocaleString()),
          ]))),
        ]),
      ]);
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        runtime.ctx = ctx;
        const dicts = { zh: COPY.zh, en: COPY.en };
        let disposeLocale;
        try {
          disposeLocale = ctx.locale.register(NS, dicts);
        } catch {
          disposeLocale = undefined;
        }
        const t = (key) => {
          try {
            return ctx.locale.bind(NS)(key);
          } catch {
            return (COPY[ctx.locale.getSnapshot().id] || COPY.en)[key] || key;
          }
        };
        runtime.t = t;
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'plugin-sync',
          order: 40,
          label: () => t('title'),
        }, PluginSyncIcon)));
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'plugin-sync',
        }, Page)));
        if (disposeLocale) ctx.effect(() => disposeLocale);
      },
    };
  },
});
