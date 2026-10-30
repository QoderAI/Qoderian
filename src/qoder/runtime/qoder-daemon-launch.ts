import type { Options } from '@qoder-ai/qoder-agent-sdk';
import { ProcessTransport } from '@qoder-ai/qoder-agent-sdk';

/**
 * SDK-spawned sessions run qodercli in its "sdk" runtime mode, where
 * CLI-configured custom providers (self-defined base URLs) stay disabled
 * unless this opt-in is present — without it the CLI hides their models.
 */
export const CUSTOM_PROVIDER_CLI_ENV = { QODER_SDK_CUSTOM_BASE_URL_BYOK: '1' } as const;

/**
 * Identifies this host integration to the CLI, which reports it as the
 * `integration_id` telemetry attribute. Only a UUIDv4 is accepted; any other
 * value is silently dropped.
 */
export const INTEGRATION_CLI_ENV = {
  QODER_INTEGRATION_ID: '70457212-a449-4ae3-af1e-5fb9e00fafcf',
} as const;

export interface DaemonLaunchOptions {
  pathToQoderCLIExecutable: string;
  transport: Options['transport'];
  env: Record<string, string | undefined>;
}

/**
 * Builds the daemon-bound options shared by every Query in this host.
 *
 * The SDK owns the daemon process and ignores `spawnQoderCLIProcess` when it
 * launches that process, so launch-critical settings (the CLI entry and its
 * environment) must live in these options instead. The daemon is process-wide
 * and rejects a Query whose launch options differ, so every query site must
 * build them through this helper.
 */
export function buildDaemonLaunchOptions(
  cliPath: string,
  enhancedPath: string,
  extraEnv?: Record<string, string>,
): DaemonLaunchOptions {
  return {
    pathToQoderCLIExecutable: cliPath,
    transport: ProcessTransport.default,
    env: {
      ...process.env,
      ...extraEnv,
      ...CUSTOM_PROVIDER_CLI_ENV,
      ...INTEGRATION_CLI_ENV,
      PATH: enhancedPath,
    },
  };
}
