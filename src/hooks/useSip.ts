import { useState, useEffect, useCallback } from 'react';
import { sipService } from '../services/sipService';
import { SipConfig, ConnectionState, CallState, CallInfo } from '../types/sip';

const STORAGE_KEY = 'daad_sip_config';

const DEFAULT_CONFIG: SipConfig = {
  serverUrl: 'wss://pbx.example.com:8089/ws',
  sipUri: 'sip:1001@pbx.example.com',
  username: '1001',
  password: '',
  displayName: 'User 1001',
  stunServer: 'stun:stun.l.google.com:19302',
  registerExpires: 600,
};

export function useSip() {
  const [config, setConfig] = useState<SipConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load saved config:', e);
    }
    return DEFAULT_CONFIG;
  });

  const [connectionState, setConnectionState] = useState<ConnectionState>(sipService.getConnectionState());
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>(sipService.getCallState());
  const [callInfo, setCallInfo] = useState<CallInfo | null>(sipService.getCallInfo());

  useEffect(() => {
    const unsubConn = sipService.onConnectionStateChange((state, error) => {
      setConnectionState(state);
      setConnectionError(error || null);
    });

    const unsubCall = sipService.onCallStateChange((state, info) => {
      setCallState(state);
      setCallInfo(info ? { ...info } : null);
    });

    return () => {
      unsubConn();
      unsubCall();
    };
  }, []);

  const saveConfig = useCallback((newConfig: SipConfig) => {
    setConfig(newConfig);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
    } catch (e) {
      console.warn('Failed to save config:', e);
    }
  }, []);

  const connect = useCallback(
    async (cfg?: SipConfig) => {
      const targetConfig = cfg || config;
      saveConfig(targetConfig);
      await sipService.connectAndRegister(targetConfig);
    },
    [config, saveConfig]
  );

  const disconnect = useCallback(async () => {
    await sipService.disconnect();
  }, []);

  const makeCall = useCallback(async (target: string) => {
    await sipService.makeCall(target);
  }, []);

  const answerCall = useCallback(async () => {
    await sipService.answerCall();
  }, []);

  const rejectCall = useCallback(async () => {
    await sipService.rejectCall();
  }, []);

  const hangup = useCallback(async () => {
    await sipService.hangup();
  }, []);

  const toggleMute = useCallback(() => {
    if (callInfo) {
      sipService.mute(!callInfo.isMuted);
    }
  }, [callInfo]);

  const toggleHold = useCallback(async () => {
    if (callInfo) {
      await sipService.hold(!callInfo.isHeld);
    }
  }, [callInfo]);

  const sendDTMF = useCallback((tone: string) => {
    sipService.sendDTMF(tone);
  }, []);

  return {
    config,
    saveConfig,
    connectionState,
    connectionError,
    callState,
    callInfo,
    connect,
    disconnect,
    makeCall,
    answerCall,
    rejectCall,
    hangup,
    toggleMute,
    toggleHold,
    sendDTMF,
  };
}
