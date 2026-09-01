import {
  UserAgent,
  UserAgentOptions,
  Registerer,
  RegistererState,
  Inviter,
  Invitation,
  Session,
  SessionState,
  Web,
  URI,
} from 'sip.js';
import { SipConfig, ConnectionState, CallState, CallInfo, CallDirection } from '@/types';
import { soundService } from './soundService';
import { callHistoryService } from './callHistoryService';
import { audioDeviceService } from './audioDeviceService';

type ConnectionStateListener = (state: ConnectionState, error?: string) => void;
type CallStateListener = (state: CallState, info: CallInfo | null) => void;
type IncomingCallListener = (invitation: Invitation, caller: string) => void;

class SipService {
  private userAgent: UserAgent | null = null;
  private registerer: Registerer | null = null;
  private currentSession: Session | null = null;
  private incomingInvitation: Invitation | null = null;
  private currentConfig: SipConfig | null = null;

  private connectionState: ConnectionState = 'Disconnected';
  private callState: CallState = 'Idle';
  private callInfo: CallInfo | null = null;
  private callTimerInterval: number | null = null;

  // Auto-reconnect with exponential backoff
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private shouldAutoReconnect = true;

  private connectionListeners: Set<ConnectionStateListener> = new Set();
  private callStateListeners: Set<CallStateListener> = new Set();
  private incomingCallListeners: Set<IncomingCallListener> = new Set();

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  public getCallState(): CallState {
    return this.callState;
  }

  public getCallInfo(): CallInfo | null {
    return this.callInfo;
  }

  public getConfig(): SipConfig | null {
    return this.currentConfig;
  }

  public onConnectionStateChange(listener: ConnectionStateListener): () => void {
    this.connectionListeners.add(listener);
    listener(this.connectionState);
    return () => this.connectionListeners.delete(listener);
  }

  public onCallStateChange(listener: CallStateListener): () => void {
    this.callStateListeners.add(listener);
    listener(this.callState, this.callInfo);
    return () => this.callStateListeners.delete(listener);
  }

  public onIncomingCall(listener: IncomingCallListener): () => void {
    this.incomingCallListeners.add(listener);
    return () => this.incomingCallListeners.delete(listener);
  }

