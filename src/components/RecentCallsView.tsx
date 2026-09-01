import React from 'react';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, Trash2 } from 'lucide-react';
import { CallRecord } from '../types/callHistory';

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
      return <PhoneMissed className="w-4 h-4 text-rose-400" />;
    }
    if (record.direction === 'incoming') {
      return <PhoneIncoming className="w-4 h-4 text-emerald-400" />;
    }
    return <PhoneOutgoing className="w-4 h-4 text-sky-400" />;
  };

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center select-none">
        <div className="w-12 h-12 rounded-2xl bg-[#161a26] border border-[#232838] flex items-center justify-center text-zinc-500 mb-3">
          <Phone className="w-6 h-6" />
        </div>
        <p className="text-sm font-medium text-zinc-300">No Recent Calls</p>
        <p className="text-xs text-zinc-500 mt-1">Calls you make and receive will appear here</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full justify-between p-3 select-none overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          History ({records.length})
        </span>
        <button
          onClick={onClear}
          className="flex items-center space-x-1 text-[11px] text-zinc-500 hover:text-rose-400 transition-colors"
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
            className="flex items-center justify-between p-2.5 rounded-xl bg-[#141824] hover:bg-[#1c2234] border border-[#232838] cursor-pointer transition-all active:scale-[0.99] group"
          >
            <div className="flex items-center space-x-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[#1a1f2e] border border-[#252b3d] flex items-center justify-center shrink-0">
                {getCallIcon(record)}
              </div>
              <div className="min-w-0">
                <h4 className={`text-xs font-semibold truncate ${record.status === 'missed' ? 'text-rose-400' : 'text-zinc-200'}`}>
                  {record.displayName || record.target}
                </h4>
                <div className="flex items-center space-x-2 text-[10px] text-zinc-500">
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
              className="p-2 rounded-lg text-zinc-500 group-hover:text-emerald-400 group-hover:bg-emerald-500/10 transition-colors"
              title={`Call ${record.target}`}
            >
              <Phone className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
