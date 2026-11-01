// 惯性平台跳跃 —— 自研 AABB 瓦片物理（分轴解算）、手感三件套、二段跳/冲刺、机关地形、检查点重生
import { clamp, lerp, TAU, fmtTime } from '../core/math.js';
import { PALETTE, glowCircle, glowRect, roundRect, text, bar, grid as drawGrid, vignette } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'platformer', title: '惯性平台跳跃', category: 'action', difficulty: 4,
  music: 'arcade',
  howto: ['← → / A D 移动，空格跳跃（可二段跳）', 'Shift / C 冲刺：可撞碎砖块并短暂无敌', '踩弹簧弹射更高，收集能量核心抵达终点旗'],
  particles: 1100
};
export const musicTrack = 'arcade';

// ---------------------------------------------------------------- 关卡数据
// 图例：# 实墙 | = 单向平台 | ^ 尖刺 | B 可破坏砖 | S 弹簧 | C 能量核心 | K 检查点 | F 终点旗 | P 出生点
const MW = 92, MH = 18;
const RAW = [
  "                                 ########",
  "                                 ########",
  "                                   ^^^^",
  "",
  "",
  "",
  "",
  "",
  "   C               C               C                              C                  C",
  "  ###                             ====                          ====                ===",
  "",
  "      C   C            C     C                         C         C          #####",
  "     === ===          ===   ###             C    B     ==       BBB           C",
  "              ==                           ===   B C                     ==   BB",
  "  P                SS   ^^     K    S ^^         B   ^^  S    K    S^^      #####^^SK  F",
  "############     ##########    ##########      ###########    ##########    ################",
  "############     ##########    ##########      ###########    ##########    ################",
  "############     ##########    ##########      ###########    ##########    ################"
];
const MAP = RAW.map(r => r.padEnd(MW, ' '));

// 移动平台（瓦片坐标：起点 -> 终点，宽高以瓦片计）
const MOVERS = [
  { x: 27, y: 13, x2: 34, y2: 13, w: 3, h: .6, spd: 3.0, ph: 0 },
  { x: 41, y: 13, x2: 47, y2: 13, w: 2.4, h: .6, spd: 2.6, ph: .35 },
  { x: 44, y: 11, x2: 44, y2: 6, w: 2.2, h: .6, spd: 2.3, ph: .5 },
  { x: 57, y: 12, x2: 63, y2: 12, w: 3, h: .6, spd: 3.2, ph: .2 }
];

// 运动常量（单位：瓦片 / 秒 —— 与分辨率完全解耦）
const GRAV = 62, MAXFALL = 30, RUN = 8.2, ACC = 48, AIRACC = 34, FRIC = 42;
const AIR_DRAG = 5.5, JUMP_V = 20.5, JUMP2_V = 18.5, DASH_V = 22;
const COYOTE = 0.11, JBUF = 0.13, DASH_TIME = 0.16, DASH_CD = 0.62;
const PW = 0.62, PH = 0.88;

