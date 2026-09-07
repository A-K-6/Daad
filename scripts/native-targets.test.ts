import { describe, expect, it } from 'vitest';
import { nativeTargets, resolveTarget } from './native-targets';

describe('native build targets', () => {
  it('keeps Apple device and simulator builds separate despite the same CPU', () => {
    const device = nativeTargets[resolveTarget('aarch64-apple-ios')];
    const simulator = nativeTargets[resolveTarget('aarch64-apple-ios-sim')];
    expect(device.arch).toBe(simulator.arch);
    expect(device.sdk).toBe('iphoneos');
    expect(simulator.sdk).toBe('iphonesimulator');
    expect(device.ssl).not.toBe(simulator.ssl);
  });
  it('rejects unknown and inherited keys before building or downloading', () => {
    for (const target of ['', '../host', 'x86_64-pc-windows-gnu', 'constructor', 'toString']) {
      expect(() => resolveTarget(target)).toThrow('Unsupported native target');
    }
  });
  it('maps Android ABIs explicitly and Windows ARM64 to the MSVC platform', () => {
    expect(nativeTargets['armv7-linux-androideabi'].abi).toBe('armeabi-v7a');
    expect(nativeTargets['aarch64-linux-android'].abi).toBe('arm64-v8a');
    expect(nativeTargets['aarch64-pc-windows-msvc'].vs).toBe('ARM64');
  });
});
