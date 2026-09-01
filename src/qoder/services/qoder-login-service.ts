import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';

import {
  cliPathRequiresNode,
  findNodeExecutable,
  getEnhancedPath,
  getMissingNodeError,
} from '../../core/env/environment';
import { getVaultPath } from '../../core/fs/path';
import type { QoderHostContext } from '../qoder-host-context';
import {
  resolveWindowsCmdShimSpawnSpec,
  terminateSpawnedProcess,
  type WindowsCmdShimSpawnSpec,
} from '../runtime/windows-cmd-shim';

export type QoderLoginPhase = 'idle' | 'starting' | 'waiting' | 'succeeded' | 'failed';

export type QoderLoginFailureKind = 'cliMissing' | 'nodeMissing' | 'spawn' | 'process';

export interface QoderLoginFailure {
  kind: QoderLoginFailureKind;
  details?: string;
}

export interface QoderLoginState {
  phase: QoderLoginPhase;
  authUrl: string | null;
  failure: QoderLoginFailure | null;
}

type QoderLoginStateListener = (state: QoderLoginState) => void;

/** Public surface consumed by the UI; keeps callers off the concrete class. */
export interface QoderLoginController {
  getState(): QoderLoginState;
  subscribe(listener: QoderLoginStateListener): () => void;
  isRunning(): boolean;
  start(): boolean;
  cancel(): void;
  openAuthUrl(): void;
  reset(): void;
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const AUTH_URL_PATTERN = /https?:\/\/[^\s\u001b]+/;
const OUTPUT_TAIL_LIMIT = 2_000;
const INITIAL_STATE: QoderLoginState = { phase: 'idle', authUrl: null, failure: null };

/** Opens an external URL through Obsidian's standard external-link handling. */
export function openExternalBrowserUrl(url: string): void {
  const anchor = createEl('a', {
    attr: { href: url, target: '_blank', rel: 'noopener' },
  });
  anchor.click();
  anchor.remove();
}

/**
 * Drives `qodercli login` from inside Obsidian.
 *
 * The CLI runs a device-flow login when spawned without a TTY: it prints an
 * authorization URL and polls until the user completes sign-in in their
 * browser. This service owns that child process and exposes the flow state to
 * the UI; credentials are written exclusively by the CLI itself.
 */
export class QoderLoginService implements QoderLoginController {
  private state: QoderLoginState = INITIAL_STATE;
  private readonly listeners = new Set<QoderLoginStateListener>();
  private child: ChildProcess | null = null;
  private spawnSpec: WindowsCmdShimSpawnSpec | null = null;
  private authUrl: string | null = null;
  private canceled = false;

  constructor(
    private readonly plugin: QoderHostContext,
    private readonly onSucceeded?: () => void,
  ) {}

  getState(): QoderLoginState {
    return this.state;
  }

  subscribe(listener: QoderLoginStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isRunning(): boolean {
    return this.state.phase === 'starting' || this.state.phase === 'waiting';
  }

  /** Starts a login attempt; returns false when one is already in flight. */
  start(): boolean {
    if (this.child) return false;

    const cliPath = this.plugin.getResolvedQoderCliPath();
    if (!cliPath) {
      this.setState({ phase: 'failed', authUrl: null, failure: { kind: 'cliMissing' } });
      return false;
    }
    const enhancedPath = getEnhancedPath(undefined, cliPath);
    const missingNodeError = getMissingNodeError(cliPath, enhancedPath);
    if (missingNodeError) {
      this.setState({
        phase: 'failed',
        authUrl: null,
        failure: { kind: 'nodeMissing', details: missingNodeError },
      });
      return false;
    }

    let command = cliPath;
    let args: string[] = ['login'];
    if (cliPathRequiresNode(cliPath)) {
      const nodePath = findNodeExecutable(enhancedPath);
      args = [cliPath, 'login'];
      command = nodePath ?? 'node';
    }

    this.canceled = false;
    this.authUrl = null;
    this.setState({ phase: 'starting', authUrl: null, failure: null });

    let child: ChildProcess;
    try {
      const spawnSpec = resolveWindowsCmdShimSpawnSpec({ command, args });
      child = spawn(spawnSpec.command, spawnSpec.args, {
        cwd: getVaultPath(this.plugin.app) || undefined,
        // BROWSER=www-browser is the CLI's headless marker: it skips its own browser launch, leaving the plugin as the single opener.
        env: { ...process.env, BROWSER: 'www-browser', PATH: enhancedPath },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        ...(spawnSpec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      });
      this.spawnSpec = spawnSpec;
    } catch (error) {
      this.setState({
        phase: 'failed',
        authUrl: null,
        failure: { kind: 'spawn', details: getErrorDetails(error) },
      });
      return false;
    }

    this.child = child;

    let stdoutBuffer = '';
    let stderrBuffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer = appendChunk(stdoutBuffer, chunk);
      if (this.authUrl) return;
      const match = stripAnsi(stdoutBuffer).match(AUTH_URL_PATTERN);
      if (!match) return;
      this.authUrl = match[0];
      // One-shot auto-open per attempt; the CLI's launch is disabled via BROWSER and the waiting button re-opens manually.
      openExternalBrowserUrl(this.authUrl);
      this.setState({ phase: 'waiting', authUrl: this.authUrl, failure: null });
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuffer = appendChunk(stderrBuffer, chunk);
    });
    child.on('error', (error) => {
      this.cleanup();
      this.setState({
        phase: 'failed',
        authUrl: this.authUrl,
        failure: { kind: 'spawn', details: getErrorDetails(error) },
      });
    });
    child.on('exit', (code) => {
      this.cleanup();
      if (this.canceled) {
        this.setState(INITIAL_STATE);
        return;
      }
      if (code === 0) {
        this.setState({ phase: 'succeeded', authUrl: null, failure: null });
        this.onSucceeded?.();
        return;
      }
      const details = stderrBuffer.trim() || stdoutBuffer.trim()
        || `qodercli login exited with code ${code ?? 'null'}`;
      this.setState({
        phase: 'failed',
        authUrl: this.authUrl,
        failure: { kind: 'process', details: details.slice(-OUTPUT_TAIL_LIMIT) },
      });
    });

    return true;
  }

  cancel(): void {
    if (!this.child) return;
    this.canceled = true;
    const killable = {
      pid: this.child.pid,
      kill: this.child.kill.bind(this.child),
    };
    terminateSpawnedProcess(killable, 'SIGTERM', spawn, this.spawnSpec);
  }

  /** Returns to idle after an attempt finished; lets the UI offer sign-in again. */
  reset(): void {
    if (this.child) return;
    if (this.state.phase !== 'idle') {
      this.setState(INITIAL_STATE);
    }
  }

  openAuthUrl(): void {
    if (this.authUrl) {
      openExternalBrowserUrl(this.authUrl);
    }
  }

  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }

  private cleanup(): void {
    this.child = null;
    this.spawnSpec = null;
  }

  private setState(state: QoderLoginState): void {
    this.state = state;
    for (const listener of [...this.listeners]) {
      listener(state);
    }
  }
}

function appendChunk(buffer: string, chunk: Buffer): string {
  const next = buffer + chunk.toString('utf8');
  return next.length > OUTPUT_TAIL_LIMIT ? next.slice(-OUTPUT_TAIL_LIMIT) : next;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, '');
}

function getErrorDetails(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
