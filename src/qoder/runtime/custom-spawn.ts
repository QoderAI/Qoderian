import type { SpawnedProcess, SpawnOptions } from '@qoder-ai/qoder-agent-sdk';
import { type ChildProcess, spawn } from 'child_process';

import { cliPathRequiresNode, findNodeExecutable } from '../../core/env/environment';
import {
  resolveWindowsCmdShimSpawnSpec,
  terminateSpawnedProcess,
  type WindowsCmdShimSpawnSpec,
} from './windows-cmd-shim';

/**
 * Spawn qodercli in Obsidian's Electron process.
 *
 * The Qoder SDK owns the CLI argument protocol. This adapter only covers the
 * Electron AbortSignal realm mismatch and Node/Windows executable resolution.
 */
export function createCustomSpawnFunction(
  enhancedPath: string,
): (options: SpawnOptions) => SpawnedProcess {
  return (options: SpawnOptions): SpawnedProcess => {
    let { command } = options;
    let { args } = options;
    const { cwd, env, signal } = options;
    const shouldPipeStderr = !!env?.DEBUG_QODER_AGENT_SDK;

    if (command === 'node' || cliPathRequiresNode(command)) {
      const nodeFullPath = findNodeExecutable(enhancedPath);
      if (command === 'node') {
        command = nodeFullPath ?? command;
      } else {
        args = [command, ...args];
        command = nodeFullPath ?? 'node';
      }
    }

    const resolvedSpawnSpec = resolveWindowsCmdShimSpawnSpec({ args, command });
    const child = spawn(resolvedSpawnSpec.command, resolvedSpawnSpec.args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', shouldPipeStderr ? 'pipe' : 'ignore'],
      windowsHide: true,
      ...(resolvedSpawnSpec.windowsVerbatimArguments
        ? { windowsVerbatimArguments: true }
        : {}),
    });
    installTreeAwareKill(child, resolvedSpawnSpec);

    if (signal) {
      const killChild = (): void => {
        child.kill('SIGTERM');
      };
      if (signal.aborted) {
        killChild();
      } else {
        signal.addEventListener('abort', killChild, { once: true });
      }
    }

    if (shouldPipeStderr && child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', () => {});
    }

    if (!child.stdin || !child.stdout) {
      throw new Error('Failed to create process streams');
    }

    return child as unknown as SpawnedProcess;
  };
}

function installTreeAwareKill(child: ChildProcess, spawnSpec: WindowsCmdShimSpawnSpec): void {
  if (!spawnSpec.killProcessTree) {
    return;
  }

  const callOriginalKill = child.kill.bind(child);
  const killableChild = {
    get pid(): number | undefined {
      return child.pid;
    },
    kill: callOriginalKill,
  };

  child.kill = ((signal?: NodeJS.Signals | number): boolean =>
    terminateSpawnedProcess(killableChild, signal, spawn, spawnSpec)
  );
}
