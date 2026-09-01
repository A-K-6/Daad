// Web Audio API synthesizer for DTMF tones, ringback, and ringtones

const DTMF_FREQUENCIES: Record<string, [number, number]> = {
  '1': [697, 1209],
  '2': [697, 1336],
  '3': [697, 1477],
  'A': [697, 1633],
  '4': [770, 1209],
  '5': [770, 1336],
  '6': [770, 1477],
  'B': [770, 1633],
  '7': [852, 1209],
  '8': [852, 1336],
  '9': [852, 1477],
  'C': [852, 1633],
  '*': [941, 1209],
  '0': [941, 1336],
  '#': [941, 1477],
  'D': [941, 1633],
};

class SoundService {
  private audioCtx: AudioContext | null = null;
  private ringbackInterval: number | null = null;
  private ringtoneInterval: number | null = null;
  private activeToneOscillators: OscillatorNode[] = [];

  private getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Play a dual-frequency DTMF tone for a given key
   */
  playDtmf(key: string, durationMs: number = 180) {
    const freqs = DTMF_FREQUENCIES[key.toUpperCase()];
    if (!freqs) return;

    try {
      const ctx = this.getAudioContext();
      const [freq1, freq2] = freqs;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(freq1, ctx.currentTime);
      osc2.frequency.setValueAtTime(freq2, ctx.currentTime);

      // Smooth attack and release to prevent audio clicking
      gainNode.gain.setValueAtTime(0.001, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (durationMs / 1000));

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(ctx.currentTime);
      osc2.start(ctx.currentTime);

      const stopTime = ctx.currentTime + (durationMs / 1000);
      osc1.stop(stopTime);
      osc2.stop(stopTime);
    } catch (e) {
      console.warn('Audio tone error:', e);
    }
  }

  /**
   * Start European/North American standard ringback tone (440Hz + 480Hz)
   */
  startRingback() {
    this.stopRingback();
    const playBurst = () => {
      try {
        const ctx = this.getAudioContext();
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(440, ctx.currentTime);
        osc2.frequency.setValueAtTime(480, ctx.currentTime);

        gainNode.gain.setValueAtTime(0.001, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.05);
        gainNode.gain.setValueAtTime(0.08, ctx.currentTime + 1.8);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.0);

        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc1.start(ctx.currentTime);
        osc2.start(ctx.currentTime);

        const stopTime = ctx.currentTime + 2.0;
        osc1.stop(stopTime);
        osc2.stop(stopTime);
      } catch (e) {
        console.warn('Ringback error:', e);
      }
    };

    playBurst();
    this.ringbackInterval = window.setInterval(playBurst, 4000);
  }

  stopRingback() {
    if (this.ringbackInterval !== null) {
      clearInterval(this.ringbackInterval);
      this.ringbackInterval = null;
    }
  }

  /**
   * Start ringing sound for incoming calls
   */
  startRingtone() {
    this.stopRingtone();
    const playRingtoneBurst = () => {
      try {
        const ctx = this.getAudioContext();
        const tones = [
          { f1: 523.25, f2: 659.25, start: 0.0, dur: 0.25 }, // C5 + E5
          { f1: 659.25, f2: 783.99, start: 0.3, dur: 0.25 }, // E5 + G5
          { f1: 783.99, f2: 1046.50, start: 0.6, dur: 0.4 }, // G5 + C6
        ];

        tones.forEach(({ f1, f2, start, dur }) => {
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const gain = ctx.createGain();

          osc1.type = 'sine';
          osc2.type = 'sine';
          osc1.frequency.setValueAtTime(f1, ctx.currentTime + start);
          osc2.frequency.setValueAtTime(f2, ctx.currentTime + start);

          gain.gain.setValueAtTime(0.001, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + start + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);

          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(ctx.destination);

          osc1.start(ctx.currentTime + start);
          osc2.start(ctx.currentTime + start);
          osc1.stop(ctx.currentTime + start + dur);
          osc2.stop(ctx.currentTime + start + dur);
        });
      } catch (e) {
        console.warn('Ringtone error:', e);
      }
    };

    playRingtoneBurst();
    this.ringtoneInterval = window.setInterval(playRingtoneBurst, 3000);
  }

  stopRingtone() {
    if (this.ringtoneInterval !== null) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
  }

  /**
   * Play call end / disconnect tone (3 quick beeps)
   */
  playCallEndTone() {
    try {
      const ctx = this.getAudioContext();
      [0, 0.18, 0.36].forEach((start) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(480, ctx.currentTime + start);

        gain.gain.setValueAtTime(0.001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + 0.1);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + 0.1);
      });
    } catch (e) {
      console.warn('Call end tone error:', e);
    }
  }

  stopAll() {
    this.stopRingback();
    this.stopRingtone();
    this.activeToneOscillators.forEach((osc) => {
      try { osc.stop(); } catch { /* ignore */ }
    });
    this.activeToneOscillators = [];
  }
}

export const soundService = new SoundService();
