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
      className="rounded-xl border border-white/[0.08] bg-[#0c0e15] p-3 space-y-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <FileJson className="w-3.5 h-3.5 text-zinc-400" />
          <span className="text-xs font-semibold text-zinc-200">Diagnostics</span>
        </div>
        <span className="text-[10px] font-mono text-zinc-500">sanitized • no secrets</span>
      </div>
      {error && (
        <p role="alert" className="text-[11px] text-rose-400 font-mono">
          {error}
        </p>
      )}
      <button
        onClick={handleExport}
        disabled={busy}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-white/[0.08] bg-[#13151f] hover:bg-[#090a0f] text-xs text-zinc-200 transition-all active:scale-95 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        {busy ? 'Exporting…' : 'Export sanitized diagnostics'}
      </button>
      {result && (
        <pre
          data-testid="diagnostics-preview"
          className="max-h-28 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#090a0f] p-2 text-[10px] font-mono text-zinc-400"
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
};
