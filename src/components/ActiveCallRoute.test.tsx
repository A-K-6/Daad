import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActiveCallView } from './ActiveCallView';

describe('ActiveCallView audio route', () => {
  it('renders route selector and notifies on change', () => {
    const onRoute = vi.fn();
    render(
      <ActiveCallView
        callState="Active"
        callInfo={{
          remoteIdentity: '1002',
          remoteUri: 'sip:1002@pbx',
          direction: 'outgoing',
          startTime: null,
          duration: 5,
          isMuted: false,
          isHeld: false,
        }}
        audioRoute="system"
        onHangup={vi.fn()}
        onToggleMute={vi.fn()}
        onToggleHold={vi.fn()}
        onSendDtmf={vi.fn()}
        onAudioRoute={onRoute}
      />,
    );
    fireEvent.click(screen.getByTitle('Audio Devices'));
    const speaker = screen.getByText('speaker');
    fireEvent.click(speaker);
    expect(onRoute).toHaveBeenCalledWith('speaker');
  });
});
