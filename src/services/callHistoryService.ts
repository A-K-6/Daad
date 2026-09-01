import { CallRecord } from '../types/callHistory';

const STORAGE_KEY = 'daad_call_history';
const MAX_HISTORY_ITEMS = 50;

class CallHistoryService {
  private records: CallRecord[] = [];
  private listeners: Set<(records: CallRecord[]) => void> = new Set();

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem) {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
          this.records = JSON.parse(data);
        }
      }
    } catch (e) {
      console.warn('Failed to load call history:', e);
      this.records = [];
    }
  }

  private save() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.setItem) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records));
      }
    } catch (e) {
      console.warn('Failed to save call history:', e);
    }
    this.notify();
  }

  private notify() {
    this.listeners.forEach((l) => l([...this.records]));
  }

  public getRecords(): CallRecord[] {
    return [...this.records];
  }

  public addRecord(record: Omit<CallRecord, 'id' | 'timestamp'>): CallRecord {
    const newRecord: CallRecord = {
      ...record,
      id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
    };

    this.records = [newRecord, ...this.records].slice(0, MAX_HISTORY_ITEMS);
    this.save();
    return newRecord;
  }

  public clearHistory(): void {
    this.records = [];
    this.save();
  }

  public deleteRecord(id: string): void {
    this.records = this.records.filter((r) => r.id !== id);
    this.save();
  }

  public onChange(listener: (records: CallRecord[]) => void): () => void {
    this.listeners.add(listener);
    listener([...this.records]);
    return () => this.listeners.delete(listener);
  }
}

export const callHistoryService = new CallHistoryService();
