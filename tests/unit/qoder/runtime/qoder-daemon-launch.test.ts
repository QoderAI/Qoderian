import { ProcessTransport } from '@qoder-ai/qoder-agent-sdk';

import {
  buildDaemonLaunchOptions,
  CUSTOM_PROVIDER_CLI_ENV,
  INTEGRATION_CLI_ENV,
} from '@/qoder/runtime/qoder-daemon-launch';

describe('buildDaemonLaunchOptions', () => {
  it('pins the process carrier so the installed CLI is used', () => {
    const options = buildDaemonLaunchOptions('/opt/qodercli', '/opt/bin');

    expect(options.transport).toBe(ProcessTransport.default);
    expect(options.pathToQoderCLIExecutable).toBe('/opt/qodercli');
  });

  it('injects the SDK runtime opt-ins into the daemon environment', () => {
    const options = buildDaemonLaunchOptions('/opt/qodercli', '/opt/bin');

    expect(options.env).toMatchObject({
      ...CUSTOM_PROVIDER_CLI_ENV,
      ...INTEGRATION_CLI_ENV,
      PATH: '/opt/bin',
    });
  });

  it('merges caller env without letting it override PATH', () => {
    const options = buildDaemonLaunchOptions('/opt/qodercli', '/opt/bin', {
      CUSTOM_FLAG: '1',
      PATH: '/ignored',
    });

    expect(options.env.CUSTOM_FLAG).toBe('1');
    expect(options.env.PATH).toBe('/opt/bin');
  });

  it('ignores process.env keys added after the first build', () => {
    // Other plugins share the renderer's process.env (e.g. Copilot sets
    // CLAUDE_AGENT_SDK_VERSION), and the SDK rejects a Query whose daemon env
    // gained a key since the daemon started.
    const first = buildDaemonLaunchOptions('/opt/qodercli', '/opt/bin');
    process.env.QODERIAN_TEST_LATE_ENV = '0.3.306';
    try {
      const second = buildDaemonLaunchOptions('/opt/qodercli', '/opt/bin');

      // Compare keys only so a failure never prints the host's env values.
      expect(Object.keys(second.env).sort()).toEqual(Object.keys(first.env).sort());
      expect(second.env.QODERIAN_TEST_LATE_ENV).toBeUndefined();
    } finally {
      delete process.env.QODERIAN_TEST_LATE_ENV;
    }
  });
});
