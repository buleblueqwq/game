import { clamp, clamp01, lerp, TAU } from '../core/math.js';
import { PALETTE, fillRound, strokeRound, glowCircle, glowDot, glowLine, text, bar, panel as drawPanel, vignette, star as starPath } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'roguelike-dungeon', title: '地牢 Roguelike', category: 'strategy', difficulty: 4, music: 'space', particles: 900,
  howto: [
    '方向键/WASD 移动，撞向怪物即攻击；. 或空格原地等待一回合',
    '点击已探索的格子会自动寻路前往；可开宝箱、祭坛祈祷、走楼梯下楼',
    '吃食物维持饱食度，升级可选永久特质，第 10 层击败深渊领主获胜'
  ]
};
export const musicTrack = 'space';

const MW = 44, MH = 30, MAXT = MW * MH, MAXROOM = 12;
const WALL = 0, FLOOR = 1, STAIR = 2, CHEST = 3, TRAP = 4, ALTAR = 5, SHOP = 6;

const MONS = [
  { n: '洞穴鼠', hp: 8, atk: 4, def: 0, xp: 4, sp: 1, col: '#8dff4d', sh: 0, vi: 5, mf: 1, mg: 0 },
  { n: '幽蝠', hp: 10, atk: 5, def: 0, xp: 6, sp: 2, col: '#a855f7', sh: 1, vi: 7, mf: 1, mg: 0 },
  { n: '史莱姆', hp: 16, atk: 6, def: 1, xp: 8, sp: 1, col: '#28e0a0', sh: 2, vi: 5, mf: 1, mg: 0 },
  { n: '骷髅兵', hp: 22, atk: 8, def: 2, xp: 12, sp: 1, col: '#eaf2ff', sh: 3, vi: 6, mf: 2, mg: 0 },
  { n: '兽人战士', hp: 30, atk: 11, def: 3, xp: 18, sp: 1, col: '#ffb020', sh: 4, vi: 6, mf: 3, mg: 0 },
  { n: '怨灵', hp: 24, atk: 13, def: 1, xp: 22, sp: 1, col: '#22e0ff', sh: 5, vi: 8, mf: 4, mg: 0 },
  { n: '邪术师', hp: 20, atk: 12, def: 1, xp: 24, sp: 1, col: '#ff2e88', sh: 6, vi: 8, mf: 4, mg: 5 },
  { n: '洞穴巨魔', hp: 48, atk: 15, def: 5, xp: 34, sp: 1, col: '#8dff4d', sh: 7, vi: 6, mf: 5, mg: 0 },
  { n: '暗影刺客', hp: 26, atk: 18, def: 2, xp: 32, sp: 2, col: '#ff4d5e', sh: 8, vi: 8, mf: 5, mg: 0 },
  { n: '石傀儡', hp: 62, atk: 13, def: 9, xp: 44, sp: 1, col: '#7d8db3', sh: 9, vi: 5, mf: 6, mg: 0 }
];
const BOSS = { n: '深渊领主', hp: 160, atk: 24, def: 9, xp: 400, sp: 1, col: '#ff2e88', sh: 10, vi: 14, mf: 10, mg: 7, boss: 1 };

// k: w武器 a护甲 r戒指 p药水 s卷轴 f食物
const BASES = [
  { n: '短剑', k: 'w', atk: 3 }, { n: '长剑', k: 'w', atk: 5 }, { n: '战斧', k: 'w', atk: 7, crit: -4 },
  { n: '匕首', k: 'w', atk: 3, crit: 12 }, { n: '秘法杖', k: 'w', atk: 2, mag: 4 },
  { n: '皮甲', k: 'a', def: 2 }, { n: '锁子甲', k: 'a', def: 4 }, { n: '板甲', k: 'a', def: 6, spd: -1 }, { n: '织法袍', k: 'a', def: 1, mag: 3 },
  { n: '力量之戒', k: 'r', atk: 2 }, { n: '守护之戒', k: 'r', def: 2 }, { n: '智慧之戒', k: 'r', mag: 3, mp: 6 }, { n: '再生之戒', k: 'r', reg: 1 },
  { n: '治疗药水', k: 'p', use: 'heal', v: 24 }, { n: '法力药水', k: 'p', use: 'mana', v: 20 },
  { n: '力量药水', k: 'p', use: 'buff', v: 5, dur: 22 }, { n: '迅捷药水', k: 'p', use: 'haste', v: 1, dur: 22 },
  { n: '火焰卷轴', k: 's', use: 'fire', v: 18 }, { n: '冰霜卷轴', k: 's', use: 'ice', v: 10, dur: 9 },
  { n: '传送卷轴', k: 's', use: 'blink' }, { n: '探知卷轴', k: 's', use: 'map' }, { n: '强化卷轴', k: 's', use: 'forge' },
  { n: '干粮', k: 'f', use: 'food', v: 130 }, { n: '烤肉', k: 'f', use: 'food', v: 260 }, { n: '灵果', k: 'f', use: 'food', v: 90, mp: 12 }
];
const PRE = [
  { n: '', m: 1 }, { n: '火焰', atk: 2, col: '#ff4d5e' }, { n: '寒冰', mag: 2, col: '#22e0ff' },
  { n: '剧毒', atk: 1, col: '#8dff4d' }, { n: '雷霆', crit: 8, col: '#ffb020' }, { n: '嗜血', ls: 10, col: '#ff2e88' },
  { n: '秘银', def: 2, col: '#7d8db3' }, { n: '远古', atk: 1, def: 1, col: '#a855f7' }, { n: '精准', atk: 1, crit: 5, col: '#28e0a0' }
];
const SUF = [
  { n: '' }, { n: '之力量', atk: 2 }, { n: '之守护', def: 2 }, { n: '之迅捷', spd: 1 },
  { n: '之智慧', mag: 2 }, { n: '之幸运', crit: 6 }, { n: '之永恒', hp: 10 }
];
const QUAL = [
  { n: '普通', c: '#7d8db3', m: 1 }, { n: '精良', c: '#28e0a0', m: 1.15 }, { n: '稀有', c: '#3b82f6', m: 1.3 },
  { n: '史诗', c: '#a855f7', m: 1.5 }, { n: '传说', c: '#ffb020', m: 1.8 }
];
const TRAITS = [
  { n: '吸血', d: '攻击回复伤害 25% 生命', f: 'ls' }, { n: '战魂', d: '击杀回复 5 生命 3 法力', f: 'kill' },
  { n: '暴击链', d: '暴击时立刻追加一次攻击', f: 'chain' }, { n: '疾风步', d: '20% 概率获得额外行动', f: 'extra' },
  { n: '鹰眼', d: '视野 +3', f: 'vis' }, { n: '铁壁', d: '防御 +3', f: 'def' },
  { n: '狂战士', d: '攻击 +4', f: 'atk' }, { n: '巨躯', d: '生命上限 +20 并回满', f: 'hp' },
  { n: '拾荒者', d: '获得金币 +60%', f: 'gold' }, { n: '命运', d: '暴击率 +10%', f: 'crit' },
  { n: '再生', d: '每 10 回合回复 2 生命', f: 'regen' }, { n: '学者', d: '获得经验 +50%', f: 'xp' },
  { n: '行囊', d: '背包上限 +4', f: 'bag' }, { n: '荆棘', d: '反弹 30% 近战伤害', f: 'thorn' },
  { n: '法潮', d: '法力上限 +20 并回满', f: 'mp' }, { n: '潜行', d: '怪物察觉范围 -2', f: 'stealth' },
  { n: '苦行', d: '饥饿速度 -35%', f: 'slow' }, { n: '武器精通', d: '武器伤害 +25%', f: 'master' }
];

