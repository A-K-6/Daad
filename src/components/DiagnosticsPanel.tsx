import React, { useState } from 'react';
import { Download, FileJson, Loader2 } from 'lucide-react';
import type { SanitizedDiagnostics } from '@/services/nativeSipClient';

interface DiagnosticsPanelProps {
  onExport: () => Promise<SanitizedDiagnostics>;
}

export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({ onExport }) => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SanitizedDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await onExport();
      setResult(data);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daad-diagnostics-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="diagnostics-panel"
      className="rounded-xl border border-[var(--stroke-2)] bg-[var(--surface-2)] p-3 space-y-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <FileJson className="w-3.5 h-3.5 text-[var(--fg-3)]" />
          <span className="text-xs font-semibold text-[var(--fg-1)]">Diagnostics</span>
        </div>
        <span className="text-[10px] font-mono text-[var(--fg-3)]">sanitized • no secrets</span>
      </div>
      {error && (
        <p role="alert" className="text-[11px] text-[var(--danger-fg)] font-mono">
          {error}
        </p>
      )}
      <button
        onClick={handleExport}
        disabled={busy}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-[var(--stroke-2)] bg-[var(--surface-3)] hover:bg-[var(--surface-1)] text-xs text-[var(--fg-1)] transition-all active:scale-95 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        {busy ? 'Exporting…' : 'Export sanitized diagnostics'}
      </button>
      {result && (
        <pre
          data-testid="diagnostics-preview"
          className="max-h-28 overflow-y-auto rounded-lg border border-[var(--stroke-2)] bg-[var(--surface-1)] p-2 text-[10px] font-mono text-[var(--fg-3)]"
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
};
