// The sound itself: an AudioContext, one synthesizer per cue, the ambience beds and the two master gains.
// Everything is made of oscillators and noise; there are no audio files. It decides nothing: it plays the
// cue it is given (cues.ts says which and when) and the ambience it is given, at the gains it is given
// (volume.ts).

import type { Ambience, AmbienceBed, SoundCue } from './cues';

const CROSSFADE = 1; // s from one ambience bed to the next, and for the tense layer to come and go
const BED_LEVEL: Record<AmbienceBed, number> = { town: 0.5, wilderness: 0.55, dungeon: 0.6 };
const TENSE_LEVEL = 0.5;

/** What is playing of the ambience: its gain into the master, and how to stop what feeds it. */
interface Bed { gain: GainNode; stop: () => void }

export interface SoundEngine {
  /** Creates the AudioContext. Called from the first pointerdown or keydown; nothing sounds before it. */
  unlock: () => void;
  readonly unlocked: boolean;
  play: (cue: SoundCue) => void;
  setAmbience: (ambience: Ambience | null) => void;
  setGains: (gains: { effects: number; ambience: number }) => void;
}

export function createSoundEngine(): SoundEngine {
  let ctx: AudioContext | null = null;
  let unlocked = false;
  let effects: GainNode | null = null; // master of the cues
  let ambient: GainNode | null = null; // master of the ambience
  let level = { effects: 0, ambience: 0 };
  let wanted: Ambience | null = null;
  let bedKind: AmbienceBed | null = null;
  let bed: Bed | null = null;
  let tense: Bed | null = null;
  let hiss: AudioBuffer | null = null;

  /** Two seconds of white noise, looped by the beds. */
  const noiseLoop = (audio: AudioContext): AudioBuffer => {
    if (hiss) return hiss;
    hiss = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const data = hiss.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return hiss;
  };

  // --- the two building blocks of SFX: a decaying oscillator and a decaying burst of filtered noise ---

  /** An oscillator at `freq` that dies away over `duration`, starting `after` seconds from now. `to`: it slides to that frequency. */
  const osc = (freq: number, type: OscillatorType, duration: number, vol: number, after = 0, to: number | null = null, out: AudioNode | null = effects): void => {
    if (!ctx || !out) return;
    const at = ctx.currentTime + after;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (to !== null) o.frequency.exponentialRampToValueAtTime(to, at + duration);
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + duration);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + duration);
  };

  /** Noise through a low-pass at `freq`, dying away over `duration`. `to`: the filter slides to that frequency. */
  const noise = (duration: number, freq: number, vol: number, after = 0, to: number | null = null, out: AudioNode | null = effects): void => {
    if (!ctx || !out) return;
    const at = ctx.currentTime + after;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.3));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq, at);
    if (to !== null) filter.frequency.exponentialRampToValueAtTime(to, at + duration);
    const g = ctx.createGain();
    g.gain.value = vol;
    source.connect(filter).connect(g).connect(out);
    source.start(at);
  };

  const SYNTHS: Record<SoundCue, () => void> = {
    // The twelve of menus and fights.
    hit: () => {
      noise(0.12, 600, 0.25);
      osc(120, 'sine', 0.1, 0.2);
    },
    crit: () => {
      noise(0.2, 900, 0.35);
      osc(90, 'sawtooth', 0.25, 0.22);
      osc(660, 'square', 0.12, 0.08, 0.06);
    },
    miss: () => noise(0.15, 2000, 0.08),
    defend: () => {
      osc(300, 'triangle', 0.15, 0.12);
      osc(400, 'triangle', 0.1, 0.08, 0.08);
    },
    heal: () => {
      osc(523, 'sine', 0.25, 0.1);
      osc(659, 'sine', 0.25, 0.1, 0.12);
      osc(784, 'sine', 0.35, 0.12, 0.24);
    },
    victory: () => {
      [523, 659, 784, 1047].forEach((n, i) => {
        osc(n, 'sine', 0.3, 0.12, i * 0.15);
        osc(n * 0.5, 'triangle', 0.3, 0.06, i * 0.15);
      });
    },
    defeat: () => {
      [300, 250, 200, 150].forEach((n, i) => osc(n, 'sawtooth', 0.5, 0.08, i * 0.2));
    },
    levelup: () => {
      [523, 587, 659, 784, 880, 1047].forEach((n, i) => {
        osc(n, 'sine', 0.2, 0.1, i * 0.08);
        osc(n * 1.5, 'triangle', 0.15, 0.05, i * 0.08);
      });
    },
    coin: () => {
      osc(1200, 'sine', 0.08, 0.1);
      osc(1800, 'sine', 0.12, 0.08, 0.06);
    },
    click: () => noise(0.03, 3000, 0.06),
    spell: () => {
      osc(440, 'sine', 0.15, 0.08);
      osc(660, 'sine', 0.15, 0.08, 0.08);
      osc(880, 'triangle', 0.2, 0.06, 0.16);
    },
    save: () => {
      osc(800, 'sine', 0.08, 0.08);
      osc(1000, 'sine', 0.1, 0.06, 0.06);
      osc(1200, 'sine', 0.08, 0.06, 0.12);
    },
    // New in the 3D client.
    step_stone: () => noise(0.07, 1800, 0.13),
    step_grass: () => noise(0.09, 700, 0.16),
    step_dungeon: () => {
      noise(0.07, 1200, 0.13);
      noise(0.07, 1200, 0.05, 0.09);
    },
    gate: () => {
      noise(0.5, 1400, 0.2, 0, 160);
      osc(80, 'sine', 0.5, 0.14, 0, 55);
    },
    prompt: () => {
      osc(880, 'sine', 0.05, 0.035);
      osc(1175, 'sine', 0.07, 0.035, 0.06);
    },
    notice: () => {
      osc(85, 'sawtooth', 0.3, 0.1, 0, 210);
      noise(0.3, 500, 0.1, 0, 1100);
    },
    enrage: () => {
      osc(82, 'sawtooth', 0.8, 0.2, 0, 52);
      osc(87, 'sawtooth', 0.8, 0.12, 0, 49);
      noise(0.8, 450, 0.25);
    },
    shard: () => {
      [784, 988, 1175, 1568, 1976].forEach((n, i) => {
        osc(n, 'sine', 0.6, 0.09, i * 0.15);
        osc(n * 2, 'triangle', 0.3, 0.03, i * 0.15 + 0.04);
        osc(n * 3.01, 'sine', 0.25, 0.015, i * 0.15 + 0.08);
      });
    },
  };

  // --- ambience ---------------------------------------------------------------------------------------

  /** Looped noise through a filter into `out`; its loudness swells with a slow oscillator. Returns what to stop. */
  const wind = (audio: AudioContext, out: AudioNode, type: BiquadFilterType, freq: number, q: number, vol: number, swell: number, rate: number): AudioScheduledSourceNode[] => {
    const source = audio.createBufferSource();
    source.buffer = noiseLoop(audio);
    source.loop = true;
    const filter = audio.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = audio.createGain();
    g.gain.value = vol;
    const lfo = audio.createOscillator();
    lfo.frequency.value = rate;
    const depth = audio.createGain();
    depth.gain.value = swell;
    lfo.connect(depth).connect(g.gain);
    source.connect(filter).connect(g).connect(out);
    source.start();
    lfo.start();
    return [source, lfo];
  };

  /** A steady tone into `out`. */
  const drone = (audio: AudioContext, out: AudioNode, freq: number, type: OscillatorType, vol: number): AudioScheduledSourceNode => {
    const o = audio.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = audio.createGain();
    g.gain.value = vol;
    o.connect(g).connect(out);
    o.start();
    return o;
  };

  /** Calls `sound` at random intervals of `low` to `high` seconds until stopped. The only randomness of the ambience. */
  const nowAndThen = (low: number, high: number, sound: () => void): (() => void) => {
    let timer = 0;
    const next = (): void => {
      timer = window.setTimeout(() => {
        sound();
        next();
      }, (low + Math.random() * (high - low)) * 1000);
    };
    next();
    return () => window.clearTimeout(timer);
  };

  const startBed = (kind: AmbienceBed | 'tense'): Bed | null => {
    if (!ctx || !ambient) return null;
    const audio = ctx;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0, audio.currentTime);
    gain.gain.linearRampToValueAtTime(kind === 'tense' ? TENSE_LEVEL : BED_LEVEL[kind], audio.currentTime + CROSSFADE);
    gain.connect(ambient);
    const sources: AudioScheduledSourceNode[] = [];
    let timer: (() => void) | null = null;
    if (kind === 'town') {
      // A murmur: two bands of noise that swell out of step.
      sources.push(...wind(audio, gain, 'bandpass', 420, 0.8, 0.5, 0.2, 0.13), ...wind(audio, gain, 'bandpass', 900, 1.2, 0.18, 0.1, 0.21));
    } else if (kind === 'wilderness') {
      sources.push(...wind(audio, gain, 'bandpass', 620, 1.1, 0.55, 0.3, 0.07));
      timer = nowAndThen(3, 9, () => {
        // A bird: two or three short rising chirps.
        const pitch = 2300 + Math.random() * 900;
        const chirps = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < chirps; i++) osc(pitch, 'sine', 0.09, 0.16, i * 0.13, pitch * 1.35, gain);
      });
    } else if (kind === 'dungeon') {
      sources.push(drone(audio, gain, 55, 'sine', 0.55), drone(audio, gain, 110.6, 'sine', 0.08), ...wind(audio, gain, 'lowpass', 180, 0.5, 0.25, 0.1, 0.05));
      timer = nowAndThen(2, 7, () => {
        // A drip, and its echo.
        const pitch = 1100 + Math.random() * 500;
        osc(pitch, 'sine', 0.07, 0.3, 0, pitch * 0.55, gain);
        osc(pitch, 'sine', 0.07, 0.08, 0.16, pitch * 0.55, gain);
      });
    } else {
      // Tense: a low tone that beats slowly, under two tones that do not agree.
      const pulse = audio.createGain();
      pulse.gain.value = 0.5;
      const beat = audio.createOscillator();
      beat.frequency.value = 0.8;
      const depth = audio.createGain();
      depth.gain.value = 0.45;
      beat.connect(depth).connect(pulse.gain);
      pulse.connect(gain);
      beat.start();
      sources.push(beat, drone(audio, pulse, 49, 'sine', 1), drone(audio, gain, 98, 'triangle', 0.1), drone(audio, gain, 104, 'triangle', 0.09));
    }
    return {
      gain,
      stop: () => {
        timer?.();
        gain.gain.cancelScheduledValues(audio.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, audio.currentTime);
        gain.gain.linearRampToValueAtTime(0, audio.currentTime + CROSSFADE);
        for (const source of sources) source.stop(audio.currentTime + CROSSFADE + 0.1);
        window.setTimeout(() => gain.disconnect(), (CROSSFADE + 0.3) * 1000);
      },
    };
  };

  /** Brings what plays in line with what is wanted. */
  const tune = (): void => {
    if (!ctx) return;
    const kind = wanted?.bed ?? null;
    if (kind !== bedKind) {
      bed?.stop();
      bed = kind ? startBed(kind) : null;
      bedKind = kind;
    }
    const tight = wanted?.tense === true;
    if (tight && !tense) tense = startBed('tense');
    else if (!tight && tense) {
      tense.stop();
      tense = null;
    }
  };

  return {
    unlock() {
      if (unlocked) return;
      unlocked = true;
      try {
        ctx = new AudioContext();
        effects = ctx.createGain();
        ambient = ctx.createGain();
        effects.gain.value = level.effects;
        ambient.gain.value = level.ambience;
        effects.connect(ctx.destination);
        ambient.connect(ctx.destination);
        tune();
      } catch {
        // No sound in this browser: the game goes on without it.
        ctx = null;
      }
    },
    get unlocked() { return unlocked; },
    play(cue) {
      if (!ctx || !effects) return;
      try {
        if (ctx.state === 'suspended') void ctx.resume();
        SYNTHS[cue]();
      } catch {
        /* a cue that cannot be played is skipped */
      }
    },
    setAmbience(ambience) {
      if (wanted?.bed === ambience?.bed && wanted?.tense === ambience?.tense && (wanted === null) === (ambience === null)) return;
      wanted = ambience ? { ...ambience } : null;
      try {
        tune();
      } catch {
        /* no ambience */
      }
    },
    setGains(gains) {
      level = { ...gains };
      if (!ctx || !effects || !ambient) return;
      effects.gain.setTargetAtTime(gains.effects, ctx.currentTime, 0.02);
      ambient.gain.setTargetAtTime(gains.ambience, ctx.currentTime, 0.05);
    },
  };
}
