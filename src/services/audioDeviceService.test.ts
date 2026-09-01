import { describe, it, expect } from 'vitest';
import { audioDeviceService } from './audioDeviceService';

describe('AudioDeviceService', () => {
  it('saves and retrieves selected input device ID', () => {
    audioDeviceService.setInputDevice('mic_123');
    expect(audioDeviceService.getSelectedInputId()).toBe('mic_123');

    const constraints = audioDeviceService.getAudioConstraints();
    expect(constraints).toEqual({ deviceId: { exact: 'mic_123' } });
  });

  it('saves and retrieves selected output device ID', async () => {
    await audioDeviceService.setOutputDevice('speaker_456');
    expect(audioDeviceService.getSelectedOutputId()).toBe('speaker_456');
  });

  it('handles empty device selection with default boolean constraint', () => {
    audioDeviceService.setInputDevice('');
    expect(audioDeviceService.getAudioConstraints()).toBe(true);
  });
});
