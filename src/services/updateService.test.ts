import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectReleaseAsset, updateService } from './updateService';

describe('UpdateService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns current version string', () => {
    const version = updateService.getCurrentVersion();
    expect(typeof version).toBe('string');
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
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


describe('platform release downloads', () => {
  const assets = ['SHA256SUMS.txt', 'Daad_source.tar.gz', 'Daad_arm64.dmg', 'Daad_x64.dmg',
    'Daad_arm64-setup.exe', 'Daad_x64-setup.exe', 'Daad_arm64.AppImage', 'Daad_amd64.deb',
    'app-arm64-v8a-debug.apk'].map(name => ({ name, browser_download_url: `https://example.com/${name}` }));
  it('selects the actual CPU instead of relying on a MacIntel browser user agent', () => {
    expect(selectReleaseAsset(assets, { os: 'macos', arch: 'x86_64' })?.name).toBe('Daad_x64.dmg');
    expect(selectReleaseAsset(assets, { os: 'macos', arch: 'aarch64' })?.name).toBe('Daad_arm64.dmg');
    expect(selectReleaseAsset(assets, { os: 'windows', arch: 'aarch64' })?.name).toBe('Daad_arm64-setup.exe');
    expect(selectReleaseAsset(assets, { os: 'linux', arch: 'x86_64' })?.name).toBe('Daad_amd64.deb');
  });
  it('never offers desktop binaries to mobile devices', () => {
    expect(selectReleaseAsset(assets, { os: 'ios', arch: 'aarch64' })).toBeUndefined();
    expect(selectReleaseAsset(assets, { os: 'android', arch: 'aarch64' })?.name).toBe('app-arm64-v8a-debug.apk');
    expect(selectReleaseAsset(assets.filter(a => !a.name.endsWith('.apk')), { os: 'android', arch: 'aarch64' })).toBeUndefined();
  });
  it('never falls back to source archives, checksum files, or a different CPU', () => {
    expect(selectReleaseAsset(assets)).toBeUndefined();
    expect(selectReleaseAsset(assets, { os: 'macos', arch: 'unknown' })).toBeUndefined();
    expect(selectReleaseAsset(assets, { os: 'windows', arch: 'arm' })).toBeUndefined();
  });
});
