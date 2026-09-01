import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import { SipConfig } from '@/types';

describe('SettingsModal Component', () => {
  const mockConfig: SipConfig = {
    serverUrl: 'wss://pbx.example.com:8089/ws',
    sipUri: 'sip:1001@pbx.example.com',
    username: '1001',
    password: 'secretPassword',
    displayName: 'User 1001',
    stunServer: 'stun:stun.l.google.com:19302',
    registerExpires: 600,
  };

  it('renders form with existing config values', () => {
    render(
      <SettingsModal
        currentConfig={mockConfig}
        connectionState="Registered"
        connectionError={null}
        onSaveAndConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByDisplayValue('wss://pbx.example.com:8089/ws')).toBeInTheDocument();
    expect(screen.getByDisplayValue('sip:1001@pbx.example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1001')).toBeInTheDocument();
  });

  it('switches between Credentials and PBX Guide tabs', () => {
    render(
      <SettingsModal
        currentConfig={mockConfig}
        connectionState="Registered"
        connectionError={null}
        onSaveAndConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const guideTab = screen.getByRole('button', { name: /pbx guide/i });
    fireEvent.click(guideTab);

    expect(screen.getByText(/Asterisk WebRTC/i)).toBeInTheDocument();
    expect(screen.getByText(/FreeSWITCH WebRTC/i)).toBeInTheDocument();
  });

  it('triggers onSaveAndConnect on form submit', () => {
    const handleSave = vi.fn();
    render(
      <SettingsModal
        currentConfig={mockConfig}
        connectionState="Disconnected"
        connectionError={null}
        onSaveAndConnect={handleSave}
        onDisconnect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const saveBtn = screen.getByRole('button', { name: /save & connect/i });
    fireEvent.click(saveBtn);
    expect(handleSave).toHaveBeenCalledTimes(1);
  });
});
