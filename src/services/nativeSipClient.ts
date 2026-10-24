import type {
  AudioRoute,
  CallInfo,
  CallState,
  CertTrustStatus,
  ConnectionState,
  NativeCallEvent,
  NativeSipStatus,
} from '@/types';

export type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
export type ListenFn = (
  event: string,
  handler: (payload: unknown) => void,
) => Promise<() => void> | (() => void);

export interface AccountUpsertArgs {
  serverUrl: string;
  sipUri: string;
  username: string;
  /** Numeric person/profile extension (optional, 3–8 digits). */
  extension?: string;
  password: string;
  displayName?: string;
  registerExpires?: number;
  /** Custom CA PEM — sent once via IPC, never logged or persisted. */
  customCaPem?: string;
}

export interface DialValidation {
  ok: boolean;
  error: string | null;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'authorization',
  'proxy-authenticate',
  'www-authenticate',
  'srtp',
  'sdp',
  'sessiondescription',
  'fingerprint',
  'ice-pwd',
  'ice-ufrag',
  'customcapem',
  'capem',
  'privatekey',
]);

export function validateDialTarget(raw: string): DialValidation {
  const target = (raw || '').trim();
  if (!/^\+?[0-9]{1,20}$/.test(target))
    return { ok: false, error: 'Enter a phone number or extension (digits, with an optional leading +).' };
  return { ok: true, error: null };
}

/** Recover a dialable number from native or legacy history without dialing a URI. */
export function dialTargetFromIdentity(raw: string): string | null {
  const text = (raw || '').trim();
  if (validateDialTarget(text).ok) return text;
  if (/[\r\n]/.test(text)) return null;
  const match = text.match(/^(?:"[^"<>]*"\s*)?<?sips?:(\+?[0-9]{1,20})@[^\s<>]+>?$/i);
  return match?.[1] || null;
}

/** Device username validation — provisioned per-device identity (e.g. "guest-2001"). Mirrors Rust `validate_device_username`. */
export function validateDeviceUsername(raw: string): DialValidation {
  const t = (raw || '').trim();
  if (!t) return { ok: false, error: 'Enter the provisioned SIP username.' };
  if (t.length > 64) return { ok: false, error: 'SIP username must be 1–64 characters.' };
  if (!/^[A-Za-z0-9._-]+$/.test(t)) {
    return { ok: false, error: "SIP username allows letters, digits, '.', '_' and '-' only." };
  }
  return { ok: true, error: null };
}

/** Extract the user part from a `sip:<user>@<domain>` URI (empty string when unparsable). */
export function usernameFromSipUri(raw: string): string {
  const t = (raw || '').trim();
  const noScheme = t.replace(/^sip:/i, '');
  const at = noScheme.indexOf('@');
  if (at <= 0) return '';
  return noScheme.slice(0, at).split(';')[0].trim();
}

/** The common account needs only a server and username; a SIP URI is advanced. */
export function deriveSipUri(server: string, username: string): string {
  try {
    const raw = server.trim();
    const url = new URL(raw.includes('://') ? raw : `tls://${raw}`);
    return url.hostname && username.trim() ? `sip:${username.trim()}@${url.hostname}` : '';
  } catch { return ''; }
}
/** Extension validation for provisioning — same numeric-only rule as dialing. */
export function validateExtension(raw: string): DialValidation {
  return /^[1-9][0-9]{2,7}$/.test((raw || '').trim())
    ? { ok: true, error: null }
    : { ok: false, error: 'Extension must be numeric (3–8 digits, no leading zero).' };
}

export interface CaPemValidation {
  ok: boolean;
  error: string | null;
}

/** Lightweight PEM shape check (never logs content — only validates framing). */
export function validateCaPem(pem: string): CaPemValidation {
  const t = (pem || '').trim();
  if (!t) return { ok: true, error: null };
  if (!t.includes('-----BEGIN CERTIFICATE-----') || !t.includes('-----END CERTIFICATE-----')) {
    return { ok: false, error: 'Custom CA must be PEM with BEGIN/END CERTIFICATE lines.' };
  }
  return { ok: true, error: null };
}

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_-]/g, '');
  for (const s of SENSITIVE_KEYS) {
    if (k.includes(s.replace(/[_-]/g, ''))) return true;
  }
  return false;
}

export function stripSecrets<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (/^(sip:)?[^@\s]+@/.test(value)) return '[sip-identity]' as unknown as T;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripSecrets(v)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = '[redacted]';
      } else {
        out[k] = stripSecrets(v);
      }
    }
    return out as unknown as T;
  }
  return value;
}

