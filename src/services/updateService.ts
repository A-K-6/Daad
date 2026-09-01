export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseNotes: string;
  publishedAt: string;
  releaseUrl: string;
  downloadUrl?: string;
}

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'ready' | 'error';

class UpdateService {
  private currentVersion = '0.1.2';
  private repo = 'A-K-6/Daad';
  private status: UpdateStatus = 'idle';
  private updateInfo: UpdateInfo | null = null;
  private errorMessage: string | null = null;
  private progress: number = 0;
  private listeners: Set<() => void> = new Set();

  public getCurrentVersion(): string {
    return this.currentVersion;
  }

  public getStatus(): UpdateStatus {
    return this.status;
  }

  public getUpdateInfo(): UpdateInfo | null {
    return this.updateInfo;
  }

  public getErrorMessage(): string | null {
    return this.errorMessage;
  }

  public getProgress(): number {
    return this.progress;
  }

  public onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  public async checkForUpdates(): Promise<UpdateInfo | null> {
    this.status = 'checking';
    this.errorMessage = null;
    this.notify();

    try {
      // 1. Try native Tauri updater if available
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        try {
          const { check } = await import('@tauri-apps/plugin-updater');
          const update = await check();
          if (update) {
            this.updateInfo = {
              currentVersion: update.currentVersion,
              latestVersion: update.version,
              hasUpdate: true,
              releaseNotes: update.body || 'New features and bug fixes.',
              publishedAt: update.date || new Date().toISOString(),
              releaseUrl: `https://github.com/${this.repo}/releases/tag/v${update.version}`,
            };
            this.status = 'available';
            this.notify();
            return this.updateInfo;
          }
        } catch (tauriErr) {
          console.log('Tauri updater check skipped/fallback:', tauriErr);
        }
      }

      // 2. Fetch directly from GitHub Releases API
      const res = await fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github.v3+json' },
      });

      if (!res.ok) {
        throw new Error(`GitHub Releases error: HTTP ${res.status}`);
      }

      const data = await res.json();
      const latestTag = (data.tag_name || '').replace(/^v/, '');
      const hasUpdate = this.compareVersions(latestTag, this.currentVersion) > 0;

      this.updateInfo = {
        currentVersion: this.currentVersion,
        latestVersion: latestTag || this.currentVersion,
        hasUpdate,
        releaseNotes: data.body || 'No release notes provided.',
        publishedAt: data.published_at || new Date().toISOString(),
        releaseUrl: data.html_url || `https://github.com/${this.repo}/releases`,
        downloadUrl: data.assets?.[0]?.browser_download_url,
      };

      this.status = hasUpdate ? 'available' : 'up-to-date';
      this.notify();
      return this.updateInfo;
    } catch (err: unknown) {
      console.warn('Check for updates failed:', err);
      this.status = 'error';
      this.errorMessage = err instanceof Error ? err.message : 'Failed to check for updates';
      this.notify();
      return null;
    }
  }

  public async installUpdate(): Promise<void> {
    if (this.status !== 'available' || !this.updateInfo) return;

    this.status = 'downloading';
    this.progress = 0;
    this.notify();

    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const { check } = await import('@tauri-apps/plugin-updater');
        const { relaunch } = await import('@tauri-apps/plugin-process');
        const update = await check();

        if (update) {
          let downloaded = 0;
          let contentLength = 0;

          await update.downloadAndInstall((event) => {
            switch (event.event) {
              case 'Started':
                contentLength = event.data.contentLength || 0;
                break;
              case 'Progress':
                downloaded += event.data.chunkLength;
                if (contentLength > 0) {
                  this.progress = Math.round((downloaded / contentLength) * 100);
                  this.notify();
                }
                break;
              case 'Finished':
                this.status = 'ready';
                this.notify();
                break;
            }
          });

          await relaunch();
          return;
        }
      }

      // Fallback: Open GitHub Release page
      window.open(this.updateInfo.releaseUrl, '_blank');
      this.status = 'ready';
      this.notify();
    } catch (err: unknown) {
      console.error('Install update failed:', err);
      this.status = 'error';
      this.errorMessage = err instanceof Error ? err.message : 'Failed to download update';
      this.notify();
    }
  }

  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map((n) => parseInt(n, 10) || 0);
    const parts2 = v2.split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < len; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }
}

export const updateService = new UpdateService();
