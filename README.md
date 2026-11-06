---
description: "Back up and sync DSH plugins, configuration switches, and Agent Center teams to other DSH nodes."
kind: "package-reference"
---

# dsh-plugin-sync

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.3-4c6ef5?style=flat-square" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>Back up and sync DSH plugins, switches, and Agent Center teams to another node.</strong><br>
  <em>Settings page · five Agent tools · install missing plugins first, then apply config.</em>
</p>

A DeepSeek Harness (DSH) Web plugin that exports this profile's installed plugins, bundle selection, `cordis.patch.yml` configuration, and Agent Center teams, then applies them to another DSH node over SSH. A remote plugin missing from the target is installed **before** its configuration is written. Model-related configuration is never copied; each side keeps its own model routes.

## Features

- **Installed plugins and versions** — writes the profile dependencies to the target, then runs `dsh plugin --profile <profile> install`. Missing packages are installed; version drift is corrected to the local installed version.
- **Enable switches** — the remote `dsh.profile.bundles` list follows this machine. A plugin disabled here is disabled there.
- **Plugin configuration** — `cordis.patch.yml` rows are merged by id. Remote comments, `!!js` expressions, model rows, and untouched rows survive; local insert rows are added when absent.
- **Local-directory bundles** — `link:` / `file:` plugins are packed to `$DSH_HOME/plugin-sync/bundles/<name>` on the target, linked into the profile, and re-uploaded only when their content fingerprint changes.
- **Agent Center teams** — merges `dsh-agents/ledger.json` `teams` by name. Remote team ids, member ids, and `runs` history are preserved.
- **Model configuration is excluded** — rows and dependencies matching `llm`, `model`, or `web-search` are skipped, `settings.yaml` is never written, local team model pins are not copied, and existing remote pins are preserved.
- **Backups** — before applying, the target's `package.json`, lockfile, patch, and team ledger are copied to `$DSH_HOME/plugin-sync/backups/<timestamp>/`.
- **Safe by default** — remote-only plugins, rows, and teams are kept unless **Mirror exactly** is enabled.

## Install

From GitHub:

```sh
dsh plugin --profile web add github:Fansirsqi/dsh-plugin-sync
```

Pin a release:

```sh
dsh plugin --profile web add github:Fansirsqi/dsh-plugin-sync#v0.1.0
```

Restart `dsh web` if the settings section or tools do not appear after installation.

Requirements: DSH `>= 0.2.1-rc.3` and Node.js `^22.19.0 || >=24.0.0`.

## Use

Open **Settings → Plugin Sync**.

1. Add a node: choose a host from `~/.dsh/dsh-ssh.json` (recommended), or fill in host / user / port / key path.
2. Set the remote `profile` (default `web`), `DSH_HOME` (default `~/.dsh`), and `dsh` command.
3. **Check diff**, review the plan, then **Sync now**.
4. Enable **Mirror exactly** only when the target should lose everything this machine does not have.

The same operations are available to an Agent:

| Tool | Purpose |
| --- | --- |
| `plugin_sync_status` | Local plugin/team counts, configured nodes, recent runs. |
| `plugin_sync_plan` | Connect to a node and return the exact diff. |
| `plugin_sync_apply` | Install missing plugins, then apply configuration and teams. |
| `plugin_sync_backup` | Export a local backup; with a node, also back up the target. |
| `plugin_sync_nodes` | List, add, or remove sync nodes. |

Example prompts:

> Sync my plugins to the notebook node.

> Add the `notebook` SSH host as a sync node, check the diff, then sync it.

## What is synced

| Item | Behavior |
| --- | --- |
| Dependencies | Local `package.json` dependencies except model-related ones. Missing/outdated packages install first. |
| Bundle switches | `dsh.profile.bundles` mirrors this machine; a locally disabled plugin is disabled remotely. |
| Plugin config | `cordis.patch.yml` rows merge by id; insert rows are added when missing. |
| Local bundles | Source directories are uploaded and linked; content fingerprints avoid needless uploads. |
| Agent Center teams | Teams merge by name; remote ids and run history are preserved. |
| Model config | Skipped: model/search rows and dependencies, `settings.yaml`, and team model pins. |
| Secrets | Synced by default because MCP servers need them; turn this off in Settings if the target must not receive tokens. |

## Apply order

1. Read both snapshots and build the diff.
2. Back up the target.
3. Upload changed local-directory bundles and install their own dependencies when needed.
4. Write dependencies first and run `dsh plugin --profile <profile> install`, so missing plugins exist before any configuration references them.
5. Merge `cordis.patch.yml`.
6. Write the final bundle selection; when mirroring, install once more to prune removed dependencies.
7. Merge Agent Center teams.
8. Re-read the target and verify dependency versions, config rows, enabled bundles, and team names.

If an install stage fails, `package.json` and the lockfile are restored from the backups taken for that run.

## Settings

- **Sync Agent Center teams** — on by default.
- **Sync secret fields** — on by default; controls `token` / `apiKey` / `password` values.
- **Upload local-directory plugins** — on by default.
- **Install dependencies of uploaded local plugins** — on by default.
- **Back up the node before syncing** — on by default.
- **Mirror exactly** — off by default; deletes remote-only plugins, rows, and teams.

Node definitions and history live in `$DSH_HOME/plugin-sync/config.json` (mode 0600).

## Requirements and limits

- The target must run DSH on Linux and be reachable over SSH. If `dsh` is missing, apply refuses before making changes.
- Package installs use the target's `dsh plugin` (pnpm). Build-script approval and native toolchains remain the target's responsibility.
- A newly installed plugin may need a target `dsh web` restart if HMR does not surface it.
- A local bundle that declares its own native dependencies needs a matching build environment on the target; uploaded bundles install with `pnpm install --prod --ignore-scripts`.
- Different DSH versions across nodes produce a warning, not a hard stop.
- Teams that pin a preset or workspace the target does not serve will fail when run there; the plugin syncs definitions, not those registries.
- Backups are file-level snapshots; they do not include `node_modules`. Restore by copying files back and running `dsh plugin install`.

## Development

No runtime dependency is declared; the plugin borrows the profile's `yaml` package. This repository has a syntax check:

```sh
npm test
```

Layout:

```text
index.js            Host entry (routes + tools)
client.js           Settings → Plugin Sync page
lib/snapshot.js     Local/remote snapshots
lib/plan.js         Diff calculation
lib/merge.js        package.json and team ledger merges
lib/yaml.js         cordis.patch.yml merge (comments and !!js preserved)
lib/ssh.js          SSH transport, remote install, directory upload
lib/service.js      Apply orchestration and backups
lib/store.js        Node/options/history store
lib/routes.js       /plugin-sync/api/*
lib/tools.js        Agent tools
lib/trust.js        Loopback/same-origin guard
locale/{zh,en}.json Plugin metadata
icon.svg            Plugin icon
```

## License

MIT © 2026 Fansirsqi
