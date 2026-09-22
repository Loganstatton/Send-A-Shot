// Vault Breaker's audio engine. There is no licensed/sampled audio in this
// environment, so every cue here is synthesized at runtime with the Web
// Audio API (oscillators, noise buffers, simple envelopes/filters) — no
// silent placeholders, no external audio files. It is honestly a
// "chiptune/synth casino" sound palette, not a sampled orchestral one; see
// the build report for that ceiling stated plainly.
//
// The AudioContext is only created on a real user gesture (first Spin tap)
// to respect browser autoplay policy — see ensureStarted().

type Vol = number; // 0..1, already master-scaled by the caller

class SlotAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private started = false;

  /** Call from a user-gesture handler (e.g. first Spin tap). Safe to call repeatedly. */
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

  private gainNode(volume: Vol) {
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
    const { freq, end, type = "sine", duration, volume, attack = 0.005, delay = 0, detune = 0 } = opts;
    const t0 = this.now() + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (end) osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), t0 + duration);
    osc.detune.value = detune;
    const g = this.gainNode(volume);
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
    const g = this.gainNode(volume);
    g.gain.setValueAtTime(volume, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(g);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  // ---- Cues ----

  buttonPress(volume: Vol) {
    if (!this.ready) return;
    this.tone({ freq: 520, end: 380, type: "triangle", duration: 0.08, volume: volume * 0.5 });
  }

  spinStart(volume: Vol) {
    if (!this.ready) return;
    this.tone({ freq: 180, end: 90, type: "sawtooth", duration: 0.5, volume: volume * 0.22 });
    this.noiseBurst({ duration: 0.35, volume: volume * 0.12, filterFreq: 2200 });
  }

  /** Looping whoosh while reels spin — call once, it schedules a short loop-friendly texture. Returns a stop function. */
  spinLoop(volume: Vol): () => void {
    if (!this.ready || !this.ctx) return () => {};
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 140;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 14;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.09), ctx.currentTime + 0.15);
    osc.connect(filter);
    filter.connect(g);
    g.connect(this.master!);
    osc.start();
    lfo.start();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      osc.stop(t + 0.2);
      lfo.stop(t + 0.2);
    };
  }

  reelStop(volume: Vol, index: number) {
    if (!this.ready) return;
    const base = 260 + index * 18;
    this.tone({ freq: base, end: base * 0.6, type: "square", duration: 0.09, volume: volume * 0.28 });
    this.noiseBurst({ duration: 0.05, volume: volume * 0.15, filterFreq: 3200 });
  }

  anticipationTick(volume: Vol) {
    if (!this.ready) return;
    this.tone({ freq: 880, type: "sine", duration: 0.12, volume: volume * 0.22 });
  }

  symbolWin(volume: Vol, tier: number) {
    if (!this.ready) return;
    const root = 440 + tier * 20;
    [0, 4, 7].forEach((semis, i) => {
      this.tone({
        freq: root * Math.pow(2, semis / 12),
        type: "triangle",
        duration: 0.32,
        volume: volume * 0.2,
        delay: i * 0.03,
      });
    });
  }

  scatterLand(volume: Vol) {
    if (!this.ready) return;
    this.tone({ freq: 700, end: 1100, type: "sine", duration: 0.28, volume: volume * 0.3 });
  }

  bonusTrigger(volume: Vol) {
    if (!this.ready) return;
    const notes = [261.6, 329.6, 392, 523.2, 659.3];
    notes.forEach((f, i) => this.tone({ freq: f, type: "sawtooth", duration: 0.45, volume: volume * 0.22, delay: i * 0.09 }));
    this.noiseBurst({ duration: 0.6, volume: volume * 0.18, filterFreq: 1500 });
  }

  /** Mechanical lock-release cluster — cued right before the vault doors open in the breach cinematic. */
  vaultUnlock(volume: Vol) {
    if (!this.ready) return;
    for (let i = 0; i < 4; i++) {
      this.tone({ freq: 180 + i * 6, type: "square", duration: 0.05, volume: volume * 0.24, delay: i * 0.07 });
      this.noiseBurst({ duration: 0.03, volume: volume * 0.16, delay: i * 0.07, filterFreq: 2600 });
    }
  }

  coinTick(volume: Vol) {
    if (!this.ready) return;
    this.tone({ freq: 1200 + Math.random() * 400, type: "sine", duration: 0.06, volume: volume * 0.14 });
  }

  bigWin(volume: Vol) {
    if (!this.ready) return;
    const notes = [392, 523.2, 659.3, 784];
    notes.forEach((f, i) => this.tone({ freq: f, type: "triangle", duration: 0.5, volume: volume * 0.28, delay: i * 0.07 }));
  }

  megaWin(volume: Vol) {
    if (!this.ready) return;
    const notes = [261.6, 329.6, 392, 523.2, 659.3, 784, 1046.5];
    notes.forEach((f, i) => this.tone({ freq: f, type: "sawtooth", duration: 0.6, volume: volume * 0.24, delay: i * 0.06 }));
    this.noiseBurst({ duration: 0.8, volume: volume * 0.15, filterFreq: 1000 });
  }

  freeSpinsAmbienceTick(volume: Vol) {
    if (!this.ready) return;
    this.tone({ freq: 660, end: 880, type: "sine", duration: 0.5, volume: volume * 0.08 });
  }
}

export const slotAudio = new SlotAudioEngine();
