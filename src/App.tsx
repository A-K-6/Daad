import React, { useState, useEffect } from 'react';
import { useSip } from './hooks/useSip';
import { StatusBar } from './components/StatusBar';
import { LoginView } from './components/LoginView';
import { DialerPad } from './components/DialerPad';
import { ActiveCallView } from './components/ActiveCallView';
import { IncomingCallModal } from './components/IncomingCallModal';
import { SettingsModal } from './components/SettingsModal';
import { SipConfig } from './types/sip';

export const App: React.FC = () => {
  const {
    config,
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
  } = useSip();

  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [hasLoggedIn, setHasLoggedIn] = useState<boolean>(() => {
    return Boolean(config.serverUrl && config.username && config.password);
  });

  // Auto connect if credentials exist on initial mount
  useEffect(() => {
    if (config.serverUrl && config.username && config.password) {
      setHasLoggedIn(true);
      connect(config).catch((e) => {
        console.warn('Initial SIP auto-connect failed:', e);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (newConfig: SipConfig) => {
    setHasLoggedIn(true);
    await connect(newConfig);
  };

  const handleLogout = async () => {
    await disconnect();
    setHasLoggedIn(false);
  };

  const handleSaveAndConnect = async (newConfig: SipConfig) => {
    setShowSettings(false);
    setHasLoggedIn(true);
    await connect(newConfig);
  };

  const handleDisconnectFromSettings = async () => {
    await disconnect();
    setShowSettings(false);
  };

  const isIncomingCallRinging = callState === 'Ringing' && callInfo?.direction === 'incoming';
  const isCallActiveOrOutgoing =
    callState === 'Calling' ||
    (callState === 'Ringing' && callInfo?.direction === 'outgoing') ||
    callState === 'Active' ||
    callState === 'Holding';

  return (
    <div className="flex justify-center items-center min-h-screen bg-[#090a0f]">
      <div className="flex flex-col h-screen max-h-[100dvh] w-full max-w-md bg-[#0f1117] text-zinc-100 relative overflow-hidden font-sans select-none shadow-2xl sm:border-x sm:border-[#232838]">
        {!hasLoggedIn ? (
          <LoginView
            initialConfig={config}
            connectionState={connectionState}
            connectionError={connectionError}
            onLogin={handleLogin}
          />
        ) : (
          <>
            {/* Top Status Bar */}
            <StatusBar
              connectionState={connectionState}
              connectionError={connectionError}
              config={config}
              onOpenSettings={() => setShowSettings(true)}
              onLogout={handleLogout}
            />

            {/* Main Dialer or In-Call Interface */}
            <main className="flex-1 relative overflow-hidden flex flex-col">
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
                <DialerPad
                  connectionState={connectionState}
                  onCall={makeCall}
                  onOpenSettings={() => setShowSettings(true)}
                />
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
            onDisconnect={handleDisconnectFromSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
      </div>
    </div>
  );
};

export default App;
