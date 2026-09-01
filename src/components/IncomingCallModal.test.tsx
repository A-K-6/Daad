import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IncomingCallModal } from './IncomingCallModal';
import { CallInfo } from '../types/sip';

describe('IncomingCallModal Component', () => {
  const sampleIncomingInfo: CallInfo = {
    remoteIdentity: 'Alice (1003)',
    remoteUri: 'sip:1003@pbx.example.com',
    direction: 'incoming',
    startTime: null,
    duration: 0,
    isMuted: false,
    isHeld: false,
  };

  it('renders caller identity and Incoming Call title', () => {
    render(
      <IncomingCallModal
        callInfo={sampleIncomingInfo}
        onAnswer={vi.fn()}
        onDecline={vi.fn()}
      />
    );

    expect(screen.getByText('Incoming Call')).toBeInTheDocument();
    expect(screen.getByText('Alice (1003)')).toBeInTheDocument();
    expect(screen.getByText('sip:1003@pbx.example.com')).toBeInTheDocument();
  });

  it('triggers onAnswer when answer button is clicked', () => {
    const handleAnswer = vi.fn();
    render(
      <IncomingCallModal
        callInfo={sampleIncomingInfo}
        onAnswer={handleAnswer}
        onDecline={vi.fn()}
      />
    );

    const answerBtn = screen.getByTitle('Answer Call');
    fireEvent.click(answerBtn);
    expect(handleAnswer).toHaveBeenCalledTimes(1);
  });

  it('triggers onDecline when decline button is clicked', () => {
    const handleDecline = vi.fn();
    render(
      <IncomingCallModal
        callInfo={sampleIncomingInfo}
        onAnswer={vi.fn()}
        onDecline={handleDecline}
      />
    );

    const declineBtn = screen.getByTitle('Decline Call');
    fireEvent.click(declineBtn);
    expect(handleDecline).toHaveBeenCalledTimes(1);
  });
});
