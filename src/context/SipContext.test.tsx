import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect } from 'react';
import { SipProvider, useSip } from '@/context/SipContext';
import { NativeSipClient } from '@/services/nativeSipClient';
import { DialerPad } from '@/components/DialerPad';

function makeMockClient() {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  let connHandler: ((s: never) => void) | null = null;
  let callHandler: ((s: never) => void) | null = null;
  const client = new NativeSipClient({
    invokeFn: async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'sip_status') {
        return {
          transportOpen: true,
          tlsVerified: true,
          registered: true,
          registering: false,
          reconnecting: false,
          failureKind: 'none',
          message: null,
          certStatus: 'verified',
          contactsReachable: 1,
        };
      }
      if (cmd === 'sip_diagnostics_export') return { ok: 1 };
      return undefined;
    },
    listenFn: (event, handler) => {
      if (event === 'sip://connection-state') connHandler = handler as never;
      if (event === 'sip://call-state') callHandler = handler as never;
      return Promise.resolve(() => undefined);
    },
  });
  return {
    client,
    calls,
    fireConn: (s: never) => connHandler?.(s),
    fireCall: (s: never) => callHandler?.(s),
  };
}

const Probe: React.FC<{ onCtx?: (c: ReturnType<typeof useSip>) => void }> = ({ onCtx }) => {
  const ctx = useSip();
  useEffectCapture(ctx, onCtx);
  return (
    <div>
      <span data-testid="conn">{ctx.connectionState}</span>
      <span data-testid="call">{ctx.callState}</span>
      <span data-testid="dur">{ctx.callInfo?.duration ?? 'none'}</span>
      <span data-testid="start">{ctx.callInfo?.startTime ?? 'none'}</span>
      <button onClick={() => ctx.connect({ serverUrl: 'tls://pbx:5061', sipUri: 'sip:1001@pbx', username: '1001', password: 'pw' })}>
        connect
      </button>
      <button onClick={() => ctx.makeCall('1002')}>call</button>
    </div>
  );
};

function useEffectCapture(ctx: ReturnType<typeof useSip>, onCtx?: (c: ReturnType<typeof useSip>) => void) {
  useEffect(() => {
    onCtx?.(ctx);
  }, [ctx, onCtx]);
}

