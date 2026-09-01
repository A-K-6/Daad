export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

const INPUT_KEY = 'daad_audio_input_id';
const OUTPUT_KEY = 'daad_audio_output_id';

class AudioDeviceService {
  private inputDevices: AudioDevice[] = [];
  private outputDevices: AudioDevice[] = [];
  private selectedInputId: string = '';
  private selectedOutputId: string = '';
  private listeners: Set<() => void> = new Set();

  constructor() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem) {
        this.selectedInputId = localStorage.getItem(INPUT_KEY) || '';
        this.selectedOutputId = localStorage.getItem(OUTPUT_KEY) || '';
      }
    } catch (e) {
      console.warn('LocalStorage unavailable for audio devices:', e);
    }

    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        this.refreshDevices();
      });
    }
  }

  public async refreshDevices(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.inputDevices = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${index + 1}`,
          kind: d.kind,
        }));

      this.outputDevices = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Speaker ${index + 1}`,
          kind: d.kind,
        }));

      this.notify();
    } catch (e) {
      console.warn('Failed to enumerate audio devices:', e);
    }
  }

  public getInputDevices(): AudioDevice[] {
    return this.inputDevices;
  }

  public getOutputDevices(): AudioDevice[] {
    return this.outputDevices;
  }

  public getSelectedInputId(): string {
    return this.selectedInputId;
  }

  public getSelectedOutputId(): string {
    return this.selectedOutputId;
  }

  public setInputDevice(deviceId: string): void {
    this.selectedInputId = deviceId;
    localStorage.setItem(INPUT_KEY, deviceId);
    this.notify();
  }

  public async setOutputDevice(deviceId: string): Promise<void> {
    this.selectedOutputId = deviceId;
    localStorage.setItem(OUTPUT_KEY, deviceId);

    const audioElement = document.getElementById('remoteAudio') as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (audioElement && typeof audioElement.setSinkId === 'function') {
      try {
        await audioElement.setSinkId(deviceId);
      } catch (e) {
        console.warn('Failed to set audio sink ID:', e);
      }
    }

    this.notify();
  }

  public getAudioConstraints(): MediaTrackConstraints | boolean {
    if (this.selectedInputId) {
      return { deviceId: { exact: this.selectedInputId } };
    }
    return true;
  }

  public onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}

export const audioDeviceService = new AudioDeviceService();
