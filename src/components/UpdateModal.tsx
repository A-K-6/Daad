import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Sparkles, CheckCircle2, AlertTriangle, ExternalLink, Download } from 'lucide-react';
import { updateService, UpdateStatus, UpdateInfo } from '../services/updateService';

interface UpdateModalProps {
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ onClose }) => {
  const [status, setStatus] = useState<UpdateStatus>(updateService.getStatus());
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(updateService.getUpdateInfo());
  const [errorMessage, setErrorMessage] = useState<string | null>(updateService.getErrorMessage());
  const [progress, setProgress] = useState<number>(updateService.getProgress());

  useEffect(() => {
    const unsub = updateService.onChange(() => {
      setStatus(updateService.getStatus());
      setUpdateInfo(updateService.getUpdateInfo());
      setErrorMessage(updateService.getErrorMessage());
      setProgress(updateService.getProgress());
    });

    if (status === 'idle') {
      updateService.checkForUpdates();
    }

    return unsub;
  }, [status]);

  const handleCheckNow = () => {
    updateService.checkForUpdates();
  };

  const handleInstall = () => {
    updateService.installUpdate();
  };

  return (
    <div className="absolute inset-0 z-50 bg-[#0f1117]/95 backdrop-blur-md flex flex-col justify-between p-4 select-none animate-in fade-in zoom-in-95 duration-150">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#232838]">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Software Update</h2>
            <p className="text-[10px] text-zinc-400">Current version v{updateService.getCurrentVersion()}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-[#1e2334] rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Content */}
      <div className="my-auto py-4 flex flex-col items-center justify-center text-center space-y-3">
        {status === 'checking' && (
          <div className="space-y-3">
            <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto" />
            <p className="text-xs text-zinc-300 font-medium">Checking GitHub for latest release...</p>
          </div>
        )}

        {status === 'available' && updateInfo && (
          <div className="w-full space-y-3 text-left">
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400">
                  Update Available: v{updateInfo.latestVersion}
                </span>
                <span className="text-[10px] text-zinc-400">
                  {new Date(updateInfo.publishedAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-[11px] text-zinc-300 mt-1">
                A new version of Daad is ready to install.
              </p>
            </div>

            {updateInfo.releaseNotes && (
              <div className="p-2.5 rounded-xl bg-[#141824] border border-[#232838] max-h-36 overflow-y-auto">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
                  Release Notes
                </span>
                <p className="text-[11px] text-zinc-300 whitespace-pre-line font-mono">
                  {updateInfo.releaseNotes}
                </p>
              </div>
            )}
          </div>
        )}

        {status === 'downloading' && (
          <div className="w-full space-y-3">
            <Download className="w-8 h-8 text-emerald-400 animate-bounce mx-auto" />
            <p className="text-xs text-zinc-200 font-medium">Downloading update... {progress}%</p>
            <div className="w-full bg-[#181c28] h-2 rounded-full overflow-hidden border border-[#252b3d]">
              <div
                className="bg-emerald-500 h-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {status === 'up-to-date' && (
          <div className="space-y-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
            <h3 className="text-sm font-semibold text-zinc-100">You're Up to Date!</h3>
            <p className="text-xs text-zinc-400 max-w-[240px]">
              Daad v{updateService.getCurrentVersion()} is currently the newest version available.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-2">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
            <h3 className="text-xs font-semibold text-zinc-200">Unable to check updates</h3>
            <p className="text-[11px] text-zinc-400 max-w-[240px]">
              {errorMessage || 'Could not connect to GitHub Releases'}
            </p>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="pt-3 border-t border-[#232838] flex items-center space-x-2">
        {status === 'available' ? (
          <>
            <a
              href={updateInfo?.releaseUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded-lg bg-[#181c28] hover:bg-[#22283a] text-zinc-300 border border-[#252b3d] text-xs flex items-center space-x-1 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Notes</span>
            </a>
            <button
              onClick={handleInstall}
              className="flex-1 py-2 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs shadow-md shadow-emerald-500/20 transition-all active:scale-[0.98] flex items-center justify-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Update & Restart</span>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleCheckNow}
              disabled={status === 'checking'}
              className="flex-1 py-2 px-3 rounded-lg bg-[#181c28] hover:bg-[#22283a] disabled:opacity-50 text-zinc-200 border border-[#252b3d] font-medium text-xs flex items-center justify-center space-x-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${status === 'checking' ? 'animate-spin' : ''}`} />
              <span>Check Again</span>
            </button>
            <button
              onClick={onClose}
              className="py-2 px-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-xs transition-colors"
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
};
