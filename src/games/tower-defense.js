// 塔防·路径寻路 —— 网格迷宫塔防：流场寻路 + 建塔连通性校验 + 四大塔系三级升级 + 20 波
import { clamp, lerp, TAU, fmtNum } from '../core/math.js';
import { PALETTE, neon, glowCircle, roundRect, text, bar, grid as drawGrid, vignette } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';
export const meta = {
  id: 'tower-defense',
  title: '塔防·路径寻路',
  category: 'strategy',
  difficulty: 3,
  music: 'tense',
  howto: [
    '点底部图标选塔，再点空地建造（不能把路封死）',
    '点已有塔可升级 / 出售（返还 60%）/ 切换优先目标',
    '空格 = 提前开波拿奖励　F = 2 倍速　1~4 选塔'
  ],
  particles: 1400
};
export const musicTrack = 'tense';
// ---------------- 常量 ----------------
const COLS = 20, ROWS = 14;
const SX = 0, SY = 7, EX = 19, EY = 6;          // 起点 / 终点（格）
const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
const MAX_WAVE = 20;
const TOWER_ORDER = ['arrow', 'cannon', 'frost', 'laser'];
const TOWERS = {
  arrow: {
    name: '箭塔', icon: '▲', color: PALETTE.lime, air: true,
    cost: [50, 40, 70], dmg: [10, 17, 28], rate: [0.55, 0.46, 0.37], range: [2.7, 3.0, 3.3],
    tip: '单体高频 · 可对空'
  },
  cannon: {
    name: '炮塔', icon: '◉', color: PALETTE.amber, air: false,
    cost: [85, 75, 120], dmg: [26, 45, 74], rate: [1.5, 1.35, 1.15], range: [2.5, 2.7, 3.0],
    splash: [0.95, 1.15, 1.45], tip: '溅射爆炸 · 无法对空'
  },
  frost: {
    name: '冰塔', icon: '❄', color: PALETTE.cyan, air: true,
    cost: [70, 60, 95], dmg: [5, 9, 15], rate: [0.9, 0.78, 0.66], range: [2.3, 2.6, 2.9],
    slow: [0.35, 0.46, 0.58], tip: '减速光环 · 低伤害'
  },
  laser: {
    name: '激光塔', icon: '✦', color: PALETTE.magenta, air: true,
    cost: [115, 105, 160], dps: [28, 46, 78], range: [3.0, 3.3, 3.7],
    tip: '持续光束 · 无视护甲'
  }
};
const ENEMIES = {
  normal: { name: '步兵', hp: 58, spd: 1.75, gold: 7, armor: 0, r: 0.27, color: '#ff6b7a' },
  fast: { name: '游骑', hp: 40, spd: 3.05, gold: 9, armor: 0, r: 0.23, color: PALETTE.violet },
  tank: { name: '重甲', hp: 240, spd: 1.05, gold: 24, armor: 7, r: 0.36, color: '#ff9a3c' },
  fly: { name: '飞艇', hp: 72, spd: 2.35, gold: 13, armor: 1, r: 0.26, color: PALETTE.cyan, fly: true },
  heal: { name: '医师', hp: 130, spd: 1.5, gold: 17, armor: 2, r: 0.30, color: PALETTE.green, heal: 16 }
};
const BOSS = { name: 'BOSS', hp: 1900, spd: 0.9, gold: 200, armor: 13, r: 0.52, color: PALETTE.magenta };
const MODES = ['first', 'close', 'strong'];
const MODE_NAME = { first: '最前', close: '最近', strong: '最强' };
// ---------------- 主逻辑 ----------------
export function create(ctx) {
  const { input, audio, particles, shake, flash, rng, save } = ctx;
  // ---- 布局 ----
  let cell = 30, ox = 0, oy = 0;
  function layout(w, h) {
    const topPad = 54, botPad = h > 620 ? 128 : 104;
    cell = Math.max(12, Math.floor(Math.min((w - 28) / COLS, (h - topPad - botPad) / ROWS)));
    ox = Math.round((w - cell * COLS) / 2);
    oy = Math.round(topPad + Math.max(0, (h - topPad - botPad - cell * ROWS) / 2));
  }
  layout(ctx.W, ctx.H);
  const cxc = (i) => ox + i * cell + cell / 2;
  const cyc = (j) => oy + j * cell + cell / 2;
  const gx = (px) => clamp(Math.floor((px - ox) / cell), 0, COLS - 1);   // 世界 x -> 列
  const gy = (py) => clamp(Math.floor((py - oy) / cell), 0, ROWS - 1);   // 世界 y -> 行
  // ---- 地图 / 寻路 ----
  const grid = new Uint8Array(COLS * ROWS);          // 0 空 1 塔
  const towerAt = new Int32Array(COLS * ROWS).fill(-1);
  const dist = new Int32Array(COLS * ROWS);          // 到终点的 BFS 距离场
  const distT = new Int32Array(COLS * ROWS);         // 假设建造时的临时距离场
  const bfsQ = new Int32Array(COLS * ROWS);
  const pathX = new Float32Array(COLS * ROWS + 2);
  const pathY = new Float32Array(COLS * ROWS + 2);
  let pathN = 0;
  /** 从终点做 BFS；(bx,by) 为假设要放置的塔，返回起点是否可达 */
  function computeDist(bx, by, out) {
    out.fill(-1);
    let head = 0, tail = 0;
    const endI = EY * COLS + EX;
    out[endI] = 0; bfsQ[tail++] = endI;
    while (head < tail) {
      const ci = bfsQ[head++], cx = ci % COLS, cy = (ci / COLS) | 0, d = out[ci] + 1;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DX[k], ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const ni = ny * COLS + nx;
        if (out[ni] >= 0 || grid[ni] === 1 || (nx === bx && ny === by)) continue;
        out[ni] = d; bfsQ[tail++] = ni;
      }
    }
    return out[SY * COLS + SX] >= 0;
  }
  function rebuildPath() {
    pathN = 0;
    let cx = SX, cy = SY, guard = 0;
    while (guard++ < 500) {
      pathX[pathN] = cxc(cx); pathY[pathN] = cyc(cy); pathN++;
      if (cx === EX && cy === EY) break;
      const cur = dist[cy * COLS + cx];
      let bd = cur, bi = -1;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DX[k], ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const nd = dist[ny * COLS + nx];
        if (nd >= 0 && nd < bd) { bd = nd; bi = k; }
      }
      if (bi < 0) break;
      cx += DX[bi]; cy += DY[bi];
    }
  }
  /** 建造前检查：不能封死起点，也不能困住任何地面敌人 */
  function canBuildAt(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return false;
    const i = cy * COLS + cx;
    if (grid[i] === 1) return false;
    if ((cx === SX && cy === SY) || (cx === EX && cy === EY)) return false;
    if (!computeDist(cx, cy, distT)) return false;
    for (let k = 0; k < MAXE; k++) {
      const e = enemies[k];
      if (!e.alive || e.fly) continue;
      if (distT[gy(e.y) * COLS + gx(e.x)] < 0) return false;
      if (distT[gy(e.ny) * COLS + gx(e.nx)] < 0) return false;
    }
    return true;
  }
  /** 提交地形变化（建塔 / 拆塔后调用） */
  function refreshField() { computeDist(-1, -1, dist); rebuildPath(); }
  const MAXE = 170, MAXP = 240, MAXT = 64;
  const enemies = [];
  for (let i = 0; i < MAXE; i++) enemies.push({ alive: false, type: 'normal', x: 0, y: 0, nx: 0, ny: 0, hp: 1, maxHp: 1, spd: 1, gold: 0, armor: 0, r: 8, fly: false, heal: 0, slowT: 0, slowAmt: 0, hitFx: 0, laserT: 0, healCd: 0, boss: false, wob: 0, prog: 0 });
  const bullets = [];
  for (let i = 0; i < MAXP; i++) bullets.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, spd: 320, dmg: 0, ti: -1, tx: 0, ty: 0, splash: 0, slow: 0, slowT: 0, pierceArmor: false, col: '#fff', r: 3, life: 0, homing: false });
  const towers = [];
  for (let i = 0; i < MAXT; i++) towers.push({ alive: false, type: 'arrow', level: 1, cx: 0, cy: 0, x: 0, y: 0, cd: 0, ang: 0, mode: 'first', ti: -1, beamT: 0, spent: 0, kills: 0, born: 0, dmgDone: 0 });
  const FXP = 40, fx = [];
  for (let i = 0; i < FXP; i++) fx.push({ alive: false, x: 0, y: 0, r: 0, t: 0, max: 0.4, col: '#fff', kind: 0 });
  function spawnEnemy(type, hpMul, boss) {
    for (let i = 0; i < MAXE; i++) {
      const e = enemies[i];
      if (e.alive) continue;
      const d = boss ? BOSS : ENEMIES[type];
      e.alive = true; e.type = boss ? 'boss' : type; e.boss = !!boss;
      e.maxHp = Math.round(d.hp * hpMul); e.hp = e.maxHp;
      e.spd = d.spd; e.gold = Math.round(d.gold * (1 + (hpMul - 1) * 0.25));
      e.armor = d.armor; e.r = d.r * cell; e.fly = !!d.fly; e.heal = d.heal || 0;
      e.x = ox - cell * 0.7 + rng.range(-3, 3); e.y = cyc(SY) + rng.range(-3, 3);
      e.nx = cxc(SX); e.ny = cyc(SY);
      e.slowT = 0; e.slowAmt = 0; e.hitFx = 0; e.laserT = 0; e.healCd = 0;
      e.wob = rng.range(0, TAU);
      return e;
    }
    return null;
  }
  function spawnBullet() { for (let i = 0; i < MAXP; i++) if (!bullets[i].alive) return bullets[i]; return null; }
  function addFx(x, y, r, col, kind, dur) {
    for (let i = 0; i < FXP; i++) {
      if (fx[i].alive) continue;
      fx[i].alive = true; fx[i].x = x; fx[i].y = y; fx[i].r = r; fx[i].col = col; fx[i].kind = kind; fx[i].t = 0; fx[i].max = dur;
      return fx[i];
    }
    return null;
  }
  // ---- 波次 ----
  const waves = [];
  function genWaves() {
    waves.length = 0;
    for (let w = 1; w <= MAX_WAVE; w++) {
      const hpMul = 1 + (w - 1) * 0.30 + Math.pow(w / 11, 2.3);
      const groups = [];
      const pool = [['normal', 46], ['fast', 24]];
      if (w >= 4) pool.push(['fly', 16]);
      if (w >= 6) pool.push(['tank', 10]);
      if (w >= 8) pool.push(['heal', 9]);
      let count = 4 + Math.round(w * 1.9);
      let delay = 0;
      while (count > 0) {
        const t = rng.weighted(pool.map(([n, ww]) => ({ n, w: ww })), (it) => it.w).n;
        const n = Math.min(count, rng.int(3, 6));
        count -= n;
        groups.push({ type: t, count: n, gap: t === 'fast' ? 0.42 : 0.62, delay });
        delay += n * (t === 'fast' ? 0.42 : 0.62) + 0.7;
      }
      if (w % 10 === 0) groups.push({ type: 'boss', count: w >= 20 ? 2 : 1, gap: 1.6, delay: delay + 1.2 });
      waves.push({ hpMul, groups });
    }
  }
  genWaves();
  // ---- 状态 ----
  const S = {
    gold: 260, lives: 20, wave: 0, kills: 0, phase: 'prep', prepT: 14,
    speed: 1, selType: 'arrow', sel: -1, t: 0, over: false, overT: 0,
    hoverX: -1, hoverY: -1, built: 0, leaked: 0, best: save.get('best', 0), spawned: 0
  };
  const SQ = 260;
  const sqType = new Array(SQ), sqAt = new Float32Array(SQ);
  let sqN = 0, sqI = 0, spawnT = 0;
  function startWave(bonus) {
    if (S.phase === 'wave' || S.over) return;
    S.wave++;
    if (S.wave > MAX_WAVE) return;
    if (bonus) {
      const b = 12 + S.wave * 3;
      S.gold += b;
      particles.text(ctx.W / 2, oy + cell * 2, '提前开波 +' + b, PALETTE.amber);
    }
    const w = waves[S.wave - 1];
    sqN = 0;
    for (const g of w.groups) {
      for (let i = 0; i < g.count; i++) {
        if (sqN >= SQ) break;
        sqType[sqN] = g.type; sqAt[sqN] = g.delay + i * g.gap; sqN++;
      }
    }
    sqI = 0; spawnT = 0;
    S.phase = 'wave'; S.hpMul = w.hpMul;
    audio.sfx('alarm'); audio.duck(0.35, 700);
    ctx.vibrate(PATTERNS.land);
    ctx.hint('第 ' + S.wave + ' 波' + (S.wave % 10 === 0 ? ' —— BOSS 来袭！' : ''), 2600);
    dirty.hud = true; refreshUI();
  }
  // ---- 建造 / 升级 / 出售 ----
  function tryBuild(cx, cy) {
    const def = TOWERS[S.selType];
    const cost = def.cost[0];
    if (S.gold < cost) { deny('金币不足'); return; }
    if (!canBuildAt(cx, cy)) { deny('这里会把路封死！'); return; }
    let ti = -1;
    for (let i = 0; i < MAXT; i++) if (!towers[i].alive) { ti = i; break; }
    if (ti < 0) { deny('塔位已满'); return; }
    const t = towers[ti];
    t.alive = true; t.type = S.selType; t.level = 1; t.cx = cx; t.cy = cy;
    t.x = cxc(cx); t.y = cyc(cy); t.cd = 0; t.ang = 0; t.mode = 'first'; t.ti = -1;
    t.beamT = 0; t.spent = cost; t.kills = 0; t.born = S.t; t.dmgDone = 0;
    grid[cy * COLS + cx] = 1; towerAt[cy * COLS + cx] = ti;
    S.gold -= cost; S.built++;
    refreshField();
    audio.sfx('place'); ctx.vibrate(PATTERNS.tap); shake.add(0.12);
    particles.ring(t.x, t.y, def.color, cell * 1.1);
    particles.burst(t.x, t.y, 12, { color: def.color, speed: 140, life: .5, kind: 4 });
    particles.text(t.x, t.y - cell * .6, '-' + cost, PALETTE.red);
    selectTower(ti);
    dirty.hud = true; refreshUI();
  }
  function upgrade(ti) {
    const t = towers[ti];
    if (!t.alive || t.level >= 3) return;
    const def = TOWERS[t.type];
    const cost = def.cost[t.level];
    if (S.gold < cost) { deny('金币不足'); return; }
    S.gold -= cost; t.spent += cost; t.level++;
    audio.sfx('powerup'); ctx.vibrate(PATTERNS.select); shake.add(0.1);
    particles.ring(t.x, t.y, def.color, cell * 1.4);
    particles.burst(t.x, t.y, 14, { color: def.color, speed: 170, life: .55, kind: 1 });
    particles.text(t.x, t.y - cell * .7, 'Lv.' + t.level, def.color);
    dirty.hud = true; refreshUI();
  }
  function sell(ti) {
    const t = towers[ti];
    if (!t.alive) return;
    const back = Math.floor(t.spent * 0.6);
    S.gold += back;
    grid[t.cy * COLS + t.cx] = 0; towerAt[t.cy * COLS + t.cx] = -1;
    t.alive = false;
    refreshField();
    audio.sfx('coin'); ctx.vibrate(PATTERNS.tap);
    particles.burst(t.x, t.y, 14, { color: PALETTE.amber, speed: 150, life: .6, kind: 4 });
    particles.text(t.x, t.y - cell * .6, '+' + back, PALETTE.amber);
    S.sel = -1;
    dirty.hud = true; refreshUI();
  }
  function deny(msg) {
    audio.sfx('error'); ctx.vibrate(PATTERNS.error); ctx.hint(msg, 1800);
  }
  function selectTower(ti) { S.sel = ti; refreshUI(); }
  // ---------- 模拟 ----------
  function pickTarget(t) {
    const def = TOWERS[t.type];
    const R = def.range[t.level - 1] * cell;
    const canAir = def.air;
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < MAXE; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      if (e.fly && !canAir) continue;
      const d = Math.hypot(e.x - t.x, e.y - t.y);
      if (d > R + e.r * 0.5) continue;
      let sc;
      if (t.mode === 'close') sc = d;
      else if (t.mode === 'strong') sc = -e.maxHp;
      else sc = e.prog;
      if (sc < bestScore) { bestScore = sc; best = i; }
    }
    return best;
  }
  function fire(t, ti) {
    const def = TOWERS[t.type], lv = t.level - 1;
    if (t.type === 'laser') { t.beamT = 0.18; return; }
    const b = spawnBullet();
    if (!b) return;
    b.alive = true; b.x = t.x; b.y = t.y;
    b.dmg = def.dmg[lv]; b.col = def.color; b.homing = t.type !== 'cannon';
    b.pierceArmor = false; b.splash = 0; b.slow = 0; b.life = 2.4;
    b.ti = t.ti; b.spd = t.type === 'cannon' ? 300 : 520;
    b.r = t.type === 'cannon' ? 5 : 3;
    if (t.type === 'cannon') {
      const e = enemies[t.ti], k = clamp(Math.hypot(e.x - t.x, e.y - t.y) / b.spd * e.spd / cell, 0, 1) * 0.6;
      b.splash = def.splash[lv] * cell; b.tx = e.x + (e.nx - e.x) * k; b.ty = e.y + (e.ny - e.y) * k; b.ti = -1;
      const a = Math.atan2(b.ty - t.y, b.tx - t.x);
      b.vx = Math.cos(a) * b.spd; b.vy = Math.sin(a) * b.spd;
      audio.sfx('shoot', { gain: .55 });
    } else {
      b.vx = 0; b.vy = 0;
      if (t.type === 'frost') { b.slow = def.slow[lv]; b.slowT = 1.4; }
      audio.sfx(t.type === 'arrow' ? 'shoot' : 'reflect', { gain: .35 });
    }
    t.ang = Math.atan2(enemies[t.ti].y - t.y, enemies[t.ti].x - t.x);
  }
  function damage(e, ei, dmg, pierceArmor, col) {
    const real = Math.max(1, dmg - (pierceArmor ? 0 : e.armor));
    e.hp -= real; e.hitFx = 0.12;
    if (e.hp <= 0) killEnemy(e, ei);
    else if (col) particles.burst(e.x, e.y, 3, { color: col, speed: 110, life: .3, size: 2, kind: 1 });
  }
  function killEnemy(e, ei) {
    e.alive = false;
    S.gold += e.gold; S.kills++;
    particles.burst(e.x, e.y, e.boss ? 40 : 14, { color: e.boss ? PALETTE.magenta : '#ffe27a', speed: e.boss ? 300 : 180, life: .7, size: e.boss ? 5 : 3, kind: 1 });
    particles.explosion(e.x, e.y, e.boss ? 1.8 : 0.55, e.boss ? PALETTE.magenta : PALETTE.amber);
    particles.text(e.x, e.y - e.r, '+' + e.gold, PALETTE.amber);
    audio.sfx(e.boss ? 'explode' : 'coin', { gain: e.boss ? 1 : .5 });
    if (e.boss) { shake.add(0.7); flash.add(0.35, '#ff2e88'); ctx.vibrate(PATTERNS.explode); }
    else ctx.vibrate(PATTERNS.hit);
    for (let i = 0; i < MAXT; i++) if (towers[i].alive && towers[i].ti === ei) towers[i].ti = -1;
    dirty.hud = true;
  }
  function leak(e, ei) {
    e.alive = false;
    const dmg = e.boss ? 6 : 1;
    S.lives -= dmg; S.leaked++;
    audio.sfx('hurt'); ctx.vibrate(PATTERNS.damage); shake.add(0.5); flash.add(0.3, '#ff4d5e');
    particles.explosion(cxc(EX), cyc(EY), 1.1, PALETTE.red);
    particles.text(cxc(EX), cyc(EY) - cell, '-' + dmg, PALETTE.red);
    if (S.lives <= 0) { S.lives = 0; gameOver(false); }
    dirty.hud = true;
  }
  function updateEnemies(dt) {
    for (let i = 0; i < MAXE; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      e.wob += dt * 6;
      if (e.hitFx > 0) e.hitFx -= dt;
      if (e.laserT > 0) e.laserT -= dt;
      // 减速
      let mul = 1;
      if (e.slowT > 0) { e.slowT -= dt; mul *= (1 - e.slowAmt); }
      let auraSlow = 0;
      for (let k = 0; k < MAXT; k++) {
        const t = towers[k];
        if (!t.alive || t.type !== 'frost') continue;
        const R = TOWERS.frost.range[t.level - 1] * cell * 0.75;
        if (Math.hypot(e.x - t.x, e.y - t.y) < R) auraSlow = Math.max(auraSlow, TOWERS.frost.slow[t.level - 1] * 0.6);
      }

      if (auraSlow > 0) mul *= (1 - auraSlow);
      if (e.fly) {
        const dx = cxc(EX) - e.x, dy = cyc(EY) - e.y, d = Math.hypot(dx, dy) || 1;
        e.x += dx / d * e.spd * cell * mul * dt;
        e.y += dy / d * e.spd * cell * mul * dt + Math.sin(e.wob) * 6 * dt;
        e.nx = cxc(EX); e.ny = cyc(EY);
        if (d < cell * 0.4) { leak(e, i); continue; }
        e.prog = d / cell;
      } else {
        const sp = e.spd * cell * mul * dt;
        const dx = e.nx - e.x, dy = e.ny - e.y, d = Math.hypot(dx, dy);
        if (d <= sp) {
          e.x = e.nx; e.y = e.ny;
          const cx = clamp(Math.floor((e.x - ox) / cell), 0, COLS - 1);
          const cy = clamp(Math.floor((e.y - oy) / cell), 0, ROWS - 1);
          if (cx === EX && cy === EY) { leak(e, i); continue; }
          // 沿流场选下一格
          const cur = dist[cy * COLS + cx];
          let bd = cur < 0 ? 1e9 : cur, bi = -1;
          for (let k = 0; k < 4; k++) {
            const nx = cx + DX[k], ny = cy + DY[k];
            if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
            const nd = dist[ny * COLS + nx];
            if (nd >= 0 && nd < bd) { bd = nd; bi = k; }
          }
          if (bi < 0) { e.nx = e.x; e.ny = e.y; }   // 兜底：原地待命
          else { e.nx = cxc(cx + DX[bi]); e.ny = cyc(cy + DY[bi]); }
        } else {
          e.x += dx / d * sp; e.y += dy / d * sp;
        }
        // 目标格被塔占据 → 立即重新规划
        const wx = gx(e.nx), wy = gy(e.ny);
        if (grid[wy * COLS + wx] === 1) { e.nx = cxc(gx(e.x)); e.ny = cyc(gy(e.y)); }
        e.prog = dist[wy * COLS + wx] < 0 ? 999 : dist[wy * COLS + wx];
      }
      // 治疗
      if (e.heal > 0) {
        e.healCd -= dt;
        if (e.healCd <= 0) {
          e.healCd = 0.5;
          let healed = false;
          for (let k = 0; k < MAXE; k++) {
            const o = enemies[k];
            if (!o.alive || o.hp >= o.maxHp || Math.hypot(o.x - e.x, o.y - e.y) > cell * 2.2) continue;
            o.hp = Math.min(o.maxHp, o.hp + e.heal);
            particles.burst(o.x, o.y, 3, { color: PALETTE.green, speed: 60, life: .45, size: 2 });
            healed = true;
          }
          if (healed) addFx(e.x, e.y, cell * 2.2, PALETTE.green, 1, 0.35);
        }
      }
    }
  }
  function updateTowers(dt) {
    for (let i = 0; i < MAXT; i++) {
      const t = towers[i];
      if (!t.alive) continue;
      const def = TOWERS[t.type], lv = t.level - 1;
      if (t.beamT > 0) t.beamT -= dt;
      if (t.ti >= 0 && (!enemies[t.ti].alive || Math.hypot(enemies[t.ti].x - t.x, enemies[t.ti].y - t.y) > def.range[lv] * cell + 6)) t.ti = -1;
      if (t.ti < 0) t.ti = pickTarget(t);
      if (t.ti < 0) continue;
      if (t.type === 'laser') {
        const e = enemies[t.ti];
        t.ang = Math.atan2(e.y - t.y, e.x - t.x);
        const dps = def.dps[lv];
        e.hp -= dps * dt; e.laserT = 0.1; e.hitFx = 0.05;
        t.dmgDone += dps * dt;
        if (rng.chance(0.35)) particles.burst(e.x, e.y, 2, { color: PALETTE.magenta, speed: 130, life: .3, size: 2.4, kind: 1 });
        if (t.beamT <= 0) { t.beamT = 0.5; audio.sfx('laser', { gain: .28 }); }
        if (e.hp <= 0) killEnemy(e, t.ti);
        continue;
      }
      t.cd -= dt;
      const target = enemies[t.ti];
      t.ang = lerp(t.ang, t.ang + angleDiff(t.ang, Math.atan2(target.y - t.y, target.x - t.x)), 0.35);
      if (t.cd <= 0) { t.cd = def.rate[lv]; fire(t, i); }
    }
  }
  function angleDiff(a, b) { let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return d; }
  function updateBullets(dt) {
    for (let i = 0; i < MAXP; i++) {
      const b = bullets[i];
      if (!b.alive) continue;
      b.life -= dt;
      if (b.life <= 0) { b.alive = false; continue; }
      if (b.homing && b.ti >= 0) {
        const e = enemies[b.ti];
        if (!e.alive) { b.alive = false; continue; }
        const a = Math.atan2(e.y - b.y, e.x - b.x);
        b.vx = Math.cos(a) * b.spd; b.vy = Math.sin(a) * b.spd;
        if (Math.hypot(e.x - b.x, e.y - b.y) < b.spd * dt + e.r * 0.8 + 4) {
          hit(i, b, e, b.ti); continue;
        }
      } else if (b.ti < 0) {
        if (Math.hypot(b.tx - b.x, b.ty - b.y) < b.spd * dt + 6) { splashHit(i, b); continue; }
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (rng.chance(0.5)) particles.trail(b.x, b.y, b.col, b.r * 0.55);
    }
  }
  function hit(i, b, e, ei) {
    b.alive = false;
    if (b.slow > 0) {
      e.slowAmt = Math.max(e.slowAmt * (e.slowT > 0 ? 1 : 0), b.slow);
      e.slowT = Math.max(e.slowT, b.slowT);
      particles.burst(e.x, e.y, 6, { color: PALETTE.cyan, speed: 90, life: .5, size: 2.6, kind: 1 });
      addFx(e.x, e.y, e.r * 2, PALETTE.cyan, 0, 0.3);
    } else {
      particles.burst(e.x, e.y, 5, { color: b.col, speed: 130, life: .35, size: 2.4, kind: 1 });
    }
    audio.sfx('hit', { gain: b.slow > 0 ? .3 : .45 });
    damage(e, ei, b.dmg, false, b.col);
  }
  function splashHit(i, b) {
    b.alive = false;
    const R = b.splash;
    particles.explosion(b.x, b.y, R / cell, PALETTE.amber);
    addFx(b.x, b.y, R, PALETTE.amber, 0, 0.32);
    audio.sfx('explode', { gain: .6 }); shake.add(0.14);
    for (let k = 0; k < MAXE; k++) {
      const e = enemies[k];
      if (!e.alive) continue;
      const d = Math.hypot(e.x - b.x, e.y - b.y);
      if (d > R + e.r) continue;
      damage(e, k, b.dmg * (1 - 0.45 * (d / (R + e.r))), false, PALETTE.amber);
    }
  }
  function updateFx(dt) {
    for (let i = 0; i < FXP; i++) { if (!fx[i].alive) continue; fx[i].t += dt; if (fx[i].t >= fx[i].max) fx[i].alive = false; }
  }
  function updateSpawns(dt) {
    if (S.phase !== 'wave') return;
    spawnT += dt;
    while (sqI < sqN && sqAt[sqI] <= spawnT) {
      const ty = sqType[sqI++];
      spawnEnemy(ty === 'boss' ? 'normal' : ty, S.hpMul, ty === 'boss');
      S.spawned++;
    }
    if (sqI >= sqN && !anyEnemy()) {
      if (S.wave >= MAX_WAVE) { gameOver(true); return; }
      S.phase = 'prep'; S.prepT = 14;
      const bonus = 40 + S.wave * 6;
      S.gold += bonus;
      particles.text(ctx.W / 2, oy + cell * 3, '波次奖励 +' + bonus, PALETTE.lime);
      audio.sfx('confirm');
      ctx.hint('第 ' + S.wave + ' 波清空！准备下一波', 2400);
      dirty.hud = true; refreshUI();
    }
  }
  function anyEnemy() { for (let i = 0; i < MAXE; i++) if (enemies[i].alive) return true; return false; }
  function stepSim(dt) {
    S.t += dt;
    updateSpawns(dt);
    updateEnemies(dt);
    updateTowers(dt);
    updateBullets(dt);
    updateFx(dt);
  }
  function gameOver(win) {
    if (S.over) return;
    S.over = true; S.overT = 0;
    const value = win ? 1200 + S.gold + S.kills * 12 + S.lives * 60 : S.wave * 100 + S.kills * 12;
    if (value > S.best) { S.best = value; save.set('best', value); }
    audio.sfx(win ? 'win' : 'lose'); audio.duck(0.7, 1600);
    flash.add(0.4, win ? '#8dff4d' : '#ff4d5e');
    shake.add(0.9);
    ctx.vibrate(win ? PATTERNS.win : PATTERNS.lose);
    ctx.finish(value, {
      win,
      stats: [['波次', S.wave + ' / ' + MAX_WAVE], ['击杀', S.kills], ['剩余生命', S.lives], ['建塔', S.built]]
    });
  }
  // ---------- UI (DOM) ----------
  const dirty = { hud: true, ui: true };
  const root = document.createElement('div');
  root.style.cssText = 'pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:6px;background:none;padding:4px 6px 8px';
  function mkBtn(w, cls) {
    const b = document.createElement('button');
    b.className = 'btn ' + (cls || 'btn-ghost');
    b.style.cssText = 'pointer-events:auto;min-width:' + w + 'px;padding:7px 10px;font-size:12px;line-height:1.35;display:flex;flex-direction:column;align-items:center;gap:1px;transition:.15s';
    return b;
  }
  function attachHover(b, color) {
    ctx.listen(b, 'pointerenter', () => { b.style.borderColor = color; b.style.boxShadow = '0 0 14px ' + color + '66'; audio.sfx('hover', { gain: .5 }); });
    ctx.listen(b, 'pointerleave', () => { b.style.borderColor = ''; b.style.boxShadow = ''; });
  }
  // 选中塔面板
  const selRow = document.createElement('div');
  selRow.style.cssText = 'display:none;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;padding:6px 10px;border-radius:12px;background:rgba(8,12,24,.86);border:1px solid #243357';
  const selInfo = document.createElement('div');
  selInfo.style.cssText = 'font-size:12px;color:#eaf2ff;min-width:150px;text-align:center;font-weight:700';
  const btnUp = mkBtn(112, 'btn-primary');
  const btnSell = mkBtn(84, 'btn-danger');
  const btnMode = mkBtn(96);
  selRow.appendChild(selInfo); selRow.appendChild(btnUp); selRow.appendChild(btnMode); selRow.appendChild(btnSell);
  ctx.listen(btnUp, 'click', () => { if (S.sel >= 0) upgrade(S.sel); });
  ctx.listen(btnSell, 'click', () => { if (S.sel >= 0) sell(S.sel); });
  ctx.listen(btnMode, 'click', () => {
    if (S.sel < 0) return;
    const t = towers[S.sel];
    t.mode = MODES[(MODES.indexOf(t.mode) + 1) % MODES.length];
    audio.sfx('swap'); refreshUI();
  });
  attachHover(btnUp, PALETTE.cyan); attachHover(btnSell, PALETTE.red); attachHover(btnMode, PALETTE.violet);
  // 主工具条
  const toolBar = document.createElement('div');
  toolBar.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center';
  const towerBtns = [];
  for (const key of TOWER_ORDER) {
    const def = TOWERS[key];
    const b = mkBtn(78);
    b.style.borderColor = def.color + '77';
    b.innerHTML = '<span style="font-size:15px;color:' + def.color + '">' + def.icon + '</span>';
    ctx.listen(b, 'click', () => { S.selType = key; S.sel = -1; audio.sfx('select'); ctx.hint(def.name + '：' + def.tip, 2200); refreshUI(); });
    attachHover(b, def.color);
    towerBtns.push(b); toolBar.appendChild(b);
  }
  const btnWave = mkBtn(112, 'btn-primary');
  ctx.listen(btnWave, 'click', () => startWave(true));
  attachHover(btnWave, PALETTE.cyan);
  const btnSpeed = mkBtn(72);
  ctx.listen(btnSpeed, 'click', () => { S.speed = S.speed === 1 ? 2 : 1; audio.sfx('tick'); dirty.hud = true; refreshUI(); });
  attachHover(btnSpeed, PALETTE.amber);
  toolBar.appendChild(btnWave); toolBar.appendChild(btnSpeed);
  root.appendChild(selRow); root.appendChild(toolBar);
  ctx.overlay(root);
  function refreshUI() {
    for (let i = 0; i < TOWER_ORDER.length; i++) {
      const key = TOWER_ORDER[i], def = TOWERS[key], b = towerBtns[i];
      const afford = S.gold >= def.cost[0];
      b.innerHTML = '<span style="font-size:15px;color:' + def.color + '">' + def.icon + '</span>' +
        '<span style="font-size:11px;color:' + (afford ? '#eaf2ff' : '#7d8db3') + '">' + def.name + ' <b style="color:' + (afford ? PALETTE.amber : PALETTE.red) + '">' + def.cost[0] + '</b></span>';
      b.style.opacity = S.selType === key ? '1' : '.82';
      b.style.borderColor = S.selType === key ? def.color : def.color + '55';
      b.style.background = S.selType === key ? def.color + '22' : 'rgba(14,20,38,.7)';
    }
    btnSpeed.innerHTML = '<span style="font-size:13px;color:' + PALETTE.amber + '">' + S.speed + 'x</span><span style="font-size:10px;color:#7d8db3">速度 F</span>';
    if (S.phase === 'wave') {
      btnWave.innerHTML = '<span style="font-size:13px;color:#7d8db3">进行中</span><span style="font-size:10px">第 ' + S.wave + ' 波</span>';
      btnWave.disabled = true; btnWave.style.opacity = '.6';
    } else {
      btnWave.disabled = false; btnWave.style.opacity = '1';
      btnWave.innerHTML = '<span style="font-size:13px;color:' + PALETTE.lime + '">下一波</span><span style="font-size:10px;color:#7d8db3">' + Math.ceil(S.prepT) + 's</span>';
    }

    if (S.sel >= 0 && towers[S.sel].alive) {
      const t = towers[S.sel], def = TOWERS[t.type], lv = t.level - 1;
      selRow.style.display = 'flex';
      const dps = t.type === 'laser' ? def.dps[lv] : def.dmg[lv] / def.rate[lv];

      selInfo.innerHTML = '<span style="color:' + def.color + '">' + def.name + ' Lv.' + t.level + '</span><br>' +

        '<span style="font-size:10px;color:#7d8db3">DPS ' + dps.toFixed(1) + ' · 射程 ' + def.range[lv].toFixed(1) + ' · 击杀 ' + t.kills + '</span>';
      if (t.level >= 3) { btnUp.innerHTML = '<span style="font-size:12px;color:#8dff4d">满级</span>'; btnUp.disabled = true; btnUp.style.opacity = '.55'; } else {
        btnUp.disabled = false; btnUp.style.opacity = '1';
        btnUp.innerHTML = '<span style="font-size:12px;color:' + PALETTE.cyan + '">升级 ' + def.cost[t.level] + '</span><span style="font-size:10px;color:#7d8db3">U 键</span>';
      }
      btnSell.innerHTML = '<span style="font-size:12px;color:' + PALETTE.red + '">出售 +' + Math.floor(t.spent * 0.6) + '</span>';
      btnMode.innerHTML = '<span style="font-size:12px;color:#a855f7">目标:' + MODE_NAME[t.mode] + '</span>';
    } else {
      selRow.style.display = 'none'; S.sel = -1;
    }
  }
  // ---------- 输入 ----------
  input.on((e) => {
    if (e.type !== 'key' || S.over) return;
    switch (e.code) {
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': {
        const k = TOWER_ORDER[+e.code.slice(5) - 1];
        if (k) { S.selType = k; S.sel = -1; audio.sfx('select'); refreshUI(); }
        break;
      }
      case 'KeyF': S.speed = S.speed === 1 ? 2 : 1; audio.sfx('tick'); dirty.hud = true; refreshUI(); break;
      case 'KeyU': if (S.sel >= 0) upgrade(S.sel); break;
      case 'KeyT': if (S.sel >= 0) { const t = towers[S.sel]; t.mode = MODES[(MODES.indexOf(t.mode) + 1) % MODES.length]; audio.sfx('swap'); refreshUI(); } break;
      case 'KeyS': if (S.sel >= 0) sell(S.sel); break;
      case 'Escape': S.sel = -1; refreshUI(); break;
    }
  });
  function handlePointer() {
    const p = input.pointer;
    const cx = Math.floor((p.x - ox) / cell), cy = Math.floor((p.y - oy) / cell);
    S.hoverX = cx; S.hoverY = cy;
    if (!p.justDown || S.over) return;
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) { if (S.sel >= 0) { S.sel = -1; refreshUI(); } return; }
    const i = cy * COLS + cx;
    const ti = towerAt[i];
    if (ti >= 0) { selectTower(ti); audio.sfx('select'); return; }
    if (grid[i] === 0 && canBuildAt(cx, cy) && S.selType) tryBuild(cx, cy);
    else if (grid[i] === 0) {
      // 不可建造：区分「有塔/起终点」与「会封死」
      if ((cx === SX && cy === SY) || (cx === EX && cy === EY)) deny('起终点不可建造');
      else deny('这里会把路封死！');
      addFx(cxc(cx), cyc(cy), cell * 0.5, PALETTE.red, 0, 0.35);
    }
  }
  // ---------- 更新 ----------
  function update(dt) {
    handlePointer();
    if (input.consume('jump', 140)) { if (S.phase === 'prep') startWave(true); }
    if (S.over) { S.overT += dt; return; }
    if (S.phase === 'prep') {
      S.prepT -= dt;
      if (Math.ceil(S.prepT) !== Math.ceil(S.prepT + dt)) refreshUI();
      if (S.prepT <= 0) startWave(false);
    }
    for (let i = 0; i < S.speed; i++) stepSim(dt);
    if (dirty.hud) { updateHud(); dirty.hud = false; }
  }
  function updateHud() {
    ctx.hud('gold', '金币', fmtNum(S.gold), { color: PALETTE.amber });
    ctx.hud('life', '生命', S.lives, { color: S.lives <= 5 ? PALETTE.red : PALETTE.green });
    ctx.hud('wave', '波次', S.wave + ' / ' + MAX_WAVE, { color: PALETTE.cyan });
    ctx.hud('speed', '速度', S.speed + 'x');
  }
  updateHud(); refreshUI(); refreshField();
  // ---------- 渲染 ----------
  function drawBoard(c) {
    const w = cell * COLS, h = cell * ROWS;
    c.save();
    c.translate(ox, oy);
    c.fillStyle = '#080d1a';
    roundRect(c, -5, -5, w + 10, h + 10, 10); c.fill();
    c.strokeStyle = 'rgba(34,224,255,.18)'; c.lineWidth = 1.5; c.stroke();
    drawGrid(c, w, h, cell, 'rgba(70,110,180,.10)', 1, 0, 0);
    // 通路底色
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const d = dist[y * COLS + x];
        if (d < 0) continue;
        c.fillStyle = 'rgba(34,224,255,.045)';
        c.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
      }
    }
    // 路径流光
    if (pathN > 1) {
      c.save();
      c.setLineDash([9, 11]); c.lineDashOffset = -S.t * 34;
      neon(c, (cc) => {
        cc.moveTo(pathX[0], pathY[0]);
        for (let i = 1; i < pathN; i++) cc.lineTo(pathX[i], pathY[i]);
      }, PALETTE.cyan, { glow: 10, width: 2.4, alpha: .45, layers: 2, inner: null });
      c.setLineDash([]);
      c.restore();
    }
    // 起点 / 终点
    const sp = 1 + Math.sin(S.t * 4) * .12;
    glowCircle(c, cxc(SX), cyc(SY), cell * 0.36 * sp, PALETTE.lime, { glow: 16, width: 2, fill: 'rgba(141,255,77,.14)' });
    text(c, '入口', cxc(SX), cyc(SY) + cell * .72, { size: 9, color: PALETTE.dim });
    glowCircle(c, cxc(EX), cyc(EY), cell * 0.42, PALETTE.magenta, { glow: 18, width: 2.4, fill: 'rgba(255,46,136,.16)' });
    text(c, '核心', cxc(EX), cyc(EY) - cell * .68, { size: 10, color: PALETTE.magenta, glow: 8 });
    // 建造预览
    if (!S.over && S.hoverX >= 0 && S.hoverX < COLS && S.hoverY >= 0 && S.hoverY < ROWS) {
      const i = S.hoverY * COLS + S.hoverX;
      const hx = S.hoverX * cell, hy = S.hoverY * cell;
      if (grid[i] === 1) {
        c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1.5;
        roundRect(c, hx + 2, hy + 2, cell - 4, cell - 4, 4); c.stroke();
      } else if (S.selType) {
        const def = TOWERS[S.selType];
        const ok = canBuildAt(S.hoverX, S.hoverY) && S.gold >= def.cost[0];
        const col = ok ? def.color : PALETTE.red;
        c.fillStyle = ok ? col + '22' : 'rgba(255,77,94,.18)';
        c.fillRect(hx + 1, hy + 1, cell - 2, cell - 2);
        c.strokeStyle = col; c.lineWidth = 1.6;
        roundRect(c, hx + 1.5, hy + 1.5, cell - 3, cell - 3, 4); c.stroke();
        if (ok) glowCircle(c, cxc(S.hoverX), cyc(S.hoverY), def.range[0] * cell, def.color, { glow: 10, width: 1.4, alpha: .5 });
      }
    }
    // 选中塔射程
    if (S.sel >= 0 && towers[S.sel].alive) {
      const t = towers[S.sel], def = TOWERS[t.type];
      glowCircle(c, t.x, t.y, def.range[t.level - 1] * cell, def.color, { glow: 12, width: 1.6, alpha: .6 });
      c.save();
      c.setLineDash([6, 8]); c.lineDashOffset = S.t * 20;
      c.strokeStyle = def.color + 'aa'; c.lineWidth = 2;
      roundRect(c, t.cx * cell + 2, t.cy * cell + 2, cell - 4, cell - 4, 5); c.stroke();
      c.restore();
    }
    // 塔
    for (let i = 0; i < MAXT; i++) if (towers[i].alive) drawTower(c, towers[i]);
    // 敌人
    for (let i = 0; i < MAXE; i++) if (enemies[i].alive) drawEnemy(c, enemies[i]);
    // 子弹
    for (let i = 0; i < MAXP; i++) {
      const b = bullets[i];
      if (!b.alive) continue;
      glowCircle(c, b.x, b.y, b.r, b.col, { glow: 8, width: 1.2, alpha: .9, fill: b.col + '55' });
    }
    // 激光
    for (let i = 0; i < MAXT; i++) {
      const t = towers[i];
      if (!t.alive || t.type !== 'laser' || t.ti < 0) continue;
      const e = enemies[t.ti];
      if (!e.alive) continue;
      const w2 = 2.2 + Math.sin(S.t * 40) * .8;
      neon(c, (cc) => { cc.moveTo(t.x, t.y); cc.lineTo(e.x, e.y); }, PALETTE.magenta, { glow: 16, width: w2, alpha: .95, layers: 3, inner: '#fff' });
      glowCircle(c, e.x, e.y, e.r * (1.1 + Math.sin(S.t * 30) * .12), '#fff', { glow: 12, width: 1, alpha: .5 });
    }
    // 特效
    for (let i = 0; i < FXP; i++) {
      const f = fx[i];
      if (!f.alive) continue;
      const p = f.t / f.max;
      c.save(); c.globalAlpha = (1 - p) * 0.8;
      c.strokeStyle = f.col; c.lineWidth = 2;
      c.beginPath(); c.arc(f.x, f.y, f.r * (0.4 + p * 0.8), 0, TAU); c.stroke();
      c.restore();
    }
    c.restore();
  }
  function drawTower(c, t) {
    const def = TOWERS[t.type], lv = t.level - 1;
    const s = cell * 0.40;
    c.save();
    c.translate(t.x, t.y);
    // 底座
    c.fillStyle = 'rgba(11,18,34,.94)';
    roundRect(c, -cell * 0.44, -cell * 0.44, cell * 0.88, cell * 0.88, 6); c.fill();
    c.strokeStyle = def.color + '55'; c.lineWidth = 1; c.stroke();
    const grow = clamp((S.t - t.born) * 5, 0.4, 1);
    c.scale(grow, grow);
    c.save();
    c.rotate(t.ang);
    c.fillStyle = def.color;
    if (t.type === 'arrow') {
      c.beginPath(); c.moveTo(s * .9, 0); c.lineTo(-s * .55, -s * .62); c.lineTo(-s * .25, 0); c.lineTo(-s * .55, s * .62); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1;
      c.beginPath(); c.arc(0, 0, s * .82, -0.9, 0.9); c.stroke();
    } else if (t.type === 'cannon') {
      c.beginPath(); c.arc(0, 0, s * .62, 0, TAU); c.fill();
      c.fillRect(0, -s * .22, s * 1.15, s * .44);
      c.fillStyle = '#0a1020'; c.beginPath(); c.arc(0, 0, s * .26, 0, TAU); c.fill();
    } else if (t.type === 'frost') {
      c.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6; const x = Math.cos(a) * s * .82, y = Math.sin(a) * s * .82; i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.closePath(); c.fill();
      c.strokeStyle = '#ffffffcc'; c.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI / 3 + S.t * 0.8;
        c.beginPath(); c.moveTo(-Math.cos(a) * s * .6, -Math.sin(a) * s * .6); c.lineTo(Math.cos(a) * s * .6, Math.sin(a) * s * .6); c.stroke();
      }
    } else {
      c.beginPath(); c.arc(0, 0, s * .68, 0, TAU); c.fill();
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(0, 0, s * (.24 + lv * .05), 0, TAU); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 1;
      c.beginPath(); c.arc(0, 0, s * .95, t.ang - 0.6, t.ang + 0.6); c.stroke();
    }
    c.restore();
    c.restore();
    // 等级点
    for (let i = 0; i < t.level; i++) {
      c.fillStyle = def.color;
      c.fillRect(t.x - cell * 0.2 + i * 6, t.y + cell * 0.34, 4, 3);
    }
    // 冰环
    if (t.type === 'frost') {
      c.save(); c.globalAlpha = .18; c.strokeStyle = PALETTE.cyan; c.lineWidth = 1;
      c.beginPath(); c.arc(t.x, t.y, TOWERS.frost.range[lv] * cell * 0.75, 0, TAU); c.stroke(); c.restore();
    }
  }
  function drawEnemy(c, e) {
    const r = e.r;
    c.save();
    c.translate(e.x, e.y);
    if (e.fly) c.translate(0, -cell * 0.12 + Math.sin(e.wob) * 2);
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.beginPath(); c.ellipse(0, r * 0.75, r * 0.9, r * 0.35, 0, 0, TAU); c.fill();
    const col = e.hitFx > 0 ? '#ffffff' : (e.boss ? PALETTE.magenta : ENEMIES[e.type].color);
    if (e.boss) {
      c.save(); c.rotate(S.t * 0.6); c.strokeStyle = col + '77'; c.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6;
        c.beginPath(); c.moveTo(Math.cos(a) * r * .8, Math.sin(a) * r * .8); c.lineTo(Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5); c.stroke();
      }
      c.restore();
    }
    c.fillStyle = col;
    c.beginPath();
    if (e.type === 'tank') { roundRect(c, -r, -r * .85, r * 2, r * 1.7, 4); c.fill(); }
    else if (e.type === 'fast') { c.moveTo(r, 0); c.lineTo(-r * .8, -r * .8); c.lineTo(-r * .4, 0); c.lineTo(-r * .8, r * .8); c.closePath(); c.fill(); }
    else if (e.type === 'fly') { c.ellipse(0, 0, r * 1.15, r * .7, 0, 0, TAU); c.fill(); }
    else if (e.type === 'heal') { c.arc(0, 0, r, 0, TAU); c.fill(); c.fillStyle = '#04121c'; c.fillRect(-r * .55, -r * .16, r * 1.1, r * .32); c.fillRect(-r * .16, -r * .55, r * .32, r * 1.1); }
    else { c.arc(0, 0, r, 0, TAU); c.fill(); }
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1; c.stroke();
    if (e.slowT > 0 || e.laserT > 0) {
      c.globalAlpha = .5; c.strokeStyle = PALETTE.cyan; c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, r * 1.35, 0, TAU); c.stroke(); c.globalAlpha = 1;
    }
    c.restore();
    const bh = e.boss ? 5 : 3.5, bw = Math.max(cell * .5, r * 2.2);
    bar(c, e.x - bw / 2, e.y - r - 9, bw, bh, e.hp / e.maxHp, {
      bg: 'rgba(0,0,0,.55)', fill: e.hp / e.maxHp > .5 ? PALETTE.green : e.hp / e.maxHp > .22 ? PALETTE.amber : PALETTE.red
    });
    if (e.armor > 0 && !e.boss) text(c, '🛡', e.x + bw / 2 + 6, e.y - r - 7, { size: 8, color: PALETTE.dim });
  }
  function render(alpha, rdt) {
    const c = ctx.ctx, W = ctx.W, H = ctx.H;
    c.fillStyle = PALETTE.bg;
    c.fillRect(0, 0, W, H);
    c.save();
    shake.apply(c);
    drawBoard(c);
    particles.renderTexts(c, rdt);
    c.restore();
    // 顶部波次进度
    if (S.phase === 'wave') {
      const total = sqN, done = sqI;
      bar(c, W / 2 - 90, 26, 180, 5, total ? done / total : 0, { fill: PALETTE.magenta, bg: 'rgba(255,255,255,.09)' });
      text(c, '第 ' + S.wave + ' 波 · ' + done + '/' + total, W / 2, 16, { size: 11, color: PALETTE.dim, baseline: 'top' });
    } else if (!S.over) {
      text(c, '准备中 ' + Math.max(0, Math.ceil(S.prepT)) + 's　（空格开波有奖励）', W / 2, 16, { size: 11, color: PALETTE.lime, baseline: 'top' });
    }
    if (S.over) {
      c.fillStyle = 'rgba(4,7,16,.6)'; c.fillRect(0, 0, W, H);
      text(c, S.lives > 0 ? '防线守住！' : '核心被攻破', W / 2, H / 2, {
        size: Math.min(44, W * .09), color: S.lives > 0 ? PALETTE.lime : PALETTE.red, weight: 900, glow: 20
      });
    }
    vignette(c, W, H, .38);
  }
  // ---------- 生命周期 ----------
  return {
    update, render,
    resize(w, h) { layout(w, h); refreshField(); refreshUI(); },
    pause() { audio.duck(0.5, 2000); },
    resume() { }
  };
}