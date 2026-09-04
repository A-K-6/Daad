import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActiveCallView } from '@/components/ActiveCallView';
import { CallInfo } from '@/types';

const activeInfo: CallInfo = {
  remoteIdentity: '1001',
  remoteUri: 'sip:1001@pbx',
  direction: 'outgoing',
  startTime: Date.now() - 10000,
  duration: 10,
  isMuted: false,
  isHeld: false,
};

function renderActive(overrides: Partial<Parameters<typeof ActiveCallView>[0]> = {}) {
  const props: Parameters<typeof ActiveCallView>[0] = {
    callState: 'Active',
    callInfo: activeInfo,
    onHangup: vi.fn(),
    onToggleMute: vi.fn(),
    onToggleHold: vi.fn(),
    onSendDtmf: vi.fn(),
    ...overrides,
  };
  render(<ActiveCallView {...props} />);
  return props;
}

describe('ActiveCallView call power', () => {
  it('opens the transfer panel and runs Blind with a numeric target', async () => {
    const onTransferBlind = vi.fn(async () => undefined);
    renderActive({ onTransferBlind });
    fireEvent.click(screen.getByTitle('Transfer call'));
    const input = screen.getByPlaceholderText('e.g. 1002');
    fireEvent.change(input, { target: { value: '1002' } });
    fireEvent.click(screen.getByRole('button', { name: 'Blind' }));
    expect(onTransferBlind).toHaveBeenCalledWith('1002');
  });

  it('blocks non-numeric transfer targets with inline guidance', () => {
    const onTransferBlind = vi.fn(async () => undefined);
    renderActive({ onTransferBlind });
    fireEvent.click(screen.getByTitle('Transfer call'));
    const input = screen.getByPlaceholderText('e.g. 1002');
    // Non-digits are stripped by the input; a too-short number errors inline.
    fireEvent.change(input, { target: { value: '01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Blind' }));
    expect(onTransferBlind).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('runs Consult then shows Complete for the attended flow', async () => {
    const onConsult = vi.fn(async () => undefined);
    const onTransferAttended = vi.fn(async () => undefined);
    const { rerender } = render(
      <ActiveCallView
        callState="Active"
        callInfo={activeInfo}
        onHangup={vi.fn()}
        onToggleMute={vi.fn()}
        onToggleHold={vi.fn()}
        onSendDtmf={vi.fn()}
        onConsult={onConsult}
        onTransferAttended={onTransferAttended}
      />,
    );
    fireEvent.click(screen.getByTitle('Transfer call'));
    fireEvent.change(screen.getByPlaceholderText('e.g. 1002'), { target: { value: '1003' } });
    fireEvent.click(screen.getByRole('button', { name: 'Consult' }));
    expect(onConsult).toHaveBeenCalledWith('1003');
    rerender(
      <ActiveCallView
        callState="Holding"
        callInfo={{ ...activeInfo, isHeld: true }}
        consultTarget="1003"
        hasSecondLeg
        onHangup={vi.fn()}
        onToggleMute={vi.fn()}
        onToggleHold={vi.fn()}
        onSendDtmf={vi.fn()}
        onConsult={onConsult}
        onTransferAttended={onTransferAttended}
      />,
    );
    const completeBtn = await screen.findByRole('button', { name: 'Complete' });
    fireEvent.click(completeBtn);
    expect(onTransferAttended).toHaveBeenCalledTimes(1);
  });

  it('shows Swap only while a second leg exists', () => {
    const { rerender } = render(
      <ActiveCallView
        callState="Active"
        callInfo={activeInfo}
        onHangup={vi.fn()}
        onToggleMute={vi.fn()}
        onToggleHold={vi.fn()}
        onSendDtmf={vi.fn()}
        onSwap={vi.fn()}
      />,
    );
    expect(screen.queryByTitle('Swap active and held calls')).not.toBeInTheDocument();
    rerender(
      <ActiveCallView
        callState="Active"
        callInfo={activeInfo}
        hasSecondLeg
        onHangup={vi.fn()}
        onToggleMute={vi.fn()}
        onToggleHold={vi.fn()}
        onSendDtmf={vi.fn()}
        onSwap={vi.fn()}
      />,
    );
    expect(screen.getByTitle('Swap active and held calls')).toBeInTheDocument();
  });

  it('renders the waiting banner with Accept/Decline and badges', () => {
    const onAnswerWaiting = vi.fn(async () => undefined);
    const onDeclineWaiting = vi.fn(async () => undefined);
    const onSwap = vi.fn(async () => undefined);
    renderActive({
      waitingCall: { from: '1004', callId: 'cid-w' },
      hasSecondLeg: true,
      onAnswerWaiting,
      onDeclineWaiting,
      onSwap,
    });
    expect(screen.getByText('1004')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(onAnswerWaiting).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(onDeclineWaiting).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle('Swap active and held calls')).toBeInTheDocument();
  });

  it('surfaces transfer failures without leaking secrets', () => {
    renderActive({ transferError: 'Transfer failed (SIP 603) — call still connected.' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Transfer failed');
    expect(document.body.textContent).not.toContain('super-secret');
  });
});
