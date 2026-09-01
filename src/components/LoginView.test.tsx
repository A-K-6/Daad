import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoginView } from './LoginView';
import { SipConfig } from '@/types';

describe('LoginView Component', () => {
  const mockConfig: SipConfig = {
    serverUrl: 'wss://pbx.example.com:8089/ws',
    sipUri: 'sip:1001@pbx.example.com',
    username: '1001',
    password: 'secretPassword',
    displayName: 'User 1001',
    stunServer: 'stun:stun.l.google.com:19302',
    registerExpires: 600,
  };

  it('renders login form and presets correctly', () => {
    render(
      <LoginView
        initialConfig={mockConfig}
        connectionState="Disconnected"
        connectionError={null}
        onLogin={vi.fn()}
      />
    );

    expect(screen.getByText('Daad Softphone')).toBeInTheDocument();
    expect(screen.getByText('Sign in with your SIP / PBX account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /asterisk/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /freeswitch/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in & connect/i })).toBeInTheDocument();
  });

  it('applies Asterisk preset when clicked', () => {
    render(
      <LoginView
        initialConfig={{ serverUrl: '', sipUri: '', username: '', password: '' }}
        connectionState="Disconnected"
        connectionError={null}
        onLogin={vi.fn()}
      />
    );

    const asteriskBtn = screen.getByRole('button', { name: /asterisk/i });
    fireEvent.click(asteriskBtn);

    const serverInput = screen.getByPlaceholderText(/10\.41\.113\.71/i) as HTMLInputElement;
    expect(serverInput.value).toBe('wss://127.0.0.1:8089/ws');
  });

  it('displays connection error alert if registration failed', () => {
    render(
      <LoginView
        initialConfig={mockConfig}
        connectionState="RegistrationFailed"
        connectionError="Unauthorized: Invalid Password"
        onLogin={vi.fn()}
      />
    );

    expect(screen.getByText('Authentication Failed')).toBeInTheDocument();
    expect(screen.getByText('Unauthorized: Invalid Password')).toBeInTheDocument();
  });

  it('calls onLogin with formData on submit', () => {
    const handleLogin = vi.fn();
    render(
      <LoginView
        initialConfig={mockConfig}
        connectionState="Disconnected"
        connectionError={null}
        onLogin={handleLogin}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /sign in & connect/i });
    fireEvent.click(submitBtn);

    expect(handleLogin).toHaveBeenCalledTimes(1);
    expect(handleLogin).toHaveBeenCalledWith(expect.objectContaining({
      username: '1001',
      serverUrl: 'wss://pbx.example.com:8089/ws',
    }));
  });
});
