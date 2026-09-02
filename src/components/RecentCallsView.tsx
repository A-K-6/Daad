import React from 'react';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, Trash2 } from 'lucide-react';
import { CallRecord } from '@/types';

interface RecentCallsViewProps {
  records: CallRecord[];
  onCall: (target: string) => void;
  onClear: () => void;
}

export const RecentCallsView: React.FC<RecentCallsViewProps> = ({
  records,
  onCall,
  onClear,
}) => {
  const formatTimeAgo = (timestamp: number): string => {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const formatDuration = (seconds: number): string => {
    if (seconds === 0) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getCallIcon = (record: CallRecord) => {
    if (record.status === 'missed') {
      return <PhoneMissed className="w-3.5 h-3.5 text-[var(--danger-fg)]" />;
    }
    if (record.direction === 'incoming') {
      return <PhoneIncoming className="w-3.5 h-3.5 text-[var(--success-fg)]" />;
    }
    return <PhoneOutgoing className="w-3.5 h-3.5 text-[var(--info-fg)]" />;
  };

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center select-none bg-[var(--surface-1)]">
        <div className="w-10 h-10 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] flex items-center justify-center text-[var(--fg-3)] mb-2.5">
          <Phone className="w-5 h-5" />
        </div>
        <p className="text-sm font-medium text-[var(--fg-1)]">No Recent Calls</p>
        <p className="text-[12px] text-[var(--fg-3)] mt-0.5">Calls you make and receive will appear here</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full justify-between p-3 select-none overflow-hidden bg-[var(--surface-1)]">
      <div className="flex items-center justify-between px-2 py-1 mb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-3)]">
          History ({records.length})
        </span>
        <button
          onClick={onClear}
          className="flex items-center space-x-1 text-[11px] text-[var(--fg-3)] hover:text-[var(--danger-fg)] transition-colors"
          title="Clear History"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {records.map((record) => (
          <div
            key={record.id}
            onClick={() => onCall(record.target)}
            className="flex items-center justify-between p-2.5 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border border-[var(--stroke-2)] hover:border-[var(--stroke-1)] cursor-pointer transition-all active:scale-[0.99] group"
          >
            <div className="flex items-center space-x-2.5 min-w-0">
              <div className="w-7 h-7 rounded-md bg-[var(--surface-1)] border border-[var(--stroke-2)] flex items-center justify-center shrink-0">
                {getCallIcon(record)}
              </div>
              <div className="min-w-0">
                <h4 className={`text-sm font-medium truncate ${record.status === 'missed' ? 'text-[var(--danger-fg)]' : 'text-[var(--fg-1)]'}`}>
                  {record.displayName || record.target}
                </h4>
                <div className="flex items-center space-x-1.5 text-[11px] text-[var(--fg-3)] font-mono">
                  <span>{formatTimeAgo(record.timestamp)}</span>
                  {record.duration > 0 && (
                    <>
                      <span>•</span>
                      <span>{formatDuration(record.duration)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onCall(record.target);
              }}
              className="p-1.5 rounded-md text-[var(--fg-3)] group-hover:text-[var(--accent)] group-hover:bg-[var(--accent-subtle)] transition-colors"
              title={`Call ${record.target}`}
            >
              <Phone className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
