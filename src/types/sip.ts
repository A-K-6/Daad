export interface SipConfig {
  serverUrl: string;       // e.g. "wss://pbx.example.com:8089/ws"
  sipUri: string;          // e.g. "sip:1001@pbx.example.com"
  username: string;        // e.g. "1001"
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