export function sanitizeForLog(event: string, args?: Record<string, unknown>): Record<string, unknown> {
  return {
    event,
    args: args ? (stripSecrets(args) as Record<string, unknown>) : {},
  };
}

/**
 * Native engine evidence exported in diagnostics. Explicit, bounded allowlist:
 * engine/version token, mandatory-SRTP flag and the native call state only.
 * Free-form native text, messages, identities, URIs, SDP and keys never land here.
 */
export interface SanitizedNativeDiagnostics {
  engine: string | null;
  requiredSrtp: boolean | null;
  callState: string | null;
}

/** Only exact `CallState` tokens count as native call-state evidence. */
const NATIVE_CALL_STATES: ReadonlySet<string> = new Set<string>([
  'Idle',
  'Calling',
  'Ringing',
  'Active',
  'Holding',
]);

/** Short version token (e.g. `PJSIP 2.17`) — no schemes, paths, newlines or headers. */
const NATIVE_ENGINE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .()_+-]{0,31}$/;

/**
 * Project a raw `sip_diagnostics_export` payload onto the bounded allowlist.
 * Unknown/missing/mistyped values become `null` rather than being forwarded.
 */
export function sanitizeNativeDiagnostics(payload: unknown): SanitizedNativeDiagnostics {
  const empty: SanitizedNativeDiagnostics = {
    engine: null,
    requiredSrtp: null,
    callState: null,
  };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return empty;
  const raw = payload as Record<string, unknown>;
  const engine = raw.engine;
  const requiredSrtp = raw.srtpRequired;
  const callState = raw.callState;
  return {
    engine:
      typeof engine === 'string' && NATIVE_ENGINE_PATTERN.test(engine) ? engine : null,
    requiredSrtp: typeof requiredSrtp === 'boolean' ? requiredSrtp : null,
    callState:
      typeof callState === 'string' && NATIVE_CALL_STATES.has(callState) ? callState : null,
  };
}

export interface SanitizedDiagnostics {
  generatedAt: string;
  connectionState: ConnectionState;
  callState: CallState;
  certStatus: CertTrustStatus;
  audioRoute: AudioRoute;
  serverHost: string | null;
  sipUser: string | null;
  contactsReachable: number | null;
  recentEvents: Array<{ kind: string; at: string }>;
  /**
   * Native engine evidence. Always populated by `sanitizeDiagnostics` /
   * `exportDiagnostics`; optional only so older/hand-built exports (and test
   * fixtures) stay assignable.
   */
  native?: SanitizedNativeDiagnostics;
  notes: string;
}

export function sanitizeDiagnostics(input: {
  connectionState: ConnectionState;
  callState: CallState;
  certStatus: CertTrustStatus;
  audioRoute: AudioRoute;
  serverUrl?: string;
  username?: string;
  contactsReachable?: number | null;
  recentEvents?: Array<{ kind: string; at: string }>;
  /** Raw native diagnostics payload — allowlisted via `sanitizeNativeDiagnostics`. */
  native?: unknown;
}): SanitizedDiagnostics {
  let serverHost: string | null = null;
  try {
    const raw = (input.serverUrl || '').trim();
    if (raw) {
      const withoutScheme = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
      serverHost = withoutScheme.split('/')[0].split('@').pop() || null;
      if (serverHost && /^\d+\.\d+\.\d+\.\d+/.test(serverHost)) {
        const parts = serverHost.split('.');
        serverHost = `${parts[0]}.${parts[1]}.x.x`;
      }
    }
  } catch {
    serverHost = null;
  }
  return {
    generatedAt: new Date().toISOString(),
    connectionState: input.connectionState,
    callState: input.callState,
    certStatus: input.certStatus,
    audioRoute: input.audioRoute,
    serverHost,
    sipUser: input.username ? '[extension-present]' : null,
    contactsReachable: input.contactsReachable ?? null,
    recentEvents: (input.recentEvents || []).map((e) => ({ kind: e.kind, at: e.at })),
    native: sanitizeNativeDiagnostics(input.native),
    notes:
      'Sanitized: no passwords, tokens, SDP, SRTP keys, full SIP URIs, or native error text.',
  };
}

export function mapNativeStatusToConnectionState(status: NativeSipStatus): ConnectionState {
  if (status.registered) return 'Registered';
  switch (status.failureKind) {
    case 'auth':
      return 'AuthFailed';
    case 'cert':
      return 'CertFailed';
    case 'mic':
      return 'MicFailed';
    case 'unreachable':
      return 'RegistrationFailed';
    case 'generic':
      return 'RegistrationFailed';
    case 'none':
    default:
      break;
  }
  if (status.reconnecting) return 'Reconnecting';
  if (status.registering) return 'Registering';
  if (status.tlsVerified) return 'TlsVerified';
  if (status.transportOpen) return 'NetworkConnected';
  return 'Disconnected';
}

