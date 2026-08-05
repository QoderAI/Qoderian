import { exec } from 'child_process';

export interface BangBashResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 1024 * 1024; // 1MB

function getShell(): string {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/sh';
}

export class BangBashService {
  private cwd: string;
  private enhancedPath: string;

  constructor(cwd: string, enhancedPath: string) {
    this.cwd = cwd;
    this.enhancedPath = enhancedPath;
  }

  execute(command: string): Promise<BangBashResult> {
    return new Promise((resolve) => {
      exec(command, {
        cwd: this.cwd,
        env: { ...process.env, PATH: this.enhancedPath },
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        shell: getShell(),
      }, (error, stdout, stderr) => {
        if (error && 'killed' in error && error.killed) {
          // Node.js types declare code as number, but maxBuffer errors set it to a string at runtime
          const isMaxBuffer = 'code' in error && (error.code as unknown) === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
          resolve({
            command,
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            exitCode: 124,
            error: isMaxBuffer
              ? 'Output exceeded maximum buffer size (1MB)'
              : `Command timed out after ${TIMEOUT_MS / 1000}s`,
          });
          return;
        }

        resolve({
          command,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        });
      });
    });
  }
}
