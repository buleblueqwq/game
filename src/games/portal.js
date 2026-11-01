// 传送门解谜 —— 小球受重力，玩家在可传送墙面放双门，引导到终点
import { clamp, lerp, TAU, ease, dist, angleTo } from '../core/math.js';
import { PALETTE, neon, roundRect, text, glowCircle, glowRect, glowLine } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'portal', title: '传送门解谜', category: 'puzzle', difficulty: 4,
  music: 'puzzle', howto: ['点击白墙放蓝门(左键)/橙门(右键)', '把球送进发光终点', 'R 重置 · 传送保持速度'],
  particles: 800
};
export const musicTrack = 'puzzle';

const W0 = 1000, H0 = 620;

const LEVELS = [
  { walls: [{ x: 20, y: 20, w: 960, h: 30 }, { x: 20, y: 570, w: 960, h: 30 }, { x: 20, y: 20, w: 30, h: 580 }, { x: 950, y: 20, w: 30, h: 580 }, { x: 400, y: 240, w: 200, h: 30, portal: true }], start: { x: 80, y: 70 }, goal: { x: 880, y: 520 }, hint: '在白墙上开门，让球穿墙' },
  { walls: [{ x: 20, y: 20, w: 960, h: 30 }, { x: 20, y: 570, w: 960, h: 30 }, { x: 20, y: 20, w: 30, h: 580 }, { x: 950, y: 20, w: 30, h: 580 }, { x: 460, y: 120, w: 30, h: 220, portal: true }, { x: 510, y: 300, w: 120, h: 20 }], start: { x: 80, y: 70 }, goal: { x: 80, y: 520 }, hint: '用传送门绕过悬空板' },
  { walls: [{ x: 20, y: 20, w: 960, h: 30 }, { x: 20, y: 570, w: 960, h: 30 }, { x: 20, y: 20, w: 30, h: 580 }, { x: 950, y: 20, w: 30, h: 580 }, { x: 300, y: 200, w: 30, h: 300, portal: true }, { x: 670, y: 200, w: 30, h: 300, portal: true }, { x: 330, y: 470, w: 340, h: 24 }], start: { x: 80, y: 70 }, goal: { x: 880, y: 70 }, hint: '双门接力' },
  { walls: [{ x: 20, y: 20, w: 960, h: 30 }, { x: 20, y: 570, w: 960, h: 30 }, { x: 20, y: 20, w: 30, h: 580 }, { x: 950, y: 20, w: 30, h: 580 }, { x: 200, y: 150, w: 400, h: 24, portal: true }, { x: 600, y: 350, w: 24, h: 240, portal: true }, { x: 400, y: 350, w: 200, h: 24 }], start: { x: 80, y: 70 }, goal: { x: 880, y: 520 }, hint: '注意门的朝向' },
  { walls: [{ x: 20, y: 20, w: 960, h: 30 }, { x: 20, y: 570, w: 960, h: 30 }, { x: 20, y: 20, w: 30, h: 580 }, { x: 950, y: 20, w: 30, h: 580 }, { x: 350, y: 100, w: 24, h: 420, portal: true }, { x: 626, y: 100, w: 24, h: 420, portal: true }, { x: 374, y: 100, w: 252, h: 24 }, { x: 374, y: 496, w: 252, h: 24 }], start: { x: 80, y: 70 }, goal: { x: 880, y: 70 }, hint: '上下传送穿越夹层' },
  { walls: [{ x: 20, y: 20, w: 960, h: 30 }, { x: 20, y: 570, w: 960, h: 30 }, { x: 20, y: 20, w: 30, h: 580 }, { x: 950, y: 20, w: 30, h: 580 }, { x: 250, y: 250, w: 30, h: 200, portal: true }, { x: 700, y: 250, w: 30, h: 200, portal: true }, { x: 280, y: 250, w: 420, h: 24 }, { x: 280, y: 426, w: 420, h: 24 }], start: { x: 80, y: 70 }, goal: { x: 880, y: 520 }, hint: '终点在下方' },
  { walls: [{ x: 20, y: 20, w: 960, h: 30 }, { x: 20, y: 570, w: 960, h: 30 }, { x: 20, y: 20, w: 30, h: 580 }, { x: 950, y: 20, w: 30, h: 580 }, { x: 150, y: 150, w: 300, h: 24, portal: true }, { x: 550, y: 450, w: 300, h: 24, portal: true }, { x: 450, y: 200, w: 24, h: 220 }], start: { x: 80, y: 70 }, goal: { x: 500, y: 520 }, hint: '规划门的顺序' },
  { walls: [{ x: 20, y: 20, w: 960, h: 30 }, { x: 20, y: 570, w: 960, h: 30 }, { x: 20, y: 20, w: 30, h: 580 }, { x: 950, y: 20, w: 30, h: 580 }, { x: 300, y: 120, w: 24, h: 480, portal: true }, { x: 676, y: 120, w: 24, h: 480, portal: true }, { x: 324, y: 120, w: 352, h: 24 }, { x: 324, y: 576, w: 352, h: 18 }], start: { x: 80, y: 70 }, goal: { x: 880, y: 70 }, hint: '终极关：循环门' }
];

