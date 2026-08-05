# Qoderian

An Obsidian plugin that embeds [Qoder CLI](https://qoder.com) (`qodercli`) in your vault. Your vault becomes the agent's working directory — file read/write, search, bash, and multi-step workflows all work out of the box.

![Qoderian in an agentic Obsidian workspace](assets/preview.png)

## Features & Usage

Open the chat sidebar from the ribbon icon or the command palette (`Open Qoderian`). Type a message and press **Enter**; qodercli streams its response back into the panel. Everything works like the qodercli you already know — it reads, writes, edits, and searches files in your vault.

**`@mention`** — Type `@` to bring vault notes, the current selection, or external directories into context. Attached files appear as removable chips above the input.

**Inline Edit** — Select text in a note and run the inline-edit command to rewrite it in place, with a diff preview before you accept.

**Slash Commands & Skills** — Type `/` for built-in and project-level commands. Skills, agents, and hooks are read from the same Qoder CLI project files, so what works in the terminal works here.

**Permission Modes** — Choose Ask, Allow edits, Auto, Plan, or YOLO directly from the chat toolbar. `Ask` confirms each sensitive operation, `Allow edits` auto-approves file edits, `Auto` lets the SDK decide without prompting, `Plan` restricts the agent to read-only exploration, and `YOLO` skips per-call confirmation. The modes map to Qoder SDK permission policies without plugin-specific command rules.

**Instruction Mode (`#`)** — Press `#` in an empty input to write a custom instruction, which is refined before being applied.

**Bash Mode (`!`)** — Press `!` in an empty input to run a shell command in the vault directory directly.

**Model & Effort Controls** — Pick a model and reasoning effort below the input, and watch context usage reported by the Qoder Agent SDK.

**MCP Servers** — Connect external tools over the Model Context Protocol (stdio, SSE, HTTP), configured in-app.

**Multi-Tab & Conversations** — Multiple chat tabs, each with its own history, plus resume, fork, and rewind.

**Subagents** — Nested agent runs are grouped and rendered inline so you can follow what each one did.

### Models

| Model | Description |
|-------|-------------|
| `auto` | Model auto-selected (default) |
| `ultimate` | Highest capability |
| `performance` | Balanced performance |
| `efficient` | Fast and cost-effective |
| `lite` | Lightweight and fast |

Adaptive thinking models accept an effort level of `Low`, `Med`, `High`, `XHigh`, or `Max`. The selector consumes the runtime catalog returned by the Qoder Agent SDK, including models configured in qodercli.

## Requirements

- [Qoder CLI](https://qoder.com) (`qodercli`) installed, signed in, and available on your PATH
- Obsidian v1.7.2+
- Desktop only (macOS, Linux, Windows)

Verify the CLI is reachable:

```bash
qodercli --version
```

## Installation

### From Obsidian Community Plugins (recommended once published)

1. Open Obsidian → Settings → Community plugins → Browse
2. Search for "Qoderian" and click Install
3. Enable the plugin

### From GitHub Release

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest)
2. Create a folder called `qoderian` in your vault's plugins folder:
   ```
   /path/to/vault/.obsidian/plugins/qoderian/
   ```
3. Copy the downloaded files into that folder
4. Enable the plugin in Obsidian: Settings → Community plugins → turn off Restricted mode → enable "Qoderian"

### From source

1. Clone the repository into your vault's plugins folder:
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone <repository-url> qoderian
   cd qoderian
   ```
2. Install dependencies and build:
   ```bash
   npm ci
   npm run build
   ```
   This writes `main.js` and `styles.css` next to `manifest.json`, which is where Obsidian loads them from.
3. Enable the plugin in Obsidian

### Development

```bash
# Watch mode; rebuilds on change
npm run dev

# Production build
npm run build

# Checks
npm run typecheck
npm run lint
npm run test
npm run test:coverage
npm run audit:prod
```

Copy `.env.local.example` to `.env.local` and set `OBSIDIAN_VAULT` to have development builds copied into a local vault automatically.

For SDK or qodercli lifecycle changes, run the initialization-only smoke check
against a signed-in local CLI. It follows the official model-selection sample:

```bash
npm run smoke:qoder
# Optional when qodercli is not on PATH:
QODER_CLI_PATH=/absolute/path/to/qodercli npm run smoke:qoder
```

The smoke check starts an idle Query, reads runtime model metadata, and closes
the Query without sending a user turn.

## Configuration

Open **Settings → Qoderian**:

| Setting | Description |
|---------|-------------|
| **CLI path** | Path to the `qodercli` executable (auto-detected by default) |
| **MCP servers** | External MCP tool servers (stdio / SSE / HTTP) |

## Privacy & Data Use

- **Sent to Qoder**: Your input, attached notes and images, and tool results are sent to Qoder services through `qodercli`. How that data is handled is governed by Qoder's terms of service and privacy policy.
- **Local storage**: Qoderian settings and session metadata live in `vault/.qoderian/`; Qoder CLI project files, commands, skills, agents, and MCP configuration live in `vault/.qoder/`; native transcripts are managed by qodercli itself. Obsidian stores the open-tab layout in `.obsidian/plugins/qoderian/data.json`.
- **Credentials**: Qoderian never bundles, generates, or asks for a Qoder API key — sign-in is managed by your local `qodercli` and is never copied into your vault. Secrets may appear in third-party MCP configurations stored in `.qoder/mcp.json`; never commit or sync that file somewhere untrusted.
- **Environment variables**: The qodercli subprocess inherits Obsidian's process environment. Qoderian does not persist environment-variable overrides in the vault.
- **File and shell access**: Depending on your permission mode and confirmations, qodercli may read, create, modify, or delete files and run shell commands. Understand the risks before enabling `YOLO`, and keep backups or version control for an important vault.
- **Reach beyond the vault**: External context and MCP servers may access files outside your vault or third-party network services, under those services' own rules.
- **Background activity**: Qoderian runs no telemetry of its own. Network activity is limited to qodercli and the MCP endpoints you configure.

Redact settings, logs, and screenshots before filing an issue.

## Troubleshooting

### qodercli not found

If you see `spawn qodercli ENOENT`, the plugin could not auto-detect your installation. This is common with Node version managers (nvm, fnm, volta), because GUI apps like Obsidian do not inherit your shell's PATH.

Leave the CLI path empty first so auto-detection can run. If it still fails, find the path and set it in **Settings → CLI path**:

| Platform | Command | Example path |
|----------|---------|--------------|
| macOS / Linux | `which qodercli` | `/Users/you/.local/bin/qodercli` |
| Windows | `where.exe qodercli` | `C:\Users\you\AppData\Local\qodercli\qodercli.exe` |
| npm install | `npm root -g` | `{root}\@qoder-ai\qodercli\cli.js` |

On Windows, prefer the native executable over `.cmd` or `.ps1` wrappers.

### CLI and Node.js in different directories

If you installed the CLI through npm, check whether `qodercli` and `node` resolve to the same place:

```bash
dirname $(which qodercli)
dirname $(which node)
```

If they differ, Obsidian may find the CLI but not the Node.js runtime it needs. Prefer the native qodercli binary or install Node.js in a standard location visible to desktop applications, then restart Obsidian.

### Process exit code 42

This usually means incompatible arguments. Qoderian filters and converts SDK-supplied arguments into a qodercli-compatible form; if it still happens, please open an issue with the error log.

### Nothing happens after enabling the plugin

1. Confirm Obsidian is 1.7.2 or later
2. Confirm Restricted mode is off (Settings → Community plugins)
3. Restart Obsidian
4. Check the developer console (`Ctrl+Shift+I` / `Cmd+Option+I`) for errors

## Architecture

```
src/
├── main.ts                   # Plugin entry point
├── app/                      # Plugin lifecycle, settings, and Obsidian-level storage
├── core/                     # Stable app domain, runtime contracts, and host utilities
│   ├── runtime/                 # ChatRuntime boundary and turn contracts
│   └── ...                      # conversation types, settings, filesystem, context, markdown parsing
├── qoder/                    # qodercli and Qoder Agent SDK integration
│   ├── qoder-services.ts         # Qoder service composition root
│   ├── qoder-host-context.ts     # Narrow host contract; no dependency on main.ts
│   ├── runtime/                 # Sessions, message channel, CLI discovery, approval, process adapters
│   ├── stream/                  # SDK message types and stream transformation
│   ├── history/                 # Native transcript reading, resume, and forking
│   ├── tools/ mcp/               # Qoder tool vocabulary and SDK MCP option adapters
│   ├── services/                # Cold-start services: inline edit, refine, titles
│   ├── models/ config/          # Model catalog and Qoder settings
│   └── storage/                 # Commands, skills, agents, plugins, MCP config
├── features/
│   ├── chat/                    # Sidebar chat: tabs, controllers, renderers
│   ├── inline-edit/             # Inline edit modal and preview
│   └── settings/                # Settings shell and CLI settings UI (agents, plugins, commands)
├── shared/                   # Reusable UI components and modals
├── i18n/                     # Internationalization (10 locales)
└── style/                    # Modular CSS
```

Qoderian drives qodercli through the pinned `@qoder-ai/qoder-agent-sdk@1.0.16`; `custom-spawn.ts` only handles Obsidian/Electron process compatibility. Qoder is the only integration, so there is no provider registry, capability matrix, or routing layer. See [ARCHITECTURE.md](ARCHITECTURE.md) for dependency rules and the SDK lifecycle conventions followed from the [official TypeScript samples](https://github.com/QoderAI/qoder-agent-sdk-samples/tree/main/typescript).

## Releasing

```bash
# Bump the version (syncs package.json, both manifests, and versions.json)
npm version patch   # 1.0.0 → 1.0.1

# Verify the build output
npm run build
npm run release:check

# Push the tag to trigger the release workflow
git push --follow-tags
```

`.npmrc` sets npm's tag prefix to empty, so a `1.0.1` tag matches `manifest.json` exactly. The workflow builds from source and attaches `main.js`, `manifest.json`, and `styles.css` to the GitHub Release.

## Acknowledgements

- [Obsidian](https://obsidian.md) — a powerful knowledge base
- [qodercli](https://qoder.com) — AI coding assistant
- [Claudian](https://github.com/YishenTu/claudian) — Qoderian started from this MIT-licensed project; thanks to its author and contributors for the foundation

## Contributing

Issues and focused pull requests are welcome. Please read the [contribution guide](CONTRIBUTING.md) before opening a pull request, and report security issues privately per [SECURITY.md](SECURITY.md).

## License

Qoderian source code is licensed under the [MIT License](LICENSE). Use of the
Qoder Agent SDK and Qoder services is governed by the
[Qoder Product Service Terms](https://qoder.com/product-service). Third-party
and upstream attribution is listed in [NOTICE](NOTICE).