export function create(ctx) {
  const { input, audio, particles, shake, flash, camera, rng } = ctx;
  // 世界坐标用瓦片单位，渲染时才乘以 U（瓦片像素边长），因此 resize 无需重建任何实体
  let U = 32;

  // ---- 瓦片状态 ----
  const tile = new Uint8Array(MW * MH);   // 1=实心 2=单向 3=尖刺 4=砖块 5=弹簧
  const brickHp = new Uint8Array(MW * MH);
  const char = (tx, ty) => (tx < 0 || tx >= MW) ? '#' : MAP[ty][tx];
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const c = MAP[y][x], i = y * MW + x;
      if (c === '#') tile[i] = 1;
      else if (c === '=') tile[i] = 2;
      else if (c === '^') tile[i] = 3;
      else if (c === 'B') { tile[i] = 4; brickHp[i] = 2; }
      else if (c === 'S') tile[i] = 5;
    }
  }
  const isSolid = (tx, ty) => (ty >= MH || tx < 0 || tx >= MW) ? (ty >= MH ? false : true) : (tile[ty * MW + tx] === 1 || tile[ty * MW + tx] === 4);

  // ---- 实体（瓦片坐标，全部一次性预分配）----
  const cores = [];
  const flags = [];
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const c = MAP[y][x];
    if (c === 'C') cores.push({ tx: x + .5, ty: y + .5, taken: false, bob: rng() * TAU });
    else if (c === 'K') flags.push({ type: 'cp', tx: x + .5, ty: y + .5, on: false });
    else if (c === 'F') flags.push({ type: 'end', tx: x + .5, ty: y + .5, on: false });
  }
  const movers = MOVERS.map(m => ({ ...m, x0: m.x, y0: m.y, cx: m.x, cy: m.y, dx: 0, dy: 0, t: m.ph }));
  // 冲刺残影
  const GHOST_N = 14;
  const ghosts = [];
  for (let i = 0; i < GHOST_N; i++) ghosts.push({ x: 0, y: 0, life: 0, gi: 0 });
  // 背景视差装饰
  const deco = [];
  for (let i = 0; i < 46; i++) deco.push({ x: rng() * MW, y: rng() * MH, w: rng.range(.6, 2.6), h: rng.range(3, 11), z: rng.range(.25, .62) });

  const P = {
    x: 2.5, y: 13.8, px: 2.5, py: 13.8, vx: 0, vy: 0,
    onGround: false, face: 1, jumps: 1, coyote: 0, jbuf: 0,
    dash: 0, dashCd: 0, dashDir: 1, invuln: 0, dead: false, ride: -1
  };
  const S = {
    t: 0, time: 0, deaths: 0, got: 0, done: false, endTimer: 0,
    spawnTx: 2.5, spawnTy: 13.8, best: ctx.save.get('best', 0), totalCores: cores.length,
    dashAvail: true, jumpHeld: false, respawn: 0
  };

  ctx.skipParticles = true;          // 世界坐标系：粒子由本模块在相机变换内绘制，避免壳层重复绘制

  ctx.hud('time', '时间', '0.0s');
  ctx.hud('cores', '核心', '0/' + S.totalCores, { color: PALETTE.lime });
  ctx.hud('deaths', '死亡', 0, { color: PALETTE.red });

  // ---------------------------------------------------------------- 布局
  function layout(w, h) {
    U = Math.max(14, Math.ceil(h / 17));
    camera.w = w; camera.h = h;
  }
  layout(ctx.W, ctx.H);

  // ---------------------------------------------------------------- 地形查询
  function tileRange(x, y, w2, h2) {
    _tr.x0 = Math.floor(x); _tr.x1 = Math.floor(x + w2);
    _tr.y0 = Math.floor(y); _tr.y1 = Math.floor(y + h2);
    return _tr;
  }
  const _tr = { x0: 0, x1: 0, y0: 0, y1: 0 };

  function solidRect(x, y, w2, h2) {  // AABB vs 瓦片（实心 + 未破砖）
    const r = tileRange(x, y, w2, h2);
    for (let ty = r.y0; ty <= r.y1; ty++) {
      if (ty < 0) continue;
      for (let tx = r.x0; tx <= r.x1; tx++) if (isSolid(tx, ty)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 玩家物理
  function moveX(dt) {
    const d = P.vx * dt;
    P.x += d;
    if (solidRect(P.x - PW / 2, P.y - PH, PW, PH)) {
      // 二分回退到贴合位置（分轴解算，先 X）
      let lo = 0, hi = d;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (solidRect(P.x - PW / 2 - d + mid, P.y - PH, PW, PH)) hi = mid; else lo = mid;
      }
      P.x = P.x - d + lo;
      if (Math.abs(P.vx) > 6 && S.dash <= 0) {
        dust(P.x - Math.sign(P.vx) * PW / 2, P.y - PH * .4, 4);
        audio.sfx('hit', { gain: .5 });
      }
      P.vx = 0;
      if (S.dash > 0) tryDashBreak();
    }
  }

  function moveY(dt) {
    P.py = P.y;
    const d = P.vy * dt;
    P.y += d;
    P.onGround = false;
    P.ride = -1;
    const down = d > 0;    if (solidRect(P.x - PW / 2, P.y - PH, PW, PH)) {
      let lo = 0, hi = d;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (solidRect(P.x - PW / 2, P.y - PH - d + mid, PW, PH)) hi = mid; else lo = mid;
      }
      P.y = P.y - d + lo;
      if (down) {
        P.onGround = true; P.jumps = 1; P.coyote = COYOTE; P.dashCd = Math.max(0, P.dashCd - dt);
        if (P.vy > 14) landDust(P.vy);
      }
      P.vy = 0;
      if (S.dash > 0) tryDashBreak();
    } else if (down) {
      // 单向平台：仅在下落且上一帧脚底高于平台面时才落上去
      const r = tileRange(P.x - PW / 2, P.y - PH, PW, PH);
      for (let ty = r.y0; ty <= r.y1; ty++) {
        if (ty < 0 || ty >= MH) continue;
        for (let tx = r.x0; tx <= r.x1; tx++) {
          if (tx < 0 || tx >= MW) continue;
          if (tile[ty * MW + tx] !== 2) continue;
          const top = ty;
          if (P.py - PH <= top + 0.06 && P.y - PH >= top - 0.02) {
            const impact = P.vy;
            P.y = top + PH; P.vy = 0; P.onGround = true; P.jumps = 1; P.coyote = COYOTE;
            if (impact > 12) landDust(impact);
            return;
          }
        }
      }
    }
  }

  function landDust(vy) {
    const n = clamp(Math.round(vy * .35), 2, 9);
    dust(P.x, P.y, n);
    if (vy > 16) { audio.sfx('land', { gain: .7 }); ctx.vibrate(PATTERNS.land); shake.add(Math.min(.22, vy * .006)); }
  }
  function dust(tx, ty, n) {
    for (let i = 0; i < n; i++) {
      particles.emit({
        x: tx * U, y: ty * U, vx: rng.range(-90, 90), vy: rng.range(-70, -10),
        life: rng.range(.22, .5), size: rng.range(1.6, 3.4), color: '#7d8db3', kind: 2, drag: 2.4
      });
    }
  }

  // ---------------------------------------------------------------- 机关 / 收集
  function checkTiles() {
    const r = tileRange(P.x - PW / 2 + .06, P.y - PH + .06, PW - .12, PH - .1);
    for (let ty = r.y0; ty <= r.y1; ty++) {
      if (ty < 0 || ty >= MH) continue;
      for (let tx = r.x0; tx <= r.x1; tx++) {
        if (tx < 0 || tx >= MW) continue;
        const t = tile[ty * MW + tx];
        if (t === 3) { if (P.invuln <= 0) die(); return; }
        else if (t === 5) { spring(tx, ty); return; }
        else if (t === 4 && S.dash > 0) { breakBrick(tx, ty, true); }
      }
    }
    // 收集品 / 检查点（按瓦片中心距离判定）
    for (const c of cores) {
      if (c.taken) continue;
      if (Math.abs(c.tx - P.x) < .62 && Math.abs(c.ty - (P.y - PH / 2)) < .7) {
        c.taken = true; S.got++;
        audio.sfx('coin'); ctx.vibrate(PATTERNS.tap);
        particles.burst(c.tx * U, c.ty * U, 16, { color: PALETTE.lime, speed: 150, life: .55, size: 2.6, kind: 1 });
        particles.ring(c.tx * U, c.ty * U, PALETTE.lime, 26);
        particles.text(c.tx * U, c.ty * U - 12, '+' + 1, '#8dff4d');
        ctx.hud('cores', '核心', S.got + '/' + S.totalCores, { color: PALETTE.lime });
      }
    }
    for (const f of flags) {
      if (f.on) continue;
      if (Math.abs(f.tx - P.x) < .8 && Math.abs(f.ty - (P.y - PH / 2)) < 1.1) {
        f.on = true;
        if (f.type === 'cp') {
          S.spawnTx = f.tx; S.spawnTy = f.ty;
          audio.sfx('powerup'); ctx.vibrate(PATTERNS.combo); flash.add(.16, PALETTE.cyan);
          particles.ring(f.tx * U, f.ty * U, PALETTE.cyan, 60);
          particles.burst(f.tx * U, f.ty * U, 22, { color: PALETTE.cyan, speed: 170, life: .7, kind: 1 });
          ctx.hint('检查点已激活');
        } else {
          win();
        }
      }
    }
  }

  function spring(tx, ty) {
    P.vy = -JUMP_V * 1.62; P.onGround = false; P.jumps = 1; P.y = ty - 0.02 + PH;
    P.coyote = 0;
    audio.sfx('jump', { gain: .8 }); audio.tone({ freq: 260, to: 900, type: 'triangle', dur: .18, gain: .12 });
    ctx.vibrate(PATTERNS.jump);
    particles.burst((tx + .5) * U, ty * U, 18, { color: PALETTE.amber, speed: 220, life: .45, kind: 1, angle: -Math.PI / 2, spread: 1.6 });
    particles.ring((tx + .5) * U, ty * U, PALETTE.amber, 34);
    shake.add(.12);
  }

  function breakBrick(tx, ty, silent) {
    const i = ty * MW + tx;
    if (tile[i] !== 4) return;
    brickHp[i]--;
    const cx = (tx + .5) * U, cy = (ty + .5) * U;
    if (brickHp[i] > 0) {
      tile[i] = 4;
      particles.burst(cx, cy, 8, { color: PALETTE.violet, speed: 130, life: .35, size: 2.4, kind: 4 });
      audio.sfx('hit', { gain: .5 });
      return;
    }
    tile[i] = 0;
    particles.burst(cx, cy, 20, { color: PALETTE.violet, speed: 240, life: .6, size: 3.4, kind: 5, grav: 900, drag: 1.2 });
    particles.ring(cx, cy, PALETTE.violet, 30);
    audio.sfx('explode', { gain: .55 });
    shake.add(.16); ctx.vibrate(PATTERNS.combo);
  }

  function tryDashBreak() {
    const r = tileRange(P.x - PW / 2 + .04, P.y - PH + .04, PW - .08, PH - .06);
    let broke = false;
    for (let ty = r.y0; ty <= r.y1; ty++) {
      if (ty < 0 || ty >= MH) continue;
      for (let tx = r.x0; tx <= r.x1; tx++) {
        if (tx < 0 || tx >= MW) continue;
        if (tile[ty * MW + tx] === 4) { breakBrick(tx, ty, true); broke = true; }
      }
    }
    if (broke) shake.add(.2);
  }

  // ---------------------------------------------------------------- 生死
  function die() {
    if (P.dead) return;
    P.dead = true; S.deaths++; S.respawn = 0.55;
    audio.sfx('die'); audio.duck(.5, 700);
    ctx.vibrate(PATTERNS.damage); shake.add(.8); flash.add(.4, PALETTE.red);
    particles.explosion(P.x * U, (P.y - PH / 2) * U, 1.2, PALETTE.red);
    for (let i = 0; i < 14; i++) particles.emit({
      x: P.x * U, y: (P.y - PH / 2) * U, vx: rng.range(-260, 260), vy: rng.range(-320, -60),
      life: rng.range(.5, 1.1), size: rng.range(2, 4.6), color: PALETTE.cyan, kind: 5, grav: 900, drag: .8
    });
    ctx.hud('deaths', '死亡', S.deaths, { color: PALETTE.red });
  }

  function respawn() {
    P.x = S.spawnTx; P.y = S.spawnTy; P.px = P.x; P.py = P.y;
    P.vx = 0; P.vy = 0; P.dash = 0; P.dashCd = 0; P.jumps = 1; P.invuln = .8;
    P.dead = false; P.onGround = false;
    camera.snap(P.x * U, P.y * U);
    particles.ring(P.x * U, P.y * U, PALETTE.cyan, 50);
  }

  function win() {
    if (S.done) return;
    S.done = true; S.endTimer = 0;
    audio.sfx('win'); audio.duck(.4, 1200);
    ctx.vibrate(PATTERNS.win); flash.add(.5, '#ffffff'); shake.add(.4);
    for (let i = 0; i < 3; i++) particles.ring(P.x * U, P.y * U, [PALETTE.lime, PALETTE.cyan, PALETTE.amber][i], 80 + i * 30);
  }

  // ---------------------------------------------------------------- 虚拟按键（移动端）
  const touchState = { l: false, r: false, jump: false, dash: false };
  if (ctx.caps.mobile) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:8px;width:100%;justify-content:space-between;pointer-events:none';
    const mk = (label, key, color) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = label;
      b.style.cssText = `pointer-events:auto;flex:1;min-width:0;user-select:none;touch-action:none;border-color:${color}55;color:${color};font-weight:800;padding:14px 0`;
      const down = (e) => { e.preventDefault(); touchState[key] = true; b.style.background = color + '33'; };
      const up = (e) => { e.preventDefault(); touchState[key] = false; b.style.background = ''; };
      ctx.listen(b, 'pointerdown', down);
      ctx.listen(b, 'pointerup', up);
      ctx.listen(b, 'pointercancel', up);
      ctx.listen(b, 'pointerleave', up);
      wrap.appendChild(b);
      return b;
    };
    mk('◀', 'l', PALETTE.cyan); mk('▶', 'r', PALETTE.cyan);
    mk('跳跃', 'jump', PALETTE.lime); mk('冲刺', 'dash', PALETTE.amber);
    ctx.overlay(wrap, 'overlay-bottom');
  }

  // ---------------------------------------------------------------- 更新
  function update(dt) {
    S.t += dt;
    if (S.done) {
      S.endTimer += dt;
      updateMovers(dt);
      if (S.endTimer > 1.15 && !S.finished) {
        S.finished = true;
        const score = Math.max(0, Math.round(9000 - S.time * 70) + S.got * 450 - S.deaths * 350);
        if (score > S.best) { S.best = score; ctx.save.set('best', score); }
        ctx.finish(score, {
          win: true, stats: [['用时', S.time.toFixed(1) + 's'], ['能量核心', S.got + '/' + S.totalCores], ['死亡', S.deaths]]
        });
      }
      return;
    }
    if (P.dead) {
      S.respawn -= dt;
      updateMovers(dt);
      if (S.respawn <= 0) respawn();
      return;
    }
    S.time += dt;

    updateMovers(dt);

    // ---- 输入 ----
    let ax = 0;
    if (input.isDown('left') || touchState.l) ax -= 1;
    if (input.isDown('right') || touchState.r) ax += 1;
    const jumpDown = input.isDown('jump') || touchState.jump;
    const jumpPressed = input.consume('jump', 130) || (touchState.jump && !S.touchJump);
    S.touchJump = touchState.jump;
    const dashPressed = input.consume('dash', 120) || input.consume('secondary', 120) || (touchState.dash && !S.touchDash);
    S.touchDash = touchState.dash;

    if (jumpPressed) P.jbuf = JBUF;
    P.jbuf -= dt; P.coyote -= dt; P.dashCd -= dt;
    if (P.invuln > 0) P.invuln -= dt;

    // ---- 冲刺 ----
    if (dashPressed && P.dashCd <= 0 && P.dash <= 0) {
      P.dash = DASH_TIME; P.dashCd = DASH_CD;
      P.dashDir = ax !== 0 ? Math.sign(ax) : P.face;
      P.face = P.dashDir;
      ctx.timeScale = 0.55;
      audio.sfx('dash'); ctx.vibrate(PATTERNS.hit); shake.add(.16);
      for (let i = 0; i < 16; i++) particles.emit({
        x: P.x * U, y: (P.y - PH / 2) * U, vx: -P.dashDir * rng.range(120, 420), vy: rng.range(-120, 120),
        life: rng.range(.2, .5), size: rng.range(1.8, 3.6), color: PALETTE.amber, kind: 1, drag: 2.2
      });
    }
    if (P.dash > 0) {
      P.dash -= dt;
      P.vx = P.dashDir * DASH_V;
      P.vy *= 0.82;
      if (P.dash <= 0) { ctx.timeScale = 1; P.vx = P.dashDir * RUN * 1.15; }
      // 残影
      for (const g of ghosts) if (g.life <= 0) { g.x = P.x; g.y = P.y; g.life = .26; g.gi = .26; break; }
      particles.trail(P.x * U, (P.y - PH / 2) * U, PALETTE.amber, 2.6);
    } else {
      // ---- 水平：加速度 -> 上限 -> 摩擦/空气阻力（保留惯性手感）----
      const acc = P.onGround ? ACC : AIRACC;
      // 冲刺余速会逐步衰减回常规上限，而不是被硬截断
      const lim = Math.abs(P.vx) > RUN ? Math.max(RUN, Math.abs(P.vx) - RUN * 3.2 * dt) : RUN;
      if (ax !== 0) {
        P.vx += ax * acc * dt;
        P.face = ax > 0 ? 1 : -1;
        if (Math.abs(P.vx) > lim) P.vx = Math.sign(P.vx) * lim;
      } else {
        const f = (P.onGround ? FRIC : AIR_DRAG) * dt;
        P.vx = Math.abs(P.vx) <= f ? 0 : P.vx - Math.sign(P.vx) * f;
        if (Math.abs(P.vx) > lim) P.vx = Math.sign(P.vx) * lim;
      }
      P.vx = clamp(P.vx, -DASH_V, DASH_V);
      // ---- 重力 + 可变跳跃高度 ----
      let g = GRAV;
      if (P.vy < 0 && !jumpDown) g *= 2.2;         // 松开跳键 -> 短跳
      if (P.vy > 0) g *= 1.15;                     // 下落更快，手感利落
      P.vy += g * dt;
      if (P.vy > MAXFALL) P.vy = MAXFALL;
    }

    // ---- 跳跃：coyote time + jump buffer + 二段跳 ----
    if (P.jbuf > 0) {
      if (P.coyote > 0) {
        P.vy = -JUMP_V; P.jumps = 1; P.jbuf = 0; P.coyote = 0; P.onGround = false;
        audio.sfx('jump'); ctx.vibrate(PATTERNS.jump);
        particles.ring(P.x * U, P.y * U, PALETTE.cyan, 26);
        for (let i = 0; i < 8; i++) particles.emit({
          x: P.x * U + rng.range(-8, 8), y: P.y * U, vx: rng.range(-70, 70), vy: rng.range(10, 90),
          life: .34, size: 3, color: PALETTE.cyan, kind: 2, drag: 2.6
        });
      } else if (P.jumps > 0) {
        P.jumps--; P.jbuf = 0; P.vy = -JUMP2_V; P.dashCd = Math.min(P.dashCd, .12);
        audio.sfx('jump', { gain: .7 }); audio.tone({ freq: 700, to: 1300, type: 'sine', dur: .12, gain: .08 });
        ctx.vibrate(PATTERNS.tap);
        particles.ring(P.x * U, (P.y - PH / 2) * U, PALETTE.lime, 34);
        for (let i = 0; i < 10; i++) particles.emit({
          x: P.x * U, y: (P.y - PH / 2) * U, vx: rng.range(-160, 160), vy: rng.range(-40, 160),
          life: .3, size: 2.4, color: PALETTE.lime, kind: 1, drag: 3
        });
      }
    }

    // ---- 随移动平台一起移动 ----
    if (P.ride >= 0) { const m = movers[P.ride]; P.x += m.dx; P.y += m.dy; }

    P.px = P.x;
    moveX(dt);
    moveY(dt);
    // 站上移动平台（扫掠判定，避免高速下落时穿透）
    for (let i = 0; i < movers.length; i++) {
      const m = movers[i];
      const top = m.cy;
      const prevBottom = P.py - PH, nowBottom = P.y - PH;
      const reach = Math.max(.3, (nowBottom - prevBottom) + .08);
      if (P.vy >= -0.001 && prevBottom <= top + .2 && nowBottom >= top - reach &&
        P.x + PW / 2 > m.cx - .15 && P.x - PW / 2 < m.cx + m.w + .15) {
        P.y = top + PH; P.vy = 0; P.onGround = true; P.jumps = 1; P.coyote = COYOTE; P.ride = i;
      }
    }
    // 站在砖块上被踩碎
    if (P.onGround && P.vy === 0 && S.dash > 0) tryDashBreak();

    checkTiles();
    if (P.y > MH + 3) die();
    if (P.x < .4) { P.x = .4; P.vx = Math.max(0, P.vx); }

    // 冲刺拾取吸入：靠近的核心被吸引
    if (P.dash > 0) for (const c of cores) {
      if (c.taken) continue;
      const dx = c.tx - P.x, dy = c.ty - (P.y - PH / 2);
      if (Math.abs(dx) < 1.4 && Math.abs(dy) < 1.4) { c.tx -= dx * dt * 4; c.ty -= dy * dt * 4; }
    }

    // ---- 相机（前瞻 + 边界钳制）----
    const lookX = clamp(P.vx * .13, -2.2, 2.2);
    const worldW = MW * U, worldH = MH * U;
    let cx = (P.x + lookX) * U - camera.w / 2;
    let cy = (P.y - PH / 2) * U - camera.h * .52;
    cx = clamp(cx, 0, Math.max(0, worldW - camera.w));
    cy = clamp(cy, 0, Math.max(0, worldH - camera.h));
    camera.follow(cx, cy, dt, 7.5);

    // ---- 残影衰减 ----
    for (const g of ghosts) if (g.life > 0) g.life -= dt;

    ctx.hud('time', '时间', S.time.toFixed(1) + 's', { color: S.time > 60 ? PALETTE.amber : null });
  }

  function dampv(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }

  function updateMovers(dt) {
    for (const m of movers) {
      m.t += dt * m.spd * .18;
      const k = (Math.sin(m.t * TAU) + 1) / 2;      // 往返缓动
      const nx = lerp(m.x0, m.x2, k), ny = lerp(m.y0, m.y2, k);
      m.dx = nx - m.cx; m.dy = ny - m.cy;
      m.cx = nx; m.cy = ny;
    }
  }

  // ---------------------------------------------------------------- 渲染
  function render(alpha, rdt) {
    const c = ctx.ctx, W = ctx.W, H = ctx.H;
    c.fillStyle = PALETTE.bg;
    c.fillRect(0, 0, W, H);

    // 背景（视差层，屏幕空间）
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a1226'); g.addColorStop(.55, '#070b16'); g.addColorStop(1, '#05070f');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.save();
    c.globalAlpha = .5;
    for (const d of deco) {
      const px = d.x * U - camera.x * d.z, py = d.y * U - camera.y * d.z * .5;
      if (px < -80 || px > W + 80) continue;
      c.fillStyle = 'rgba(43,58,99,.35)';
      c.fillRect(px, py * .5 + H * .18, d.w * U * .6, d.h * U * .5);
    }
    c.restore();
    drawGrid(c, W, H, U * 1.5, 'rgba(60,90,150,.06)', 1, camera.x * .3, camera.y * .3);

    c.save();
    camera.apply(c);
    shake.apply(c);

    const x0 = Math.max(0, Math.floor(camera.x / U) - 1), x1 = Math.min(MW - 1, Math.ceil((camera.x + W) / U) + 1);
    const y0 = Math.max(0, Math.floor(camera.y / U) - 1), y1 = Math.min(MH - 1, Math.ceil((camera.y + H) / U) + 1);

    drawTiles(c, x0, x1, y0, y1);
    drawMovers(c);
    drawCollect(c);
    drawGhosts(c);
    drawPlayer(c);

    particles.render(c, ctx.settings.reducedFx ? .6 : 1);
    particles.renderTexts(c, rdt);
    c.restore();

    drawHudOverlay(c, W, H);
    vignette(c, W, H, .42);
    if (P.dead) text(c, '重生中…', W / 2, H * .42, { size: 22, color: PALETTE.red, weight: 900, glow: 16 });
    if (S.done) {
      c.save(); c.globalAlpha = clamp(S.endTimer * 2, 0, .7);
      c.fillStyle = '#04120a'; c.fillRect(0, 0, W, H); c.restore();
      text(c, 'GOAL!', W / 2, H * .44, { size: Math.min(58, W * .12), color: PALETTE.lime, weight: 900, glow: 24 });
    }
  }

  function drawTiles(c, x0, x1, y0, y1) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = tile[y * MW + x];
        if (!t) continue;
        const px = x * U, py = y * U;
        if (t === 1) {
          const edge = !isSolid(x, y - 1);
          c.fillStyle = '#151d33';
          c.fillRect(px, py, U + .5, U + .5);
          c.fillStyle = 'rgba(34,224,255,.10)';
          c.fillRect(px, py, U + .5, 3);
          if (edge) { c.fillStyle = 'rgba(34,224,255,.45)'; c.fillRect(px, py, U + .5, 2); }
          c.strokeStyle = 'rgba(90,120,180,.16)'; c.lineWidth = 1;
          c.strokeRect(px + .5, py + .5, U, U);
        } else if (t === 2) {   // 单向平台
          c.fillStyle = 'rgba(168,85,247,.22)';
          c.fillRect(px, py, U + .5, U * .34);
          c.fillStyle = PALETTE.violet;
          c.fillRect(px, py, U + .5, 2.5);
        } else if (t === 3) {   // 尖刺
          c.fillStyle = 'rgba(255,77,94,.85)';
          c.beginPath();
          const n = 3;
          for (let i = 0; i < n; i++) {
            const bx = px + (U / n) * i;
            c.moveTo(bx, py + U); c.lineTo(bx + U / n / 2, py + U * .18); c.lineTo(bx + U / n, py + U);
          }
          c.closePath(); c.fill();
          c.fillStyle = 'rgba(255,77,94,.18)';
          c.fillRect(px, py + U * .6, U, U * .4);
        } else if (t === 4) {   // 可破坏砖
          const hp = brickHp[y * MW + x];
          c.fillStyle = hp > 1 ? 'rgba(168,85,247,.30)' : 'rgba(255,46,136,.28)';
          c.fillRect(px + 1, py + 1, U - 2, U - 2);
          c.strokeStyle = hp > 1 ? PALETTE.violet : PALETTE.magenta; c.lineWidth = 2;
          c.strokeRect(px + 1.5, py + 1.5, U - 3, U - 3);
          c.strokeStyle = 'rgba(255,255,255,.18)';
          c.beginPath(); c.moveTo(px + 2, py + U / 2); c.lineTo(px + U - 2, py + U / 2); c.stroke();
        } else if (t === 5) {   // 弹簧
          const p = 1 + Math.sin(S.t * 6 + x) * .06;
          c.fillStyle = 'rgba(255,176,32,.22)';
          c.fillRect(px + 2, py + U * .5, U - 4, U * .5);
          c.strokeStyle = PALETTE.amber; c.lineWidth = 2.5;
          c.beginPath();
          c.moveTo(px + 3, py + U * .92);
          c.lineTo(px + U / 2, py + U * (1 - .58 * p));
          c.lineTo(px + U - 3, py + U * .92);
          c.stroke();
          c.fillStyle = PALETTE.amber;
          c.beginPath(); c.arc(px + U / 2, py + U * (1 - .58 * p), 3.2, 0, TAU); c.fill();
        }
      }
    }
  }

  function drawMovers(c) {
    for (const m of movers) {
      const px = m.cx * U, py = m.cy * U, pw = m.w * U;
      c.save();
      glowRect(c, px, py, pw, U * m.h, PALETTE.cyan, { glow: 10, width: 2, fill: 'rgba(34,224,255,.14)', r: 4 });
      // 运动方向指示
      c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1;
      c.beginPath();
      c.moveTo(px, py - U * .5); c.lineTo(px + pw, py - U * .5); c.stroke();
      c.restore();
    }
  }

  function drawCollect(c) {
    for (const f of cores) {
      if (f.taken) continue;
      const bob = Math.sin(S.t * 3 + f.bob) * U * .12;
      const x = f.tx * U, y = f.ty * U + bob;
      c.save();
      const gg = c.createRadialGradient(x, y, 0, x, y, U * .55);
      gg.addColorStop(0, 'rgba(141,255,77,.55)'); gg.addColorStop(1, 'rgba(141,255,77,0)');
      c.fillStyle = gg; c.beginPath(); c.arc(x, y, U * .55, 0, TAU); c.fill();
      c.translate(x, y); c.rotate(S.t * 1.4 + f.bob);
      c.fillStyle = PALETTE.lime;
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6, rr = U * .22;
        const px2 = Math.cos(a) * rr, py2 = Math.sin(a) * rr * .8;
        i ? c.lineTo(px2, py2) : c.moveTo(px2, py2);
      }
      c.closePath(); c.fill();
      c.restore();
    }
    for (const f of flags) {
      const x = f.tx * U, y = f.ty * U;
      if (f.type === 'cp') {
        c.save();
        c.translate(x, y - U * .1);
        c.rotate(Math.sin(S.t * 2 + f.tx) * .18);
        const col = f.on ? PALETTE.cyan : PALETTE.dim;
        c.fillStyle = f.on ? 'rgba(34,224,255,.35)' : 'rgba(125,141,179,.18)';
        c.beginPath();
        c.moveTo(0, -U * .55); c.lineTo(U * .26, 0); c.lineTo(0, U * .55); c.lineTo(-U * .26, 0);
        c.closePath(); c.fill();
        c.strokeStyle = col; c.lineWidth = 2; c.stroke();
        c.restore();
        if (f.on) glowCircle(c, x, y - U * .1, U * (.5 + Math.sin(S.t * 3) * .06), col, { glow: 8, alpha: .5 });
      } else {
        // 终点旗
        c.save();
        c.strokeStyle = PALETTE.white; c.lineWidth = 3;
        c.beginPath(); c.moveTo(x, y + U * .6); c.lineTo(x, y - U * 1.5); c.stroke();
        c.fillStyle = PALETTE.lime;
        const wv = Math.sin(S.t * 4) * U * .08;
        c.beginPath();
        c.moveTo(x, y - U * 1.5); c.lineTo(x + U * .9 + wv, y - U * 1.1);
        c.lineTo(x, y - U * .7); c.closePath(); c.fill();
        c.restore();
        glowCircle(c, x, y - U * .45, U * (1 + Math.sin(S.t * 2) * .1), PALETTE.lime, { glow: 10, alpha: .35 });
      }
    }
  }

  function drawGhosts(c) {
    for (const gh of ghosts) {
      if (gh.life <= 0) continue;
      const t = gh.life / gh.gi;
      c.save();
      c.globalAlpha = t * .5;
      c.fillStyle = PALETTE.amber;
      roundRect(c, gh.x * U - PW * U / 2, gh.y * U - PH * U, PW * U, PH * U, 4);
      c.fill();
      c.restore();
    }
  }

  function drawPlayer(c) {
    if (P.dead) return;
    const w = PW * U, h = PH * U;
    const x = P.x * U - w / 2, y = P.y * U - h;
    const blink = P.invuln > 0 && Math.floor(P.invuln * 22) % 2 === 0;
    c.save();
    // 落地/移动拖尾光晕
    c.globalAlpha = .55;
    const gg = c.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 1.6);
    gg.addColorStop(0, P.dash > 0 ? 'rgba(255,176,32,.5)' : 'rgba(34,224,255,.35)');
    gg.addColorStop(1, 'rgba(34,224,255,0)');
    c.fillStyle = gg;
    c.beginPath(); c.arc(x + w / 2, y + h / 2, w * 1.6, 0, TAU); c.fill();
    c.globalAlpha = 1;
    if (!blink) {
      const col = P.dash > 0 ? PALETTE.amber : (P.onGround ? PALETTE.cyan : PALETTE.lime);
      // 挤压拉伸
      const sq = P.vy < -2 ? 1.16 : (P.vy > 12 ? .88 : 1);
      const hh = h * sq, ww = w / sq;
      roundRect(c, x + w / 2 - ww / 2, y + h - hh, ww, hh, 5);
      c.fillStyle = 'rgba(7,11,22,.85)'; c.fill();
      c.strokeStyle = col; c.lineWidth = 2.4; c.stroke();
      c.fillStyle = col;
      c.beginPath(); c.arc(x + w / 2 + P.face * ww * .18, y + h - hh + hh * .32, Math.min(ww, hh) * .16, 0, TAU); c.fill();
    }
    c.restore();
  }

  function drawHudOverlay(c, W, H) {
    // 冲刺冷却
    const bw = Math.min(160, W * .3), bx = W - bw - 14, by = H - 26;
    const ready = P.dashCd <= 0;
    bar(c, bx, by, bw, 6, ready ? 1 : 1 - P.dashCd / DASH_CD, {
      bg: 'rgba(255,255,255,.08)', fill: ready ? PALETTE.amber : PALETTE.dim, r: 3
    });
    text(c, ready ? '冲刺就绪 (Shift)' : '冲刺充能…', bx + bw / 2, by - 8, { size: 10, color: ready ? PALETTE.amber : PALETTE.dim, baseline: 'bottom' });
    // 顶部时间条
    text(c, fmtTime(S.time), W / 2, 20, { size: 13, color: PALETTE.dim, baseline: 'top' });
  }

  // ---------------------------------------------------------------- 生命周期
  return {
    update, render,
    resize(w, h) { layout(w, h); },
    pause() { audio.duck(.5, 3000); },
    resume() { },
    destroy() { ctx.timeScale = 1; }
  };
}
