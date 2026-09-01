import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateService } from './updateService';

describe('UpdateService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns current version', () => {
    expect(updateService.getCurrentVersion()).toBe('0.2.0');
  });

  it('detects when an update is available from GitHub API', async () => {
    const mockRelease = {
      tag_name: 'v0.3.0',
      body: 'Exciting new features and fixes',
      published_at: '2026-09-02T00:00:00Z',
      html_url: 'https://github.com/A-K-6/Daad/releases/tag/v0.3.0',
      assets: [{ browser_download_url: 'https://github.com/A-K-6/Daad/releases/download/v0.3.0/Daad.dmg' }],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRelease,
    } as any);

    const info = await updateService.checkForUpdates();
    expect(info).not.toBeNull();
    expect(info?.hasUpdate).toBe(true);
    expect(info?.latestVersion).toBe('0.3.0');
    expect(info?.releaseNotes).toBe('Exciting new features and fixes');
    expect(updateService.getStatus()).toBe('available');
  });

  it('detects when app is up-to-date', async () => {
    const mockRelease = {
      tag_name: 'v0.2.0',
      body: 'Latest release',
      published_at: '2026-09-02T00:00:00Z',
      html_url: 'https://github.com/A-K-6/Daad/releases/tag/v0.2.0',
      assets: [],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRelease,
    } as any);

    const info = await updateService.checkForUpdates();
    expect(info).not.toBeNull();
    expect(info?.hasUpdate).toBe(false);
    expect(updateService.getStatus()).toBe('up-to-date');
  });
});
