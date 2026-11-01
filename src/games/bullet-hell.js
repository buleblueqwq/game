// 弹幕 Boss 战 —— 擦弹系统 / 三阶段 Boss / 四种弹幕模式 / 对象池 800+ 弹 / Bomb
import { clamp, lerp, TAU, circleHit, angleTo, dist2 } from '../core/math.js';
import { PALETTE, glowCircle, text, bar, grid as drawGrid, vignette, makeStarfield, offscreen } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'bullet-hell', title: '弹幕 Boss 战', category: 'action', difficulty: 4,
  music: 'battle',
  howto: ['WASD / 方向键移动，自动射击', '按住 Shift 低速移动并显示判定点', '贴近子弹触发擦弹：加分 + 充能', '能量满时按 X 释放 Bomb 清屏'],
  particles: 1600
};
export const musicTrack = 'battle';

// ---- 手感常量 ----
const HIT_R = 4.6;          // 判定点半径
const GRAZE_R = 18;         // 擦弹判定半径
const INVULN = 1.5;         // 受击无敌时间
const SHOT_CD = 0.072;      // 射击间隔
const MAIN_DMG = 6, SIDE_DMG = 4;
const BOSS_MAX = 3000;
const PATTERN_TIME = 8.5;   // 每种弹幕持续 ~8.5s，三种轮换 ≈ 25s 一轮
const PHASE_TIME = PATTERN_TIME;

const B_COLORS = {
  ring: PALETTE.magenta, spiral: PALETTE.cyan, aimed: PALETTE.amber, laser: PALETTE.red, hard: PALETTE.violet
};

