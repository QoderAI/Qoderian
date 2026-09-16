import type { SpawnedProcess, SpawnOptions } from '@qoder-ai/qoder-agent-sdk';
import { type ChildProcess, spawn } from 'child_process';

import { cliPathRequiresNode, findNodeExecutable } from '../../core/env/environment';
import {
  resolveWindowsCmdShimSpawnSpec,
  terminateSpawnedProcess,
  type WindowsCmdShimSpawnSpec,
} from './windows-cmd-shim';

/**
 * SDK-spawned sessions run qodercli in its "sdk" runtime mode, where
 * CLI-configured custom providers (self-defined base URLs) stay disabled
 * unless this opt-in is present — without it the CLI hides their models.
 */
const CUSTOM_PROVIDER_CLI_ENV = { QODER_SDK_CUSTOM_BASE_URL_BYOK: '1' } as const;

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
      env: env ? { ...env, ...CUSTOM_PROVIDER_CLI_ENV } : env,
      // stderr is always piped so host code (e.g. the runtime probe) can read
      // CLI diagnostics such as "No qodercli login found". A drain listener is
      // attached below to avoid pipe backpressure when nobody else listens.
      stdio: ['pipe', 'pipe', 'pipe'],
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

    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk: Buffer) => {
        if (shouldPipeStderr) {
          console.error(chunk.toString());
        }
      });
    }

    if (!child.stdin || !child.stdout) {
      throw new Error('Failed to create process streams');
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- ChildProcess streams are nullable while SpawnedProcess requires them; the double assertion is the bridge TS cannot infer.
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