export function create(ctx) {
  const c = ctx.ctx;
  const R = ctx.rng;
  const A = ctx.audio, PT = ctx.particles;
  let W = 960, H = 600, ts = 20, camX = 0, camY = 0;

  const T = new Uint8Array(MAXT);        // 地形
  const SEEN = new Uint8Array(MAXT);     // 已探索
  const VIS = new Uint8Array(MAXT);      // 当前可见
  const LIT = new Float32Array(MAXT);    // 渐亮动画
  const BFS = new Int16Array(MAXT);      // 距玩家距离场
  const FRO = new Int16Array(MAXT);      // 距最近未探索边界距离场
  const Q = new Int32Array(MAXT);        // BFS 队列

  const RX = new Int8Array(MAXROOM), RY = new Int8Array(MAXROOM), RW = new Int8Array(MAXROOM), RH = new Int8Array(MAXROOM);
  const P = { x: 0, y: 0, ax: 0, ay: 0, hp: 60, maxhp: 60, mp: 20, maxmp: 20, atk: 6, def: 1, lv: 1, xp: 0, xpn: 20, gold: 0, hunger: 700, maxhunger: 900, vision: 6, kills: 0, turns: 0 };
  const ST = { buff: 0, buffT: 0, haste: 0, hasteT: 0, onStair: false };
  const S = {
    floor: 0, rooms: 0, mons: [], inv: [], eq: [null, null, null], tr: [], goods: null, offer: [], boss: null,
    auto: false, autoT: 0, travel: -1, over: false, shopUsed: false, msgT: 0, waitCd: 0, t: 0
  };
  const L = { ts: 20, top: 0, bot: 0 };
  const _po = { color: '#fff', speed: 60, life: 0.5, size: 2, kind: 0, grav: 0 };

  /* ---------- 布局 ---------- */
  function layout(w, h) { W = w; H = h; L.top = 10; L.bot = h - 62; const vw = Math.max(14, Math.min(MW, Math.floor(w / 22))); const vh = Math.max(10, Math.min(MH, Math.floor((L.bot - L.top) / 18))); ts = clamp(Math.floor(Math.min((w - 16) / vw, (L.bot - L.top - 8) / vh)), 11, 34); L.ts = ts; }

  /* ---------- 地图生成 ---------- */
  function carveRoom(i) { for (let y = RY[i]; y < RY[i] + RH[i]; y++) for (let x = RX[i]; x < RX[i] + RW[i]; x++) T[y * MW + x] = FLOOR; }
  function carveH(x1, x2, y) { const a = Math.min(x1, x2), b = Math.max(x1, x2); for (let x = a; x <= b; x++) T[y * MW + x] = FLOOR; }
  function carveV(y1, y2, x) { const a = Math.min(y1, y2), b = Math.max(y1, y2); for (let y = a; y <= b; y++) T[y * MW + x] = FLOOR; }

  function genFloor() {
    const f = S.floor;
    T.fill(WALL);
    let n = 0;
    for (let tries = 0; tries < 260 && n < MAXROOM; tries++) { const rw = R.int(5, 10), rh = R.int(4, 7); const rx = R.int(1, MW - rw - 2), ry = R.int(1, MH - rh - 2); let ok = true; for (let i = 0; i < n; i++) if (rx < RX[i] + RW[i] + 1 && rx + rw + 1 > RX[i] && ry < RY[i] + RH[i] + 1 && ry + rh + 1 > RY[i]) { ok = false; break; } if (!ok) continue; RX[n] = rx; RY[n] = ry; RW[n] = rw; RH[n] = rh; n++; if (n >= (f >= 8 ? 8 : R.int(6, 10))) break; }
    S.rooms = n;
    for (let i = 0; i < n; i++) carveRoom(i);
    for (let i = 1; i < n; i++) { const ax = RX[i - 1] + (RW[i - 1] >> 1), ay = RY[i - 1] + (RH[i - 1] >> 1); const bx = RX[i] + (RW[i] >> 1), by = RY[i] + (RH[i] >> 1); if (R.chance(0.5)) { carveH(ax, bx, ay); carveV(ay, by, bx); } else { carveV(ay, by, ax); carveH(ax, bx, by); } }
    for (let k = 0; k < 2 && n > 3; k++) { const i = R.int(0, n - 1), j = R.int(0, n - 1); if (i === j) continue; carveH(RX[i] + (RW[i] >> 1), RX[j] + (RW[j] >> 1), RY[i] + (RH[i] >> 1)); carveV(RY[i] + (RH[i] >> 1), RY[j] + (RH[j] >> 1), RX[j] + (RW[j] >> 1)); }
    P.x = RX[0] + (RW[0] >> 1); P.y = RY[0] + (RH[0] >> 1);
    P.ax = P.x; P.ay = P.y;
    if (n > 1) { const lx = RX[n - 1] + (RW[n - 1] >> 1), ly = RY[n - 1] + (RH[n - 1] >> 1); if (f >= 10) { S.boss = spawnMon(BOSS, lx, ly); } else T[ly * MW + lx] = STAIR; }
    const spots = freeSpots();
    R.shuffle(spots);
    let si = 0;
    const chests = R.int(1, 3), traps = clamp(1 + Math.floor(f / 2), 1, 6);
    for (let i = 0; i < chests && si < spots.length; i++) T[spots[si++]] = CHEST;
    for (let i = 0; i < traps && si < spots.length; i++) T[spots[si++]] = TRAP;
    if (R.chance(0.55) && si < spots.length) T[spots[si++]] = ALTAR;
    if (R.chance(0.4) && si < spots.length) T[spots[si++]] = SHOP;
    const mcount = clamp(4 + Math.floor(f * 1.6), 4, 22);
    const tail = Math.max(0, spots.length - si - 1);
    for (let i = 0; i < mcount && tail > 0; i++) { const s = spots[si + R.int(0, tail)]; const x = s % MW, y = (s / MW) | 0; if (dist2p(x, y) < 36 || monAt(x, y)) continue; const cand = []; for (let m = 0; m < MONS.length; m++) if (MONS[m].mf <= f + 1) cand.push(m); spawnMon(MONS[R.pick(cand)], x, y); }
    S.shopUsed = false; ST.onStair = false; S.travel = -1;
    SEEN.fill(0); LIT.fill(0);
    computeFOV();
    for (let i = 0; i < MAXT; i++) if (VIS[i]) LIT[i] = 1;
    camX = P.x + 0.5; camY = P.y + 0.5;
  }
  function freeSpots() { const out = []; for (let i = 1; i < S.rooms; i++) { for (let k = 0; k < 6; k++) { const x = R.int(RX[i], RX[i] + RW[i] - 1), y = R.int(RY[i], RY[i] + RH[i] - 1); const t = y * MW + x; if (T[t] === FLOOR && !(x === P.x && y === P.y)) out.push(t); } } return out; }
  function dist2p(x, y) { const dx = x - P.x, dy = y - P.y; return dx * dx + dy * dy; }

  function spawnMon(def, x, y) { const f = S.floor; const sc = 1 + (def.boss ? 0 : f * 0.12); const m = { d: def, x, y, ax: x, ay: y, n: def.n, hp: Math.round(def.hp * sc), maxhp: Math.round(def.hp * sc), atk: Math.round(def.atk * (1 + f * 0.1)), def: def.def + Math.floor(f / 3), col: def.col, sh: def.sh, mg: def.mg || 0, sp: def.sp, boss: !!def.boss, flash: 0, ice: 0, alive: true }; S.mons.push(m); return m; }

  /* ---------- 视野 ---------- */
  function los(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.max(Math.abs(dx), Math.abs(dy));
    if (n === 0) return true;
    let cx = x0 + 0.5, cy = y0 + 0.5;
    const sx = dx / n * 0.5, sy = dy / n * 0.5;
    for (let i = 0; i < n * 2; i++) { cx += sx; cy += sy; const tx = cx | 0, ty = cy | 0; if (tx === x1 && ty === y1) return true; if (tx === x0 && ty === y0) continue; if (T[ty * MW + tx] === WALL) return false; }
    return true;
  }
  function computeFOV() {
    VIS.fill(0);
    const r = curVision(), r2 = (r + 0.6) * (r + 0.6);
    for (let y = P.y - r; y <= P.y + r; y++) { if (y < 0 || y >= MH) continue; for (let x = P.x - r; x <= P.x + r; x++) { if (x < 0 || x >= MW) continue; const dx = x - P.x, dy = y - P.y; if (dx * dx + dy * dy > r2) continue; if (los(P.x, P.y, x, y)) { const i = y * MW + x; VIS[i] = 1; SEEN[i] = 1; } } }
    VIS[P.y * MW + P.x] = 1; SEEN[P.y * MW + P.x] = 1;
  }

  /* ---------- 寻路 ---------- */
  function bfsFrom(x, y) {
    BFS.fill(-1);
    let head = 0, tail = 0;
    const s = y * MW + x;
    if (T[s] === WALL) return;
    BFS[s] = 0; Q[tail++] = s;
    while (head < tail) { const cur = Q[head++], cd = BFS[cur], cx = cur % MW, cy = (cur / MW) | 0; for (let k = 0; k < 4; k++) { const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0); if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue; const ni = ny * MW + nx; if (BFS[ni] !== -1 || T[ni] === WALL) continue; BFS[ni] = cd + 1; Q[tail++] = ni; } }
  }
  function bfsFrontier() {
    FRO.fill(-1);
    let head = 0, tail = 0;
    for (let i = 0; i < MAXT; i++) { if (!SEEN[i] || T[i] === WALL) continue; const x = i % MW, y = (i / MW) | 0; for (let k = 0; k < 4; k++) { const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0); if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue; const ni = ny * MW + nx; if (T[ni] === WALL || SEEN[ni]) continue; if (FRO[i] === -1) { FRO[i] = 0; Q[tail++] = i; } break; } }
    while (head < tail) { const cur = Q[head++], cd = FRO[cur], cx = cur % MW, cy = (cur / MW) | 0; for (let k = 0; k < 4; k++) { const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0); if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue; const ni = ny * MW + nx; if (FRO[ni] !== -1 || T[ni] === WALL) continue; FRO[ni] = cd + 1; Q[tail++] = ni; } }
  }

  /* ---------- 属性 ---------- */
  function hasTr(f) { for (let i = 0; i < S.tr.length; i++) if (TRAITS[S.tr[i]].f === f) return true; return false; }
  function bagMax() { return 10 + (hasTr('bag') ? 4 : 0); }
  function statAtk() { let a = P.atk + (hasTr('atk') ? 4 : 0) + ST.buff; if (S.eq[0]) a += itemAtk(S.eq[0]); if (S.eq[2]) a += itemAtk(S.eq[2]); return a; }
  function statDef() { let d = P.def + (hasTr('def') ? 3 : 0); if (S.eq[1]) d += itemDef(S.eq[1]); if (S.eq[2]) d += itemDef(S.eq[2]); return d; }
  function statMag() { let m = 0; for (let i = 0; i < 3; i++) if (S.eq[i]) m += S.eq[i].mag | 0; return m; }
  function statCrit() { let k = 8 + (hasTr('crit') ? 10 : 0); for (let i = 0; i < 3; i++) if (S.eq[i]) k += S.eq[i].crit | 0; return k; }
  function statSpd() { let s = 0; for (let i = 0; i < 3; i++) if (S.eq[i]) s += S.eq[i].spd | 0; return s + (ST.hasteT > 0 ? ST.haste : 0); }
  function statReg() { let r = hasTr('regen') ? 2 : 0; for (let i = 0; i < 3; i++) if (S.eq[i]) r += S.eq[i].reg | 0; return r; }
  function statLs() { let l = hasTr('ls') ? 25 : 0; for (let i = 0; i < 3; i++) if (S.eq[i]) l += S.eq[i].ls | 0; return l; }
  function curVision() { return P.vision + (hasTr('vis') ? 3 : 0); }

  function itemStat(it, key) { const b = BASES[it.b], q = QUAL[it.q].m; let v = (b[key] || 0); if (it.pre) v += PRE[it.pre][key] || 0; if (it.suf) v += SUF[it.suf][key] || 0; v *= q; if (key === 'atk' && b.k === 'w' && hasTr('master')) v *= 1.25; return Math.round(v); }
  function itemAtk(it) { return itemStat(it, 'atk'); }
  function itemDef(it) { return itemStat(it, 'def'); }
  function itemName(it) { const b = BASES[it.b]; return (PRE[it.pre].n || '') + b.n + (SUF[it.suf].n || ''); }
  function itemDesc(it) {
    const b = BASES[it.b]; const ps = [];
    const at = itemAtk(it), df = itemDef(it), mg = itemStat(it, 'mag'), cr = itemStat(it, 'crit'), sp = itemStat(it, 'spd'), hp = itemStat(it, 'hp'), ls = itemStat(it, 'ls');
    if (at) ps.push('攻+' + at); if (df) ps.push('防+' + df); if (mg) ps.push('魔+' + mg);
    if (cr) ps.push('暴击+' + cr + '%'); if (sp) ps.push('速度+' + sp); if (hp) ps.push('生命+' + hp); if (ls) ps.push('吸血' + ls + '%');
    if (b.use === 'heal') ps.push('回复 ' + b.v + ' 生命');
    if (b.use === 'mana') ps.push('回复 ' + b.v + ' 法力');
    if (b.use === 'buff') ps.push(b.dur + ' 回合攻击+' + b.v);
    if (b.use === 'haste') ps.push(b.dur + ' 回合额外行动+' + b.v);
    if (b.use === 'fire') ps.push('对视野内敌人造成 ' + b.v + ' 火焰伤害');
    if (b.use === 'ice') ps.push('冻结附近敌人 ' + b.dur + ' 回合');
    if (b.use === 'blink') ps.push('随机传送到远处');
    if (b.use === 'map') ps.push('揭示本层地图');
    if (b.use === 'forge') ps.push('随机强化一件装备');
    if (b.use === 'food') ps.push('饱食度 +' + b.v);
    return ps.join('  ');
  }

  function makeItem(floorLv) {
    const lv = floorLv || S.floor;
    const k = R.pick(['w', 'a', 'r', 'p', 's', 'f']);
    const cand = [];
    for (let i = 0; i < BASES.length; i++) if (BASES[i].k === k) cand.push(i);
    const b = R.pick(cand);
    const q = clamp(Math.floor(R.gauss() * 1.1 + lv * 0.28), 0, 4);
    const it = { b, q, pre: 0, suf: 0, n: 1 };
    if (BASES[b].k === 'w' || BASES[b].k === 'a' || BASES[b].k === 'r') { it.pre = R.int(0, PRE.length - 1); it.suf = R.chance(0.55) ? R.int(1, SUF.length - 1) : 0; }
    if (BASES[b].k === 'p' || BASES[b].k === 's' || BASES[b].k === 'f') it.n = R.int(1, k === 'f' ? 3 : 2);
    return it;
  }
  function addItem(it) { for (let i = 0; i < S.inv.length; i++) { const o = S.inv[i]; if (o.b === it.b && o.q === it.q && o.pre === it.pre && o.suf === it.suf && (BASES[o.b].k === 'p' || BASES[o.b].k === 's' || BASES[o.b].k === 'f')) { o.n += it.n; return true; } } if (S.inv.length >= bagMax()) return false; S.inv.push(it); return true; }
  function dropFromInv(i) { S.inv.splice(i, 1); }
  function slotOf(k) { return k === 'w' ? 0 : k === 'a' ? 1 : 2; }

  /* ---------- 战斗 ---------- */
  function monAt(x, y) { for (let i = 0; i < S.mons.length; i++) { const m = S.mons[i]; if (m.alive && m.x === x && m.y === y) return m; } return null; }

  function playerHit(m) {
    const a = statAtk() + statMag();
    let dmg = Math.max(1, a - m.def + R.int(-1, 2));
    const crit = R.chance(statCrit() / 100);
    if (crit) dmg = Math.round(dmg * 1.9);
    m.hp -= dmg; m.flash = 0.28;
    const wx = (m.ax - camX) * ts + W / 2, wy = (m.ay - camY) * ts + (L.top + L.bot) / 2;
    _po.color = crit ? '#ffb020' : '#22e0ff'; _po.speed = 90; _po.life = 0.4; _po.size = 2.4; _po.kind = 1; _po.grav = 120;
    PT.burst(wx, wy, crit ? 12 : 7, _po);
    PT.text(wx, wy - ts * 0.5, (crit ? '暴击 ' : '') + dmg, crit ? '#ffb020' : '#eaf2ff');
    A.sfx(crit ? 'explode' : 'hit', { detune: crit ? 6 : 0 });
    ctx.shake.add(crit ? 0.34 : 0.16); ctx.vibrate(crit ? PATTERNS.explode : PATTERNS.hit);
    if (statLs() > 0) healPlayer(Math.round(dmg * statLs() / 100), false);
    if (crit && hasTr('chain')) { m.hp -= Math.max(1, Math.round(dmg * 0.5)); PT.text(wx, wy - ts, '连锁', '#ff2e88'); }
    if (m.hp <= 0) killMon(m);
    return true;
  }
  function killMon(m) {
    m.alive = false; P.kills++;
    const wx = (m.ax - camX) * ts + W / 2, wy = (m.ay - camY) * ts + (L.top + L.bot) / 2;
    _po.color = m.col; _po.speed = 130; _po.life = 0.6; _po.size = 3; _po.kind = 4; _po.grav = 200;
    PT.burst(wx, wy, m.boss ? 40 : 16, _po);
    PT.ring(wx, wy, m.col, m.boss ? 90 : 34);
    A.sfx(m.boss ? 'explode' : 'die');
    ctx.shake.add(m.boss ? 0.8 : 0.2);
    gainXp(m.d.xp);
    const g = Math.round((R.int(3, 12) + S.floor * 3) * (hasTr('gold') ? 1.6 : 1));
    P.gold += g; PT.text(wx, wy + ts * 0.4, '+' + g + '金', '#ffb020');
    if (hasTr('kill')) { healPlayer(5, false); P.mp = Math.min(P.maxmp, P.mp + 3); }
    if (R.chance(0.16)) { const it = makeItem(); if (addItem(it)) say('拾得 ' + itemName(it)); }
    if (m.boss) winRun();
  }
  function monHitPlayer(m) {
    const dodge = 5 + statSpd() * 3;
    if (R.chance(dodge / 100)) { PT.text(W / 2, (L.top + L.bot) / 2 - ts, '闪避', '#22e0ff'); A.sfx('dash'); return; }
    let dmg = Math.max(1, m.atk - statDef() + R.int(-1, 2));
    if (m.mg) dmg += Math.max(0, m.mg - Math.floor(statMag() / 2));
    if (R.chance(0.08)) dmg = Math.round(dmg * 1.7);
    hurtPlayer(dmg, m.n);
    if (hasTr('thorn') && !m.mg) { m.hp -= Math.round(dmg * 0.3); if (m.hp <= 0) killMon(m); }
    if (m.d && m.n === '怨灵' && P.mp > 0) P.mp = Math.max(0, P.mp - 4);
  }
  function hurtPlayer(d, cause) { P.hp -= d; ctx.shake.add(0.3); ctx.flash.add(0.34, '#ff4d5e'); A.sfx('hurt'); ctx.vibrate(PATTERNS.damage); PT.text(W / 2, (L.top + L.bot) / 2 - ts * 0.8, '-' + d, '#ff4d5e'); if (P.hp <= 0) die('被' + (cause || '未知存在') + '击杀'); }
  function healPlayer(v, fx) { const before = P.hp; P.hp = Math.min(P.maxhp, P.hp + v); if (fx && P.hp > before) { PT.text(W / 2, (L.top + L.bot) / 2 - ts, '+' + (P.hp - before), '#28e0a0'); _po.color = '#28e0a0'; _po.speed = 40; _po.life = 0.7; _po.size = 2; _po.kind = 0; _po.grav = -40; PT.burst(W / 2, (L.top + L.bot) / 2, 10, _po); A.sfx('heal'); } }
  function gainXp(n) { P.xp += Math.round(n * (hasTr('xp') ? 1.5 : 1)); while (P.xp >= P.xpn) { P.xp -= P.xpn; P.lv++; P.xpn = Math.round(P.xpn * 1.45); P.maxhp += 6; P.maxmp += 3; P.atk += 1; P.def += 0.6; P.hp = P.maxhp; P.mp = P.maxmp; A.sfx('powerup'); ctx.flash.add(0.3, '#8dff4d'); PT.text(W / 2, (L.top + L.bot) / 2 - ts * 1.4, '升级！Lv.' + P.lv, '#8dff4d'); offerTrait(); } }

  /* ---------- 回合 ---------- */
  function walkable(x, y) { return x >= 0 && y >= 0 && x < MW && y < MH && T[y * MW + x] !== WALL; }

  function tryMove(dx, dy) { const nx = P.x + dx, ny = P.y + dy; if (!walkable(nx, ny)) { A.sfx('error'); return false; } const m = monAt(nx, ny); if (m) { playerHit(m); afterPlayerAct(); return true; } P.x = nx; P.y = ny; afterPlayerAct(); return true; }
  function interact() { const t = T[P.y * MW + P.x]; if (t === CHEST) openChest(); else if (t === ALTAR) prayAltar(); else if (t === SHOP) openShop(); else if (t === STAIR) descend(); else return false; return true; }
  function afterPlayerAct() {
    const t = T[P.y * MW + P.x];
    if (t === TRAP) { T[P.y * MW + P.x] = FLOOR; const d = R.int(4, 9) + S.floor * 2; A.sfx('alarm'); ctx.flash.add(0.3, '#ff4d5e'); say('触发陷阱！-' + d + ' HP'); hurtPlayer(d, '陷阱'); }
    else if (t === CHEST) openChest();
    else if (t === ALTAR) prayAltar();
    else if (t === SHOP) openShop();
    ST.onStair = (t === STAIR);
    P.turns++;
    P.hunger -= hasTr('slow') ? 0.65 : 1;
    if (P.hunger <= 0) { P.hunger = 0; if (P.turns % 2 === 0) hurtPlayer(2, '饥饿'); }
    if (ST.buffT > 0 && --ST.buffT === 0) ST.buff = 0;
    if (ST.hasteT > 0 && --ST.hasteT === 0) ST.haste = 0;
    if (P.turns % 10 === 0) { const r = statReg(); if (r) healPlayer(r, false); }
    if (P.mp < P.maxmp && P.turns % 4 === 0) P.mp++;
    computeFOV();
    bfsFrom(P.x, P.y);
    monTurn();
    updateHud();
  }

  function monTurn() {
    for (let i = 0; i < S.mons.length; i++) {
      const m = S.mons[i];
      if (!m.alive) continue;
      if (m.ice > 0) { m.ice--; continue; }
      const dx = m.x - P.x, dy = m.y - P.y;
      const d2 = dx * dx + dy * dy;
      const aggro = (m.d.vi + (m.boss ? 6 : 0)) - (hasTr('stealth') ? 2 : 0);
      const aware = d2 <= aggro * aggro && (d2 <= 4 || VIS[m.y * MW + m.x]);
      if (!aware) { if (R.chance(0.25)) wander(m); continue; }
      if (d2 <= 2) { monHitPlayer(m); continue; }
      if (m.mg && d2 <= m.mg * m.mg && R.chance(0.5)) { const dmg = Math.max(1, m.atk + m.mg * 2 - Math.floor(statDef() * 0.5)); hurtPlayer(dmg, m.n + '的法术'); glowFx(m.x, m.y, P.x, P.y, '#ff2e88'); continue; }
      const steps = m.sp;
      for (let s = 0; s < steps; s++) { if ((m.x - P.x) * (m.x - P.x) + (m.y - P.y) * (m.y - P.y) <= 2) { monHitPlayer(m); break; } moveMonToward(m); }
    }
    for (let i = S.mons.length - 1; i >= 0; i--) if (!S.mons[i].alive) S.mons.splice(i, 1);
  }
  function wander(m) { const d = R.int(0, 3); const nx = m.x + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = m.y + (d === 2 ? 1 : d === 3 ? -1 : 0); if (walkable(nx, ny) && !monAt(nx, ny) && !(nx === P.x && ny === P.y)) { m.x = nx; m.y = ny; } }
  function moveMonToward(m) {
    const cur = BFS[m.y * MW + m.x];
    let best = cur, bx = -1, by = -1;
    for (let k = 0; k < 4; k++) { const nx = m.x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = m.y + (k === 2 ? 1 : k === 3 ? -1 : 0); if (!walkable(nx, ny)) continue; if (nx === P.x && ny === P.y) { m.x = nx; m.y = ny; return; } if (monAt(nx, ny)) continue; const v = BFS[ny * MW + nx]; if (v >= 0 && v < best) { best = v; bx = nx; by = ny; } }
    if (bx >= 0) { m.x = bx; m.y = by; }
  }
  function glowFx(x1, y1, x2, y2, col) { const ax = (x1 - camX) * ts + W / 2 + ts / 2, ay = (y1 - camY) * ts + (L.top + L.bot) / 2 + ts / 2; const bx = (x2 - camX) * ts + W / 2 + ts / 2, by = (y2 - camY) * ts + (L.top + L.bot) / 2 + ts / 2; glowLine(c, ax, ay, bx, by, col, 3, 14, 0.9); _po.color = col; _po.speed = 70; _po.life = 0.4; _po.size = 2.2; _po.kind = 0; _po.grav = 0; PT.burst(bx, by, 8, _po); }

  /* ---------- 地牢交互 ---------- */
  function openChest() { T[P.y * MW + P.x] = FLOOR; const it = makeItem(S.floor + 1); if (addItem(it)) { say('打开宝箱：' + itemName(it)); } else say('背包已满，宝箱里的东西拿不下了'); const g = Math.round(R.int(10, 30) * (hasTr('gold') ? 1.6 : 1)); P.gold += g; A.sfx('coin'); _po.color = '#ffb020'; _po.speed = 70; _po.life = 0.6; _po.size = 2.4; _po.kind = 4; _po.grav = 180; PT.burst(W / 2, (L.top + L.bot) / 2, 14, _po); updateHud(); }
  function prayAltar() {
    T[P.y * MW + P.x] = FLOOR;
    const r = R.range(0, 1);
    A.sfx('powerup'); ctx.flash.add(0.4, '#a855f7');
    _po.color = '#a855f7'; _po.speed = 60; _po.life = 0.8; _po.size = 2.6; _po.kind = 0; _po.grav = -50;
    PT.burst(W / 2, (L.top + L.bot) / 2, 18, _po);
    if (r < 0.4) { P.maxhp += 8; P.hp = P.maxhp; say('祭坛赐福：生命上限 +8 并回满'); }
    else if (r < 0.7) { const it = makeItem(S.floor + 2); if (addItem(it)) say('祭坛赐予：' + itemName(it)); else say('背包已满'); }
    else if (r < 0.9) { healPlayer(Math.round(P.maxhp * 0.35), true); say('祭坛治愈了你'); }
    else { const d = Math.round(P.maxhp * 0.12); say('祭坛的代价：-' + d + ' HP'); hurtPlayer(d, '祭坛'); }
    updateHud();
  }
  function openShop() { if (S.shopUsed) return; S.shopUsed = true; const goods = []; for (let i = 0; i < 4; i++) { const it = makeItem(S.floor + 1); const price = Math.round((20 + QUAL[it.q].m * 30 + S.floor * 6) * R.range(0.85, 1.2)); goods.push({ it, price, sold: false }); } S.goods = goods; showShopPanel(); }
  function buyGood(i) { const g = S.goods[i]; if (!g || g.sold) return; if (P.gold < g.price) { A.sfx('error'); say('金币不足'); return; } if (!addItem(g.it)) { A.sfx('error'); say('背包已满'); return; } P.gold -= g.price; g.sold = true; A.sfx('coin'); say('买入 ' + itemName(g.it)); updateHud(); showShopPanel(); }
  function descend() { if (S.floor >= 10) return; S.floor++; A.sfx('portal'); ctx.flash.add(0.5, '#22e0ff'); S.mons.length = 0; genFloor(); say('下到第 ' + S.floor + ' 层'); if (S.floor === 10) say('深渊领主在此层等你'); updateHud(); }

  /* ---------- 物品使用 ---------- */
  function useItem(i) {
    const it = S.inv[i]; if (!it) return;
    const b = BASES[it.b];
    if (b.k === 'w' || b.k === 'a' || b.k === 'r') { equipItem(i); return; }
    if (b.use === 'heal') { healPlayer(b.v + Math.round(statMag() * 0.5), true); }
    else if (b.use === 'mana') { P.mp = Math.min(P.maxmp, P.mp + b.v); A.sfx('powerup'); PT.text(W / 2, (L.top + L.bot) / 2, '+' + b.v + ' MP', '#22e0ff'); }
    else if (b.use === 'buff') { ST.buff = b.v; ST.buffT = b.dur; A.sfx('powerup'); }
    else if (b.use === 'haste') { ST.haste = b.v; ST.hasteT = b.dur; A.sfx('powerup'); }
    else if (b.use === 'food') { P.hunger = Math.min(P.maxhunger, P.hunger + b.v); if (b.mp) P.mp = Math.min(P.maxmp, P.mp + b.mp); A.sfx('heal'); }
    else if (b.use === 'fire') castFire(b.v);
    else if (b.use === 'ice') castIce(b.dur);
    else if (b.use === 'blink') castBlink();
    else if (b.use === 'map') { SEEN.fill(1); A.sfx('portal'); ctx.flash.add(0.35, '#8dff4d'); }
    else if (b.use === 'forge') castForge();
    it.n--; if (it.n <= 0) dropFromInv(i);
    A.sfx('select');
    refreshInv();
  }
  function castFire(v) { let hitN = 0; const dmg = v + statMag() * 2; for (let i = S.mons.length - 1; i >= 0; i--) { const m = S.mons[i]; if (!m.alive || !VIS[m.y * MW + m.x]) continue; m.hp -= dmg; m.flash = 0.3; hitN++; glowFx(P.x, P.y, m.x, m.y, '#ff4d5e'); if (m.hp <= 0) killMon(m); } ctx.flash.add(0.4, '#ff4d5e'); ctx.shake.add(0.4); A.sfx('explode'); say('烈焰灼烧了 ' + hitN + ' 个敌人'); }
  function castIce(dur) { let n = 0; for (let i = 0; i < S.mons.length; i++) { const m = S.mons[i]; if (!m.alive || !VIS[m.y * MW + m.x]) continue; m.ice = dur; n++; glowFx(P.x, P.y, m.x, m.y, '#22e0ff'); } A.sfx('charge'); say('冻结了 ' + n + ' 个敌人'); }
  function castBlink() { for (let k = 0; k < 200; k++) { const x = R.int(1, MW - 2), y = R.int(1, MH - 2); if (T[y * MW + x] !== WALL && !monAt(x, y)) { P.x = x; P.y = y; P.ax = x; P.ay = y; break; } } A.sfx('portal'); ctx.flash.add(0.3, '#a855f7'); computeFOV(); }
  function castForge() { const cand = []; for (let i = 0; i < 3; i++) if (S.eq[i]) cand.push(S.eq[i]); if (!cand.length) { say('没有可强化的装备'); return; } const it = R.pick(cand); if (it.q < 4) it.q++; else { it.atkBonus = (it.atkBonus || 0) + 2; } A.sfx('powerup'); ctx.flash.add(0.3, '#ffb020'); say('强化了 ' + itemName(it)); }
  function equipItem(i) { const it = S.inv[i], b = BASES[it.b], slot = slotOf(b.k); const old = S.eq[slot]; S.eq[slot] = it; dropFromInv(i); if (old) S.inv.splice(i, 0, old); A.sfx('select'); if (b.mp) P.maxmp += b.mp; refreshInv(); }
  function unequip(slot) { const it = S.eq[slot]; if (!it) return; if (S.inv.length >= bagMax()) { A.sfx('error'); return; } S.eq[slot] = null; S.inv.push(it); if (BASES[it.b].mp) P.maxmp -= BASES[it.b].mp; A.sfx('back'); refreshInv(); }
  function dropItem(i) { dropFromInv(i); A.sfx('back'); refreshInv(); }

  /* ---------- 特质 / 升级 / 结局 ---------- */
  function offerTrait() { const cand = []; for (let i = 0; i < TRAITS.length; i++) if (S.tr.indexOf(i) < 0) cand.push(i); if (!cand.length) return; R.shuffle(cand); S.offer = cand.slice(0, 3); showTraitPanel(); }
  function pickTrait(i) { if (S.tr.indexOf(i) < 0) { S.tr.push(i); const t = TRAITS[i]; if (t.f === 'hp') { P.maxhp += 20; P.hp = P.maxhp; } if (t.f === 'mp') { P.maxmp += 20; P.mp = P.maxmp; } A.sfx('confirm'); ctx.flash.add(0.3, '#8dff4d'); say('获得特质：' + t.n); } hidePanel(); }
  function score() { return P.gold + P.kills * 12 + S.floor * 120 + P.lv * 60 + P.turns; }
  function winRun() { if (S.over) return; S.over = true; A.sfx('win'); ctx.vibrate(PATTERNS.win); ctx.flash.add(0.7, '#8dff4d'); ctx.finish(score(), { win: true, higherBetter: true, stats: { 楼层: 10, 等级: P.lv, 击杀: P.kills, 金币: P.gold } }); }
  function die(cause) { if (S.over) return; S.over = true; P.hp = 0; A.sfx('lose'); ctx.vibrate(PATTERNS.lose); ctx.flash.add(0.7, '#ff4d5e'); ctx.shake.add(0.8); ctx.finish(score(), { win: false, higherBetter: true, stats: { 楼层: S.floor, 等级: P.lv, 击杀: P.kills, 死因: cause } }); }

  /* ---------- 自动探索 ---------- */
  function stopAuto() { S.auto = false; S.travel = -1; }
  function stepAuto() {
    if (S.over || panelOpen) { stopAuto(); return; }
    if (visibleEnemy()) { stopAuto(); return; }
    if (P.hp < P.maxhp * 0.3) { stopAuto(); say('生命过低，停止探索'); return; }
    let tx = -1, ty = -1;
    if (S.travel >= 0) { tx = S.travel % MW; ty = (S.travel / MW) | 0; }
    else {
      bfsFrontier();
      let best = 1e9;
      for (let k = 0; k < 4; k++) { const nx = P.x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = P.y + (k === 2 ? 1 : k === 3 ? -1 : 0); if (!walkable(nx, ny) || monAt(nx, ny)) continue; const v = FRO[ny * MW + nx]; if (v >= 0 && v < best) { best = v; tx = nx; ty = ny; } }
      if (tx < 0) { stopAuto(); say('本层已探索完毕'); return; }
      tryMove(tx - P.x, ty - P.y);
      if (S.travel >= 0 && P.x === S.travel % MW && P.y === ((S.travel / MW) | 0)) S.travel = -1;
      return;
    }
    if (P.x === tx && P.y === ty) { S.travel = -1; return; }
    bfsFrom(tx, ty);
    let best = 1e9, bx = -1, by = -1;
    for (let k = 0; k < 4; k++) { const nx = P.x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = P.y + (k === 2 ? 1 : k === 3 ? -1 : 0); if (!walkable(nx, ny)) continue; const v = BFS[ny * MW + nx]; if (v >= 0 && v < best) { best = v; bx = nx; by = ny; } }
    if (bx < 0) { S.travel = -1; return; }
    const m = monAt(bx, by);
    if (m) { playerHit(m); afterPlayerAct(); return; }
    P.x = bx; P.y = by; afterPlayerAct();
    if (P.x === tx && P.y === ty) S.travel = -1;
  }
  function visibleEnemy() { for (let i = 0; i < S.mons.length; i++) { const m = S.mons[i]; if (m.alive && VIS[m.y * MW + m.x]) return true; } return false; }

  /* ---------- 消息 & HUD ---------- */
  const MSGS = [];
  function say(s) { MSGS.push(s); if (MSGS.length > 4) MSGS.shift(); S.msgT = 3.2; }
  function updateHud() {
    ctx.hud('hp', '生命', P.hp + '/' + P.maxhp, { color: P.hp < P.maxhp * 0.35 ? PALETTE.red : PALETTE.green });
    ctx.hud('mp', '法力', P.mp + '/' + P.maxmp, { color: PALETTE.cyan });
    ctx.hud('floor', '层数', S.floor + '/10');
    ctx.hud('lv', '等级', 'Lv.' + P.lv + ' (' + Math.floor(P.xp / P.xpn * 100) + '%)');
    ctx.hud('gold', '金币', String(P.gold), { color: PALETTE.amber });
    ctx.hud('food', '饱食', Math.round(P.hunger / P.maxhunger * 100) + '%', { color: P.hunger < 150 ? PALETTE.red : PALETTE.lime });
  }

  /* ---------- DOM 覆盖层 ---------- */
  let barEl = null, panelEl = null, panelCb = null, panelOpen = false;
  let btnAuto = null, btnStair = null;
  function mkBtn(label, fn, parent) { const b = document.createElement('button'); b.className = 'btn btn-ghost'; b.textContent = label; b.style.cssText = 'padding:6px 10px;font-size:12px;'; b.addEventListener('click', () => { A.sfx('click'); ctx.vibrate(PATTERNS.tap); fn(); }); parent.appendChild(b); return b; }
  function buildBar() {
    barEl = document.createElement('div');
    barEl.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:58px;display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;background:none;pointer-events:auto;';
    ctx.overlay(barEl);
    mkBtn('背包', () => { if (panelOpen) hidePanel(); else showInv(); }, barEl);
    mkBtn('特质', () => { if (panelOpen) hidePanel(); else showTraitList(); }, barEl);
    btnAuto = mkBtn('自动探索', () => { S.auto = !S.auto; S.travel = -1; btnAuto.textContent = S.auto ? '停止探索' : '自动探索'; A.sfx('click'); }, barEl);
    mkBtn('等待', () => { if (!S.over) { A.sfx('tick'); afterPlayerAct(); } }, barEl);
    btnStair = mkBtn('下楼', () => { if (ST.onStair) descend(); else { A.sfx('error'); say('不在楼梯上'); } }, barEl);
    btnStair.disabled = true;
  }
  function buildPanel() {
    panelEl = document.createElement('div');
    panelEl.style.cssText = 'position:absolute;right:auto;bottom:auto;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,92vw);max-height:74%;overflow:auto;display:none;padding:14px 16px;background:rgba(10,14,28,.94);border:1px solid #2b3a63;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.55);color:#eaf2ff;font-size:13px;z-index:20;pointer-events:auto;';
    ctx.overlay(panelEl);
    panelEl.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const act = t.getAttribute('data-act'), arg = t.getAttribute('data-arg');
      A.sfx('click');
      const cb = panelCb;
      if (act === 'close') { hidePanel(); return; }
      if (cb) cb(act, arg);
    });
  }
  function showPanel(title, html, cb) { panelCb = cb || null; panelOpen = true; panelEl.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="color:#22e0ff;font-size:15px">' + title + '</b><button class="btn btn-ghost" data-act="close" style="padding:4px 8px;font-size:12px">关闭</button></div>' + html; panelEl.style.display = 'block'; }
  function hidePanel() { panelOpen = false; panelCb = null; if (panelEl) panelEl.style.display = 'none'; }
  function rowHtml(label, sub, act, arg, color) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;margin-bottom:6px;border:1px solid #243357;border-radius:8px;background:rgba(255,255,255,.03)">' +
      '<span style="flex:1;color:' + (color || '#eaf2ff') + '">' + label + (sub ? '<span style="color:#7d8db3;font-size:11px"> — ' + sub + '</span>' : '') + '</span>' +
      '<button class="btn btn-ghost" data-act="' + act + '" data-arg="' + arg + '" style="padding:4px 8px;font-size:11px">' + (act === 'use' ? '使用' : act === 'equip' ? '装备' : act === 'drop' ? '丢弃' : act === 'unequip' ? '卸下' : act === 'buy' ? '购买' : act === 'pick' ? '选择' : '确定') + '</button></div>';
  }
  function refreshInv() { if (panelOpen && panelCb === cbInv) showInv(); }
  const cbInv = (act, arg) => {
    const i = +arg;
    if (act === 'use') { useItem(i); }
    else if (act === 'drop') { dropItem(i); }
    else if (act === 'unequip') { unequip(i); refreshInv(); }
  };
  function showInv() {
    let h = '<div style="color:#7d8db3;font-size:12px;margin-bottom:8px">背包 ' + S.inv.length + '/' + bagMax() + '　金币 ' + P.gold + '</div>';
    for (let s = 0; s < 3; s++) {
      const it = S.eq[s];
      const nm = ['武器', '护甲', '戒指'][s];
      h += '<div style="padding:6px 8px;margin-bottom:6px;border:1px solid #3b82f6;border-radius:8px;background:rgba(59,130,246,.08)">' +
        '<span style="color:#3b82f6;font-size:11px">' + nm + '</span> ' +
        (it ? '<span style="color:' + QUAL[it.q].c + '">' + itemName(it) + '</span> <span style="color:#7d8db3;font-size:11px">' + itemDesc(it) + '</span>' : '<span style="color:#44506e">空</span>') +
        (it ? ' <button class="btn btn-ghost" data-act="unequip" data-arg="' + s + '" style="padding:3px 7px;font-size:11px;float:right">卸下</button>' : '') + '</div>';
    }
    if (!S.inv.length) h += '<div style="color:#44506e;padding:10px">背包是空的</div>';
    for (let i = 0; i < S.inv.length; i++) { const it = S.inv[i], b = BASES[it.b]; const act = (b.k === 'w' || b.k === 'a' || b.k === 'r') ? 'equip' : 'use'; h += rowHtml('[' + QUAL[it.q].n + '] ' + itemName(it) + (it.n > 1 ? ' x' + it.n : ''), itemDesc(it), act, i, QUAL[it.q].c); }
    showPanel('背包', h, cbInv);
  }
  function showTraitList() { let h = ''; if (!S.tr.length) h += '<div style="color:#44506e">还没有特质，升级可获得</div>'; for (let i = 0; i < S.tr.length; i++) { const t = TRAITS[S.tr[i]]; h += '<div style="padding:6px 8px;margin-bottom:6px;border:1px solid #8dff4d;border-radius:8px"><span style="color:#8dff4d">' + t.n + '</span> <span style="color:#7d8db3;font-size:11px">' + t.d + '</span></div>'; } showPanel('特质', h, null); }
  function showTraitPanel() { let h = '<div style="color:#7d8db3;font-size:12px;margin-bottom:8px">升级！选择一个永久特质</div>'; for (let i = 0; i < S.offer.length; i++) { const t = TRAITS[S.offer[i]]; h += rowHtml(t.n, t.d, 'pick', S.offer[i], '#8dff4d'); } showPanel('选择特质', h, (act, arg) => { if (act === 'pick') pickTrait(+arg); }); }
  function showShopPanel() {
    let h = '<div style="color:#7d8db3;font-size:12px;margin-bottom:8px">金币 ' + P.gold + '　（离开后商店将关闭）</div>';
    for (let i = 0; i < S.goods.length; i++) {
      const g = S.goods[i], it = g.it;
      h += '<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;margin-bottom:6px;border:1px solid #243357;border-radius:8px">' +
        '<span style="flex:1;color:' + QUAL[it.q].c + '">' + itemName(it) + (it.n > 1 ? ' x' + it.n : '') +
        '<span style="color:#7d8db3;font-size:11px"> ' + itemDesc(it) + '</span></span>' +
        (g.sold ? '<span style="color:#44506e;font-size:12px">已售出</span>' : '<button class="btn btn-ghost" data-act="buy" data-arg="' + i + '" style="padding:4px 8px;font-size:11px">' + g.price + ' 金</button>') + '</div>';
    }
    h += '<button class="btn btn-ghost" data-act="close" style="padding:6px 12px;font-size:12px;margin-top:4px">离开商店</button>';
    showPanel('地牢商贩', h, (act, arg) => { if (act === 'buy') buyGood(+arg); });
  }

  /* ---------- 输入 ---------- */
  let lastDir = 0;
  function readInput(dt) {
    const I = ctx.input;
    if (S.over) return;
    if (S.waitCd > 0) S.waitCd -= dt;
    let dx = 0, dy = 0;
    if (I.consume('up')) dy = -1;
    else if (I.consume('down')) dy = 1;
    else if (I.consume('left')) dx = -1;
    else if (I.consume('right')) dx = 1;
    if (!dx && !dy) { if (I.rawDown('KeyW')) dy = -1; else if (I.rawDown('KeyS')) dy = 1; else if (I.rawDown('KeyA')) dx = -1; else if (I.rawDown('KeyD')) dx = 1; if (dx || dy) { lastDir -= dt; if (lastDir > 0) { dx = 0; dy = 0; } else lastDir = 0.15; } else lastDir = 0; }
    if (dx || dy) { stopAuto(); tryMove(dx, dy); return; }
    const wait = I.consume('jump') || I.consume('confirm') || I.consume('interact') || (I.rawDown('Period') && S.waitCd <= 0);
    if (wait) { stopAuto(); S.waitCd = 0.25; if (!interact()) afterPlayerAct(); return; }
    if (I.consume('dash')) { stopAuto(); afterPlayerAct(); }
  }

  const offs = [];
  function onPointerDown(e) {
    if (S.over || panelOpen) return;
    const r = ctx.canvas.getBoundingClientRect();
    const px = (e.clientX - r.left), py = (e.clientY - r.top);
    const wx = Math.floor((px - W / 2) / ts + camX), wy = Math.floor((py - (L.top + L.bot) / 2) / ts + camY);
    if (wx < 0 || wy < 0 || wx >= MW || wy >= MH) return;
    if (wx === P.x && wy === P.y) { interact(); return; }
    if (!SEEN[wy * MW + wx] || T[wy * MW + wx] === WALL) return;
    const m = monAt(wx, wy);
    if (m && Math.abs(wx - P.x) + Math.abs(wy - P.y) === 1) { stopAuto(); playerHit(m); afterPlayerAct(); return; }
    S.travel = wy * MW + wx; S.auto = true;
    if (btnAuto) btnAuto.textContent = '停止探索';
    A.sfx('select');
  }

  /* ---------- 更新 ---------- */
  function update(dt) {
    S.t += dt;
    if (!S.over && !panelOpen) readInput(dt);
    if (S.auto && !panelOpen && !S.over) { S.autoT -= dt; if (S.autoT <= 0) { S.autoT = 0.11; stepAuto(); } }
    const k = 1 - Math.exp(-14 * dt);
    P.ax = lerp(P.ax, P.x, k); P.ay = lerp(P.ay, P.y, k);
    camX = lerp(camX, P.ax + 0.5, 1 - Math.exp(-9 * dt));
    camY = lerp(camY, P.ay + 0.5, 1 - Math.exp(-9 * dt));
    for (let i = 0; i < S.mons.length; i++) { const m = S.mons[i]; m.ax = lerp(m.ax, m.x, 1 - Math.exp(-11 * dt)); m.ay = lerp(m.ay, m.y, 1 - Math.exp(-11 * dt)); if (m.flash > 0) m.flash -= dt; }
    const lk = 1 - Math.exp(-7 * dt);
    for (let i = 0; i < MAXT; i++) { const t = VIS[i] ? 1 : SEEN[i] ? 0.4 : 0; LIT[i] += (t - LIT[i]) * lk; }
    if (btnStair) { const want = ST.onStair && S.floor < 10; if (btnStair.disabled === want) { btnStair.disabled = !want; btnStair.style.opacity = want ? '1' : '.45'; } }
    if (S.msgT > 0) S.msgT -= dt;
  }

  /* ---------- 渲染 ---------- */
  function sxOf(x) { return (x - camX) * ts + W / 2; }
  function syOf(y) { return (y - camY) * ts + (L.top + L.bot) / 2; }

  function drawTile(x, y, i) {
    const lit = LIT[i];
    if (lit < 0.02) return;
    const px = sxOf(x), py = syOf(y);
    if (px < -ts || py < -ts || px > W || py > H) return;
    const t = T[i], s = ts - 1;
    if (t === WALL) { fillRound(c, px, py, s, s, 3, 'rgba(19,28,51,' + (0.35 + lit * 0.6) + ')'); strokeRound(c, px, py, s, s, 3, 'rgba(36,51,87,' + (0.25 + lit * 0.5) + ')', 1); return; }
    fillRound(c, px, py, s, s, 3, 'rgba(13,20,38,' + (0.3 + lit * 0.55) + ')');
    strokeRound(c, px, py, s, s, 3, 'rgba(34,224,255,' + (lit * 0.12) + ')', 1);
    const cx = px + s / 2, cy = py + s / 2;
    if (t === STAIR) {
      for (let k = 0; k < 3; k++) strokeRound(c, px + 2 + k * 2, py + 3 + k * 3, s - 4 - k * 4, s - 6 - k * 6, 2, 'rgba(168,85,247,' + lit + ')', 1.6);
      glowDot(c, cx, cy, 2.2, PALETTE.violet, lit);
    } else if (t === CHEST) {
      fillRound(c, cx - s * 0.28, cy - s * 0.22, s * 0.56, s * 0.44, 2, 'rgba(255,176,32,' + (0.25 + lit * 0.35) + ')');
      strokeRound(c, cx - s * 0.28, cy - s * 0.22, s * 0.56, s * 0.44, 2, PALETTE.amber, 1.4);
      glowDot(c, cx, cy, 1.8, PALETTE.amber, lit * (0.6 + 0.4 * Math.sin(S.t * 3)));
    } else if (t === TRAP && SEEN[i]) {
      strokeRound(c, cx - s * 0.26, cy - s * 0.26, s * 0.52, s * 0.52, 2, 'rgba(255,77,94,' + lit + ')', 1.4);
      glowDot(c, cx, cy, 1.4, PALETTE.red, lit * (0.5 + 0.5 * Math.sin(S.t * 5)));
    } else if (t === ALTAR) {
      glowCircle(c, cx, cy, s * 0.3, PALETTE.violet, { glow: 10, width: 1.6, alpha: lit });
      glowDot(c, cx, cy, 2, '#fff', lit * (0.4 + 0.4 * Math.sin(S.t * 2)));
    } else if (t === SHOP) {
      fillRound(c, cx - s * 0.26, cy - s * 0.3, s * 0.52, s * 0.6, 2, 'rgba(40,224,160,' + (0.2 + lit * 0.3) + ')');
      strokeRound(c, cx - s * 0.26, cy - s * 0.3, s * 0.52, s * 0.6, 2, PALETTE.green, 1.4);
      text(c, '$', cx, cy, { size: Math.max(8, s * 0.42), color: PALETTE.green, alpha: lit });
    }
    if (t === FLOOR && lit > 0.9 && R.chance(0.0006)) glowDot(c, cx, cy, 1, '#22e0ff', 0.25);
  }

  function drawMon(m) {
    const i = m.y * MW + m.x;
    if (!VIS[i]) return;
    const lit = LIT[i];
    const px = sxOf(m.ax) + ts / 2, py = syOf(m.ay) + ts / 2;
    const r = ts * (m.boss ? 0.46 : 0.36);
    const hurt = m.flash > 0;
    const col = hurt ? '#fff' : (m.ice > 0 ? '#22e0ff' : m.col);
    c.save();
    c.translate(px, py);
    const bob = Math.sin(S.t * 2.4 + m.x * 0.7) * ts * 0.05;
    c.translate(0, bob);
    if (m.boss) { glowCircle(c, 0, 0, r * 1.5, m.col, { glow: 16, width: 1.4, alpha: 0.35 }); }
    shapePath(m.sh, r, m.boss ? S.t : 0);
    c.fillStyle = 'rgba(10,14,28,0.85)'; c.fill();
    c.strokeStyle = col; c.lineWidth = 2; c.shadowColor = col; c.shadowBlur = 12; c.stroke();
    if (m.sh === 2 || m.sh === 6) { c.beginPath(); c.arc(0, 0, r * 0.3, 0, TAU); c.fillStyle = col; c.globalAlpha = 0.6; c.fill(); }
    c.restore();
    if (m.hp < m.maxhp) { const bw = ts * 1.1, bx = px - bw / 2, by = py - r - 7; bar(c, bx, by, bw, 3, m.hp / m.maxhp, { fill: m.boss ? PALETTE.magenta : PALETTE.red, bg: 'rgba(0,0,0,.5)' }); }
    if (VIS[i] && m.d.vi > 0 && m.boss) text(c, m.n, px, py + r + 8, { size: 10, color: m.col, alpha: 0.8 });
  }
  function shapePath(sh, r, t) {
    c.beginPath();
    switch (sh) {
      case 0: c.moveTo(0, -r); c.lineTo(r * 0.8, r * 0.7); c.lineTo(-r * 0.8, r * 0.7); c.closePath(); break;
      case 1: c.moveTo(0, -r); c.lineTo(r, 0); c.lineTo(0, r); c.lineTo(-r, 0); c.closePath(); break;
      case 2: c.arc(0, 0, r * 0.9, 0, TAU); break;
      case 3: c.rect(-r * 0.7, -r * 0.8, r * 1.4, r * 1.6); break;
      case 4: c.moveTo(-r, -r * 0.6); c.lineTo(r * 0.2, -r); c.lineTo(r, r * 0.2); c.lineTo(0, r); c.lineTo(-r * 0.8, r * 0.5); c.closePath(); break;
      case 5: starPath(c, 0, 0, r, 5, 0.45); break;
      case 6: starPath(c, 0, 0, r, 6, 0.5); break;
      case 7: c.moveTo(-r, -r); c.lineTo(r, -r); c.lineTo(r * 0.6, r); c.lineTo(-r * 0.6, r); c.closePath(); break;
      case 8: c.moveTo(0, -r); c.lineTo(r * 0.6, -r * 0.2); c.lineTo(r, r * 0.8); c.lineTo(-r, r * 0.8); c.lineTo(-r * 0.6, -r * 0.2); c.closePath(); break;
      case 9: c.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7); break;
      default: starPath(c, 0, 0, r * 1.25, 8, 0.55, t * 0.6); break;
    }
  }

  function drawPlayer() {
    const px = sxOf(P.ax) + ts / 2, py = syOf(P.ay) + ts / 2;
    const r = ts * 0.4;
    glowCircle(c, px, py, r * (ST.buffT > 0 ? 1.5 : 1.25), PALETTE.cyan, { glow: 14, width: 1.4, alpha: 0.35 });
    c.save(); c.translate(px, py); c.rotate(S.t * 0.6);
    c.beginPath(); c.moveTo(0, -r); c.lineTo(r, 0); c.lineTo(0, r); c.lineTo(-r, 0); c.closePath();
    c.fillStyle = 'rgba(34,224,255,0.25)'; c.fill();
    c.strokeStyle = '#eaf2ff'; c.lineWidth = 2; c.shadowColor = PALETTE.cyan; c.shadowBlur = 14; c.stroke();
    c.restore();
    if (ST.buffT > 0) text(c, '怒', px, py - r - 9, { size: 10, color: PALETTE.amber });
    if (ST.hasteT > 0) text(c, '疾', px + r + 6, py, { size: 10, color: PALETTE.lime });
  }

  function drawMessages() { if (S.msgT <= 0 || !MSGS.length) return; const a = clamp01(S.msgT / 0.6); const y = L.bot - 66 - (MSGS.length - 1) * 18; for (let i = 0; i < MSGS.length; i++) { text(c, MSGS[i], 12, y + i * 18, { size: 12, color: PALETTE.white, align: 'left', alpha: a * (i === MSGS.length - 1 ? 1 : 0.55) }); } }
  function drawMini() {
    const w = 92, h = 62, x = W - w - 8, y = 8;
    drawPanel(c, x, y, w, h, { fill: 'rgba(8,12,24,.72)', stroke: '#243357' });
    const sx = w / MW, sy = h / MH;
    for (let i = 0; i < MAXT; i++) { if (!SEEN[i]) continue; const tx = x + (i % MW) * sx, ty = y + ((i / MW) | 0) * sy; c.fillStyle = T[i] === WALL ? '#243357' : VIS[i] ? '#22e0ff' : '#2b4a63'; c.fillRect(tx, ty, sx + 0.5, sy + 0.5); }
    c.fillStyle = '#8dff4d'; c.fillRect(x + P.x * sx - 0.5, y + P.y * sy - 0.5, sx + 2, sy + 2);
    for (let i = 0; i < S.mons.length; i++) { const m = S.mons[i]; if (VIS[m.y * MW + m.x]) { c.fillStyle = '#ff4d5e'; c.fillRect(x + m.x * sx - 0.5, y + m.y * sy - 0.5, sx + 1, sy + 1); } }
    text(c, 'F' + S.floor, x + 4, y + h - 8, { size: 10, color: PALETTE.dim, align: 'left' });
  }

  function render(alpha, rdt) {
    c.save();
    ctx.shake.apply(c);
    c.fillStyle = PALETTE.bg; c.fillRect(-40, -40, W + 80, H + 80);
    const x0 = Math.max(0, Math.floor(camX - W / 2 / ts) - 1), x1 = Math.min(MW - 1, Math.ceil(camX + W / 2 / ts) + 1);
    const y0 = Math.max(0, Math.floor(camY - H / 2 / ts) - 1), y1 = Math.min(MH - 1, Math.ceil(camY + H / 2 / ts) + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) drawTile(x, y, y * MW + x);
    if (S.travel >= 0) { const tx = S.travel % MW, ty = (S.travel / MW) | 0; glowCircle(c, sxOf(tx) + ts / 2, syOf(ty) + ts / 2, ts * 0.42, PALETTE.lime, { glow: 10, width: 1.6, alpha: 0.5 + 0.3 * Math.sin(S.t * 6) }); }
    for (let i = 0; i < S.mons.length; i++) drawMon(S.mons[i]);
    drawPlayer();
    PT.render(c, 1);
    PT.renderTexts(c, rdt);
    c.restore();
    drawMini();
    drawMessages();
    vignette(c, W, H, 0.5);
  }

  /* ---------- 生命周期 ---------- */
  function resetRun() {
    S.floor = 1; S.mons.length = 0; S.inv.length = 0; S.eq[0] = S.eq[1] = S.eq[2] = null;
    S.tr.length = 0; S.over = false; S.auto = false; S.travel = -1; S.boss = null; S.goods = null;
    P.hp = P.maxhp = 60; P.mp = P.maxmp = 20; P.atk = 6; P.def = 1; P.lv = 1; P.xp = 0; P.xpn = 20;
    P.gold = 0; P.hunger = 700; P.vision = 6; P.kills = 0; P.turns = 0;
    ST.buff = 0; ST.buffT = 0; ST.haste = 0; ST.hasteT = 0; ST.onStair = false;
    MSGS.length = 0;
    genFloor();
    const start = makeItem(1); addItem(start);
    for (let i = 0; i < 2; i++) addItem({ b: 22, q: 0, pre: 0, suf: 0, n: 2 });
    say('你踏入了地牢第 1 层');
    updateHud();
  }

  buildBar(); buildPanel();
  offs.push(ctx.listen(ctx.canvas, 'pointerdown', onPointerDown));
  layout(ctx.W, ctx.H);
  resetRun();

  return {
    update, render,
    resize(w, h) { layout(w, h); },
    pause() { S.auto = false; },
    resume() { },
    destroy() { for (let i = 0; i < offs.length; i++) offs[i]?.(); barEl?.remove(); panelEl?.remove(); }
  };
}
