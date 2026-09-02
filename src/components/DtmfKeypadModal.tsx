import React from 'react';
import { X } from 'lucide-react';
import { soundService } from '@/services';
import { Button } from '@fluentui/react-components';

interface DtmfKeypadModalProps {
  onSendTone: (tone: string) => void;
  onClose: () => void;
}

const DTMF_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

export const DtmfKeypadModal: React.FC<DtmfKeypadModalProps> = ({
  onSendTone,
  onClose,
}) => {
  const handleKeyClick = (key: string) => {
    soundService.playDtmf(key);
    onSendTone(key);
  };

  return (
    <div className="absolute inset-0 bg-[var(--surface-1)] backdrop-blur-md z-30 flex flex-col justify-between p-6 select-none">
      <div className="flex items-center justify-between pb-2 border-b border-[var(--stroke-2)]">
        <h3 className="text-base font-semibold text-[var(--fg-1)]">DTMF Keypad</h3>
        <button
          onClick={onClose}
          className="p-1.5 text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--surface-4)] rounded-md transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 my-auto max-w-[260px] mx-auto w-full">
        {DTMF_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => handleKeyClick(key)}
            className="flex items-center justify-center h-14 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-4)] active:bg-[var(--surface-4)] border border-[var(--stroke-2)] text-xl font-medium text-[var(--fg-1)] hover:text-[var(--accent)] transition-all active:scale-95 shadow-[var(--shadow-2)]"
          >
            {key}
          </button>
        ))}
      </div>

      <Button
        onClick={onClose}
        appearance="secondary"
        style={{ width: '100%', marginTop: '0.5rem', fontWeight: 500, fontSize: 13 }}
      >
        Done
      </Button>
    </div>
  );
};
