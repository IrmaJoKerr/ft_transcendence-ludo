/* **RETRO WAVE ARCADE - WEB AUDIO CHIPTUNE SYNTHESIZER** */

export class RetroAudioEngine {
  ctx: AudioContext | null = null;
  volume = 0.2;
  muted = false;

  initContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        (window.AudioContext as typeof AudioContext | undefined) ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx?.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined);
    }
  }

  // Play a retro blip sound for UI buttons
  playUiBeep(freq = 440, duration = 0.08, type: OscillatorType = 'square') {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, this.ctx.currentTime + duration);

      gain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      console.debug('Audio Context blocked until user gesture.', e);
    }
  }

  // Play Laser Sound FX for arcade games
  playLaserSound() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, this.ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(this.volume * 1.2, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.15);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Play Cyber Slide FX when CyberModal opens
  playCyberSlide() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(740, this.ctx.currentTime + 0.18);

      gain.gain.setValueAtTime(this.volume * 0.7, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.2);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Play Cyber Accept FX
  playCyberAccept() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'triangle';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(587.3, this.ctx.currentTime);
      osc1.frequency.setValueAtTime(880.0, this.ctx.currentTime + 0.09);
      osc2.frequency.setValueAtTime(1174.6, this.ctx.currentTime + 0.09);

      gain.gain.setValueAtTime(this.volume * 0.8, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.24);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start();
      osc2.start(this.ctx.currentTime + 0.09);
      osc1.stop(this.ctx.currentTime + 0.24);
      osc2.stop(this.ctx.currentTime + 0.24);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Play Cyber Reject FX
  playCyberReject() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(160, this.ctx.currentTime + 0.16);

      gain.gain.setValueAtTime(this.volume * 0.6, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.18);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.18);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Play subtle plasma ignition sound for Apex badges
  playIgnitionSound() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(360, this.ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(this.volume * 0.45, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.14);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.14);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // One noise recipe for every impact: a white-noise buffer through a filter that
  // sweeps `fromHz` → `toHz` over `seconds` (a bandpass holds its centre instead, for
  // rustles). The explosion is the original caller; the clash wall, the shot and the
  // rope are the same body with their own bands, so there is one place where a hit is
  // shaped instead of four near-copies.
  private noiseBurst(
    seconds: number,
    fromHz: number,
    toHz: number,
    peak = 1.5,
    mode: 'lowpass' | 'bandpass' = 'lowpass',
  ) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const bufferSize = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1; // White noise
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = mode;
    filter.frequency.setValueAtTime(fromHz, ctx.currentTime);
    if (mode === 'bandpass') filter.Q.setValueAtTime(0.9, ctx.currentTime);
    else filter.frequency.linearRampToValueAtTime(toHz, ctx.currentTime + seconds);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.volume * peak, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + seconds);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    whiteNoise.start();
    whiteNoise.stop(ctx.currentTime + seconds);
  }

  // Play Explosion FX for arcade games
  playExplosionSound() {
    if (this.muted) return;
    try {
      this.initContext();
      this.noiseBurst(0.25, 1000, 100);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Clash result FX — the loser is tied up: two ratchet clicks (the old handcuff click
  // recipe, re-purposed), then a short bandpassed rustle as the rope bites.
  playRopeBind() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const click = (at: number, freq: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, at);
        gain.gain.setValueAtTime(this.volume * 1.1, at);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.008);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.008);
      };
      click(ctx.currentTime, 900);
      click(ctx.currentTime + 0.06, 1400);
      this.noiseBurst(0.12, 2400, 2400, 0.9, 'bandpass');
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Clash result FX — the sword snaps on the shield: a 900 Hz metallic clang (with a
  // 1340 Hz square partial, which is what makes it read as metal), then a 2.2 kHz square
  // shard with a fast decay.
  playSwordBreak() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const clang = [
        { freq: 900, type: 'triangle' as OscillatorType, gain: 1 },
        { freq: 1340, type: 'square' as OscillatorType, gain: 0.25 },
      ];
      for (const partial of clang) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = partial.type;
        osc.frequency.setValueAtTime(partial.freq, ctx.currentTime);
        gain.gain.setValueAtTime(this.volume * partial.gain, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.18);
      }

      const shardAt = ctx.currentTime + 0.06;
      const shard = ctx.createOscillator();
      const shardGain = ctx.createGain();
      shard.type = 'square';
      shard.frequency.setValueAtTime(2200, shardAt);
      shardGain.gain.setValueAtTime(this.volume * 0.6, shardAt);
      shardGain.gain.exponentialRampToValueAtTime(0.001, shardAt + 0.1);
      shard.connect(shardGain);
      shardGain.connect(ctx.destination);
      shard.start(shardAt);
      shard.stop(shardAt + 0.1);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Clash result FX — a round won on a wall: the shot lands (a 12 ms crack), then the
  // brick goes (a square falling 620 → 180 Hz).
  playBrickHit() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      this.noiseBurst(0.012, 5000, 3000, 1.2);
      const ctx = this.ctx;
      const at = ctx.currentTime + 0.01;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(620, at);
      osc.frequency.exponentialRampToValueAtTime(180, at + 0.26);
      gain.gain.setValueAtTime(this.volume * 0.9, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.26);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.26);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Clash result FX — the wall comes down: the explosion recipe stretched to a
  // collapse, over a 60 Hz sub that carries the weight.
  playWallCrumble() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      this.noiseBurst(0.9, 800, 90);
      const ctx = this.ctx;
      const sub = ctx.createOscillator();
      const gain = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(60, ctx.currentTime);
      sub.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.8);
      gain.gain.setValueAtTime(this.volume * 1.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      sub.connect(gain);
      gain.connect(ctx.destination);
      sub.start();
      sub.stop(ctx.currentTime + 0.8);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Clash result FX — taunt: a sawtooth blown through an ~18 Hz amplitude wobble,
  // which is what makes it read as a raspberry rather than a bass note.
  playRaspberry() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const wobble = ctx.createOscillator();
      const wobbleDepth = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      gain.gain.setValueAtTime(this.volume * 0.55, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

      wobble.type = 'sine';
      wobble.frequency.setValueAtTime(18, ctx.currentTime);
      wobbleDepth.gain.setValueAtTime(this.volume * 0.5, ctx.currentTime);

      wobble.connect(wobbleDepth);
      wobbleDepth.connect(gain.gain);
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      wobble.start();
      wobble.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Play Retro Printer Chiptune Sound FX
  playPrinterSound() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const pulses = 14;
      for (let i = 0; i < pulses; i++) {
        const startTime = this.ctx.currentTime + i * 0.11;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        const pitch = 350 + (i % 4) * 110;
        osc.type = 'square';
        osc.frequency.setValueAtTime(pitch, startTime);
        osc.frequency.linearRampToValueAtTime(pitch * 0.8, startTime + 0.07);

        gain.gain.setValueAtTime(this.volume * 0.5, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.07);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.07);
      }

      this.playUiBeep(1200, 0.12, 'square');
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }
}

export const retroAudio = new RetroAudioEngine();

if (typeof window !== 'undefined') {
  (window as unknown as { retroAudio: typeof retroAudio }).retroAudio = retroAudio;
}
