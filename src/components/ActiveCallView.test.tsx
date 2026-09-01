import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActiveCallView } from './ActiveCallView';
import { CallInfo } from '../types/sip';

describe('ActiveCallView Component', () => {
  const sampleCallInfo: CallInfo = {
    remoteIdentity: '1002 - Support Desk',
    remoteUri: 'sip:1002@pbx.example.com',
    direction: 'outgoing',
    startTime: Date.now() - 65000, // 1 min 5 sec ago
    duration: 65,
    isMuted: false,
    isHeld: false,
  };

  it('renders remote party identity and formatted duration (01:05)', () => {
    render(
      <ActiveCallView
        callState="Active"
        callInfo={sampleCallInfo}
        onHangup={vi.fn()}
        onToggleMute={vi.fn()}
        onToggleHold={vi.fn()}
        onSendDtmf={vi.fn()}
      />
    );

    expect(screen.getByText('1002 - Support Desk')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('01:05')).toBeInTheDocument();
  });

  it('triggers onToggleMute when mute button is clicked', () => {
    const handleToggleMute = vi.fn();
    render(
      <ActiveCallView
        callState="Active"
        callInfo={sampleCallInfo}
        onHangup={vi.fn()}
        onToggleMute={handleToggleMute}
        onToggleHold={vi.fn()}
        onSendDtmf={vi.fn()}
      />
    );

    const muteBtn = screen.getByTitle('Mute Mic');
    fireEvent.click(muteBtn);
    expect(handleToggleMute).toHaveBeenCalledTimes(1);
  });

  it('triggers onToggleHold when hold button is clicked', () => {
    const handleToggleHold = vi.fn();
    render(
      <ActiveCallView
        callState="Active"
        callInfo={sampleCallInfo}
        onHangup={vi.fn()}
        onToggleMute={vi.fn()}
        onToggleHold={handleToggleHold}
        onSendDtmf={vi.fn()}
      />
    );

    const holdBtn = screen.getByTitle('Hold Call');
    fireEvent.click(holdBtn);
    expect(handleToggleHold).toHaveBeenCalledTimes(1);
  });

  it('triggers onHangup when red End Call button is clicked', () => {
    const handleHangup = vi.fn();
    render(
      <ActiveCallView
        callState="Active"
        callInfo={sampleCallInfo}
        onHangup={handleHangup}
        onToggleMute={vi.fn()}
        onToggleHold={vi.fn()}
        onSendDtmf={vi.fn()}
      />
    );

    const endCallBtn = screen.getByTitle('End Call');
    fireEvent.click(endCallBtn);
    expect(handleHangup).toHaveBeenCalledTimes(1);
  });

  it('opens and closes DTMF keypad modal', () => {
    const handleSendDtmf = vi.fn();
    render(
      <ActiveCallView
        callState="Active"
        callInfo={sampleCallInfo}
        onHangup={vi.fn()}
        onToggleMute={vi.fn()}
        onToggleHold={vi.fn()}
        onSendDtmf={handleSendDtmf}
      />
    );

    const keypadBtn = screen.getByTitle('In-Call Keypad');
    fireEvent.click(keypadBtn);

    expect(screen.getByText('DTMF Keypad')).toBeInTheDocument();

    const key5 = screen.getByRole('button', { name: '5' });
    fireEvent.click(key5);
    expect(handleSendDtmf).toHaveBeenCalledWith('5');

    const doneBtn = screen.getByRole('button', { name: /done/i });
    fireEvent.click(doneBtn);
    expect(screen.queryByText('DTMF Keypad')).not.toBeInTheDocument();
  });
});
