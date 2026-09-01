import { describe, it, expect, beforeEach } from 'vitest';
import { callHistoryService } from './callHistoryService';

describe('CallHistoryService', () => {
  beforeEach(() => {
    callHistoryService.clearHistory();
  });

  it('adds and retrieves call records', () => {
    expect(callHistoryService.getRecords()).toHaveLength(0);

    const record = callHistoryService.addRecord({
      target: '1002',
      displayName: 'Support Desk',
      direction: 'outgoing',
      status: 'answered',
      duration: 45,
    });

    expect(record.id).toBeDefined();
    expect(record.timestamp).toBeDefined();
    expect(callHistoryService.getRecords()).toHaveLength(1);
    expect(callHistoryService.getRecords()[0].target).toBe('1002');
  });

  it('deletes individual record by id', () => {
    const record = callHistoryService.addRecord({
      target: '1003',
      direction: 'incoming',
      status: 'missed',
      duration: 0,
    });

    expect(callHistoryService.getRecords()).toHaveLength(1);
    callHistoryService.deleteRecord(record.id);
    expect(callHistoryService.getRecords()).toHaveLength(0);
  });

  it('clears all history', () => {
    callHistoryService.addRecord({ target: '1001', direction: 'outgoing', status: 'answered', duration: 10 });
    callHistoryService.addRecord({ target: '1002', direction: 'incoming', status: 'missed', duration: 0 });

    expect(callHistoryService.getRecords()).toHaveLength(2);
    callHistoryService.clearHistory();
    expect(callHistoryService.getRecords()).toHaveLength(0);
  });
});
