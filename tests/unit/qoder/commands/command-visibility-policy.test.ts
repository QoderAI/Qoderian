import { isHiddenCommand } from '@/qoder/commands/command-visibility-policy';

describe('isHiddenCommand', () => {
  it('hides commands the CLI rejects without an interactive terminal', () => {
    for (const name of ['about', 'model', 'usage', 'theme', 'plan', 'btw',
      'continue', 'crontab', 'effort', 'fast', 'hooks', 'plugins', 'privacy',
      'security-settings', 'settings']) {
      expect(isHiddenCommand(name)).toBe(true);
    }
  });

  it('hides commands that act on the CLI process or session itself', () => {
    for (const name of ['login', 'logout', 'quit', 'remote-control', 'setup-github', 'upgrade']) {
      expect(isHiddenCommand(name)).toBe(true);
    }
  });

  it('hides terminal-UI-only commands that are useless without a terminal', () => {
    for (const name of ['shortcuts', 'statusline', 'vim', 'voice']) {
      expect(isHiddenCommand(name)).toBe(true);
    }
  });

  it('hides SDK built-ins that Qoderian already surfaces elsewhere', () => {
    for (const name of ['context', 'copy', 'cost', 'init', 'simplify',
      'branch', 'context-window', 'permissions', 'rewind', 'goal', 'add-dir', 'docs', 'tools', 'claim', 'rename', 'kanban', 'workflows', 'feedback',
      'review', 'profile', 'subtask', 'tasks']) {
      expect(isHiddenCommand(name)).toBe(true);
    }
  });

  it('leaves everything else offered', () => {
    for (const name of ['compact', 'ai-drawio']) {
      expect(isHiddenCommand(name)).toBe(false);
    }
  });

  it('ignores case and stray whitespace from CLI name variants', () => {
    expect(isHiddenCommand('  MODEL ')).toBe(true);
    expect(isHiddenCommand('Compact')).toBe(false);
  });
});
