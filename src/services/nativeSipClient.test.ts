import { describe, it, expect, vi } from 'vitest';
import {
  NativeSipClient,
  validateDialTarget,
  validateExtension,
  validateCaPem,
  stripSecrets,
  sanitizeDiagnostics,
  mapNativeStatusToConnectionState,
  sanitizeForLog,
} from './nativeSipClient';

describe('validateDialTarget', () => {
  it('accepts 3-8 digits without leading zero', () => {
    expect(validateDialTarget('101').ok).toBe(true);
    expect(validateDialTarget('911').ok).toBe(true);
    expect(validateDialTarget('1002').ok).toBe(true);
    expect(validateDialTarget('12345678').ok).toBe(true);
  });
  it('rejects leading zero, short/long, non-numeric', () => {
    expect(validateDialTarget('012').ok).toBe(false);
    expect(validateDialTarget('12').ok).toBe(false);
    expect(validateDialTarget('123456789').ok).toBe(false);
    expect(validateDialTarget('12a').ok).toBe(false);
    expect(validateDialTarget('*#').ok).toBe(false);
    expect(validateDialTarget('+123').ok).toBe(false);
    expect(validateDialTarget('').ok).toBe(false);
  });
});

describe('validateExtension / validateCaPem', () => {
  it('requires numeric 3-8 digit extensions with guidance', () => {
    expect(validateExtension('1001').ok).toBe(true);
    const bad = validateExtension('abc');
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/numeric/i);
    expect(validateExtension('01').ok).toBe(false);
  });
  it('accepts empty CA, validates PEM framing', () => {
    expect(validateCaPem('').ok).toBe(true);
    expect(
      validateCaPem('-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----').ok,
    ).toBe(true);
    const bad = validateCaPem('not-a-cert');
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/PEM/);
  });
});

describe('stripSecrets / sanitizeForLog', () => {
  it('redacts password, srtp, sdp, authorization keys', () => {
    const out = stripSecrets({
      password: 'secret',
      Authorization: 'Digest xyz',
      srtpKeys: 'abc',
      sdp: 'v=0...',
      serverUrl: 'tls://pbx:5061',
    }) as Record<string, string>;
    expect(out.password).toBe('[redacted]');
    expect(out.Authorization).toBe('[redacted]');
    expect(out.srtpKeys).toBe('[redacted]');
    expect(out.sdp).toBe('[redacted]');
    expect(out.serverUrl).toBe('tls://pbx:5061');
  });
  it('sanitizeForLog never leaks password', () => {
    const logged = JSON.stringify(
      sanitizeForLog('sip_account_upsert', { username: '1001', password: 'pw123' }),
    );
    expect(logged).not.toContain('pw123');
    expect(logged).toContain('[redacted]');
  });
  it('redacts custom CA PEM material', () => {
    const out = stripSecrets({
      custom_ca_pem: '-----BEGIN CERTIFICATE-----\nSECRET\n-----END CERTIFICATE-----',
      customCaPem: 'SECRET-PEM',
      serverUrl: 'tls://pbx:5061',
    }) as Record<string, string>;
    expect(out.custom_ca_pem).toBe('[redacted]');
    expect(out.customCaPem).toBe('[redacted]');
    expect(out.serverUrl).toBe('tls://pbx:5061');
    const logged = JSON.stringify(
      sanitizeForLog('sip_account_upsert', { custom_ca_pem: 'SECRET-PEM' }),
    );
    expect(logged).not.toContain('SECRET-PEM');
  });
});

describe('mapNativeStatusToConnectionState', () => {
  const base = {
    transportOpen: false,
    tlsVerified: false,
    registered: false,
    registering: false,
    reconnecting: false,
    failureKind: 'none' as const,
    message: null,
    certStatus: 'unknown' as const,
    contactsReachable: 0,
  };
  it('only reports Registered on registered=true (never socket-open alone)', () => {
    expect(
      mapNativeStatusToConnectionState({ ...base, transportOpen: true }),
    ).toBe('NetworkConnected');
    expect(
      mapNativeStatusToConnectionState({ ...base, transportOpen: true, tlsVerified: true }),
    ).toBe('TlsVerified');
    expect(mapNativeStatusToConnectionState({ ...base, registered: true })).toBe('Registered');
  });
  it('maps failure kinds distinctly', () => {
    expect(mapNativeStatusToConnectionState({ ...base, failureKind: 'auth' })).toBe('AuthFailed');
    expect(mapNativeStatusToConnectionState({ ...base, failureKind: 'cert' })).toBe('CertFailed');
    expect(mapNativeStatusToConnectionState({ ...base, failureKind: 'mic' })).toBe('MicFailed');
    expect(mapNativeStatusToConnectionState({ ...base, failureKind: 'unreachable' })).toBe(
      'NoReachableContact',
    );
    expect(mapNativeStatusToConnectionState({ ...base, failureKind: 'generic' })).toBe(
      'RegistrationFailed',
    );
  });
  it('maps registering/reconnecting', () => {
    expect(mapNativeStatusToConnectionState({ ...base, registering: true })).toBe('Registering');
    expect(mapNativeStatusToConnectionState({ ...base, reconnecting: true })).toBe('Reconnecting');
  });
});

