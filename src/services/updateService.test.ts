import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateService } from './updateService';

describe('UpdateService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns current version string', () => {
    const version = updateService.getCurrentVersion();
    expect(typeof version).toBe('string');
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('detects when an update is available from GitHub API', async () => {
    const mockRelease = {
      tag_name: 'v99.0.0',
      body: 'Exciting new features and fixes',
      published_at: '2026-09-02T00:00:00Z',
      html_url: 'https://github.com/A-K-6/Daad/releases/tag/v99.0.0',
      assets: [{ browser_download_url: 'https://github.com/A-K-6/Daad/releases/download/v99.0.0/Daad.dmg' }],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRelease,
    } as any);

    const info = await updateService.checkForUpdates();
    expect(info).not.toBeNull();
    expect(info?.hasUpdate).toBe(true);
    expect(info?.latestVersion).toBe('99.0.0');
    expect(info?.releaseNotes).toBe('Exciting new features and fixes');
    expect(updateService.getStatus()).toBe('available');
  });

  it('detects when app is up-to-date', async () => {
    const currentVer = updateService.getCurrentVersion();
    const mockRelease = {
      tag_name: `v${currentVer}`,
      body: 'Latest release',
      published_at: '2026-09-02T00:00:00Z',
      html_url: `https://github.com/A-K-6/Daad/releases/tag/v${currentVer}`,
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
