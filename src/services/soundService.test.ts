import { describe, it, expect, vi, beforeEach } from 'vitest';
import { soundService } from './soundService';

describe('SoundService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    soundService.stopAll();
  });

  it('should play DTMF tones without error for valid keys', () => {
    expect(() => {
      soundService.playDtmf('1');
      soundService.playDtmf('*');
      soundService.playDtmf('#');
      soundService.playDtmf('0');
    }).not.toThrow();
  });

  it('should ignore invalid DTMF keys gracefully', () => {
    expect(() => {
      soundService.playDtmf('Z');
    }).not.toThrow();
  });

  it('should start and stop ringback cadence', () => {
    expect(() => {
      soundService.startRingback();
      soundService.stopRingback();
    }).not.toThrow();
  });

  it('should start and stop incoming ringtone melody', () => {
    expect(() => {
      soundService.startRingtone();
      soundService.stopRingtone();
    }).not.toThrow();
  });

  it('should play call end tone', () => {
    expect(() => {
      soundService.playCallEndTone();
    }).not.toThrow();
  });

  it('should stop all sounds on stopAll', () => {
    expect(() => {
      soundService.startRingback();
      soundService.startRingtone();
      soundService.stopAll();
    }).not.toThrow();
  });
});
