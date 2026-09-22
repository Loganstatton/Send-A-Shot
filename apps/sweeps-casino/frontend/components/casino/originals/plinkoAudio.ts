// Plinko's audio engine. Same approach as Vault Breaker's
// (components/casino/slots/vault-breaker/audio/SlotAudio.ts — read for
// style, not imported from, per game-ownership boundaries): every cue is
// synthesized at runtime with the Web Audio API (oscillators, a noise
// buffer, simple exponential envelopes), no sampled/licensed audio files.
//
// The AudioContext is only created on a real user gesture (the first "Drop
// ball" tap) — see ensureStarted() — to respect browser autoplay policy.
// Volume and the master mute are NOT owned here: Plinko reads the shared
// lib/stores/sound-store.ts (the same store Vault Breaker uses) so there is
// one consistent mute toggle across games rather than a second independent
// one. Callers pass the resolved volume (already master-scaled) into each
// cue method.

type Vol = number; // 0..1, already master-scaled by the caller

class PlinkoAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private started = false;

  /** Call from a user-gesture handler (e.g. the Drop ball tap). Safe to call repeatedly. */
  ensureStarted() {
    if (this.started) {
      this.ctx?.resume().catch(() => {});
      return;
    }
    if (typeof window === "undefined") return;
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);
    this.started = true;
  }

  get ready() {
    return this.started && !!this.ctx;
  }

  private now() {
    return this.ctx!.currentTime;
  }

  private gainNode() {
    const g = this.ctx!.createGain();
    g.gain.value = 0;
    g.connect(this.master!);
    return g;
  }

  private tone(opts: {
    freq: number;
    end?: number;
    type?: OscillatorType;
    duration: number;
    volume: Vol;
    attack?: number;
    delay?: number;
    detune?: number;
  }) {
    if (!this.ctx || !this.master) return;
    const { freq, end, type = "sine", duration, volume, attack = 0.004, delay = 0, detune = 0 } = opts;
    if (volume <= 0) return;
    const t0 = this.now() + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (end) osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), t0 + duration);
    osc.detune.value = detune;
    const g = this.gainNode();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private noiseBurst(opts: { duration: number; volume: Vol; delay?: number; filterFreq?: number; type?: BiquadFilterType }) {
    if (!this.ctx || !this.master) return;
    const { duration, volume, delay = 0, filterFreq = 4000, type = "highpass" } = opts;
    if (volume <= 0) return;
    const t0 = this.now() + delay;
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = this.gainNode();
    g.gain.setValueAtTime(volume, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(g);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  // ---- Cues ----

  /** Soft mechanical click as a ball is released at the top of the board. */
  ballRelease(volume: Vol) {
    if (!this.ready) return;
    this.tone({ freq: 720, end: 340, type: "square", duration: 0.05, volume: volume * 0.22 });
    this.noiseBurst({ duration: 0.02, volume: volume * 0.12, filterFreq: 3800 });
  }

  /**
   * Small ceramic/metal peg tap. `consecutiveIndex` (how many peg hits have
   * landed within the last ~120ms, across all balls) nudges the pitch up a
   * little each time so a rapid burst of hits — several balls, or one ball
   * ricocheting fast through a dense row — doesn't sound like the exact
   * same sample replayed, just like a real cluster of small metal impacts
   * never sound perfectly identical.
   */
  pegHit(volume: Vol, consecutiveIndex = 0) {
    if (!this.ready) return;
    const jitter = (Math.random() - 0.5) * 90;
    const detune = Math.min(consecutiveIndex, 6) * 14 + jitter;
    this.tone({ freq: 1350, end: 820, type: "triangle", duration: 0.045, volume: volume * 0.16, detune });
    this.noiseBurst({ duration: 0.015, volume: volume * 0.06, filterFreq: 5200 });
  }

  /** Deeper impact when the ball first drops into a bucket pocket. */
  bucketHit(volume: Vol) {
    if (!this.ready) return;
    this.tone({ freq: 190, end: 90, type: "sine", duration: 0.14, volume: volume * 0.3 });
    this.noiseBurst({ duration: 0.06, volume: volume * 0.1, filterFreq: 900, type: "lowpass" });
  }

  /** Short positive chime once a round's win is revealed. */
  win(volume: Vol) {
    if (!this.ready) return;
    [0, 4, 7].forEach((semis, i) =>
      this.tone({
        freq: 523.2 * Math.pow(2, semis / 12),
        type: "triangle",
        duration: 0.3,
        volume: volume * 0.22,
        delay: i * 0.035,
      })
    );
  }

  /** Bigger, richer chime for a high-multiplier win. */
  bigWin(volume: Vol) {
    if (!this.ready) return;
    const notes = [392, 523.2, 659.3, 784, 1046.5];
    notes.forEach((f, i) => this.tone({ freq: f, type: "sawtooth", duration: 0.5, volume: volume * 0.24, delay: i * 0.06 }));
    this.noiseBurst({ duration: 0.5, volume: volume * 0.14, filterFreq: 1200 });
  }
}

export const plinkoAudio = new PlinkoAudioEngine();
