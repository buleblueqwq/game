// 霓虹弹球 —— 物理反射、多层砖块、五种道具、多球与连击倍率，8 关程序生成布局
import { clamp, lerp, TAU } from '../core/math.js';
import { PALETTE, glowCircle, glowRect, roundRect, text, bar, grid as drawGrid, vignette, Trail } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'breakout-neon', title: '霓虹弹球', category: 'action', difficulty: 2,
  music: 'arcade',
  howto: ['鼠标 / 触摸 / ← → 控制挡板', '点击或空格发球，挡板速度会给球加旋', '接住掉落道具，连续击砖提升连击倍率'],
  particles: 1200
};
export const musicTrack = 'arcade';

const COLS = 11, MAX_ROWS = 9;
const MAX_BALLS = 10;
const MAX_POW = 12;
const POWERS = [
  { id: 'multi', label: '多球', color: PALETTE.lime, icon: '◍' },
  { id: 'expand', label: '加长', color: PALETTE.cyan, icon: '↔' },
  { id: 'pierce', label: '穿透', color: PALETTE.magenta, icon: '➤' },
  { id: 'slow', label: '慢速', color: PALETTE.blue, icon: '◒' },
  { id: 'magnet', label: '磁吸', color: PALETTE.amber, icon: '⊙' }
];
const TYPE_COLOR = {
  normal: [PALETTE.cyan, PALETTE.lime, PALETTE.green],
  hard: [PALETTE.violet, PALETTE.blue],
  bomb: [PALETTE.amber, PALETTE.red],
  solid: [PALETTE.dim]
};

