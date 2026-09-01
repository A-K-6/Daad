import { CallDirection } from './sip';

export type CallStatus = 'answered' | 'missed' | 'rejected' | 'failed';

export interface CallRecord {
  id: string;
  target: string;
  displayName?: string;
  direction: CallDirection;
  status: CallStatus;
  duration: number; // seconds
  timestamp: number; // epoch ms
}
