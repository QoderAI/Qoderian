---
sidebar_position: 4
---

# FAQ

### Does Qoderian work on mobile?

No. Qoderian is desktop-only (macOS, Linux, Windows) because it runs the local Qoder CLI, which needs full file system and shell access.

### Does Qoderian need an API key?

No. Sign-in is managed entirely by your local Qoder CLI (`qodercli login`); the plugin never asks for an API key.

### What are the requirements?

Obsidian v1.7.2+ and a signed-in Qoder CLI on the same machine. Windows on arm64 is not supported.

### Where does the agent work?

In your vault. Your vault is the agent's working directory, so file read/write, search, bash, and multi-step workflows work out of the box.

### How do I report a bug or request a feature?

Open an issue on [GitHub](https://github.com/QoderAI/qoderian/issues).
