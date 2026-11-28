import { getLocale, setLocale } from '@/i18n/i18n';
import {
  buildTitleGenerationPrompt,
  getTitleGenerationSystemPrompt,
  parseTitleGenerationResponse,
} from '@/qoder/prompt/title-generation';

describe('titleGeneration', () => {
  let previousLocale: ReturnType<typeof getLocale>;

  beforeEach(() => {
    previousLocale = getLocale();
    setLocale('en');
  });

  afterEach(() => {
    setLocale(previousLocale);
  });

  it('exports a non-empty system prompt string', () => {
    const prompt = getTitleGenerationSystemPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('includes the max character constraint', () => {
    expect(getTitleGenerationSystemPrompt()).toContain('max 50 chars');
  });

  it('instructs to start with a strong verb in the output language', () => {
    expect(getTitleGenerationSystemPrompt()).toContain('strong verb');
    expect(getTitleGenerationSystemPrompt()).toContain('output language');
  });

  it('instructs to return only the raw title text', () => {
    expect(getTitleGenerationSystemPrompt()).toContain('ONLY the raw title text');
  });

  it('uses one language rule without English verb or title examples', () => {
    const prompt = getTitleGenerationSystemPrompt();

    expect(prompt).toContain("same language as the user's request");
    expect(prompt).toContain('UI locale (`en`)');
    expect(prompt).toContain('proper nouns, product names, file names, paths, code identifiers, and code snippets unchanged');
    expect(prompt).not.toContain('Create, Fix, Debug, Explain, Analyze');
    expect(prompt).not.toContain('Debug Python script');
    expect(prompt).not.toContain('Refactor React hook');
  });

  it('falls back to the current UI locale', () => {
    setLocale('zh-CN');

    expect(getTitleGenerationSystemPrompt()).toContain('UI locale (`zh-CN`)');
  });

  it.each([
    ['Chinese', '请修复 useReducer 的状态更新'],
    ['English', 'Fix useReducer state updates'],
    ['mixed code identifiers', '请修复 Qoderian 中 notes/demo.md 的 useReducer'],
  ])('preserves %s request text and identifiers', (_language, request) => {
    expect(buildTitleGenerationPrompt(request)).toContain(request);
  });

  it('preserves a Chinese title and its code identifiers', () => {
    expect(parseTitleGenerationResponse('修复 Qoderian 的 useReducer')).toBe('修复 Qoderian 的 useReducer');
  });
});
