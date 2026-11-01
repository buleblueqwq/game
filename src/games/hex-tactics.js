// 六边形战棋 —— 地形 / 移动力 flood-fill / 命中率 / 技能冷却 / AI 评分决策 / 据点胜利
import { clamp, lerp, TAU, fmtNum } from '../core/math.js';
import { PALETTE, neon, glowCircle, hexPath, roundRect, text, bar, panel, vignette } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'hex-tactics',
  title: '六边形战棋',
  category: 'strategy',
  difficulty: 4,
  music: 'tense',
  howto: [
    '点自己的单位选中 → 点高亮格移动 → 点敌人攻击（悬停可看命中率与伤害）',
    'Q = 技能　空格 = 该单位待机　回车 = 结束回合　右键/ESC = 取消',
    '森林 +30% 闪避，山地 +50% 防御且挡视线，据点站上去回血并得分'
  ],
  particles: 1200
};
export const musicTrack = 'tense';

const COLS = 12, ROWS = 9, NC = COLS * ROWS;
const T_PLAIN = 0, T_FOREST = 1, T_MOUNTAIN = 2, T_WATER = 3, T_POINT = 4;
const TER = [
  { name: '平原', cost: 1, dodge: 0, def: 0, col: '#16203a', edge: '#2b3a63' },
  { name: '森林', cost: 2, dodge: .30, def: .10, col: '#123a2c', edge: '#2f7a55' },
  { name: '山地', cost: 3, dodge: 0, def: .50, col: '#33283f', edge: '#7d5ba8' },
  { name: '水域', cost: 99, dodge: 0, def: 0, col: '#0d2444', edge: '#2a5fa8' },
  { name: '据点', cost: 1, dodge: 0, def: .05, col: '#3a3218', edge: '#ffb020' }
];

const KINDS = {
  warrior: { name: '战士', glyph: '⚔', hp: 130, atk: [22, 30], mov: 4, range: 1, def: .10, col: PALETTE.cyan,
    skill: { name: '重击', cd: 3, range: 1, dmg: [40, 52], kind: 'strike', desc: '对相邻敌人造成 40~52 重击' } },
  archer: { name: '弓手', glyph: '➶', hp: 85, atk: [18, 25], mov: 5, range: 3, def: .02, col: PALETTE.lime,
    skill: { name: '穿透箭', cd: 3, range: 4, dmg: [26, 34], kind: 'line', desc: '直线 4 格穿透，26~34 伤害' } },
  mage: { name: '法师', glyph: '✵', hp: 74, atk: [16, 23], mov: 4, range: 2, def: .02, col: PALETTE.violet,
    skill: { name: '陨星', cd: 3, range: 4, dmg: [34, 44], radius: 1, kind: 'aoe', desc: '半径 1 范围爆破，34~44 伤害' } },
  priest: { name: '牧师', glyph: '✚', hp: 82, atk: [10, 15], mov: 4, range: 2, def: .04, col: PALETTE.green,
    skill: { name: '治疗', cd: 2, range: 3, heal: 48, kind: 'heal', desc: '治疗 3 格内友军 48 生命' } }
};
const ORDER = ['warrior', 'archer', 'mage', 'priest'];
const MAX_TURN = 24, HOLD_NEED = 3;

