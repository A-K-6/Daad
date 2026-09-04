import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, AlertCircle, Server, Shield, FileUp } from 'lucide-react';
import type { ConnectionState, SipConfig } from '@/types';
import { CertTrustBadge } from '@/components/CertTrustBadge';
import { validateCaPem, validateExtension, validateDeviceUsername, usernameFromSipUri } from '@/services/nativeSipClient';
import type { CertTrustStatus } from '@/types';

interface ProvisioningViewProps {
  initialConfig: SipConfig;
  connectionState: ConnectionState;
  connectionError: string | null;
  certStatus: CertTrustStatus;
  onProvision: (config: SipConfig) => Promise<void>;
}

function failureTitle(state: ConnectionState): string {
  switch (state) {
    case 'AuthFailed':
      return 'Authentication failed';
    case 'CertFailed':
      return 'Certificate trust failed';
    case 'MicFailed':
      return 'Microphone unavailable';
    case 'NoReachableContact':
      return 'No reachable contact';
    case 'Reconnecting':
      return 'Reconnecting…';
    case 'Registering':
    case 'Connecting':
      return 'Registering…';
    default:
      return 'Registration failed';
  }
}

const CERT_PENDING_STATES: ConnectionState[] = [
  'Connecting',
  'NetworkConnected',
  'TlsVerified',
  'Registering',
  'Reconnecting',
];

