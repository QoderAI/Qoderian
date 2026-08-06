# Changelog

All notable user-visible changes to Qoderian are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
Omit any category with no entries. On release, rename `[Unreleased]` to the
version with its date and start a fresh empty `[Unreleased]` above it.

## [Unreleased]

## [1.0.2] - 2026-08-06

### Added

- Plugin settings are now searchable from Obsidian's settings search
  (Obsidian 1.13+).

### Changed

- GitHub releases now include build provenance attestations, so the
  plugin files can be verified against this repository.
- Replaced deprecated Obsidian APIs (`setWarning`, `setDynamicTooltip`)
  with their 1.13 replacements, keeping fallbacks for older versions.

## [1.0.1] - 2026-08-06

### Fixed

- Resolved all blocking findings from the community plugin review: the icon
  renderer no longer assigns `innerHTML`, and every UI element is created
  through Obsidian's `createEl` helpers instead of native DOM APIs.
- Restored the standard MIT license text so GitHub recognizes the repository
  license; Claudian attribution details now live in `NOTICE`.
- Removed type assertions, a stray `await`, and unhandled-promise patterns
  flagged by the review's static analysis.

### Changed

- GitHub releases now attach only `main.js`, `manifest.json`, and
  `styles.css`; the license and attribution stay embedded in `main.js`.

## [1.0.0] - 2026-08-03

### Added

- Qoder CLI chat embedded in the Obsidian sidebar, using the active vault as the
  working directory.
- Multi-tab conversations with session persistence, resume, fork, and rewind.
- Interactive approval for tool calls, with configurable permission modes.
- Model, thinking effort, and context-window controls, plus context usage
  display reported by the Qoder Agent SDK.
- Vault context input: @-mentions for notes and selected text, file chips, and
  image attachments.
- Inline edit for rewriting a selection directly in the editor.
- Slash commands, agents, skills, hooks, and MCP server configuration, sharing
  Qoder CLI's own project files.
- Interface localization in 10 languages.

### Changed

- Aligned Query initialization, interruption, closing, and model discovery with
  the official Qoder Agent SDK TypeScript examples.
- Model and reasoning-effort menus now open on click and close after selection,
  on outside click, or with Escape.

### Removed

- Removed local model context-window overrides; context windows now come from
  Qoder SDK metadata with built-in model-family fallbacks.
- Removed the duplicate shared/Qoder environment settings and reusable
  environment snippets. qodercli now inherits the host process environment.

### Fixed

- Preserved SDK failures as first-class error blocks without duplicate text or
  successful-turn duration labels.
- Restored Qoder model grouping and displayed model credit multipliers and
  promotion labels from runtime metadata.
