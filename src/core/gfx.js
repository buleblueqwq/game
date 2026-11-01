// Canvas2D 高级绘制辅助：霓虹发光、圆角、渐变、网格、扫描线、屏幕震动、离屏缓存、文字排版
// 全部为纯函数/无状态工具，游戏随取随用

import { TAU, clamp, clamp01, lerp, hexToRgb, rgba as hexA } from './math.js';

/** 初始化画布尺寸（含 DPR、上限保护） */
export function fitCanvas(canvas, ctx, dpr = 1) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
  const d = Math.min(dpr, 2);
  if (canvas.width !== w * d || canvas.height !== h * d) {
    canvas.width = Math.round(w * d); canvas.height = Math.round(h * d);
  }
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return { w, h, dpr: d };
}

/** 创建离屏画布（缓存静态图层） */
export function offscreen(w, h, dpr = 1) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { canvas: c, ctx: x, w, h };
}

export function roundRect(ctx, x, y, w, h, r = 6) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function fillRound(ctx, x, y, w, h, r, fill) { roundRect(ctx, x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); }
export function strokeRound(ctx, x, y, w, h, r, stroke, lw = 2) { roundRect(ctx, x, y, w, h, r); ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }

/** 霓虹发光描边：多层叠加模拟 bloom（低档位自动减层） */
export function neon(ctx, drawPath, color, { glow = 12, layers = 3, width = 2, alpha = 1, inner = '#fff' } = {}) {
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const [r, g, b] = hexToRgb(color);
  for (let i = layers; i >= 1; i--) {
    ctx.beginPath(); drawPath(ctx);
    ctx.lineWidth = width + (glow / layers) * i * 2;
    ctx.strokeStyle = `rgba(${r},${g},${b},${(0.10 + 0.06 * (layers - i)) * alpha})`;
    ctx.stroke();
  }
  ctx.beginPath(); drawPath(ctx);
  ctx.lineWidth = width;
  ctx.strokeStyle = hexA(color, alpha);
  ctx.stroke();
  if (inner) {
    ctx.beginPath(); drawPath(ctx);
    ctx.lineWidth = Math.max(0.5, width * 0.38);
    ctx.strokeStyle = hexA(inner, 0.75 * alpha);
    ctx.stroke();
  }
  ctx.restore();
}

export function glowDot(ctx, x, y, r, color, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  const [rr, gg, bb] = hexToRgb(color);
  g.addColorStop(0, `rgba(${rr},${gg},${bb},${0.9 * alpha})`);
  g.addColorStop(0.4, `rgba(${rr},${gg},${bb},${0.35 * alpha})`);
  g.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

export function glowLine(ctx, x1, y1, x2, y2, color, width = 2, glow = 10, alpha = 1) {
  neon(ctx, (c) => { c.moveTo(x1, y1); c.lineTo(x2, y2); }, color, { glow, width, alpha, layers: 2, inner: null });
}

export function glowCircle(ctx, x, y, r, color, { glow = 14, width = 2, alpha = 1, fill = null } = {}) {
  if (fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  neon(ctx, (c) => c.arc(x, y, r, 0, TAU), color, { glow, width, alpha, layers: 2, inner: null });
}

export function glowRect(ctx, x, y, w, h, color, { glow = 12, width = 2, alpha = 1, r = 4, fill = null } = {}) {
  if (fill) { fillRound(ctx, x, y, w, h, r, fill); }
  neon(ctx, (c) => roundRect(c, x, y, w, h, r), color, { glow, width, alpha, layers: 2, inner: null });
}

/** 线性渐变填充 */
export function vgrad(ctx, x, y0, y1, colors) {
  const g = ctx.createLinearGradient(x, y0, x, y1);
  colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
  return g;
}
export function radial(ctx, x, y, r, colors) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
  return g;
}

/** 网格背景（会随相机偏移，营造运动感） */
export function grid(ctx, w, h, cell = 40, color = '#1b2440', lw = 1, ox = 0, oy = 0) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.beginPath();
  const sx = -(ox % cell), sy = -(oy % cell);
  for (let x = sx; x < w; x += cell) { ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, h); }
  for (let y = sy; y < h; y += cell) { ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(w, Math.round(y) + .5); }
  ctx.stroke();
  ctx.restore();
}

