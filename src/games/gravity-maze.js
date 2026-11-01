// 重力迷宫 —— 旋转场景改变重力，让球滚到终点
import { clamp, lerp, TAU, ease, dist } from '../core/math.js';
import { PALETTE, neon, roundRect, text, glowCircle, glowRect } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'gravity-maze', title: '重力迷宫', category: 'puzzle', difficulty: 3,
  music: 'puzzle', howto: ['Q/E 或 A/D 旋转场景(90°)', '让小球滚进发光终点', 'R 重置 · 收集星标'],
  particles: 700
};
export const musicTrack = 'puzzle';

const L = [
  ['##########', '#S.......#', '#.######.#', '#.#....#.#', '#.#.##.#.#', '#...#..#E#', '#.#.#..#.#', '#.#.#.##.#', '#...#....#', '##########'],
  ['#########', '#S...#..#', '#.##.#.##', '#.#..#..#', '#.#.##.##', '#...#..*#', '#.#.#.##', '#.#...#E#', '#.....#.#', '#########'],
  ['#########', '#S#.....#', '#.#.###.#', '#.#.#.#.#', '#...#.#.#', '###.#.#.#', '#...#.#.#', '#.#.#.#.#', '#.#...#E#', '#########'],
  ['########', '#S.....#', '#.####.#', '#.#..#.#', '#.#.##.#', '#.#....#', '#.####.#', '#......#', '#.####E#', '########'],
  ['##########', '#S.......#', '#.######.#', '#.#....#.#', '#.#.##.#.#', '#...#..#E#', '#.#.#..#.#', '#.#.#.##.#', '#.*.#....#', '##########'],
  ['#########', '#S..#..*#', '#.#.#.#.#', '#.#.#.#.#', '#...#.#.#', '#.###.#.#', '#.#...#.#', '#.#.#.#.#', '#.#.#..E#', '#########'],
  ['##########', '#S#.....##', '#.#.####.#', '#.#....#.#', '#.####.#.#', '#......#.#', '#.####.#.#', '#.#..#.#.#', '#.#..#.*.#', '#.####..E#', '##########'],
  ['#########', '#S......#', '#.#####.#', '#.#...#.#', '#.#.#.#.#', '#.#.#.#.#', '#...#...#', '#.#####.#', '#.....#E#', '#########'],
  ['##########', '#S.......#', '#.#.####.#', '#.#....#.#', '#.#.##.#.#', '#*..#..#.#', '#.#.#.#.#.#', '#.#.#.#.#.#', '#...#..#E#', '##########'],
  ['#########', '#S..*...#', '#.#.###.#', '#.#...#.#', '#.###.#.#', '#...#.#.#', '#.#.#.#.#', '#.#...#.#', '#.#####E#', '#########'],
  ['##########', '#S.......#', '#.#.####.#', '#.#..*#.#.#', '#.#.#.#.#.#', '#...#.#.#.#', '#.#.#.#.#.#', '#.#...#.#.#', '#.#####.#E#', '##########'],
  ['#########', '#S......#', '#.#####.#', '#.#...#.#', '#.#.#.#.#', '#.#.#.#.#', '#.#...#.#', '#.#.###.#', '#.....*E#', '#########']
];
const N = 10, CELL = 52;