async function defaultInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const mod = await import('@tauri-apps/api/core');
  return mod.invoke(cmd, args);
}

function defaultListen(event: string, handler: (payload: unknown) => void): Promise<() => void> {
  return import('@tauri-apps/api/event').then((mod) =>
    mod.listen(event, (e: { payload: unknown }) => handler(e.payload)),
  );
}

export const NATIVE_EVENTS = {
  connection: 'sip://connection-state',
  call: 'sip://call-state',
  cert: 'sip://cert-status',
  /** Raw core dialog events (CallWaiting, Swapped, TransferRequested/Failed). */
  callEvent: 'daad-call-event',
} as const;

export class NativeSipClient {
  private invokeFn: InvokeFn;
  private listenFn: ListenFn;
  private unlisteners: Array<() => void> = [];

  constructor(opts?: { invokeFn?: InvokeFn; listenFn?: ListenFn }) {
    this.invokeFn = opts?.invokeFn || defaultInvoke;
    this.listenFn = opts?.listenFn || defaultListen;
  }

  setTransport(opts: { invokeFn?: InvokeFn; listenFn?: ListenFn }): void {
    if (opts.invokeFn) this.invokeFn = opts.invokeFn;
    if (opts.listenFn) this.listenFn = opts.listenFn;
  }

  private call(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    return this.invokeFn(cmd, args);
  }
  async networkChanged(): Promise<void> { await this.call('sip_network_changed'); }

  async accountUpsert(args: AccountUpsertArgs): Promise<void> {
    if (!args.serverUrl?.trim() || !args.sipUri?.trim() || !args.username?.trim()) {
      throw new Error('serverUrl, sipUri and username are required');
    }
    if (!args.password) throw new Error('password is required for provisioning');
    const caPem = (args.customCaPem || '').trim();
    if (caPem) {
      const v = validateCaPem(caPem);
      if (!v.ok) throw new Error(v.error || 'Invalid custom CA PEM');
    }
    await this.call('sip_account_upsert', {
      // Tauri converts Rust params to lowerCamelCase IPC keys by default
      // (tauri-macros `to_lower_camel_case`): snake_case keys are rejected
      // with `invalid args 'serverUrl' ...`. Keep these camelCase.
      serverUrl: args.serverUrl.trim(),
      sipUri: args.sipUri.trim(),
      username: args.username.trim(),
      password: args.password,
      displayName: args.displayName?.trim() || undefined,
      registerExpires: args.registerExpires ?? 600,
      ...(args.extension?.trim() ? { extension: args.extension.trim() } : {}),
      ...(caPem ? { customCaPem: caPem } : {}),
    });
  }

  async accountRemove(): Promise<void> {
    await this.call('sip_account_remove');
  }

  async register(): Promise<void> {
    await this.call('sip_register');
  }

  async unregister(): Promise<void> {
    await this.call('sip_unregister');
  }

  async getStatus(): Promise<NativeSipStatus> {
    const raw = (await this.call('sip_status')) as Partial<NativeSipStatus>;
    return {
      transportOpen: Boolean(raw.transportOpen),
      tlsVerified: Boolean(raw.tlsVerified),
      registered: Boolean(raw.registered),
      registering: Boolean(raw.registering),
      reconnecting: Boolean(raw.reconnecting),
      failureKind: raw.failureKind || 'none',
      message: (raw.message as string | null) ?? null,
      certStatus: raw.certStatus || 'unknown',
      contactsReachable: typeof raw.contactsReachable === 'number' ? raw.contactsReachable : 0,
    };
  }

  async invite(target: string): Promise<void> {
    const v = validateDialTarget(target);
    if (!v.ok) throw new Error(v.error || 'Invalid dial target');
    await this.call('sip_call_invite', { target: target.trim() });
  }

  async answer(): Promise<void> {
    await this.call('sip_call_answer');
  }

  async reject(): Promise<void> {
    await this.call('sip_call_reject');
  }

  async hangup(): Promise<void> {
    await this.call('sip_call_hangup');
  }

  async setMuted(muted: boolean): Promise<void> {
    await this.call('sip_call_mute', { muted });
  }

  async setHeld(held: boolean): Promise<void> {
    await this.call('sip_call_hold', { held });
  }