export function create(ctx) {
  const { input, audio, particles, shake, flash, rng } = ctx;
  const reduced = !!ctx.settings.reducedFx;

  let W = ctx.W, H = ctx.H, CX = W / 2;
  const P = { x: CX, y: H * .8, tx: CX, ty: H * .8, focus: false, invuln: 0, cd: 0, lives: 3, dead: false };
  const S = {
    t: 0, score: 0, graze: 0, combo: 0, maxCombo: 0, energy: 0, bombs: 0,
    over: false, endTimer: 0, win: false, lastGrazeSfx: 0, hits: 0
  };
  const B = {
    x: CX, y: H * .22, hp: BOSS_MAX, maxHp: BOSS_MAX, phase: 1, r: 26,
    pattern: 0, pt: 0, ft: 0, ft2: 0, ft3: 0, rot: 0, flash: 0, invuln: 0,
    entering: 2.2, dead: false, burst: 0
  };
  const PATTERNS_BY_PHASE = [
    ['ring', 'spiral', 'aimed'],
    ['spiral', 'aimed', 'ring'],
    ['aimed', 'ring', 'spiral', 'laser']
  ];

  ctx.hud('score', '分数', 0);
  ctx.hud('graze', '擦弹', 0, { color: PALETTE.cyan });
  ctx.hud('lives', '残机', 3, { color: PALETTE.lime });

  // ---------------------------------------------------------------- 对象池
  // 优先使用容器提供的 ctx.pool；若运行时提供的池接口不完整（不同版本容器），退化为等价的本地实现
  function makePool(factory, reset, initial, max) {
    const p = ctx.pool(factory, reset, initial, max);
    if (p && typeof p.spawn === 'function' && typeof p.each === 'function') return p;
    const free = [], active = [];
    for (let i = 0; i < initial; i++) free.push(factory());
    return {
      get count() { return active.length; },
      spawn() {
        const o = free.pop() || factory();
        reset(o); o.dead = false; active.push(o);
        return o;
      },
      each(fn) { for (let i = 0; i < active.length; i++) fn(active[i], i); },
      sweep() {
        let w = 0;
        for (let i = 0; i < active.length; i++) {
          const o = active[i];
          if (o.dead) { if (free.length < max) free.push(o); } else active[w++] = o;
        }
        active.length = w;
      },
      clear() { for (const o of active) { o.dead = true; free.push(o); } active.length = 0; }
    };
  }
  const bullets = makePool(
    () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 5, life: 0, kind: 0, grazed: false, color: PALETTE.magenta, spin: 0, acc: 0, dead: false, hp: 1 }),
    (o) => { o.grazed = false; o.life = 0; o.spin = 0; o.acc = 0; o.hp = 1; o.dead = false; },
    420, 1400
  );
  const pshots = makePool(
    () => ({ x: 0, y: 0, vx: 0, vy: 0, dmg: MAIN_DMG, life: 0, r: 3, dead: false }),
    (o) => { o.life = 0; o.dead = false; }, 64, 260
  );
  const lasers = makePool(
    () => ({ x: 0, y: 0, a: 0, t: 0, warn: .8, sweep: 0, len: 0, w: 12, dir: 1, state: 0, dead: false }),
    (o) => { o.t = 0; o.state = 0; o.dead = false; }, 4, 8
  );

  // ---------------------------------------------------------------- 图形缓存
  const spriteCache = new Map();
  function sprite(color, plain) {
    const key = color + (plain ? '|p' : '|g');
    let s = spriteCache.get(key);
    if (s) return s;
    const S0 = 26;
    const o = offscreen(S0, S0, 1);
    const c = o.ctx;
    const r0 = S0 / 2;
    if (!plain) {
      const g = c.createRadialGradient(r0, r0, 0, r0, r0, r0);
      const [r, gg, b] = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
      g.addColorStop(0, `rgba(${r},${gg},${b},.85)`);
      g.addColorStop(.32, `rgba(${r},${gg},${b},.35)`);
      g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      c.fillStyle = g; c.fillRect(0, 0, S0, S0);
    }
    c.fillStyle = color;
    c.beginPath(); c.arc(r0, r0, S0 * .17, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,.92)';
    c.beginPath(); c.arc(r0, r0, S0 * .085, 0, TAU); c.fill();
    spriteCache.set(key, o.canvas);
    return o.canvas;
  }

  // 背景星空（resize 时重建）
  let stars = null;
  function buildBg() { stars = makeStarfield(W, H, Math.round(W * H / 5200), () => rng()); }
  buildBg();

  function layout(w, h) {
    W = w; H = h; CX = W / 2;
    buildBg();
    P.x = clamp(P.x, 10, W - 10); P.y = clamp(P.y, 20, H - 20);
  }
  layout(W, H);

  // ---------------------------------------------------------------- 弹幕工厂
  function spawnBullet(x, y, ang, spd, opt) {
    const b = bullets.spawn();
    b.x = x; b.y = y;
    b.vx = Math.cos(ang) * spd; b.vy = Math.sin(ang) * spd;
    b.r = opt?.r ?? 5.5;
    b.color = opt?.color ?? B_COLORS.ring;
    b.life = opt?.life ?? 9;
    b.kind = opt?.kind ?? 0;
    b.acc = opt?.acc ?? 0;
    b.spin = opt?.spin ?? 0;
    return b;
  }

  function fireRing(n, spd, off, r, color) {
    for (let i = 0; i < n; i++) spawnBullet(B.x, B.y, off + i * TAU / n, spd, { r, color });
  }
  function fireSpiral(arms, spd, base, r, color) {
    for (let i = 0; i < arms; i++) spawnBullet(B.x, B.y, base + i * TAU / arms, spd, { r, color });
  }
  function fireAimed(spd, spread, n, r, color) {
    const base = angleTo(B.x, B.y, P.x, P.y);
    if (n === 1) spawnBullet(B.x, B.y, base + spread, spd, { r: r + 1, color });
    else for (let i = 0; i < n; i++) spawnBullet(B.x, B.y, base + spread + (i / (n - 1) - .5) * .55, spd * (.9 + i * .03), { r, color });
  }

  function fireLaser() {
    const l = lasers.spawn();
    l.x = B.x; l.y = B.y;
    l.a = angleTo(B.x, B.y, P.x, P.y) + rng.range(-.12, .12);
    l.t = 0; l.state = 0; l.warn = .8; l.sweep = 1.15; l.w = 13; l.len = Math.hypot(W, H);
    l.dir = rng.sign();
    audio.sfx('charge', { dur: .7, gain: .6 });
  }

  // ---------------------------------------------------------------- Boss 逻辑
  function updateBoss(dt) {
    if (B.entering > 0) {
      B.entering -= dt;
      B.y = lerp(-60, H * .2, 1 - B.entering / 2.2);
      return;
    }
    if (B.dead) {
      B.burst += dt;
      if (B.burst < 2.4 && rng.chance(.5)) {
        const a = rng() * TAU, d = rng.range(0, 46);
        particles.explosion(B.x + Math.cos(a) * d, B.y + Math.sin(a) * d, .7, rng.pick([PALETTE.amber, PALETTE.red, PALETTE.magenta]));
        shake.add(.25);
      }
      if (B.burst > 2.6 && !S.over) {
        S.over = true; S.win = true;
        audio.stopMusic(1.2); audio.sfx('win');
        ctx.finish(S.score, {
          win: true,
          stats: [['擦弹', S.graze], ['最大连击', S.maxCombo], ['剩余残机', P.lives], ['用时', S.t.toFixed(1) + 's']]
        });
      }
      return;
    }
    B.x = CX + Math.sin(S.t * .62) * W * .27 + Math.sin(S.t * 1.7) * 12;
    B.y = H * .2 + Math.sin(S.t * .9) * H * .035;
    B.rot += dt * .6;
    if (B.flash > 0) B.flash -= dt * 4;
    if (B.invuln > 0) B.invuln -= dt;

    // 阶段推进
    const frac = B.hp / B.maxHp;
    const want = frac > .66 ? 1 : frac > .33 ? 2 : 3;
    if (want > B.phase) enterPhase(want);

    // 弹幕轮换
    const list = PATTERNS_BY_PHASE[B.phase - 1];
    B.pt += dt;
    if (B.pt >= PHASE_TIME) { B.pt = 0; B.pattern = (B.pattern + 1) % list.length; audio.sfx('swap', { gain: .5 }); }
    const pat = list[B.pattern];
    firePattern(pat, dt);
  }

  function enterPhase(n) {
    B.phase = n;
    B.invuln = 1.1;
    B.pattern = 0; B.pt = 0;
    clearBullets(true);
    audio.sfx('powerup'); audio.duck(.4, 800);
    flash.add(.45, PALETTE.magenta);
    shake.add(.7); ctx.vibrate(PATTERNS.combo);
    particles.ring(B.x, B.y, PALETTE.magenta, 220);
    particles.ring(B.x, B.y, PALETTE.white, 150);
    particles.burst(B.x, B.y, 40, { color: PALETTE.magenta, speed: 420, life: .9, size: 4, kind: 1 });
    ctx.hint(n === 3 ? '阶段 3： Boss 开始使用扫射激光！' : '阶段 ' + n + '：弹幕密度提升');
  }

  function firePattern(pat, dt) {
    const ph = B.phase;
    B.ft += dt; B.ft2 += dt; B.ft3 += dt;
    if (pat === 'ring') {
      const iv = Math.max(.26, .60 - ph * .09);
      if (B.ft >= iv) {
        B.ft = 0;
        B.rot += .21 + ph * .04;
        const n = 16 + ph * 8;
        fireRing(n, 108 + ph * 20, B.rot, 5.4, B_COLORS.ring);
        if (ph >= 2) fireRing(n, 62 + ph * 10, -B.rot * 1.4 + .1, 4.4, B_COLORS.hard);
        audio.sfx('shoot', { gain: .35 });
      }
    } else if (pat === 'spiral') {
      const iv = Math.max(.035, .075 - ph * .012);
      if (B.ft >= iv) {
        B.ft = 0;
        const arms = 2 + ph;
        B.rot += .30 + ph * .03;
        fireSpiral(arms, 132 + ph * 16, B.rot, 5, B_COLORS.spiral);
        if (ph >= 3) fireSpiral(arms, 96, -B.rot * 1.6, 4.2, B_COLORS.hard);
      }
      if (B.ft2 > 1.6) { B.ft2 = 0; fireRing(10, 150, rng() * TAU, 6.6, B_COLORS.hard); }
    } else if (pat === 'aimed') {
      const iv = Math.max(.42, .95 - ph * .13);
      if (B.ft >= iv) {
        B.ft = 0;
        if (!B.aimFlip) { fireAimed(190 + ph * 22, 0, 3, 5.2, B_COLORS.aimed); audio.sfx('laser', { gain: .5 }); }
        else { fireAimed(126 + ph * 16, 0, 7 + ph * 2, 4.6, B_COLORS.aimed); audio.sfx('shoot', { gain: .4 }); }
        B.aimFlip = !B.aimFlip;
      }
      if (B.ft2 > .5) { B.ft2 = 0; fireRing(6, 92, S.t * 1.3, 4.4, B_COLORS.hard); }
    } else if (pat === 'laser') {
      if (B.ft >= 2.5) { B.ft = 0; fireLaser(); }
      const iv = Math.max(.5, 1.1 - ph * .1);
      if (B.ft2 >= iv) { B.ft2 = 0; fireRing(14, 118, S.t * .8, 5, B_COLORS.ring); }
    }
  }

  // ---------------------------------------------------------------- 玩家
  function updatePlayer(dt) {
    if (P.invuln > 0) P.invuln -= dt;
    // 移动（直接读动作态，避免每帧新建 axis 对象）
    let ax = 0, ay = 0;
    if (input.isDown('left')) ax -= 1;
    if (input.isDown('right')) ax += 1;
    if (input.isDown('up')) ay -= 1;
    if (input.isDown('down')) ay += 1;
    P.focus = input.rawDown('ShiftLeft') || input.rawDown('ShiftRight') || touchFocus;
    const base = Math.min(W, H);
    const sp = base * (P.focus ? .30 : .62);
    let dx = ax * sp * dt, dy = ay * sp * dt;
    if (touchDrag.active) { dx += touchDrag.dx; dy += touchDrag.dy; touchDrag.dx = 0; touchDrag.dy = 0; }
    if (dx && dy) { const k = Math.SQRT1_2; dx *= k; dy *= k; }
    P.x = clamp(P.x + dx, 12, W - 12);
    P.y = clamp(P.y + dy, 18, H - 18);

    // 射击（自动）
    P.cd -= dt;
    if (P.cd <= 0) {
      P.cd = SHOT_CD;
      const y = P.y - 14;
      shot(P.x - 6, y, -Math.PI / 2, 980, MAIN_DMG, 3.4);
      shot(P.x + 6, y, -Math.PI / 2, 980, MAIN_DMG, 3.4);
      if (P.focus) {
        shot(P.x - 12, y + 4, -Math.PI / 2 - .16, 900, SIDE_DMG, 2.6);
        shot(P.x + 12, y + 4, -Math.PI / 2 + .16, 900, SIDE_DMG, 2.6);
      } else {
        shot(P.x - 10, y + 2, -Math.PI / 2 - .10, 940, SIDE_DMG, 2.6);
        shot(P.x + 10, y + 2, -Math.PI / 2 + .10, 940, SIDE_DMG, 2.6);
      }
    }
    // 拖尾
    if (rng.chance(.5)) particles.trail(P.x, P.y + 8, P.focus ? PALETTE.lime : PALETTE.cyan, P.focus ? 3.4 : 2.2);
  }

  function shot(x, y, ang, spd, dmg, r) {
    const s = pshots.spawn();
    s.x = x; s.y = y; s.vx = Math.cos(ang) * spd; s.vy = Math.sin(ang) * spd;
    s.dmg = dmg; s.r = r; s.life = 1.4;
    return s;
  }

  // ---------------------------------------------------------------- 战斗判定
  function collide(dt) {
    const pcx = P.x, pcy = P.y;
    bullets.each((b) => {
      const rr = (b.r + GRAZE_R);
      const d2 = dist2(b.x, b.y, pcx, pcy);
      if (d2 > rr * rr) return;
      const hitR = b.r + HIT_R;
      if (d2 < hitR * hitR) {
        if (P.invuln <= 0) { b.dead = true; playerHit(); }
        return;
      }
      if (!b.grazed) {
        b.grazed = true;
        S.graze++; S.combo++;
        if (S.combo > S.maxCombo) S.maxCombo = S.combo;
        S.energy = Math.min(100, S.energy + 1.7);
        const gain = Math.round(10 * (1 + Math.min(S.combo, 40) / 20));
        S.score += gain;
        // 擦弹反馈（节流，避免音/震过载）
        const a = Math.atan2(b.y - pcy, b.x - pcx);
        particles.emit({ x: b.x, y: b.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: .3, size: 2.4, color: PALETTE.lime, kind: 1, drag: 3 });
        particles.emit({ x: b.x, y: b.y, vx: 0, vy: 0, life: .28, size: 6, color: PALETTE.cyan, kind: 3, drag: 0 });
        if (S.t - S.lastGrazeSfx > .09) {
          S.lastGrazeSfx = S.t;
          audio.sfx('reflect', { gain: .35 });
          shake.add(.05);
          particles.text(pcx, pcy - 26, 'GRAZE +' + gain, '#8dff4d');
        }
      }
    });

    // 玩家子弹 vs Boss
    if (!B.dead && B.invuln <= 0 && B.entering <= 0) {
      pshots.each((s) => {
        if (s.dead) return;
        if (circleHit(s.x, s.y, s.r, B.x, B.y, B.r)) {
          s.dead = true;
          damageBoss(s.dmg);
          const a = Math.atan2(s.vy, s.vx) + Math.PI;
          particles.emit({ x: s.x, y: s.y, vx: Math.cos(a) * 130, vy: Math.sin(a) * 130, life: .25, size: 2.2, color: PALETTE.amber, kind: 1, drag: 3 });
        }
      });
    }

    // 激光判定
    lasers.each((l) => {
      if (l.state !== 1) return;
      const dx = Math.cos(l.a), dy = Math.sin(l.a);
      const t = (pcx - l.x) * dx + (pcy - l.y) * dy;
      if (t < 0 || t > l.len) return;
      const px = l.x + dx * t, py = l.y + dy * t;
      if (dist2(px, py, pcx, pcy) < (l.w * .5 + HIT_R) * (l.w * .5 + HIT_R) && P.invuln <= 0) playerHit();
    });
  }

  function damageBoss(d) {
    B.hp -= d; B.flash = 1;
    S.score += d * 2;
    S.hits++;
    if (B.hp <= 0 && !B.dead) {
      B.hp = 0; B.dead = true; B.burst = 0;
      clearBullets(true);
      audio.sfx('explode'); audio.duck(.6, 1500);
      flash.add(.8, '#ffffff'); shake.add(1); ctx.vibrate(PATTERNS.explode);
      scoreBurst(B.x, B.y, 60);
    }
  }

  function scoreBurst(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, v = rng.range(60, 420);
      particles.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rng.range(.4, 1.1), size: rng.range(2, 5), color: rng.pick([PALETTE.amber, PALETTE.red, PALETTE.magenta, PALETTE.white]), kind: 1, drag: 1.4 });
    }
  }

  function clearBullets(big) {
    let n = 0;
    bullets.each((b) => {
      b.dead = true; n++;
      if (big ? n % 3 === 0 : true) particles.emit({ x: b.x, y: b.y, life: .3, size: b.r * 1.6, color: b.color, kind: 0, drag: 4 });
    });
    bullets.sweep();
    lasers.each((l) => { l.dead = true; });
    lasers.sweep();
  }

  function playerHit() {
    if (P.invuln > 0 || S.over) return;
    P.lives--; P.invuln = INVULN; S.combo = 0; S.energy = Math.max(0, S.energy - 20);
    audio.sfx('hurt'); audio.sfx('explode', { gain: .6 });
    audio.duck(.5, 900);
    ctx.vibrate(PATTERNS.damage); shake.add(.8); flash.add(.35, PALETTE.red);
    particles.explosion(P.x, P.y, 1.1, PALETTE.red);
    particles.ring(P.x, P.y, PALETTE.red, 90);
    // 清屏小爆：清除身边 130px 内的弹
    bullets.each((b) => {
      if (dist2(b.x, b.y, P.x, P.y) < 130 * 130) {
        b.dead = true;
        particles.emit({ x: b.x, y: b.y, life: .3, size: b.r * 1.4, color: b.color, kind: 0, drag: 4 });
      }
    });
    ctx.hud('lives', '残机', Math.max(0, P.lives), { color: P.lives <= 1 ? PALETTE.red : PALETTE.lime });
    if (P.lives <= 0) {
      P.dead = true; S.over = true; S.win = false; S.endTimer = 0;
      audio.stopMusic(1); audio.sfx('die');
      clearBullets(true);
      particles.explosion(P.x, P.y, 1.8, PALETTE.red);
      flash.add(.7, PALETTE.red);
    }
  }

  function bomb() {
    if (S.energy < 100 || S.over) return;
    S.energy = 0; S.bombs++;
    P.invuln = Math.max(P.invuln, 1.1);
    audio.sfx('explode'); audio.duck(.6, 1200);
    flash.add(.9, '#ffffff'); shake.add(1); ctx.vibrate(PATTERNS.explode);
    scoreBurst(P.x, P.y, 46);
    particles.ring(P.x, P.y, PALETTE.white, 260);
    particles.ring(P.x, P.y, PALETTE.cyan, 180);
    clearBullets(true);
    if (!B.dead && B.invuln <= 0) damageBoss(400);
    S.score += 300;
  }

  // ---------------------------------------------------------------- 更新
  function update(dt) {
    S.t += dt;
    if (S.over) {
      S.endTimer += dt;
      stepWorld(dt);
      if (S.endTimer > 1.3 && !S.finished && !S.win) {
        S.finished = true;
        ctx.finish(S.score, {
          win: false,
          stats: [['擦弹', S.graze], ['最大连击', S.maxCombo], ['Bomb', S.bombs], ['用时', S.t.toFixed(1) + 's']]
        });
      }
      return;
    }
    updatePlayer(dt);
    if (input.consume('secondary', 120) || touchBomb) { touchBomb = false; bomb(); }
    updateBoss(dt);
    stepWorld(dt);
    collide(dt);

    ctx.hud('score', '分数', Math.round(S.score));
    ctx.hud('graze', '擦弹', S.graze, { color: PALETTE.cyan });
    if (S.combo > 0) ctx.hud('combo', '连击', S.combo, { color: S.combo > 20 ? PALETTE.amber : null });
  }

  function stepWorld(dt) {
    // Boss 弹
    bullets.each((b) => {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.spin) {
        const cs = Math.cos(b.spin * dt), sn = Math.sin(b.spin * dt);
        const nx = b.vx * cs - b.vy * sn, ny = b.vx * sn + b.vy * cs;
        b.vx = nx; b.vy = ny;
      }
      if (b.acc) {
        const sp = Math.hypot(b.vx, b.vy) || 1;
        b.vx += (b.vx / sp) * b.acc * dt; b.vy += (b.vy / sp) * b.acc * dt;
      }
      b.life -= dt;
      if (b.life <= 0 || b.x < -40 || b.x > W + 40 || b.y < -60 || b.y > H + 50) b.dead = true;
    });
    bullets.sweep();
    // 玩家弹
    pshots.each((s) => {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0 || s.y < -20 || s.x < -20 || s.x > W + 20) s.dead = true;
    });
    pshots.sweep();
    // 激光
    lasers.each((l) => {
      l.t += dt;
      if (l.state === 0) {
        if (l.t >= l.warn) { l.state = 1; l.t = 0; l.x = B.x; l.y = B.y; audio.sfx('laser', { gain: .8 }); shake.add(.3); }
      } else {
        l.a += l.dir * .55 * dt;
        if (rng.chance(.8)) {
          const px = l.x + Math.cos(l.a) * (l.len * rng()), py = l.y + Math.sin(l.a) * (l.len * rng());
          particles.emit({ x: px, y: py, life: .25, size: 3, color: PALETTE.red, kind: 0, drag: 4 });
        }
        if (l.t >= l.sweep) l.dead = true;
      }
    });
    lasers.sweep();
  }

  // ---------------------------------------------------------------- 触摸
  const touchDrag = { active: false, x: 0, y: 0, dx: 0, dy: 0 };
  let touchFocus = false, touchBomb = false;
  ctx.listen(ctx.canvas, 'pointerdown', (e) => {
    touchDrag.active = true; touchDrag.x = e.clientX; touchDrag.y = e.clientY;
  });
  ctx.listen(ctx.canvas, 'pointermove', (e) => {
    if (!touchDrag.active) return;
    touchDrag.dx += e.clientX - touchDrag.x;
    touchDrag.dy += e.clientY - touchDrag.y;
    touchDrag.x = e.clientX; touchDrag.y = e.clientY;
  });
  const endDrag = () => { touchDrag.active = false; };
  ctx.listen(ctx.canvas, 'pointerup', endDrag);
  ctx.listen(ctx.canvas, 'pointercancel', endDrag);

  if (ctx.caps.mobile) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:8px;width:100%;justify-content:center';
    const mk = (label, key, color) => {
      const b = document.createElement('button');
      b.className = 'btn'; b.textContent = label;
      b.style.cssText = `flex:0 0 34%;touch-action:none;user-select:none;border-color:${color}55;color:${color};font-weight:800;padding:12px 0`;
      ctx.listen(b, 'pointerdown', (e) => { e.preventDefault(); if (key === 'bomb') touchBomb = true; else touchFocus = true; b.style.background = color + '33'; });
      const up = (e) => { e.preventDefault(); if (key !== 'bomb') touchFocus = false; b.style.background = ''; };
      ctx.listen(b, 'pointerup', up);
      ctx.listen(b, 'pointercancel', up);
      ctx.listen(b, 'pointerleave', up);
      wrap.appendChild(b);
    };
    mk('低速', 'focus', PALETTE.cyan);
    mk('BOMB', 'bomb', PALETTE.magenta);
    ctx.overlay(wrap, 'overlay-bottom');
  }

  // ---------------------------------------------------------------- 渲染
  function render(alpha, rdt) {
    const c = ctx.ctx;
    c.fillStyle = '#05070f';
    c.fillRect(0, 0, W, H);
    c.save();
    shake.apply(c);

    // 背景
    if (stars) stars.draw(c, S.t, 0, S.t * 40, .9);
    drawGrid(c, W, H, 64, 'rgba(60,90,150,.07)', 1, 0, (S.t * 26) % 64);
    const bg = c.createRadialGradient(B.x, B.y, 10, B.x, B.y, Math.max(W, H) * .6);
    bg.addColorStop(0, 'rgba(255,46,136,.10)');
    bg.addColorStop(1, 'rgba(255,46,136,0)');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);

    drawLasers(c);
    drawBoss(c);
    drawBullets(c);
    drawShots(c);
    if (!P.dead) drawPlayer(c);

    particles.renderTexts(c, rdt);
    c.restore();

    drawHud(c);
    vignette(c, W, H, .45);

    if (P.lives <= 0) {
      text(c, 'GAME OVER', W / 2, H / 2, { size: Math.min(46, W * .1), color: PALETTE.red, weight: 900, glow: 22 });
    }
  }

  function drawBullets(c) {
    const n = bullets.count;
    if (!n) return;
    const plain = reduced;
    let drawn = 0;
    const maxDraw = reduced ? 420 : 1400;
    bullets.each((b) => {
      if (drawn++ > maxDraw) return;
      const s = sprite(b.color, plain);
      const d = b.r * (plain ? 2.6 : 4.2);
      c.drawImage(s, b.x - d / 2, b.y - d / 2, d, d);
    });
  }

  function drawShots(c) {
    c.save();
    pshots.each((s) => {
      c.fillStyle = PALETTE.lime;
      c.fillRect(s.x - s.r * .5, s.y - s.r * 2.2, s.r, s.r * 4.4);
    });
    c.restore();
  }

  function drawLasers(c) {
    lasers.each((l) => {
      const dx = Math.cos(l.a), dy = Math.sin(l.a);
      if (l.state === 0) {
        const k = l.t / l.warn;
        c.save();
        c.globalAlpha = .25 + Math.sin(l.t * 40) * .2;
        c.strokeStyle = PALETTE.red; c.lineWidth = 1 + k * 2;
        c.setLineDash([10, 8]);
        c.beginPath(); c.moveTo(l.x, l.y); c.lineTo(l.x + dx * l.len, l.y + dy * l.len); c.stroke();
        c.restore();
      } else {
        const k = clamp(1 - l.t / l.sweep, 0, 1);
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = 'rgba(255,77,94,.28)'; c.lineWidth = l.w * (1.9 + Math.sin(S.t * 30) * .2);
        c.beginPath(); c.moveTo(l.x, l.y); c.lineTo(l.x + dx * l.len, l.y + dy * l.len); c.stroke();
        c.strokeStyle = PALETTE.red; c.lineWidth = l.w * (.6 + k * .3);
        c.beginPath(); c.moveTo(l.x, l.y); c.lineTo(l.x + dx * l.len, l.y + dy * l.len); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = Math.max(1, l.w * .22);
        c.beginPath(); c.moveTo(l.x, l.y); c.lineTo(l.x + dx * l.len, l.y + dy * l.len); c.stroke();
        c.restore();
      }
    });
  }

  function drawBoss(c) {
    if (B.entering > 0.2 && B.dead) return;
    if (B.dead && B.burst > 1.2) return;
    const bob = Math.sin(S.t * 2) * 4;
    const x = B.x, y = B.y + bob;
    c.save();
    c.translate(x, y);
    const pulse = 1 + Math.sin(S.t * 4) * .04;
    // 外圈能量环（旋转）
    c.save();
    c.rotate(B.rot);
    c.strokeStyle = 'rgba(255,46,136,.45)'; c.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a0 = i * TAU / 3;
      c.beginPath(); c.arc(0, 0, B.r * (1.5 + Math.sin(S.t + i) * .06), a0, a0 + 1.1); c.stroke();
    }
    c.restore();
    // 核心
    const gr = c.createRadialGradient(0, 0, 2, 0, 0, B.r * 2.4 * pulse);
    gr.addColorStop(0, B.flash > 0 ? 'rgba(255,255,255,.85)' : 'rgba(255,46,136,.55)');
    gr.addColorStop(1, 'rgba(255,46,136,0)');
    c.fillStyle = gr; c.beginPath(); c.arc(0, 0, B.r * 2.4 * pulse, 0, TAU); c.fill();
    c.fillStyle = '#160b18';
    c.beginPath(); c.arc(0, 0, B.r * pulse, 0, TAU); c.fill();
    c.strokeStyle = B.phase === 3 ? PALETTE.red : PALETTE.magenta; c.lineWidth = 3;
    c.beginPath(); c.arc(0, 0, B.r * pulse, 0, TAU); c.stroke();
    // 内部六芒
    c.rotate(-B.rot * 1.6);
    c.strokeStyle = PALETTE.cyan; c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6, r2 = i % 2 ? B.r * .35 : B.r * .72;
      const px = Math.cos(a) * r2, py = Math.sin(a) * r2;
      i ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    c.closePath(); c.stroke();
    c.restore();
  }

  function drawPlayer(c) {
    const blink = P.invuln > 0 && Math.floor(P.invuln * 14) % 2 === 0;
    const x = P.x, y = P.y;
    c.save();
    if (!blink) {
      // 引擎焰
      const f = 6 + Math.sin(S.t * 30) * 2;
      c.fillStyle = 'rgba(34,224,255,.75)';
      c.beginPath(); c.moveTo(x - 4, y + 10); c.lineTo(x, y + 10 + f); c.lineTo(x + 4, y + 10); c.closePath(); c.fill();
      // 机体（发光三角）
      c.beginPath();
      c.moveTo(x, y - 15); c.lineTo(x + 11, y + 9); c.lineTo(x, y + 4); c.lineTo(x - 11, y + 9);
      c.closePath();
      c.fillStyle = 'rgba(10,20,36,.9)'; c.fill();
      c.strokeStyle = PALETTE.cyan; c.lineWidth = 2.2; c.stroke();
      c.fillStyle = PALETTE.white;
      c.beginPath(); c.arc(x, y - 5, 2.2, 0, TAU); c.fill();
    }
    // 判定点
    if (P.focus || !reduced) {
      const a = P.focus ? .95 : .35;
      glowCircle(c, x, y, P.focus ? 6.5 : 5, P.focus ? PALETTE.lime : 'rgba(255,255,255,.6)', { glow: P.focus ? 12 : 6, alpha: a, width: 1.6 });
      if (P.focus) {
        c.save();
        c.globalAlpha = .5;
        c.strokeStyle = PALETTE.lime; c.lineWidth = 1;
        c.setLineDash([4, 6]);
        c.beginPath(); c.arc(x, y, GRAZE_R, S.t * 2, S.t * 2 + TAU); c.stroke();
        c.restore();
      }
    }
    c.restore();
  }

  function drawHud(c) {
    // Boss 血条（顶部）
    const bw = Math.min(W - 40, 620), bx = (W - bw) / 2, by = 16;
    const frac = clamp(B.hp / B.maxHp, 0, 1);
    text(c, 'BOSS · PHASE ' + B.phase, W / 2, by - 4, { size: 11, color: PALETTE.magenta, baseline: 'bottom' });
    bar(c, bx, by, bw, 9, frac, { bg: 'rgba(255,255,255,.08)', fill: B.phase === 3 ? PALETTE.red : PALETTE.magenta, r: 4, glowColor: PALETTE.magenta });
    c.save();
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1;
    for (const p of [.33, .66]) { c.beginPath(); c.moveTo(bx + bw * p, by); c.lineTo(bx + bw * p, by + 9); c.stroke(); }
    c.restore();

    // 能量 / 残机（底部）
    const ew = Math.min(W - 40, 320), ex = (W - ew) / 2, ey = H - 22;
    bar(c, ex, ey, ew, 8, S.energy / 100, {
      bg: 'rgba(255,255,255,.08)',
      fill: S.energy >= 100 ? PALETTE.amber : PALETTE.cyan,
      r: 4, glowColor: S.energy >= 100 ? PALETTE.amber : null
    });
    text(c, S.energy >= 100 ? 'BOMB READY — 按 X' : 'ENERGY ' + Math.floor(S.energy) + '%',
      W / 2, ey - 6, { size: 10, color: S.energy >= 100 ? PALETTE.amber : PALETTE.dim, baseline: 'bottom' });

    // 残机图标
    for (let i = 0; i < P.lives; i++) {
      const ix = 22 + i * 18, iy = H - 26;
      c.save();
      c.fillStyle = PALETTE.lime;
      c.beginPath(); c.moveTo(ix, iy - 7); c.lineTo(ix + 7, iy + 6); c.lineTo(ix - 7, iy + 6); c.closePath(); c.fill();
      c.restore();
    }
    // 弹数监控
    text(c, bullets.count + ' bullets', W - 12, H - 14, { size: 9, color: PALETTE.dim, align: 'right' });
  }

  return {
    update, render,
    resize(w, h) { layout(w, h); },
    pause() { audio.duck(.5, 3000); },
    resume() { }
  };
}
