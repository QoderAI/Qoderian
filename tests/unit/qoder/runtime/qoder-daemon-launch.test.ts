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
});