  private setConnectionState(state: ConnectionState, error?: string) {
    this.connectionState = state;
    this.connectionListeners.forEach((l) => l(state, error));

    if (state === 'Registered') {
      this.reconnectAttempts = 0;
      this.clearReconnectTimer();
    } else if (state === 'RegistrationFailed' || state === 'Disconnected') {
      if (this.shouldAutoReconnect && this.currentConfig && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    }
  }

  private setCallState(state: CallState) {
    this.callState = state;
    if (state === 'Active' && this.callInfo && !this.callTimerInterval) {
      const startTime = Date.now();
      this.callInfo.startTime = startTime;
      this.callTimerInterval = window.setInterval(() => {
        if (this.callInfo && this.callInfo.startTime) {
          this.callInfo.duration = Math.floor((Date.now() - this.callInfo.startTime) / 1000);
          this.emitCallUpdate();
        }
      }, 1000);
    }
    this.emitCallUpdate();
  }

  private emitCallUpdate() {
    this.callStateListeners.forEach((l) => l(this.callState, this.callInfo));
  }

  private updateCallInfo(partial: Partial<CallInfo>) {
    if (this.callInfo) {
      this.callInfo = { ...this.callInfo, ...partial };
      this.emitCallUpdate();
    }
  }

  private scheduleReconnect() {
    this.clearReconnectTimer();
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = window.setTimeout(() => {
      if (this.currentConfig && this.connectionState !== 'Registered' && this.connectionState !== 'Connecting') {
        console.log(`Attempting SIP reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        this.connectAndRegister(this.currentConfig).catch((e) => {
          console.warn('Auto-reconnection attempt failed:', e);
        });
      }
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Connect to WSS server and Register SIP Account
   */
  public async connectAndRegister(config: SipConfig): Promise<void> {
    try {
      this.shouldAutoReconnect = true;
      this.clearReconnectTimer();
      await this.disconnect(false);

      this.currentConfig = config;
      this.setConnectionState('Connecting');

      const uri = UserAgent.makeURI(config.sipUri.trim());
      if (!uri) {
        throw new Error(`Invalid SIP URI: ${config.sipUri}`);
      }

      const transportServer = await this.resolveServerTransport(config.serverUrl.trim());

      const userAgentOptions: UserAgentOptions = {
        uri,
        transportOptions: {
          server: transportServer,
          traceSip: false,
        },
        authorizationUsername: config.username.trim(),
        authorizationPassword: config.password,
        displayName: config.displayName?.trim() || config.username.trim(),
        sessionDescriptionHandlerFactory: Web.defaultSessionDescriptionHandlerFactory(),
        sessionDescriptionHandlerFactoryOptions: {
          peerConnectionConfiguration: {
            iceServers: config.stunServer?.trim()
              ? [{ urls: config.stunServer.trim() }]
              : [{ urls: 'stun:stun.l.google.com:19302' }],
          },
        },
        delegate: {
          onInvite: (invitation: Invitation) => {
            this.handleIncomingInvitation(invitation);
          },
          onDisconnect: (error) => {
            if (error) {
              console.warn('SIP Transport Disconnected:', error);
              this.setConnectionState('RegistrationFailed', error.message);
            } else {
              this.setConnectionState('Disconnected');
            }
          },
        },
      };

      this.userAgent = new UserAgent(userAgentOptions);
      await this.userAgent.start();

      this.registerer = new Registerer(this.userAgent, {
        expires: config.registerExpires || 600,
      });

      this.registerer.stateChange.addListener((state: RegistererState) => {
        switch (state) {
          case RegistererState.Registered:
            this.setConnectionState('Registered');
            break;
          case RegistererState.Unregistered:
          case RegistererState.Terminated:
            this.setConnectionState('Disconnected');
            break;
        }
      });

      await this.registerer.register({
        requestDelegate: {
          onReject: (response) => {
            console.error('SIP Registration Rejected:', response);
            this.setConnectionState('RegistrationFailed', `Registration rejected (${response.message.statusCode}: ${response.message.reasonPhrase})`);
          },
        },
      });
    } catch (err: unknown) {
      console.error('Failed to initialize SIP client:', err);
      const msg = err instanceof Error ? err.message : String(err);
      this.setConnectionState('RegistrationFailed', msg);
      throw err;
    }
  }

  /**
   * Disconnect and teardown SIP client
   */
  public async disconnect(stopAutoReconnect: boolean = true): Promise<void> {
    if (stopAutoReconnect) {
      this.shouldAutoReconnect = false;
      this.clearReconnectTimer();
      this.reconnectAttempts = 0;
    }

    try {
      if (this.currentSession) {
        await this.hangup();
      }

      if (this.registerer) {
        try {
          await this.registerer.unregister();
        } catch (e) {
          console.warn('Unregister error:', e);
        }
        this.registerer.dispose();
        this.registerer = null;
      }

      if (this.userAgent) {
        await this.userAgent.stop();
        this.userAgent = null;
      }

      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('stop_sip_bridge');
        } catch (_) {}
      }

      this.currentConfig = null;
      this.currentSession = null;
      this.incomingInvitation = null;
      this.setCallState('Idle');
      this.setConnectionState('Disconnected');
    } catch (e) {
      console.warn('Error during disconnect teardown:', e);
      this.setConnectionState('Disconnected');
    }
  }

  private async resolveServerTransport(serverUrl: string): Promise<string> {
    const clean = serverUrl.trim();

    if (clean.startsWith('wss://') || clean.startsWith('ws://')) {
      return clean;
    }

    let transport = 'tls';
    let hostPort = clean;

    if (clean.startsWith('tls://')) {
      transport = 'tls';
      hostPort = clean.replace(/^tls:\/\//, '');
    } else if (clean.startsWith('tcp://')) {
      transport = 'tcp';
      hostPort = clean.replace(/^tcp:\/\//, '');
    } else if (clean.startsWith('udp://')) {
      transport = 'udp';
      hostPort = clean.replace(/^udp:\/\//, '');
    } else if (clean.startsWith('sip:')) {
      const hasTls = clean.toLowerCase().includes('transport=tls');
      const hasTcp = clean.toLowerCase().includes('transport=tcp');
      const hasUdp = clean.toLowerCase().includes('transport=udp');
      transport = hasTls ? 'tls' : hasTcp ? 'tcp' : hasUdp ? 'udp' : 'tls';
      hostPort = clean.replace(/^sip:/, '').split(';')[0];
    }

    const parts = hostPort.split(':');
    const remoteHost = parts[0];
    const remotePort = parts[1] ? parseInt(parts[1], 10) : (transport === 'tls' ? 5061 : 5060);

    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const bridge = await invoke<{ local_ws_url: string }>('start_sip_bridge', {
          remoteHost,
          remotePort,
          transport,
          allowInsecure: true,
        });
        console.log(`Native SIP bridge started: ${transport.toUpperCase()} -> ${remoteHost}:${remotePort} via ${bridge.local_ws_url}`);
        return bridge.local_ws_url;
      } catch (e) {
        console.warn('Failed to start native SIP bridge, falling back to direct:', e);
      }
    }

    return `ws://${remoteHost}:${remotePort}`;
  }

  /**
   * Initiate an outgoing audio call
   */
  public async makeCall(target: string): Promise<void> {
    if (!this.userAgent) {
      throw new Error('SIP client not connected');
    }
    if (this.callState !== 'Idle') {
      throw new Error('A call is already in progress');
    }

    const cleanTarget = target.trim();
    let targetUri: URI | undefined;

    if (cleanTarget.startsWith('sip:')) {
      targetUri = UserAgent.makeURI(cleanTarget);
    } else {
      const domain = this.currentConfig?.sipUri.includes('@')
        ? this.currentConfig.sipUri.split('@')[1]
        : 'localhost';
      targetUri = UserAgent.makeURI(`sip:${cleanTarget}@${domain}`);
    }

    if (!targetUri) {
      throw new Error(`Invalid destination number or URI: ${cleanTarget}`);
    }

    const audioConstraints = audioDeviceService.getAudioConstraints();

    const inviter = new Inviter(this.userAgent, targetUri, {
      sessionDescriptionHandlerOptions: {
        constraints: { audio: audioConstraints, video: false },
      },
    });

    this.currentSession = inviter;
    this.callInfo = {
      remoteIdentity: cleanTarget,
      remoteUri: targetUri.toString(),
      direction: 'outgoing',
      startTime: null,
      duration: 0,
      isMuted: false,
      isHeld: false,
    };

    this.setupSessionListeners(inviter, 'outgoing', cleanTarget);

    this.setCallState('Calling');
    soundService.startRingback();

    try {
      await inviter.invite({
        requestDelegate: {
          onProgress: (response) => {
            if (response.message.statusCode === 180 || response.message.statusCode === 183) {
              this.setCallState('Ringing');
            }
          },
          onReject: (_response) => {
            soundService.stopRingback();
            soundService.playCallEndTone();

            callHistoryService.addRecord({
              target: cleanTarget,
              displayName: cleanTarget,
              direction: 'outgoing',
              status: 'rejected',
              duration: 0,
            });

            this.handleCallTerminated();
          },
        },
      });
    } catch (error) {
      soundService.stopRingback();
      soundService.playCallEndTone();

      callHistoryService.addRecord({
        target: cleanTarget,
        displayName: cleanTarget,
        direction: 'outgoing',
        status: 'failed',
        duration: 0,
      });

      this.handleCallTerminated();
      throw error;
    }
  }

  /**
   * Handle incoming call invitation
   */
  private handleIncomingInvitation(invitation: Invitation) {
    if (this.callState !== 'Idle' || this.incomingInvitation) {
      invitation.reject({ statusCode: 486 });
      return;
    }

    this.incomingInvitation = invitation;
    const callerId =
      invitation.remoteIdentity.displayName ||
      invitation.remoteIdentity.uri.user ||
      invitation.remoteIdentity.uri.toString();

    this.callInfo = {
      remoteIdentity: callerId,
      remoteUri: invitation.remoteIdentity.uri.toString(),
      direction: 'incoming',
      startTime: null,
      duration: 0,
      isMuted: false,
      isHeld: false,
    };

    this.setCallState('Ringing');
    soundService.startRingtone();

    invitation.stateChange.addListener((state: SessionState) => {
      if (state === SessionState.Terminated) {
        soundService.stopRingtone();
        if (this.incomingInvitation === invitation) {
          this.incomingInvitation = null;
          // Missed call
          callHistoryService.addRecord({
            target: callerId,
            displayName: callerId,
            direction: 'incoming',
            status: 'missed',
            duration: 0,
          });
        }
        this.handleCallTerminated();
      }
    });

    this.incomingCallListeners.forEach((l) => l(invitation, callerId));
  }

  /**
   * Accept / Answer incoming call
   */
  public async answerCall(): Promise<void> {
    if (!this.incomingInvitation) {
      throw new Error('No incoming call to answer');
    }

    soundService.stopRingtone();
    const invitation = this.incomingInvitation;
    this.currentSession = invitation;
    this.incomingInvitation = null;

    const callerId =
      invitation.remoteIdentity.displayName ||
      invitation.remoteIdentity.uri.user ||
      'Caller';

    this.setupSessionListeners(invitation, 'incoming', callerId);

    const audioConstraints = audioDeviceService.getAudioConstraints();

    try {
      await invitation.accept({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: audioConstraints, video: false },
        },
      });
      this.setCallState('Active');
    } catch (e) {
      console.error('Failed to answer incoming call:', e);
      this.handleCallTerminated();
    }
  }

  /**
   * Reject incoming call
   */
  public async rejectCall(): Promise<void> {
    soundService.stopRingtone();
    if (this.incomingInvitation) {
      const caller = this.callInfo?.remoteIdentity || 'Caller';
      try {
        await this.incomingInvitation.reject();
      } catch (e) {
        console.warn('Reject call error:', e);
      } finally {
        callHistoryService.addRecord({
          target: caller,
          displayName: caller,
          direction: 'incoming',
          status: 'rejected',
          duration: 0,
        });
        this.incomingInvitation = null;
        this.handleCallTerminated();
      }
    }
  }

  /**
   * Hang up active / in-progress call
   */
  public async hangup(): Promise<void> {
    soundService.stopAll();

    if (this.incomingInvitation) {
      await this.rejectCall();
      return;
    }

    if (!this.currentSession) {
      this.handleCallTerminated();
      return;
    }

    const duration = this.callInfo?.duration || 0;
    const remoteTarget = this.callInfo?.remoteIdentity || 'Remote Party';
    const direction = this.callInfo?.direction || 'outgoing';

    try {
      switch (this.currentSession.state) {
        case SessionState.Initial:
        case SessionState.Establishing:
          if (this.currentSession instanceof Inviter) {
            await this.currentSession.cancel();
          } else if (this.currentSession instanceof Invitation) {
            await this.currentSession.reject();
          }
          break;
        case SessionState.Established:
          await this.currentSession.bye();
          break;
      }
    } catch (e) {
      console.warn('Hangup error:', e);
    } finally {
      callHistoryService.addRecord({
        target: remoteTarget,
        displayName: remoteTarget,
        direction,
        status: 'answered',
        duration,
      });

      soundService.playCallEndTone();
      this.handleCallTerminated();
    }
  }

  /**
   * Toggle microphone mute
   */
  public mute(muted: boolean): void {
    if (!this.currentSession) return;
    const sdh = this.currentSession.sessionDescriptionHandler as Web.SessionDescriptionHandler | undefined;
    if (sdh?.peerConnection) {
      sdh.peerConnection.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === 'audio') {
          sender.track.enabled = !muted;
        }
      });
    }
    this.updateCallInfo({ isMuted: muted });
  }

