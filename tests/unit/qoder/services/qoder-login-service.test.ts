/** @jest-environment jsdom */
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import * as env from '@/core/env/environment';
import * as fsPath from '@/core/fs/path';
import type { QoderHostContext } from '@/qoder/qoder-host-context';
import { QoderLoginService } from '@/qoder/services/qoder-login-service';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  kill: jest.Mock;
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;
  child.kill = jest.fn(() => true);
  return child;
}

function createPlugin(cliPath: string | null): QoderHostContext {
  return {
    app: {} as QoderHostContext['app'],
    settings: {} as QoderHostContext['settings'],
    getResolvedQoderCliPath: () => cliPath,
  };
}

describe('QoderLoginService', () => {
  const spawnMock = spawn as jest.MockedFunction<typeof spawn>;

  beforeEach(() => {
    spawnMock.mockClear();
    jest.spyOn(env, 'getEnhancedPath').mockReturnValue('/enhanced');
    jest.spyOn(env, 'getMissingNodeError').mockReturnValue(null);
    jest.spyOn(env, 'cliPathRequiresNode').mockReturnValue(false);
    jest.spyOn(env, 'findNodeExecutable').mockReturnValue('/enhanced/node');
    jest.spyOn(fsPath, 'getVaultPath').mockReturnValue('/vault');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails with cliMissing when no CLI path is resolved', () => {
    const service = new QoderLoginService(createPlugin(null));

    expect(service.start()).toBe(false);
    expect(service.getState()).toEqual({
      phase: 'failed',
      authUrl: null,
      failure: { kind: 'cliMissing' },
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('fails with nodeMissing when a Node-backed CLI has no Node runtime', () => {
    jest.spyOn(env, 'getMissingNodeError').mockReturnValue('Node not found');
    const service = new QoderLoginService(createPlugin('/bin/qodercli'));

    expect(service.start()).toBe(false);
    expect(service.getState().phase).toBe('failed');
    expect(service.getState().failure?.kind).toBe('nodeMissing');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('spawns the CLI login command and extracts the device-flow URL', () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const service = new QoderLoginService(createPlugin('/bin/qodercli'));

    expect(service.start()).toBe(true);
    expect(service.getState().phase).toBe('starting');
    expect(spawnMock).toHaveBeenCalledWith(
      '/bin/qodercli',
      ['login'],
      expect.objectContaining({ cwd: '/vault' }),
    );

    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    child.stdout.emit('data', Buffer.from(
      'Starting browser login...\n\n'
      + 'Please open the following URL in your browser to sign in:\n\n'
      + '  https://qoder.com/device/selectAccounts?challenge=abc\u001b[0m\n\n'
      + 'Waiting for browser authorization...\n',
    ));

    expect(service.getState()).toEqual({
      phase: 'waiting',
      authUrl: 'https://qoder.com/device/selectAccounts?challenge=abc',
      failure: null,
    });
    // The plugin owns the browser: exactly one auto-open when the URL arrives.
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // Repeated URL output within the same attempt must not open again.
    child.stdout.emit('data', Buffer.from(
      '  https://qoder.com/device/selectAccounts?challenge=abc\n',
    ));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    service.openAuthUrl();
    expect(clickSpy).toHaveBeenCalledTimes(2);
    clickSpy.mockRestore();
  });

  it('disables the CLI own browser launch via the BROWSER headless marker', () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const service = new QoderLoginService(createPlugin('/bin/qodercli'));

    service.start();

    const options = spawnMock.mock.calls[0][2] as { env: Record<string, string> };
    expect(options.env.BROWSER).toBe('www-browser');
  });

  it('rejects a second start while a login attempt is running', () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const service = new QoderLoginService(createPlugin('/bin/qodercli'));

    expect(service.start()).toBe(true);
    expect(service.start()).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('succeeds on exit code 0 and notifies the success callback', () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const onSucceeded = jest.fn();
    const service = new QoderLoginService(createPlugin('/bin/qodercli'), onSucceeded);
    const listener = jest.fn();
    service.subscribe(listener);

    service.start();
    child.emit('exit', 0);

    expect(service.getState()).toEqual({ phase: 'succeeded', authUrl: null, failure: null });
    expect(onSucceeded).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'succeeded' }));
  });

  it('fails with process details on a non-zero exit', () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const service = new QoderLoginService(createPlugin('/bin/qodercli'));

    service.start();
    child.stderr.emit('data', Buffer.from('Device flow poll failed\n'));
    child.emit('exit', 1);

    const state = service.getState();
    expect(state.phase).toBe('failed');
    expect(state.failure).toEqual({ kind: 'process', details: 'Device flow poll failed' });
  });

  it('returns to idle when the attempt is canceled', () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const service = new QoderLoginService(createPlugin('/bin/qodercli'));

    service.start();
    expect(service.isRunning()).toBe(true);
    service.cancel();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('exit', null, 'SIGTERM');

    expect(service.getState()).toEqual({ phase: 'idle', authUrl: null, failure: null });
    expect(service.isRunning()).toBe(false);
  });

  it('reports spawn errors as failed state', () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const service = new QoderLoginService(createPlugin('/bin/qodercli'));

    service.start();
    child.emit('error', new Error('spawn ENOENT'));

    expect(service.getState()).toEqual({
      phase: 'failed',
      authUrl: null,
      failure: { kind: 'spawn', details: 'spawn ENOENT' },
    });
  });

  it('resets finished attempts to idle but leaves running attempts alone', () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const service = new QoderLoginService(createPlugin('/bin/qodercli'));

    service.start();
    service.reset();
    expect(service.getState().phase).toBe('starting');

    child.emit('exit', 0);
    service.reset();
    expect(service.getState().phase).toBe('idle');
  });

  it('routes Node-backed CLI paths through the node executable', () => {
    jest.spyOn(env, 'cliPathRequiresNode').mockReturnValue(true);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const service = new QoderLoginService(createPlugin('/npm/qodercli/cli.js'));

    service.start();

    expect(spawnMock).toHaveBeenCalledWith(
      '/enhanced/node',
      ['/npm/qodercli/cli.js', 'login'],
      expect.any(Object),
    );
  });
});
