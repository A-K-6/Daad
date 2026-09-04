export interface SipConfig {
  serverUrl: string;       // e.g. "wss://pbx.example.com:8089/ws"
  sipUri: string;          // e.g. "sip:1001@pbx.example.com"
  /** Device-scoped SIP registration identity (provisioned per device, e.g. "guest-2001"). Must match the SIP URI user part. */
  username: string;
  /** Numeric person/profile extension (3–8 digits, no leading zero). Used for display and dialling. */
  extension?: string;
  password: string;        // PBX password/secret (transient only — never persisted)
  displayName?: string;    // e.g. "Front Desk"
  stunServer?: string;     // e.g. "stun:stun.l.google.com:19302"
  registerExpires?: number;// e.g. 600
  /** Custom CA PEM (transient only — sent once via sip_account_upsert, never persisted/logged). */
  customCaPem?: string;
}

export type ConnectionState =
  | 'Disconnected'
  | 'Connecting'
  | 'NetworkConnected'
  | 'TlsVerified'
  | 'Registering'
  | 'Registered'
  | 'Reconnecting'
  | 'RegistrationFailed'
  | 'AuthFailed'
  | 'CertFailed'
  | 'MicFailed'
  | 'NoReachableContact';

export type CallState = 
  | 'Idle'
  | 'Calling'
  | 'Ringing'
  | 'Active'
  | 'Holding';

export type CallDirection = 'incoming' | 'outgoing';

export interface CallInfo {
  remoteIdentity: string;
  remoteUri: string;
  direction: CallDirection;
  startTime: number | null;
  duration: number; // in seconds
  isMuted: boolean;
  isHeld: boolean;
}

export type CertTrustStatus = 'unknown' | 'verified' | 'self-signed' | 'failed' | 'not-applicable';

export type AudioRoute = 'earpiece' | 'speaker' | 'bluetooth' | 'system';

export interface SafeSipConfig {
  serverUrl: string;
  sipUri: string;
  username: string;
  extension?: string;
  displayName?: string;
  registerExpires?: number;
}

export interface NativeSipStatus {
  transportOpen: boolean;
  tlsVerified: boolean;
  registered: boolean;
  registering: boolean;
  reconnecting: boolean;
  failureKind: 'none' | 'auth' | 'cert' | 'mic' | 'unreachable' | 'generic';
  message: string | null;
  certStatus: CertTrustStatus;
  contactsReachable: number;
}

export const TERMINAL_FAILURE_STATES: ConnectionState[] = [
  'AuthFailed',
  'CertFailed',
  'MicFailed',
  'NoReachableContact',
  'RegistrationFailed',
];

/** Second-leg waiting caller (secret-free: extension + dialog id only). */
export interface WaitingCallInfo {
  from: string;
  callId: string;
}

/** Inbound transfer request surfaced from the native core (secret-free). */
export interface TransferRequestedInfo {
  callId: string;
  referTo: string;
}

/**
 * Typed `daad-call-event` payloads from the Rust core (`CallEvent`, serde
 * `tag = "type"`, `snake_case`). Secret-free: extensions + state only.
 */
export type NativeCallEvent =
  | { type: 'incoming_ringing'; from: string; call_id: string }
  | { type: 'outgoing_ringing'; to: string; call_id: string }
  | { type: 'active'; call_id: string }
  | { type: 'ended'; call_id: string; reason: string }
  | { type: 'failed'; reason: string; code?: number | null }
  | { type: 'reconnecting'; attempt: number }
  | { type: 'call_waiting'; from: string; call_id: string }
  | { type: 'swapped'; active_call_id: string }
  | { type: 'transfer_requested'; call_id: string; refer_to: string }
  | { type: 'transfer_failed'; call_id: string; code: number };
