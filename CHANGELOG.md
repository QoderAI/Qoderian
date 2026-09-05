# Changelog

All notable user-visible changes to Qoderian are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
Omit any category with no entries. On release, rename `[Unreleased]` to the
version with its date and start a fresh empty `[Unreleased]` above it.

## [Unreleased]

### Added

- Compact tabs are now wide enough to keep their label easy to click, with
  closing moved into a hover-revealed actions menu to prevent accidental
  removal.
- The message composer can be resized by dragging its top edge or using the
  Up/Down arrow keys on the resize handle; double-click or Home restores
  automatic content-based sizing.
- History, credits usage, and a standalone Qoderian settings window are now
  always available together in the top-right view header.
- A non-blocking update badge now appears beside the Qoderian mark when GitHub
  has a newer stable release.

### Changed

- Fresh installations follow Obsidian's interface language and allow the
  maximum supported number of chat tabs by default.
- The core chat chrome now uses calmer rounded controls, a layered composer,
  and consistent Lucide-style icons.

### Removed

- The redundant restart-current-conversation icon from the composer toolbar;
  the command-palette action remains available for existing keyboard workflows.

### Fixed

- Long composer input no longer shifts its wrapping width when the vertical
  scrollbar appears, preventing the input height from flickering at its cap.
- The composer resize indicator now spans the complete top edge of the input.
- Composer popovers now stay within the Qoderian pane in narrow sidebars, and
  the external-context action uses an unclipped add-folder icon.

## [1.0.7] - 2026-09-02

### Added

- In-app sign-in when the Qoder CLI is not authenticated: the model selector
  now shows a sign-in panel that runs the CLI device flow inside Obsidian —
  the authorization page opens once per attempt, with open-link, copy-link and
  cancel controls, localized status and error messages in all ten locales, and
  an automatic model-catalog refresh once sign-in succeeds — so signing in no
  longer requires a terminal.

- Message timestamps, matching New Qoder: each user bubble shows when it was
  sent, and each assistant reply shows one time under the whole response next
  to the completion line. Both reveal on hover so idle conversations stay
  uncluttered, and replies that were interrupted or errored are timed too.

- Collapsed activity for finished turns: once a reply reaches its final
  result, the thinking, commentary, and tool-call rows that led there fold
  into a single expandable "Execution steps" line above the answer, so long
  turns stay compact while the result stays in view. The stream stays flat
  while a turn is running, turns that end on a tool call stay expanded, and
  saved conversations reopen with the same collapsed state.

- Turn change summaries: after a reply finishes, the files it edited collapse
  into a single card under the response — file count, +/- stats and the first
  few paths — instead of scattering across the tool call log. Clicking the
  card opens a read-only modal with the per-file diffs, and saved
  conversations show the same card when reopened.

### Changed

- Startup with many saved sessions is now much faster: session metadata is
  read in parallel and legacy edition history files are probed once per
  startup instead of repeatedly blocking the interface, so vaults with
  hundreds of sessions no longer stall while Qoderian loads.

- The composer permission picker now mirrors New Qoder's three tiers —
  Ask approval, Auto approval, and Full access — and its labels and
  descriptions are localized across all ten supported locales instead of
  being hardcoded English. Plan mode is no longer offered in the picker,
  but the button still reports it when the CLI switches into planning.

### Removed

- The `Allow edits` permission tier. Existing settings that selected it are
  migrated to `Auto approval`, which is also the new default for fresh
  installations.

