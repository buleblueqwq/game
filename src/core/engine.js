// 主循环：requestAnimationFrame + 固定时间步逻辑 + 渲染插值
// 保证"帧率越高游戏越快"不会发生；后台自动暂停；掉帧时补步但有上限（防死亡螺旋）

import { PerfMonitor } from './perf.js';
import { reportError, caps } from './errors.js';

export const FIXED_DT = 1 / 60;
const MAX_STEPS = 5;          // 单帧最多补 5 步（83ms），多余丢弃
const STEP_MS = FIXED_DT * 1000;

export class Engine {
  /**
   * @param {object} opts
   * @param {(dt:number,step:number)=>void} opts.update 固定步更新
   * @param {(alpha:number,frameDt:number)=>void} opts.render 渲染（alpha 为插值系数）
   * @param {number} opts.rate 逻辑频率（默认 60Hz）
   */
  constructor({ update, render, rate = 60, onPause, onResume, onStats }) {
    this.update = update;
    this.render = render;
    this.dt = 1 / rate;
    this.stepMs = 1000 / rate;
    this.perf = new PerfMonitor();
    this.onPause = onPause; this.onResume = onResume; this.onStats = onStats;
    this.running = false;
    this.paused = false;
    this.hiddenPause = false;
    this.acc = 0;
    this.step = 0;
    this.time = 0;             // 逻辑时间（秒）
    this.alpha = 0;
    this._raf = 0;
    this._last = 0;
    this._visHandler = this._onVis.bind(this);
    this._resumeHandler = this._onVis.bind(this);
    document.addEventListener('visibilitychange', this._visHandler);
    addEventListener('pagehide', this._visHandler);
    addEventListener('pageshow', this._resumeHandler);
    this.perf.onTierChange = (t) => { try { this.onStats?.(this.perf.report(), t); } catch { /* ignore */ } };
  }
  _onVis() {
    if (document.hidden) {
      if (this.running && !this.paused) { this.hiddenPause = true; this.pause(true); }
    } else if (this.hiddenPause) {
      this.hiddenPause = false; this.resume();
    }
  }
  start() {
    if (this.running) return;
    this.running = true; this.paused = false;
    this._last = performance.now();
    this.acc = 0;
    const tick = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(tick);
      let frameMs = now - this._last;
      this._last = now;
      // 标签页恢复 / 长卡顿：钳制，防止一次性补上百步
      if (frameMs > 250) frameMs = this.stepMs;
      this.acc += frameMs;
      const t0 = performance.now();
      let steps = 0;
      while (this.acc >= this.stepMs && steps < MAX_STEPS) {
        this.acc -= this.stepMs;
        this.step++;
        this.time += this.dt;
        try { this.update(this.dt, this.step); }
        catch (err) { reportError('engine.update', err, true); this.pause(); break; }
        steps++;
      }
      if (this.acc > this.stepMs * MAX_STEPS) this.acc = 0;
      const t1 = performance.now();
      this.alpha = this.paused ? this.alpha : this.acc / this.stepMs;
      try { this.render(this.alpha, frameMs / 1000); }
      catch (err) { reportError('engine.render', err, true); this.pause(); }
      const t2 = performance.now();
      this.perf.frame(frameMs, t1 - t0, t2 - t1);
    };
    this._raf = requestAnimationFrame(tick);
  }
  pause(silent = false) {
    if (!this.running || this.paused) return;
    this.paused = true;
    if (!silent) try { this.onPause?.(); } catch { /* ignore */ }
  }
  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this._last = performance.now();
    this.acc = 0;
    try { this.onResume?.(); } catch { /* ignore */ }
  }
  toggle() { this.paused ? this.resume() : this.pause(); }
  stop() {
    this.running = false; this.paused = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    document.removeEventListener('visibilitychange', this._visHandler);
    removeEventListener('pagehide', this._visHandler);
    removeEventListener('pageshow', this._resumeHandler);
  }
}

/**
 * 输入延迟测量：从事件时间戳到实际渲染帧。
 * 用于自检 <50ms 预算。
 */
export class LatencyProbe {
  constructor() { this.samples = []; this.max = 32; }
  mark(eventTs) { this.samples.push(performance.now() - eventTs); if (this.samples.length > this.max) this.samples.shift(); }
  get p95() {
    if (!this.samples.length) return 0;
    const s = [...this.samples].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  }
}

/** 简单的 Web Worker 池（寻路 / 遗传算法 / 噪声生成等） */
export class WorkerPool {
  constructor(size = Math.max(1, Math.min(4, (caps.cores || 4) - 1))) {
    this.size = size;
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.seq = 0;
    this.pending = new Map();
    this.src = null;
    this.broken = false;
  }
  /** @param {string} src worker 脚本 URL（同源） */
  init(src) {
    this.src = src;
    for (let i = 0; i < this.size; i++) {
      try {
        const w = new Worker(src, { type: 'module' });
        w.onmessage = (e) => {
          const { id, ok, result, error } = e.data || {};
          const p = this.pending.get(id);
          if (p) { this.pending.delete(id); ok ? p.resolve(result) : p.reject(new Error(error)); }
          this.idle.push(w); this._flush();
        };
        w.onerror = () => { this.broken = true; };
        this.workers.push(w); this.idle.push(w);
      } catch { this.broken = true; break; }
    }
    return !this.broken;
  }
  run(type, payload, timeout = 4000) {
    if (this.broken || !this.workers.length) return Promise.reject(new Error('worker-unavailable'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('worker-timeout')); }, timeout);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      this.queue.push({ id, type, payload });
      this._flush();
    });
  }
  _flush() {
    while (this.queue.length && this.idle.length) {
      const job = this.queue.shift();
      const w = this.idle.pop();
      try { w.postMessage(job); } catch { this.broken = true; this.queue.unshift(job); break; }
    }
  }
  destroy() { this.workers.forEach(w => w.terminate()); this.workers = []; this.idle = []; this.pending.clear(); }
}
