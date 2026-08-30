import { t } from '../../i18n/i18n';

/**
 * CLI errors that mean "this command needs an interactive terminal".
 *
 * They surface as a red error block quoting an internal CLI failure, which tells a
 * plugin user nothing actionable. The commands are filtered out of the picker, so
 * this is the backstop for ones that are not in that list yet and for CLI upgrades
 * that change a command's behaviour.
 */
const INTERACTIVE_ONLY_ERROR_PATTERNS: readonly RegExp[] = [
  /command result that is not supported in non-interactive mode/i,
  /confirmation prompt requested by the command/i,
  /is not available in headless mode/i,
];

/**
 * Replaces an interactive-only CLI error with a readable notice, or returns the
 * content unchanged.
 */
export function describeSlashCommandError(content: string): string {
  if (INTERACTIVE_ONLY_ERROR_PATTERNS.some(pattern => pattern.test(content))) {
    return t('chat.slashCommand.requiresInteractiveTerminal');
  }
  return content;
}
