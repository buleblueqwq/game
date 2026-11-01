// 霓虹贪吃蛇 —— 参考实现（展示 ctx 全套能力：输入缓冲、插值渲染、粒子、震屏、音效、HUD、触屏）
import { clamp, lerp, TAU, makeRng, ease } from '../core/math.js';
import { PALETTE, glowCircle, glowRect, roundRect, text, bar, grid as drawGrid, vignette } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'neon-snake', title: '霓虹贪吃蛇', category: 'action', difficulty: 2,
  music: 'arcade', howto: ['方向键/WASD 转向', '空格 = 加速冲刺', '吃金色果实获得 3 倍分数'],
  particles: 900
};
export const musicTrack = 'arcade';

const N = 26;                 // 网格边长
const BASE_STEP = 0.115;      // 每格基础耗时（秒）

export function create(ctx) {
  const { input, audio, particles, shake, save, rng } = ctx;
  const state = {
    snake: [], dir: { x: 1, y: 0 }, nextDir: { x: 1, y: 0 }, queue: [],
    food: null, gold: null, obstacles: [],
    step: BASE_STEP, timer: 0, alive: true, score: 0, length: 4,
    mult: 1, multTimer: 0, boost: 0, t: 0, best: save.get('best', 0),
    grow: 0, deadTimer: 0
  };

  // ---- 布局 ----
  let cell = 20, ox = 0, oy = 0;
  function layout(w, h) {
    const s = Math.min(w, h) - 16;
    cell = Math.max(8, Math.floor(s / N));
    ox = Math.round((w - cell * N) / 2);
    oy = Math.round((h - cell * N) / 2);
  }
  layout(ctx.W, ctx.H);
  const px = (i) => ox + i * cell + cell / 2;
  const idxOf = (x, y) => y * N + x;

  // ---- 关卡生成 ----
  function reset() {
    state.snake = [{ x: 6, y: 13 }, { x: 5, y: 13 }, { x: 4, y: 13 }];
    state.dir = { x: 1, y: 0 }; state.nextDir = { x: 1, y: 0 }; state.queue = [];
    state.length = 4; state.score = 0; state.mult = 1; state.multTimer = 0;
    state.step = BASE_STEP; state.timer = 0; state.alive = true; state.grow = 0;
    state.obstacles = []; state.deadTimer = 0; state.boost = 0;
    spawnFood(); spawnGold();
    particles.clear();
  }
  function freeCell(avoid = []) {
    const taken = new Set([...state.snake.map(s => idxOf(s.x, s.y)), ...state.obstacles.map(o => idxOf(o.x, o.y)), ...avoid]);
    for (let k = 0; k < 200; k++) {
      const x = rng.int(0, N - 1), y = rng.int(0, N - 1);
      if (!taken.has(idxOf(x, y))) return { x, y };
    }
    return { x: (state.snake[0].x + 3) % N, y: state.snake[0].y };
  }
  function spawnFood() { const c = freeCell(state.food ? [idxOf(state.food.x, state.food.y)] : []); state.food = { ...c, born: state.t, type: 'normal' }; }
  function spawnGold() { const c = freeCell(); state.gold = { ...c, born: state.t, life: 9 }; }

  function addObstacle() {
    const c = freeCell([idxOf(state.food.x, state.food.y), idxOf(state.gold?.x ?? 0, state.gold?.y ?? 0)]);
    // 避免堵死：只放在离蛇头较远处
    if (Math.abs(c.x - state.snake[0].x) + Math.abs(c.y - state.snake[0].y) < 5) return;
    state.obstacles.push({ ...c, born: state.t });
    particles.burst(px(c.x), px(c.y), 10, { color: PALETTE.red, speed: 90, life: .5 });
  }

  // ---- 输入 ----
  const TURN = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
  };
  function tryTurn(d) {
    if (!d) return;
    const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
    if (d.x === -last.x && d.y === -last.y) return;   // 禁止 180° 掉头
    if (d.x === last.x && d.y === last.y) return;
    if (state.queue.length < 2) state.queue.push(d);
  }
  // 触屏：滑动手势
  let tStart = null;
  const offPointer = ctx.listen(ctx.canvas, 'pointerdown', (e) => { tStart = { x: e.clientX, y: e.clientY }; });
  const offPointer2 = ctx.listen(ctx.canvas, 'pointerup', (e) => {
    if (!tStart) return;
    const dx = e.clientX - tStart.x, dy = e.clientY - tStart.y;
    if (Math.hypot(dx, dy) > 22) {
      tryTurn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? TURN.right : TURN.left) : (dy > 0 ? TURN.down : TURN.up));
    }
    tStart = null;
  });

  reset();
  ctx.hud('score', '分数', 0);
  ctx.hud('len', '长度', 4);
  ctx.hud('mult', '倍率', 'x1');
  ctx.hud('best', '最佳', state.best);

  // ---- 逻辑 ----
  function step() {
    const head = state.snake[0];
    if (state.queue.length) state.dir = state.queue.shift();
    const nx = head.x + state.dir.x, ny = head.y + state.dir.y;

    // 撞墙 / 撞自己 / 撞障碍
    const hitSelf = state.snake.some((s, i) => i < state.snake.length - 1 && s.x === nx && s.y === ny);
    const hitObs = state.obstacles.some(o => o.x === nx && o.y === ny);
    if (nx < 0 || ny < 0 || nx >= N || ny >= N || hitSelf || hitObs) { die(); return; }

    state.snake.unshift({ x: nx, y: ny });
    if (state.grow > 0) { state.grow--; } else { state.snake.pop(); }

    // 吃食物
    if (state.food && nx === state.food.x && ny === state.food.y) {
      eat(state.food, false); spawnFood();
    } else if (state.gold && nx === state.gold.x && ny === state.gold.y) {
      eat(state.gold, true); state.gold = null;
    }
    if (state.snake.length !== state.length) { state.length = state.snake.length; ctx.hud('len', '长度', state.length); }

    // 难度递增：加速、加障碍
    state.step = Math.max(0.055, BASE_STEP - state.score * 0.00035);
    if (state.score > 0 && state.score % 5 === 0 && state.obstacles.length < 10 && rng.chance(0.35)) addObstacle();
  }

  function eat(f, gold) {
    const gain = gold ? 5 : 1;
    const pts = Math.round(gain * 10 * state.mult);
    state.score += pts;
    state.grow += gold ? 3 : 1;
    state.mult = gold ? 3 : state.mult;
    state.multTimer = gold ? 5 : state.multTimer;
    ctx.hud('score', '分数', state.score);
    ctx.hud('mult', '倍率', 'x' + state.mult, { color: state.mult > 1 ? PALETTE.amber : null });
    audio.sfx(gold ? 'powerup' : 'coin');
    ctx.vibrate(gold ? PATTERNS.combo : PATTERNS.tap);
    shake.add(gold ? 0.35 : 0.12);
    particles.burst(px(f.x), px(f.y), gold ? 26 : 14, { color: gold ? PALETTE.amber : PALETTE.lime, speed: gold ? 260 : 160, life: .6, size: gold ? 4 : 3 });
    particles.ring(px(f.x), px(f.y), gold ? PALETTE.amber : PALETTE.lime, cell * 1.6);
    particles.text(px(f.x), px(f.y) - cell, '+' + pts, gold ? '#ffb020' : '#8dff4d');
    if (gold) setTimeout(spawnGold, 4000);
  }

  function die() {
    state.alive = false;
    state.deadTimer = 0;
    audio.sfx('die');
    audio.duck(0.6, 900);
    ctx.vibrate(PATTERNS.damage);
    shake.add(0.85);
    const h = state.snake[0];
    particles.explosion(px(h.x), px(h.y), 1.5, PALETTE.red);
    for (const s of state.snake) particles.burst(px(s.x), px(s.y), 4, { color: PALETTE.cyan, speed: 130, life: .8, kind: 5 });
    if (state.score > state.best) { state.best = state.score; save.set('best', state.best); ctx.hud('best', '最佳', state.best, { color: PALETTE.lime }); }
  }

  // ---- 更新 ----
  function update(dt) {
    state.t += dt;
    if (state.alive) {
      // 输入（带缓冲，避免快速连按丢帧）
      for (const [key, d] of [['up', TURN.up], ['down', TURN.down], ['left', TURN.left], ['right', TURN.right]]) {
        if (input.consume(key, 150)) tryTurn(d);
      }
      if (input.isDown('dash') || input.isDown('secondary')) state.boost = Math.min(1, state.boost + dt * 5);
      else state.boost = Math.max(0, state.boost - dt * 4);

      const rate = 1 + state.boost * 1.6;
      state.timer += dt * rate;
      let guard = 0;
      while (state.timer >= state.step && state.alive && guard++ < 4) { state.timer -= state.step; step(); }

      if (state.multTimer > 0) {
        state.multTimer -= dt;
        if (state.multTimer <= 0) { state.mult = 1; ctx.hud('mult', '倍率', 'x1'); }
      }
      if (state.gold) {
        state.gold.life -= dt;
        if (state.gold.life <= 0) { state.gold = null; setTimeout(spawnGold, 3500); }
      }
      // 蛇头拖尾
      if (rng.chance(0.55)) {
        const h = state.snake[0];
        particles.trail(px(h.x) - state.dir.x * cell * .4, px(h.y) - state.dir.y * cell * .4, PALETTE.cyan, cell * .12);
      }
    } else {
      state.deadTimer += dt;
      if (state.deadTimer > 1.1 && !state.finished) {
        state.finished = true;
        ctx.finish(state.score, { win: false, stats: [['长度', state.length], ['倍率', 'x' + state.mult]] });
      }
    }
  }

  // ---- 渲染（插值） ----
  function render(alpha, rdt = 0.016) {
    const c = ctx.ctx;
    const { W, H } = ctx;
    // 背景
    c.fillStyle = '#05080f';
    c.fillRect(0, 0, W, H);
    c.save();
    shake.apply(c);

    // 场地
    const bw = cell * N;
    c.save();
    c.fillStyle = 'rgba(10,16,32,.9)';
    roundRect(c, ox - 6, oy - 6, bw + 12, bw + 12, 12); c.fill();
    c.strokeStyle = 'rgba(34,224,255,.22)'; c.lineWidth = 1.5; c.stroke();
    drawGrid(c, bw, bw, cell, 'rgba(60,90,150,.10)', 1, 0, 0);
    c.translate(ox, oy);

    // 障碍
    for (const o of state.obstacles) {
      const a = Math.min(1, (state.t - o.born) * 3);
      const s = cell * 0.86 * ease.outBack(a);
      c.save(); c.translate(o.x * cell + cell / 2, o.y * cell + cell / 2);
      c.fillStyle = 'rgba(255,77,94,.30)';
      c.strokeStyle = 'rgba(255,77,94,.85)'; c.lineWidth = 2;
      roundRect(c, -s / 2, -s / 2, s, s, 4); c.fill(); c.stroke();
      c.restore();
    }

    // 食物
    if (state.food) drawFood(state.food, PALETTE.lime, false);
    if (state.gold) {
      const blink = state.gold.life < 3 ? (Math.sin(state.t * 18) > 0 ? 1 : .25) : 1;
      c.globalAlpha = blink; drawFood(state.gold, PALETTE.amber, true); c.globalAlpha = 1;
    }

    // 蛇（插值：头部在两格之间平滑移动）
    const t = state.alive ? clamp(state.timer / state.step, 0, 1) : 1;
    for (let i = state.snake.length - 1; i >= 0; i--) {
      const s = state.snake[i];
      let x = s.x, y = s.y;
      if (i === 0 && state.alive) { x = s.x - state.dir.x * (1 - t); y = s.y - state.dir.y * (1 - t); }
      else if (i > 0 && state.alive) {
        const prev = state.snake[i - 1];
        // 段跟随：朝向前一段插值
        x = lerp(prev.x, s.x, clamp(t * 1.0, 0, 1));
        y = lerp(prev.y, s.y, clamp(t * 1.0, 0, 1));
      }
      const cx = x * cell + cell / 2, cy = y * cell + cell / 2;
      const f = 1 - i / (state.snake.length + 4);
      const r = cell * (0.30 + 0.18 * f);
      const hue = 185 + i * 2.2;
      c.fillStyle = `hsl(${hue},100%,${48 + f * 18}%)`;
      c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
      if (i === 0) {
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(cx, cy, r * 0.42, 0, TAU); c.fill();
        // 眼睛
        const ex = cx + state.dir.x * r * .45, ey = cy + state.dir.y * r * .45;
        c.fillStyle = '#04121c';
        c.beginPath(); c.arc(ex, ey, r * .22, 0, TAU); c.fill();
      }
    }

    // 死亡闪烁
    if (!state.alive) {
      c.globalAlpha = Math.max(0, 0.5 - state.deadTimer * .4);
      c.fillStyle = PALETTE.red; c.fillRect(0, 0, bw, bw);
      c.globalAlpha = 1;
    }
    c.restore();
    particles.render(c, 1);
    particles.renderTexts(c, rdt);
    c.restore();

    // 冲刺条
    if (state.alive && state.boost > 0.01) {
      bar(c, W / 2 - 60, H - 26, 120, 5, state.boost, { fill: PALETTE.cyan, bg: 'rgba(255,255,255,.08)' });
      text(c, '冲刺', W / 2, H - 34, { size: 10, color: PALETTE.dim, baseline: 'bottom' });
    }
    vignette(c, W, H, 0.4);

    if (!state.alive && state.deadTimer > .2) {
      text(c, 'GAME OVER', W / 2, H / 2, { size: Math.min(46, W * .1), color: PALETTE.red, weight: 900, glow: 22 });
      text(c, '按 R 重开', W / 2, H / 2 + 34, { size: 13, color: PALETTE.dim });
    }
  }

  function drawFood(f, color, gold) {
    const c = ctx.ctx;
    const cx = f.x * cell + cell / 2, cy = f.y * cell + cell / 2;
    const pulse = 1 + Math.sin(state.t * 6 + f.x) * .12;
    const r = cell * .3 * pulse;
    c.save();
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
    g.addColorStop(0, color + 'aa'); g.addColorStop(1, color + '00');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r * 3, 0, TAU); c.fill();
    if (gold) {
      c.translate(cx, cy); c.rotate(state.t * 1.6);
      c.fillStyle = color; c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i * TAU / 8, rr = i % 2 ? r * .45 : r;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.closePath(); c.fill();
    } else {
      c.fillStyle = color; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(cx - r * .3, cy - r * .3, r * .25, 0, TAU); c.fill();
    }
    c.restore();
  }

  // ---- 生命周期 ----
  function resize(w, h) { layout(w, h); }

  return {
    update, render, resize,
    destroy() { offPointer?.(); offPointer2?.(); },
    pause() { audio.duck(0.5, 3000); },
    resume() { }
  };
}