- Slash commands that cannot run inside Obsidian are no longer offered in the
  command popover. Each interactive-only one used to burn a turn and come back
  with a CLI-internal error: `about`, `agents`, `btw`, `commands`, `continue`,
  `crontab`, `diff`, `editor`, `effort`, `export`, `fast`, `help`, `hooks`, `mcp`,
  `memory`, `model`, `plan`, `plugins`, `privacy`, `release-notes`, `remote-env`,
  `security-settings`, `settings`, `skills`, `status`, `theme` and `usage`.
  Commands that act on the CLI process or session itself — `login`, `logout`,
  `quit`, `remote-control`, `setup-github` and `upgrade` — are hidden too, since
  running one from the plugin would tear down the runtime the plugin depends on.
  So are the terminal-UI-only ones — `shortcuts`, `statusline`, `vim` and
  `voice` — which run fine in the CLI but only affect a terminal Obsidian does
  not have, and the ones a Qoderian surface already provides — `copy`,
  `permissions`, `rewind`, `context-window`, `branch`, `tools` and `rename`
  (per-message copy and rewind buttons, the permission picker, the model editor's
  context tier, fork, the MCP server selector, and the history rename button;
  `rename` only retitles the CLI session, which Qoderian never displays) — plus
  `goal`, `docs`, `claim`, `kanban`, `workflows`, `feedback`, `review`, `profile`,
  `subtask` and `tasks`, which the Qoderian chat workflow does not need (kanban
  additionally requires an unconfigured external service, workflows is terminal
  automation, feedback is a terminal flow), and `add-dir`, which the
  external-context selector already provides.

### Fixed

- The permission dropdown highlighted a stale tier after the mode changed
  outside the dropdown (switching chat tabs, or the CLI reporting a
  different mode), leaving the button and the highlighted entry
  disagreeing.

- A slash command that the CLI refuses because it needs an interactive
  terminal now reports that in plain, localized language instead of
  surfacing `Exiting due to command result that is not supported in
  non-interactive mode.` This also covers commands not yet filtered out of
  the popover.

- Pasting a large block of text into the composer painted it outside the
  input box, spilling over the toolbar and past the bottom of the sidebar.
  The input box now grows with the pasted text up to its usual height cap,
  scrolls internally beyond that, and shrinks back when the text is cleared.

## [1.0.6] - 2026-08-27

### Added

- Multi-message send queue in the chat composer: while a response is
  streaming, further sends stack into a collapsible panel above the
  composer (aligned with the Qoder IDE send queue). Each entry shows a
  drag handle for reordering plus edit (withdraw into the composer) and
  delete actions, and entries drain one per turn end in FIFO order.
- Steer an in-flight turn from the send queue (Codex-style): while a
  response is streaming, each queued entry without images gains a Steer
  action that interrupts the running turn and handles the message
  immediately, rendering it as a user message instead of waiting for the
  turn to end.
- Drag notes or folders from the Obsidian file explorer into the chat
  composer: they are inserted as `@note` / `@folder/` context mentions at
  the caret, with duplicates skipped and a drop overlay while dragging.
- `@file` / `@folder/` references render as inline chips in the composer
  and in sent message bubbles; clicking a chip opens the note (both
  surfaces), and a composer chip can be removed via its × button or
  atomically with Backspace/Delete.

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
- The queue's Steer action now tracks the streaming state: it no longer
  goes missing on remaining rows after queued messages auto-drain, and no
  longer lingers after a turn ends through plan approval paths.
- Vault images dragged into the composer are now inserted as `@path`
  mentions just like notes (chipified, no attachment preview); mixed
  drags combine note, folder, and image mentions, and only truly
  unsupported file types are reported as ignored.
- The settings language row now updates its own label and description
  immediately when the display language is changed, instead of keeping
  the previous language's text until the settings tab is reopened.
- Steering an in-flight turn now interrupts it immediately instead of
  queuing the message as a follow-up turn that only arrives after the
  running response finishes, and the interrupted turn no longer shows an
  error receipt.
- Send failure paths (agent service unavailable or initialization
  failure) now fully clean up the streaming state and queue indicator,
  so the composer no longer stays stuck as "streaming" after an early
  send error.
- Steering a queued message no longer drops or misplaces the opening of
  the steered reply: chunks that arrive while the chat swaps streaming
  bubbles are buffered and replayed into the fresh bubble in order.
- The steered reply streams incrementally again: the interrupted turn's
  receipt no longer triggers a context-usage request that stalled the
  response consumer, which made the whole reply appear only at the end.
- Stopping a streaming turn (Stop or Esc) completes it again: the chat
  leaves the streaming state and the paused send queue can be resumed,
  instead of staying stuck until the next message. Steered turns keep
  their live hand-off and are unaffected.

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
