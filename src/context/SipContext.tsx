import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { callHistoryService, nativeSipClient, NativeSipClient } from '@/services';
import { validateDialTarget, mapNativeStatusToConnectionState } from '@/services/nativeSipClient';
import {
  SipConfig,
  SafeSipConfig,
  ConnectionState,
  CallState,
  CallInfo,
  CallRecord,
  CertTrustStatus,
  AudioRoute,
  NativeSipStatus,
} from '@/types';
import type { SanitizedDiagnostics } from '@/services/nativeSipClient';

const PROFILE_KEY = 'daad_sip_profile';
const SESSION_KEY = 'daad_sip_session';
const LEGACY_KEY = 'daad_sip_config';

export function purgeLegacyConfig(): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* noop */
  }
}

const DEFAULT_PROFILE: SafeSipConfig = {
  serverUrl: 'tls://pbx.example.com:5061',
  sipUri: 'sip:1001@pbx.example.com',
  username: '1001',
  displayName: 'User 1001',
  registerExpires: 600,
};

function loadProfile(): SafeSipConfig {
  try {
    // One-time purge of the legacy key that may contain a plaintext password.
    // Never read secrets from it — just drop it.
    localStorage.removeItem(LEGACY_KEY);
    const saved = localStorage.getItem(PROFILE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Record<string, unknown>;
      const { password: _pw, customCaPem: _ca, custom_ca_pem: _ca2, ...rest } = parsed;
      void _pw;
      void _ca;
      void _ca2;
      return { ...DEFAULT_PROFILE, ...(rest as Partial<SafeSipConfig>) };
    }
  } catch {
    /* noop */
  }
  return DEFAULT_PROFILE;
}

function persistProfile(p: SafeSipConfig): void {
  try {
    const { ...safe } = p;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(safe));
  } catch {
    /* noop */
  }
}

export function toSafeProfile(cfg: SipConfig): SafeSipConfig {
  return {
    serverUrl: cfg.serverUrl,
    sipUri: cfg.sipUri,
    username: cfg.username,
    extension: cfg.extension?.trim() || undefined,
    displayName: cfg.displayName,
    registerExpires: cfg.registerExpires,
  };
}

export function toSipConfigForDisplay(profile: SafeSipConfig): SipConfig {
  return { ...profile, password: '' };
}

interface SipContextType {
  config: SipConfig;
  connectionState: ConnectionState;
  connectionError: string | null;
  callState: CallState;
  callInfo: CallInfo | null;
  callHistory: CallRecord[];
  hasLoggedIn: boolean;
  certStatus: CertTrustStatus;
  audioRoute: AudioRoute;
  contactsReachable: number;
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
  setAudioRoute: (route: AudioRoute) => Promise<void>;
  exportDiagnostics: () => Promise<SanitizedDiagnostics>;
  clearCallHistory: () => void;
}

const SipContext = createContext<SipContextType | null>(null);

