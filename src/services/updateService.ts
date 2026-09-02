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

/**
 * Open external URL safely in the system default browser or file handler.
 * In desktop Tauri, invokes the native `open_url` command; in web, uses window.open.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!url) return;
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_url', { url });
      return;
    } catch (err) {
      console.warn('Tauri open_url failed, falling back to window.open:', err);
    }
  }

  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

class UpdateService {
  private currentVersion = '0.4.0';
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
      let releaseData: any = null;

      // 1. Try /releases/latest endpoint
      try {
        const latestRes = await fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, {
          headers: { Accept: 'application/vnd.github.v3+json' },
        });
        if (latestRes.ok) {
          releaseData = await latestRes.json();
        }
      } catch (_) {}

      // 2. Try /releases list endpoint
      if (!releaseData) {
        try {
          const res = await fetch(`https://api.github.com/repos/${this.repo}/releases`, {
            headers: { Accept: 'application/vnd.github.v3+json' },
          });
          if (res.ok) {
            const list = await res.json();
            if (Array.isArray(list) && list.length > 0) {
              releaseData = list.find((r: any) => !r.draft && !r.prerelease) || list[0];
            }
          }
        } catch (_) {}
      }

      // 3. Fallback to raw package.json if GitHub API hits rate limit (403)
      if (!releaseData) {
        try {
          const rawRes = await fetch(`https://raw.githubusercontent.com/${this.repo}/main/package.json`);
          if (rawRes.ok) {
            const pkg = await rawRes.json();
            if (pkg.version) {
              releaseData = {
                tag_name: `v${pkg.version}`,
                name: `Daad Softphone v${pkg.version}`,
                body: 'A new version of Daad Softphone is available on GitHub.',
                published_at: new Date().toISOString(),
                html_url: `https://github.com/${this.repo}/releases`,
                assets: [],
              };
            }
          }
        } catch (_) {}
      }

      if (!releaseData) {
        throw new Error('Unable to fetch release information from GitHub.');
      }

      const latestTag = (releaseData.tag_name || '').replace(/^v/, '');
      const hasUpdate = this.compareVersions(latestTag, this.currentVersion) > 0;

      // Match platform download asset with exact priority
      const assets = releaseData.assets || [];
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      const isMac = /Mac|iPhone|iPad/i.test(userAgent);
      const isWindows = /Win/i.test(userAgent);

      let matchedAsset: any = null;
      if (isMac) {
        matchedAsset =
          assets.find((a: any) => (a?.name || '').toLowerCase().endsWith('.dmg')) ||
          assets.find((a: any) => (a?.name || '').toLowerCase().endsWith('.pkg')) ||
          assets.find((a: any) => (a?.name || '').toLowerCase().endsWith('.app.tar.gz'));
      } else if (isWindows) {
        matchedAsset =
          assets.find((a: any) => (a?.name || '').toLowerCase().endsWith('-setup.exe')) ||
          assets.find((a: any) => (a?.name || '').toLowerCase().endsWith('.exe')) ||
          assets.find((a: any) => (a?.name || '').toLowerCase().endsWith('.msi'));
      } else {
        matchedAsset =
          assets.find((a: any) => (a?.name || '').toLowerCase().endsWith('.appimage')) ||
          assets.find((a: any) => (a?.name || '').toLowerCase().endsWith('.deb')) ||
          assets.find((a: any) => (a?.name || '').toLowerCase().endsWith('.rpm'));
      }

      if (!matchedAsset && assets.length > 0) {
        matchedAsset = assets[0];
      }

      this.updateInfo = {
        currentVersion: this.currentVersion,
        latestVersion: latestTag || this.currentVersion,
        hasUpdate,
        releaseNotes: releaseData.body || 'No release notes provided.',
        publishedAt: releaseData.published_at || releaseData.created_at || new Date().toISOString(),
        releaseUrl: releaseData.html_url || `https://github.com/${this.repo}/releases`,
        downloadUrl: matchedAsset?.browser_download_url || releaseData.html_url,
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
    if (!this.updateInfo) return;

    this.status = 'ready';
    this.notify();

    const targetUrl = this.updateInfo.downloadUrl || this.updateInfo.releaseUrl;
    if (targetUrl) {
      await openExternalUrl(targetUrl);
    }
  }

  public compareVersions(v1: string, v2: string): number {
    const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
    const p1 = parse(v1);
    const p2 = parse(v2);

    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const num1 = p1[i] || 0;
      const num2 = p2[i] || 0;
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }
    return 0;
  }
}

export const updateService = new UpdateService();