/** 透视地平线网格（3D 感背景） */
export function horizonGrid(ctx, w, h, t, color = '#2a3b6b', horizon = 0.42) {
  const hy = h * horizon;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -12; i <= 12; i++) {
    const x = w / 2 + i * (w / 14);
    ctx.moveTo(w / 2 + i * 12, hy); ctx.lineTo(x * 1.9 - w * 0.45, h);
  }
  const speed = 0.35;
  for (let i = 0; i < 18; i++) {
    let p = ((i / 18) + (t * speed) % 1) % 1;
    const y = hy + Math.pow(p, 2.4) * (h - hy);
    if (y > h) continue;
    ctx.moveTo(0, y); ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** 星空背景（带视差层，缓存到离屏） */
export function makeStarfield(w, h, count = 160, seedFn = Math.random) {
  const stars = [];
  for (let i = 0; i < count; i++) stars.push({ x: seedFn() * w, y: seedFn() * h, z: seedFn(), r: seedFn() * 1.6 + .3 });
  return {
    draw(ctx, t, ox = 0, oy = 0, alpha = 1) {
      ctx.save();
      for (const s of stars) {
        const px = (s.x - ox * s.z * 0.4) % w, py = (s.y - oy * s.z * 0.4) % h;
        const tw = 0.55 + 0.45 * Math.sin(t * 2 + s.x * 0.1 + s.y);
        ctx.globalAlpha = alpha * tw * (0.4 + s.z * 0.6);
        ctx.fillStyle = '#cfe4ff';
        ctx.fillRect((px + w) % w, (py + h) % h, s.r, s.r);
      }
      ctx.restore();
    }
  };
}

/** 扫描线 / CRT 后处理（低档位可关） */
export function scanlines(ctx, w, h, alpha = 0.06, gap = 3) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = '#000';
  for (let y = 0; y < h; y += gap) ctx.fillRect(0, y, w, 1);
  ctx.restore();
}
export function vignette(ctx, w, h, strength = 0.45) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
export function chromaticAberration(ctx, canvas, amount = 2) {
  if (!amount) return;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.18;
  ctx.drawImage(canvas, -amount, 0);
  ctx.globalAlpha = 0.14;
  ctx.drawImage(canvas, amount, 0);
  ctx.restore();
}

/** 文本：带描边/发光/自动换行 */
export function text(ctx, str, x, y, {
  size = 16, font = 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  color = '#fff', align = 'center', baseline = 'middle', weight = 600,
  stroke = null, lw = 3, glow = 0, alpha = 1, maxWidth = null, shadow = null
} = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align; ctx.textBaseline = baseline;
  if (shadow) { ctx.shadowColor = shadow; ctx.shadowBlur = 12; }
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y, maxWidth || undefined); }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y, maxWidth || undefined);
  ctx.restore();
}

/** 自动换行，返回行数 */
export function wrapText(ctx, str, x, y, maxW, lineH, opts = {}) {
  ctx.save();
  ctx.font = `${opts.weight || 400} ${opts.size || 14}px ${opts.font || 'system-ui, "PingFang SC", sans-serif'}`;
  ctx.textAlign = opts.align || 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = opts.color || '#fff';
  const chars = [...str];
  let line = '', ly = y, lines = 0;
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i];
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, ly); ly += lineH; lines++; line = chars[i];
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, ly); lines++; }
  ctx.restore();
  return lines;
}

/** 屏幕震动（ Trauma 模型：平方衰减，手感更好） */
export class ScreenShake {
  constructor() { this.trauma = 0; this.t = 0; this.x = 0; this.y = 0; this.rot = 0; }
  add(v) { this.trauma = clamp01(this.trauma + v); }
  update(dt) {
    this.t += dt;
    const s = this.trauma * this.trauma;
    const f = this.t * 46;
    this.x = s * 26 * (Math.sin(f * 1.7) + Math.sin(f * 3.1) * .5);
    this.y = s * 26 * (Math.cos(f * 2.3) + Math.cos(f * 4.7) * .5);
    this.rot = s * 0.045 * Math.sin(f * 1.1);
    this.trauma = Math.max(0, this.trauma - dt * 1.35);
  }
  apply(ctx) { if (this.trauma > 0.001) { ctx.translate(this.x, this.y); if (this.rot) ctx.rotate(this.rot); } }
}

/** 命中闪白 / 全屏闪光 */
export class Flash {
  constructor() { this.v = 0; this.color = '#fff'; }
  add(v = 0.5, color = '#fff') { this.v = Math.min(1, this.v + v); this.color = color; }
  update(dt) { this.v = Math.max(0, this.v - dt * 3.2); }
  draw(ctx, w, h) { if (this.v > 0.002) { ctx.save(); ctx.globalAlpha = this.v * 0.75; ctx.fillStyle = this.color; ctx.fillRect(0, 0, w, h); ctx.restore(); } }
}

