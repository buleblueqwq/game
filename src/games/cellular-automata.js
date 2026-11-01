// 细胞自动机沙盒 —— 落沙 / 水 / 火 / 酸 / 油 / 蒸汽 演化
import { clamp, lerp, TAU, makeRng } from '../core/math.js';
import { PALETTE, neon, roundRect, text, glowRect } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'cellular-automata', title: '细胞自动机', category: 'physics', difficulty: 2,
  music: 'space', howto: ['拖拽笔刷绘制元素', '切换元素类型', 'R 清空 · 观察演化'],
  particles: 200
};
export const musicTrack = 'space';

const EMPTY = 0, WALL = 1, SAND = 2, WATER = 3, FIRE = 4, OIL = 5, ACID = 6, STEAM = 7, PLANT = 8, SMOKE = 9;
const COLORS = {
  [EMPTY]: [0, 0, 0, 0], [WALL]: [70, 84, 120, 255], [SAND]: [222, 196, 110, 255],
  [WATER]: [60, 150, 255, 200], [FIRE]: [255, 120, 30, 255], [OIL]: [120, 90, 60, 230],
  [ACID]: [150, 255, 60, 200], [STEAM]: [200, 220, 255, 120], [PLANT]: [80, 200, 90, 255], [SMOKE]: [90, 90, 100, 140]
};
const NAMES = { [WALL]: '墙', [SAND]: '沙', [WATER]: '水', [FIRE]: '火', [OIL]: '油', [ACID]: '酸', [STEAM]: '蒸汽', [PLANT]: '植物', [SMOKE]: '烟' };