export function create(ctx) {
  const { input, audio, particles, shake, flash, rng, noise, save } = ctx;

  // ---------- 布局 ----------
  let R = 26, ox = 0, oy = 0, hw = 0, hh = 0;
  function layout(w, h) {
    const topPad = 48, botPad = h > 620 ? 116 : 96;
    const sq3 = Math.sqrt(3);
    R = Math.max(11, Math.min((w - 24) / ((COLS + 0.5) * sq3), (h - topPad - botPad) / (ROWS * 1.5 + 0.5)));
    hw = sq3 * R; hh = 2 * R;
    const bw = hw * (COLS + 0.5), bh = R * (1.5 * ROWS + 0.5);
    ox = Math.round((w - bw) / 2) + hw / 2;
    oy = Math.round(topPad + Math.max(0, (h - topPad - botPad - bh) / 2)) + R;
  }
  layout(ctx.W, ctx.H);
  const HX = new Float32Array(NC), HY = new Float32Array(NC);
  function rebuildCenters() {
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col;
      HX[i] = ox + (col + (row & 1) * 0.5) * hw;
      HY[i] = oy + row * 1.5 * R;
    }
  }
  rebuildCenters();

  // ---------- 邻接（offset odd-r <-> axial）----------
  const NEIGH = new Int16Array(NC * 6).fill(-1);
  function buildNeigh() {
    const DQ = [1, 1, 0, -1, -1, 0], DR = [0, -1, -1, 0, 1, 1];
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col;
      const q = col - ((row - (row & 1)) >> 1), r = row;
      for (let k = 0; k < 6; k++) {
        const nq = q + DQ[k], nr = r + DR[k];
        const ncol = nq + ((nr - (nr & 1)) >> 1), nrow = nr;
        NEIGH[i * 6 + k] = (ncol < 0 || ncol >= COLS || nrow < 0 || nrow >= ROWS) ? -1 : nrow * COLS + ncol;
      }
    }
  }
  buildNeigh();
  function hexDist(a, b) {
    const qa = (a % COLS) - (((a / COLS) | 0) - (((a / COLS) | 0) & 1)) / 2, ra = (a / COLS) | 0;
    const qb = (b % COLS) - (((b / COLS) | 0) - (((b / COLS) | 0) & 1)) / 2, rb = (b / COLS) | 0;
    const dq = qa - qb, dr = ra - rb;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
  }

  // ---------- 地图 ----------
  const terr = new Uint8Array(NC);
  const unitAt = new Int16Array(NC).fill(-1);
  function genMap() {
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      const n = noise.fbm(col * 0.42 + 3.1, row * 0.42 + 7.7, 3);
      let t = T_PLAIN;
      if (n < -0.26) t = T_WATER;
      else if (n > 0.30) t = T_MOUNTAIN;
      else if (n > 0.04) t = T_FOREST;
      terr[row * COLS + col] = t;
    }
    // 出生区保持可通行
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      if (col > 1 && col < COLS - 2) continue;
      const i = row * COLS + col;
      if (terr[i] === T_WATER || terr[i] === T_MOUNTAIN) terr[i] = T_PLAIN;
    }
    // 3 个据点
    const spots = [[4, 1], [4, 7], [7, 4]];
    for (const [c, r] of spots) { terr[r * COLS + c] = T_POINT; }
  }
  genMap();

  // ---------- 单位 ----------
  const MAXU = 12;
  const units = [];
  for (let i = 0; i < MAXU; i++) units.push({
    alive: false, side: 0, kind: 'warrior', idx: 0, hp: 1, maxHp: 1, cd: 0, moved: false, acted: false,
    done: false, x: 0, y: 0, sx: 0, sy: 0, anim: 0, animT: 0, animMax: 0, path: new Int16Array(40),
    pathN: 0, pathI: 0, tx: 0, ty: 0, flash: 0, planT: -1, planPathN: 0, planned: false, attacked: false,
    plan: new Int16Array(40), planSkill: false, pendingAuto: false, hitDone: false, slot: i, actionKind: 'atk'
  });
  const START = { p: [[0, 2], [0, 4], [1, 3], [1, 5]], e: [[11, 2], [11, 4], [10, 3], [10, 5]] };
  function makeUnit(side, kind, col, row, slot) {
    const u = units[slot], d = KINDS[kind], i = row * COLS + col;
    u.alive = true; u.side = side; u.kind = kind; u.idx = i;
    u.maxHp = d.hp; u.hp = d.hp; u.cd = 0; u.moved = false; u.acted = false; u.done = false;
    u.x = HX[i]; u.y = HY[i]; u.anim = 0; u.animT = 0; u.flash = 0;
    u.planT = -1; u.planPathN = 0; u.planned = false; u.attacked = false; u.slot = slot;
    u.planSkill = false; u.pendingAuto = false; u.hitDone = false;
    unitAt[i] = slot;
    return u;
  }
  for (let k = 0; k < 4; k++) { makeUnit(0, ORDER[k], START.p[k][0], START.p[k][1], k); makeUnit(1, ORDER[k], START.e[k][0], START.e[k][1], 4 + k); }

  // ---------- 状态 ----------
  const S = {
    phase: 'player', turn: 1, sel: -1, hover: -1, hoverUnit: -1, mode: 'normal',
    t: 0, over: false, holdCount: 0, score: 0, kills: 0, aiT: 0, aiIdx: 4,
    best: save.get('best', 0), msg: '', msgT: 0, action: null, result: null
  };
  // flood-fill 结果
  const reach = new Uint8Array(NC), cost = new Int16Array(NC), fromI = new Int16Array(NC);
  const atkCells = new Uint8Array(NC);
  const skillCells = new Uint8Array(NC);
  const tmpPath = new Int16Array(40);
  const PV = { acc: 0, min: 0, max: 0, blocked: false, lethal: false };

  // ---------- 地形 / 战斗公式 ----------
  function terrDef(u) { return TER[terr[u.idx]].def; }
  function dodge(u) { return TER[terr[u.idx]].dodge; }
  function elev(u) { return terr[u.idx] === T_MOUNTAIN ? 1 : 0; }
  function walkable(i) { return terr[i] !== T_WATER && unitAt[i] < 0; }
  function baseAcc(a, d) { return 92 + (elev(a) - elev(d)) * 15 - dodge(d) * 100; }

  /** 视线：山体阻挡远程 */
  function losBlocked(a, b) {
    const ia = a.idx, ib = b.idx;
    if (elev(a) || elev(b)) return false;
    for (let k = 1; k < 8; k++) {
      const t = k / 8;
      const x = lerp(HX[ia], HX[ib], t), y = lerp(HY[ia], HY[ib], t);
      let bi = -1, bd = 1e9;
      for (let i = 0; i < NC; i++) { const d = (HX[i] - x) * (HX[i] - x) + (HY[i] - y) * (HY[i] - y); if (d < bd) { bd = d; bi = i; } }
      if (bi !== ia && bi !== ib && terr[bi] === T_MOUNTAIN) return true;
    }
    return false;
  }
  function preview(a, d, dmg) {
    PV.blocked = hexDist(a.idx, d.idx) > 1 && losBlocked(a, d);
    PV.acc = clamp(baseAcc(a, d) - (PV.blocked ? 60 : 0), 5, 99);
    const red = 1 - clamp(KINDS[d.kind].def + terrDef(d) + (d.kind === 'warrior' ? 0 : 0), 0, .8);
    PV.min = Math.max(1, Math.round(dmg[0] * red));
    PV.max = Math.max(1, Math.round(dmg[1] * red));
    PV.lethal = PV.max >= d.hp;
    return PV;
  }

  // ---------- flood-fill（移动力）----------
  function floodFill(u) {
    reach.fill(0); cost.fill(999);
    const start = u.idx, budget = KINDS[u.kind].mov;
    cost[start] = 0; reach[start] = 1; fromI[start] = -1;
    for (let iter = 0; iter < 12; iter++) {
      let changed = false;
      for (let i = 0; i < NC; i++) {
        if (!reach[i]) continue;
        const c = cost[i];
        for (let k = 0; k < 6; k++) {
          const n = NEIGH[i * 6 + k];
          if (n < 0 || terr[n] === T_WATER) continue;
          if (unitAt[n] >= 0 && units[unitAt[n]].side !== u.side) continue;   // 敌军阻挡
          const nc = c + TER[terr[n]].cost;
          if (nc <= budget && nc < cost[n]) { cost[n] = nc; reach[n] = 1; fromI[n] = i; changed = true; }
        }
      }
      if (!changed) break;
    }
    // 有人占据的格子不可停留
    for (let i = 0; i < NC; i++) if (i !== start && unitAt[i] >= 0) reach[i] = 0;
    reach[start] = 1;
  }
  function buildPath(u, target, out) {
    let n = 0, cur = target;
    while (cur >= 0 && n < 40) { out[n++] = cur; cur = fromI[cur]; }
    for (let i = 0; i < n; i++) tmpPath[i] = out[n - 1 - i];   // 反向：起点 -> 终点
    for (let i = 0; i < n; i++) out[i] = tmpPath[i];
    return n;
  }
  function markAttack(u, range, arr) {
    arr.fill(0);
    for (let i = 0; i < NC; i++) if (hexDist(u.idx, i) <= range) arr[i] = 1;
  }
  function checkEnd() {
    updateHud();
    if (S.over) return;
    if (!aliveSide(1)) finish(true); else if (!aliveSide(0)) finish(false);
  }

  // ---------- 动作 ----------
  function startMove(u, path, n) {
    if (n <= 1) { u.moved = true; u.anim = 0; return; }
    for (let i = 0; i < n; i++) u.path[i] = path[i];
    u.pathN = n; u.pathI = 1;
    u.sx = u.x; u.sy = u.y;
    u.anim = 1; u.animT = 0; u.animMax = 0.14 * (n - 1);
    audio.sfx('dash', { gain: .5 });
    ctx.vibrate(PATTERNS.step);
  }
  function startAttack(u, ti, kind) {
    const d = units[ti];
    u.anim = 2; u.animT = 0; u.animMax = kind === 'aoe' || kind === 'heal' ? 0.55 : 0.42;
    u.sx = u.x; u.sy = u.y; u.tx = d.x; u.ty = d.y;
    u.planT = ti; u.attacked = true; u.actionKind = kind || 'atk';
  }
  function applyAction(u) {
    const kind = u.actionKind, d = units[u.planT];
    if (kind === 'heal') {
      if (d && d.alive) {
        d.hp = Math.min(d.maxHp, d.hp + KINDS[u.kind].skill.heal);
        particles.burst(d.x, d.y, 18, { color: PALETTE.green, speed: 120, life: .7, size: 3 });
        particles.ring(d.x, d.y, PALETTE.green, R * 1.2);
        audio.sfx('heal'); ctx.vibrate(PATTERNS.select);
        note(KINDS[u.kind].name + ' 治疗 ' + KINDS[d.kind].name);
      }
      return;
    }
    if (kind === 'aoe') {
      const sk = KINDS[u.kind].skill, ci = d ? d.idx : u.idx;
      particles.explosion(HX[ci], HY[ci], 1.4, PALETTE.violet);
      particles.ring(HX[ci], HY[ci], PALETTE.violet, R * 2.2);
      audio.sfx('explode'); shake.add(0.5); flash.add(0.18, '#a855f7');
      ctx.vibrate(PATTERNS.explode);
      for (let k = 0; k < MAXU; k++) {
        const o = units[k];
        if (!o.alive || o.side === u.side) continue;
        if (hexDist(o.idx, ci) > sk.radius) continue;
        hitUnit(u, o, sk.dmg, 1);
      }
      return;
    }
    if (kind === 'line') {
      const sk = KINDS[u.kind].skill;
      const a = Math.atan2(u.ty - u.sy, u.tx - u.sx);
      particles.ring(u.sx, u.sy, PALETTE.lime, R);
      addBeam(u.sx, u.sy, u.sx + Math.cos(a) * R * 8, u.sy + Math.sin(a) * R * 8, PALETTE.lime);
      audio.sfx('laser');
      for (let k = 0; k < MAXU; k++) {
        const o = units[k];
        if (!o.alive || o.side === u.side) continue;
        if (hexDist(o.idx, u.idx) > sk.range) continue;
        // 近似：与射线夹角小于 22° 视为命中
        const ang = Math.atan2(o.y - u.sy, o.x - u.sx);
        let diff = Math.abs(((ang - a + Math.PI) % TAU + TAU) % TAU - Math.PI);
        if (diff < 0.42) hitUnit(u, o, sk.dmg, 1);
      }
      return;
    }
    if (kind === 'strike') { hitUnit(u, d, KINDS[u.kind].skill.dmg, 1); return; }
    // 普通攻击
    hitUnit(u, d, KINDS[u.kind].atk, 0);
    // 近战反击
    if (d && d.alive && KINDS[d.kind].range === 1 && hexDist(d.idx, u.idx) === 1 && rng.chance(0.75)) {
      const cd = KINDS[d.kind].atk;
      hitUnit(d, u, [cd[0] * 0.6, cd[1] * 0.6], 0, true);
    }
  }
  function hitUnit(a, d, dmg, noMiss, counter) {
    if (!d || !d.alive) return;
    const acc = noMiss ? 100 : baseAcc(a, d) - (hexDist(a.idx, d.idx) > 1 && losBlocked(a, d) ? 60 : 0);
    if (!rng.chance(clamp(acc, 5, 99) / 100)) {
      particles.text(d.x, d.y - R, 'MISS', PALETTE.dim);
      audio.sfx('swap', { gain: .5 });
      return;
    }
    const red = 1 - clamp(KINDS[d.kind].def + terrDef(d), 0, .82);
    const dmgv = Math.max(1, Math.round(rng.range(dmg[0], dmg[1]) * red));
    d.hp -= dmgv; d.flash = 0.25;
    particles.burst(d.x, d.y, 12, { color: counter ? PALETTE.amber : PALETTE.red, speed: 160, life: .45, size: 3, kind: 1 });
    particles.text(d.x, d.y - R * .8, '-' + dmgv, counter ? PALETTE.amber : PALETTE.red);
    audio.sfx('hit'); shake.add(0.2);
    ctx.vibrate(PATTERNS.hit);
    if (!counter) addBeam(a.sx, a.sy, d.x, d.y, KINDS[a.kind].col);
    if (a.side === 0) S.score += dmgv;
    if (d.hp <= 0) killUnit(d);
  }
  function killUnit(d) {
    d.alive = false;
    if (unitAt[d.idx] === d.slot) unitAt[d.idx] = -1;
    if (d.side === 1) { S.kills++; S.score += 120; }
    particles.explosion(d.x, d.y, 1.2, d.side === 0 ? PALETTE.red : PALETTE.cyan);
    audio.sfx('die'); shake.add(0.45);
    ctx.vibrate(PATTERNS.explode);
    note(KINDS[d.kind].name + ' 阵亡');
    checkEnd();
  }
  // 光束 / 冲击特效
  const MAXB = 12, beams = [];
  for (let i = 0; i < MAXB; i++) beams.push({ alive: false, x1: 0, y1: 0, x2: 0, y2: 0, col: '#fff', t: 0, max: .28 });
  function addBeam(x1, y1, x2, y2, col) {
    for (let i = 0; i < MAXB; i++) {
      if (beams[i].alive) continue;
      beams[i].alive = true; beams[i].x1 = x1; beams[i].y1 = y1; beams[i].x2 = x2; beams[i].y2 = y2;
      beams[i].col = col; beams[i].t = 0;
      return;
    }
  }
  function note(msg) { S.msg = msg; S.msgT = 2.4; }

  // ---------- 回合流程 ----------
  function aliveSide(side) {
    for (let i = 0; i < MAXU; i++) if (units[i].alive && units[i].side === side) return true;
    return false;
  }
  function beginPlayerTurn() {
    S.phase = 'player';
    for (let i = 0; i < MAXU; i++) {
      const u = units[i];
      if (!u.alive) continue;
      if (u.side === 0) { u.moved = false; u.acted = false; u.done = false; u.planned = false; u.attacked = false; }
      if (u.cd > 0) u.cd--;
    }
    settlePoints(0);
    S.sel = firstReady(0);
    if (S.sel >= 0) floodFill(units[S.sel]);
    audio.sfx('confirm', { gain: .6 });
    updateHud(); refreshUI();
  }
  function firstReady(side) {
    for (let i = 0; i < MAXU; i++) if (units[i].alive && units[i].side === side && !units[i].done) return i;
    return -1;
  }
  function endPlayerTurn() {
    S.phase = 'enemy'; S.aiT = 0.35;
    settlePoints(1);
    for (let i = 0; i < MAXU; i++) {
      units[i].planned = false; units[i].attacked = false;
      if (units[i].alive && units[i].side === 1) { units[i].done = false; units[i].moved = false; units[i].acted = false; }
    }
    audio.sfx('back', { gain: .6 });
    updateHud(); refreshUI();
  }
  function endEnemyTurn() {
    S.turn++;
    if (S.turn > MAX_TURN) { finish(false); return; }
    for (let i = 0; i < MAXU; i++) if (units[i].alive && units[i].side === 1 && units[i].cd > 0) units[i].cd--;
    beginPlayerTurn();
  }
  function settlePoints(side) {
    let held = 0;
    for (let i = 0; i < NC; i++) {
      if (terr[i] !== T_POINT) continue;
      const ui = unitAt[i];
      if (ui >= 0 && units[ui].alive && units[ui].side === side) {
        held++;
        units[ui].hp = Math.min(units[ui].maxHp, units[ui].hp + 14);
        if (side === 0) S.score += 12;
        particles.burst(HX[i], HY[i], 5, { color: PALETTE.amber, speed: 70, life: .6, size: 2 });
      }
    }
    if (side === 0) {
      if (held >= 3) { S.holdCount++; note('据点全控 ' + S.holdCount + '/' + HOLD_NEED); }
      else S.holdCount = 0;
      if (S.holdCount >= HOLD_NEED) finish(true);
    }
    updateHud();
  }
  function finish(win) {
    if (S.over) return;
    S.over = true; S.result = win ? 'win' : 'lose';
    const value = win ? S.score + 800 + (MAX_TURN - S.turn) * 60 : S.score;
    if (value > S.best) { S.best = value; save.set('best', value); }
    audio.sfx(win ? 'win' : 'lose');
    ctx.vibrate(win ? PATTERNS.win : PATTERNS.lose);
    flash.add(0.35, win ? '#8dff4d' : '#ff4d5e');
    ctx.finish(value, { win, stats: [['回合', S.turn], ['击杀', S.kills], ['据点持续', S.holdCount + '/' + HOLD_NEED]] });
  }

  // ---------- AI ----------
  function planAI(u) {
    floodFill(u);
    const sk = KINDS[u.kind].skill;
    if (u.kind === 'priest' && u.cd === 0) {          // 牧师：优先治疗伤员
      let bh = 12, bc = u.idx, bt = -1;
      for (let i = 0; i < NC; i++) {
        if (!reach[i]) continue;
        for (let k = 0; k < MAXU; k++) {
          const o = units[k];
          if (!o.alive || o.side !== u.side || o.hp > o.maxHp - 10 || hexDist(i, o.idx) > sk.range) continue;
          const sc = (o.maxHp - o.hp) - cost[i] * 0.6;
          if (sc > bh) { bh = sc; bc = i; bt = k; }
        }
      }
      if (bt >= 0) { u.planPathN = buildPath(u, bc, u.plan); u.planT = bt; u.planSkill = true; return; }
    }
    let bestScore = -1e9, bestCell = u.idx, bestTarget = -1;
    for (let i = 0; i < NC; i++) {
      if (!reach[i]) continue;
      let cellScore = -cost[i] * 1.2;
      if (terr[i] === T_POINT) cellScore += 34;
      if (terr[i] === T_FOREST) cellScore += 8;
      if (terr[i] === T_MOUNTAIN) cellScore += 12;
      // 攻击评估
      for (let k = 0; k < MAXU; k++) {
        const o = units[k];
        if (!o.alive || o.side === u.side) continue;
        const dd = hexDist(i, o.idx);
        if (dd > KINDS[u.kind].range) continue;
        let s = cellScore + 60;
        s += (1 - o.hp / o.maxHp) * 60;                    // 优先残血
        if (o.kind === 'priest' || o.kind === 'mage') s += 34;
        if (o.kind === 'warrior') s -= 10;
        const red = 1 - clamp(KINDS[o.kind].def + TER[terr[o.idx]].def, 0, .8);
        const avg = (KINDS[u.kind].atk[0] + KINDS[u.kind].atk[1]) / 2 * red;
        if (avg >= o.hp) s += 220;                          // 能击杀
        if (u.kind === 'priest') s -= 100;                  // 牧师不主动送死
        if (s > bestScore) { bestScore = s; bestCell = i; bestTarget = k; }
      }
      if (bestTarget < 0) {
        // 无目标：靠近最近敌人 / 抢据点 / 牧师靠近伤员
        let goalScore = -1e9, goal = -1;
        if (u.kind === 'priest' && u.cd === 0) {
          for (let k = 0; k < MAXU; k++) {
            const o = units[k];
            if (!o.alive || o.side !== u.side || o.hp >= o.maxHp) continue;
            const d = hexDist(i, o.idx);
            if (d <= sk.range && 40 - d * 3 > goalScore) { goalScore = 40 - d * 3; goal = k; }
          }
        }
        if (goal < 0) {
          for (let k = 0; k < MAXU; k++) {
            const o = units[k];
            if (!o.alive || o.side === u.side) continue;
            const d = hexDist(i, o.idx);
            if (-d * 6 > goalScore) goalScore = -d * 6;
          }
          if (u.hp < u.maxHp * 0.35) goalScore -= 80;      // 残血保守
        } else goalScore += 60;
        const s = goalScore + cellScore;
        if (s > bestScore) { bestScore = s; bestCell = i; bestTarget = goal; }
      }
    }
    // 生成路径
    u.planPathN = buildPath(u, bestCell, u.plan);
    u.planT = bestTarget;
    if (u.planT >= 0 && u.cd === 0 && (u.kind === 'priest' || u.kind === 'mage')) {
      const o = units[u.planT];
      if (u.kind === 'priest' && o.side === u.side) u.planSkill = true;
      else if (u.kind === 'mage' && o.side !== u.side && hexDist(bestCell, o.idx) <= 4) u.planSkill = true;
      else u.planSkill = false;
    } else u.planSkill = false;
  }
  function advanceAI() {
    let u = null;
    for (let k = 0; k < 4; k++) {
      const c = units[4 + k];
      if (c.alive && !c.done) { u = c; break; }
    }
    if (!u) { endEnemyTurn(); return; }
    if (u.anim !== 0) { S.aiT = 0.08; return; }
    if (!u.planned) {
      planAI(u);
      u.planned = true;
      if (u.planPathN > 1) { startMove(u, u.plan, u.planPathN); S.aiT = 0.12; return; }
    }
    if (u.planT >= 0 && !u.acted) {
      const o = units[u.planT];
      if (o && o.alive) {
        if (u.planSkill && u.cd === 0) { u.cd = KINDS[u.kind].skill.cd; startAttack(u, u.planT, KINDS[u.kind].skill.kind); }
        else if (hexDist(u.idx, o.idx) <= KINDS[u.kind].range) startAttack(u, u.planT, 'atk');
        u.acted = true;
      }
      S.aiT = 0.25; u.done = true; return;
    }
    u.done = true; S.aiT = 0.12;
  }

  // ---------- 玩家操作 ----------
  function selectUnit(i) {
    S.sel = i; S.mode = 'normal';
    if (i >= 0) { floodFill(units[i]); markAttack(units[i], KINDS[units[i].kind].range, atkCells); audio.sfx('select'); }
    refreshUI();
  }
  function tryMove(i) {
    const u = units[S.sel];
    if (u.moved || !reach[i]) return false;
    const n = buildPath(u, i, tmpPath);
    const oldIdx = u.idx;
    unitAt[oldIdx] = -1;
    unitAt[i] = S.sel;
    u.idx = i;
    startMove(u, tmpPath, n);
    u.moved = true;
    return true;
  }
  function tryAttack(ti) {
    const u = units[S.sel], d = units[ti];
    if (!d || !d.alive || u.acted) return false;
    if (d.side === u.side) return false;
    if (hexDist(u.idx, d.idx) > KINDS[u.kind].range) return false;
    startAttack(u, ti, 'atk');
    u.acted = true;
    return true;
  }
  function trySkill(ti) {
    const u = units[S.sel], sk = KINDS[u.kind].skill;
    if (u.acted || u.cd > 0) return false;
    const d = units[ti];
    if (!d || !d.alive) return false;
    const wantAlly = sk.kind === 'heal';
    if ((d.side === u.side) !== wantAlly || hexDist(u.idx, d.idx) > sk.range) return false;
    u.cd = sk.cd;
    startAttack(u, ti, sk.kind);
    u.acted = true;
    return true;
  }
  function standby() {
    const u = units[S.sel];
    if (!u) return;
    u.done = true; u.moved = true; u.acted = true;
    audio.sfx('back', { gain: .5 });
    const n = firstReady(0);
    selectUnit(n);
    if (n < 0) endPlayerTurn();
  }
  function handlePointer() {
    const p = input.pointer;
    S.hover = -1; S.hoverUnit = -1;
    let bd = R * R;
    for (let i = 0; i < NC; i++) {
      const dx = p.x - HX[i], dy = p.y - HY[i];
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; S.hover = i; }
    }
    for (let i = 0; i < MAXU; i++) if (units[i].alive && units[i].idx === S.hover) S.hoverUnit = i;
    if (!p.justDown || S.over || S.phase !== 'player') return;
    if (anyAnim()) return;
    const i = S.hover;
    const ui = unitAt[i];
    if (S.sel >= 0 && S.mode === 'skill' && ui >= 0) { if (trySkill(ui)) { S.mode = 'normal'; refreshUI(); return; } }
    if (S.sel >= 0 && ui >= 0 && units[ui].side === 1) { if (tryAttack(ui)) { refreshUI(); return; } }
    if (ui >= 0 && units[ui].side === 0 && units[ui].alive) { selectUnit(ui); return; }
    if (S.sel >= 0 && reach[i] && !units[S.sel].moved) { tryMove(i); refreshUI(); return; }
    if (S.sel >= 0 && i >= 0 && ui < 0 && units[S.sel].moved) note('该单位本回合已移动');
  }
  function anyAnim() { for (let i = 0; i < MAXU; i++) if (units[i].anim !== 0) return true; return false; }

  // ---------- DOM ----------
  function mkBtn(w, cls) {
    const b = document.createElement('button');
    b.className = 'btn ' + (cls || 'btn-ghost');
    b.style.cssText = 'pointer-events:auto;min-width:' + w + 'px;padding:8px 12px;font-size:12px;line-height:1.35;display:flex;flex-direction:column;align-items:center;gap:1px;transition:.15s';
    return b;
  }
  function attachHover(b, color) {
    ctx.listen(b, 'pointerenter', () => { b.style.borderColor = color; b.style.boxShadow = '0 0 14px ' + color + '66'; });
    ctx.listen(b, 'pointerleave', () => { b.style.borderColor = ''; b.style.boxShadow = ''; });
  }
  const root = document.createElement('div');
  root.style.cssText = 'pointer-events:none;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;background:none;padding:4px 6px 10px';
  const btnSkill = mkBtn(120, 'btn-primary');
  const btnWait = mkBtn(84);
  const btnEnd = mkBtn(104);
  const btnAuto = mkBtn(84);
  ctx.listen(btnSkill, 'click', () => {
    if (S.phase !== 'player' || S.sel < 0) return;
    const u = units[S.sel];
    if (u.cd > 0) { audio.sfx('error'); ctx.hint('技能冷却中（' + u.cd + ' 回合）', 1600); return; }
    S.mode = S.mode === 'skill' ? 'normal' : 'skill';
    audio.sfx('swap'); refreshUI();
  });
  ctx.listen(btnWait, 'click', () => { if (S.phase === 'player' && S.sel >= 0) standby(); });
  ctx.listen(btnEnd, 'click', () => { if (S.phase === 'player' && !anyAnim()) endPlayerTurn(); });
  ctx.listen(btnAuto, 'click', () => { if (S.phase === 'player' && S.sel >= 0) { autoAct(units[S.sel]); } });
  attachHover(btnSkill, PALETTE.cyan); attachHover(btnWait, PALETTE.amber);
  attachHover(btnEnd, PALETTE.lime); attachHover(btnAuto, PALETTE.violet);
  root.appendChild(btnSkill); root.appendChild(btnAuto); root.appendChild(btnWait); root.appendChild(btnEnd);
  ctx.overlay(root);
  function refreshUI() {
    if (S.sel >= 0 && units[S.sel].alive) {
      const u = units[S.sel], sk = KINDS[u.kind].skill;
      markAttack(u, sk.range, skillCells);
      btnSkill.innerHTML = '<span style="font-size:12px;color:' + (u.cd > 0 ? '#7d8db3' : PALETTE.cyan) + '">' + sk.name + (u.cd > 0 ? '（' + u.cd + '）' : '') + '</span>' +
        '<span style="font-size:10px;color:#7d8db3">' + (S.mode === 'skill' ? '点击目标 / Q 取消' : 'Q 键') + '</span>';
      btnSkill.style.opacity = u.cd > 0 ? '.6' : '1';
    } else btnSkill.innerHTML = '<span style="font-size:12px;color:#7d8db3">未选中</span>';
    btnWait.innerHTML = '<span style="font-size:12px;color:' + PALETTE.amber + '">待机</span><span style="font-size:10px;color:#7d8db3">空格</span>';
    btnAuto.innerHTML = '<span style="font-size:12px;color:' + PALETTE.violet + '">托管此单位</span>';
    btnEnd.innerHTML = '<span style="font-size:12px;color:' + PALETTE.lime + '">结束回合</span><span style="font-size:10px;color:#7d8db3">回车</span>';
  }
  /** 单体托管：用 AI 逻辑执行一次行动（移动端友好） */
  function autoAct(u) {
    if (u.moved && u.acted) { standby(); return; }
    planAI(u);
    if (u.planPathN > 1 && !u.moved) {
      const oldIdx = u.idx;
      unitAt[oldIdx] = -1;
      const dest = u.plan[u.planPathN - 1];
      unitAt[dest] = u.slot;
      u.idx = dest;
      startMove(u, u.plan, u.planPathN);
      u.moved = true;
    }
    if (u.planT >= 0 && !u.acted) {
      const o = units[u.planT];
      if (o && o.alive && hexDist(u.idx, o.idx) <= KINDS[u.kind].range) {
        if (o.side !== u.side) { startAttack(u, u.planT, 'atk'); u.acted = true; }
      }
    }
    u.pendingAuto = !u.acted;
    refreshUI();
  }
  input.on((e) => {
    if (e.type !== 'key' || S.over) return;
    if (e.code === 'KeyQ') {
      if (S.phase === 'player' && S.sel >= 0 && units[S.sel].cd === 0) { S.mode = S.mode === 'skill' ? 'normal' : 'skill'; audio.sfx('swap'); refreshUI(); }
    } else if (e.code === 'Enter') { if (S.phase === 'player' && !anyAnim()) endPlayerTurn(); }
    else if (e.code === 'Escape') { S.mode = 'normal'; refreshUI(); }
    else if (e.code === 'Tab') {
      if (S.phase === 'player') {
        const start = S.sel;
        for (let k = 1; k <= MAXU; k++) {
          const i = (start + k + MAXU) % MAXU;
          if (units[i].alive && units[i].side === 0 && !units[i].done) { selectUnit(i); break; }
        }
      }
    }
  });

  // ---------- 更新 ----------
  function update(dt) {
    S.t += dt;
    if (S.msgT > 0) S.msgT -= dt;
    handlePointer();
    if (input.consume('jump', 140) && S.phase === 'player' && S.sel >= 0 && !anyAnim()) standby();
    for (let i = 0; i < MAXU; i++) {
      const u = units[i];
      if (!u.alive) continue;
      if (u.flash > 0) u.flash -= dt;
      if (u.anim === 1) {                      // 移动
        u.animT += dt;
        const total = u.animMax || 0.01;
        const p = clamp(u.animT / total, 0, 1);
        const seg = (u.pathN - 1) * p;
        const si = Math.min(u.pathN - 2, Math.floor(seg));
        const f = seg - si;
        const a = u.path[si], b = u.path[si + 1];
        u.x = lerp(HX[a], HX[b], f); u.y = lerp(HY[a], HY[b], f);
        if (rng.chance(0.4)) particles.trail(u.x, u.y + R * .5, KINDS[u.kind].col, 2);
        if (p >= 1) { u.anim = 0; u.x = HX[u.idx]; u.y = HY[u.idx]; audio.sfx('land', { gain: .4 }); }
      } else if (u.anim === 2) {               // 攻击冲刺
        u.animT += dt;
        const p = clamp(u.animT / u.animMax, 0, 1);
        const dash = p < 0.45 ? p / 0.45 : Math.max(0, 1 - (p - 0.45) / 0.55);
        const ang = Math.atan2(u.ty - u.sy, u.tx - u.sx);
        const push = R * 0.55 * dash;
        u.x = u.sx + Math.cos(ang) * push;
        u.y = u.sy + Math.sin(ang) * push;
        if (p < 0.46 && !u.hitDone && p >= 0.42) {
          u.hitDone = true;
          applyAction(u);
        }
        if (p >= 1) {
          u.anim = 0; u.hitDone = false; u.x = HX[u.idx]; u.y = HY[u.idx];
          if (u.side === 0) { refreshUI(); if (u.moved && u.acted) u.done = true; }
          checkEnd();
        }
      } else if (u.anim === 0 && u.pendingAuto && !u.acted && u.planT >= 0) {
        const o = units[u.planT];
        u.pendingAuto = false;
        if (o && o.alive && hexDist(u.idx, o.idx) <= KINDS[u.kind].range && o.side !== u.side) {
          startAttack(u, u.planT, 'atk'); u.acted = true;
        }
      }
      if (u.anim === 0 && u.side === 0 && S.phase === 'player' && u.moved && u.acted && !u.done && !u.pendingAuto) u.done = true;
    }
    for (let i = 0; i < MAXB; i++) { if (!beams[i].alive) continue; beams[i].t += dt; if (beams[i].t >= beams[i].max) beams[i].alive = false; }
    if (S.over) return;
    if (S.phase === 'enemy') {
      S.aiT -= dt;
      if (S.aiT <= 0) advanceAI();
    } else if (S.phase === 'player') {
      if (firstReady(0) < 0 && !anyAnim()) endPlayerTurn();
      else if (S.sel >= 0 && units[S.sel].done) {
        const n = firstReady(0);
        if (n >= 0) selectUnit(n);
      }
    }
  }
  function updateHud() {
    let held = 0, foes = 0;
    for (let i = 0; i < NC; i++) {
      const ui = unitAt[i];
      if (terr[i] === T_POINT && ui >= 0 && units[ui].alive && units[ui].side === 0) held++;
    }
    for (let i = 0; i < MAXU; i++) if (units[i].alive && units[i].side === 1) foes++;
    ctx.hud('turn', '回合', S.turn + '/' + MAX_TURN, { color: PALETTE.cyan });
    ctx.hud('side', '阶段', S.phase === 'player' ? '我方行动' : '敌方行动', { color: S.phase === 'player' ? PALETTE.lime : PALETTE.red });
    ctx.hud('pts', '据点', held + '/3 · 持续 ' + S.holdCount + '/' + HOLD_NEED, { color: PALETTE.amber });
    ctx.hud('foe', '敌军', foes);
  }

  // ---------- 渲染 ----------
  function render(alpha, rdt) {
    const c = ctx.ctx, W = ctx.W, H = ctx.H;
    c.fillStyle = PALETTE.bg;
    c.fillRect(0, 0, W, H);
    c.save(); shake.apply(c);
    // 地形
    for (let i = 0; i < NC; i++) {
      const t = terr[i], td = TER[t];
      hexPath(c, HX[i], HY[i], R * 0.94, false);
      c.fillStyle = td.col; c.fill();
      c.strokeStyle = td.edge; c.lineWidth = 1; c.stroke();
      if (t === T_FOREST) {
        c.fillStyle = 'rgba(80,220,150,.55)';
        for (let k = 0; k < 3; k++) {
          const a = i * 1.7 + k * 2.1;
          c.beginPath();
          c.moveTo(HX[i] + Math.cos(a) * R * .38, HY[i] + Math.sin(a) * R * .38 - R * .3);
          c.lineTo(HX[i] + Math.cos(a) * R * .38 + 5, HY[i] + Math.sin(a) * R * .38 + R * .22);
          c.lineTo(HX[i] + Math.cos(a) * R * .38 - 5, HY[i] + Math.sin(a) * R * .38 + R * .22);
          c.closePath(); c.fill();
        }
      } else if (t === T_MOUNTAIN) {
        c.fillStyle = 'rgba(190,160,240,.6)';
        c.beginPath();
        c.moveTo(HX[i] - R * .42, HY[i] + R * .36);
        c.lineTo(HX[i] - R * .1, HY[i] - R * .36);
        c.lineTo(HX[i] + R * .16, HY[i] + R * .06);
        c.lineTo(HX[i] + R * .3, HY[i] - R * .18);
        c.lineTo(HX[i] + R * .46, HY[i] + R * .36);
        c.closePath(); c.fill();
      } else if (t === T_WATER) {
        c.strokeStyle = 'rgba(90,180,255,.30)'; c.lineWidth = 1.4;
        c.beginPath();
        for (let k = -1; k <= 1; k++) {
          const y = HY[i] + k * R * .34;
          c.moveTo(HX[i] - R * .45, y + Math.sin(S.t * 2 + i + k) * 2);
          c.quadraticCurveTo(HX[i], y + Math.sin(S.t * 2 + i + k) * 3 + 3, HX[i] + R * .45, y + Math.sin(S.t * 2 + i + k) * 2);
        }
        c.stroke();
      } else if (t === T_POINT) {
        const ui = unitAt[i];
        const mine = ui >= 0 && units[ui].alive && units[ui].side === 0;
        const col = mine ? PALETTE.amber : ui >= 0 && units[ui].alive ? PALETTE.red : '#7d5f22';
        glowCircle(c, HX[i], HY[i], R * (0.62 + Math.sin(S.t * 2.4 + i) * .06), col, { glow: 14, width: 2, alpha: .9 });
        text(c, '★', HX[i], HY[i], { size: 13, color: col, glow: 10 });
      }
    }
    // 可达 / 攻击范围
    if (S.phase === 'player' && S.sel >= 0 && units[S.sel].alive && !anyAnim()) {
      const u = units[S.sel];
      if (!u.moved) {
        for (let i = 0; i < NC; i++) {
          if (!reach[i] || i === u.idx) continue;
          hexPath(c, HX[i], HY[i], R * 0.9, false);
          c.fillStyle = 'rgba(34,224,255,.16)'; c.fill();
          c.strokeStyle = 'rgba(34,224,255,.5)'; c.lineWidth = 1; c.stroke();
        }
      }
      const arr = S.mode === 'skill' ? skillCells : atkCells;
      for (let i = 0; i < NC; i++) {
        if (!arr[i] || i === u.idx) continue;
        hexPath(c, HX[i], HY[i], R * 0.9, false);
        c.fillStyle = S.mode === 'skill' ? 'rgba(168,85,247,.17)' : 'rgba(255,77,94,.13)'; c.fill();
      }
      // 移动路径预览
      if (u.anim === 0 && !u.moved && reach[S.hover] && S.hover >= 0) {
        const n = buildPath(u, S.hover, tmpPath);
        c.save();
        c.setLineDash([5, 5]); c.lineDashOffset = -S.t * 20;
        c.strokeStyle = 'rgba(141,255,77,.9)'; c.lineWidth = 2.4;
        c.beginPath(); c.moveTo(HX[tmpPath[0]], HY[tmpPath[0]]);
        for (let k = 1; k < n; k++) c.lineTo(HX[tmpPath[k]], HY[tmpPath[k]]);
        c.stroke(); c.setLineDash([]); c.restore();
        text(c, cost[S.hover] + '/' + KINDS[u.kind].mov, HX[S.hover], HY[S.hover] - R * .55, { size: 10, color: PALETTE.lime });
      }
    }
    // 悬停格
    if (S.hover >= 0) {
      hexPath(c, HX[S.hover], HY[S.hover], R * 0.94, false);
      c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.8; c.stroke();
    }
    // 选中单位
    if (S.sel >= 0 && units[S.sel].alive) {
      const u = units[S.sel];
      c.save();
      c.setLineDash([6, 6]); c.lineDashOffset = -S.t * 26;
      hexPath(c, HX[u.idx], HY[u.idx], R * 0.98, false);
      c.strokeStyle = PALETTE.cyan; c.lineWidth = 2.4; c.stroke();
      c.restore();
    }
    // 单位
    for (let i = 0; i < MAXU; i++) if (units[i].alive) drawUnit(c, units[i]);
    // 光束
    for (let i = 0; i < MAXB; i++) {
      const b = beams[i];
      if (!b.alive) continue;
      const a = 1 - b.t / b.max;
      neon(c, (cc) => { cc.moveTo(b.x1, b.y1); cc.lineTo(b.x2, b.y2); }, b.col, { glow: 14, width: 2.6, alpha: a, layers: 2, inner: '#fff' });
    }
    particles.renderTexts(c, rdt); c.restore();
    drawUnitPanel(c, W, H);
    drawPreview(c, W, H);
    if (S.msgT > 0) {
      c.save(); c.globalAlpha = clamp(S.msgT, 0, 1);
      text(c, S.msg, W / 2, 30, { size: 13, color: PALETTE.amber, glow: 10, baseline: 'top' });
      c.restore();
    }
    if (S.over) {
      c.fillStyle = 'rgba(4,7,16,.55)'; c.fillRect(0, 0, W, H);
      text(c, S.result === 'win' ? '战场制胜！' : '任务失败', W / 2, H / 2, { size: Math.min(42, W * .09), color: S.result === 'win' ? PALETTE.lime : PALETTE.red, weight: 900, glow: 20 });
    }
    vignette(c, W, H, .4);
  }

  function drawUnit(c, u) {
    const k = KINDS[u.kind];
    const col = u.flash > 0 ? '#fff' : (u.side === 0 ? k.col : PALETTE.red);
    const ready = u.side === 0 ? !(u.moved && u.acted) : true;
    c.save();
    c.globalAlpha = ready ? 1 : 0.55;
    // 底座
    c.fillStyle = 'rgba(6,10,20,.75)';
    c.beginPath(); c.ellipse(u.x, u.y + R * .42, R * .52, R * .2, 0, 0, TAU); c.fill();
    glowCircle(c, u.x, u.y, R * 0.52, col, { glow: 10, width: 2, alpha: .95, fill: u.side === 0 ? 'rgba(34,224,255,.10)' : 'rgba(255,77,94,.14)' });
    text(c, k.glyph, u.x, u.y, { size: R * 0.72, color: col, glow: 8 });
    // 血条
    const bw = R * 1.05;
    bar(c, u.x - bw / 2, u.y - R * .78, bw, 4, u.hp / u.maxHp, { bg: 'rgba(0,0,0,.6)', fill: u.side === 0 ? PALETTE.green : PALETTE.red });
    if (u.side === 0 && u.cd === 0 && !u.acted) text(c, 'Q', u.x + R * .62, u.y - R * .62, { size: 11, color: PALETTE.violet, glow: 8 });
    if (u.side === 0 && u.done) text(c, '✓', u.x + R * .6, u.y + R * .55, { size: 12, color: PALETTE.dim });
    c.restore();
  }

  function drawUnitPanel(c, W, H) {
    const idx = S.hoverUnit >= 0 ? S.hoverUnit : S.sel;
    if (idx < 0 || !units[idx].alive) return;
    const u = units[idx], k = KINDS[u.kind];
    const pw = 186, ph = 92, x = 10, y = H - ph - (ctx.H > 620 ? 116 : 96);
    panel(c, x, y, pw, ph, { fill: 'rgba(8,12,24,.9)', stroke: k.col, r: 9 });
    text(c, (u.side === 0 ? '我方 · ' : '敌方 · ') + k.name, x + 10, y + 15, { size: 13, color: k.col, align: 'left', weight: 800 });
    text(c, 'HP ' + Math.max(0, Math.round(u.hp)) + '/' + u.maxHp, x + 10, y + 33, { size: 11, color: '#eaf2ff', align: 'left' });
    bar(c, x + 10, y + 40, pw - 20, 5, u.hp / u.maxHp, { fill: u.side === 0 ? PALETTE.green : PALETTE.red });
    text(c, '攻击 ' + k.atk[0] + '~' + k.atk[1] + ' · 射程 ' + k.range + ' · 移动 ' + k.mov, x + 10, y + 58, { size: 11, color: '#9fb0d4', align: 'left' });
    const td = TER[terr[u.idx]];
    const terrTxt = '地形：' + td.name + (td.dodge ? '（闪避 +' + Math.round(td.dodge * 100) + '%）' : '') + (terr[u.idx] === T_MOUNTAIN ? '（防御 +50%）' : '');
    text(c, terrTxt, x + 10, y + 72, { size: 10, color: '#7d8db3', align: 'left' });
    text(c, '技能 ' + k.skill.name + (u.cd > 0 ? ' CD ' + u.cd : ' 就绪'), x + 10, y + 85, { size: 10, color: u.cd > 0 ? PALETTE.dim : PALETTE.violet, align: 'left' });
  }

  function drawPreview(c, W, H) {
    if (S.phase !== 'player' || S.sel < 0 || S.hoverUnit < 0) return;
    const a = units[S.sel];
    if (!a.alive || a.acted) return;
    const d = units[S.hoverUnit];
    if (d.side === a.side) return;
    const useSkill = S.mode === 'skill';
    const range = useSkill ? KINDS[a.kind].skill.range : KINDS[a.kind].range;
    if (hexDist(a.idx, d.idx) > range) return;
    if (useSkill && KINDS[a.kind].skill.kind === 'heal') return;
    const dmg = useSkill ? KINDS[a.kind].skill.dmg : KINDS[a.kind].atk;
    const pv = preview(a, d, dmg);
    const bw = 132, bh = 46, bx = clamp(d.x - bw / 2, 6, W - bw - 6), by = clamp(d.y - R - bh - 8, 6, H - bh - 6);
    panel(c, bx, by, bw, bh, { fill: 'rgba(6,10,20,.94)', stroke: pv.lethal ? PALETTE.amber : PALETTE.red, r: 8 });
    text(c, '命中 ' + Math.round(pv.acc) + '%', bx + 10, by + 15, { size: 12, color: pv.blocked ? PALETTE.red : PALETTE.cyan, align: 'left', weight: 700 });
    text(c, '伤害 ' + pv.min + '~' + pv.max + (pv.lethal ? '（可击杀）' : ''), bx + 10, by + 32, { size: 11, color: pv.lethal ? PALETTE.amber : '#eaf2ff', align: 'left' });
    if (pv.blocked) text(c, '视野被山地遮挡', bx + 10, by + 46, { size: 10, color: PALETTE.red, align: 'left' });
  }

  // 初始化
  updateHud(); refreshUI();
  selectUnit(firstReady(0));
  return {
    update, render,
    resize(w, h) {
      layout(w, h); rebuildCenters();
      for (let i = 0; i < MAXU; i++) if (units[i].alive && units[i].anim === 0) { units[i].x = HX[units[i].idx]; units[i].y = HY[units[i].idx]; }
    },
    pause() { audio.duck(0.5, 2000); },
    resume() { }
  };
}