export const SipProvider: React.FC<{ children: ReactNode; client?: NativeSipClient }> = ({
  children,
  client,
}) => {
  const native = client || nativeSipClient;
  const [profile, setProfile] = useState<SafeSipConfig>(() => loadProfile());
  const [hasLoggedIn, setHasLoggedIn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SESSION_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [connectionState, setConnectionState] = useState<ConnectionState>('Disconnected');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>('Idle');
  const [callInfo, setCallInfo] = useState<CallInfo | null>(null);
  const [callHistory, setCallHistory] = useState<CallRecord[]>(() =>
    callHistoryService.getRecords(),
  );
  const [certStatus, setCertStatus] = useState<CertTrustStatus>('unknown');
  const [audioRoute, setAudioRouteState] = useState<AudioRoute>('system');
  const [contactsReachable, setContactsReachable] = useState<number>(0);

  const opSeq = useRef(0);
  const subscribed = useRef(false);
  /** Display-only tick: derives elapsed time from Rust event startTime. Never owns timing. */
  const displayTickRef = useRef<number | null>(null);
  const lastCallRef = useRef<{ info: CallInfo | null; state: CallState }>({ info: null, state: 'Idle' });

  const stopDisplayTick = useCallback(() => {
    if (displayTickRef.current !== null) {
      window.clearInterval(displayTickRef.current);
      displayTickRef.current = null;
    }
  }, []);

  const applyNativeCall = useCallback(
    (state: CallState, info: CallInfo | null) => {
      const prev = lastCallRef.current;
      // Log call history on termination using Rust-owned timestamps only.
      if (state === 'Idle' && prev.state !== 'Idle' && prev.info) {
        const done = prev.info;
        const duration =
          typeof done.duration === 'number'
            ? done.duration
            : done.startTime
              ? Math.max(0, Math.floor((Date.now() - done.startTime) / 1000))
              : 0;
        try {
          callHistoryService.addRecord({
            target: done.remoteIdentity,
            displayName: done.remoteIdentity,
            direction: done.direction,
            status: duration > 0 ? 'answered' : 'missed',
            duration,
          });
        } catch {
          /* history is best-effort */
        }
      }
      lastCallRef.current = { info: info ? { ...info } : null, state };
      setCallState(state);
      // Trust Rust event timestamps verbatim — never synthesize startTime here.
      setCallInfo(info ? { ...info } : null);
      if (state === 'Idle') stopDisplayTick();
    },
    [stopDisplayTick],
  );

  const applyNativeStatus = useCallback((status: NativeSipStatus) => {
    const mapped = mapNativeStatusToConnectionState(status);
    setConnectionState(mapped);
    setConnectionError(status.message || null);
    setCertStatus(status.certStatus || 'unknown');
    setContactsReachable(status.contactsReachable ?? 0);
  }, []);

  useEffect(() => {
    if (subscribed.current) return;
    subscribed.current = true;
    let disposed = false;
    const unsubs: Array<() => void> = [];

    (async () => {
      try {
        const u1 = await native.onConnectionState((s) => {
          if (!disposed) applyNativeStatus(s);
        });
        unsubs.push(u1);
      } catch {
        /* no tauri runtime in browser preview */
      }
      try {
        const u2 = await native.onCallState(({ state, info }) => {
          if (disposed) return;
          applyNativeCall(state, info ? { ...info } : null);
        });
        unsubs.push(u2);
      } catch {
        /* noop */
      }
      try {
        const u3 = await native.onCertStatus((s) => {
          if (!disposed) setCertStatus(s);
        });
        unsubs.push(u3);
      } catch {
        /* noop */
      }
    })();

    const unsubHistory = callHistoryService.onChange((records) => {
      setCallHistory(records);
    });

    const handleBeforeUnload = () => {
      try {
        native.unregister().catch(() => undefined);
      } catch {
        /* noop */
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      disposed = true;
      subscribed.current = false;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      unsubHistory();
      for (const u of unsubs) {
        try {
          u();
        } catch {
          /* noop */
        }
      }
      if (displayTickRef.current !== null) {
        window.clearInterval(displayTickRef.current);
        displayTickRef.current = null;
      }
    };
  }, [native, applyNativeStatus, applyNativeCall, stopDisplayTick]);

  // Display-only ticker: re-renders elapsed time from the Rust-owned startTime.
  // It never sets startTime and never acts as the source of truth.
  useEffect(() => {
    if (callState === 'Active' && callInfo?.startTime && displayTickRef.current === null) {
      displayTickRef.current = window.setInterval(() => {
        setCallInfo((prev) =>
          prev && prev.startTime
            ? { ...prev, duration: Math.max(0, Math.floor((Date.now() - prev.startTime) / 1000)) }
            : prev,
        );
      }, 1000);
    }
    if (callState !== 'Active' && displayTickRef.current !== null) {
      window.clearInterval(displayTickRef.current);
      displayTickRef.current = null;
    }
  }, [callState, callInfo?.startTime]);

  const connect = useCallback(
    async (cfg?: SipConfig) => {
      const myOp = ++opSeq.current;
      const full = cfg || { ...toSipConfigForDisplay(profile), password: '' };
      // Transient-only secrets: never written to state or storage.
      const transientPassword = cfg?.password || '';
      const transientCaPem = (cfg?.customCaPem || '').trim();
      const safe = toSafeProfile(full);
      setProfile(safe);
      persistProfile(safe);
      // Purge any legacy persisted secrets on every connect attempt.
      purgeLegacyConfig();

      if (!transientPassword) {
        setConnectionState('AuthFailed');
        setConnectionError('Password required. Credentials are kept in the native vault only.');
        return;
      }
      if (transientCaPem) {
        const { validateCaPem } = await import('@/services/nativeSipClient');
        const caCheck = validateCaPem(transientCaPem);
        if (!caCheck.ok) {
          setConnectionState('CertFailed');
          setConnectionError(caCheck.error);
          throw new Error(caCheck.error || 'Invalid custom CA');
        }
      }

      setConnectionState('Registering');
      setConnectionError(null);
      try {
        await native.accountUpsert({
          serverUrl: safe.serverUrl,
          sipUri: safe.sipUri,
          username: safe.username,
          extension: safe.extension,
          password: transientPassword,
          displayName: safe.displayName,
          registerExpires: safe.registerExpires,
          ...(transientCaPem ? { customCaPem: transientCaPem } : {}),
        });
        if (opSeq.current !== myOp) return;
        await native.register();
        if (opSeq.current !== myOp) return;
        try {
          const status = await native.getStatus();
          if (opSeq.current !== myOp) return;
          applyNativeStatus(status);
          if (!status.registered && status.failureKind === 'none' && !status.message) {
            setConnectionState('Registering');
          }
        } catch {
          if (opSeq.current !== myOp) return;
          setConnectionState('Reconnecting');
          setConnectionError('Waiting for native SIP status…');
        }
      } catch (e) {
        if (opSeq.current !== myOp) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (/auth|401|403|password/i.test(msg)) {
          setConnectionState('AuthFailed');
        } else if (/cert|tls|verify/i.test(msg)) {
          setConnectionState('CertFailed');
        } else if (/mic|microphone|audio.*permission/i.test(msg)) {
          setConnectionState('MicFailed');
        } else if (/reach|contact|route|network/i.test(msg)) {
          setConnectionState('NoReachableContact');
        } else {
          setConnectionState('RegistrationFailed');
        }
        setConnectionError(msg);
        throw e;
      }
    },
    [profile, native, applyNativeStatus],
  );

  const disconnect = useCallback(async () => {
    ++opSeq.current;
    try {
      await native.unregister();
    } catch {
      /* noop */
    }
    stopDisplayTick();
    lastCallRef.current = { info: null, state: 'Idle' };
    setConnectionState('Disconnected');
    setConnectionError(null);
    setCallState('Idle');
    setCallInfo(null);
  }, [native, stopDisplayTick]);

  const login = useCallback(
    async (newConfig: SipConfig) => {
      purgeLegacyConfig();
      await connect(newConfig);
      try {
        localStorage.setItem(SESSION_KEY, '1');
      } catch {
        /* noop */
      }
      setHasLoggedIn(true);
    },
    [connect],
  );

  const logout = useCallback(async () => {
    await disconnect();
    try {
      await native.accountRemove().catch(() => undefined);
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* noop */
    }
    setHasLoggedIn(false);
  }, [disconnect, native]);

  const makeCall = useCallback(
    async (target: string) => {
      const v = validateDialTarget(target);
      if (!v.ok) throw new Error(v.error || 'Invalid number');
      await native.invite(target.trim());
    },
    [native],
  );

  const answerCall = useCallback(async () => {
    await native.answer();
  }, [native]);

  const rejectCall = useCallback(async () => {
    await native.reject();
  }, [native]);

  const hangup = useCallback(async () => {
    await native.hangup();
  }, [native]);

  const toggleMute = useCallback(() => {
    if (callInfo) {
      native.setMuted(!callInfo.isMuted).catch(() => undefined);
      setCallInfo({ ...callInfo, isMuted: !callInfo.isMuted });
    }
  }, [callInfo, native]);

  const toggleHold = useCallback(async () => {
    if (callInfo) {
      const held = !callInfo.isHeld;
      await native.setHeld(held).catch(() => undefined);
      setCallInfo({ ...callInfo, isHeld: held });
      setCallState(held ? 'Holding' : 'Active');
    }
  }, [callInfo, native]);

  const sendDTMF = useCallback(
    (tone: string) => {
      native.sendDtmf(tone).catch(() => undefined);
    },
    [native],
  );

  const setAudioRoute = useCallback(
    async (route: AudioRoute) => {
      await native.setAudioRoute(route);
      setAudioRouteState(route);
    },
    [native],
  );

  const exportDiagnostics = useCallback(async (): Promise<SanitizedDiagnostics> => {
    return native.exportDiagnostics({
      connectionState,
      callState,
      certStatus,
      audioRoute,
      serverUrl: profile.serverUrl,
      username: profile.username,
      contactsReachable,
    });
  }, [native, connectionState, callState, certStatus, audioRoute, profile, contactsReachable]);

  const clearCallHistory = useCallback(() => {
    callHistoryService.clearHistory();
  }, []);

  return (
    <SipContext.Provider
      value={{
        config: toSipConfigForDisplay(profile),
        connectionState,
        connectionError,
        callState,
        callInfo,
        callHistory,
        hasLoggedIn,
        certStatus,
        audioRoute,
        contactsReachable,
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
        setAudioRoute,
        exportDiagnostics,
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
