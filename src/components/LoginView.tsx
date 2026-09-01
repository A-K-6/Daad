import React, { useState } from 'react';
import { Phone, Eye, EyeOff, AlertCircle, ChevronDown, ChevronUp, Server, User, Lock, Globe, Shield } from 'lucide-react';
import { SipConfig, ConnectionState } from '../types/sip';

interface LoginViewProps {
  initialConfig: SipConfig;
  connectionState: ConnectionState;
  connectionError: string | null;
  onLogin: (config: SipConfig) => void;
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
      // Auto-populate SIP URI if username and server are entered
      if (field === 'username' && (!prev.sipUri || prev.sipUri.includes('@'))) {
        const domain = prev.serverUrl ? prev.serverUrl.replace(/wss?:\/\//, '').split(':')[0].split('/')[0] : 'localhost';
        updated.sipUri = `sip:${value}@${domain}`;
      }
      return updated;
    });
  };

  const handleApplyPreset = (preset: 'asterisk' | 'freeswitch' | 'demo') => {
    if (preset === 'asterisk') {
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
        serverUrl: 'wss://tryit.jssip.net:10443',
        sipUri: 'sip:daad_tester@tryit.jssip.net',
        username: 'daad_tester',
        password: 'password123',
        displayName: 'Daad Tester',
        stunServer: 'stun:stun.l.google.com:19302',
        registerExpires: 600,
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(formData);
  };

  const isConnecting = connectionState === 'Connecting';

  return (
    <div className="flex flex-col h-full justify-between p-6 select-none bg-[#0f1117] overflow-y-auto">
      {/* Brand Header */}
      <div className="flex flex-col items-center pt-4 pb-2">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-3 shadow-lg shadow-emerald-500/10">
          <Phone className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Daad Softphone</h1>
        <p className="text-xs text-zinc-400 mt-1">Sign in with your SIP / PBX account</p>
      </div>

      {/* Preset Pills */}
      <div className="flex items-center justify-center space-x-2 my-2">
        <button
          type="button"
          onClick={() => handleApplyPreset('asterisk')}
          className="px-2.5 py-1 rounded-full bg-[#161a26] hover:bg-[#202536] border border-[#232838] text-[11px] text-zinc-300 hover:text-emerald-400 transition-colors"
        >
          Asterisk
        </button>
        <button
          type="button"
          onClick={() => handleApplyPreset('freeswitch')}
          className="px-2.5 py-1 rounded-full bg-[#161a26] hover:bg-[#202536] border border-[#232838] text-[11px] text-zinc-300 hover:text-emerald-400 transition-colors"
        >
          FreeSWITCH
        </button>
        <button
          type="button"
          onClick={() => handleApplyPreset('demo')}
          className="px-2.5 py-1 rounded-full bg-[#161a26] hover:bg-[#202536] border border-[#232838] text-[11px] text-zinc-300 hover:text-emerald-400 transition-colors"
        >
          Demo
        </button>
      </div>

      {/* Error Alert */}
      {connectionState === 'RegistrationFailed' && connectionError && (
        <div className="my-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start space-x-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
          <div className="min-w-0">
            <span className="font-semibold block">Authentication Failed</span>
            <span className="text-[11px] text-rose-300/90 break-words">{connectionError}</span>
          </div>
        </div>
      )}

      {/* Login Form */}
      <form onSubmit={handleSubmit} className="space-y-3 py-2 text-xs">
        {/* WSS URL */}
        <div>
          <label className="block text-[11px] font-medium text-zinc-300 mb-1 flex items-center space-x-1">
            <Server className="w-3 h-3 text-zinc-400" />
            <span>WebSocket Server (WSS)</span>
          </label>
          <input
            type="text"
            required
            value={formData.serverUrl}
            onChange={(e) => handleChange('serverUrl', e.target.value)}
            placeholder="wss://pbx.example.com:8089/ws"
            disabled={isConnecting}
            className="w-full px-3 py-2 rounded-xl bg-[#141824] border border-[#232838] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 font-mono text-xs disabled:opacity-60"
          />
        </div>

        {/* SIP URI */}
        <div>
          <label className="block text-[11px] font-medium text-zinc-300 mb-1 flex items-center space-x-1">
            <Globe className="w-3 h-3 text-zinc-400" />
            <span>SIP Address / URI</span>
          </label>
          <input
            type="text"
            required
            value={formData.sipUri}
            onChange={(e) => handleChange('sipUri', e.target.value)}
            placeholder="sip:1001@pbx.example.com"
            disabled={isConnecting}
            className="w-full px-3 py-2 rounded-xl bg-[#141824] border border-[#232838] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 font-mono text-xs disabled:opacity-60"
          />
        </div>

        {/* Username & Password */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-zinc-300 mb-1 flex items-center space-x-1">
              <User className="w-3 h-3 text-zinc-400" />
              <span>Username / Ext</span>
            </label>
            <input
              type="text"
              required
              value={formData.username}
              onChange={(e) => handleChange('username', e.target.value)}
              placeholder="1001"
              disabled={isConnecting}
              className="w-full px-3 py-2 rounded-xl bg-[#141824] border border-[#232838] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 font-mono text-xs disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-300 mb-1 flex items-center space-x-1">
              <Lock className="w-3 h-3 text-zinc-400" />
              <span>Secret / Password</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={formData.password}
                onChange={(e) => handleChange('password', e.target.value)}
                placeholder="••••••••"
                disabled={isConnecting}
                className="w-full px-3 py-2 pr-8 rounded-xl bg-[#141824] border border-[#232838] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 text-xs disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Advanced Accordion */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center justify-between w-full text-[11px] text-zinc-400 hover:text-zinc-200 py-1"
          >
            <span className="flex items-center space-x-1">
              <Shield className="w-3 h-3 text-zinc-500" />
              <span>Advanced Options (STUN & Display Name)</span>
            </span>
            {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showAdvanced && (
            <div className="space-y-2.5 pt-2 animate-in fade-in">
              <div>
                <label className="block text-[10px] font-medium text-zinc-400 mb-1">
                  Caller Display Name
                </label>
                <input
                  type="text"
                  value={formData.displayName || ''}
                  onChange={(e) => handleChange('displayName', e.target.value)}
                  placeholder="e.g. Front Desk"
                  disabled={isConnecting}
                  className="w-full px-3 py-1.5 rounded-xl bg-[#141824] border border-[#232838] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 text-xs disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-[10px] font-medium text-zinc-400 mb-1">
                  STUN Server (WebRTC ICE)
                </label>
                <input
                  type="text"
                  value={formData.stunServer || ''}
                  onChange={(e) => handleChange('stunServer', e.target.value)}
                  placeholder="stun:stun.l.google.com:19302"
                  disabled={isConnecting}
                  className="w-full px-3 py-1.5 rounded-xl bg-[#141824] border border-[#232838] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 font-mono text-xs disabled:opacity-60"
                />
              </div>
            </div>
          )}
        </div>

        {/* Submit Action */}
        <div className="pt-3 pb-1">
          <button
            type="submit"
            disabled={isConnecting || !formData.serverUrl || !formData.username}
            className={`w-full py-3 rounded-xl font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center space-x-2 ${
              isConnecting
                ? 'bg-emerald-500/50 text-zinc-950 cursor-wait'
                : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40'
            }`}
          >
            {isConnecting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                <span>Connecting to PBX...</span>
              </>
            ) : (
              <span>Sign In & Connect</span>
            )}
          </button>
        </div>
      </form>

      {/* Footer Info */}
      <div className="text-center pt-2 border-t border-[#1f2433]">
        <p className="text-[10px] text-zinc-500">
          Supports Asterisk, FreeSWITCH & Standard SIP over WSS
        </p>
      </div>
    </div>
  );
};
