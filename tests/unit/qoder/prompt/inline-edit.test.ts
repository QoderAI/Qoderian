jest.mock('@/core/time/date', () => ({
  getTodayDate: () => 'Mocked Date',
}));

import { getLocale, setLocale } from '@/i18n/i18n';
import { getInlineEditSystemPrompt } from '@/qoder/prompt/inline-edit';

describe('getInlineEditSystemPrompt', () => {
  let previousLocale: ReturnType<typeof getLocale>;

  beforeEach(() => {
    previousLocale = getLocale();
    setLocale('en');
  });

  afterEach(() => {
    setLocale(previousLocale);
  });

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

  it('should use the shared language rule while preserving formatting examples', () => {
    const prompt = getInlineEditSystemPrompt();

    expect(prompt).toContain("same language as the user's request");
    expect(prompt).toContain('UI locale (`en`)');
    expect(prompt).toContain('proper nouns, product names, file names, paths, code identifiers, and code snippets unchanged');
    expect(prompt).toContain('The examples below illustrate formatting only');
    expect(prompt).toContain('<replacement>Bonjour le monde</replacement>');
    expect(prompt.indexOf('**Language**')).toBeLessThan(prompt.indexOf('## Examples'));
  });

  it('should fall back to the current UI locale', () => {
    setLocale('zh-CN');

    expect(getInlineEditSystemPrompt()).toContain('UI locale (`zh-CN`)');
  });

  it('should include date from utils', () => {
    const prompt = getInlineEditSystemPrompt();
    expect(prompt).toContain('Mocked Date');
  });
});
