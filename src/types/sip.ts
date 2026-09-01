export interface SipConfig {
  serverUrl: string;       // e.g. "wss://pbx.example.com:8089/ws"
  sipUri: string;          // e.g. "sip:1001@pbx.example.com"
  username: string;        // e.g. "1001"
  password: string;        // PBX password/secret
  displayName?: string;    // e.g. "Front Desk"
  stunServer?: string;     // e.g. "stun:stun.l.google.com:19302"
  registerExpires?: number;// e.g. 600
}

export type ConnectionState = 
  | 'Disconnected'
  | 'Connecting'
  | 'Registered'
  | 'RegistrationFailed';

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
