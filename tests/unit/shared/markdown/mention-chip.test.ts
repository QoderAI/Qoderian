import type { App, TAbstractFile } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import {
  findMentionCandidates,
  formatReferenceLabel,
  replaceMentionTokensWithHtml,
} from '@/shared/markdown/mention-chip';

function createMockApp(files: string[] = [], folders: string[] = []): App {
  const entries = new Map<string, TAbstractFile>();
  for (const path of files) {
    const file = new TFile();
    file.path = path;
    entries.set(path, file);
  }
  for (const path of folders) {
    const folder = new TFolder();
    folder.path = path;
    entries.set(path, folder);
  }
  return {
    vault: {
      getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
    },
  } as unknown as App;
}

describe('formatReferenceLabel', () => {
  it('uses the basename as the label', () => {
    expect(formatReferenceLabel('folder/note.md')).toBe('note.md');
  });

  it('truncates long basenames with an ellipsis', () => {
    const longName = 'a'.repeat(30);
    expect(formatReferenceLabel(`folder/${longName}`)).toBe(`${'a'.repeat(20)}…`);
  });
});

describe('findMentionCandidates', () => {
  it('finds a path token surrounded by whitespace', () => {
    const candidates = findMentionCandidates('look at @notes/idea.md now');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ path: 'notes/idea.md', start: 8, end: 22 });
  });

  it('requires a whitespace boundary before the @', () => {
    expect(findMentionCandidates('mail me user@example.com')).toHaveLength(0);
  });

  it('strips trailing punctuation from the token', () => {
    const candidates = findMentionCandidates('see @notes/idea.md, thanks');
    expect(candidates[0]).toMatchObject({ path: 'notes/idea.md', end: 18 });
  });

  it('keeps folder tokens as folder paths', () => {
    const candidates = findMentionCandidates('scan @projects/ for me');
    expect(candidates[0]).toMatchObject({ path: 'projects', hasTrailingSlash: true });
  });

  it('ignores a bare @', () => {
    expect(findMentionCandidates('just an @ alone')).toHaveLength(0);
  });
});

describe('replaceMentionTokensWithHtml', () => {
  it('replaces a file token that exists in the vault', () => {
    const app = createMockApp(['notes/idea.md']);
    const result = replaceMentionTokensWithHtml('check @notes/idea.md please', app);

    expect(result).toContain('qoderian-msg-reference');
    expect(result).toContain('data-kind="file"');
    expect(result).toContain('data-path="notes/idea.md"');
    expect(result).toContain('idea.md');
    expect(result).toContain('title="@notes/idea.md"');
    expect(result).toContain('check ');
    expect(result).toContain(' please');
  });

  it('renders folder tokens with folder kind and slash in title', () => {
    const app = createMockApp([], ['projects']);
    const result = replaceMentionTokensWithHtml('scan @projects/ now', app);

    expect(result).toContain('data-kind="folder"');
    expect(result).toContain('title="@projects/"');
  });

  it('leaves unknown tokens untouched', () => {
    const app = createMockApp(['notes/idea.md']);
    const result = replaceMentionTokensWithHtml('see @missing/note.md now', app);

    expect(result).toBe('see @missing/note.md now');
  });

  it('skips tokens inside code fences and inline code', () => {
    const app = createMockApp(['notes/idea.md']);
    const markdown = [
      'before @notes/idea.md',
      '```ts',
      'const x = "@notes/idea.md";',
      '```',
      'inline `@notes/idea.md` code',
    ].join('\n');
    const result = replaceMentionTokensWithHtml(markdown, app);

    expect(result.match(/qoderian-msg-reference/g)).toHaveLength(1);
    expect(result).toContain('const x = "@notes/idea.md";');
    expect(result).toContain('inline `@notes/idea.md` code');
  });

  it('escapes html in paths and labels', () => {
    const app = createMockApp(['notes/a<b&c.md']);
    const result = replaceMentionTokensWithHtml('open @notes/a<b&c.md now', app);

    expect(result).toContain('data-path="notes/a&lt;b&amp;c.md"');
  });

  it('returns the input when there is no @ at all', () => {
    const app = createMockApp(['notes/idea.md']);
    expect(replaceMentionTokensWithHtml('plain text', app)).toBe('plain text');
  });

  it('handles text without a vault', () => {
    const app = {} as App;
    expect(replaceMentionTokensWithHtml('see @notes/idea.md', app)).toBe('see @notes/idea.md');
  });
});
