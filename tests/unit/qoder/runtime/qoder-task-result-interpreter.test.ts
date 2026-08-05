import { QoderTaskResultInterpreter } from '@/qoder/runtime/qoder-task-result-interpreter';

describe('QoderTaskResultInterpreter', () => {
  describe('hasAsyncLaunchMarker', () => {
    it('does not treat completed sync metadata with agentId as an async launch', () => {
      const interpreter = new QoderTaskResultInterpreter();

      expect(interpreter.hasAsyncLaunchMarker({
        status: 'completed',
        agentId: 'agent-sync',
        content: [
          { type: 'text', text: 'Final sync result.' },
          { type: 'text', text: 'agentId: agent-sync' },
        ],
      })).toBe(false);
    });

    it('treats explicit async launch markers as async', () => {
      const interpreter = new QoderTaskResultInterpreter();

      expect(interpreter.hasAsyncLaunchMarker({
        isAsync: true,
        status: 'async_launched',
        agentId: 'agent-async',
      })).toBe(true);
    });
  });
});
