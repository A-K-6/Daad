import { sipService, assertLegacySipEnabled } from '@/services/sipService';
import { soundService } from '@/services/soundService';
import { audioDeviceService, AudioDevice } from '@/services/audioDeviceService';
import { callHistoryService } from '@/services/callHistoryService';
import { SipConfig, ConnectionState, CallState, CallInfo, CallRecord } from '@/types';

export type DaadEventMap = {
  'connection:state': (state: ConnectionState, error?: string) => void;
  'call:state': (state: CallState, info: CallInfo | null) => void;
  'call:incoming': (caller: string, info: CallInfo) => void;
  'call:history': (records: CallRecord[]) => void;
  'devices:changed': () => void;
};

export class DaadClient {
  private config: SipConfig | null = null;
  private isMuted: boolean = false;
  private isHeld: boolean = false;
  private eventListeners: { [K in keyof DaadEventMap]?: Set<DaadEventMap[K]> } = {};

  constructor(initialConfig?: SipConfig) {
    if (initialConfig) {
      this.config = initialConfig;
    }
    this.initSubscriptions();
  }

  private initSubscriptions() {
    sipService.onConnectionStateChange((state, err) => {
      this.emit('connection:state', state, err);
    });

    sipService.onCallStateChange((state, info) => {
      if (info) {
        this.isMuted = !!info.isMuted;
        this.isHeld = !!info.isHeld;
      }
      this.emit('call:state', state, info);
    });

    sipService.onIncomingCall((_, caller) => {
      const info = sipService.getCallInfo();
      if (info) {
        this.emit('call:incoming', caller, info);
      }
    });

    callHistoryService.onChange((records) => {
      this.emit('call:history', records);
    });

    audioDeviceService.onChange(() => {
      this.emit('devices:changed');
    });
  }

  /**
   * Connect and register to SIP PBX (TLS 5061, TCP 5060, UDP 5060, or WSS)
   * Legacy web path only — requires VITE_DEV_LEGACY_WS=1. Desktop uses nativeSipClient.
   */
  public async connect(config?: SipConfig): Promise<void> {
    assertLegacySipEnabled('DaadClient.connect');
    const targetConfig = config || this.config;
    if (!targetConfig) {
      throw new Error('No SIP configuration provided to DaadClient.connect()');
    }
    this.config = targetConfig;
    await sipService.connectAndRegister(targetConfig);
  }

  /**
   * Disconnect and unregister from PBX
   */
  public async disconnect(): Promise<void> {
    await sipService.disconnect(true);
  }

  /**
   * Place outbound voice call to extension or phone number
   */
  public async call(target: string): Promise<void> {
    assertLegacySipEnabled('DaadClient.call');
    await sipService.makeCall(target);
  }

  /**
   * Answer active incoming call
   */
  public async answer(): Promise<void> {
    assertLegacySipEnabled('DaadClient.answer');
    await sipService.answerCall();
  }

  /**
   * Reject / decline incoming call
   */
  public async reject(): Promise<void> {
    assertLegacySipEnabled('DaadClient.reject');
    await sipService.rejectCall();
  }

  /**
   * Hang up active call
   */
  public async hangup(): Promise<void> {
    assertLegacySipEnabled('DaadClient.hangup');
    await sipService.hangup();
  }

  /**
   * Toggle local microphone mute
   */
  public toggleMute(): boolean {
    assertLegacySipEnabled('DaadClient.toggleMute');
    this.isMuted = !this.isMuted;
    sipService.mute(this.isMuted);
    return this.isMuted;
  }

  /**
   * Toggle call hold / unhold (re-INVITE)
   */
  public async toggleHold(): Promise<boolean> {
    assertLegacySipEnabled('DaadClient.toggleHold');
    this.isHeld = !this.isHeld;
    await sipService.hold(this.isHeld);
    return this.isHeld;
  }

  /**
   * Send RFC 4733 / DTMF tone over active call
   */
  public sendDTMF(tone: string): void {
    assertLegacySipEnabled('DaadClient.sendDTMF');
    soundService.playDtmf(tone);
    sipService.sendDTMF(tone);
  }

  /**
   * Query available hardware audio inputs
   */
  public getInputDevices(): AudioDevice[] {
    return audioDeviceService.getInputDevices();
  }

  /**
   * Query available hardware audio outputs
   */
  public getOutputDevices(): AudioDevice[] {
    return audioDeviceService.getOutputDevices();
  }

  /**
   * Refresh available hardware audio devices
   */
  public async refreshDevices(): Promise<void> {
    await audioDeviceService.refreshDevices();
  }

  /**
   * Select active microphone or speaker by device ID
   */
  public async setAudioDevice(deviceId: string, kind: 'audioinput' | 'audiooutput'): Promise<void> {
    if (kind === 'audioinput') {
      audioDeviceService.setInputDevice(deviceId);
    } else {
      await audioDeviceService.setOutputDevice(deviceId);
    }
  }

  /**
   * Query current connection state
   */
  public getConnectionState(): ConnectionState {
    return sipService.getConnectionState();
  }

  /**
   * Query current call state
   */
  public getCallState(): CallState {
    return sipService.getCallState();
  }

  /**
   * Query active call metadata (duration, remote identity, hold state)
   */
  public getCallInfo(): CallInfo | null {
    return sipService.getCallInfo();
  }

  /**
   * Query call history
   */
  public getCallHistory(): CallRecord[] {
    return callHistoryService.getRecords();
  }

  /**
   * Clear persistent call history
   */
  public clearCallHistory(): void {
    callHistoryService.clearHistory();
  }

  /**
   * Subscribe to client events
   */
  public on<K extends keyof DaadEventMap>(event: K, listener: DaadEventMap[K]): () => void {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = new Set() as any;
    }
    this.eventListeners[event]!.add(listener as any);
    return () => {
      this.eventListeners[event]?.delete(listener as any);
    };
  }

  private emit<K extends keyof DaadEventMap>(event: K, ...args: Parameters<DaadEventMap[K]>) {
    const listeners = this.eventListeners[event];
    if (listeners) {
      listeners.forEach((listener: any) => {
        try {
          listener(...args);
        } catch (err) {
          console.error(`Error in DaadClient event listener for "${event}":`, err);
        }
      });
    }
  }
}

export const createDaadClient = (config?: SipConfig): DaadClient => {
  return new DaadClient(config);
};
