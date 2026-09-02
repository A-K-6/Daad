import React, { useState } from 'react';
import { Eye, EyeOff, AlertCircle, ChevronDown, ChevronUp, Server, Shield } from 'lucide-react';
import { SipConfig, ConnectionState } from '@/types';
import { DaadLogo } from '@/components/DaadLogo';
import { Button, Input } from '@fluentui/react-components';

interface LoginViewProps {
  initialConfig: SipConfig;
  connectionState: ConnectionState;
  connectionError: string | null;
  onLogin: (config: SipConfig) => Promise<void>;
}

export const LoginView: React.FC<LoginViewProps> = ({
  initialConfig,
  connectionState,
  connectionError,
  onLogin,
}) => {
  const [formData, setFormData] = useState<SipConfig>({ ...initialConfig });
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  const handleChange = (field: keyof SipConfig, value: string) => {
    setFormData((prev) => {
      const updated = { ...prev, [field]: value };

      if (field === 'serverUrl' || field === 'username') {
        const user = field === 'username' ? value : prev.username;
        const server = field === 'serverUrl' ? value : prev.serverUrl;
        const host = server.replace(/^wss?:\/\//, '').split('/')[0].split(':')[0];
        if (user && host && !prev.sipUri.includes('custom')) {
          updated.sipUri = `sip:${user}@${host}`;
        }
      }

      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onLogin(formData);
  };

  const handleApplyPreset = (preset: 'tls' | 'tcp' | 'asterisk' | 'freeswitch' | 'demo') => {
    if (preset === 'tls') {
      setFormData({
        serverUrl: 'tls://10.41.113.71:5061',
        sipUri: 'sip:host-1001@10.41.113.71',
        username: 'host-1001',
        password: '',
        displayName: 'Host 1001',
        stunServer: 'stun:stun.l.google.com:19302',
        registerExpires: 600,
      });
    } else if (preset === 'tcp') {
      setFormData({
        serverUrl: 'tcp://127.0.0.1:5060',
        sipUri: 'sip:1001@127.0.0.1',
        username: '1001',
        password: '',
        displayName: 'User 1001',
        stunServer: 'stun:stun.l.google.com:19302',
        registerExpires: 600,
      });
    } else if (preset === 'asterisk') {
      setFormData({
        serverUrl: 'wss://127.0.0.1:8089/ws',
        sipUri: 'sip:1001@127.0.0.1',
        username: '1001',
        password: '',
        displayName: 'User 1001',
        stunServer: 'stun:stun.l.google.com:19302',
        registerExpires: 600,
      });
    } else if (preset === 'freeswitch') {
      setFormData({
        serverUrl: 'wss://127.0.0.1:7443',
        sipUri: 'sip:1000@127.0.0.1',
        username: '1000',
        password: '',
        displayName: 'User 1000',
        stunServer: 'stun:stun.l.google.com:19302',
        registerExpires: 600,
      });
    } else {
      setFormData({
        serverUrl: 'wss://sip.antisip.com:443',
        sipUri: 'sip:guest@sip.antisip.com',
        username: 'guest',
        password: '',
        displayName: 'Guest Demo',
        stunServer: 'stun:stun.l.google.com:19302',
        registerExpires: 600,
      });
    }
  };

  const isConnecting = connectionState === 'Connecting';

  return (
    <div className="flex flex-col h-full justify-between p-5 select-none overflow-y-auto bg-[var(--surface-1)]">
      {/* Brand Header */}
      <div className="flex flex-col items-center justify-center pt-3 pb-2">
        <div className="mb-2">
          <DaadLogo size={46} withGlow={true} />
        </div>
        <h1 className="text-lg font-semibold text-[var(--fg-1)] tracking-tight">Daad Softphone</h1>
        <p className="text-[12px] text-[var(--fg-3)] mt-0.5">Sign in with your SIP / PBX account</p>
      </div>

      {/* Login Form */}
      <form onSubmit={handleSubmit} className="space-y-3.5 my-auto py-1">
        {/* Connection Failure Banner */}
        {connectionState === 'RegistrationFailed' && connectionError && (
          <div className="p-2.5 rounded-md bg-[var(--danger-bg)] border border-[var(--stroke-2)] text-[var(--danger-fg)] text-[12px] flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <span className="font-semibold block">Authentication Failed</span>
              <span className="leading-tight">{connectionError}</span>
            </div>
          </div>
        )}

        {/* Quick Presets */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--fg-3)] uppercase font-semibold tracking-wider">
              Presets & Transports
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            <button
              type="button"
              onClick={() => handleApplyPreset('tls')}
              className="py-1 px-1.5 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border border-[var(--stroke-2)] hover:border-[var(--stroke-1)] text-[var(--fg-2)] hover:text-[var(--accent)] text-[11px] font-medium transition-all text-center"
            >
              TLS 5061
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('tcp')}
              className="py-1 px-1.5 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border border-[var(--stroke-2)] hover:border-[var(--stroke-1)] text-[var(--fg-2)] hover:text-[var(--accent)] text-[11px] font-medium transition-all text-center"
            >
              TCP 5060
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('asterisk')}
              className="py-1 px-1.5 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border border-[var(--stroke-2)] hover:border-[var(--stroke-1)] text-[var(--fg-2)] hover:text-[var(--accent)] text-[11px] font-medium transition-all text-center"
            >
              Asterisk
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('freeswitch')}
              className="py-1 px-1.5 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border border-[var(--stroke-2)] hover:border-[var(--stroke-1)] text-[var(--fg-2)] hover:text-[var(--accent)] text-[11px] font-medium transition-all text-center"
            >
              FreeSWITCH
            </button>
          </div>
        </div>

        {/* Server Endpoint */}
        <div>
          <label className="block text-[12px] font-medium text-[var(--fg-2)] mb-1 flex items-center justify-between">
            <div className="flex items-center space-x-1">
              <Server className="w-3.5 h-3.5 text-[var(--fg-3)]" />
              <span>Server Address / Host</span>
            </div>
            <span className="text-[10px] text-[var(--fg-3)] font-mono">TLS / TCP / UDP / WSS</span>
          </label>
          <Input
            type="text"
            required
            value={formData.serverUrl}
            onChange={(e) => handleChange('serverUrl', e.target.value)}
            placeholder="tls://10.41.113.71:5061 or 10.41.113.71:5061"
            appearance="outline"
            contentBefore={<Server className="w-3.5 h-3.5 text-[var(--fg-3)]" />}
            style={{ fontSize: 12, fontFamily: 'var(--font-base)' }}
          />
        </div>

        {/* Username / Extension & Password */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium text-[var(--fg-2)] mb-1">
              Extension / User
            </label>
            <Input
              type="text"
              required
              value={formData.username}
              onChange={(e) => handleChange('username', e.target.value)}
              placeholder="1001"
              appearance="outline"
              style={{ fontSize: 12 }}
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[var(--fg-2)] mb-1">
              SIP Password
            </label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                required
                value={formData.password}
                onChange={(e) => handleChange('password', e.target.value)}
                placeholder="••••••••"
                appearance="outline"
                style={{ fontSize: 12 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fg-3)] hover:text-[var(--fg-1)]"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* SIP URI Preview */}
        <div>
          <label className="block text-[12px] font-medium text-[var(--fg-2)] mb-1 flex items-center space-x-1">
            <Shield className="w-3.5 h-3.5 text-[var(--fg-3)]" />
            <span>SIP Address (AOR)</span>
          </label>
          <Input
            type="text"
            required
            value={formData.sipUri}
            onChange={(e) => handleChange('sipUri', e.target.value)}
            placeholder="sip:1001@pbx.example.com"
            appearance="outline"
            contentBefore={<Shield className="w-3.5 h-3.5 text-[var(--fg-3)]" />}
            style={{ fontSize: 12, fontFamily: 'var(--font-base)' }}
          />
        </div>

        {/* Advanced Options Toggle */}
        <div className="pt-0.5">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center space-x-1 text-[12px] text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors"
          >
            {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>Advanced Configuration (STUN, Display Name)</span>
          </button>

          {showAdvanced && (
            <div className="mt-2 space-y-2 p-2.5 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)]">
              <div>
                <label className="block text-[11px] font-medium text-[var(--fg-2)] mb-1">
                  Caller Display Name
                </label>
                <Input
                  type="text"
                  value={formData.displayName || ''}
                  onChange={(e) => handleChange('displayName', e.target.value)}
                  placeholder="e.g. Aeen Desk"
                  appearance="outline"
                  style={{ fontSize: 12 }}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--fg-2)] mb-1">
                  STUN Server (WebRTC ICE)
                </label>
                <Input
                  type="text"
                  value={formData.stunServer || ''}
                  onChange={(e) => handleChange('stunServer', e.target.value)}
                  placeholder="stun:stun.l.google.com:19302"
                  appearance="outline"
                  style={{ fontSize: 12, fontFamily: 'var(--font-base)' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Submit Action */}
        <div className="pt-2">
          <Button
            type="submit"
            appearance="primary"
            disabled={isConnecting}
            style={{ fontWeight: 600, fontSize: 13, width: '100%' }}
          >
            {isConnecting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-[var(--on-accent)] border-t-transparent rounded-full animate-spin" />
                <span>Connecting & Registering...</span>
              </>
            ) : (
              <span>Sign In & Connect</span>
            )}
          </Button>
        </div>
      </form>

      {/* Footer info */}
      <div className="pt-2 text-center">
        <p className="text-[10px] text-[var(--fg-disabled)] font-mono">
          Powered by Tauri v2 & SIP.js • Open Source
        </p>
      </div>
    </div>
  );
};
