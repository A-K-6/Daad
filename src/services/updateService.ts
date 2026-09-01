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
      // Fetch directly from GitHub Releases API
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
        downloadUrl: data.assets?.[0]?.browser_download_url || data.html_url,
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

    this.status = 'ready';
    this.notify();

    const targetUrl = this.updateInfo.downloadUrl || this.updateInfo.releaseUrl;
    if (targetUrl) {
      window.open(targetUrl, '_blank');
    }
  }

  private compareVersions(v1: string, v2: string): number {
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