/** 缓动相机（跟随 + 前瞻 + 边界约束） */
export class Camera {
  constructor(w, h) { this.x = 0; this.y = 0; this.tx = 0; this.ty = 0; this.zoom = 1; this.tzoom = 1; this.w = w; this.h = h; this.shake = new ScreenShake(); }
  follow(x, y, dt, lambda = 6) {
    this.tx = x; this.ty = y;
    this.x = lerp(this.x, x, 1 - Math.exp(-lambda * dt));
    this.y = lerp(this.y, y, 1 - Math.exp(-lambda * dt));
  }
  snap(x, y) { this.x = this.tx = x; this.y = this.ty = y; }
  clampTo(bounds) {
    this.x = clamp(this.x, bounds.x, bounds.x + bounds.w - this.w);
    this.y = clamp(this.y, bounds.y, bounds.y + bounds.h - this.h);
  }
  apply(ctx) {
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
    this.shake.apply(ctx);
  }
  toWorld(sx, sy) { return { x: (sx - this.w / 2) / this.zoom + this.x, y: (sy - this.h / 2) / this.zoom + this.y }; }
}

/** 进度条 / 血条（带缓动残影） */
export function bar(ctx, x, y, w, h, pct, { bg = '#1a2136', fill = '#4ade80', ghost = null, r = 3, glowColor = null } = {}) {
  pct = clamp01(pct);
  fillRound(ctx, x, y, w, h, r, bg);
  if (ghost != null && ghost > pct) fillRound(ctx, x, y, w * ghost, h, r, 'rgba(255,255,255,0.22)');
  if (pct > 0) {
    if (glowColor) { ctx.save(); ctx.shadowColor = glowColor; ctx.shadowBlur = 10; fillRound(ctx, x, y, w * pct, h, r, fill); ctx.restore(); }
    else fillRound(ctx, x, y, w * pct, h, r, fill);
  }
}

/** 绘制多边形（六边形战棋 / 物理用） */
export function poly(ctx, pts, close = true) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
}
export function hexPath(ctx, cx, cy, r, flat = true) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (flat ? 0 : Math.PI / 6) + i * TAU / 6;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}
export function star(ctx, cx, cy, r, spikes = 5, inner = 0.42, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = rot + i * Math.PI / spikes;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

/** 拖尾（用于子弹/玩家轨迹） */
export class Trail {
  constructor(n = 18) { this.pts = []; this.n = n; }
  push(x, y) { this.pts.push(x, y); if (this.pts.length > this.n * 2) this.pts.splice(0, 2); }
  draw(ctx, color, width = 6, alpha = 1) {
    if (this.pts.length < 4) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const [r, g, b] = hexToRgb(color);
    for (let i = 2; i < this.pts.length; i += 2) {
      const t = i / this.pts.length;
      ctx.strokeStyle = `rgba(${r},${g},${b},${t * alpha * 0.7})`;
      ctx.lineWidth = width * t;
      ctx.beginPath();
      ctx.moveTo(this.pts[i - 2], this.pts[i - 1]);
      ctx.lineTo(this.pts[i], this.pts[i + 1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  clear() { this.pts.length = 0; }
}

/** 数字滚动动画（分数、金币） */
export class Counter {
  constructor(v = 0, speed = 12) { this.v = v; this.target = v; this.speed = speed; }
  set(v) { this.target = v; }
  update(dt) {
    const d = this.target - this.v;
    if (Math.abs(d) < 0.5) this.v = this.target;
    else this.v += d * (1 - Math.exp(-this.speed * dt));
    return this.v;
  }
}

/** 简单 9-slice 面板 */
export function panel(ctx, x, y, w, h, { fill = 'rgba(12,16,30,0.86)', stroke = '#2b3a63', r = 10, lw = 1.5, glow = 0 } = {}) {
  ctx.save();
  if (glow) { ctx.shadowColor = stroke; ctx.shadowBlur = glow; }
  fillRound(ctx, x, y, w, h, r, fill);
  ctx.restore();
  strokeRound(ctx, x, y, w, h, r, stroke, lw);
}

/** 波浪形装饰条（UI 动感） */
export function wave(ctx, x, y, w, amp, freq, t, color, lw = 2) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
  for (let i = 0; i <= w; i += 3) {
    const yy = y + Math.sin(i * freq + t * 3) * amp;
    i ? ctx.lineTo(x + i, yy) : ctx.moveTo(x + i, yy);
  }
  ctx.stroke(); ctx.restore();
}

/** 通用调色板（游戏统一取色，保证视觉一致性） */
export const PALETTE = {
  bg: '#070b16', bg2: '#0d1426', panel: '#131c33', line: '#243357',
  cyan: '#22e0ff', magenta: '#ff2e88', lime: '#8dff4d', amber: '#ffb020',
  violet: '#a855f7', red: '#ff4d5e', green: '#28e0a0', blue: '#3b82f6',
  white: '#eaf2ff', dim: '#7d8db3'
};
export const PLAYER_COLORS = ['#22e0ff', '#ff2e88', '#8dff4d', '#ffb020', '#a855f7', '#ff4d5e'];
