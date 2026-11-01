// 粒子流体 —— 简化 SPH（双密度松弛，Clavet 法）
import { clamp, lerp, TAU, makeRng, dist } from '../core/math.js';
import { PALETTE, neon, roundRect, text, glowDot } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'fluid-sph', title: '粒子流体', category: 'physics', difficulty: 3,
  music: 'space', howto: ['拖拽鼠标扰动流体', '流体受重力流动', 'R 重置 · 流满容器'],
  particles: 200
};
export const musicTrack = 'space';

export function create(ctx) {
  const { audio, particles, save, rng } = ctx;
  const N = 520;
  const H = 22, H2 = H * H;
  const K = 0.5, KNEAR = 2.2, REST = 6, VISC = 0.06, GRAV = 900, DT = 1 / 60;
  let px = new Float32Array(N), py = new Float32Array(N), pvx = new Float32Array(N), pvy = new Float32Array(N), ox = new Float32Array(N), oy = new Float32Array(N), ppx = new Float32Array(N), ppy = new Float32Array(N);
  let W = 0, Hh = 0, t = 0, t0 = 0;
  let walls = [];
  let cell = 0, gw = 0, gh = 0, gridIdx = null;

  function layout(w, h) { W = w; Hh = h; gw = Math.ceil(w / H); gh = Math.ceil(h / H); gridIdx = new Int32Array(gw * gh).fill(-1); }
  function init() {
    let i = 0; for (let y = 0; y < 18 && i < N; y++) for (let x = 0; x < 26 && i < N; x++) { px[i] = 120 + x * 14 + rng.range(-3, 3); py[i] = 80 + y * 14 + rng.range(-3, 3); ppx[i] = px[i]; ppy[i] = py[i]; i++; }
    walls = [{ x: 0, y: Hh - 40, w: W, h: 40 }, { x: 0, y: 0, w: 20, h: Hh }, { x: W - 20, y: 0, w: 20, h: Hh }];
  }

  function buildGrid() { gridIdx.fill(-1); for (let i = 0; i < N; i++) { const gx = clamp((px[i] / H) | 0, 0, gw - 1), gy = clamp((py[i] / H) | 0, 0, gh - 1); const gi = gy * gw + gx; gridIdx[gi] = i; } }

  function neighbors(i, cb) {
    const gx = clamp((px[i] / H) | 0, 0, gw - 1), gy = clamp((py[i] / H) | 0, 0, gh - 1);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = gx + dx, ny = gy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      let j = gridIdx[ny * gw + nx]; if (j < 0) continue;
      if (j !== i) cb(j);
    }
  }

  function sim() {
    // 重力 + 预测位置
    for (let i = 0; i < N; i++) { pvy[i] += GRAV * DT; // 粘度
      ppx[i] = px[i]; ppy[i] = py[i];
      px[i] += pvy[i] * DT; py[i] += pvy[i] * DT;
    }
    buildGrid();
    // 双密度松弛
    for (let i = 0; i < N; i++) {
      let rho = 0, rhoNear = 0;
      const list = [];
      neighbors(i, (j) => { const dx = px[j] - px[i], dy = py[j] - py[i]; const r2 = dx * dx + dy * dy; if (r2 < H2) { const r = Math.sqrt(r2) || 0.01; const q = 1 - r / H; rho += q * q; rhoNear += q * q * q; list.push([j, r, dx / r, dy / r]); } });
      const P = K * (rho - REST), Pn = KNEAR * rhoNear;
      let dxi = 0, dyi = 0;
      for (const [j, r, nx, ny] of list) { const q = 1 - r / H; const D = DT * DT * (P * q + Pn * q * q); const Dx = nx * D, Dy = ny * D; px[j] += Dx * 0.5; py[j] += Dy * 0.5; dxi -= Dx * 0.5; dyi -= Dy * 0.5; }
      px[i] += dxi; py[i] += dyi;
    }
    // 边界 + 墙
    for (let i = 0; i < N; i++) {
      for (const wll of walls) { if (px[i] < wll.x + 6) px[i] = wll.x + 6; if (px[i] > wll.x + wll.w - 6) px[i] = wll.x + wll.w - 6; if (py[i] > wll.y - 6) py[i] = wll.y - 6; if (py[i] < wll.y + wll.h + 6) py[i] = wll.y + wll.h + 6; }
      if (py[i] > Hh - 6) py[i] = Hh - 6;
    }
    // 速度更新
    for (let i = 0; i < N; i++) { ppx[i] = (px[i] - ppx[i]) / DT; ppy[i] = (py[i] - ppy[i]) / DT; }
  }

  function stir(x, y, vx, vy) { for (let i = 0; i < N; i++) { if (dist(x, y, px[i], py[i]) < 60) { ppx[i] += vx; pvy[i] += vy; px[i] += vx * DT; py[i] += vy * DT; } } }

  let lx = 0, ly = 0, pdown = false;
  const off = ctx.listen(ctx.canvas, 'pointerdown', e => { pdown = true; const r = ctx.canvas.getBoundingClientRect(); lx = e.clientX - r.left; ly = e.clientY - r.top; });
  const off2 = ctx.listen(ctx.canvas, 'pointermove', e => { if (!pdown) return; const r = ctx.canvas.getBoundingClientRect(); const nx = e.clientX - r.left, ny = e.clientY - r.top; stir(nx, ny, (nx - lx) * 0.6, (ny - ly) * 0.6); lx = nx; ly = ny; });
  const off3 = ctx.listen(window, 'pointerup', () => pdown = false);
  const off4 = ctx.listen(ctx.canvas, 'keydown', e => { if (e.key.toLowerCase() === 'r') init(); });

  const bar = document.createElement('div'); bar.className = 'overlay-bottom';
  const gbtn = document.createElement('button'); gbtn.className = 'btn'; gbtn.textContent = '⇅ 重力'; gbtn.onclick = () => { GRAV = GRAV ? 0 : 900; }; bar.appendChild(gbtn);
  const rbtn = document.createElement('button'); rbtn.className = 'btn'; rbtn.textContent = '↺ 重置'; rbtn.onclick = init; bar.appendChild(rbtn);
  ctx.overlay(bar);

  layout(ctx.W, ctx.H); init();

  function update(dt) { t += dt; sim(); if (t - t0 > 0.04) t0 = t; }
  function render(a) {
    const c = ctx.ctx, { W: w, H: h } = ctx; c.fillStyle = '#070b16'; c.fillRect(0, 0, w, h);
    // 墙
    for (const wll of walls) { neon(c, cc => roundRect(cc, wll.x, wll.y, wll.w, wll.h, 6), '#3a4a6e', { glow: 3, width: 1.5, layers: 1, inner: null, fill: 'rgba(30,42,72,.8)' }); }
    // 流体：用 metaball 风——按速度着色小圆
    for (let i = 0; i < N; i++) {
      const sp = Math.hypot(ppx[i], pvy[i]); const hue = 190 - clamp(sp * 0.05, 0, 60);
      glowDot(c, px[i], py[i], 7, `hsl(${hue},90%,${55 + clamp(sp * 0.03, 0, 20)}%)`, 0.85);
    }
    particles.render(c, 1);
  }
  return { update, render, resize: (w, h) => layout(w, h), destroy() { off?.(); off2?.(); off3?.(); off4?.(); } };
}