  /**
   * Toggle call hold
   */
  public async hold(held: boolean): Promise<void> {
    if (!this.currentSession || this.currentSession.state !== SessionState.Established) return;

    try {
      if (held) {
        await this.currentSession.invite({
          sessionDescriptionHandlerModifiers: [Web.holdModifier],
        });
        this.setCallState('Holding');
        this.updateCallInfo({ isHeld: true });
      } else {
        await this.currentSession.invite({
          sessionDescriptionHandlerModifiers: [],
        });
        this.setCallState('Active');
        this.updateCallInfo({ isHeld: false });
      }
    } catch (e) {
      console.warn('Failed to toggle hold:', e);
    }
  }

  /**
   * Send in-call DTMF tone
   */
  public sendDTMF(tone: string): void {
    soundService.playDtmf(tone);

    if (!this.currentSession || this.currentSession.state !== SessionState.Established) return;

    const sdh = this.currentSession.sessionDescriptionHandler as Web.SessionDescriptionHandler | undefined;
    if (!sdh?.peerConnection) return;

    const senders = sdh.peerConnection.getSenders();
    const audioSender = senders.find((s) => s.track && s.track.kind === 'audio');
    if (audioSender?.dtmf) {
      try {
        audioSender.dtmf.insertDTMF(tone, 150, 100);
      } catch (e) {
        console.warn('DTMF insert error:', e);
      }
    }
  }

