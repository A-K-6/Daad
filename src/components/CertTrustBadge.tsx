import React from 'react';
import { ShieldCheck, ShieldAlert, ShieldQuestion, ShieldX } from 'lucide-react';
import type { CertTrustStatus } from '@/types';

interface CertTrustBadgeProps {
  status: CertTrustStatus;
}

const META: Record<CertTrustStatus, { label: string; cls: string }> = {
  verified: { label: 'TLS verified', cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  'self-signed': { label: 'Self-signed cert', cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  failed: { label: 'Cert failure', cls: 'text-rose-400 border-rose-500/30 bg-rose-500/10' },
  unknown: { label: 'Cert unknown', cls: 'text-zinc-400 border-white/[0.08] bg-white/[0.03]' },
  'not-applicable': { label: 'No TLS', cls: 'text-zinc-400 border-white/[0.08] bg-white/[0.03]' },
};

export const CertTrustBadge: React.FC<CertTrustBadgeProps> = ({ status }) => {
  const meta = META[status] || META.unknown;
  const Icon =
    status === 'verified'
      ? ShieldCheck
      : status === 'failed'
        ? ShieldX
        : status === 'self-signed'
          ? ShieldAlert
          : ShieldQuestion;
  return (
    <span
      data-testid="cert-trust-badge"
      data-status={status}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-mono ${meta.cls}`}
    >
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
};
