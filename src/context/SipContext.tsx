import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { sipService, callHistoryService } from '@/services';
import { SipConfig, ConnectionState, CallState, CallInfo, CallRecord } from '@/types';

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

interface SipContextType {
  config: SipConfig;
  connectionState: ConnectionState;
  connectionError: string | null;
  callState: CallState;
  callInfo: CallInfo | null;
  callHistory: CallRecord[];
  hasLoggedIn: boolean;
  connect: (config?: SipConfig) => Promise<void>;
  disconnect: () => Promise<void>;
  login: (config: SipConfig) => Promise<void>;
  logout: () => Promise<void>;
  makeCall: (target: string) => Promise<void>;
  answerCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => void;
  toggleHold: () => Promise<void>;
  sendDTMF: (tone: string) => void;
  clearCallHistory: () => void;
}

const SipContext = createContext<SipContextType | null>(null);

export const SipProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<SipConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Failed to load saved config:', e);
    }
    return DEFAULT_CONFIG;
  });

  const [hasLoggedIn, setHasLoggedIn] = useState<boolean>(() => {
    return Boolean(config.serverUrl && config.username && config.password);
  });

  const [connectionState, setConnectionState] = useState<ConnectionState>(sipService.getConnectionState());
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>(sipService.getCallState());
  const [callInfo, setCallInfo] = useState<CallInfo | null>(sipService.getCallInfo());
  const [callHistory, setCallHistory] = useState<CallRecord[]>(callHistoryService.getRecords());

  useEffect(() => {
    const unsubConn = sipService.onConnectionStateChange((state, error) => {
      setConnectionState(state);
      setConnectionError(error || null);
    });

    const unsubCall = sipService.onCallStateChange((state, info) => {
      setCallState(state);
      setCallInfo(info ? { ...info } : null);
    });

    const unsubHistory = callHistoryService.onChange((records) => {
      setCallHistory(records);
    });

    return () => {
      unsubConn();
      unsubCall();
      unsubHistory();
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

  const login = useCallback(
    async (newConfig: SipConfig) => {
      setHasLoggedIn(true);
      await connect(newConfig);
    },
    [connect]
  );

  const logout = useCallback(async () => {
    await disconnect();
    setHasLoggedIn(false);
  }, [disconnect]);

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

  const clearCallHistory = useCallback(() => {
    callHistoryService.clearHistory();
  }, []);

  return (
    <SipContext.Provider
      value={{
        config,
        connectionState,
        connectionError,
        callState,
        callInfo,
        callHistory,
        hasLoggedIn,
        connect,
        disconnect,
        login,
        logout,
        makeCall,
        answerCall,
        rejectCall,
        hangup,
        toggleMute,
        toggleHold,
        sendDTMF,
        clearCallHistory,
      }}
    >
      {children}
    </SipContext.Provider>
  );
};

export const useSip = () => {
  const ctx = useContext(SipContext);
  if (!ctx) {
    throw new Error('useSip must be used within a SipProvider');
  }
  return ctx;
};