export function create(ctx) {
  const { input, audio, particles, shake, flash, rng } = ctx;

  let W = ctx.W, H = ctx.H;
  const F = { x: 0, y: 0, w: 0, h: 0 };              // 场地
  let bw = 40, bh = 20, rows = 6;

  const S = {
    t: 0, score: 0, lives: 3, level: 1, combo: 0, maxCombo: 0, mult: 1, best: ctx.save.get('best', 0),
    bricksLeft: 0, state: 'serve',   // serve | play | clear | over
    clearTimer: 0, over: false, finished: false, bricksBroken: 0, launchHint: 0
  };
  const FX = { expand: 0, pierce: 0, slow: 0, magnet: 0 };

  const paddle = { x: 0, y: 0, w: 0, h: 0, px: 0, vx: 0, base: 0 };
  const bricks = [];
  for (let i = 0; i < COLS * MAX_ROWS; i++) bricks.push({ col: 0, row: 0, hp: 1, max: 1, type: 'normal', color: PALETTE.cyan, dead: true, flash: 0, wob: 0 });
  const balls = [];
  for (let i = 0; i < MAX_BALLS; i++) balls.push({ x: 0, y: 0, vx: 0, vy: 0, r: 7, stuck: true, dead: true, spin: 0, trail: new Trail(10), speed: 0 });
  const powers = [];
  for (let i = 0; i < MAX_POW; i++) powers.push({ x: 0, y: 0, vy: 0, type: 0, dead: true, rot: 0 });

  ctx.hud('score', '分数', 0);
  ctx.hud('level', '关卡', '1/8', { color: PALETTE.cyan });
  ctx.hud('combo', '连击', 'x1', { color: PALETTE.lime });
  ctx.hud('lives', '生命', 3, { color: PALETTE.red });

  // ---------------------------------------------------------------- 布局
  function layout(w, h) {
    const oldW = F.w || w, oldH = F.h || h;
    W = w; H = h;
    const pad = Math.max(10, Math.min(30, W * .03));
    F.x = pad; F.w = W - pad * 2;
    F.y = Math.max(52, H * .12); F.h = H - F.y - Math.max(16, H * .03);
    bw = F.w / COLS; bh = clamp(bw * .48, 12, 30);
    paddle.base = clamp(F.w * .17, 58, 190);
    paddle.w = paddle.base * (FX.expand > 0 ? 1.7 : 1);
    paddle.h = Math.max(10, Math.min(18, H * .022));
    paddle.y = F.y + F.h - paddle.h - Math.max(8, H * .03);
    if (!paddle.x) paddle.x = F.x + F.w / 2;
    paddle.x = clamp(paddle.x, F.x + paddle.w / 2, F.x + F.w - paddle.w / 2);
    // 球体按比例迁移，避免 resize 后飞出场地
    if (oldW > 0) {
      const sx = F.w / oldW, sy = F.h / oldH;
      for (const b of balls) {
        if (b.dead) continue;
        b.x = F.x + (b.x - F.x) * sx; b.y = F.y + (b.y - F.y) * sy;
      }
    }
  }
  layout(W, H);

  // ---------------------------------------------------------------- 关卡生成
  function buildLevel(n) {
    for (const b of bricks) { b.dead = true; b.flash = 0; }
    for (const p of powers) { p.dead = true; }
    for (const b of balls) { b.dead = true; b.trail.clear(); }
    rows = clamp(4 + Math.ceil(n * .6), 5, MAX_ROWS);
    S.bricksLeft = 0;
    const set = (col, row, hp, type, colorPool) => {
      if (col < 0 || col >= COLS || row < 0 || row >= MAX_ROWS) return;
      const b = firstFreeBrick();
      if (!b) return;
      b.col = col; b.row = row; b.hp = hp; b.max = hp;
      b.type = type; b.color = colorPool[(col + row) % colorPool.length];
      b.dead = false; b.flash = 0; b.wob = rng() * TAU;
      S.bricksLeft++;
    };
    const style = n % 4;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        let solid = false;
        if (style === 0) solid = true;                                        // 满墙渐变
        else if (style === 1) solid = (r + c) % 2 === 0 || r % 3 === 0;       // 棋盘 + 横梁
        else if (style === 2) solid = c >= r && c < COLS - r;                 // 金字塔
        else solid = Math.abs(c - (COLS - 1) / 2) + r * .8 < rows * .75;      // 菱形
        if (!solid) continue;
        let type = 'normal', hp = 1;
        const roll = rng();
        if (n >= 2 && roll < .06 + n * .012) type = 'bomb';
        else if (roll < .16 + n * .035) { type = 'hard'; hp = clamp(2 + Math.floor(n / 4), 2, 3); }
        if (n >= 5 && r === 0 && rng.chance(.35)) { type = 'solid'; hp = 99; }
        if (n >= 7 && rng.chance(.06)) { type = 'solid'; hp = 99; }
        set(c, r, hp, type, TYPE_COLOR[type]);
      }
    }
    // 保底：至少 8 块
    if (S.bricksLeft < 8) for (let c = 0; c < 8; c++) set(c, 0, 1, 'normal', TYPE_COLOR.normal);
    // 记录可破坏数量（solid 不计入通关条件）
    let breakable = 0;
    for (const b of bricks) if (!b.dead && b.type !== 'solid') breakable++;
    S.bricksLeft = breakable;
    S.combo = 0; S.mult = 1;
    resetBall(true);
    S.state = 'serve';
  }

  function firstFreeBrick() {
    for (const b of bricks) if (b.dead) return b;
    return null;
  }

  function resetBall(keepX) {
    for (const b of balls) { b.dead = true; b.trail.clear(); }
    const b = balls[0];
    b.dead = false; b.stuck = true;
    b.x = paddle.x; b.y = paddle.y - 12;
    b.r = clamp(Math.min(bw, bh) * .34, 5, 11);
    b.speed = baseSpeed();
    b.vx = 0; b.vy = 0;
    S.state = 'serve';
  }

  function baseSpeed() { return (300 + S.level * 26) * (Math.min(1.4, H / 640)); }

  // ---------------------------------------------------------------- 球 / 挡板
  function launch() {
    let launched = false;
    for (const b of balls) {
      if (b.dead || !b.stuck) continue;
      b.stuck = false;
      const a = -Math.PI / 2 + rng.range(-.42, .42);
      const sp = b.speed * (FX.slow > 0 ? .62 : 1);
      b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
      launched = true;
    }
    if (launched) {
      S.state = 'play';
      audio.sfx('shoot', { gain: .8 });
      ctx.vibrate(PATTERNS.tap);
    }
  }

  const _lastPointerX = { v: -1 };
  function updatePaddle(dt) {
    paddle.px = paddle.x;
    // 指针（鼠标悬停 / 触摸拖动）优先；键盘左右键叠加控制
    if (input.pointer.down || Math.abs(input.pointer.x - _lastPointerX.v) > 0.6) {
      _lastPointerX.v = input.pointer.x;
      if (input.pointer.x > 0) {
        const tx = clamp(input.pointer.x, F.x + paddle.w / 2, F.x + F.w - paddle.w / 2);
        paddle.x = lerp(paddle.x, tx, 1 - Math.exp(-22 * dt));
      }
    }
    let kb = 0;
    if (input.isDown('left')) kb -= 1;
    if (input.isDown('right')) kb += 1;
    if (kb) paddle.x += kb * F.w * 1.35 * dt;
    paddle.x = clamp(paddle.x, F.x + paddle.w / 2, F.x + F.w - paddle.w / 2);
    paddle.vx = (paddle.x - paddle.px) / Math.max(dt, 1e-4);
    paddle.w = paddle.base * (FX.expand > 0 ? 1.7 : 1) * (1 + Math.sin(S.t * 3) * .012);
  }

  function updateBalls(dt) {
    for (const b of balls) {
      if (b.dead) continue;
      if (b.stuck) { b.x = paddle.x; b.y = paddle.y - b.r - 3; continue; }
      const sp = Math.hypot(b.vx, b.vy);
      const target = b.speed * (FX.slow > 0 ? .62 : 1);
      if (sp > 0 && Math.abs(sp - target) > 6) {
        const k = target / sp;
        b.vx *= lerp(1, k, Math.min(1, dt * 3)); b.vy *= lerp(1, k, Math.min(1, dt * 3));
      }
      const steps = clamp(Math.ceil(sp * dt / (b.r * .9)), 1, 6);
      const sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        b.x += b.vx * sdt; b.y += b.vy * sdt;
        if (collideWalls(b)) break;
        if (collidePaddle(b)) break;
        if (collideBricks(b)) break;
      }
      b.trail.push(b.x, b.y);
      if (rng.chance(.35)) particles.trail(b.x, b.y, FX.pierce > 0 ? PALETTE.magenta : PALETTE.cyan, 2.4);
    }
  }

  function collideWalls(b) {
    if (b.x - b.r < F.x) { b.x = F.x + b.r; b.vx = Math.abs(b.vx); wallFx(b); }
    else if (b.x + b.r > F.x + F.w) { b.x = F.x + F.w - b.r; b.vx = -Math.abs(b.vx); wallFx(b); }
    if (b.y - b.r < F.y) { b.y = F.y + b.r; b.vy = Math.abs(b.vy); wallFx(b); }
    if (b.y - b.r > F.y + F.h + 20) { b.dead = true; return true; }
    return false;
  }

  function wallFx(b) {
    audio.sfx('reflect', { gain: .35 });
    particles.burst(b.x, b.y, 4, { color: PALETTE.cyan, speed: 90, life: .25, size: 2, kind: 1 });
  }

  function collidePaddle(b) {
    const px = paddle.x - paddle.w / 2, pw = paddle.w, py = paddle.y, ph = paddle.h;
    if (b.vy <= 0) return false;
    if (b.y + b.r < py || b.y - b.r > py + ph) return false;
    if (b.x + b.r < px || b.x - b.r > px + pw) return false;
    // 命中：角度映射 + 挡板横向速度带来的旋转
    const off = clamp((b.x - paddle.x) / (paddle.w / 2), -1, 1);
    let a = -Math.PI / 2 + off * 1.06;
    a += clamp(paddle.vx * 0.00055, -0.34, 0.34);
    // 防止出现完全垂直的死循环：保证最小水平分量
    let dev = a + Math.PI / 2;
    if (Math.abs(dev) < .22) dev = (dev >= 0 ? .22 : -.22);
    a = -Math.PI / 2 + dev;
    a = clamp(a, -Math.PI + 0.34, -0.34);
    const sp = Math.hypot(b.vx, b.vy) * (1 + Math.min(.12, Math.abs(paddle.vx) * 0.00012));
    b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
    b.y = py - b.r - 0.5;
    b.spin = off;
    audio.sfx('place', { gain: .6 });
    ctx.vibrate(PATTERNS.tap);
    particles.burst(b.x, py, 8, { color: PALETTE.cyan, speed: 160, life: .3, size: 2.4, kind: 1, angle: -Math.PI / 2, spread: 1.5 });
    // 落地：连击清零
    if (S.combo > 0) { S.combo = 0; S.mult = 1; ctx.hud('combo', '连击', 'x1'); }
    if (FX.magnet > 0) { b.stuck = true; audio.sfx('lock', { gain: .5 }); particles.ring(b.x, py, PALETTE.amber, 30); }
    return true;
  }

  function collideBricks(b) {
    let hit = null, bestPen = 0, bestAxis = 0, bestSign = 0;
    for (const k of bricks) {
      if (k.dead) continue;
      const bx = F.x + k.col * bw, by = F.y + k.row * bh;
      if (b.x + b.r < bx || b.x - b.r > bx + bw || b.y + b.r < by || b.y - b.r > by + bh) continue;
      // 最近面判定：比较两轴穿透深度
      const cx = bx + bw / 2, cy = by + bh / 2;
      const dx = (bw / 2 + b.r) - Math.abs(b.x - cx);
      const dy = (bh / 2 + b.r) - Math.abs(b.y - cy);
      const pen = Math.min(dx, dy);
      if (pen > bestPen) {
        bestPen = pen; hit = k;
        if (dx < dy) { bestAxis = 0; bestSign = b.x < cx ? -1 : 1; }
        else { bestAxis = 1; bestSign = b.y < cy ? -1 : 1; }
      }
    }
    if (!hit) return false;
    if (FX.pierce <= 0) {
      if (bestAxis === 0) { b.vx = Math.abs(b.vx) * bestSign; b.x += bestSign * bestPen; }
      else { b.vy = Math.abs(b.vy) * bestSign; b.y += bestSign * bestPen; }
    }
    damageBrick(hit, FX.pierce > 0 ? 2 : 1);
    return false;
  }

  function damageBrick(k, dmg) {
    if (k.dead) return;
    const bx = F.x + k.col * bw, by = F.y + k.row * bh;
    if (k.type === 'solid') {
      audio.sfx('lock', { gain: .4 });
      particles.burst(bx + bw / 2, by + bh / 2, 5, { color: PALETTE.dim, speed: 110, life: .25, size: 2, kind: 4 });
      return;
    }
    k.hp -= dmg; k.flash = 1;
    if (k.hp > 0) {
      audio.sfx('hit', { gain: .5 });
      particles.burst(bx + bw / 2, by + bh / 2, 6, { color: k.color, speed: 130, life: .3, size: 2.4, kind: 4 });
      ctx.vibrate(PATTERNS.step);
      return;
    }
    k.dead = true;
    S.bricksLeft--; S.bricksBroken++;
    S.combo++;
    if (S.combo > S.maxCombo) S.maxCombo = S.combo;
    S.mult = clamp(1 + Math.floor(S.combo / 4) * .5, 1, 8);
    const base = k.type === 'bomb' ? 120 : (k.type === 'hard' ? 90 : 50);
    const gain = Math.round(base * S.mult);
    S.score += gain;
    ctx.hud('score', '分数', S.score);
    ctx.hud('combo', '连击', 'x' + S.mult, { color: S.mult >= 3 ? PALETTE.amber : PALETTE.lime });
    audio.sfx(S.combo % 6 === 0 ? 'combo' : 'hit', { combo: S.combo, gain: .55 });
    ctx.vibrate(PATTERNS.combo);
    shake.add(.08 + Math.min(.12, S.combo * .004));
    particles.burst(bx + bw / 2, by + bh / 2, 14, { color: k.color, speed: 220, life: .45, size: 3, kind: 5, grav: 500, drag: 1.6 });
    particles.ring(bx + bw / 2, by + bh / 2, k.color, 26);
    particles.text(bx + bw / 2, by, '+' + gain, S.mult >= 3 ? '#ffb020' : '#8dff4d');
    if (k.type === 'bomb') explodeBrick(k);
    maybeDropPower(bx + bw / 2, by + bh / 2);
    if (S.bricksLeft <= 0) levelClear();
  }

  function explodeBrick(k) {
    audio.sfx('explode', { gain: .7 });
    flash.add(.22, PALETTE.amber);
    shake.add(.35);
    ctx.vibrate(PATTERNS.combo);
    const cx = F.x + k.col * bw + bw / 2, cy = F.y + k.row * bh + bh / 2;
    particles.explosion(cx, cy, 1.1, PALETTE.amber);
    const R = Math.max(bw, bh) * 1.9;
    for (const o of bricks) {
      if (o.dead || o.type === 'solid') continue;
      const ox = F.x + o.col * bw + bw / 2, oy = F.y + o.row * bh + bh / 2;
      if ((ox - cx) * (ox - cx) + (oy - cy) * (oy - cy) <= R * R) {
        o.hp -= 3;
        if (o.hp <= 0) { damageBrick(o, 3); }
        else o.flash = 1;
      }
    }
  }

  function maybeDropPower(x, y) {
    if (!rng.chance(.17)) return;
    for (const p of powers) {
      if (p.dead) {
        p.x = x; p.y = y; p.vy = 150 + rng() * 60; p.type = rng.int(0, POWERS.length - 1);
        p.dead = false; p.rot = 0;
        return;
      }
    }
  }

  function updatePowers(dt) {
    for (const p of powers) {
      if (p.dead) continue;
      p.y += p.vy * dt; p.rot += dt * 2.2;
      if (p.y > paddle.y + paddle.h + 20) { p.dead = true; continue; }
      if (p.y + 8 > paddle.y && p.y - 8 < paddle.y + paddle.h &&
        Math.abs(p.x - paddle.x) < paddle.w / 2 + 10) {
        p.dead = true;
        applyPower(p.type, p.x, p.y);
      }
    }
  }

  function applyPower(t, x, y) {
    const P0 = POWERS[t];
    audio.sfx('powerup');
    ctx.vibrate(PATTERNS.combo);
    flash.add(.16, P0.color);
    particles.ring(x, y, P0.color, 60);
    particles.burst(x, y, 20, { color: P0.color, speed: 240, life: .5, size: 3, kind: 1 });
    particles.text(x, y - 10, P0.label, P0.color);
    if (P0.id === 'multi') {
      let spawned = 0;
      for (const src of balls) {
        if (src.dead || spawned >= MAX_BALLS - 1) continue;
        for (const a of [-.42, .42]) {
          const nb = firstFreeBall();
          if (!nb) break;
          nb.dead = false; nb.stuck = false; nb.x = src.x; nb.y = src.y;
          nb.r = src.r; nb.speed = src.speed;
          const sp = Math.hypot(src.vx, src.vy) || src.speed;
          const base = Math.atan2(src.vy, src.vx) + a;
          nb.vx = Math.cos(base) * sp; nb.vy = Math.sin(base) * sp;
          nb.trail.clear();
          spawned++;
        }
      }
      shake.add(.2);
    } else if (P0.id === 'expand') FX.expand = Math.max(FX.expand, 12);
    else if (P0.id === 'pierce') FX.pierce = Math.max(FX.pierce, 8);
    else if (P0.id === 'slow') FX.slow = Math.max(FX.slow, 10);
    else if (P0.id === 'magnet') FX.magnet = Math.max(FX.magnet, 10);
  }

  function firstFreeBall() { for (const b of balls) if (b.dead) return b; return null; }

  function levelClear() {
    if (S.level >= 8) {
      S.state = 'clear'; S.clearTimer = 0; S.win = true;
      audio.sfx('win'); audio.duck(.4, 1200);
      flash.add(.5, '#ffffff');
      return;
    }
    S.state = 'clear'; S.clearTimer = 0;
    audio.sfx('win', { gain: .6 });
    ctx.hint('第 ' + S.level + ' 关通过！');
  }

  function loseLife() {
    S.lives--;
    audio.sfx('hurt'); audio.duck(.4, 700);
    ctx.vibrate(PATTERNS.damage);
    shake.add(.5); flash.add(.25, PALETTE.red);
    ctx.hud('lives', '生命', Math.max(0, S.lives), { color: PALETTE.red });
    for (const p of powers) p.dead = true;
    FX.expand = FX.pierce = FX.slow = FX.magnet = 0;
    if (S.lives <= 0) {
      S.state = 'over'; S.clearTimer = 0;
      audio.sfx('die');
      particles.explosion(paddle.x, paddle.y, 1.4, PALETTE.red);
    } else {
      resetBall(true);
    }
  }

  // ---------------------------------------------------------------- 更新
  function update(dt) {
    S.t += dt;
    if (S.state === 'clear') {
      S.clearTimer += dt;
      if (S.clearTimer > 1.15 && !S.finished) {
        if (S.win) {
          S.finished = true;
          const score = S.score + S.lives * 500 + Math.max(0, 8 - S.level) * 300;
          if (score > S.best) { S.best = score; ctx.save.set('best', score); }
          ctx.finish(score, { win: true, stats: [['破砖', S.bricksBroken], ['最大连击', S.maxCombo], ['剩余生命', S.lives]] });
        } else {
          S.level++;
          ctx.hud('level', '关卡', S.level + '/8', { color: PALETTE.cyan });
          buildLevel(S.level);
        }
      }
      return;
    }
    if (S.state === 'over') {
      S.clearTimer += dt;
      if (S.clearTimer > 1.1 && !S.finished) {
        S.finished = true;
        const score = S.score;
        if (score > S.best) { S.best = score; ctx.save.set('best', score); }
        ctx.finish(score, { win: false, stats: [['到达关卡', S.level + '/8'], ['破砖', S.bricksBroken], ['最大连击', S.maxCombo]] });
      }
      return;
    }

    // 道具计时
    for (const k of ['expand', 'pierce', 'slow', 'magnet']) if (FX[k] > 0) FX[k] = Math.max(0, FX[k] - dt);

    updatePaddle(dt);
    if (S.state === 'serve') {
      if (input.pointer.justDown || input.consume('jump', 130) || input.consume('primary', 130)) launch();
    }
    updateBalls(dt);
    updatePowers(dt);

    // 全部球出界 -> 掉命
    let alive = 0;
    for (const b of balls) if (!b.dead) alive++;
    if (alive === 0) loseLife();

    for (const k of bricks) if (k.flash > 0) k.flash -= dt * 4;
  }

  // ---------------------------------------------------------------- 渲染
  function render(alpha, rdt) {
    const c = ctx.ctx;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a1024'); g.addColorStop(1, '#04060d');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.save();
    shake.apply(c);

    // 场地背板 + 网格
    c.save();
    c.fillStyle = 'rgba(10,16,32,.72)';
    roundRect(c, F.x - 6, F.y - 6, F.w + 12, F.h + 12, 10); c.fill();
    c.strokeStyle = 'rgba(34,224,255,.20)'; c.lineWidth = 1.5; c.stroke();
    c.clip();
    drawGrid(c, F.x + F.w, F.y + F.h, Math.max(28, bw), 'rgba(60,90,150,.07)', 1, F.x, F.y);
    c.restore();

    drawBricks(c);
    drawPowers(c);
    drawPaddle(c);
    drawBalls(c);

    particles.renderTexts(c, rdt);
    c.restore();

    drawHud(c);
    vignette(c, W, H, .4);

    if (S.state === 'serve') {
      const a = .6 + Math.sin(S.t * 5) * .3;
      text(c, ctx.caps.mobile ? '点击发球' : '点击 / 空格发球', F.x + F.w / 2, paddle.y - 46, { size: 15, color: PALETTE.cyan, alpha: a });
    }
    if (S.state === 'clear' && !S.win) {
      text(c, 'LEVEL ' + S.level + ' CLEAR', F.x + F.w / 2, F.y + F.h / 2, { size: Math.min(38, W * .08), color: PALETTE.lime, weight: 900, glow: 20 });
    }
    if (S.state === 'clear' && S.win) {
      text(c, 'ALL CLEAR!', F.x + F.w / 2, F.y + F.h / 2, { size: Math.min(42, W * .09), color: PALETTE.lime, weight: 900, glow: 24 });
    }
    if (S.state === 'over') {
      text(c, 'GAME OVER', F.x + F.w / 2, F.y + F.h / 2, { size: Math.min(40, W * .09), color: PALETTE.red, weight: 900, glow: 20 });
    }
  }

  function drawBricks(c) {
    c.save();
    for (const k of bricks) {
      if (k.dead) continue;
      const x = F.x + k.col * bw + 1, y = F.y + k.row * bh + 1;
      const w = bw - 2, h = bh - 2;
      const hpRatio = k.type === 'solid' ? 1 : k.hp / k.max;
      if (k.type === 'solid') {
        c.fillStyle = 'rgba(125,141,179,.22)';
        roundRect(c, x, y, w, h, 3); c.fill();
        c.strokeStyle = 'rgba(125,141,179,.6)'; c.lineWidth = 1.5; c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.10)';
        c.beginPath();
        for (let i = -h; i < w; i += 7) { c.moveTo(x + i, y + h); c.lineTo(x + i + h, y); }
        c.stroke();
        continue;
      }
      c.fillStyle = k.color;
      c.globalAlpha = .22 + hpRatio * .5 + (k.flash > 0 ? k.flash * .5 : 0);
      roundRect(c, x, y, w, h, 4); c.fill();
      c.globalAlpha = 1;
      if (k.flash > 0) { c.fillStyle = 'rgba(255,255,255,' + (k.flash * .6) + ')'; roundRect(c, x, y, w, h, 4); c.fill(); }
      c.strokeStyle = k.color; c.lineWidth = 2;
      roundRect(c, x, y, w, h, 4); c.stroke();
      if (k.type === 'hard') {
        c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x + 3, y + h / 2); c.lineTo(x + w - 3, y + h / 2); c.stroke();
        c.fillStyle = 'rgba(255,255,255,.7)';
        c.fillRect(x + w / 2 - 4, y + h - 4, 8, 2);
      } else if (k.type === 'bomb') {
        c.fillStyle = PALETTE.amber;
        c.beginPath(); c.arc(x + w / 2, y + h / 2, Math.min(w, h) * .22, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(255,176,32,.5)'; c.lineWidth = 1;
        c.beginPath(); c.arc(x + w / 2, y + h / 2, Math.min(w, h) * (.3 + Math.sin(S.t * 5 + k.wob) * .06), 0, TAU); c.stroke();
      }
    }
    c.restore();
  }

  function drawPowers(c) {
    for (const p of powers) {
      if (p.dead) continue;
      const P0 = POWERS[p.type];
      c.save();
      c.translate(p.x, p.y);
      c.rotate(Math.sin(p.rot) * .25);
      c.fillStyle = 'rgba(8,12,24,.9)';
      roundRect(c, -bw * .34, -bh * .34, bw * .68, bh * .68, 5); c.fill();
      c.strokeStyle = P0.color; c.lineWidth = 2; c.stroke();
      text(c, P0.icon, 0, 1, { size: Math.min(bh * .55, 16), color: P0.color });
      c.restore();
      const gr = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, bw * .7);
      gr.addColorStop(0, P0.color + '44'); gr.addColorStop(1, P0.color + '00');
      c.fillStyle = gr; c.beginPath(); c.arc(p.x, p.y, bw * .7, 0, TAU); c.fill();
    }
  }

  function drawPaddle(c) {
    const x = paddle.x - paddle.w / 2;
    const boost = FX.expand > 0;
    c.save();
    const gr = c.createLinearGradient(0, paddle.y, 0, paddle.y + paddle.h);
    gr.addColorStop(0, boost ? PALETTE.cyan : PALETTE.white);
    gr.addColorStop(1, boost ? PALETTE.blue : PALETTE.cyan);
    c.shadowColor = PALETTE.cyan; c.shadowBlur = 14;
    c.fillStyle = gr;
    roundRect(c, x, paddle.y, paddle.w, paddle.h, paddle.h / 2); c.fill();
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(255,255,255,.55)';
    roundRect(c, x + paddle.w * .1, paddle.y + 2, paddle.w * .8, 2.5, 2); c.fill();
    // 磁吸指示
    if (FX.magnet > 0) {
      c.strokeStyle = PALETTE.amber; c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x, paddle.y - 3); c.lineTo(x + paddle.w, paddle.y - 3); c.stroke();
    }
    c.restore();
  }

  function drawBalls(c) {
    for (const b of balls) {
      if (b.dead) continue;
      if (!b.stuck) b.trail.draw(c, FX.pierce > 0 ? PALETTE.magenta : PALETTE.cyan, b.r * 1.5, .55);
      const col = FX.pierce > 0 ? PALETTE.magenta : PALETTE.white;
      c.save();
      const gr = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 2.6);
      gr.addColorStop(0, FX.pierce > 0 ? 'rgba(255,46,136,.6)' : 'rgba(34,224,255,.55)');
      gr.addColorStop(1, 'rgba(34,224,255,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(b.x, b.y, b.r * 2.6, 0, TAU); c.fill();
      c.fillStyle = col;
      c.beginPath(); c.arc(b.x, b.y, b.r, 0, TAU); c.fill();
      c.restore();
    }
  }

  function drawHud(c) {
    // 顶部：连击倍率条 + 道具状态
    let px = F.x + 4;
    const py = F.y - 26;
    if (S.mult > 1) {
      text(c, 'x' + S.mult, px, py, { size: 16, color: S.mult >= 3 ? PALETTE.amber : PALETTE.lime, align: 'left', weight: 900, glow: 10 });
      px += 44;
    }
    for (let i = 0; i < POWERS.length; i++) {
      const v = FX[POWERS[i].id];
      if (v <= 0) continue;
      const w = 46;
      bar(c, px, py - 4, w, 5, clamp(v / 12, 0, 1), { bg: 'rgba(255,255,255,.08)', fill: POWERS[i].color, r: 2 });
      text(c, POWERS[i].label, px + w / 2, py + 8, { size: 9, color: POWERS[i].color });
      px += w + 8;
    }
    // 生命（右侧）
    for (let i = 0; i < 3; i++) {
      const x = F.x + F.w - 12 - i * 18, y = py + 2;
      c.fillStyle = i < S.lives ? PALETTE.red : 'rgba(125,141,179,.25)';
      c.beginPath(); c.arc(x, y, 5, 0, TAU); c.fill();
    }
    text(c, 'LV ' + S.level + '/8', F.x + F.w - 62, py + 2, { size: 11, color: PALETTE.dim, align: 'right' });
  }

  buildLevel(1);

  return {
    update, render,
    resize(w, h) { layout(w, h); },
    pause() { audio.duck(.5, 3000); },
    resume() { }
  };
}
