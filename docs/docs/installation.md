---
sidebar_position: 2
---

# Installation

Qoderian is desktop-only (macOS, Linux, Windows) and needs Obsidian v1.7.2+ plus a signed-in [Qoder CLI](https://qoder.com).

## 1. Install and sign in to Qoder CLI

Install with the official script (recommended):

**macOS / Linux**

```bash
curl -fsSL https://qoder.com/install | bash
```

**Windows — PowerShell** (Windows Terminal recommended)

```powershell
irm https://qoder.com/install.ps1 | iex
```

Or through npm (requires Node.js ≥ 20):

```bash
npm install -g @qoder-ai/qodercli
```

The installer puts `qodercli` on your PATH; Windows on arm64 is not supported. Then sign in from a terminal:

```bash
qodercli login
```

Sign-in is managed entirely by your local CLI; Qoderian never asks for an API key.

## 2. Install the plugin

### From Obsidian Community Plugins (recommended)

1. Open Obsidian → Settings → Community plugins → Browse
2. Search for "Qoderian" and click Install
3. Enable the plugin

### From GitHub Release

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/QoderAI/qoderian/releases/latest)
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
   git clone https://github.com/QoderAI/qoderian.git qoderian
   cd qoderian
   ```
2. Install dependencies and build:
   ```bash
   npm ci
   npm run build
   ```
   This writes `main.js` and `styles.css` next to `manifest.json`, which is where Obsidian loads them from.
3. Enable the plugin in Obsidian

## 3. Start using

Open the chat sidebar from the ribbon icon or the command palette (`Open Qoderian`). Type a message and press **Enter**; qodercli streams its response back into the panel and works on your vault files just like the terminal CLI.
