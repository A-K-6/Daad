import React, { useState, useEffect } from 'react';
import { SipProvider, useSip, useTheme } from '@/context';
import {
  StatusBar,
  DialerPad,
  RecentCallsView,
  ActiveCallView,
  IncomingCallModal,
  SettingsModal,
  UpdateModal,
  LandingHero,
  ProvisioningView,
  DiagnosticsPanel,
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
    certStatus,
    audioRoute,
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
    setAudioRoute,
    exportDiagnostics,
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

  const isFailure =
    connectionState === 'RegistrationFailed' ||
    connectionState === 'AuthFailed' ||
    connectionState === 'CertFailed' ||
    connectionState === 'MicFailed' ||
    connectionState === 'NoReachableContact';

  const softphoneWidget = (
    <div className="flex flex-col h-screen max-h-[600px] w-full max-w-[360px] bg-[#090a0f] text-zinc-200 relative overflow-hidden font-sans select-none rounded-2xl border border-white/[0.08] shadow-[var(--shadow-8)]">
      {!hasLoggedIn ? (
        <ProvisioningView
          initialConfig={config}
          connectionState={connectionState}
          connectionError={connectionError}
          certStatus={certStatus}
          onProvision={login}
        />
      ) : (
        <>
          {/* Top Status Bar */}
          <StatusBar
            connectionState={connectionState}
            connectionError={connectionError}
            config={config}
            certStatus={certStatus}
            onOpenSettings={() => setShowSettings(true)}
            onOpenUpdates={() => setShowUpdates(true)}
            onLogout={logout}
          />

          {connectionState === 'Reconnecting' && (
            <div
              role="status"
              className="px-3 py-1.5 bg-[#0c0e15] border-b border-white/[0.08] text-[11px] font-mono text-amber-300 text-center"
            >
              Reconnecting — retrying registration…
            </div>
          )}

          {isFailure && connectionError && (
            <div
              role="alert"
              className="px-3 py-1.5 bg-[#0c0e15] border-b border-white/[0.08] text-[11px] font-mono text-rose-300 text-center"
            >
              {connectionState}: {connectionError}
            </div>
          )}

          {/* Main Dialer or In-Call Interface */}
          <main className="flex-1 relative overflow-hidden flex flex-col bg-[#090a0f]">
            {isCallActiveOrOutgoing ? (
              <ActiveCallView
                callState={callState}
                callInfo={callInfo}
                audioRoute={audioRoute}
                onHangup={hangup}
                onToggleMute={toggleMute}
                onToggleHold={toggleHold}
                onSendDtmf={sendDTMF}
                onAudioRoute={setAudioRoute}
              />
            ) : (
              <div className="flex flex-col h-full justify-between">
                {/* Tab Selector */}
                <div className="flex p-2 space-x-1 border-b border-white/[0.08]">
                  <button
                    onClick={() => setActiveDialerTab('keypad')}
                    className={`flex-1 flex items-center justify-center space-x-1.5 py-1.5 rounded-md text-sm font-medium transition-all active:scale-95 ${
                      activeDialerTab === 'keypad'
                        ? 'text-zinc-100 bg-[#13151f] border border-white/[0.08]'
                        : 'text-zinc-500 hover:text-zinc-200'
                    }`}
                  >
                    <Phone className="w-4 h-4" />
                    <span>Keypad</span>
                  </button>
                  <button
                    onClick={() => setActiveDialerTab('history')}
                    className={`flex-1 flex items-center justify-center space-x-1.5 py-1.5 rounded-md text-sm font-medium transition-all active:scale-95 ${
                      activeDialerTab === 'history'
                        ? 'text-zinc-100 bg-[#13151f] border border-white/[0.08]'
                        : 'text-zinc-500 hover:text-zinc-200'
                    }`}
                  >
                    <Clock className="w-4 h-4" />
                    <span>Recents</span>
                    {callHistory.length > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 text-[11px] rounded-full bg-[#13151f] text-zinc-300 font-mono border border-white/[0.08]">
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
                    <div className="flex flex-col h-full overflow-y-auto">
                      <RecentCallsView
                        records={callHistory}
                        onCall={(target) => {
                          setActiveDialerTab('keypad');
                          makeCall(target);
                        }}
                        onClear={clearCallHistory}
                      />
                      <div className="p-3">
                        <DiagnosticsPanel onExport={exportDiagnostics} />
                      </div>
                    </div>
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
      <div className="flex justify-center items-center h-screen w-screen bg-[#090a0f] overflow-hidden">
        <div className="absolute top-4 right-4 z-10">
          <ThemeToggle />
        </div>
        {softphoneWidget}
      </div>
    );
  }

  // If on web, render landing showcase page
  return (
    <div className="min-h-screen w-full bg-[#0c0e15] flex items-center justify-center p-4 lg:p-12 overflow-x-hidden">
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
