# Changelog

All notable user-visible changes to Qoderian are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
Omit any category with no entries. On release, rename `[Unreleased]` to the
version with its date and start a fresh empty `[Unreleased]` above it.

## [Unreleased]

### Added

- Multi-message send queue in the chat composer: while a response is
  streaming, further sends stack into a collapsible panel above the
  composer (aligned with the Qoder IDE send queue). Each entry shows a
  drag handle for reordering plus edit (withdraw into the composer) and
  delete actions, and entries drain one per turn end in FIFO order.
- Drag notes or folders from the Obsidian file explorer into the chat
  composer: they are inserted as `@note` / `@folder/` context mentions at
  the caret, with duplicates skipped and a drop overlay while dragging.
- `@file` / `@folder/` references render as inline chips in the composer
  and in sent message bubbles; clicking a chip opens the note (both
  surfaces), and Backspace/Delete removes a composer chip atomically.

### Changed

- Stopping a streaming turn now pauses the send queue (Codex-style):
  queued messages are preserved but no longer auto-sent, the panel header
  switches to a "queue paused" notice with a Resume action, and resuming
  (or clearing the queue) restores the normal one-per-turn drain.
- Editing a queued message now replaces the composer content instead of
  appending to it.

### Fixed

- Mention chips in message bubbles now resolve paths containing spaces
  (longest-match vault verification) instead of truncating at the first
  space.
- Dropping a vault note or folder into the composer no longer pastes the
  raw `obsidian://open` URI next to the mention, and the inserted mention
  chipifies like dropdown insertions.

## [1.0.5] - 2026-08-18

### Added

- Credits usage panel in the chat view: a gauge button next to the
  session history opens a usage popover that mirrors the Qoder IDE
  view (plan credits with edition badge, personal/add-on resource
  pack, organization resource package, renewal date) and links to the
  edition's account usage page.
- Send/stop action button in the chat composer: a round button at the
  end of the input toolbar sends the message (same path as Enter),
  turns into a stop control while a response is streaming (same path
  as Esc), and stays disabled while the composer is empty.
- Qoder CLI edition switch in settings (Setup section): choose the
  international build (`qodercli`, config under `~/.qoder`) or the
  China build (`qoderclicn`, config under `~/.qoder-cn`). Auto-
  detection, session history, global plugins, and login hints all
  follow the selected edition. Session history is isolated per
  edition: each conversation is stamped with the edition that owns
  it, switching editions force-closes all open tabs, and the history
  list shows only the active edition's sessions (pre-existing
  sessions are attributed by where their history files live).
- Per-model context and thinking editor in the model selector,
  mirroring the Qoder IDE: hovering a model row reveals an edit
  affordance that opens a side editor card with context window
  tiers, a thinking on/off toggle, and the model's server-provided
  thinking effort levels. Choices persist per model and are applied
  to every request.

### Changed

- The credits usage button now shows a static "Usage" tooltip through
  Obsidian's native tooltip (aria-label), matching the other nav-row
  buttons, instead of a browser title tooltip with the live percentage.

### Removed

- The global "Effort" dropdown in the input toolbar: reasoning effort
  is now configured only through the per-model editor in the model
  selector, which already offered the same levels. Models without an
  explicit choice fall back to their server default effort.

### Fixed

- The model selector dropdown opens above the model button again on
  wide views instead of anchoring to the far edge of the toolbar, and
  toolbar dropdowns anchor with logical edges so right-to-left
  layouts position correctly.
- The composer now adapts to narrow sidebars: context chips that do
  not fit collapse behind a "+N more" pill (click to expand or
  collapse), the toolbar wraps instead of clipping, and the permission
  mode and model dropdowns shrink to stay inside the sidebar, with
  long model names ellipsized.
- Startup session restore no longer fails silently: when the tab
  layout, an individual tab, session metadata, or conversation history
  cannot be read, Qoderian now shows a single notice with the issue
  count and logs per-stage details to the developer console, including
  the underlying file error (such as a permission denial) for each
  session history file that fails to load.
- The context usage meter updates again after each response: Qoder CLI
  1.1.21 changed its context-usage report to a percentage-based shape
  without absolute token counts, which the meter could not read, so it
  stayed stuck at its "appears after the first response" placeholder.
- The context usage meter keeps the context-window tier chosen in the
  per-model editor after a response; previously the post-response
  refresh silently fell back to the model catalog default (such as
  200K), so a 400K selection reverted to 200K once a message was sent.
- The context usage meter no longer flickers to 0% or to the catalog
  default window while a response is streaming: mid-turn usage
  snapshots now carry the configured context-window tier, and zeroed
  snapshots can no longer overwrite an existing reading.
- Settings changed on Obsidian 1.13+ (language, auto-scroll, and the
  other simple toggles) now persist across restarts: the declarative
  control writes were only mirrored into the plugin data file, not the
  `.qoderian/qoderian-settings.json` store Qoderian loads at startup.
  Changing the language also re-localizes open chat views immediately
  (nav tooltips and tab titles) instead of keeping the old language
  until the view is reopened.

## [1.0.4] - 2026-08-12

### Fixed

- Selection context indicators (editor, browser, and canvas selections)
  now render as left-aligned removable chips — icon, label, and a ×
  button that clears the captured selection — instead of right-aligned
  text that pushed the input placeholder down inside the composer box.

## [1.0.3] - 2026-08-10

### Fixed

- Restored editable settings on Obsidian 1.13+. The settings tab now
  implements the declarative settings API with native controls and full
  settings search support; rows with custom UI (Qoder CLI path, max tabs,
  chat view placement, navigation keys, `!` bash, slash commands,
  subagents, MCP servers, plugins) keep their rich behavior. `display()`
  remains as the fallback for Obsidian versions older than 1.13.

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