  private setupSessionListeners(session: Session, _direction: CallDirection, _remoteTarget: string) {
    session.stateChange.addListener((state: SessionState) => {
      switch (state) {
        case SessionState.Establishing:
          this.setCallState('Calling');
          break;
        case SessionState.Established:
          soundService.stopRingback();
          soundService.stopRingtone();
          this.setCallState('Active');
          this.attachRemoteAudio(session);
          break;
        case SessionState.Terminated:
          soundService.stopRingback();
          soundService.stopRingtone();
          soundService.playCallEndTone();
          this.handleCallTerminated();
          break;
      }
    });
  }

  private attachRemoteAudio(session: Session) {
    const sdh = session.sessionDescriptionHandler as Web.SessionDescriptionHandler | undefined;
    if (!sdh?.peerConnection) return;

    const pc = sdh.peerConnection;
    const remoteStream = new MediaStream();

    pc.getReceivers().forEach((receiver) => {
      if (receiver.track && receiver.track.kind === 'audio') {
        remoteStream.addTrack(receiver.track);
      }
    });

    pc.ontrack = (event) => {
      if (event.track && event.track.kind === 'audio') {
        remoteStream.addTrack(event.track);
      }
    };

    const audioElement = document.getElementById('remoteAudio') as HTMLAudioElement | null;
    if (audioElement) {
      audioElement.srcObject = remoteStream;
      audioElement.play().catch((err) => {
        console.warn('Remote audio autoplay blocked:', err);
      });
    }
  }

  private handleCallTerminated() {
    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }

    const audioElement = document.getElementById('remoteAudio') as HTMLAudioElement | null;
    if (audioElement) {
      audioElement.srcObject = null;
    }

    this.currentSession = null;
    this.incomingInvitation = null;
    this.callInfo = null;
    this.setCallState('Idle');
  }
}

export const sipService = new SipService();