export function create(ctx) {
  const { audio, particles, shake, save, rng } = ctx;
  let lvIdx = save.get('level', 0) || 0, map, ball, gdir = 0, rot = 0, rotTarget = 0, stars = [], starsGot = 0, won = false, dead = false, t = 0, best = save.get('best', 0), moves = 0, t0 = performance.now();
  let cx = 0, cy = 0, ox = 0, oy = 0, scale = 1;

  function load(i) {
    map = L[i % L.length].map(r => r.split('')); gdir = 0; rot = rotTarget = 0; starsGot = 0; won = dead = false; stars = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const ch = map[y][x];
      if (ch === 'S') ball = { x: x * CELL + CELL / 2, y: y * CELL + CELL / 2, vx: 0, vy: 0, r: CELL * 0.32 };
      if (ch === '*') stars.push({ x: x * CELL + CELL / 2, y: y * CELL + CELL / 2, got: false });
    }
    layout(ctx.W, ctx.H); refresh(); moves = 0; t0 = performance.now(); ctx.hint?.('Q/E 旋转场景');
  }
  function layout(w, h) { scale = Math.min(w, h) / (N * CELL) * 0.92; ox = w / 2; oy = h / 2 - 6; }
  function gvec(d) { return [[0, 1], [1, 0], [0, -1], [-1, 0]][d]; }
  function rotate(dir) { gdir = (gdir + dir + 4) % 4; rotTarget = rotTarget + dir * Math.PI / 2; moves++; audio.sfx('whoosh'); ctx.vibrate(PATTERNS.tap); refresh(); }

  function collide() {
    const r = ball.r;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (map[y][x] !== '#') continue;
      const wx = x * CELL, wy = y * CELL;
      const px = clamp(ball.x, wx, wx + CELL), py = clamp(ball.y, wy, wy + CELL);
      const ddx = ball.x - px, ddy = ball.y - py, d = Math.hypot(ddx, ddy);
      if (d < r) {
        const nx = ddx / (d || 1), ny = ddy / (d || 1), push = r - d;
        ball.x += nx * push; ball.y += ny * push;
        const dot = ball.vx * nx + ball.vy * ny;
        if (dot < 0) { ball.vx -= 1.7 * dot * nx; ball.vy -= 1.7 * dot * ny; ball.vx *= 0.5; ball.vy *= 0.5; }
      }
    }
  }
  function update(dt) {
    t += dt;
    rot = lerp(rot, rotTarget, 1 - Math.exp(-12 * dt));
    if (won || dead) return;
    const [gx, gy] = gvec(gdir);
    ball.vx += gx * 900 * dt; ball.vy += gy * 900 * dt;
    const sp = Math.hypot(ball.vx, ball.vy), MAX = 620;
    if (sp > MAX) { ball.vx = ball.vx / sp * MAX; ball.vy = ball.vy / sp * MAX; }
    ball.vx *= Math.pow(0.995, dt * 60); ball.vy *= Math.pow(0.995, dt * 60);
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    collide();
    // 出界
    if (ball.x < -CELL || ball.y < -CELL || ball.x > N * CELL + CELL || ball.y > N * CELL + CELL) die();
    // 星标
    for (const s of stars) if (!s.got && dist(ball.x, ball.y, s.x, s.y) < ball.r + 10) { s.got = true; starsGot++; audio.sfx('coin'); ctx.vibrate(PATTERNS.tap); particles.burst(s.x, s.y, 12, { color: PALETTE.amber, speed: 120, life: .5 }); refresh(); }
    // 终点
    const ex = (N - 1) * CELL, ey = (N - 1) * CELL;
    if (map[N - 1]) { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (map[y][x] === 'E' && dist(ball.x, ball.y, x * CELL + CELL / 2, y * CELL + CELL / 2) < ball.r + 8) win(); }
  }
  function die() { if (dead) return; dead = true; audio.sfx('explode'); shake.add(0.5); ctx.vibrate(PATTERNS.damage); particles.explosion(ball.x, ball.y, 1.2, PALETTE.red); setTimeout(() => load(lvIdx), 1000); }
  function win() {
    won = true; audio.sfx('win'); shake.add(0.3); ctx.vibrate(PATTERNS.win);
    particles.burst(ball.x, ball.y, 30, { color: PALETTE.lime, speed: 200, life: .8 });
    const time = (performance.now() - t0) / 1000;
    if (starsGot === stars.length) { if (!best || moves < best) { best = moves; save.set('best', best); } }
    save.set('level', (lvIdx + 1) % L.length);
    setTimeout(() => { lvIdx = (lvIdx + 1) % L.length; save.set('level', lvIdx); load(lvIdx); }, 1400);
    refresh();
  }
  function refresh() { ctx.hud('lv', '关卡', lvIdx + 1); ctx.hud('stars', '星标', starsGot + '/' + stars.length); ctx.hud('rot', '旋转', moves); }

  const off = ctx.listen(ctx.canvas, 'keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'q' || k === 'a') rotate(-1); else if (k === 'e' || k === 'd') rotate(1); else if (k === 'r') load(lvIdx);
  });
  const off2 = ctx.listen(ctx.canvas, 'pointerdown', e => { const x = e.clientX; }); // 触屏用左右半屏
  const off3 = ctx.listen(ctx.canvas, 'pointerup', e => { if (e.clientX < ctx.W / 2) rotate(-1); else rotate(1); });

  load(lvIdx);

  function updateRender(a) {
    const c = ctx.ctx, { W, H } = ctx; c.fillStyle = '#070b16'; c.fillRect(0, 0, W, H);
    c.save(); c.translate(ox, oy); c.rotate(rot * 0 + (rot)); c.scale(scale, scale); c.translate(-N * CELL / 2, -N * CELL / 2);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const ch = map[y][x], X = x * CELL, Y = y * CELL;
      if (ch === '#') neon(c, cc => roundRect(cc, X + 1, Y + 1, CELL - 2, CELL - 2, 4), '#3a4a6e', { glow: 3, width: 1.5, layers: 1, inner: null, fill: 'rgba(30,42,72,.85)' });
      else { c.fillStyle = 'rgba(255,255,255,.02)'; c.fillRect(X + 1, Y + 1, CELL - 2, CELL - 2); }
      if (ch === 'E') { const e = Math.sin(t * 4) * 4; glowCircle(c, X + CELL / 2, Y + CELL / 2, CELL * 0.3 + e, PALETTE.lime, { glow: 16, width: 2, fill: 'rgba(141,255,77,.2)' }); }
    }
    for (const s of stars) if (!s.got) { const e = Math.sin(t * 5 + s.x) * 3; c.save(); c.translate(s.x, s.y); c.rotate(t); c.fillStyle = PALETTE.amber; star(c, 0, 0, CELL * 0.18 + e, 5); c.restore(); }
    glowCircle(c, ball.x, ball.y, ball.r, PALETTE.cyan, { glow: 14, width: 2, fill: 'rgba(34,224,255,.25)' });
    c.restore();
    particles.render(c, 1);
    if (won) text(c, 'CLEAR', W / 2, H / 2, { size: Math.min(40, W * .08), color: PALETTE.lime, weight: 900, glow: 18 });
    // 旋转提示
    text(c, '◐ 旋转：左半屏/右半屏点击 或 Q/E', W / 2, H - 18, { size: 11, color: PALETTE.dim });
  }

  // render 用旋转后的插值位置
  function render(a) { updateRender(a); }

  function star(c, cx, cy, r, spikes = 5, inner = 0.42, rot = -Math.PI / 2) {
    c.beginPath(); for (let i = 0; i < spikes * 2; i++) { const rr = i % 2 ? r * inner : r; const a = rot + i * Math.PI / spikes; const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); c.fill();
  }
  return { update, render, resize: (w, h) => layout(w, h), destroy() { off?.(); off2?.(); off3?.(); } };
}