export function create(ctx) {
  const { audio, particles, shake, save, rng } = ctx;
  let sc = 1, ox = 0, oy = 0, lvIdx = save.get('level', 0) || 0, level, ball, portals = { blue: null, orange: null }, won = false, t = 0, started = false;
  let trail = [];

  function load(i) {
    level = LEVELS[i % LEVELS.length]; portals = { blue: null, orange: null }; won = false; started = false; trail = [];
    ball = { x: level.start.x, y: level.start.y, vx: 0, vy: 0, r: 12 };
    layout(ctx.W, ctx.H); refresh(); ctx.hint?.(level.hint);
  }
  function layout(w, h) { sc = Math.min(w / W0, h / H0) * 0.96; ox = (w - W0 * sc) / 2; oy = (h - H0 * sc) / 2; }
  function w2s(x, y) { return [ox + x * sc, oy + y * sc]; }
  function s2w(px, py) { return [(px - ox) / sc, (py - oy) / sc]; }

  function placePortal(wx, wy, color) {
    for (const w of level.walls) {
      if (!w.portal) continue;
      // 判断点是否在某条边上
      const sides = [{ a: [w.x, w.y], b: [w.x + w.w, w.y], n: [0, -1] }, { a: [w.x, w.y + w.h], b: [w.x + w.w, w.y + w.h], n: [0, 1] }, { a: [w.x, w.y], b: [w.x, w.y + w.h], n: [-1, 0] }, { a: [w.x + w.w, w.y], b: [w.x + w.w, w.y + w.h], n: [1, 0] }];
      for (const s of sides) {
        const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], len = Math.hypot(dx, dy);
        const tproj = clamp(((wx - s.a[0]) * dx + (wy - s.a[1]) * dy) / (len * len), 0, 1);
        const px = s.a[0] + dx * tproj, py = s.a[1] + dy * tproj;
        if (dist(wx, wy, px, py) < 26) { portals[color] = { x: px, y: py, n: s.n, len: Math.min(120, len * 0.7) }; audio.sfx('portal'); ctx.vibrate(PATTERNS.select); particles.burst(...w2s(px, py), 12, { color: color === 'blue' ? PALETTE.cyan : PALETTE.amber, speed: 120, life: .5 }); return; }
      }
    }
    audio.sfx('error');
  }

  const off = ctx.listen(ctx.canvas, 'pointerdown', e => {
    const r = ctx.canvas.getBoundingClientRect(); const [wx, wy] = s2w(e.clientX - r.left, e.clientY - r.top);
    placePortal(wx, wy, e.button === 2 ? 'orange' : 'blue');
  });
  const off2 = ctx.listen(ctx.canvas, 'contextmenu', e => e.preventDefault());
  const off3 = ctx.listen(ctx.canvas, 'keydown', e => { if (e.key.toLowerCase() === 'r') { load(lvIdx); } });

  function collide() {
    const r = ball.r;
    for (const w of level.walls) {
      const cx = clamp(ball.x, w.x, w.x + w.w), cy = clamp(ball.y, w.y, w.y + w.h);
      const ddx = ball.x - cx, ddy = ball.y - cy; const d = Math.hypot(ddx, ddy);
      if (d < r) {
        // 传送门优先
        const p = (portals.blue && nearPortal(ball.x, ball.y, portals.blue)) ? portals.blue : (portals.orange && nearPortal(ball.x, ball.y, portals.orange)) ? portals.orange : null;
        if (p && portals.blue && portals.orange) {
          const other = p === portals.blue ? portals.orange : portals.blue;
          teleport(p, other); continue;
        }
        const nx = ddx / (d || 1), ny = ddy / (d || 1);
        const push = r - d; ball.x += nx * push; ball.y += ny * push;
        const dot = ball.vx * nx + ball.vy * ny;
        if (dot < 0) { ball.vx -= 1.6 * dot * nx; ball.vy -= 1.6 * dot * ny; ball.vx *= 0.86; ball.vy *= 0.86; audio.sfx('tick'); }
      }
    }
  }
  function nearPortal(x, y, p) { // 距离门所在边足够近，且在门区间内
    const d = Math.abs((x - p.x) * p.n[1] + (y - p.y) * p.n[0]); // 垂直距离
    const along = (x - p.x) * (-p.n[1]) + (y - p.y) * (p.n[0]);  // 沿边
    return d < ball.r + 4 && Math.abs(along) < p.len / 2 + ball.r;
  }
  function teleport(from, to) {
    // 出口在 to 门外略偏移
    ball.x = to.x + to.n[0] * (ball.r + 4); ball.y = to.y + to.n[1] * (ball.r + 4);
    // 速度旋转：入口法线 -> 出口法线
    const inA = Math.atan2(from.n[1], from.n[0]), outA = Math.atan2(to.n[1], to.n[0]);
    const rot = outA - inA + Math.PI;
    const sp = Math.hypot(ball.vx, ball.vy) * 1.04;
    const ca = Math.atan2(ball.vy, ball.vx) + rot;
    ball.vx = Math.cos(ca) * sp; ball.vy = Math.sin(ca) * sp;
    audio.sfx('whoosh'); ctx.vibrate(PATTERNS.shoot);
    particles.burst(...w2s(from.x, from.y), 16, { color: PALETTE.cyan, speed: 160, life: .5 });
    particles.burst(...w2s(to.x, to.y), 16, { color: PALETTE.amber, speed: 160, life: .5 });
  }

  function refresh() { ctx.hud('lv', '关卡', lvIdx + 1); ctx.hud('portals', '传送门', (portals.blue ? '蓝' : '·') + '/' + (portals.orange ? '橙' : '·')); }

  load(lvIdx);

  function update(dt) {
    t += dt;
    if (won) return;
    ball.vy += 1100 * dt; ball.vx *= Math.pow(0.999, dt * 60);
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    collide();
    // 终点
    if (dist(ball.x, ball.y, level.goal.x, level.goal.y) < 26) { win(); }
    // 轨迹
    trail.push(ball.x, ball.y); if (trail.length > 30) trail.splice(0, 2);
  }
  function win() {
    won = true; audio.sfx('win'); shake.add(0.4); ctx.vibrate(PATTERNS.win);
    particles.burst(...w2s(level.goal.x, level.goal.y), 30, { color: PALETTE.lime, speed: 200, life: .8 });
    save.set('level', (lvIdx + 1) % LEVELS.length);
    setTimeout(() => { lvIdx = (lvIdx + 1) % LEVELS.length; save.set('level', lvIdx); load(lvIdx); }, 1400);
  }
  function render(a) {
    const c = ctx.ctx, { W, H } = ctx; c.fillStyle = '#070b16'; c.fillRect(0, 0, W, H);
    c.save(); c.translate(ox, oy); c.scale(sc, sc);
    // 墙
    for (const w of level.walls) {
      if (w.portal) glowRect(c, w.x, w.y, w.w, w.h, PALETTE.blue, { glow: 8, width: 2, layers: 1, fill: 'rgba(40,60,110,.4)' });
      else { neon(c, cc => roundRect(cc, w.x, w.y, w.w, w.h, 4), '#3a4a6e', { glow: 4, width: 1.5, layers: 1, inner: null, fill: 'rgba(30,40,70,.7)' }); }
    }
    // 传送门
    for (const k of ['blue', 'orange']) { const p = portals[k]; if (!p) continue; const col = k === 'blue' ? PALETTE.cyan : PALETTE.amber; const ax = -p.n[1], ay = p.n[0]; c.save(); c.translate(p.x, p.y); c.rotate(Math.atan2(ay, ax)); const wob = 0.5 + 0.5 * Math.sin(t * 6); c.strokeStyle = col; c.lineWidth = 4; c.shadowColor = col; c.shadowBlur = 18; c.beginPath(); c.ellipse(0, 0, 9, p.len / 2, 0, 0, TAU); c.stroke(); c.restore(); }
    // 终点
    c.save(); c.translate(level.goal.x, level.goal.y); glowCircle(c, 0, 0, 22 + Math.sin(t * 4) * 4, PALETTE.lime, { glow: 18, width: 2, fill: 'rgba(141,255,77,.2)' }); c.restore();
    // 轨迹
    c.strokeStyle = 'rgba(34,224,255,.5)'; c.lineWidth = 2; c.beginPath(); for (let i = 0; i < trail.length; i += 2) { const x = trail[i], y = trail[i + 1]; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
    // 球
    glowCircle(c, ball.x, ball.y, ball.r, PALETTE.white, { glow: 14, width: 2, fill: 'rgba(255,255,255,.3)' });
    c.restore();
    particles.render(c, 1);
  }
  return { update, render, resize: (w, h) => layout(w, h), destroy() { off?.(); off2?.(); off3?.(); } };
}
