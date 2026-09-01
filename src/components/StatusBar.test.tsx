import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusBar } from './StatusBar';
import { SipConfig } from '@/types';

describe('StatusBar Component', () => {
  const mockConfig: SipConfig = {
    serverUrl: 'wss://pbx.example.com:8089/ws',
    sipUri: 'sip:1001@pbx.example.com',
    username: '1001',
    password: 'secret',
    displayName: 'Aeen Softphone',
  };

  it('renders Registered state with green indicator and display name', () => {
    render(
      <StatusBar
        connectionState="Registered"
        connectionError={null}
        config={mockConfig}
        onOpenSettings={vi.fn()}
      />
    );

    expect(screen.getByText('Aeen Softphone')).toBeInTheDocument();
    expect(screen.getByText('sip:1001@pbx.example.com')).toBeInTheDocument();
    const dot = screen.getByTestId('status-dot');
    expect(dot.className).toContain('bg-emerald-500');
  });

  it('renders Connecting state with amber pulsing indicator', () => {
    render(
      <StatusBar
        connectionState="Connecting"
        connectionError={null}
        config={mockConfig}
        onOpenSettings={vi.fn()}
      />
    );

    expect(screen.getByText('Connecting...')).toBeInTheDocument();
    const dot = screen.getByTestId('status-dot');
    expect(dot.className).toContain('bg-amber-400');
  });

  it('triggers onOpenSettings when settings button is clicked', () => {
    const handleOpenSettings = vi.fn();
    render(
      <StatusBar
        connectionState="Registered"
        connectionError={null}
        config={mockConfig}
        onOpenSettings={handleOpenSettings}
      />
    );

    const settingsBtn = screen.getByTitle('SIP Settings');
    fireEvent.click(settingsBtn);
    expect(handleOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('triggers onLogout when logout button is clicked', () => {
    const handleLogout = vi.fn();
    render(
      <StatusBar
        connectionState="Registered"
        connectionError={null}
        config={mockConfig}
        onOpenSettings={vi.fn()}
        onLogout={handleLogout}
      />
    );

    const logoutBtn = screen.getByTitle('Log Out / Disconnect');
    fireEvent.click(logoutBtn);
    expect(handleLogout).toHaveBeenCalledTimes(1);
  });
});
