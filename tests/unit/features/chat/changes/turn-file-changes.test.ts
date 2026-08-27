import type { ToolCallInfo } from '@/core/types/tools';
import { collectTurnChanges } from '@/features/chat/changes/turn-file-changes';
import { extractDiffData } from '@/qoder/tools/diff';

function call(overrides: Partial<ToolCallInfo>): ToolCallInfo {
  return { id: 'tool', name: 'Edit', input: {}, status: 'completed', ...overrides };
}

describe('collectTurnChanges', () => {
  it('groups multiple edits to the same file', () => {
    const changes = collectTurnChanges([
      call({ input: { file_path: 'notes/a.md', old_string: 'one', new_string: 'two' } }),
      call({ id: 'two', input: { file_path: 'notes/a.md', old_string: 'three', new_string: 'four' } }),
    ]);

    expect(changes.files).toHaveLength(1);
    expect(changes.files[0].diffs).toHaveLength(2);
    expect(changes.stats).toEqual({ added: 2, removed: 2 });
  });

  it('collects multi-file patches and nested subagent edits', () => {
    const changes = collectTurnChanges([
      call({
        name: 'apply_patch',
        input: {
          patch: '*** Begin Patch\n*** Update File: a.md\n-old\n+new\n*** Add File: b.md\n+hello\n*** End Patch',
        },
      }),
      call({
        id: 'agent',
        name: 'Agent',
        subagent: {
          id: 'agent',
          description: 'work',
          isExpanded: false,
          status: 'completed',
          toolCalls: [
            call({ id: 'nested', input: { file_path: 'c.md', old_string: 'x', new_string: 'y' } }),
          ],
        },
      }),
    ]);

    expect(changes.files.map(file => file.filePath)).toEqual(['a.md', 'b.md', 'c.md']);
    expect(changes.stats).toEqual({ added: 3, removed: 2 });
  });

  it('does not double count the same tool call object', () => {
    const edit = call({ input: { file_path: 'a.md', old_string: 'one', new_string: 'two' } });
    expect(collectTurnChanges([edit, edit]).stats).toEqual({ added: 1, removed: 1 });
  });

  it('ignores failed edits', () => {
    expect(collectTurnChanges([call({ status: 'error' })]).files).toEqual([]);
  });

  it('keeps deleted files even when no textual diff is available', () => {
    const changes = collectTurnChanges([
      call({
        name: 'apply_patch',
        input: { patch: '*** Begin Patch\n*** Delete File: old.md\n*** End Patch' },
      }),
    ]);

    expect(changes.files).toHaveLength(1);
    expect(changes.files[0].diffs[0]).toMatchObject({
      filePath: 'old.md',
      operation: 'delete',
    });
    expect(changes.stats).toEqual({ added: 0, removed: 0 });
  });

  it('keeps a pure rename and exposes its destination', () => {
    const changes = collectTurnChanges([
      call({
        name: 'apply_patch',
        input: {
          patch: '*** Begin Patch\n*** Update File: old.md\n*** Move to: new.md\n*** End Patch',
        },
      }),
    ]);

    expect(changes.files[0].diffs[0]).toMatchObject({
      filePath: 'old.md',
      movedTo: 'new.md',
    });
  });

  it('marks only source-backed line numbers as safe for navigation', () => {
    const edit = call({
      input: { file_path: 'a.md', old_string: 'old', new_string: 'new' },
    });
    const fallback = extractDiffData(undefined, edit);
    const structured = extractDiffData({
      filePath: 'a.md',
      structuredPatch: [{
        oldStart: 20,
        oldLines: 1,
        newStart: 20,
        newLines: 1,
        lines: ['-old', '+new'],
      }],
    }, edit);

    expect(fallback?.hasAbsoluteLineNumbers).not.toBe(true);
    expect(structured?.hasAbsoluteLineNumbers).toBe(true);
    expect(structured?.diffLines[0].oldLineNum).toBe(20);
  });
});
