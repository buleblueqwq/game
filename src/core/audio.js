// WebAudio 实时合成音频引擎 —— 零音频文件，全部程序合成
// 特性：自动解锁、总线/限幅、节点自动回收（防泄漏）、程序化 BGM 音序器、SFX 预设库

import { getSettings } from './storage.js';
import { reportError, caps } from './errors.js';

let engine = null;

export function getAudio() {
  if (!engine) engine = new AudioEngine();
  return engine;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.unlocked = false;
    this.settings = getSettings();
    this.nodes = { master: null, musicBus: null, sfxBus: null, comp: null };
    this._noiseBuf = null;
    this._active = new Set();       // 正在发声的节点，用于 panic / 统计
    this.voices = 0;
    this.maxVoices = 28;            // 复音上限，超了丢弃最旧的
    this.music = null;
    this._retry = 0;
  }
  // ---------- 初始化 / 解锁 ----------
  init() {
    if (this.ready) return true;
    if (!caps.audio) return false;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const c = this.ctx;
      // 总线：master -> compressor -> destination
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 8;
      comp.attack.value = 0.003; comp.release.value = 0.22;
      const master = c.createGain();
      master.gain.value = this.settings.master ?? 0.7;
      const musicBus = c.createGain(); musicBus.gain.value = this.settings.music ? 0.55 : 0;
      const sfxBus = c.createGain(); sfxBus.gain.value = this.settings.sfx ? 0.85 : 0;
      musicBus.connect(master); sfxBus.connect(master);
      master.connect(comp); comp.connect(c.destination);
      // 轻量混响（合成脉冲响应，无外部文件）
      const rev = c.createConvolver();
      rev.buffer = this._makeIR(1.6, 2.4);
      const revSend = c.createGain(); revSend.gain.value = 0.22;
      const revRet = c.createGain(); revRet.gain.value = 0.5;
      revSend.connect(rev); rev.connect(revRet); revRet.connect(master);
      this.nodes = { master, musicBus, sfxBus, comp, revSend, rev };
      this.ready = true;
      return true;
    } catch (err) { reportError('audio.init', err); return false; }
  }
  _makeIR(seconds = 1.6, decay = 2.4) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.2);
      }
    }
    return buf;
  }
  /** 必须在用户手势中调用 */
  unlock() {
    if (!this.init()) return Promise.resolve(false);
    const c = this.ctx;
    const done = () => {
      this.unlocked = c.state === 'running';
      return this.unlocked;
    };
    if (c.state === 'running') { this.unlocked = true; return Promise.resolve(true); }
    return c.resume().then(done).catch((e) => { reportError('audio.unlock', e); return false; });
  }
  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  // ---------- 资源管理 ----------
  _noise() {
    if (!this._noiseBuf) {
      const sr = this.ctx.sampleRate, len = sr * 2;
      const b = this.ctx.createBuffer(1, len, sr);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = b;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    return src;
  }
  /** 登记一次性节点，播完自动断开（防节点泄漏） */
  _track(node, stopAt) {
    this.voices++;
    if (this.voices > this.maxVoices) this.panic(0.4);
    const kill = () => {
      try { node.disconnect(); } catch { /* ignore */ }
      this.voices--;
    };
    if (stopAt != null) { try { node.stop(stopAt); } catch { /* ignore */ } }
    node.onended = kill;
    return kill;
  }
  _gain(v = 1, dest = null) { const g = this.ctx.createGain(); g.gain.value = v; g.connect(dest || this.nodes.sfxBus); return g; }

  // ---------- 基础音色 ----------
  /** 振荡器音：type/freq 包络/滑音/滤波 */
  tone({ freq = 440, to = null, type = 'sine', dur = 0.2, gain = 0.3, attack = 0.005, decay = null, sustain = 0, release = null, filter = null, q = 1, detune = 0, delay = 0, bus = null, reverb = 0, pan = 0 }) {
    if (!this.ready || !this.settings.sfx) return null;
    const c = this.ctx, t0 = c.currentTime + delay;
    const rel = release ?? Math.max(0.02, dur * 0.6);
    const dec = decay ?? dur;
    const total = attack + dec + rel;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + attack + dec);
    if (detune) osc.detune.value = detune;
    let node = osc;
    if (filter) {
      const f = c.createBiquadFilter();
      f.type = typeof filter === 'string' ? filter : 'lowpass';
      f.frequency.value = typeof filter === 'number' ? filter : 1800;
      f.Q.value = q;
      node.connect(f); node = f;
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.35), t0 + attack + dec * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dec + rel);
    node.connect(g);
    let out = g;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(bus || this.nodes.sfxBus);
    if (reverb) { const s = c.createGain(); s.gain.value = reverb; out.connect(s); s.connect(this.nodes.revSend); }
    osc.start(t0);
    this._track(osc, t0 + total + 0.05);
    return osc;
  }
  /** 噪声音：打击/爆炸/风声 */
  noise({ dur = 0.2, gain = 0.3, filter = 'bandpass', freq = 1200, to = null, q = 1, attack = 0.002, delay = 0, bus = null, reverb = 0, pan = 0 }) {
    if (!this.ready || !this.settings.sfx) return null;
    const c = this.ctx, t0 = c.currentTime + delay;
    const src = this._noise();
    const f = c.createBiquadFilter();
    f.type = filter; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (to != null) f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g);
    let out = g;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(bus || this.nodes.sfxBus);
    if (reverb) { const s = c.createGain(); s.gain.value = reverb; out.connect(s); s.connect(this.nodes.revSend); }
    src.start(t0);
    this._track(src, t0 + dur + 0.05);
    return src;
  }
  /** FM 音色 */
  fm({ carrier = 440, ratio = 2, index = 220, dur = 0.3, gain = 0.25, type = 'sine', delay = 0, decayRatio = 0.5 }) {
    if (!this.ready || !this.settings.sfx) return null;
    const c = this.ctx, t0 = c.currentTime + delay;
    const car = c.createOscillator(); car.type = type; car.frequency.value = carrier;
    const mod = c.createOscillator(); mod.type = 'sine'; mod.frequency.value = carrier * ratio;
    const mg = c.createGain(); mg.gain.setValueAtTime(index, t0);
    mg.gain.exponentialRampToValueAtTime(1, t0 + dur * decayRatio);
    mod.connect(mg); mg.connect(car.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    car.connect(g); g.connect(this.nodes.sfxBus);
    mod.start(t0); car.start(t0);
    this._track(mod, t0 + dur + 0.05); this._track(car, t0 + dur + 0.05);
    return car;
  }

  // ---------- SFX 预设库 ----------
  sfx(name, opts = {}) {
    if (!this.ready || !this.settings.sfx) return;
    const o = { ...opts };
    const v = o.gain ?? 1;
    switch (name) {
      case 'click': this.tone({ freq: 620, to: 880, type: 'triangle', dur: 0.06, gain: 0.14 * v }); break;
      case 'hover': this.tone({ freq: 900, type: 'sine', dur: 0.04, gain: 0.06 * v }); break;
      case 'select': this.tone({ freq: 520, to: 780, type: 'square', dur: 0.09, gain: 0.1 * v, filter: 2400 }); break;
      case 'back': this.tone({ freq: 420, to: 220, type: 'triangle', dur: 0.12, gain: 0.12 * v }); break;
      case 'error': this.tone({ freq: 180, to: 90, type: 'sawtooth', dur: 0.22, gain: 0.16 * v, filter: 900 }); break;
      case 'confirm': this.tone({ freq: 523, type: 'triangle', dur: 0.1, gain: 0.14 * v }); this.tone({ freq: 784, type: 'triangle', dur: 0.16, gain: 0.12 * v, delay: 0.07 }); break;
      case 'shoot': this.tone({ freq: 880, to: 220, type: 'square', dur: 0.09, gain: 0.16 * v, filter: 3200, q: 2 }); this.noise({ dur: 0.06, gain: 0.07 * v, freq: 2600, filter: 'highpass' }); break;
      case 'laser': this.tone({ freq: 1600, to: 180, type: 'sawtooth', dur: 0.28, gain: 0.13 * v, filter: 2600, q: 6 }); break;
      case 'hit': this.noise({ dur: 0.09, gain: 0.2 * v, freq: 900, to: 200, filter: 'bandpass', q: 1.5 }); this.tone({ freq: 150, to: 60, type: 'square', dur: 0.08, gain: 0.14 * v }); break;
      case 'explode': this.noise({ dur: 0.5, gain: 0.34 * v, freq: 800, to: 60, filter: 'lowpass', q: 1, reverb: 0.35 }); this.tone({ freq: 90, to: 30, type: 'sawtooth', dur: 0.4, gain: 0.2 * v, filter: 500 }); break;
      case 'jump': this.tone({ freq: 300, to: 720, type: 'triangle', dur: 0.13, gain: 0.14 * v }); break;
      case 'land': this.noise({ dur: 0.07, gain: 0.12 * v, freq: 400, filter: 'lowpass' }); this.tone({ freq: 140, to: 70, type: 'sine', dur: 0.09, gain: 0.11 * v }); break;
      case 'dash': this.noise({ dur: 0.22, gain: 0.16 * v, freq: 300, to: 3200, filter: 'bandpass', q: 2 }); break;
      case 'coin': this.tone({ freq: 988, type: 'square', dur: 0.07, gain: 0.1 * v }); this.tone({ freq: 1319, type: 'square', dur: 0.16, gain: 0.1 * v, delay: 0.06 }); break;
      case 'powerup': for (let i = 0; i < 4; i++) this.tone({ freq: 440 * Math.pow(2, i / 4), type: 'triangle', dur: 0.09, gain: 0.1 * v, delay: i * 0.045 }); break;
      case 'heal': this.tone({ freq: 523, to: 784, type: 'sine', dur: 0.3, gain: 0.12 * v, reverb: 0.4 }); break;
      case 'hurt': this.tone({ freq: 320, to: 110, type: 'sawtooth', dur: 0.24, gain: 0.18 * v, filter: 1200 }); break;
      case 'die': this.tone({ freq: 400, to: 50, type: 'sawtooth', dur: 0.7, gain: 0.2 * v, filter: 800 }); this.noise({ dur: 0.5, gain: 0.12 * v, freq: 600, to: 80, filter: 'lowpass' }); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.28, gain: 0.13 * v, delay: i * 0.11, reverb: 0.4 })); break;
      case 'lose': [392, 349, 294, 233].forEach((f, i) => this.tone({ freq: f, type: 'sawtooth', dur: 0.34, gain: 0.12 * v, delay: i * 0.14, filter: 900 })); break;
      case 'combo': { const p = Math.min(12, o.combo || 1); this.tone({ freq: 440 * Math.pow(2, p / 12), type: 'square', dur: 0.07, gain: 0.09 * v, filter: 4000 }); break; }
      case 'place': this.tone({ freq: 220, to: 330, type: 'square', dur: 0.07, gain: 0.12 * v, filter: 1600 }); this.noise({ dur: 0.05, gain: 0.06 * v, freq: 1800 }); break;
      case 'portal': this.fm({ carrier: 220, ratio: 3.5, index: 400, dur: 0.4, gain: 0.14 * v }); break;
      case 'reflect': this.tone({ freq: 1400, to: 2400, type: 'sine', dur: 0.08, gain: 0.09 * v }); break;
      case 'charge': this.tone({ freq: 120, to: 900, type: 'sawtooth', dur: o.dur || 0.6, gain: 0.1 * v, filter: 1400, q: 4 }); break;
      case 'alarm': for (let i = 0; i < 3; i++) this.tone({ freq: 880, to: 660, type: 'square', dur: 0.12, gain: 0.1 * v, delay: i * 0.18 }); break;
      case 'tick': this.tone({ freq: 1600, type: 'square', dur: 0.03, gain: 0.05 * v }); break;
      case 'swap': this.noise({ dur: 0.14, gain: 0.1 * v, freq: 600, to: 2400, filter: 'bandpass', q: 3 }); break;
      case 'build': this.noise({ dur: 0.12, gain: 0.13 * v, freq: 1200, filter: 'lowpass' }); this.tone({ freq: 300, to: 460, type: 'square', dur: 0.1, gain: 0.1 * v }); break;
      case 'lock': this.tone({ freq: 140, type: 'square', dur: 0.06, gain: 0.14 * v, filter: 700 }); break;
      case 'whoosh': this.noise({ dur: 0.3, gain: 0.12 * v, freq: 200, to: 1800, filter: 'bandpass', q: 1.2 }); break;
      default: this.tone({ freq: o.freq || 440, type: o.type || 'sine', dur: o.dur || 0.15, gain: 0.12 * v });
    }
  }

  // ---------- 设置 ----------
  setMaster(v) { if (this.ready) this.nodes.master.gain.value = v; }
  setMusic(on) { if (this.ready) this.nodes.musicBus.gain.setTargetAtTime(on ? 0.5 : 0, this.t, 0.08); this.settings.music = on; }
  setSfx(on) { if (this.ready) this.nodes.sfxBus.gain.setTargetAtTime(on ? 0.85 : 0, this.t, 0.05); this.settings.sfx = on; }
  duck(amount = 0.4, ms = 400) {
    if (!this.ready) return;
    const g = this.nodes.musicBus.gain, now = this.t;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(0.5 * (1 - amount), now, 0.03);
    g.setTargetAtTime(0.5, now + ms / 1000, 0.12);
  }
  panic(fade = 0.15) {
    if (!this.ready) return;
    this.nodes.master.gain.setTargetAtTime(0.0001, this.t, fade / 3);
    setTimeout(() => { if (this.ready) this.nodes.master.gain.setTargetAtTime(this.settings.master ?? 0.7, this.t, 0.2); }, fade * 1000);
  }
  destroy() { this.stopMusic(); try { this.ctx?.close(); } catch { /* ignore */ } this.ready = false; this.ctx = null; engine = null; }

  // ---------- BGM ----------
  /** @param {object} track 曲目定义；@param {number} bpm */
  playMusic(trackName, opts = {}) {
    if (!this.ready) return null;
    this.stopMusic();
    const track = TRACKS[trackName] || TRACKS.menu;
    this.music = new Sequencer(this, track, opts);
    this.music.start();
    return this.music;
  }
  stopMusic(fade = 0.4) { if (this.music) { this.music.stop(fade); this.music = null; } }
  setMusicIntensity(v) { this.music?.setIntensity(v); }
}