  async sendDtmf(tone: string): Promise<void> {
    if (!/^[0-9*#]$/.test(tone)) throw new Error('Invalid DTMF tone');
    await this.call('sip_call_dtmf', { tone });
  }

  /**
   * Blind transfer (RFC 3515): REFER the foreground leg to a numeric target.
   * The target is validated pre-IPC (numeric 3–8 digits, no leading zero);
   * invalid targets never reach the backend.
   */
  async transferBlind(target: string): Promise<void> {
    const v = validateExtension(target);
    if (!v.ok) throw new Error(v.error || 'Invalid transfer target');
    await this.call('sip_call_transfer_blind', { target: target.trim() });
  }

  /**
   * Start a consultation leg for attended transfer: holds the primary leg
   * and dials the numeric consult target as the second dialog.
   */
  async consult(target: string): Promise<void> {
    const v = validateExtension(target);
    if (!v.ok) throw new Error(v.error || 'Invalid consult target');
    await this.call('sip_call_consult', { target: target.trim() });
  }

  /** Complete an attended transfer (REFER + Replaces on the held primary). */
  async transferAttended(): Promise<void> {
    await this.call('sip_call_transfer_attended');
  }

  /** Explicit swap: hold foreground + resume parked leg (one RTP stream). */
  async swap(): Promise<void> {
    await this.call('sip_call_swap');
  }

  /** Answer the waiting second leg (hold active + answer waiting). */
  async answerWaiting(): Promise<void> {
    await this.call('sip_call_answer_waiting');
  }

  async setAudioRoute(route: AudioRoute): Promise<void> {
    await this.call('sip_audio_route', { route });
  }

  async exportDiagnostics(input: {
    connectionState: ConnectionState;
    callState: CallState;
    certStatus: CertTrustStatus;
    audioRoute: AudioRoute;
    serverUrl?: string;
    username?: string;
    contactsReachable?: number | null;
    recentEvents?: Array<{ kind: string; at: string }>;
  }): Promise<SanitizedDiagnostics> {
    // Keep the native payload only as allowlisted evidence — never forward the
    // raw object (it can carry connection messages, identities and SDP).
    let native: unknown = null;
    try {
      native = await this.call('sip_diagnostics_export');
    } catch {
      native = null;
    }
    return sanitizeDiagnostics({ ...input, native });
  }

  async onConnectionState(handler: (s: NativeSipStatus) => void): Promise<() => void> {
    const off = await this.listenFn(NATIVE_EVENTS.connection, (p) => {
      handler(p as NativeSipStatus);
    });
    const un = typeof off === 'function' ? off : () => undefined;
    this.unlisteners.push(un);
    return () => {
      const i = this.unlisteners.indexOf(un);
      if (i >= 0) this.unlisteners.splice(i, 1);
      un();
    };
  }

  async onCallState(
    handler: (s: { state: CallState; info: CallInfo | null }) => void,
  ): Promise<() => void> {
    const off = await this.listenFn(NATIVE_EVENTS.call, (p) => {
      handler(p as { state: CallState; info: CallInfo | null });
    });
    const un = typeof off === 'function' ? off : () => undefined;
    this.unlisteners.push(un);
    return () => {
      const i = this.unlisteners.indexOf(un);
      if (i >= 0) this.unlisteners.splice(i, 1);
      un();
    };
  }

  async onCertStatus(handler: (s: CertTrustStatus) => void): Promise<() => void> {
    const off = await this.listenFn(NATIVE_EVENTS.cert, (p) => {
      handler(p as CertTrustStatus);
    });
    const un = typeof off === 'function' ? off : () => undefined;
    this.unlisteners.push(un);
    return () => {
      const i = this.unlisteners.indexOf(un);
      if (i >= 0) this.unlisteners.splice(i, 1);
      un();
    };
  }

  /**
   * Subscribe to raw core dialog events (`daad-call-event`): `call_waiting`,
   * `swapped`, `transfer_requested`, `transfer_failed` (secret-free).
   */
  async onCallEvent(handler: (e: NativeCallEvent) => void): Promise<() => void> {
    const off = await this.listenFn(NATIVE_EVENTS.callEvent, (p) => {
      handler(p as NativeCallEvent);
    });
    const un = typeof off === 'function' ? off : () => undefined;
    this.unlisteners.push(un);
    return () => {
      const i = this.unlisteners.indexOf(un);
      if (i >= 0) this.unlisteners.splice(i, 1);
      un();
    };
  }

  dispose(): void {
    const all = [...this.unlisteners];
    this.unlisteners = [];
    for (const u of all) {
      try {
        u();
      } catch {
        /* noop */
      }
    }
  }
}

export const nativeSipClient = new NativeSipClient();
