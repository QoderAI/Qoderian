/**
 * Adapter between the CLI's command catalog and what Qoderian can offer.
 *
 * The SDK reports a slash command as only `{ name, description, argumentHint }`,
 * with no flag saying whether it needs a terminal. Rather than relabel CLI data
 * we do not have, every command the SDK reports is assumed usable and the known
 * dead ends are filtered out here, in one place, so a CLI upgrade that adds a
 * broken command costs one line instead of a hunt through the picker.
 *
 * Four kinds of entry are listed:
 *   - commands rejected by the CLI in non-interactive (SDK/headless) mode, either
 *     a TUI result type the dispatcher refuses or an explicit headless refusal;
 *   - commands that act on the CLI process or session itself, hidden by product
 *     judgement because running them would break the plugin's runtime;
 *   - commands that run fine but only affect the terminal UI, so they are useless
 *     in Obsidian (which has no terminal);
 *   - SDK built-ins that duplicate a Qoderian surface.
 *
 * Membership requires a live check against the CLI, run from inside Obsidian and
 * with a real argument. A command definition found in the CLI bundle is not
 * evidence — the minified bundle defeats extraction often enough to produce both
 * false hits and misses. Invoked bare, some commands return an empty `message`
 * result that looks like success: `btw` first slipped through that way.
 */

/**
 * Confirmed to fail inside Obsidian against qodercli 1.1.34 on 2026-08-30.
 * Keep sorted; add only what has been run.
 */
const INTERACTIVE_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  'about',
  'agents',
  'btw',
  'commands',
  'continue',
  'crontab',
  'diff',
  'editor',
  'effort',
  'export',
  'fast',
  'help',
  'hooks',
  'mcp',
  'memory',
  'model',
  'plan',
  'plugins',
  'privacy',
  'release-notes',
  'remote-env',
  'security-settings',
  'settings',
  'skills',
  'status',
  'theme',
  'usage',
]);

/**
 * Commands that act on the CLI process or session itself — logging out, quitting,
 * upgrading, re-authenticating. Running one from the plugin would tear down or
 * reconfigure the very runtime the plugin depends on, so they are hidden by product
 * judgement rather than a live probe (probing them would break the session).
 */
const TERMINAL_LIFECYCLE_COMMANDS: ReadonlySet<string> = new Set([
  'login',
  'logout',
  'quit',
  'remote-control',
  'setup-github',
  'upgrade',
]);

/**
 * Commands that run fine in the CLI but only affect the terminal UI — the status
 * line, vim key mode, voice input, terminal shortcut help. Obsidian has no terminal,
 * so they are pointless here, and the toggles would silently rewrite the user's
 * shared terminal config as a side effect. Hidden on the "is it useful in Qoderian"
 * bar rather than on whether they execute.
 */
const TERMINAL_UI_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  'shortcuts',
  'statusline',
  'vim',
  'voice',
]);

/**
 * SDK built-ins that duplicate a Qoderian surface — the permission picker, model
 * selector, context meter, credits panel, external-context selector, MCP server
 * selector, per-message copy/rewind buttons, fork and the history rename button
 * already own these — `rename` in particular only retitles the CLI session, which
 * Qoderian never displays — that only ever made sense in a terminal, or that the
 * Qoderian chat workflow simply does not need (goal management, docs, campaign
 * rewards, an unconfigured external kanban, terminal workflow automation). Hidden
 * alongside the interactive-only set.
 */
const SUPERSEDED_COMMANDS: ReadonlySet<string> = new Set([
  'add-dir',
  'branch',
  'claim',
  'context',
  'context-window',
  'copy',
  'cost',
  'debug',
  'docs',
  'extra-usage',
  'feedback',
  'goal',
  'heapdump',
  'init',
  'insights',
  'kanban',
  'loop',
  'permissions',
  'profile',
  'rename',
  'review',
  'rewind',
  'schedule',
  'security-review',
  'simplify',
  'subtask',
  'tasks',
  'tools',
  'update-config',
  'workflows',
]);

const HIDDEN_COMMANDS: ReadonlySet<string> = new Set([
  ...INTERACTIVE_ONLY_COMMANDS,
  ...TERMINAL_LIFECYCLE_COMMANDS,
  ...TERMINAL_UI_ONLY_COMMANDS,
  ...SUPERSEDED_COMMANDS,
]);

/** Command names are matched case-insensitively, without the leading slash. */
export function isHiddenCommand(name: string): boolean {
  return HIDDEN_COMMANDS.has(name.trim().toLowerCase());
}