export const ProvisioningView: React.FC<ProvisioningViewProps> = ({
  initialConfig,
  connectionState,
  connectionError,
  certStatus,
  onProvision,
}) => {
  const [formData, setFormData] = useState<SipConfig>({ ...initialConfig });
  const [customCaPem, setCustomCaPem] = useState<string>(initialConfig.customCaPem || '');
  const [caFileName, setCaFileName] = useState<string>('');
  const [caError, setCaError] = useState<string | null>(null);
  const [extError, setExtError] = useState<string | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const [uriMatchError, setUriMatchError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [appVersion, setAppVersion] = useState('dev');
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Build marker for triage (which binary is running). Never blocks render.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const mod = await import('@tauri-apps/api/app');
        const v = await mod.getVersion();
        if (live && v) setAppVersion(v);
      } catch {
        /* web/dev fallback stays 'dev' */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const checkUriMatch = (sipUri: string, username: string): string | null => {
    const uriUser = usernameFromSipUri(sipUri);
    if (!uriUser || !username.trim()) return null;
    return uriUser === username.trim()
      ? null
      : `SIP URI user '${uriUser}' must match the device username '${username.trim()}'.`;
  };

  const handleChange = (field: keyof SipConfig, value: string) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-derive the device username from the SIP URI while the user
      // hasn't typed a custom one.
      if (field === 'sipUri' && !prev.username.trim()) {
        const derived = usernameFromSipUri(value);
        if (derived) next.username = derived;
      }
      return next;
    });
    if (field === 'extension') {
      const v = value.trim() ? validateExtension(value) : { ok: true, error: null };
      setExtError(v.ok ? null : v.error);
    }
    if (field === 'username') {
      const v = validateDeviceUsername(value);
      setUserError(v.ok ? null : v.error);
    }
    if (field === 'username' || field === 'sipUri') {
      const cur = field === 'sipUri' ? value : formData.sipUri;
      const usr = field === 'username' ? value : formData.username;
      setUriMatchError(checkUriMatch(cur, usr));
    }
  };

  const handleCaFile = async (file: File | undefined) => {
    if (!file) return;
    setCaError(null);
    try {
      const text = await file.text();
      setCustomCaPem(text.trim());
      setCaFileName(file.name);
      const v = validateCaPem(text);
      setCaError(v.ok ? null : v.error);
    } catch {
      setCaError('Could not read CA file.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = validateDeviceUsername(formData.username);
    if (!user.ok) {
      setUserError(user.error);
      return;
    }
    if (formData.extension?.trim()) {
      const ext = validateExtension(formData.extension);
      if (!ext.ok) {
        setExtError(ext.error);
        return;
      }
    }
    const mismatch = checkUriMatch(formData.sipUri, formData.username);
    if (mismatch) {
      setUriMatchError(mismatch);
      return;
    }
    const ca = validateCaPem(customCaPem);
    if (!ca.ok) {
      setCaError(ca.error);
      return;
    }
    setBusy(true);
    try {
      // Secrets (password + CA PEM) are sent once via IPC and never logged.
      await onProvision({ ...formData, customCaPem: customCaPem.trim() || undefined });
    } finally {
      setBusy(false);
      // Clear transient secrets from the webview immediately after handoff.
      setFormData((prev) => ({ ...prev, password: '' }));
      setCustomCaPem('');
      setCaFileName('');
    }
  };

  const isWorking =
    busy || connectionState === 'Connecting' || connectionState === 'Registering' || connectionState === 'Reconnecting';
  const showFailure =
    connectionError &&
    (connectionState === 'RegistrationFailed' ||
      connectionState === 'AuthFailed' ||
      connectionState === 'CertFailed' ||
      connectionState === 'MicFailed' ||
      connectionState === 'NoReachableContact');
  const certPending = certStatus === 'unknown' && CERT_PENDING_STATES.includes(connectionState);

  return (
    <div className="flex flex-col h-full p-5 overflow-y-auto bg-[#090a0f] text-zinc-200 select-none">
      <div className="flex flex-col items-center pt-3 pb-2">
        <h1 className="text-lg font-semibold tracking-tight">Provision SIP account</h1>
        <p className="text-[12px] text-zinc-500 mt-0.5 font-mono">
          Secrets go to the native vault only — never localStorage
        </p>
        <div className="mt-2 flex items-center gap-2">
          <CertTrustBadge status={certStatus} />
          {certPending && (
            <span data-testid="cert-pending" className="text-[10px] font-mono text-amber-300">
              Cert pending verification…
            </span>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 py-1">
        {showFailure && (
          <div
            role="alert"
            className="p-2.5 rounded-lg bg-[#0c0e15] border border-white/[0.08] text-[12px] flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <div className="min-w-0">
              <span className="font-semibold block text-zinc-100">{failureTitle(connectionState)}</span>
              <span className="leading-tight text-zinc-400 font-mono">{connectionError}</span>
            </div>
          </div>
        )}

        {(connectionState === 'Reconnecting' ||
          connectionState === 'NetworkConnected' ||
          connectionState === 'TlsVerified' ||
          connectionState === 'Registering') && (
          <div
            data-testid="provisioning-progress"
            className="p-2.5 rounded-lg bg-[#0c0e15] border border-white/[0.08] text-[12px] text-zinc-300 font-mono"
          >
            {connectionState === 'NetworkConnected' && 'Network connected — verifying TLS…'}
            {connectionState === 'TlsVerified' && 'TLS verified — registering…'}
            {connectionState === 'Registering' && 'Registering with PBX…'}
            {connectionState === 'Reconnecting' && 'Reconnecting — retrying registration…'}
          </div>
        )}

        <div>
          <label className="block text-[12px] font-medium mb-1 flex items-center gap-1">
            <Server className="w-3.5 h-3.5 text-zinc-500" />
            <span>Server</span>
          </label>
          <input
            type="text"
            required
            aria-label="Server"
            value={formData.serverUrl}
            onChange={(e) => handleChange('serverUrl', e.target.value)}
            placeholder="tls://pbx.example.com:5061"
            className="w-full px-3 py-2 rounded-lg bg-[#0c0e15] border border-white/[0.08] text-[12px] font-mono placeholder:text-zinc-600 focus:outline-none focus:border-white/20"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1">Extension (optional)</label>
            <input
              type="text"
              aria-label="Extension"
              value={formData.extension || ''}
              onChange={(e) => handleChange('extension', e.target.value)}
              placeholder="2001"
              inputMode="numeric"
              className="w-full px-3 py-2 rounded-lg bg-[#0c0e15] border border-white/[0.08] text-[12px] font-mono placeholder:text-zinc-600 focus:outline-none focus:border-white/20"
            />
            {extError && (
              <p role="alert" className="mt-1 text-[11px] text-rose-400 font-mono">
                {extError}
              </p>
            )}
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1">Device SIP username</label>
            <input
              type="text"
              required
              aria-label="Device SIP username"
              value={formData.username}
              onChange={(e) => handleChange('username', e.target.value)}
              placeholder="guest-2001"
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-2 rounded-lg bg-[#0c0e15] border border-white/[0.08] text-[12px] font-mono placeholder:text-zinc-600 focus:outline-none focus:border-white/20"
            />
            {userError && (
              <p role="alert" className="mt-1 text-[11px] text-rose-400 font-mono">
                {userError}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <div>
            <label className="block text-[12px] font-medium mb-1">SIP Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                aria-label="SIP Password"
                value={formData.password}
                onChange={(e) => handleChange('password', e.target.value)}
                placeholder="••••••••"
                autoComplete="off"
                className="w-full px-3 py-2 pr-9 rounded-lg bg-[#0c0e15] border border-white/[0.08] text-[12px] placeholder:text-zinc-600 focus:outline-none focus:border-white/20"
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1 flex items-center gap-1">
            <Shield className="w-3.5 h-3.5 text-zinc-500" />
            <span>SIP URI</span>
          </label>
          <input
            type="text"
            required
            aria-label="SIP URI"
            value={formData.sipUri}
            onChange={(e) => handleChange('sipUri', e.target.value)}
            placeholder="sip:1001@pbx.example.com"
            className="w-full px-3 py-2 rounded-lg bg-[#0c0e15] border border-white/[0.08] text-[12px] font-mono placeholder:text-zinc-600 focus:outline-none focus:border-white/20"
          />
          {uriMatchError && (
            <p role="alert" className="mt-1 text-[11px] text-rose-400 font-mono">
              {uriMatchError}
            </p>
          )}
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1 flex items-center gap-1">
            <Shield className="w-3.5 h-3.5 text-zinc-500" />
            <span>Custom CA (PEM, optional)</span>
          </label>
          <textarea
            aria-label="Custom CA PEM"
            value={customCaPem}
            onChange={(e) => {
              setCustomCaPem(e.target.value);
              setCaFileName('');
              const v = validateCaPem(e.target.value);
              setCaError(v.ok ? null : v.error);
            }}
            placeholder="-----BEGIN CERTIFICATE-----&#10;…paste private PBX CA…&#10;-----END CERTIFICATE-----"
            rows={3}
            spellCheck={false}
            autoComplete="off"
            className="w-full px-3 py-2 rounded-lg bg-[#0c0e15] border border-white/[0.08] text-[11px] font-mono placeholder:text-zinc-600 focus:outline-none focus:border-white/20 resize-y"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".pem,.crt,.cer,.txt"
              aria-label="Load CA file"
              className="hidden"
              onChange={(e) => {
                void handleCaFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/[0.08] bg-[#13151f] text-[11px] font-mono text-zinc-300 hover:text-zinc-100 transition-all active:scale-95"
            >
              <FileUp className="w-3 h-3" />
              Load CA file
            </button>
            {caFileName && (
              <span data-testid="ca-file-name" className="text-[10px] font-mono text-zinc-500 truncate">
                {caFileName}
              </span>
            )}
          </div>
          {caError && (
            <p role="alert" className="mt-1 text-[11px] text-rose-400 font-mono">
              {caError}
            </p>
          )}
          <p className="mt-1 text-[10px] text-zinc-600 font-mono">
            Pasted or loaded CA is sent once via IPC and never logged or stored in the webview.
            Private cores (IP/VPN, self-signed chain) fail closed with “Cert unknown” until their CA is supplied here.
          </p>
        </div>

        <button
          type="submit"
          disabled={isWorking}
          className="w-full py-2 rounded-lg bg-zinc-100 text-zinc-900 text-[13px] font-semibold transition-all active:scale-95 disabled:opacity-50"
        >
          {isWorking ? 'Provisioning…' : 'Provision & Register'}
        </button>
        <p className="text-[10px] text-zinc-600 font-mono text-center">
          Password and CA are sent to Rust via IPC once and cleared from this form.
        </p>
        <p data-testid="app-version" className="text-[10px] text-zinc-700 font-mono text-center">
          build {appVersion}
        </p>
      </form>
    </div>
  );
};