// ---------- 程序化音乐 ----------
const SCALE = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], pentatonic: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10] };
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export const TRACKS = {
  menu: { bpm: 92, root: 57, scale: 'minor', prog: [0, 5, 3, 4], drums: 'chill', lead: 'pad', bars: 4, intensity: 0.5 },
  arcade: { bpm: 128, root: 60, scale: 'minor', prog: [0, 3, 5, 4], drums: 'four', lead: 'arp', bars: 4, intensity: 0.8 },
  battle: { bpm: 150, root: 55, scale: 'phrygian', prog: [0, 0, 5, 6], drums: 'break', lead: 'stabs', bars: 4, intensity: 1 },
  puzzle: { bpm: 76, root: 62, scale: 'lydian', prog: [0, 4, 2, 5], drums: 'none', lead: 'pad', bars: 4, intensity: 0.35 },
  chase: { bpm: 168, root: 52, scale: 'minor', prog: [0, 6, 5, 4], drums: 'drive', lead: 'pulse', bars: 4, intensity: 1 },
  space: { bpm: 66, root: 50, scale: 'dorian', prog: [0, 3, 4, 3], drums: 'none', lead: 'drift', bars: 8, intensity: 0.4 },
  victory: { bpm: 120, root: 60, scale: 'major', prog: [0, 4, 5, 3], drums: 'four', lead: 'fanfare', bars: 2, intensity: 1 },
  tense: { bpm: 140, root: 53, scale: 'blues', prog: [0, 0, 3, 4], drums: 'break', lead: 'pulse', bars: 4, intensity: 0.9 }
};

