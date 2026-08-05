jest.mock('@/core/time/date', () => ({
  getTodayDate: () => 'Mocked Date',
}));

import { getInlineEditSystemPrompt } from '@/qoder/prompt/inline-edit';

describe('getInlineEditSystemPrompt', () => {
  it('should include inline edit critical output rules', () => {
    const prompt = getInlineEditSystemPrompt();
    expect(prompt).toContain('ABSOLUTE RULE');
    expect(prompt).toContain('<replacement>');
  });

  it('should include read-only tool descriptions', () => {
    const prompt = getInlineEditSystemPrompt();
    expect(prompt).toContain('Read, Grep, Glob, LS, WebSearch, WebFetch');
    expect(prompt).toContain('read-only');
  });

  it('should include example scenarios', () => {
    const prompt = getInlineEditSystemPrompt();
    expect(prompt).toContain('translate to French');
    expect(prompt).toContain('Bonjour le monde');
    expect(prompt).toContain('asking for clarification');
  });

  it('should include date from utils', () => {
    const prompt = getInlineEditSystemPrompt();
    expect(prompt).toContain('Mocked Date');
  });

});
