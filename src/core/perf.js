// 性能监控 + 自适应画质降级（保证 1% low 帧不崩）

import { getSettings, setSetting } from './storage.js';

const SAMPLES = 120;

export class PerfMonitor {
  constructor() {
    this.samples = new Float32Array(SAMPLES);
    this.i = 0; this.n = 0;
    this.fps = 60; this.low1 = 60; this.avg = 60; this.p95 = 60;
    this.frameMs = 16.7;
    this.updateMs = 0; this.renderMs = 0;
    this.tier = 1;            // 1 = 满配, 0.7 = 中, 0.45 = 低
    this.autoScale = getSettings().quality === 'auto';
    this.staticLow = { auto: 1, high: 1, medium: 0.7, low: 0.45 }[getSettings().quality] ?? 1;
    this.tier = this.autoScale ? this.tier : this.staticLow;
    this.onTierChange = null;
    this._acc = 0; this._frames = 0; this._last = performance.now();
    this._stable = 0;
    this.jank = 0;            // 卡帧计数
    this.paused = false;
  }
  /** 每帧调用，dtMs 为本帧总耗时 */
  frame(dtMs, updateMs, renderMs) {
    this.samples[this.i] = dtMs;
    this.i = (this.i + 1) % SAMPLES;
    if (this.n < SAMPLES) this.n++;
    this.frameMs = this.frameMs * 0.9 + dtMs * 0.1;
    this.updateMs = this.updateMs * 0.9 + updateMs * 0.1;
    this.renderMs = this.renderMs * 0.9 + renderMs * 0.1;
    this._acc += dtMs; this._frames++;
    const now = performance.now();
    if (now - this._last >= 500) {
      this.avg = 1000 / (this._acc / this._frames);
      // 排序求 1% low（最慢的 1% 帧）
      const arr = Array.from(this.samples.slice(0, this.n)).sort((a, b) => b - a);
      const li = Math.max(0, Math.floor(arr.length * 0.01));
      this.low1 = 1000 / (arr[li] || 16.7);
      this.p95 = 1000 / (arr[Math.floor(arr.length * 0.05)] || 16.7);
      this.fps = this.avg;
      this.jank = arr.filter(x => x > 33).length;
      this._acc = 0; this._frames = 0; this._last = now;
      if (this.autoScale) this._adapt();
    }
  }
  _adapt() {
    const prev = this.tier;
    if (this.low1 < 34 || this.jank > 12) { this._stable++; }
    else if (this.low1 > 56 && this.jank < 4) { this._stable--; }
    else this._stable = Math.max(0, this._stable - 1);
    if (this._stable > 2 && this.tier > 0.45) { this.tier = Math.max(0.45, this.tier - 0.3); this._stable = 0; }
    else if (this._stable < -6 && this.tier < 1) { this.tier = Math.min(1, this.tier + 0.15); this._stable = 0; }
    if (Math.abs(prev - this.tier) > 0.01 && this.onTierChange) this.onTierChange(this.tier);
  }
  setQuality(q) {
    setSetting('quality', q);
    this.autoScale = q === 'auto';
    this.staticLow = { auto: 1, high: 1, medium: 0.7, low: 0.45 }[q] ?? 1;
    this.tier = this.autoScale ? this.tier : this.staticLow;
  }
  get isLow() { return this.tier < 0.6; }
  /** 粒子预算：根据档位返回建议上限 */
  particleBudget(base) { return Math.max(60, Math.round(base * this.tier)); }
  report() {
    return { fps: +this.fps.toFixed(1), low1: +this.low1.toFixed(1), p95: +this.p95.toFixed(1), update: +this.updateMs.toFixed(2), render: +this.renderMs.toFixed(2), tier: +this.tier.toFixed(2), jank: this.jank };
  }
}