export function create(ctx) {
  const { audio, particles, save, rng } = ctx;
  const GW = 150, GH = 100;
  let grid, nxt, gw = GW, gh = GH, cell = 0, ox = 0, oy = 0, img, buf;
  let cur = SAND, brush = 6, paused = false, t = 0, pointerDown = false, lx = 0, ly = 0;

  function layout(w, h) { cell = Math.max(3, Math.floor(Math.min(w / GW, h / GH) * 0.96)); ox = (w - cell * GW) / 2; oy = (h - cell * GH) / 2; }
  function init() { grid = new Uint8Array(GW * GH); nxt = new Uint8Array(GW * GH); }
  function idx(x, y) { return y * GW + x; }
  function clear() { grid.fill(EMPTY); }

  function step(dt) {
    if (paused) return;
    // 下落沙类（从底向上避免重复移动）
    for (let y = GH - 1; y >= 0; y--) {
      for (let x = 0; x < GW; x++) {
        const i = idx(x, y); const v = grid[i]; if (!v) continue;
        const below = y + 1 < GH ? grid[idx(x, y + 1)] : WALL;
        if (v === FIRE) {
          // 火：蔓延到油/植物，衰减
          let spread = false;
          for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue; const nv = grid[idx(nx, ny)]; if (nv === OIL || nv === PLANT) { if (rng.chance(0.3)) grid[idx(nx, ny)] = FIRE; } }
          if (rng.chance(0.06)) grid[i] = rng.chance(0.5) ? SMOKE : EMPTY;
          continue;
        }
        if (v === STEAM) { if (below === EMPTY && rng.chance(0.5)) { grid[idx(x, y + 1)] = STEAM; grid[i] = EMPTY; } else if (y > 0 && grid[idx(x, y - 1)] === EMPTY && rng.chance(0.4)) { grid[idx(x, y - 1)] = STEAM; grid[i] = EMPTY; } else if (rng.chance(0.02)) grid[i] = EMPTY; continue; }
        if (v === SMOKE) { if (y > 0 && grid[idx(x, y - 1)] === EMPTY) { grid[idx(x, y - 1)] = SMOKE; grid[i] = EMPTY; } else if (rng.chance(0.03)) grid[i] = EMPTY; continue; }
        if (v === SAND) {
          if (below === EMPTY) { grid[idx(x, y + 1)] = SAND; grid[i] = EMPTY; }
          else if (below === WATER) { grid[idx(x, y + 1)] = SAND; grid[i] = WATER; }
          else { const dl = x > 0 ? grid[idx(x - 1, y + 1)] : WALL, dr = x < GW - 1 ? grid[idx(x + 1, y + 1)] : WALL; if (dl === EMPTY) { grid[idx(x - 1, y + 1)] = SAND; grid[i] = EMPTY; } else if (dr === EMPTY) { grid[idx(x + 1, y + 1)] = SAND; grid[i] = EMPTY; } }
          continue;
        }
        if (v === WATER || v === OIL) {
          if (below === EMPTY) { grid[idx(x, y + 1)] = v; grid[i] = EMPTY; }
          else { const dl = x > 0 ? grid[idx(x - 1, y + 1)] : WALL, dr = x < GW - 1 ? grid[idx(x + 1, y + 1)] : WALL; if (dl === EMPTY) { grid[idx(x - 1, y + 1)] = v; grid[i] = EMPTY; } else if (dr === EMPTY) { grid[idx(x + 1, y + 1)] = v; grid[i] = EMPTY; } else { const l = x > 0 ? grid[idx(x - 1, y)] : WALL, r = x < GW - 1 ? grid[idx(x + 1, y)] : WALL; if (l === EMPTY && rng.chance(0.5)) { grid[idx(x - 1, y)] = v; grid[i] = EMPTY; } else if (r === EMPTY) { grid[idx(x + 1, y)] = v; grid[i] = EMPTY; } if (v === OIL && rng.chance(0.002)) grid[i] = EMPTY; }
          continue;
        }
        if (v === ACID) {
          if (below === SAND || below === PLANT) { grid[idx(x, y + 1)] = EMPTY; if (rng.chance(0.5)) grid[i] = EMPTY; }
          else if (below === EMPTY) { grid[idx(x, y + 1)] = ACID; grid[i] = EMPTY; }
          else if (rng.chance(0.01)) grid[i] = EMPTY;
          continue;
        }
        if (v === PLANT) { // 植物：遇水生长
          if (y > 0) { const u = grid[idx(x, y - 1)]; if (u === WATER) { grid[idx(x, y - 1)] = PLANT; grid[i] = EMPTY; } }
          continue;
        }
      }
    }
  }

  function paint(px, py, right) {
    const gx = Math.floor((px - ox) / cell), gy = Math.floor((py - oy) / cell);
    const v = right ? EMPTY : cur;
    for (let yy = -brush; yy <= brush; yy++) for (let xx = -brush; xx <= brush; xx++) {
      if (xx * xx + yy * yy > brush * brush) continue;
      const x = gx + xx, y = gy + yy; if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      if (v === EMPTY || rng.chance(0.85)) grid[idx(x, y)] = v;
    }
    audio.sfx('tick');
  }

  function render() {
    if (!img) { img = ctx.ctx.createImageData ? null : null; }
    const c = ctx.ctx, { W, H } = ctx;
    c.fillStyle = '#070b16'; c.fillRect(0, 0, W, H);
    c.save(); c.translate(ox, oy);
    // 用 ImageData 批量绘制（每格一个像素块，再放大）
    if (!buf) buf = new ImageData(GW, GH);
    const d = buf.data;
    for (let i = 0; i < GW * GH; i++) { const col = COLORS[grid[i]]; const j = i * 4; d[j] = col[0]; d[j + 1] = col[1]; d[j + 2] = col[2]; d[j + 3] = col[3]; }
    // 临时画到小 canvas 再放大
    if (!render._c) { render._c = document.createElement('canvas'); render._c.width = GW; render._c.height = GH; render._x = render._c.getContext('2d'); }
    render._x.putImageData(buf, 0, 0);
    c.imageSmoothingEnabled = false; c.drawImage(render._c, 0, 0, GW, GH, 0, 0, GW * cell, GH * cell);
    c.restore();
    particles.render(c, 1);
  }

  const off = ctx.listen(ctx.canvas, 'pointerdown', e => { pointerDown = true; const r = ctx.canvas.getBoundingClientRect(); lx = e.clientX - r.left; ly = e.clientY - r.top; paint(lx, ly, e.button === 2); });
  const off2 = ctx.listen(ctx.canvas, 'pointermove', e => { if (!pointerDown) return; const r = ctx.canvas.getBoundingClientRect(); lx = e.clientX - r.left; ly = e.clientY - r.top; paint(lx, ly, e.button === 2); });
  const off3 = ctx.listen(window, 'pointerup', () => pointerDown = false);
  const off4 = ctx.listen(ctx.canvas, 'contextmenu', e => e.preventDefault());
  const off5 = ctx.listen(ctx.canvas, 'keydown', e => { if (e.key.toLowerCase() === 'r') clear(); if (e.key.toLowerCase() === ' ') paused = !paused; if (e.key === '[') brush = Math.max(1, brush - 1); if (e.key === ']') brush = Math.min(14, brush + 1); });

  const bar = document.createElement('div'); bar.className = 'overlay-bottom';
  const tools = [[SAND, '沙'], [WATER, '水'], [OIL, '油'], [ACID, '酸'], [PLANT, '植物'], [FIRE, '火'], [WALL, '墙'], [EMPTY, '橡皮']];
  for (const [v, n] of tools) { const b = document.createElement('button'); b.className = 'btn btn-ghost'; b.textContent = n; b.onclick = () => { cur = v; [...bar.querySelectorAll('button')].forEach(x => x.style.borderColor = ''); b.style.borderColor = PALETTE.cyan; }; bar.appendChild(b); }
  const clr = document.createElement('button'); clr.className = 'btn'; clr.textContent = '↺ 清空'; clr.onclick = clear; bar.appendChild(clr);
  ctx.overlay(bar);

  init(); layout(ctx.W, ctx.H);
  // 初始放点东西
  for (let i = 0; i < 200; i++) grid[idx(rng.int(10, GW - 10), rng.int(0, 8))] = SAND;

  let acc = 0;
  function update(dt) { t += dt; acc += dt; while (acc > 1 / 60) { step(dt); acc -= 1 / 60; } }
  return { update, render, resize: (w, h) => layout(w, h), destroy() { off?.(); off2?.(); off3?.(); off4?.(); off5?.(); } };
}
