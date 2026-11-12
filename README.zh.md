---
description: "把本机 DSH 插件、配置开关与智能体中心团队备份并同步到其他 DSH 节点。"
kind: "package-reference"
---

# dsh-plugin-sync

[English](README.md) | 中文

<p align="center">
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.3-4c6ef5?style=flat-square" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>把本机 DSH 插件、开关和智能体中心团队同步到另一台节点。</strong><br>
  <em>设置页 · 五个 Agent 工具 · 先装缺失插件，再写配置。</em>
</p>

这是 DeepSeek Harness（DSH）Web 的插件：导出当前 profile 的已安装插件、启用开关、`cordis.patch.yml` 配置、智能体中心团队和 `~/.ssh/config` Host 段，再通过 SSH 应用到另一台 DSH 节点。远端缺失的插件会**先安装**，然后才写引用它的配置。模型相关配置不会跨节点复制，两端各自保留自己的模型路由。

## 功能

- **已安装插件与版本**：把 profile 依赖写入远端，然后执行 `dsh plugin --profile <profile> install`。缺失的插件会安装，版本不一致会按本机已安装版本纠正。
- **启用开关**：远端 `dsh.profile.bundles` 跟随本机；本机停用的插件在远端也停用。
- **插件配置**：`cordis.patch.yml` 按 row id 合并。远端注释、`!!js` 表达式、模型行和未涉及的行都会保留；本机有、远端没有的 insert 行会补上。
- **本地目录插件**：`link:` / `file:` 插件会打包上传到远端 `$DSH_HOME/plugin-sync/bundles/<name>`，以 link 方式安装；按内容指纹判断是否需要重传。
- **智能体中心团队**：按团队名合并 `dsh-agents/ledger.json` 的 `teams`，保留远端团队 id、成员 id 和 `runs` 历史。
- **SSH 配置**：按 Host 别名合并 `~/.ssh/config`，主机名、端口、用户或 ProxyCommand 改了会跟着同步；远端独有的 Host 段保留，写入前会备份。
- **实时 Host 解析**：节点可以直接选择 OpenSSH 的 Host（如 `fedora`），连接时实时读取当前 `~/.ssh/config`。这样 IP 变了不用改节点里的缓存地址。
- **模型配置例外**：id 或包名匹配 `llm`、`model`、`web-search` 的行和依赖不同步；`settings.yaml` 不写入；本机团队成员的模型 pin 不复制，远端已有 pin 保留。
- **备份**：同步前把远端 `package.json`、锁文件、patch 和团队账本复制到 `$DSH_HOME/plugin-sync/backups/<时间戳>/`。
- **默认安全**：默认保留远端独有的插件、配置行和团队；只有打开 **完全镜像** 才会删除。

## 安装

从 GitHub 安装：

```sh
dsh plugin --profile web add github:Fansirsqi/dsh-plugin-sync
```

固定到某个版本：

```sh
dsh plugin --profile web add github:Fansirsqi/dsh-plugin-sync#v0.2.1
```

安装后如果设置页或工具没有出现，重启一次 `dsh web`。

要求：DSH `>= 0.2.1-rc.3`，Node.js `^22.19.0 || >=24.0.0`。

## 使用

打开 **设置 → 插件同步**。

1. 添加节点：在 **SSH 配置别名** 中选择 `~/.ssh/config` 里的 Host（推荐，实时读取），或选择 `dsh-ssh` 主机，或直接填写 host / user / port / keyPath。
2. 设置远端 `profile`（默认 `web`）、`DSH_HOME`（默认 `~/.dsh`）和 `dsh` 命令。
3. 点击 **检查差异**，确认后点击 **立即同步**。
4. 只有确实希望远端删除本机没有的内容时，才打开 **完全镜像**。

也可以让 Agent 调用这些工具：

| 工具 | 用途 |
| --- | --- |
| `plugin_sync_status` | 本机插件/团队数量、已配置节点、最近同步记录。 |
| `plugin_sync_plan` | 连接节点并返回精确差异。 |
| `plugin_sync_apply` | 先安装缺失插件，再应用配置和团队。 |
| `plugin_sync_backup` | 导出本机备份；带节点时同时备份远端。 |
| `plugin_sync_nodes` | 查看、添加或删除同步节点。 |

示例：

> 把我的插件同步到 notebook 节点。

