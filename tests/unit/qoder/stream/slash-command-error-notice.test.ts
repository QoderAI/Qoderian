import { getLocale, setLocale } from '@/i18n/i18n';
import { describeSlashCommandError } from '@/qoder/stream/slash-command-error-notice';

describe('describeSlashCommandError', () => {
  const previousLocale = getLocale();

  afterEach(() => {
    setLocale(previousLocale);
  });

  it('rewrites the unsupported-result error into a readable notice', () => {
    const rewritten = describeSlashCommandError(
      'Exiting due to command result that is not supported in non-interactive mode.',
    );

    expect(rewritten).not.toContain('non-interactive');
    expect(rewritten.length).toBeGreaterThan(0);
  });

  it('rewrites the confirmation-prompt and headless refusals the same way', () => {
    expect(
      describeSlashCommandError('Exiting due to a confirmation prompt requested by the command.'),
    ).not.toContain('confirmation prompt');
    expect(
      describeSlashCommandError('Plan mode is not available in headless mode.'),
    ).not.toContain('headless');
  });

  it('leaves unrelated errors untouched', () => {
    expect(describeSlashCommandError('Credit limit reached.')).toBe('Credit limit reached.');
    expect(describeSlashCommandError('API Error: failed to connect'))
      .toBe('API Error: failed to connect');
  });

  it('resolves the notice in the active locale', () => {
    setLocale('zh-CN');

    const notice = describeSlashCommandError(
      'Exiting due to command result that is not supported in non-interactive mode.',
    );

    expect(notice).toContain('Obsidian');
    expect(notice).toMatch(/[\u4e00-\u9fff]/);
  });
});
