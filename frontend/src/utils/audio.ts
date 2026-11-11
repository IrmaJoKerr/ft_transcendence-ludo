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
    attack = 0,
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
    const now = ctx.currentTime;
    if (attack > 0) {
      // A swell: ramp up over `attack`, then run the same decay. Callers that want the
      // old instant hit keep it, because the default attack is 0.
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(this.volume * peak, now + attack);
    } else {
      gain.gain.setValueAtTime(this.volume * peak, now);
    }
    gain.gain.exponentialRampToValueAtTime(0.01, now + seconds);

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

  // Clash result FX — the beam leaves the attacker's side: a bright sawtooth zap that
  // falls from 1100 Hz to 260 Hz with a square sizzle riding above it. Before this the
  // beam had no sound of its own.
  playLaserBeam() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const body = ctx.createOscillator();
      const bodyGain = ctx.createGain();
      body.type = 'sawtooth';
      body.frequency.setValueAtTime(1100, now);
      body.frequency.exponentialRampToValueAtTime(260, now + 0.2);
      bodyGain.gain.setValueAtTime(this.volume, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      body.connect(bodyGain);
      bodyGain.connect(ctx.destination);
      body.start(now);
      body.stop(now + 0.2);

      const sizzle = ctx.createOscillator();
      const sizzleGain = ctx.createGain();
      sizzle.type = 'square';
      sizzle.frequency.setValueAtTime(2200, now);
      sizzle.frequency.exponentialRampToValueAtTime(600, now + 0.14);
      sizzleGain.gain.setValueAtTime(this.volume * 0.35, now);
      sizzleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      sizzle.connect(sizzleGain);
      sizzleGain.connect(ctx.destination);
      sizzle.start(now);
      sizzle.stop(now + 0.14);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Clash result FX — the beam meets the wall: a 20 ms noise crack (the impact) under a
  // triangle ping that drops 1400 → 400 Hz, plus a high square shard. This replaces the
  // old brick hit, so the same beat now reads as a puncture rather than a brick leaving.
  playBarrierPuncture() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      this.noiseBurst(0.02, 6000, 2500, 1.3);

      const ping = ctx.createOscillator();
      const pingGain = ctx.createGain();
      ping.type = 'triangle';
      ping.frequency.setValueAtTime(1400, now);
      ping.frequency.exponentialRampToValueAtTime(400, now + 0.12);
      pingGain.gain.setValueAtTime(this.volume * 0.9, now);
      pingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      ping.connect(pingGain);
      pingGain.connect(ctx.destination);
      ping.start(now);
      ping.stop(now + 0.12);

      const shard = ctx.createOscillator();
      const shardGain = ctx.createGain();
      shard.type = 'square';
      shard.frequency.setValueAtTime(2600, now);
      shardGain.gain.setValueAtTime(this.volume * 0.4, now);
      shardGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      shard.connect(shardGain);
      shardGain.connect(ctx.destination);
      shard.start(now);
      shard.stop(now + 0.06);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Clash result FX — the jail, and the only recipe in the game built from metal
  // (25.5): a noise transient around 3 kHz for the contact, four inharmonic partials
  // (470, 812, 1290, 2075 Hz) each with its own decay, a 90 → 50 Hz body under them for
  // the weight of the bars, and a quieter lock tick 120 ms later. It replaces
  // `playCageSnap`, whose two ratchet clicks read as one more effect; layered
  // inharmonic partials over a noise transient is what makes it read as a jail.
  playCageSlam() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;

      // The contact: 30 ms of bandpassed noise, the bars meeting the deck.
      this.noiseBurst(0.03, 3000, 3000, 1.2, 'bandpass');

      // The bars: four partials that are deliberately not in tune with each other, so
      // the clang rings rather than sounding a chord.
      const partials = [
        { freq: 470, decay: 0.45, gain: 0.9 },
        { freq: 812, decay: 0.38, gain: 0.6 },
        { freq: 1290, decay: 0.31, gain: 0.4 },
        { freq: 2075, decay: 0.25, gain: 0.28 },
      ];
      for (const partial of partials) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(partial.freq, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(this.volume * partial.gain, now + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.001, now + partial.decay);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + partial.decay);
      }

      // The weight: 90 → 50 Hz, the cell being heavier than the sound of its bars.
      const body = ctx.createOscillator();
      const bodyGain = ctx.createGain();
      body.type = 'sine';
      body.frequency.setValueAtTime(90, now);
      body.frequency.exponentialRampToValueAtTime(50, now + 0.35);
      bodyGain.gain.setValueAtTime(this.volume * 0.8, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      body.connect(bodyGain);
      bodyGain.connect(ctx.destination);
      body.start(now);
      body.stop(now + 0.35);

      // The lock: the cell closing, quieter and 120 ms behind the slam.
      const lock = ctx.createOscillator();
      const lockGain = ctx.createGain();
      lock.type = 'square';
      lock.frequency.setValueAtTime(1400, now + 0.12);
      lockGain.gain.setValueAtTime(this.volume * 0.35, now + 0.12);
      lockGain.gain.exponentialRampToValueAtTime(0.001, now + 0.132);
      lock.connect(lockGain);
      lockGain.connect(ctx.destination);
      lock.start(now + 0.12);
      lock.stop(now + 0.132);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Clash result FX — a layer going out (25.5): noise only, 40 ms, a bright lowpass
  // falling 5200 → 2400 Hz. It scores the line glitch, so it is the line letting go
  // rather than the wall being hit, which is the bloom's job.
  playShatterTick() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      this.noiseBurst(0.04, 5200, 2400, 1.0);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Clash result FX — the wall taking a hit, scaled by `weight` (25.5). At full weight
  // it is the total breach: the wall's fall, but it SWELLS first — the noise ramps in
  // over 300 ms (the helper's attack) instead of landing at full peak, so the collapse
  // reads as a bloom rising then bursting rather than a flat bang. At low weight it is
  // the flare where the beam lands, the same recipe heard through a closed door.
  playBreachBloom(weight = 1) {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      this.noiseBurst(1.0, 1200, 70, 1.4 * weight, 'lowpass', 0.3);

      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(55, now);
      sub.frequency.exponentialRampToValueAtTime(34, now + 0.9);
      subGain.gain.setValueAtTime(0.0001, now);
      subGain.gain.linearRampToValueAtTime(this.volume * 1.1 * weight, now + 0.25);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      sub.connect(subGain);
      subGain.connect(ctx.destination);
      sub.start(now);
      sub.stop(now + 0.9);

      // The bloom's bright edge: a sine rising through the swell, then gone.
      const shine = ctx.createOscillator();
      const shineGain = ctx.createGain();
      shine.type = 'sine';
      shine.frequency.setValueAtTime(300, now);
      shine.frequency.exponentialRampToValueAtTime(900, now + 0.28);
      shineGain.gain.setValueAtTime(0.0001, now);
      shineGain.gain.linearRampToValueAtTime(this.volume * 0.5 * weight, now + 0.28);
      shineGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
      shine.connect(shineGain);
      shineGain.connect(ctx.destination);
      shine.start(now);
      shine.stop(now + 0.42);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Clash result FX — the defender holds: the old sword-on-shield clang (a triangle at
  // 820 with a square partial at 1240, which is what reads as metal), then the beam
  // RICOCHETS up and away as a square sweeping 1400 → 3400 Hz. The rise is the deflect.
  playBarrierDeflect() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const clang = [
        { freq: 820, type: 'triangle' as OscillatorType, gain: 1 },
        { freq: 1240, type: 'square' as OscillatorType, gain: 0.25 },
      ];
      for (const partial of clang) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = partial.type;
        osc.frequency.setValueAtTime(partial.freq, now);
        gain.gain.setValueAtTime(this.volume * partial.gain, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.18);
      }

      const deflect = ctx.createOscillator();
      const deflectGain = ctx.createGain();
      deflect.type = 'square';
      deflect.frequency.setValueAtTime(1400, now + 0.05);
      deflect.frequency.exponentialRampToValueAtTime(3400, now + 0.17);
      deflectGain.gain.setValueAtTime(this.volume * 0.5, now + 0.05);
      deflectGain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      deflect.connect(deflectGain);
      deflectGain.connect(ctx.destination);
      deflect.start(now + 0.05);
      deflect.stop(now + 0.17);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // Clash result FX — the attacker fails: the old comedy sting is retired for a deflated
  // power-down, a square falling 520 → 120 Hz under a low dust rustle. Not a taunt; the
  // sound of the attacker's piece being dragged off the square.
  playAttackFailed() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const fall = ctx.createOscillator();
      const fallGain = ctx.createGain();
      fall.type = 'square';
      fall.frequency.setValueAtTime(520, now);
      fall.frequency.exponentialRampToValueAtTime(120, now + 0.32);
      fallGain.gain.setValueAtTime(this.volume * 0.8, now);
      fallGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      fall.connect(fallGain);
      fallGain.connect(ctx.destination);
      fall.start(now);
      fall.stop(now + 0.32);

      this.noiseBurst(0.2, 900, 120, 0.6);
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

  // Play the chat transmission (23.7): a squelch of bandpassed noise, then the letter A
  // in morse on a 900 Hz sine. It fires per line, so it is the quietest tone the engine
  // owns: half of `volume`. Every element opens on a 4 ms bandpassed click, because a key
  // is recognisable by its contact rather than by its carrier: a bare sine has nothing in
  // front of it, which is why the first cut read as a buzz (revised 2026-11-09). The
  // carriers ramp in over 8 ms and out over 20 ms from a 0.0001 floor rather than riding
  // `playUiBeep`'s exponential tail, which clicks when two elements are this close
  // together. The click is built here rather than through `noiseBurst`, because that
  // helper always starts at `currentTime` and these start on a scheduled instant.
  playChatSend() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;

      // The squelch: 35 ms of bandpassed white noise at 2200 Hz, the carrier dropping in.
      this.noiseBurst(0.035, 2200, 2200, 0.35, 'bandpass');

      // The contact: 4 ms of white noise through a bandpass at 3,200 Hz. It sits on the
      // element's own onset, so the snap and the tone are one press.
      const click = (at: number) => {
        const samples = Math.max(1, Math.floor(ctx.sampleRate * 0.004));
        const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(3200, at);
        filter.Q.setValueAtTime(0.9, at);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(this.volume * 0.5, at);
        gain.gain.exponentialRampToValueAtTime(0.01, at + 0.004);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        noise.start(at);
        noise.stop(at + 0.004);
      };

      const tone = (at: number, seconds: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(900, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(this.volume * 0.5, at + 0.008);
        gain.gain.setValueAtTime(this.volume * 0.5, at + seconds - 0.02);
        gain.gain.linearRampToValueAtTime(0.0001, at + seconds);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + seconds);
      };

      // A 55 ms dot then a 170 ms dash, one morse unit apart: `.-`. Each element is a
      // click plus its carrier, and the pair ends at 0.34 s, inside the 0.40 s the cue
      // has always held.
      click(now + 0.06);
      tone(now + 0.06, 0.055);
      click(now + 0.17);
      tone(now + 0.17, 0.17);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  // The goal (32.5) — the one cue that plays on EVERY goal, whatever the room's effects
  // rule says: the rule governs the overlay, never the celebration. A four-note rise in C
  // (the triad and its octave), each note a triangle body with a quiet square an octave up
  // for the chiptune edge and the last one held, and a bandpassed sparkle over it — the
  // confetti's own air, not a second cue. It is short on purpose: the overlay after it is
  // 900 or 1400 and the cue is done in about a third of that.
  playFanfare() {
    if (this.muted) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;

      const notes = [
        { freq: 523.25, at: 0, seconds: 0.16 },
        { freq: 659.25, at: 0.09, seconds: 0.16 },
        { freq: 783.99, at: 0.18, seconds: 0.16 },
        { freq: 1046.5, at: 0.29, seconds: 0.46 },
      ];
      for (const note of notes) {
        const at = now + note.at;

        const body = ctx.createOscillator();
        const bodyGain = ctx.createGain();
        body.type = 'triangle';
        body.frequency.setValueAtTime(note.freq, at);
        bodyGain.gain.setValueAtTime(0.0001, at);
        bodyGain.gain.linearRampToValueAtTime(this.volume * 0.8, at + 0.006);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, at + note.seconds);
        body.connect(bodyGain);
        bodyGain.connect(ctx.destination);
        body.start(at);
        body.stop(at + note.seconds);

        // The edge: the same note an octave up, quiet enough to be heard as timbre rather
        // than as a second note (the shape the cyber cues use).
        const edge = ctx.createOscillator();
        const edgeGain = ctx.createGain();
        edge.type = 'square';
        edge.frequency.setValueAtTime(note.freq * 2, at);
        edgeGain.gain.setValueAtTime(0.0001, at);
        edgeGain.gain.linearRampToValueAtTime(this.volume * 0.16, at + 0.006);
        edgeGain.gain.exponentialRampToValueAtTime(0.001, at + note.seconds * 0.7);
        edge.connect(edgeGain);
        edgeGain.connect(ctx.destination);
        edge.start(at);
        edge.stop(at + note.seconds);
      }

      // `noiseBurst` always starts at `currentTime`, so the sparkle is scheduled by being
      // called: it belongs to the arrival, and the arrival is now.
      this.noiseBurst(0.32, 6200, 2600, 0.22);
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
