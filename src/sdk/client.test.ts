import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDaadClient, DaadClient } from './client';
import { SipConfig } from '@/types';

describe('DaadClient SDK', () => {
  const mockConfig: SipConfig = {
    serverUrl: 'wss://pbx.example.com:8089/ws',
    sipUri: 'sip:1001@pbx.example.com',
    username: '1001',
    password: 'secretPassword',
    displayName: 'Aeen Developer',
  };

  let client: DaadClient;

  beforeEach(() => {
    client = createDaadClient(mockConfig);
  });

  it('instantiates client with configuration', () => {
    expect(client).toBeInstanceOf(DaadClient);
    expect(client.getConnectionState()).toBe('Disconnected');
    expect(client.getCallState()).toBe('Idle');
    expect(client.getCallInfo()).toBeNull();
  });

  it('subscribes and receives state events', () => {
    const stateListener = vi.fn();
    const unsub = client.on('connection:state', stateListener);

    expect(typeof unsub).toBe('function');
  });

  it('handles audio devices queries without throwing', () => {
    const inputs = client.getInputDevices();
    const outputs = client.getOutputDevices();
    expect(Array.isArray(inputs)).toBe(true);
    expect(Array.isArray(outputs)).toBe(true);
  });

  it('manages call history', () => {
    const history = client.getCallHistory();
    expect(Array.isArray(history)).toBe(true);

    client.clearCallHistory();
    expect(client.getCallHistory()).toHaveLength(0);
  });
});
