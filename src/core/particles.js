// 粒子系统：SoA 存储（零 GC）+ 对象池发射器 + 多种预设效果
// 单场景可稳定承载 3000+ 粒子

import { TAU, clamp01, hexToRgb } from './math.js';

export class Particles {
  constructor(cap = 2000) {
    this.cap = cap;
    this.f = {
      x: new Float32Array(cap), y: new Float32Array(cap),
      vx: new Float32Array(cap), vy: new Float32Array(cap),
      life: new Float32Array(cap), max: new Float32Array(cap),
      size: new Float32Array(cap), rot: new Float32Array(cap),
      vr: new Float32Array(cap), grav: new Float32Array(cap),
      drag: new Float32Array(cap), kind: new Uint8Array(cap),
      hue: new Float32Array(cap), sat: new Float32Array(cap), lig: new Float32Array(cap),
      seed: new Float32Array(cap)
    };
    this.n = 0;
    this.gravity = 0;
    this.wrap = null; // {w,h} 环绕边界
  }
  get count() { return this.n; }
  clear() { this.n = 0; }

  emit(opts) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    const f = this.f;
    f.x[i] = opts.x; f.y[i] = opts.y;
    f.vx[i] = opts.vx || 0; f.vy[i] = opts.vy || 0;
    f.max[i] = f.life[i] = opts.life ?? 0.8;
    f.size[i] = opts.size ?? 3;
    f.rot[i] = opts.rot || 0; f.vr[i] = opts.vr || 0;
    f.grav[i] = opts.grav ?? this.gravity;
    f.drag[i] = opts.drag ?? 0.6;
    f.kind[i] = opts.kind ?? 0; // 0 dot 1 spark 2 smoke 3 ring 4 square 5 debris
    const c = opts.color ?? '#22e0ff';
    if (c[0] === '#') { const [r, g, b] = hexToRgb(c); const hsl = rgb2hsl(r, g, b); f.hue[i] = hsl[0]; f.sat[i] = hsl[1]; f.lig[i] = hsl[2]; }
    else { f.hue[i] = opts.hue ?? 190; f.sat[i] = 100; f.lig[i] = 60; }
    f.seed[i] = Math.random() * 100;
    return i;
  }

  update(dt) {
    const f = this.f;
    const g = this.gravity;
    for (let i = 0; i < this.n; i++) {
      f.life[i] -= dt;
      if (f.life[i] <= 0) {
        // 与末尾交换（不保序，O(1) 回收）
        const j = --this.n;
        if (j !== i) for (const k in f) f[k][i] = f[k][j];
        i--; continue;
      }
      f.vy[i] += g * dt;
      const d = 1 - f.drag[i] * dt;
      f.vx[i] *= d; f.vy[i] *= d;
      f.x[i] += f.vx[i] * dt;
      f.y[i] += f.vy[i] * dt;
      f.rot[i] += f.vr[i] * dt;
    }
  }

  render(ctx, quality = 1) {
    const f = this.f;
    const n = this.n;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const t = clamp01(f.life[i] / f.max[i]);
      const x = f.x[i], y = f.y[i], s = f.size[i] * (0.35 + t * 0.65);
      const a = t * t;
      const h = f.hue[i], sa = f.sat[i], l = f.lig[i] * (0.55 + t * 0.45);
      const kind = f.kind[i];
      if (kind === 0) { // dot
        ctx.fillStyle = `hsla(${h},${sa}%,${l}%,${a})`;
        ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill();
      } else if (kind === 1) { // spark (拖尾线)
        const len = Math.min(18, Math.hypot(f.vx[i], f.vy[i]) * 0.035);
        const ang = Math.atan2(f.vy[i], f.vx[i]);
        ctx.strokeStyle = `hsla(${h},${sa}%,${Math.min(85, l + 20)}%,${a})`;
        ctx.lineWidth = Math.max(1, s * 0.7);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(ang) * len, y - Math.sin(ang) * len); ctx.stroke();
      } else if (kind === 2) { // smoke
        const r = s * (2.4 - t * 1.2);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `hsla(${h},${sa * 0.5}%,${l}%,${a * 0.35})`);
        g.addColorStop(1, `hsla(${h},${sa * 0.5}%,${l}%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      } else if (kind === 3) { // ring
        const r = s * (1 + (1 - t) * 3.2);
        ctx.strokeStyle = `hsla(${h},${sa}%,${Math.min(88, l + 18)}%,${a * 0.85})`;
        ctx.lineWidth = Math.max(0.8, s * 0.5 * t);
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      } else if (kind === 4) { // square
        ctx.save(); ctx.translate(x, y); ctx.rotate(f.rot[i]);
        ctx.fillStyle = `hsla(${h},${sa}%,${l}%,${a})`;
        ctx.fillRect(-s, -s, s * 2, s * 2); ctx.restore();
      } else { // debris 三角形
        ctx.save(); ctx.translate(x, y); ctx.rotate(f.rot[i]);
        ctx.fillStyle = `hsla(${h},${sa}%,${l}%,${a})`;
        ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * .9, s * .8); ctx.lineTo(-s * .9, s * .8); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // ---------- 预设效果 ----------
  burst(x, y, count = 14, opts = {}) {
    const c = Math.min(count, this.cap - this.n);
    const spd = opts.speed ?? 160;
    for (let i = 0; i < c; i++) {
      const a = opts.angle != null ? opts.angle + (Math.random() - .5) * (opts.spread ?? TAU) : Math.random() * TAU;
      const v = spd * (0.35 + Math.random() * 0.9);
      this.emit({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: (opts.life ?? 0.6) * (0.6 + Math.random() * 0.7),
        size: (opts.size ?? 3) * (0.6 + Math.random() * 0.8),
        color: opts.color ?? '#22e0ff', kind: opts.kind ?? 1,
        grav: opts.grav ?? 0, drag: opts.drag ?? 1.6
      });
    }
  }
  explosion(x, y, scale = 1, color = '#ffb020') {
    this.burst(x, y, Math.round(26 * scale), { speed: 260 * scale, color, life: 0.55, size: 4 * scale, kind: 1, drag: 2.2 });
    this.burst(x, y, Math.round(14 * scale), { speed: 90 * scale, color: '#ff4d5e', life: 0.9, size: 9 * scale, kind: 2, drag: 1.2 });
    this.ring(x, y, color, 60 * scale);
  }
  ring(x, y, color = '#22e0ff', r = 40) {
    for (let i = 0; i < 3; i++) this.emit({ x, y, life: 0.42 + i * 0.1, size: r * 0.25, color, kind: 3, drag: 0 });
  }
  trail(x, y, color = '#22e0ff', size = 2.6) {
    this.emit({ x, y, vx: (Math.random() - .5) * 24, vy: (Math.random() - .5) * 24, life: 0.34, size, color, kind: 0, drag: 3 });
  }
  sparkle(x, y, color = '#8dff4d') {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * TAU;
      this.emit({ x, y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 - 30, life: 0.5, size: 2.4, color, kind: 1, grav: 120, drag: 1.4 });
    }
  }
  text(x, y, str, color) { this._floatTexts = this._floatTexts || []; this._floatTexts.push({ x, y, str, color, life: 0.9, max: 0.9 }); }
  renderTexts(ctx, dt) {
    if (!this._floatTexts?.length) return;
    ctx.save(); ctx.textAlign = 'center'; ctx.font = '700 14px system-ui, sans-serif';
    for (let i = this._floatTexts.length - 1; i >= 0; i--) {
      const t = this._floatTexts[i];
      t.life -= dt; t.y -= 34 * dt;
      if (t.life <= 0) { this._floatTexts.splice(i, 1); continue; }
      const a = clamp01(t.life / t.max);
      ctx.globalAlpha = a; ctx.fillStyle = t.color;
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3;
      ctx.strokeText(t.str, t.x, t.y); ctx.fillText(t.str, t.x, t.y);
    }
    ctx.restore();
  }
}

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d) {
    s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}