describe('SipContext (native)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('never persists password to localStorage', async () => {
    const { client } = makeMockClient();
    let ctx: ReturnType<typeof useSip> | null = null;
    render(
      <SipProvider client={client}>
        <Probe onCtx={(c) => { ctx = c; }} />
      </SipProvider>,
    );
    await act(async () => {
      await ctx!.connect({
        serverUrl: 'tls://pbx:5061',
        sipUri: 'sip:1001@pbx',
        username: '1001',
        password: 'super-secret',
      });
    });
    const stored = localStorage.getItem('daad_sip_profile') || '';
    expect(stored).not.toContain('super-secret');
    expect(stored).toContain('1001');
    expect(ctx!.config.password).toBe('');
  });

  it('purges legacy daad_sip_config secrets on login and never persists CA', async () => {
    localStorage.setItem('daad_sip_config', JSON.stringify({ username: '1001', password: 'legacy-secret' }));
    const { client, calls } = makeMockClient();
    let ctx: ReturnType<typeof useSip> | null = null;
    render(
      <SipProvider client={client}>
        <Probe onCtx={(c) => { ctx = c; }} />
      </SipProvider>,
    );
    const pem = '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----';
    await act(async () => {
      await ctx!.login({
        serverUrl: 'tls://pbx:5061',
        sipUri: 'sip:1001@pbx',
        username: '1001',
        password: 'fresh-secret',
        customCaPem: pem,
      });
    });
    expect(localStorage.getItem('daad_sip_config')).toBeNull();
    const stored = localStorage.getItem('daad_sip_profile') || '';
    expect(stored).not.toContain('fresh-secret');
    expect(stored).not.toContain('BEGIN CERTIFICATE');
    const upsert = calls.find((c) => c.cmd === 'sip_account_upsert');
    expect(upsert?.args?.customCaPem).toBe(pem);
  });

  it('trusts Rust event timestamps for call timing (no webview-owned start)', async () => {
    const { client, fireCall } = makeMockClient();
    render(
      <SipProvider client={client}>
        <Probe />
      </SipProvider>,
    );
    // Flush pending subscription microtasks (call listener attaches after conn listener).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const rustStart = 1_700_000_000_000;
    await act(async () => {
      fireCall({
        state: 'Active',
        info: {
          remoteIdentity: '1002',
          remoteUri: 'sip:1002@pbx',
          direction: 'outgoing',
          startTime: rustStart,
          duration: 7,
          isMuted: false,
          isHeld: false,
        },
      } as never);
    });
    // Rust-owned startTime is used verbatim — webview never synthesizes Date.now().
    expect(screen.getByTestId('start')).toHaveTextContent(String(rustStart));
    expect(screen.getByTestId('dur')).toHaveTextContent('7');
    expect(screen.getByTestId('call')).toHaveTextContent('Active');
  });

  it('maps native registered=true to Registered (never socket-open alone)', async () => {
    const { client, fireConn } = makeMockClient();
    render(
      <SipProvider client={client}>
        <Probe />
      </SipProvider>,
    );
    await act(async () => {
      fireConn({
        transportOpen: true,
        tlsVerified: false,
        registered: false,
        registering: false,
        reconnecting: false,
        failureKind: 'none',
        message: null,
        certStatus: 'unknown',
        contactsReachable: 0,
      } as never);
    });
    expect(screen.getByTestId('conn')).toHaveTextContent('NetworkConnected');
    expect(screen.getByTestId('conn')).not.toHaveTextContent('Registered');
  });

  it('applies only the latest connect result (no duplicate registration workers)', async () => {
    let registerCount = 0;
    const client = new NativeSipClient({
      invokeFn: async (cmd) => {
        if (cmd === 'sip_register') {
          registerCount += 1;
          await new Promise((r) => setTimeout(r, 20));
        }
        if (cmd === 'sip_status') {
          return {
            transportOpen: true, tlsVerified: true, registered: true, registering: false,
            reconnecting: false, failureKind: 'none', message: null,
            certStatus: 'verified', contactsReachable: 1,
          };
        }
        return undefined;
      },
      listenFn: () => Promise.resolve(() => undefined),
    });
    let ctx: ReturnType<typeof useSip> | null = null;
    render(
      <SipProvider client={client}>
        <Probe onCtx={(c) => { ctx = c; }} />
      </SipProvider>,
    );
    await act(async () => {
      await Promise.all([
        ctx!.connect({ serverUrl: 'tls://pbx:5061', sipUri: 'sip:1001@pbx', username: '1001', password: 'pw1' }),
        ctx!.connect({ serverUrl: 'tls://pbx:5061', sipUri: 'sip:1001@pbx', username: '1001', password: 'pw2' }),
      ]);
    });
    expect(registerCount).toBeGreaterThanOrEqual(1);
    expect(registerCount).toBeLessThanOrEqual(2);
    expect(screen.getByTestId('conn')).toHaveTextContent('Registered');
  });

  it('rejects invalid dial targets before IPC', async () => {
    const invokeFn = vi.fn(async () => undefined);
    const client = new NativeSipClient({ invokeFn, listenFn: () => () => undefined });
    let ctx: ReturnType<typeof useSip> | null = null;
    render(
      <SipProvider client={client}>
        <Probe onCtx={(c) => { ctx = c; }} />
      </SipProvider>,
    );
    await expect(ctx!.makeCall('01')).rejects.toThrow();
    await expect(ctx!.makeCall('12')).rejects.toThrow();
    expect(invokeFn).not.toHaveBeenCalled();
  });

  it('dialpad blocks invalid numbers with guidance', () => {
    const onCall = vi.fn();
    render(<DialerPad connectionState="Registered" onCall={onCall} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('0'));
    fireEvent.click(screen.getByText('1'));
    fireEvent.click(screen.getByTitle('Initiate Call'));
    expect(onCall).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('no leading zero');
  });

  it('exposes waiting/second-leg state from native call events', async () => {
    const { client, fireCall } = makeMockClientWithEvents();
    let ctx: ReturnType<typeof useSip> | null = null;
    render(
      <SipProvider client={client}>
        <Probe onCtx={(c) => { ctx = c; }} />
      </SipProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ctx!.waitingCall).toBeNull();
    expect(ctx!.hasSecondLeg).toBe(false);
    await act(async () => {
      fireCall({ type: 'call_waiting', from: '1003', call_id: 'cid-w' } as never);
    });
    expect(ctx!.waitingCall).toEqual({ from: '1003', callId: 'cid-w' });
    expect(ctx!.hasSecondLeg).toBe(true);
    // Answering clears the ringing waiter but a second dialog stays possible
    // via consult tracking; swapped clears the ringing state.
    await act(async () => {
      fireCall({ type: 'swapped', active_call_id: 'cid-w' } as never);
    });
    expect(ctx!.waitingCall).toBeNull();
    await act(async () => {
      fireCall({ type: 'transfer_failed', call_id: 'cid-a', code: 603 } as never);
    });
    expect(ctx!.transferError).toMatch(/603/);
    await act(async () => {
      fireCall({ type: 'transfer_requested', call_id: 'cid-a', refer_to: 'sip:1002@pbx' } as never);
    });
    expect(ctx!.transferRequested).toEqual({ callId: 'cid-a', referTo: 'sip:1002@pbx' });
  });

  it('exposes the five call-power actions and clears state on Idle', async () => {
    const { client, calls, fireCall } = makeMockClientWithEvents();
    let ctx: ReturnType<typeof useSip> | null = null;
    render(
      <SipProvider client={client}>
        <Probe onCtx={(c) => { ctx = c; }} />
      </SipProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      await ctx!.transferBlind('1002');
      await ctx!.consult('1003');
      await ctx!.transferAttended();
      await ctx!.swapCalls();
      await ctx!.answerWaiting();
    });
    const cmds = calls.map((c) => c.cmd);
    for (const expected of [
      'sip_call_transfer_blind',
      'sip_call_consult',
      'sip_call_transfer_attended',
      'sip_call_swap',
      'sip_call_answer_waiting',
    ]) {
      expect(cmds).toContain(expected);
    }
    expect(ctx!.consultTarget).toBe('1003');
    expect(ctx!.hasSecondLeg).toBe(true);
    // Invalid targets never reach IPC.
    const before = calls.length;
    await expect(ctx!.transferBlind('01')).rejects.toThrow();
    await expect(ctx!.consult('ab')).rejects.toThrow();
    expect(calls).toHaveLength(before);
    // Idle clears waiting/consult/transfer state; no secrets persisted.
    await act(async () => {
      fireCall({ type: 'call_waiting', from: '1004', call_id: 'cid-x' } as never);
      fireCall({ state: 'Idle', info: null } as never);
    });
    expect(ctx!.waitingCall).toBeNull();
    expect(ctx!.consultTarget).toBeNull();
    expect(ctx!.hasSecondLeg).toBe(false);
    const stored = localStorage.getItem('daad_sip_profile') || '';
    expect(stored).not.toContain('1004');
  });
});

function makeMockClientWithEvents() {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  let connHandler: ((s: never) => void) | null = null;
  let callHandler: ((s: never) => void) | null = null;
  let eventHandler: ((s: never) => void) | null = null;
  const client = new NativeSipClient({
    invokeFn: async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'sip_status') {
        return {
          transportOpen: true,
          tlsVerified: true,
          registered: true,
          registering: false,
          reconnecting: false,
          failureKind: 'none',
          message: null,
          certStatus: 'verified',
          contactsReachable: 1,
        };
      }
      if (cmd === 'sip_diagnostics_export') return { ok: 1 };
      return undefined;
    },
    listenFn: (event, handler) => {
      if (event === 'sip://connection-state') connHandler = handler as never;
      if (event === 'sip://call-state') callHandler = handler as never;
      if (event === 'daad-call-event') eventHandler = handler as never;
      return Promise.resolve(() => undefined);
    },
  });
  return {
    client,
    calls,
    fireConn: (s: never) => connHandler?.(s),
    fireCall: (s: never) => {
      // Call-power events arrive on daad-call-event; snapshots on sip://call-state.
      if (s && typeof (s as { type?: unknown }).type === 'string') eventHandler?.(s);
      else callHandler?.(s);
    },
  };
}