class Sequencer {
  constructor(engine, track, opts = {}) {
    this.e = engine;
    this.track = { ...track, ...opts };
    this.bpm = this.track.bpm;
    this.step = 0;
    this.next = 0;
    this.timer = 0;
    this.running = true;
    this.intensity = this.track.intensity ?? 0.7;
    this.lookahead = 0.12;
    this.gain = engine.ctx.createGain();
    this.gain.gain.value = 0.9;
    this.gain.connect(engine.nodes.musicBus);
    this._rng = opts.seed ? (() => { let s = opts.seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })() : Math.random;
  }
  start() {
    this.next = this.e.t + 0.06;
    const loop = () => {
      if (!this.running) return;
      const spb = 60 / this.bpm / 4; // 16分音符
      while (this.next < this.e.t + this.lookahead) {
        this._schedule(this.step, this.next);
        this.next += spb;
        this.step++;
      }
      this.timer = setTimeout(loop, 40);
    };
    loop();
  }
  setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v)); }
  stop(fade = 0.4) {
    this.running = false;
    clearTimeout(this.timer);
    try {
      this.gain.gain.setTargetAtTime(0, this.e.t, fade / 3);
      setTimeout(() => { try { this.gain.disconnect(); } catch { /* ignore */ } }, fade * 1000 + 60);
    } catch { /* ignore */ }
  }
  _schedule(step, t) {
    const tr = this.track;
    const sc = SCALE[tr.scale] || SCALE.minor;
    const bar = Math.floor(step / 16) % tr.bars;
    const s16 = step % 16;
    const deg = tr.prog[bar % tr.prog.length];
    const rootMidi = tr.root + sc[deg % sc.length];
    const I = this.intensity;
    const e = this.e;
    const M = (n, o = 0) => midi(n + o);

    // --- 鼓 ---
    const D = tr.drums;
    if (D !== 'none') {
      const kickOn = D === 'four' ? (s16 % 4 === 0) : D === 'break' ? (s16 === 0 || s16 === 6 || s16 === 10) : D === 'drive' ? (s16 % 2 === 0) : (s16 === 0 || s16 === 8);
      if (kickOn) this._kick(t);
      const snareOn = D === 'four' ? (s16 === 4 || s16 === 12) : D === 'break' ? (s16 === 4 || s16 === 12 || s16 === 14) : D === 'drive' ? (s16 % 8 === 4) : (s16 === 8);
      if (snareOn && I > 0.35) this._snare(t);
      const hatOn = D === 'chill' ? (s16 % 4 === 2) : (s16 % 2 === 0 || Math.random() < 0.25);
      if (hatOn) this._hat(t, s16 % 4 === 0 ? 0.05 : 0.03);
    }
    // --- 贝斯 ---
    if (s16 % 2 === 0 || D === 'drive') {
      const bn = rootMidi - 12;
      if (s16 % 4 === 0 || s16 === 6 || s16 === 11) this._bass(M(bn), t, s16 % 8 === 0 ? 0.22 : 0.14);
    }
    // --- 和声垫 ---
    if (s16 === 0) this._pad([M(rootMidi), M(rootMidi + 3), M(rootMidi + 7)], t, (60 / this.bpm) * 4 * 0.95);
    // --- 主旋律 ---
    const L = tr.lead;
    if (L === 'arp' && s16 % 2 === 0) {
      const seq = [0, 3, 7, 10, 7, 3, 12, 7];
      this._pluck(M(rootMidi + 12 + seq[(step / 2 | 0) % seq.length]), t);
    } else if (L === 'pulse' && s16 % 2 === 1) {
      this._pluck(M(rootMidi + 12 + sc[(step * 3) % sc.length]), t, 0.06);
    } else if (L === 'stabs' && (s16 === 2 || s16 === 7 || s16 === 10)) {
      this._stab([M(rootMidi + 12), M(rootMidi + 15), M(rootMidi + 19)], t);
    } else if (L === 'drift' && s16 % 8 === 0) {
      this._pluck(M(rootMidi + 24 + sc[(step / 8) % sc.length]), t, 0.5, 0.06);
    } else if (L === 'fanfare' && s16 % 4 === 0) {
      [0, 4, 7, 12].forEach((iv, i) => this._pluck(M(rootMidi + 12 + iv), t + i * 0.05, 0.22));
    }
  }
  _env(g, t, a, d, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  _kick(t) {
    const e = this.e, c = e.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    this._env(g, t, 0.004, 0.22, 0.6 * (0.5 + this.intensity * 0.5));
    o.connect(g); g.connect(this.gain);
    o.start(t); e._track(o, t + 0.3);
  }
  _snare(t) {
    const e = this.e, c = e.ctx;
    const n = e._noise(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'highpass'; f.frequency.value = 1400;
    this._env(g, t, 0.002, 0.13, 0.24 * this.intensity);
    n.connect(f); f.connect(g); g.connect(this.gain);
    const s = c.createGain(); s.gain.value = 0.2; g.connect(s); s.connect(e.nodes.revSend);
    n.start(t); e._track(n, t + 0.2);
  }
  _hat(t, peak) {
    const e = this.e, c = e.ctx;
    const n = e._noise(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'highpass'; f.frequency.value = 7000;
    this._env(g, t, 0.001, 0.045, peak * this.intensity);
    n.connect(f); f.connect(g); g.connect(this.gain);
    n.start(t); e._track(n, t + 0.08);
  }
  _bass(freq, t, peak) {
    const e = this.e, c = e.ctx;
    const o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = freq;
    o2.type = 'square'; o2.frequency.value = freq / 2;
    f.type = 'lowpass'; f.frequency.setValueAtTime(320 + this.intensity * 700, t);
    f.Q.value = 6;
    this._env(g, t, 0.008, 0.18, peak * (0.6 + this.intensity * 0.4));
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.gain);
    o.start(t); o2.start(t); e._track(o, t + 0.3); e._track(o2, t + 0.3);
  }
  _pluck(freq, t, dur = 0.2, peak = 0.1) {
    const e = this.e, c = e.ctx;
    const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.value = 2600;
    this._env(g, t, 0.004, dur, peak * (0.6 + this.intensity * 0.4));
    o.connect(f); f.connect(g); g.connect(this.gain);
    const s = c.createGain(); s.gain.value = 0.28; g.connect(s); s.connect(e.nodes.revSend);
    o.start(t); e._track(o, t + dur + 0.1);
  }
  _pad(freqs, t, dur) {
    const e = this.e, c = e.ctx;
    for (const fq of freqs) {
      const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = fq; o.detune.value = -6;
      o2.type = 'sawtooth'; o2.frequency.value = fq; o2.detune.value = 7;
      f.type = 'lowpass'; f.frequency.value = 900 + this.intensity * 900;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05 * (0.5 + this.intensity * 0.5), t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(this.gain);
      const s = c.createGain(); s.gain.value = 0.4; g.connect(s); s.connect(e.nodes.revSend);
      o.start(t); o2.start(t); e._track(o, t + dur + 0.1); e._track(o2, t + dur + 0.1);
    }
  }
  _stab(freqs, t) {
    const e = this.e, c = e.ctx;
    for (const fq of freqs) {
      const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = 'square'; o.frequency.value = fq;
      f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t);
      f.frequency.exponentialRampToValueAtTime(700, t + 0.14);
      this._env(g, t, 0.003, 0.14, 0.07 * this.intensity);
      o.connect(f); f.connect(g); g.connect(this.gain);
      o.start(t); e._track(o, t + 0.2);
    }
  }
}

export const SFX_LIST = ['click', 'hover', 'select', 'back', 'error', 'confirm', 'shoot', 'laser', 'hit', 'explode', 'jump', 'land', 'dash', 'coin', 'powerup', 'heal', 'hurt', 'die', 'win', 'lose', 'combo', 'place', 'portal', 'reflect', 'charge', 'alarm', 'tick', 'swap', 'build', 'lock', 'whoosh'];
