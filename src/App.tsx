import React, { useState, useEffect } from 'react';
import { SipProvider, useSip, useTheme } from '@/context';
import {
  StatusBar,
  LoginView,
  DialerPad,
  RecentCallsView,
  ActiveCallView,
  IncomingCallModal,
  SettingsModal,
  UpdateModal,
  LandingHero,
} from '@/components';
import { SipConfig } from '@/types';
import { updateService } from '@/services';
import { Phone, Clock, Sun, Moon } from 'lucide-react';

import { Button } from '@fluentui/react-components';

const ThemeToggle: React.FC = () => {
  const { isDark, toggleTheme } = useTheme();
  return (
    <Button
      appearance="subtle"
      size="large"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={toggleTheme}
      icon={{ children: isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" /> }}
    />
  );
};

const MainSoftphone: React.FC = () => {
  const {
    config,
    connectionState,
    connectionError,
    callState,
    callInfo,
    callHistory,
    hasLoggedIn,
    connect,
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
  } = useSip();

  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showUpdates, setShowUpdates] = useState<boolean>(false);
  const [activeDialerTab, setActiveDialerTab] = useState<'keypad' | 'history'>('keypad');
  const [isTauri, setIsTauri] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      setIsTauri(true);
    }
  }, []);

  // Auto connect on startup if credentials exist
  useEffect(() => {
    if (config.serverUrl && config.username && config.password) {
      connect(config).catch((e) => {
        console.warn('Initial SIP auto-connect failed:', e);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background update check on startup
  useEffect(() => {
    const timer = setTimeout(() => {
      updateService.checkForUpdates().catch((err) => {
        console.warn('Background update check failed:', err);
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, []);


  const handleSaveAndConnect = async (newConfig: SipConfig) => {
    setShowSettings(false);
    await connect(newConfig);
  };

  const isIncomingCallRinging = callState === 'Ringing' && callInfo?.direction === 'incoming';
  const isCallActiveOrOutgoing =
    callState === 'Calling' ||
    (callState === 'Ringing' && callInfo?.direction === 'outgoing') ||
    callState === 'Active' ||
    callState === 'Holding';

  const softphoneWidget = (
    <div className="flex flex-col h-screen max-h-[600px] w-full max-w-[360px] bg-[var(--surface-1)] text-[var(--fg-1)] relative overflow-hidden font-sans select-none rounded-2xl border border-[var(--stroke-2)] shadow-[var(--shadow-8)]">
      {!hasLoggedIn ? (
        <LoginView
          initialConfig={config}
          connectionState={connectionState}
          connectionError={connectionError}
          onLogin={login}
        />
      ) : (
        <>
          {/* Top Status Bar */}
          <StatusBar
            connectionState={connectionState}
            connectionError={connectionError}
            config={config}
            onOpenSettings={() => setShowSettings(true)}
            onOpenUpdates={() => setShowUpdates(true)}
            onLogout={logout}
          />

          {/* Main Dialer or In-Call Interface */}
          <main className="flex-1 relative overflow-hidden flex flex-col bg-[var(--surface-1)]">
            {isCallActiveOrOutgoing ? (
              <ActiveCallView
                callState={callState}
                callInfo={callInfo}
                onHangup={hangup}
                onToggleMute={toggleMute}
                onToggleHold={toggleHold}
                onSendDtmf={sendDTMF}
              />
            ) : (
              <div className="flex flex-col h-full justify-between">
                {/* Tab Selector */}
                <div className="flex p-2 space-x-1 border-b border-[var(--stroke-2)]">
                  <button
                    onClick={() => setActiveDialerTab('keypad')}
                    className={`flex-1 flex items-center justify-center space-x-1.5 py-1.5 rounded-md text-sm font-medium transition-all ${
                      activeDialerTab === 'keypad'
                        ? 'text-[var(--accent)] bg-[var(--surface-2)] border border-[var(--stroke-2)]'
                        : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
                    }`}
                  >
                    <Phone className="w-4 h-4" />
                    <span>Keypad</span>
                  </button>
                  <button
                    onClick={() => setActiveDialerTab('history')}
                    className={`flex-1 flex items-center justify-center space-x-1.5 py-1.5 rounded-md text-sm font-medium transition-all ${
                      activeDialerTab === 'history'
                        ? 'text-[var(--accent)] bg-[var(--surface-2)] border border-[var(--stroke-2)]'
                        : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
                    }`}
                  >
                    <Clock className="w-4 h-4" />
                    <span>Recents</span>
                    {callHistory.length > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 text-[11px] rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] font-mono">
                        {callHistory.length}
                      </span>
                    )}
                  </button>
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-hidden">
                  {activeDialerTab === 'keypad' ? (
                    <DialerPad
                      connectionState={connectionState}
                      onCall={makeCall}
                      onOpenSettings={() => setShowSettings(true)}
                    />
                  ) : (
                    <RecentCallsView
                      records={callHistory}
                      onCall={(target) => {
                        setActiveDialerTab('keypad');
                        makeCall(target);
                      }}
                      onClear={clearCallHistory}
                    />
                  )}
                </div>
              </div>
            )}
          </main>
        </>
      )}

      {/* Incoming Call Overlay */}
      {isIncomingCallRinging && (
        <IncomingCallModal
          callInfo={callInfo}
          onAnswer={answerCall}
          onDecline={rejectCall}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          currentConfig={config}
          connectionState={connectionState}
          connectionError={connectionError}
          onSaveAndConnect={handleSaveAndConnect}
          onDisconnect={logout}
          onClose={() => setShowSettings(false)}
          onOpenUpdates={() => setShowUpdates(true)}
        />
      )}

      {/* Update Modal */}
      {showUpdates && (
        <UpdateModal
          onClose={() => setShowUpdates(false)}
        />
      )}
    </div>
  );

  // If inside native Tauri window, render only the softphone
  if (isTauri) {
    return (
      <div className="flex justify-center items-center h-screen w-screen bg-[var(--surface-1)] overflow-hidden">
        <div className="absolute top-4 right-4 z-10">
          <ThemeToggle />
        </div>
        {softphoneWidget}
      </div>
    );
  }

  // If on web, render landing showcase page
  return (
    <div className="min-h-screen w-full bg-[var(--surface-2)] flex items-center justify-center p-4 lg:p-12 overflow-x-hidden">
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-6xl flex flex-col lg:flex-row items-center justify-between gap-8 lg:gap-16">
        <LandingHero />
        <div className="shrink-0 flex items-center justify-center">
          {softphoneWidget}
        </div>
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <SipProvider>
      <MainSoftphone />
    </SipProvider>
  );
};

export default App;