describe('NativeSipClient IPC', () => {
  it('serializes account_upsert/register/call/dtmf/audio_route/diagnostics commands', async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    const client = new NativeSipClient({
      invokeFn: async (cmd, args) => {
        calls.push({ cmd, args });
        if (cmd === 'sip_status') return { registered: true };
        if (cmd === 'sip_diagnostics_export') return { password: 'x', ok: 1 };
        return undefined;
      },
      listenFn: () => () => undefined,
    });
    await client.accountUpsert({
      serverUrl: 'tls://pbx:5061',
      sipUri: 'sip:1001@pbx',
      username: '1001',
      password: 'pw',
    });
    await client.register();
    await client.unregister();
    await client.invite('1002');
    await client.setMuted(true);
    await client.setHeld(false);
    await client.sendDtmf('5');
    await client.setAudioRoute('speaker');
    await client.answer();
    await client.reject();
    await client.hangup();
    await client.accountRemove();
    const diag = await client.exportDiagnostics({
      connectionState: 'Registered',
      callState: 'Idle',
      certStatus: 'verified',
      audioRoute: 'system',
      serverUrl: 'tls://10.1.2.3:5061',
      username: '1001',
    });
    const cmds = calls.map((c) => c.cmd);
    for (const expected of [
      'sip_account_upsert',
      'sip_register',
      'sip_unregister',
      'sip_call_invite',
      'sip_call_mute',
      'sip_call_hold',
      'sip_call_dtmf',
      'sip_audio_route',
      'sip_call_answer',
      'sip_call_reject',
      'sip_call_hangup',
      'sip_account_remove',
      'sip_diagnostics_export',
    ]) {
      expect(cmds).toContain(expected);
    }
    expect(JSON.stringify(diag)).not.toContain('pw');
    expect(diag.serverHost).not.toContain('10.1.2.3');
  });

  it('rejects invalid dial targets and dtmf before IPC', async () => {
    const invokeFn = vi.fn(async () => undefined);
    const client = new NativeSipClient({ invokeFn, listenFn: () => () => undefined });
    await expect(client.invite('01')).rejects.toThrow();
    await expect(client.invite('12')).rejects.toThrow();
    await expect(client.sendDtmf('X')).rejects.toThrow();
    expect(invokeFn).not.toHaveBeenCalled();
  });

  it('sends custom CA PEM once via sip_account_upsert', async () => {
    let upsertArgs: Record<string, unknown> | undefined;
    const client = new NativeSipClient({
      invokeFn: async (cmd, args) => {
        if (cmd === 'sip_account_upsert') upsertArgs = args;
        return undefined;
      },
      listenFn: () => () => undefined,
    });
    const pem = '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----';
    await client.accountUpsert({
      serverUrl: 'tls://pbx:5061',
      sipUri: 'sip:1001@pbx',
      username: '1001',
      password: 'pw',
      customCaPem: pem,
    });
    expect(upsertArgs?.custom_ca_pem).toBe(pem);
    await expect(
      client.accountUpsert({
        serverUrl: 'tls://pbx:5061',
        sipUri: 'sip:1001@pbx',
        username: '1001',
        password: 'pw',
        customCaPem: 'not-a-cert',
      }),
    ).rejects.toThrow(/PEM/);
  });

  it('subscribes to tauri events and disposes without duplicates', async () => {
    const offs = [vi.fn(), vi.fn(), vi.fn()];
    let n = 0;
    const client = new NativeSipClient({
      invokeFn: async () => undefined,
      listenFn: () => {
        const off = offs[n % offs.length];
        n += 1;
        return Promise.resolve(off);
      },
    });
    const u1 = await client.onConnectionState(() => undefined);
    const u2 = await client.onCallState(() => undefined);
    u1();
    u2();
    client.dispose();
    expect(offs[0]).toHaveBeenCalledTimes(1);
    expect(offs[1]).toHaveBeenCalledTimes(1);
  });
});

describe('sanitizeDiagnostics', () => {
  it('never includes secrets or full identities', () => {
    const d = sanitizeDiagnostics({
      connectionState: 'Registered',
      callState: 'Active',
      certStatus: 'verified',
      audioRoute: 'speaker',
      serverUrl: 'tls://10.41.113.71:5061',
      username: '1001',
      contactsReachable: 1,
    });
    const s = JSON.stringify(d);
    expect(s).not.toContain('10.41.113.71');
    expect(s).not.toContain('1001');
    expect(s).toContain('Sanitized');
  });
});
