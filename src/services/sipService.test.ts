import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sipService } from './sipService';
import { SipConfig } from '@/types';

describe('SipService', () => {
  const sampleConfig: SipConfig = {
    serverUrl: 'wss://pbx.example.com:8089/ws',
    sipUri: 'sip:1001@pbx.example.com',
    username: '1001',
    password: 'secretPassword',
    displayName: 'User 1001',
    stunServer: 'stun:stun.l.google.com:19302',
    registerExpires: 600,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await sipService.disconnect();
  });

  it('should initialize with Disconnected connection state and Idle call state', () => {
    expect(sipService.getConnectionState()).toBe('Disconnected');
    expect(sipService.getCallState()).toBe('Idle');
    expect(sipService.getCallInfo()).toBeNull();
  });

  it('should handle connectAndRegister with invalid URI gracefully', async () => {
    await expect(
      sipService.connectAndRegister({
        ...sampleConfig,
        sipUri: 'invalid-uri-without-scheme',
      })
    ).rejects.toThrow();
    expect(sipService.getConnectionState()).toBe('RegistrationFailed');
  });

  it('should notify listeners on connection state changes', () => {
    const listener = vi.fn();
    const unsubscribe = sipService.onConnectionStateChange(listener);

    expect(listener).toHaveBeenCalledWith('Disconnected');
    unsubscribe();
  });

  it('should notify listeners on call state changes', () => {
    const listener = vi.fn();
    const unsubscribe = sipService.onCallStateChange(listener);

    expect(listener).toHaveBeenCalledWith('Idle', null);
    unsubscribe();
  });

  it('should throw error when makeCall is called without connection', async () => {
    await expect(sipService.makeCall('1002')).rejects.toThrow('SIP client not connected');
  });

  it('should safely handle hangup when idle', async () => {
    await expect(sipService.hangup()).resolves.not.toThrow();
    expect(sipService.getCallState()).toBe('Idle');
  });

  it('should safely handle mute when no call is active', () => {
    expect(() => sipService.mute(true)).not.toThrow();
    expect(() => sipService.mute(false)).not.toThrow();
  });

  it('should safely handle hold when no call is active', async () => {
    await expect(sipService.hold(true)).resolves.not.toThrow();
    await expect(sipService.hold(false)).resolves.not.toThrow();
  });

  it('should play DTMF tone on sendDTMF', () => {
    expect(() => sipService.sendDTMF('5')).not.toThrow();
  });

  it('should handle disconnect cleanly', async () => {
    await expect(sipService.disconnect()).resolves.not.toThrow();
    expect(sipService.getConnectionState()).toBe('Disconnected');
    expect(sipService.getCallState()).toBe('Idle');
  });
});
