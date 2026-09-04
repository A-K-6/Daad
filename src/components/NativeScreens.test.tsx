import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CertTrustBadge } from './CertTrustBadge';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { ProvisioningView } from './ProvisioningView';

describe('CertTrustBadge', () => {
  it('renders verified status', () => {
    render(<CertTrustBadge status="verified" />);
    expect(screen.getByTestId('cert-trust-badge')).toHaveAttribute('data-status', 'verified');
    expect(screen.getByText('TLS verified')).toBeInTheDocument();
  });
  it('renders failed/self-signed distinctly', () => {
    const { rerender } = render(<CertTrustBadge status="failed" />);
    expect(screen.getByText('Cert failure')).toBeInTheDocument();
    rerender(<CertTrustBadge status="self-signed" />);
    expect(screen.getByText('Self-signed cert')).toBeInTheDocument();
  });
});

describe('DiagnosticsPanel', () => {
  it('exports sanitized diagnostics without secrets', async () => {
    const onExport = vi.fn(async () => ({
      generatedAt: new Date().toISOString(),
      connectionState: 'Registered' as const,
      callState: 'Idle' as const,
      certStatus: 'verified' as const,
      audioRoute: 'system' as const,
      serverHost: '10.1.x.x',
      sipUser: '[extension-present]',
      contactsReachable: 1,
      recentEvents: [],
      notes: 'Sanitized: no passwords, tokens, SDP, SRTP keys, or full SIP URIs.',
    }));
    const urlStub = 'blob:mock';
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue(urlStub);
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<DiagnosticsPanel onExport={onExport} />);
    fireEvent.click(screen.getByText('Export sanitized diagnostics'));
    await screen.findByTestId('diagnostics-preview');
    expect(onExport).toHaveBeenCalledTimes(1);
    const preview = screen.getByTestId('diagnostics-preview').textContent || '';
    expect(preview).toContain('Sanitized');
    expect(preview).toContain('10.1.x.x');
    expect(preview).not.toContain('super-secret-value');
    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });
});

describe('ProvisioningView', () => {
  const base = {
    serverUrl: 'tls://pbx:5061',
    sipUri: 'sip:1001@pbx',
    username: '1001',
    password: '',
  };
  it('shows cert badge and clears password + CA after provision', async () => {
    const onProvision = vi.fn(async () => undefined);
    render(
      <ProvisioningView
        initialConfig={base}
        connectionState="Disconnected"
        connectionError={null}
        certStatus="verified"
        onProvision={onProvision}
      />,
    );
    expect(screen.getByText('TLS verified')).toBeInTheDocument();
    const pw = screen.getByLabelText('SIP Password') as HTMLInputElement;
    fireEvent.change(pw, { target: { value: 'secret123' } });
    const ca = screen.getByLabelText('Custom CA PEM') as HTMLTextAreaElement;
    fireEvent.change(ca, {
      target: { value: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----' },
    });
    fireEvent.click(screen.getByText('Provision & Register'));
    await vi.waitFor(() => expect(onProvision).toHaveBeenCalledTimes(1));
    expect(onProvision).toHaveBeenCalledWith(
      expect.objectContaining({
        username: '1001',
        customCaPem: expect.stringContaining('BEGIN CERTIFICATE'),
      }),
    );
    await vi.waitFor(() => expect(pw.value).toBe(''));
    expect((screen.getByLabelText('Custom CA PEM') as HTMLTextAreaElement).value).toBe('');
  });
  it('blocks non-numeric extensions with guidance', () => {
    const onProvision = vi.fn(async () => undefined);
    render(
      <ProvisioningView
        initialConfig={{ ...base, extension: 'abc' }}
        connectionState="Disconnected"
        connectionError={null}
        certStatus="unknown"
        onProvision={onProvision}
      />,
    );
    // Fill the required password so native form validation lets submit through.
    fireEvent.change(screen.getByLabelText('SIP Password'), { target: { value: 'pw123' } });
    fireEvent.click(screen.getByText('Provision & Register'));
    expect(screen.getByRole('alert').textContent).toMatch(/numeric/i);
    expect(onProvision).not.toHaveBeenCalled();
  });
  it('accepts provisioned device usernames and blocks URI mismatches', async () => {
    const onProvision = vi.fn(async () => undefined);
    render(
      <ProvisioningView
        initialConfig={{ ...base, sipUri: 'sip:guest-2001@pbx', username: 'guest-2001', extension: '2001' }}
        connectionState="Disconnected"
        connectionError={null}
        certStatus="unknown"
        onProvision={onProvision}
      />,
    );
    fireEvent.change(screen.getByLabelText('SIP Password'), { target: { value: 'pw123' } });
    fireEvent.click(screen.getByText('Provision & Register'));
    expect(onProvision).toHaveBeenCalledTimes(1);
    expect(onProvision).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'guest-2001', extension: '2001' }),
    );

    onProvision.mockClear();
    await vi.waitFor(() => expect(screen.getByText('Provision & Register')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Device SIP username'), { target: { value: 'other-user' } });
    fireEvent.click(screen.getByText('Provision & Register'));
    expect(screen.getByRole('alert').textContent).toMatch(/must match the device username/i);
    expect(onProvision).not.toHaveBeenCalled();
  });
  it('shows a build marker for triage', () => {
    render(
      <ProvisioningView
        initialConfig={base}
        connectionState="Disconnected"
        connectionError={null}
        certStatus="unknown"
        onProvision={vi.fn(async () => undefined)}
      />,
    );
    // jsdom has no Tauri runtime — footer falls back to 'dev'.
    expect(screen.getByTestId('app-version').textContent).toMatch(/build /);
  });
  it('rejects malformed CA PEM before IPC', () => {
    const onProvision = vi.fn(async () => undefined);
    render(
      <ProvisioningView
        initialConfig={base}
        connectionState="Disconnected"
        connectionError={null}
        certStatus="unknown"
        onProvision={onProvision}
      />,
    );
    fireEvent.change(screen.getByLabelText('Custom CA PEM'), { target: { value: 'not-a-cert' } });
    fireEvent.click(screen.getByText('Provision & Register'));
    expect(screen.getByRole('alert').textContent).toMatch(/PEM/);
    expect(onProvision).not.toHaveBeenCalled();
  });
  it('shows cert pending state while TLS is being verified', () => {
    render(
      <ProvisioningView
        initialConfig={base}
        connectionState="TlsVerified"
        connectionError={null}
        certStatus="unknown"
        onProvision={vi.fn()}
      />,
    );
    expect(screen.getByTestId('cert-pending')).toHaveTextContent(/pending/i);
  });
  it('renders distinct failure titles and progress states', () => {
    const { rerender } = render(
      <ProvisioningView
        initialConfig={base}
        connectionState="AuthFailed"
        connectionError="401 Unauthorized"
        certStatus="unknown"
        onProvision={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Authentication failed');
    rerender(
      <ProvisioningView
        initialConfig={base}
        connectionState="Reconnecting"
        connectionError={null}
        certStatus="unknown"
        onProvision={vi.fn()}
      />,
    );
    expect(screen.getByTestId('provisioning-progress')).toHaveTextContent('Reconnecting');
  });
});
