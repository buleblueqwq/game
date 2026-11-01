// 引力星系 —— N 体引力沙盒 + 60 秒质量收集挑战
// 你控制一颗亮核（CORE），用方向键 / 鼠标（触屏拖动）施力推进。
// 所有天体按真实引力相互吸引；CORE 吞并靠近的天体增加质量与分数，
// 红色「流氓星」会啃食你的质量。达到目标质量即通关。
import { clamp, lerp, TAU, makeRng } from '../core/math.js';
import { PALETTE, glowCircle, glowLine, text, bar, vignette, radial } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'gravity-galaxy', title: '引力星系', category: 'physics', difficulty: 2,
  music: 'space', howto: ['WASD / 方向键 / 触屏拖动 = 推进亮核', '吞并靠近的天体增加质量', '躲开红色流氓星，60 秒内冲击目标质量'],
  particles: 900
};
export const musicTrack = 'space';

const G = 26;            // 引力常数（调过的）
const SOFT = 14;         // 软化半径，避免奇点
const DAMP = 0.9992;     // 轻微阻尼，保持系统稳定
const ROGUE_CHANCE = 0.16;
const MAX_BODIES = 150;
const TARGET = 600;      // 通关质量
const TIME_LIMIT = 60;

export function create(ctx) {
  const { input, audio, particles, shake, save, rng } = ctx;
  const state = {
    bodies: [], core: null, t: 0, time: TIME_LIMIT, score: 0,
    best: save.get('best', 0), finished: false, flashRogue: 0,
    spawned: 0, dragged: null, W: ctx.W, H: ctx.H
  };

  // 复用对象，避免每帧 new
  function makeBody(x, y, vx, vy, mass, color, rogue) {
    return { x, y, vx, vy, mass, color, rogue: !!rogue, dead: false,
             tr: 0, trr: 0, tx: 0, ty: 0 };
  }
  const radius = (m) => clamp(2.4 * Math.cbrt(m), 2, 64);

  function spawnAmbient(n) {
    for (let i = 0; i < n; i++) {
      if (state.bodies.length >= MAX_BODIES) break;
      const ang = rng.range(0, TAU);
      const d = rng.range(state.W * 0.18, Math.min(state.W, state.H) * 0.46);
      const cx = state.W / 2, cy = state.H / 2;
      const x = cx + Math.cos(ang) * d, y = cy + Math.sin(ang) * d;
      // 给一个大致切向速度，形成绕核公转
      const tx = -Math.sin(ang), ty = Math.cos(ang);
      const sp = rng.range(8, 26) * (rng.chance(0.5) ? 1 : -1);
      const rogue = rng.chance(ROGUE_CHANCE);
      const mass = rogue ? rng.range(6, 16) : rng.range(1.5, 8);
      state.bodies.push(makeBody(x, y, tx * sp, ty * sp, mass,
        rogue ? PALETTE.red : rng.pick([PALETTE.cyan, PALETTE.lime, PALETTE.amber, PALETTE.violet, PALETTE.blue]), rogue));
    }
  }

  function reset() {
    state.bodies.length = 0;
    state.core = makeBody(state.W / 2, state.H / 2, 0, 0, 30, PALETTE.white, false);
    state.core.isCore = true;
    state.bodies.push(state.core);
    state.t = 0; state.time = TIME_LIMIT; state.score = 0; state.finished = false;
    state.spawned = 0; state.flashRogue = 0;
    spawnAmbient(70);
    particles.clear();
  }

  function layout(w, h) { state.W = w; state.H = h; }
  layout(ctx.W, ctx.H);

  reset();
  ctx.hud('mass', '质量', Math.round(state.core.mass));
  ctx.hud('target', '目标', TARGET);
  ctx.hud('time', '时间', TIME_LIMIT);
  ctx.hud('best', '最佳', state.best);

  // 触屏 / 鼠标拖拽：记录起点，松手甩出一颗新星（额外玩法）
  let dragStart = null;
  const offDown = ctx.listen(ctx.canvas, 'pointerdown', (e) => {
    const r = ctx.canvas.getBoundingClientRect();
    dragStart = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  const offUp = ctx.listen(ctx.canvas, 'pointerup', (e) => {
    if (!dragStart) return;
    const r = ctx.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const dx = x - dragStart.x, dy = y - dragStart.y;
    if (Math.hypot(dx, dy) > 26 && state.bodies.length < MAX_BODIES) {
      const m = clamp(Math.hypot(dx, dy) * 0.25, 3, 22);
      state.bodies.push(makeBody(dragStart.x, dragStart.y, dx * 1.4, dy * 1.4, m,
        rng.pick([PALETTE.cyan, PALETTE.amber, PALETTE.lime]), false));
      audio.sfx('whoosh');
      particles.burst(dragStart.x, dragStart.y, 12, { color: PALETTE.cyan, speed: 160, life: .5 });
    }
    dragStart = null;
  });

  function update(dt) {
    state.t += dt;
    if (state.finished) return;
    state.time -= dt;
    if (state.time <= 0) { end(); return; }

    const core = state.core;
    // 玩家施力
    let ax = 0, ay = 0;
    if (input.isDown('left') || input.isDown('a')) ax -= 1;
    if (input.isDown('right') || input.isDown('d')) ax += 1;
    if (input.isDown('up') || input.isDown('w')) ay -= 1;
    if (input.isDown('down') || input.isDown('s')) ay += 1;
    const p = input.pointer;
    if (p && p.down) { ax += (p.x - core.x); ay += (p.y - core.y); }
    const al = Math.hypot(ax, ay) || 1;
    const THRUST = 220;
    core.vx += (ax / al) * THRUST * dt;
    core.vy += (ay / al) * THRUST * dt;

    // N 体引力
    const b = state.bodies;
    for (let i = 0; i < b.length; i++) {
      const A = b[i]; if (A.dead) continue;
      for (let j = i + 1; j < b.length; j++) {
        const B = b[j]; if (B.dead) continue;
        let dx = B.x - A.x, dy = B.y - A.y;
        let d2 = dx * dx + dy * dy + SOFT * SOFT;
        const inv = 1 / Math.sqrt(d2);
        const f = G / d2;
        const nx = dx * inv, ny = dy * inv;
        A.vx += nx * f * B.mass * dt; A.vy += ny * f * B.mass * dt;
        B.vx -= nx * f * A.mass * dt; B.vy -= ny * f * A.mass * dt;
      }
    }
    // 积分 + 边界反弹
    for (let i = 0; i < b.length; i++) {
      const o = b[i]; if (o.dead) continue;
      o.vx *= DAMP; o.vy *= DAMP;
      o.x += o.vx * dt; o.y += o.vy * dt;
      const r = radius(o.mass);
      if (o.x < r) { o.x = r; o.vx = Math.abs(o.vx) * 0.6; }
      if (o.x > state.W - r) { o.x = state.W - r; o.vx = -Math.abs(o.vx) * 0.6; }
      if (o.y < r) { o.y = r; o.vy = Math.abs(o.vy) * 0.6; }
      if (o.y > state.H - r) { o.y = state.H - r; o.vy = -Math.abs(o.vy) * 0.6; }
    }
    // 吞并 / 合并
    for (let i = 0; i < b.length; i++) {
      const A = b[i]; if (A.dead) continue;
      const ra = radius(A.mass);
      for (let j = i + 1; j < b.length; j++) {
        const B = b[j]; if (B.dead) continue;
        const rb = radius(B.mass);
        const dx = B.x - A.x, dy = B.y - A.y;
        const d = Math.hypot(dx, dy);
        if (d < (ra + rb) * 0.62) {
          // CORE 吞并
          if (A.isCore || B.isCore) {
            const core2 = A.isCore ? A : B;
            const other = A.isCore ? B : A;
            core2.mass += other.mass;
            other.dead = true;
            particles.explosion(other.x, other.y, 0.6 + other.mass * 0.04, other.color);
            if (other.rogue) {
              core2.mass = Math.max(8, core2.mass - other.mass * 1.6);
              state.score = Math.max(0, state.score - 8);
              state.flashRogue = 0.35;
              audio.sfx('hurt'); ctx.vibrate(PATTERNS.damage); shake.add(0.4);
            } else {
              state.score += Math.round(other.mass * 2);
              audio.sfx('coin'); ctx.vibrate(PATTERNS.tap);
              particles.ring(other.x, other.y, core2.color, ra + 18);
            }
          } else {
            // 普通天体合并：动量守恒，并入较重者
            const big = A.mass >= B.mass ? A : B;
            const sm = A.mass >= B.mass ? B : A;
            const M = A.mass + B.mass;
            big.x = (A.x * A.mass + B.x * B.mass) / M;
            big.y = (A.y * A.mass + B.y * B.mass) / M;
            big.vx = (A.vx * A.mass + B.vx * B.mass) / M;
            big.vy = (A.vy * A.mass + B.vy * B.mass) / M;
            big.mass = M;
            sm.dead = true;
            particles.burst(big.x, big.y, 6, { color: big.color, speed: 80, life: .4 });
          }
        }
      }
    }
    // 压缩数组
    let w = 0;
    for (let i = 0; i < b.length; i++) if (!b[i].dead) b[w++] = b[i];
    b.length = w;

    // 维持天体数量
    if (b.length < 80 - state.spawned * 0) spawnAmbient(2);

    if (state.flashRogue > 0) state.flashRogue -= dt;

    ctx.hud('mass', '质量', Math.round(core.mass));
    ctx.hud('time', '时间', Math.max(0, Math.ceil(state.time)));
    if (core.mass >= TARGET && !state.finished) { end(); }
  }

  function end() {
    if (state.finished) return;
    state.finished = true;
    const win = state.core.mass >= TARGET;
    if (state.core.mass > state.best) { state.best = Math.round(state.core.mass); save.set('best', state.best); }
    audio.sfx(win ? 'win' : 'lose');
    ctx.vibrate(win ? PATTERNS.win : PATTERNS.lose);
    ctx.finish(Math.round(state.core.mass), {
      win, higherBetter: true,
      stats: [['存活', (TIME_LIMIT - Math.max(0, state.time)).toFixed(1) + 's'], ['最佳', state.best]]
    });
  }

  function render(alpha, rdt = 0.016) {
    const c = ctx.ctx; const { W, H } = ctx;
    c.fillStyle = '#04060e'; c.fillRect(0, 0, W, H);
    // 背景星点（静态，用核心位置偏移制造视差）
    radial(c, W / 2, H / 2, Math.max(W, H) * 0.7,
      [[0, 'rgba(20,30,70,.35)'], [1, 'rgba(4,6,14,0)']]);

    const b = state.bodies;
    // 轨迹与连线（仅对较大天体画引力微光）
    for (let i = 0; i < b.length; i++) {
      const o = b[i];
      const r = radius(o.mass);
      const pulse = o.isCore ? 1 + Math.sin(state.t * 4) * 0.06 : 1;
      glowCircle(c, o.x, o.y, r * pulse, o.color, { fill: o.isCore ? 'rgba(255,255,255,.25)' : o.color + '22', glow: o.isCore ? 26 : 14 });
      if (o.rogue) {
        c.strokeStyle = 'rgba(255,77,94,.5)'; c.lineWidth = 1;
        c.beginPath(); c.arc(o.x, o.y, r + 4 + Math.sin(state.t * 6 + i) * 2, 0, TAU); c.stroke();
      }
    }
    // 拖拽提示线
    if (dragStart && input.pointer && input.pointer.down) {
      glowLine(c, dragStart.x, dragStart.y, input.pointer.x, input.pointer.y, PALETTE.cyan, 2, 10, 0.7);
    }

    particles.render(c, 1);
    if (state.flashRogue > 0) {
      c.fillStyle = `rgba(255,77,94,${state.flashRogue * 0.3})`;
      c.fillRect(0, 0, W, H);
    }
    // 进度
    bar(c, 16, H - 26, W - 32, 6, clamp(state.core.mass / TARGET, 0, 1),
      { fill: state.core.mass >= TARGET ? PALETTE.lime : PALETTE.cyan });
    text(c, `目标 ${TARGET}`, 16, H - 32, { size: 11, color: PALETTE.dim, baseline: 'bottom' });
    text(c, `分数 ${state.score}`, W - 16, H - 32, { size: 11, color: PALETTE.dim, baseline: 'bottom', align: 'right' });
    vignette(c, W, H, 0.5);
  }

  function resize(w, h) { layout(w, h); }
  return {
    update, render, resize,
    destroy() { offDown?.(); offUp?.(); }
  };
}
