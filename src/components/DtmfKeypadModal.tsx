import React from 'react';
import { X } from 'lucide-react';
import { soundService } from '../services/soundService';

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
    <div className="absolute inset-0 bg-[#0f1117]/95 backdrop-blur-md z-30 flex flex-col justify-between p-6 select-none animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center justify-between pb-2 border-b border-[#232838]">
        <h3 className="text-sm font-semibold text-zinc-200">DTMF Keypad</h3>
        <button
          onClick={onClose}
          className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-[#1e2334] rounded-lg transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 my-auto max-w-[260px] mx-auto w-full">
        {DTMF_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => handleKeyClick(key)}
            className="flex items-center justify-center h-14 rounded-2xl bg-[#181c28] hover:bg-[#222738] active:bg-[#2c334a] border border-[#252b3d] text-xl font-medium text-zinc-100 hover:text-emerald-400 transition-all active:scale-95 shadow-sm"
          >
            {key}
          </button>
        ))}
      </div>

      <button
        onClick={onClose}
        className="w-full py-2.5 rounded-xl bg-[#181c28] hover:bg-[#202536] text-zinc-300 font-medium text-xs border border-[#252b3d] transition-colors"
      >
        Done
      </button>
    </div>
  );
};
