import type { DiffStats } from '../../../core/types/diff';
import type { ToolCallInfo, ToolDiffData } from '../../../core/types/tools';
import {
  diffFromToolInput,
  parseApplyPatchDiffs,
  parseFileUpdateChangeDiffs,
} from '../../../qoder/tools/diff';
import { TOOL_APPLY_PATCH } from '../../../qoder/tools/tool-names';

export interface TurnFileChange {
  filePath: string;
  diffs: ToolDiffData[];
  stats: DiffStats;
}

export interface TurnChangesSummary {
  files: TurnFileChange[];
  stats: DiffStats;
}

/** Collect completed file edits from one assistant turn, including nested subagents. */
export function collectTurnChanges(toolCalls?: ToolCallInfo[]): TurnChangesSummary {
  const byFile = new Map<string, TurnFileChange>();
  const visitedCalls = new Set<ToolCallInfo>();

  const addDiff = (diff: ToolDiffData): void => {
    if (!diff.filePath || (diff.stats.added === 0 && diff.stats.removed === 0)) return;

    const existing = byFile.get(diff.filePath) ?? {
      filePath: diff.filePath,
      diffs: [],
      stats: { added: 0, removed: 0 },
    };
    existing.diffs.push(diff);
    existing.stats.added += diff.stats.added;
    existing.stats.removed += diff.stats.removed;
    byFile.set(diff.filePath, existing);
  };

  const visit = (calls?: ToolCallInfo[]): void => {
    for (const call of calls ?? []) {
      if (visitedCalls.has(call)) continue;
      visitedCalls.add(call);

      if (call.status === 'completed') {
        if (call.name === TOOL_APPLY_PATCH) {
          const patch = typeof call.input.patch === 'string' ? call.input.patch : '';
          const patchDiffs = parseApplyPatchDiffs(patch);
          const diffs = patchDiffs.length > 0
            ? patchDiffs
            : parseFileUpdateChangeDiffs(call.input.changes);
          if (diffs.length > 0) diffs.forEach(addDiff);
          else if (call.diffData) addDiff(call.diffData);
        } else {
          const filePath = getFilePath(call);
          const diff = call.diffData ?? (filePath ? diffFromToolInput(call, filePath) : undefined);
          if (diff) addDiff(diff);
        }
      }

      visit(call.subagent?.toolCalls);
    }
  };

  visit(toolCalls);
  const files = [...byFile.values()];
  return {
    files,
    stats: files.reduce(
      (total, file) => ({
        added: total.added + file.stats.added,
        removed: total.removed + file.stats.removed,
      }),
      { added: 0, removed: 0 },
    ),
  };
}

function getFilePath(call: ToolCallInfo): string | undefined {
  const value = call.input.file_path ?? call.input.path;
  return typeof value === 'string' && value.trim() ? value : call.diffData?.filePath;
}
