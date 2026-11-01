// 软体物理 —— 质点弹簧 + 气压，控制软体生物越过障碍
import { clamp, lerp, TAU, makeRng, dist, angleTo } from '../core/math.js';
import { PALETTE, neon, roundRect, text, glowCircle, glowRect, poly } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'soft-body', title: '软体物理', category: 'physics', difficulty: 4,
  music: 'arcade', howto: ['拖拽软体变形', 'WASD 移动 · 空格 跳跃', '越过障碍到发光终点'],
  particles: 500
};
export const musicTrack = 'arcade';

export function create(ctx) {
  const { audio, particles, shake, save, rng } = ctx;
  let W = 0, H = 0, t = 0, t0 = 0;
  let pts = [], cons = [], obstacles = [], stars = [], starsGot = 0, finished = false, goal = null;
  let dragPt = null, mx = 0, my = 0, lx = 0, ly = 0, pdown = false;
  const M = 16, R0 = 46, DT = 1 / 60, GRAV = 1400;

  // 关卡
  function buildLevel() {
    obstacles = [{ x: 0, y: 0, r: 0 }, { x: 200, y: H - 120, w: 160, h: 120 }, { x: 430, y: H - 220, w: 120, h: 220 }, { x: 640, y: H - 90, w: 200, h: 90 }, { x: 880, y: H - 320, w: 120, h: 320 }];
    stars = []; for (let i = 0; i < 3; i++) stars.push({ x: 300 + i * 240, y: H - 200 - (i % 2) * 80, got: false });
    goal = { x: W - 70, y: H - 80 };
    makeCreature(W * 0.12, H * 0.4);
  }
  function makeCreature(cx, cy) {
    pts = []; cons = []; const off = 0;
    const center = pts.length; pts.push({ x: cx, y: cy, px: cx, py: cy, fixed: false, center: true });
    const ringStart = pts.length;
    for (let i = 0; i < M; i++) { const a = i / M * TAU; pts.push({ x: cx + Math.cos(a) * R0, y: cy + Math.sin(a) * R0, px: cx + Math.cos(a) * R0, py: cy + Math.sin(a) * R0, fixed: false }); }
    for (let i = 0; i < M; i++) { cons.push({ a: ringStart + i, b: ringStart + (i + 1) % M, len: dist(pts[ringStart + i].x, pts[ringStart + i].y, pts[ringStart + (i + 1) % M].x, pts[ringStart + (i + 1) % M].y) }); cons.push({ a: center, b: ringStart + i, len: R0 }); }
  }

  function layout(w, h) { W = w; H = h; }

  function center() { let x = 0, y = 0, n = 0; for (const p of pts) { x += p.x; y += p.y; n++; } return { x: x / n, y: y / n }; }
  function applyMove(dx, dy) { const c = center(); for (const p of pts) { p.px -= dx * 0.5; p.py -= dy * 0.5; } }
  function jump() { for (const p of pts) p.py += 4.5; audio.sfx('jump'); particles.burst(center().x, center().y + R0, 14, { color: PALETTE.cyan, speed: 150, life: .5 }); }

  function step(dt) {
    // Verlet
    for (const p of pts) { if (p.fixed) continue; const vx = (p.x - p.px) * 0.99, vy = (p.y - p.py) * 0.99; p.px = p.x; p.py = p.y; p.x += vx; p.y += vy + GRAV * dt * dt; }
    // 约束迭代
    for (let k = 0; k < 6; k++) {
      for (const c of cons) { const a = pts[c.a], b = pts[c.b]; const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 0.01; const diff = (d - c.len) / d * 0.5; const ox = dx * diff, oy = dy * diff; if (!a.fixed) { a.x += ox; a.y += oy; } if (!b.fixed) { b.x -= ox; b.y -= oy; } }
      // 气压：保持 blob 面积
      const ring = pts.slice(1); let area = 0; for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; area += ring[i].x * ring[j].y - ring[j].x * ring[i].y; } area = Math.abs(area) / 2;
      const target = TAU * R0 * R0 * 0.6; const press = clamp((target - area) / target, -0.5, 0.5);
      for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; let nx = -(ring[j].y - ring[i].y), ny = (ring[j].x - ring[i].x); const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len; if (!ring[i].fixed) { ring[i].x += nx * press * 8 * (k === 0 ? 1 : 0); ring[i].y += ny * press * 8 * (k === 0 ? 1 : 0); } }
    }
    // 障碍 / 地面
    for (const p of pts) {
      if (p.y > H - 6) { p.y = H - 6; p.py = p.y + (p.y - p.py) * 0.3; }
      if (p.x < 6) p.x = 6; if (p.x > W - 6) p.x = W - 6;
      for (const o of obstacles) {
        if (o.w) { // AABB
          const cx = clamp(p.x, o.x, o.x + o.w), cy = clamp(p.y, o.y, o.y + o.h); const dx = p.x - cx, dy = p.y - cy; const d = Math.hypot(dx, dy); if (d < 10 && d > 0) { p.x = cx + dx / d * 10; p.y = cy + dy / d * 10; }
        } else if (o.r > 0) { const d = dist(p.x, p.y, o.x, o.y); if (d < o.r + 10 && d > 0) { p.x = o.x + (p.x - o.x) / d * (o.r + 10); p.y = o.y + (p.y - o.y) / d * (o.r + 10); } }
      }
    }
    // 拖拽
    if (dragPt) { dragPt.x = mx; dragPt.y = my; }
    // 星标 / 终点
    const c = center();
    for (const s of stars) if (!s.got && dist(c.x, c.y, s.x, s.y) < 40) { s.got = true; starsGot++; audio.sfx('coin'); ctx.vibrate(PATTERNS.tap); particles.burst(s.x, s.y, 14, { color: PALETTE.amber, speed: 130, life: .5 }); }
    if (goal && dist(c.x, c.y, goal.x, goal.y) < 50 && starsGot === stars.length && !finished) win();
  }
  function win() { finished = true; audio.sfx('win'); shake.add(0.4); ctx.vibrate(PATTERNS.win); particles.burst(goal.x, goal.y, 30, { color: PALETTE.lime, speed: 200, life: .8 }); setTimeout(() => { buildLevel(); finished = false; }, 1600); }

  const off = ctx.listen(ctx.canvas, 'pointerdown', e => { pdown = true; const r = ctx.canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; let best = null, bd = 30; for (const p of pts) { const d = dist(mx, my, p.x, p.y); if (d < bd) { bd = d; best = p; } } dragPt = best; });
  const off2 = ctx.listen(ctx.canvas, 'pointermove', e => { const r = ctx.canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
  const off3 = ctx.listen(window, 'pointerup', () => { pdown = false; dragPt = null; });
  const off4 = ctx.listen(ctx.canvas, 'keydown', e => { const k = e.key.toLowerCase(); if (k === 'a' || k === 'arrowleft') applyMove(-16, 0); else if (k === 'd' || k === 'arrowright') applyMove(16, 0); else if (k === 'w' || k === 'arrowup') applyMove(0, -16); else if (k === ' ') { e.preventDefault(); jump(); } else if (k === 'r') buildLevel(); });

  const bar = document.createElement('div'); bar.className = 'overlay-bottom';
  const rb = document.createElement('button'); rb.className = 'btn'; rb.textContent = '↺ 重置'; rb.onclick = () => buildLevel(); bar.appendChild(rb);
  ctx.overlay(bar);

  layout(ctx.W, ctx.H); buildLevel();

  function update(dt) { t += dt; step(dt); }
  function render(a) {
    const c = ctx.ctx, { W: w, H: h } = ctx; c.fillStyle = '#070b16'; c.fillRect(0, 0, w, h);
    for (const o of obstacles) { if (o.w) neon(c, cc => roundRect(cc, o.x, o.y, o.w, o.h, 6), '#3a4a6e', { glow: 3, width: 1.5, layers: 1, inner: null, fill: 'rgba(30,42,72,.9)' }); }
    // 软体
    const ring = pts.slice(1);
    c.save(); c.fillStyle = 'rgba(34,224,255,.18)'; c.strokeStyle = PALETTE.cyan; c.lineWidth = 2.5; c.shadowColor = PALETTE.cyan; c.shadowBlur = 14; c.beginPath(); for (let i = 0; i < ring.length; i++) { const x = lerp(pts[i === 0 ? ring.length - 1 : i - 1].x || 0, 0, 0) || ring[i].x; } for (let i = 0; i < ring.length; i++) { i ? c.lineTo(ring[i].x, ring[i].y) : c.moveTo(ring[i].x, ring[i].y); } c.closePath(); c.fill(); c.stroke(); c.shadowBlur = 0;
    for (const p of ring) glowCircle(c, p.x, p.y, 6, PALETTE.cyan, { glow: 6 });
    const ce = center(); glowCircle(c, ce.x, ce.y, 8, PALETTE.white, { glow: 8, fill: 'rgba(255,255,255,.3)' });
    c.restore();
    // 星标
    for (const s of stars) if (!s.got) { const e = Math.sin(t * 5 + s.x) * 3; c.save(); c.translate(s.x, s.y); c.fillStyle = PALETTE.amber; star(c, 0, 0, 16 + e, 5); c.restore(); }
    if (goal) glowCircle(c, goal.x, goal.y, 40 + Math.sin(t * 4) * 5, PALETTE.lime, { glow: 16, width: 3, fill: 'rgba(141,255,77,.2)' });
    particles.render(c, 1);
    // HUD
    text(c, '星标 ' + starsGot + '/' + stars.length, 70, 24, { size: 13, color: PALETTE.amber });
    if (finished) text(c, 'CLEAR', w / 2, h / 2, { size: 44, color: PALETTE.lime, weight: 900, glow: 18 });
  }
  function star(c, cx, cy, r, spikes = 5, inner = 0.42) { c.beginPath(); for (let i = 0; i < spikes * 2; i++) { const rr = i % 2 ? r * inner : r; const a = -Math.PI / 2 + i * Math.PI / spikes; const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); c.fill(); }
  return { update, render, resize: (w, h) => layout(w, h), destroy() { off?.(); off2?.(); off3?.(); off4?.(); } };
}
