import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Sparkles, CheckCircle2, AlertTriangle, ExternalLink, Download } from 'lucide-react';
import { updateService, UpdateStatus, UpdateInfo } from '@/services/updateService';
import { Button } from '@fluentui/react-components';

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
    <div className="absolute inset-0 z-50 bg-[var(--surface-1)]/95 backdrop-blur-md flex flex-col justify-between p-4 select-none">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[var(--stroke-2)]">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-md bg-[var(--accent-subtle)] flex items-center justify-center text-[var(--accent)]">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--fg-1)]">Software Update</h2>
            <p className="text-[11px] text-[var(--fg-3)]">Current version v{updateService.getCurrentVersion()}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--surface-4)] rounded-md transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Content */}
      <div className="my-auto py-4 flex flex-col items-center justify-center text-center space-y-3">
        {status === 'checking' && (
          <div className="space-y-3">
            <RefreshCw className="w-8 h-8 text-[var(--accent)] animate-spin mx-auto" />
            <p className="text-sm text-[var(--fg-2)] font-medium">Checking GitHub for latest release...</p>
          </div>
        )}

        {status === 'available' && updateInfo && (
          <div className="w-full space-y-3 text-left">
            <div className="p-3 rounded-md bg-[var(--accent-subtle)]">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-[var(--accent)]">
                  Update Available: v{updateInfo.latestVersion}
                </span>
                <span className="text-[11px] text-[var(--fg-3)]">
                  {new Date(updateInfo.publishedAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-[12px] text-[var(--fg-2)] mt-1">
                A new version of Daad is ready to install.
              </p>
            </div>

            {updateInfo.releaseNotes && (
              <div className="p-2.5 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] max-h-36 overflow-y-auto">
                <span className="text-[11px] font-semibold text-[var(--fg-3)] uppercase tracking-wider block mb-1">
                  Release Notes
                </span>
                <p className="text-[12px] text-[var(--fg-2)] whitespace-pre-line font-mono">
                  {updateInfo.releaseNotes}
                </p>
              </div>
            )}
          </div>
        )}

        {status === 'downloading' && (
          <div className="w-full space-y-3">
            <Download className="w-8 h-8 text-[var(--accent)] animate-bounce mx-auto" />
            <p className="text-sm text-[var(--fg-1)] font-medium">Downloading update... {progress}%</p>
            <div className="w-full bg-[var(--surface-4)] h-2 rounded-full overflow-hidden border border-[var(--stroke-2)]">
              <div
                className="bg-[var(--accent)] h-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {status === 'up-to-date' && (
          <div className="space-y-2">
            <CheckCircle2 className="w-10 h-10 text-[var(--success-fg)] mx-auto" />
            <h3 className="text-sm font-semibold text-[var(--fg-1)]">You're Up to Date!</h3>
            <p className="text-xs text-[var(--fg-3)] max-w-[240px]">
              Daad v{updateService.getCurrentVersion()} is currently the newest version available.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-2">
            <AlertTriangle className="w-8 h-8 text-[var(--warning-fg)] mx-auto" />
            <h3 className="text-sm font-semibold text-[var(--fg-2)]">Unable to check updates</h3>
            <p className="text-[12px] text-[var(--fg-3)] max-w-[240px]">
              {errorMessage || 'Could not connect to GitHub Releases'}
            </p>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="pt-3 border-t border-[var(--stroke-2)] flex items-center space-x-2">
        {status === 'available' ? (
          <>
            <Button
              appearance="secondary"
              as="a"
              href={updateInfo?.releaseUrl}
              target="_blank"
              rel="noreferrer"
              icon={{ children: <ExternalLink className="w-3.5 h-3.5" /> }}
            >
              Notes
            </Button>
            <Button
              appearance="primary"
              onClick={handleInstall}
              style={{ flex: 1, fontWeight: 600 }}
              icon={{ children: <Download className="w-3.5 h-3.5" /> }}
            >
              Update & Restart
            </Button>
          </>
        ) : (
          <>
            <Button
              appearance="secondary"
              onClick={handleCheckNow}
              disabled={status === 'checking'}
              style={{ flex: 1, fontWeight: 500 }}
              icon={{ children: <RefreshCw className={`w-3.5 h-3.5 ${status === 'checking' ? 'animate-spin' : ''}`} /> }}
            >
              Check Again
            </Button>
            <Button
              appearance="secondary"
              onClick={onClose}
              style={{ fontWeight: 500 }}
            >
              Done
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
