import {
  beginRestoreReport,
  finishRestoreReport,
  reportRestoreIssue,
} from '@/core/diagnostics/restore-report';

describe('restore report', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // Reset any window left open by a previous test.
    finishRestoreReport();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('collects issues reported while the window is open', () => {
    beginRestoreReport();
    reportRestoreIssue('layout', 'layout corrupt');
    reportRestoreIssue('tab', 'tab-1 failed');

    expect(finishRestoreReport()).toEqual([
      { stage: 'layout', detail: 'layout corrupt' },
      { stage: 'tab', detail: 'tab-1 failed' },
    ]);
  });

  it('stops collecting once the window is closed', () => {
    beginRestoreReport();
    reportRestoreIssue('history', 'inside window');
    expect(finishRestoreReport()).toHaveLength(1);

    reportRestoreIssue('history', 'after window');
    expect(finishRestoreReport()).toEqual([]);
  });

  it('logs issues reported outside the window without collecting them', () => {
    reportRestoreIssue('metadata', 'no window');

    expect(errorSpy).toHaveBeenCalledWith('[qoderian-restore:metadata] no window');
    expect(finishRestoreReport()).toEqual([]);
  });

  it('always logs issues to the console for debugging', () => {
    beginRestoreReport();
    reportRestoreIssue('tab', 'boom');

    expect(errorSpy).toHaveBeenCalledWith('[qoderian-restore:tab] boom');
  });

  it('drops duplicate issues with the same stage and detail', () => {
    beginRestoreReport();
    reportRestoreIssue('layout', 'data.json unreadable');
    reportRestoreIssue('layout', 'data.json unreadable');
    reportRestoreIssue('tab', 'tab-1 failed');

    expect(finishRestoreReport()).toEqual([
      { stage: 'layout', detail: 'data.json unreadable' },
      { stage: 'tab', detail: 'tab-1 failed' },
    ]);
  });
});
