// 物理沙盒 —— 自研刚体：创建圆、重力、碰撞、搭建与破坏
import { clamp, lerp, TAU, makeRng, dist, hexToRgb, hexToRgb as h2r } from '../core/math.js';
import { PALETTE, neon, roundRect, text, glowCircle, glowRect } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'physics-sandbox', title: '物理沙盒建造', category: 'physics', difficulty: 3,
  music: 'puzzle', howto: ['拖拽空地创建圆并赋予速度', '拖拽已有圆可移动它', '切换重力 / 静态块'],
  particles: 600
};
export const musicTrack = 'puzzle';

const PALETTE_LIST = ['#22e0ff', '#ff2e88', '#8dff4d', '#ffb020', '#a855f7', '#28e0a0'];

export function create(ctx) {
  const { audio, particles, shake, save, rng } = ctx;
  let bodies = [], t = 0, gravity = 1100, tool = 'ball', dragging = null, making = null, mx = 0, my = 0, lastT = 0;
  let W = 0, H = 0;

  function addBall(x, y, r, fixed = false, color) { bodies.push({ x, y, vx: 0, vy: 0, r, fixed, color: color || PALETTE_LIST[rng.int(0, PALETTE_LIST.length - 1)], spin: rng.range(-3, 3) }); }

  function step(dt) {
    const sub = dt;
    for (const b of bodies) {
      if (b.fixed) { b.vx = 0; b.vy = 0; continue; }
      b.vy += gravity * sub;
      b.vx *= Math.pow(0.999, sub * 60);
      b.x += b.vx * sub; b.y += b.vy * sub;
    }
    // 碰撞迭代
    const iters = 4;
    for (let k = 0; k < iters; k++) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) solve(bodies[i], bodies[j]);
      }
      for (const b of bodies) {
        if (b.x < b.r) { b.x = b.r; b.vx = -b.vx * 0.4; } if (b.x > W - b.r) { b.x = W - b.r; b.vx = -b.vx * 0.4; }
        if (b.y < b.r) { b.y = b.r; b.vy = -b.vy * 0.4; } if (b.y > H - b.r) { b.y = H - b.r; b.vy = -b.vy * 0.4; b.vx *= 0.9; }
      }
    }
    // 拖拽
    if (dragging && dragging !== 'new') { dragging.x = mx; dragging.y = my; dragging.vx = 0; dragging.vy = 0; }
  }
  function solve(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy); const min = a.r + b.r;
    if (d === 0 || d >= min) return;
    const nx = dx / d, ny = dy / d; const overlap = min - d;
    const aM = a.fixed ? 0 : 1, bM = b.fixed ? 0 : 1; const tot = aM + bM || 1;
    if (!a.fixed) { a.x -= nx * overlap * (aM / tot); a.y -= ny * overlap * (aM / tot); }
    if (!b.fixed) { b.x += nx * overlap * (bM / tot); b.y += ny * overlap * (bM / tot); }
    // 速度沿法线交换
    const rvx = b.vx - a.vx, rvy = b.vy - a.vy; const vn = rvx * nx + rvy * ny;
    if (vn < 0) { const e = 0.35; const jimp = -(1 + e) * vn / tot; if (!a.fixed) { a.vx -= jimp * aM * nx; a.vy -= jimp * aM * ny; } if (!b.fixed) { b.vx += jimp * bM * nx; b.vy += jimp * bM * ny; } }
  }

  function pick(x, y) { for (let i = bodies.length - 1; i >= 0; i--) { if (dist(x, y, bodies[i].x, bodies[i].y) < bodies[i].r) return bodies[i]; } return null; }

  const off = ctx.listen(ctx.canvas, 'pointerdown', e => {
    const r = ctx.canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top;
    if (tool === 'erase') { const b = pick(mx, my); if (b) { bodies.splice(bodies.indexOf(b), 1); audio.sfx('back'); } return; }
    const hit = pick(mx, my);
    if (hit) { dragging = hit; }
    else if (tool === 'ball') { making = { x: mx, y: my, r: 8 }; dragging = 'new'; }
    else if (tool === 'static') { addBall(mx, my, 28, true); audio.sfx('place'); }
  });
  const off2 = ctx.listen(ctx.canvas, 'pointermove', e => { const r = ctx.canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; if (making) making.r = clamp(dist(mx, my, making.x, making.y), 6, 60); });
  const off3 = ctx.listen(window, 'pointerup', e => {
    if (making) { const vx = (mx - making.x) * 4, vy = (my - making.y) * 4; addBall(making.x, making.y, making.r, false); bodies[bodies.length - 1].vx = vx; bodies[bodies.length - 1].vy = vy; audio.sfx('place'); if (bodies.length > 240) bodies.shift(); making = null; }
    dragging = null;
  });
  const off4 = ctx.listen(ctx.canvas, 'keydown', e => { if (e.key.toLowerCase() === 'r') bodies = []; if (e.key.toLowerCase() === 'g') gravity = gravity ? 0 : 1100; });

  const bar = document.createElement('div'); bar.className = 'overlay-bottom';
  const tools = [['ball', '⚪ 球'], ['static', '⬛ 静态'], ['erase', '⌫ 删除']];
  for (const [t2, n] of tools) { const b = document.createElement('button'); b.className = 'btn btn-ghost'; b.textContent = n; b.onclick = () => { tool = t2; [...bar.querySelectorAll('button')].forEach(x => x.style.borderColor = ''); b.style.borderColor = PALETTE.cyan; }; bar.appendChild(b); }
  const gb = document.createElement('button'); gb.className = 'btn'; gb.textContent = '⇅ 重力'; gb.onclick = () => { gravity = gravity ? 0 : 1100; }; bar.appendChild(gb);
  const cb = document.createElement('button'); cb.className = 'btn'; cb.textContent = '↺ 清空'; cb.onclick = () => bodies = []; bar.appendChild(cb);
  ctx.overlay(bar);

  layout0();
  // 初始几个球
  for (let i = 0; i < 8; i++) addBall(rng.range(80, 400), rng.range(60, 200), rng.range(14, 26));

  function layout0() { W = ctx.W; H = ctx.H; }

  function update(dt) { t += dt; lastT = dt; if (dragging === 'new' && making) { making.x = mx; making.y = my; } step(dt); }
  function render(a) {
    const c = ctx.ctx; W = c.canvas.width / (c.getTransform ? 1 : 1); const { W: w, H: h } = ctx; c.fillStyle = '#070b16'; c.fillRect(0, 0, w, h);
    for (const b of bodies) { glowCircle(c, b.x, b.y, b.r, b.color, { glow: 10, width: 2, fill: 'rgba(255,255,255,.06)' }); }
    if (making) { neon(c, cc => { cc.beginPath(); cc.arc(making.x, making.y, making.r, 0, TAU); }, PALETTE.cyan, { glow: 8, width: 2, layers: 2, inner: null, fill: 'rgba(34,224,255,.12)' }); }
    particles.render(c, 1);
  }
  return { update, render, resize: (w, h) => { W = w; H = h; }, destroy() { off?.(); off2?.(); off3?.(); off4?.(); } };
}