> 把 notebook 加为同步节点，先检查差异再同步。

## 同步内容

| 内容 | 行为 |
| --- | --- |
| 依赖 | 本机 `package.json` 依赖（模型类除外）；缺失或版本不一致时先安装。 |
| 插件开关 | `dsh.profile.bundles` 与本机对齐；本机停用的插件在远端也停用。 |
| 插件配置 | `cordis.patch.yml` 按 id 合并；缺失的 insert 行会补上。 |
| 本地目录插件 | 上传源码并以 link 安装；内容指纹避免重复上传。 |
| 智能体团队 | 按名称合并；保留远端 id 和运行历史。 |
| SSH 配置 | `~/.ssh/config` 按 Host 别名合并；保留远端独有段，写入前备份。 |
| 模型配置 | 跳过：模型/搜索行与依赖、`settings.yaml`、团队模型 pin。 |
| 密钥 | 默认同步（MCP 需要）；如果远端不应收到 token，可在设置中关闭。 |

## 执行顺序

1. 读取两端快照，计算差异。
2. 备份远端。
3. 上传有变化的本地目录插件，必要时安装其自身依赖。
4. **先写依赖并执行 `dsh plugin --profile <profile> install`**，保证配置引用插件时它已经存在。
5. 合并 `cordis.patch.yml`。
6. 写入最终 bundle 启用列表；完全镜像时再安装一次以清理被移除的依赖。
7. 合并智能体中心团队。
8. 合并 `~/.ssh/config` Host 段。
9. 重新读取远端，校验依赖版本、配置行、启用项、团队名称和 SSH Host。

如果安装阶段失败，会用本次的备份恢复远端的 `package.json` 和锁文件。

## 设置项

- **同步智能体中心团队**：默认开。
- **同步 SSH 配置（`~/.ssh/config`）**：默认开；合并 Host 段并保留远端独有项。
- **同步密钥字段**：默认开；控制 `token` / `apiKey` / `password`。
- **上传本地目录插件**：默认开。
- **为上传的本地插件安装依赖**：默认开。
- **同步前备份对端**：默认开。
- **完全镜像**：默认关；会删除远端独有的插件、配置行和团队。

节点与同步记录保存在 `$DSH_HOME/plugin-sync/config.json`（0600）。

## 前提与限制

- 远端必须是运行 DSH 的 Linux 节点，并且 SSH 可达；没有 `dsh` 命令时 apply 会在改动前拒绝执行。
- 节点连接优先使用 `~/.ssh/config` 的 Host。`dsh-ssh` 别名保存的是主机快照，IP 变了会过期；SSH 配置 Host 是实时读取的。
- 安装通过远端的 `dsh plugin`（pnpm）完成；构建脚本审批和原生工具链仍由远端负责。
- 新安装插件如果页面没有出现，重启一次远端 `dsh web` 即可。
- 本地目录插件如果声明了原生依赖，远端需要对应的构建环境；默认执行 `pnpm install --prod --ignore-scripts`。
- 两端 DSH 版本不同会给出警告，不会强制中止。
- 团队如果钉了远端不存在的 preset 或 workspace，运行时会失败；本插件只同步定义，不同步这些注册表。
- 备份是文件级快照，不包含 `node_modules`；恢复时把文件复制回 profile 后重新执行 `dsh plugin install`。

## 开发

插件本身没有运行时依赖，YAML 解析复用 profile 里的 `yaml`。仓库自带语法检查和 SSH 配置测试：

```sh
npm test
```

目录：

```text
index.js            Host 入口（routes + tools）
client.js           设置 → 插件同步页面
lib/snapshot.js     本机/远端快照
lib/plan.js         差异计算
lib/merge.js        package.json 与团队账本合并
lib/yaml.js         cordis.patch.yml 合并（保留注释和 !!js）
lib/ssh.js          SSH 传输、实时 Host 解析、远端安装、目录上传
lib/ssh-config.js   ~/.ssh/config 解析与 Host 合并
lib/service.js      同步编排与备份
lib/store.js        节点/选项/历史存储
lib/routes.js       /plugin-sync/api/*
lib/tools.js        Agent 工具
lib/trust.js        loopback/同源校验
locale/{zh,en}.json 插件元数据
icon.svg            插件图标
test/ssh-config.test.mjs  SSH 配置 Host 合并测试
```

## 许可证

MIT © 2026 Fansirsqi
