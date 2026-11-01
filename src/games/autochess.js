// 自走棋 —— 8x8 棋盘 / 商店 / 三合一升星 / 羁绊 / 备战与自动战斗
import { clamp, clamp01, lerp, TAU, ease } from '../core/math.js';
import { PALETTE, glowCircle, roundRect, fillRound, strokeRound, text, bar, panel, vignette, grid as drawGrid, glowDot, star as starPath } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'autochess', title: '自走棋', category: 'strategy', difficulty: 3,
  music: 'arcade',
  howto: ['拖动棋子布阵，点击商店单位购买（棋子进备战席）', '三个同名同星自动合成升星，羁绊在左侧显示',
    '备战 30 秒后自动开战；8 回合内保住 100 生命'],
  particles: 1400
};
export const musicTrack = 'arcade';

// ============================ 羁绊 ============================
const TRAITS = {
  mech: { name: '机械', color: '#22e0ff', tiers: [2, 4], txt: ['全体 +120 护盾', '全体 +320 护盾'] },
  assassin: { name: '刺客', color: '#ff2e88', tiers: [2, 4], txt: ['暴击 25% ×2.0', '暴击 50% ×2.4'] },
  mage: { name: '法师', color: '#a855f7', tiers: [2, 4], txt: ['技能伤害 +35%', '技能伤害 +80%'] },
  warrior: { name: '战士', color: '#ffb020', tiers: [2, 4, 6], txt: ['生命 +220', '生命 +500', '生命 +900'] },
  ranger: { name: '射手', color: '#8dff4d', tiers: [2, 4], txt: ['攻速 +22%', '攻速 +50%'] },
  undead: { name: '亡灵', color: '#28e0a0', tiers: [2, 4], txt: ['吸血 20%', '吸血 40%'] },
  beast: { name: '野兽', color: '#ff4d5e', tiers: [2, 4], txt: ['攻击 +18%', '攻击 +40%'] }
};

// ============================ 单位池 ============================
// sk: 技能类型  v: 技能数值
const UNITS = [
  { id: 'gear', name: '齿轮兵', cost: 1, hp: 620, atk: 46, spd: 0.85, range: 1, tr: ['warrior', 'mech'], sk: 'shield', v: 160 },
  { id: 'beetle', name: '铁甲虫', cost: 1, hp: 560, atk: 40, spd: 0.95, range: 1, tr: ['mech', 'beast'], sk: 'cleave', v: 55 },
  { id: 'shade', name: '影刃小卒', cost: 1, hp: 460, atk: 58, spd: 1.15, range: 1, tr: ['assassin'], sk: 'burst', v: 2 },
  { id: 'spark', name: '火花术士', cost: 2, hp: 480, atk: 52, spd: 0.75, range: 3, tr: ['mage'], sk: 'fireball', v: 130 },
  { id: 'bow', name: '弩手', cost: 2, hp: 500, atk: 62, spd: 1.0, range: 4, tr: ['ranger'], sk: 'volley', v: 3 },
  { id: 'bone', name: '骨兵', cost: 2, hp: 640, atk: 46, spd: 0.8, range: 1, tr: ['undead', 'warrior'], sk: 'drain', v: 90 },
  { id: 'guard', name: '石卫', cost: 3, hp: 920, atk: 56, spd: 0.7, range: 1, tr: ['warrior'], sk: 'shield', v: 300 },
  { id: 'thunder', name: '雷霆法师', cost: 3, hp: 560, atk: 68, spd: 0.8, range: 3, tr: ['mage', 'mech'], sk: 'chain', v: 110 },
  { id: 'master', name: '刺客大师', cost: 3, hp: 520, atk: 88, spd: 1.25, range: 1, tr: ['assassin', 'undead'], sk: 'burst', v: 3 },
  { id: 'ballista', name: '巨弩', cost: 4, hp: 700, atk: 95, spd: 0.85, range: 5, tr: ['ranger', 'mech'], sk: 'volley', v: 4 },
  { id: 'lich', name: '巫妖', cost: 4, hp: 640, atk: 82, spd: 0.8, range: 3, tr: ['mage', 'undead'], sk: 'healall', v: 220 },
  { id: 'blade', name: '死亡之刃', cost: 4, hp: 600, atk: 98, spd: 1.15, range: 1, tr: ['assassin', 'mage'], sk: 'cleave', v: 150 },
  { id: 'dragon', name: '龙兽', cost: 5, hp: 1150, atk: 105, spd: 0.75, range: 1, tr: ['beast', 'warrior'], sk: 'cleave', v: 190 },
  { id: 'titan', name: '究极机甲', cost: 5, hp: 1250, atk: 115, spd: 0.7, range: 2, tr: ['mech', 'warrior'], sk: 'nuke', v: 320 }
];
const UNIT_BY_ID = {};
for (const u of UNITS) UNIT_BY_ID[u.id] = u;

// 商店稀有度概率（按人口等级 1~8）
const ODDS = [
  [100, 0, 0, 0, 0], [100, 0, 0, 0, 0], [75, 25, 0, 0, 0], [60, 32, 8, 0, 0],
  [50, 35, 13, 2, 0], [40, 38, 18, 4, 0], [32, 38, 22, 7, 1], [26, 36, 26, 10, 2]
];

const STAR_MUL = [1, 1.85, 3.4];
const PREP_TIME = 30;

export function create(ctx) {
  const { input, audio, particles, shake, flash, save, rng } = ctx;
  let W = ctx.W, H = ctx.H;

  const G = {
    phase: 'prep',          // prep | battle | over
    round: 1, gold: 10, hp: 100, level: 2, xp: 0, streak: 0, t: 0, timer: PREP_TIME,
    shop: [], locked: false, units: [], uid: 1, sel: -1, best: save.get('best', 0),
    traitCache: [], over: 0, msg: '', msgT: 0, result: ''
  };
  // 布局
  let cell = 40, bx = 0, by = 0, bs = 320, benchY = 0, benchCell = 34, traitsW = 150;

  const boardUnits = () => G.units.filter(u => u.onBoard && u.alive !== false);
  const ownBoard = () => G.units.filter(u => u.onBoard && u.team === 0);

  // ---------------- 布局 ----------------
  function layout() {
    traitsW = W < 620 ? 0 : 148;
    bs = Math.max(180, Math.min(W - traitsW - 24, H - 196));
    cell = bs / 8;
    bx = traitsW + Math.max(8, (W - traitsW - bs) / 2);
    by = 52;
    benchCell = Math.min(46, cell * 0.92);
    benchY = by + bs + 12;
  }
  layout();

  const cellX = (gx) => bx + gx * cell + cell / 2;
  const cellY = (gy) => by + gy * cell + cell / 2;
  const benchX = (i) => bx + i * benchCell + benchCell / 2;

  // ---------------- 单位 ----------------
  function makeUnit(id, team, star) {
    const d = UNIT_BY_ID[id];
    return {
      uid: G.uid++, id, team, star: star || 1, def: d,
      onBoard: false, bench: -1, gx: 0, gy: 0, px: 0, py: 0,
      hp: 0, maxHp: 0, shield: 0, mana: 0, cd: 0, mcd: 0, tgt: -1, alive: true,
      atk: 0, spd: 0, range: 0, crit: 0, ls: 0, skMul: 1, hurt: 0, castFx: 0
    };
  }
  function statOf(u) {
    const d = u.def, m = STAR_MUL[u.star - 1];
    u.maxHp = Math.round(d.hp * m);
    u.atk = Math.round(d.atk * m);
    u.spd = d.spd; u.range = d.range;
    u.crit = 0; u.ls = 0; u.skMul = 1;
  }

  // ---------------- 羁绊 ----------------
  function recalcTraits() {
    const count = {};
    const seen = {};
    for (const u of ownBoard()) {
      for (const t of u.def.tr) {
        const key = t + '#' + u.id;
        if (seen[key]) continue;
        seen[key] = 1;
        count[t] = (count[t] || 0) + 1;
      }
    }
    const act = [];
    for (const k in TRAITS) {
      const n = count[k] || 0; if (!n) continue;
      const tr = TRAITS[k];
      let tier = -1;
      for (let i = 0; i < tr.tiers.length; i++) if (n >= tr.tiers[i]) tier = i;
      if (tier >= 0) act.push({ k, n, tier, tr, next: tr.tiers[tier + 1] || null });
    }
    G.traitCache = act;
    // 应用到己方棋子
    for (const u of ownBoard()) {
      statOf(u);
      for (const a of act) {
        if (a.k === 'warrior') u.maxHp += [220, 500, 900][a.tier];
        if (a.k === 'beast') u.atk = Math.round(u.atk * [1.18, 1.4][a.tier]);
        if (a.k === 'ranger') u.spd *= [1.22, 1.5][a.tier];
        if (a.k === 'mage') u.skMul *= [1.35, 1.8][a.tier];
        if (a.k === 'assassin') u.crit = [0.25, 0.5][a.tier];
        if (a.k === 'undead') u.ls = [0.2, 0.4][a.tier];
      }
      u.hp = Math.min(u.hp || u.maxHp, u.maxHp);
    }
  }

  // ---------------- 商店 ----------------
  function rollShop() {
    G.shop = [];
    const odds = ODDS[clamp(G.level - 1, 0, 7)];
    for (let i = 0; i < 5; i++) {
      let r = rng() * 100, cost = 1;
      for (let k = 0; k < 5; k++) { if (r < odds[k]) { cost = k + 1; break; } r -= odds[k]; }
      const pool = UNITS.filter(u => u.cost === cost);
      G.shop.push(rng.pick(pool.length ? pool : UNITS).id);
    }
    syncShop();
  }
  function benchCount() { let n = 0; for (const u of G.units) if (!u.onBoard && u.team === 0) n++; return n; }
  function freeBench() { for (let i = 0; i < 8; i++) { let used = false; for (const u of G.units) if (!u.onBoard && u.team === 0 && u.bench === i) used = true; if (!used) return i; } return -1; }
  function unitAt(gx, gy) { for (const u of G.units) if (u.onBoard && u.gx === gx && u.gy === gy) return u; return null; }

  function buy(i) {
    const id = G.shop[i]; if (!id) return;
    const d = UNIT_BY_ID[id];
    if (G.gold < d.cost) { audio.sfx('error'); ctx.hint('金币不足'); return; }
    const bi = freeBench();
    if (bi < 0 && ownBoard().length >= G.level) { audio.sfx('error'); ctx.hint('备战席与棋盘已满'); return; }
    G.gold -= d.cost;
    const u = makeUnit(id, 0, 1);
    statOf(u); u.hp = u.maxHp;
    if (bi >= 0) { u.onBoard = false; u.bench = bi; }
    else { placeOnBoard(u); }
    G.units.push(u);
    G.shop[i] = null;
    audio.sfx('coin'); ctx.vibrate(PATTERNS.tap);
    particles.sparkle(benchX(Math.max(0, bi)), benchY + benchCell / 2, PALETTE.amber);
    recalcTraits(); syncShop(); updateHud(); checkMerge();
  }
  function placeOnBoard(u) {
    for (let gy = 7; gy >= 4; gy--) for (let gx = 0; gx < 8; gx++) if (!unitAt(gx, gy)) {
      u.onBoard = true; u.gx = gx; u.gy = gy; u.bench = -1;
      u.px = cellX(gx); u.py = cellY(gy);
      return;
    }
    u.onBoard = false; u.bench = freeBench();
  }
  function sellValue(u) { return u.def.cost * (u.star === 1 ? 1 : u.star === 2 ? 3 : 9); }

  // 三合一升星
  function checkMerge() {
    for (let pass = 0; pass < 3; pass++) {
      let merged = false;
      for (const star of [1, 2]) {
        const groups = {};
        for (const u of G.units) {
          if (u.team !== 0 || u.star !== star) continue;
          (groups[u.id] = groups[u.id] || []).push(u);
        }
        for (const id in groups) {
          const list = groups[id];
          if (list.length < 3) continue;
          const keep = list[0];
          // 保留场上优先、星级高的位置
          for (const u of list) if (u.onBoard) { keep.onBoard = u.onBoard; keep.gx = u.gx; keep.gy = u.gy; break; }
          const target = list.find(u => u.onBoard) || keep;
          for (const u of list) if (u !== target) removeUnit(u);
          target.star = star + 1;
          statOf(target); target.hp = target.maxHp; target.mana = 0;
          particles.explosion(upx(target), upy(target), 1.2, PALETTE.amber);
          particles.ring(upx(target), upy(target), PALETTE.amber, 70);
          audio.sfx('powerup'); ctx.vibrate(PATTERNS.combo); flash.add(0.18, '#ffb020');
          say(target.def.name + ' 升到 ' + target.star + ' 星！', 1.8);
          merged = true;
          break;
        }
        if (merged) break;
      }
      if (!merged) break;
    }
    recalcTraits(); syncShop();
  }
  function removeUnit(u) {
    const i = G.units.indexOf(u);
    if (i >= 0) G.units.splice(i, 1);
    if (G.sel === u.uid) G.sel = -1;
  }
  function upx(u) { return u.onBoard || u.team === 1 ? (u.px || cellX(u.gx)) : benchX(Math.max(0, u.bench)); }
  function upy(u) { return u.onBoard || u.team === 1 ? (u.py || cellY(u.gy)) : benchY + benchCell / 2; }

  // ---------------- 回合流程 ----------------
  function startPrep() {
    G.phase = 'prep'; G.timer = PREP_TIME;
    // 清理敌方
    G.units = G.units.filter(u => u.team === 0);
    for (const u of G.units) { u.alive = true; statOf(u); u.hp = u.maxHp; u.shield = 0; u.mana = 0; u.cd = 0; u.tgt = -1; if (u.onBoard) { u.px = cellX(u.gx); u.py = cellY(u.gy); } }
    const interest = Math.min(5, Math.floor(G.gold / 10));
    const streak = G.streak >= 3 ? 3 : G.streak <= -3 ? 3 : Math.abs(G.streak);
    const inc = 5 + interest + (Math.abs(G.streak) >= 2 ? streak : 0);
    G.gold += inc;
    if (!G.locked) rollShop();
    genEnemy(G.round);
    recalcTraits(); syncShop(); updateHud();
    say(`第 ${G.round} 回合 · 收入 +${inc}（利息 ${interest}）`, 2.4);
  }

  function genEnemy(r) {
    const n = Math.min(8, 2 + Math.floor(r * 0.8));
    const maxCost = Math.min(5, 1 + Math.ceil(r / 2));
    const pool = UNITS.filter(u => u.cost <= maxCost);
    const cells = [];
    for (let gy = 0; gy <= 3; gy++) for (let gx = 0; gx < 8; gx++) cells.push([gx, gy]);
    rng.shuffle(cells);
    for (let i = 0; i < n; i++) {
      const d = rng.pick(pool.length ? pool : UNITS);
      const u = makeUnit(d.id, 1, r >= 5 && rng.chance(0.3) ? 2 : 1);
      statOf(u);
      const sc = 1 + r * 0.09;
      u.maxHp = Math.round(u.maxHp * sc); u.atk = Math.round(u.atk * sc);
      u.hp = u.maxHp; u.shield = 0;
      const c = cells[i];
      u.onBoard = true; u.gx = c[0]; u.gy = c[1];
      u.px = cellX(u.gx); u.py = cellY(u.gy);
      G.units.push(u);
    }
  }

  function startBattle() {
    if (G.phase !== 'prep') return;
    G.phase = 'battle'; G.sel = -1;
    // 羁绊护盾
    for (const a of G.traitCache) if (a.k === 'mech') for (const u of ownBoard()) u.shield += [120, 320][a.tier];
    for (const u of G.units) if (u.onBoard) { u.alive = true; u.cd = rng.range(0, 0.4); u.mcd = 0; u.tgt = -1; }
    audio.sfx('alarm'); audio.duck(0.4, 700);
    say('战斗开始！', 1.6); syncShop();
  }

  function endBattle(win) {
    const aliveEnemies = G.units.filter(u => u.team === 1 && u.alive && u.hp > 0).length;
    if (win) {
      G.streak = G.streak > 0 ? G.streak + 1 : 1;
      G.gold += 1 + Math.min(3, G.streak);
      audio.sfx('win'); ctx.vibrate(PATTERNS.win); flash.add(0.2, '#8dff4d');
      G.result = '胜利';
    } else {
      const dmg = 2 + aliveEnemies + Math.floor(G.round / 2);
      G.hp -= dmg;
      G.streak = G.streak < 0 ? G.streak - 1 : -1;
      audio.sfx('lose'); ctx.vibrate(PATTERNS.lose); shake.add(0.7); flash.add(0.3, '#ff4d5e');
      G.result = '失败 -' + dmg + ' 生命';
    }
    G.phase = 'over'; G.over = 2.2;
    updateHud();
  }

  function nextRound() {
    if (G.hp <= 0) {
      const sc = G.round * 100 + G.gold + G.level * 40;
      if (sc > G.best) { G.best = sc; save.set('best', sc); }
      ctx.finish(sc, { win: false, stats: [['到达回合', G.round], ['剩余金币', G.gold], ['人口', G.level]] });
      return;
    }
    if (G.round >= 8) {
      const sc = 800 + G.hp * 10 + G.gold + G.level * 40;
      if (sc > G.best) { G.best = sc; save.set('best', sc); }
      ctx.finish(sc, { win: true, stats: [['剩余生命', G.hp], ['金币', G.gold], ['人口', G.level]] });
      return;
    }
    G.round++;
    startPrep();
  }

  // ---------------- 战斗 ----------------
  function findTarget(u) {
    let best = -1, bd = 1e9;
    for (let i = 0; i < G.units.length; i++) {
      const o = G.units[i];
      if (o === u || o.team === u.team || !o.alive || o.hp <= 0 || !o.onBoard) continue;
      const d = (o.gx - u.gx) * (o.gx - u.gx) + (o.gy - u.gy) * (o.gy - u.gy);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function stepToward(u, t) {
    const dx = t.gx - u.gx, dy = t.gy - u.gy;
    const opts = [];
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    if (sx && sy) opts.push([sx, sy]);
    if (Math.abs(dx) > Math.abs(dy)) { if (sx) opts.push([sx, 0]); if (sy) opts.push([0, sy]); }
    else { if (sy) opts.push([0, sy]); if (sx) opts.push([sx, 0]); }
    opts.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    for (const o of opts) {
      const nx = u.gx + o[0], ny = u.gy + o[1];
      if (nx < 0 || ny < 0 || nx > 7 || ny > 7) continue;
      if (unitAt(nx, ny)) continue;
      u.gx = nx; u.gy = ny; u.mcd = 0.42 / (1 + u.star * 0.05);
      return;
    }
    u.mcd = 0.2;
  }
  function dealDamage(src, t, amount, magic) {
    if (!t || !t.alive || t.hp <= 0) return;
    let d = amount;
    if (!magic && src.crit > 0 && rng.chance(src.crit)) {
      d = Math.round(d * (src.crit > 0.3 ? 2.4 : 2.0));
      particles.ring(t.px, t.py, PALETTE.magenta, 26);
      audio.sfx('combo', { combo: 6 });
    }
    if (t.shield > 0) { const s = Math.min(t.shield, d); t.shield -= s; d -= s; }
    t.hp -= d; t.hurt = 0.3;
    if (!magic && src.ls > 0) { src.hp = Math.min(src.maxHp, src.hp + d * src.ls); }
    src.mana = Math.min(100, src.mana + (magic ? 0 : 12));
    particles.burst(t.px, t.py, 7, { color: magic ? PALETTE.violet : PALETTE.amber, speed: 150, life: .4, size: 2.6, kind: 1 });
    particles.text(t.px, t.py - 18, '-' + d, magic ? '#a855f7' : '#ffb020');
    if (t.hp <= 0) {
      t.hp = 0; t.alive = false;
      particles.explosion(t.px, t.py, 0.9, t.team === 0 ? PALETTE.cyan : PALETTE.red);
      audio.sfx('explode');
    }
  }
  function castSkill(u) {
    const d = u.def, p = Math.round(d.v * STAR_MUL[u.star - 1] * u.skMul);
    u.mana = 0; u.castFx = 0.5;
    audio.sfx(d.sk === 'healall' ? 'heal' : 'laser');
    const t = u.tgt >= 0 ? G.units[u.tgt] : null;
    if (d.sk === 'fireball') { if (t) { dealDamage(u, t, p, true); particles.explosion(t.px, t.py, 1, PALETTE.amber); } }
    else if (d.sk === 'nuke') { if (t) { dealDamage(u, t, p, true); particles.explosion(t.px, t.py, 1.6, PALETTE.violet); shake.add(0.3); } }
    else if (d.sk === 'chain') {
      let hits = 0;
      for (const o of G.units) { if (o.team !== u.team && o.alive && o.hp > 0 && hits < 3) { dealDamage(u, o, p, true); hits++; } }
    } else if (d.sk === 'cleave') {
      for (const o of G.units) if (o.team !== u.team && o.alive && o.hp > 0 && Math.abs(o.gx - u.gx) <= 1 && Math.abs(o.gy - u.gy) <= 1) dealDamage(u, o, p, true);
    } else if (d.sk === 'volley') { if (t) for (let i = 0; i < d.v; i++) dealDamage(u, t, Math.round(p / 2), false); }
    else if (d.sk === 'burst') { if (t) for (let i = 0; i < d.v; i++) dealDamage(u, t, Math.round(p / d.v), false); }
    else if (d.sk === 'drain') { if (t) { dealDamage(u, t, p, true); u.hp = Math.min(u.maxHp, u.hp + Math.round(p * 0.6)); particles.ring(u.px, u.py, PALETTE.green, 34); } }
    else if (d.sk === 'shield') { u.shield += p; particles.ring(u.px, u.py, PALETTE.cyan, 40); }
    else if (d.sk === 'healall') {
      for (const o of G.units) if (o.team === u.team && o.alive && o.hp > 0) { o.hp = Math.min(o.maxHp, o.hp + p); particles.ring(o.px, o.py, PALETTE.green, 30); }
    }
    particles.ring(u.px, u.py, PALETTE.violet, 50);
  }

  function combatTick(dt) {
    for (const u of G.units) {
      if (!u.onBoard || !u.alive || u.hp <= 0) continue;
      u.cd -= dt; u.mcd -= dt;
      u.mana = Math.min(100, u.mana + dt * 3.2);
      if (u.tgt < 0 || !G.units[u.tgt] || !G.units[u.tgt].alive || G.units[u.tgt].hp <= 0) u.tgt = findTarget(u);
      const t = u.tgt >= 0 ? G.units[u.tgt] : null;
      if (!t) continue;
      if (u.mana >= 100) { castSkill(u); continue; }
      const dist = Math.sqrt((t.gx - u.gx) * (t.gx - u.gx) + (t.gy - u.gy) * (t.gy - u.gy));
      if (dist <= u.range + 0.001) {
        if (u.cd <= 0) {
          u.cd = 1 / Math.max(0.2, u.spd);
          dealDamage(u, t, u.atk, false);
          const ang = Math.atan2(t.py - u.py, t.px - u.px);
          particles.burst(u.px + Math.cos(ang) * 10, u.py + Math.sin(ang) * 10, 5, { color: PALETTE.cyan, speed: 130, life: .3, kind: 1, angle: ang, spread: 0.7 });
          audio.sfx('shoot');
        }
      } else if (u.mcd <= 0) stepToward(u, t);
    }
    // 位置插值
    for (const u of G.units) {
      if (!u.onBoard) continue;
      const tx = cellX(u.gx), ty = cellY(u.gy);
      u.px = lerp(u.px, tx, 1 - Math.exp(-9 * dt));
      u.py = lerp(u.py, ty, 1 - Math.exp(-9 * dt));
      if (u.hurt > 0) u.hurt -= dt;
      if (u.castFx > 0) u.castFx -= dt;
    }
    let a = 0, b = 0;
    for (const u of G.units) { if (!u.onBoard || !u.alive || u.hp <= 0) continue; if (u.team === 0) a++; else b++; }
    if (a === 0 || b === 0) endBattle(b === 0);
  }

  // ---------------- HUD / DOM ----------------
  function updateHud() {
    ctx.hud('hp', '生命', G.hp, { color: G.hp < 40 ? PALETTE.red : PALETTE.green });
    ctx.hud('gold', '金币', G.gold, { color: PALETTE.amber });
    ctx.hud('round', '回合', G.round + '/8');
    ctx.hud('lvl', '人口', ownBoard().length + '/' + G.level, { color: '#22e0ff' });
  }
  function say(m, s) { G.msg = m; G.msgT = s; }

  // 商店 DOM
  const shopEl = ctx.overlay(document.createElement('div'), 'ov-shop');
  shopEl.style.cssText = 'position:absolute;left:0;right:0;bottom:0;z-index:10;display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 6px;background:linear-gradient(0deg,rgba(5,8,15,.96),rgba(5,8,15,.2));pointer-events:auto;';
  const shopRow = document.createElement('div');
  shopRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center;';
  const ctlRow = document.createElement('div');
  ctlRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center;';
  shopEl.appendChild(shopRow); shopEl.appendChild(ctlRow);

  const shopBtns = [];
  for (let i = 0; i < 5; i++) {
    const b = document.createElement('button');
    b.className = 'btn btn-ghost';
    b.style.cssText = 'pointer-events:auto;min-width:74px;padding:6px 8px;border-radius:9px;font-size:11px;line-height:1.25;text-align:center;';
    b.onclick = () => buy(i);
    shopRow.appendChild(b); shopBtns.push(b);
  }
  function mkCtl(label, fn, color) {
    const b = document.createElement('button');
    b.className = 'btn btn-ghost';
    b.style.cssText = `pointer-events:auto;padding:6px 11px;border-radius:9px;font-size:11.5px;font-weight:700;border:1px solid ${color};color:${color};`;
    b.textContent = label;
    b.onclick = () => { audio.sfx('confirm'); ctx.vibrate(PATTERNS.tap); fn(); };
    ctlRow.appendChild(b);
    return b;
  }
  const btnRoll = mkCtl('刷新 (2)', () => { if (G.gold < 2) { audio.sfx('error'); return; } G.gold -= 2; rollShop(); updateHud(); audio.sfx('swap'); }, PALETTE.cyan);
  const btnLvl = mkCtl('升级人口', () => {
    const cost = G.level * 4;
    if (G.level >= 8) { ctx.hint('已达最高人口'); return; }
    if (G.gold < cost) { audio.sfx('error'); ctx.hint('金币不足'); return; }
    G.gold -= cost; G.level++; audio.sfx('powerup');
    recalcTraits(); syncShop(); updateHud();
  }, PALETTE.lime);
  const btnLock = mkCtl('锁定', () => { G.locked = !G.locked; audio.sfx(G.locked ? 'lock' : 'click'); syncShop(); }, PALETTE.amber);
  const btnSell = mkCtl('出售', () => {
    const u = G.units.find(x => x.uid === G.sel);
    if (!u || u.team !== 0) { ctx.hint('先点选一个棋子'); return; }
    G.gold += sellValue(u);
    particles.burst(upx(u), upy(u), 10, { color: PALETTE.amber, speed: 140, life: .5, kind: 4 });
    audio.sfx('coin'); removeUnit(u); recalcTraits(); syncShop(); updateHud();
  }, PALETTE.red);
  const btnFight = mkCtl('开始战斗', () => startBattle(), PALETTE.magenta);

  function syncShop() {
    for (let i = 0; i < 5; i++) {
      const b = shopBtns[i], id = G.shop[i];
      if (!id) { b.style.display = 'none'; continue; }
      const d = UNIT_BY_ID[id];
      const col = TRAITS[d.tr[0]].color;
      b.style.display = '';
      b.style.borderColor = G.gold >= d.cost ? col : '#44506e';
      b.style.color = G.gold >= d.cost ? col : '#7d8db3';
      b.innerHTML = `<b>${d.name}</b><br><span style="color:#ffb020">${d.cost}金</span><br><span style="font-size:9.5px;color:#7d8db3">${d.tr.map(t => TRAITS[t].name).join('/')}</span>`;
    }
    btnLvl.textContent = G.level >= 8 ? '人口满' : `升级人口 (${G.level * 4})`;
    btnLock.textContent = G.locked ? '已锁定' : '锁定';
    btnLock.style.color = G.locked ? '#8dff4d' : PALETTE.amber;
    btnLock.style.borderColor = G.locked ? '#8dff4d' : PALETTE.amber;
    const u = G.units.find(x => x.uid === G.sel);
    btnSell.textContent = u ? `出售 (+${sellValue(u)})` : '出售';
    shopRow.style.display = G.phase === 'prep' ? '' : 'none';
    btnFight.style.display = G.phase === 'prep' ? '' : 'none';
  }

  // ---------------- 拖拽 / 点击 ----------------
  const drag = { u: null, on: 0, x: 0, y: 0, moved: 0, sx: 0, sy: 0 };
  function pickAt(px, py) {
    for (const u of G.units) {
      if (u.team !== 0) continue;
      const x = upx(u), y = upy(u), r = (u.onBoard ? cell : benchCell) * 0.46;
      if (Math.abs(px - x) < r && Math.abs(py - y) < r) return u;
    }
    return null;
  }
  ctx.listen(ctx.canvas, 'pointerdown', (e) => {
    const r = ctx.canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const u = pickAt(px, py);
    if (G.phase !== 'prep') { G.sel = -1; return; }
    drag.u = u; drag.on = u ? 1 : 0; drag.moved = 0; drag.sx = px; drag.sy = py; drag.x = px; drag.y = py;
    G.sel = u ? u.uid : -1;
    if (u) { audio.sfx('click'); ctx.vibrate(PATTERNS.tap); }
    syncShop();
  });
  ctx.listen(window, 'pointermove', (e) => {
    if (!drag.on || !drag.u) return;
    const r = ctx.canvas.getBoundingClientRect();
    drag.x = e.clientX - r.left; drag.y = e.clientY - r.top;
    if (Math.abs(drag.x - drag.sx) + Math.abs(drag.y - drag.sy) > 8) drag.moved = 1;
  });
  ctx.listen(window, 'pointerup', () => {
    if (!drag.on || !drag.u) return;
    const u = drag.u; drag.on = 0; drag.u = null;
    if (!drag.moved) { syncShop(); return; }
    const px = drag.x, py = drag.y;
    // 落到棋盘
    if (px >= bx && px < bx + bs && py >= by && py < by + bs) {
      const gx = Math.floor((px - bx) / cell), gy = Math.floor((py - by) / cell);
      if (gy >= 4 && gy <= 7) {
        const occ = unitAt(gx, gy);
        if (occ === u) { snapBack(u); return; }
        const boardNow = ownBoard();
        if (!u.onBoard && boardNow.length >= G.level && !occ) { ctx.hint('人口不足'); audio.sfx('error'); snapBack(u); return; }
        if (occ) { // 交换
          if (u.onBoard) { const tgx = u.gx, tgy = u.gy; u.gx = gx; u.gy = gy; occ.gx = tgx; occ.gy = tgy; }
          else { occ.onBoard = false; occ.bench = u.bench; u.bench = -1; u.onBoard = true; u.gx = gx; u.gy = gy; }
        } else {
          u.onBoard = true; u.gx = gx; u.gy = gy; u.bench = -1;
        }
        u.px = cellX(u.gx); u.py = cellY(u.gy);
        audio.sfx('place'); ctx.vibrate(PATTERNS.tap);
        recalcTraits(); syncShop(); updateHud();
        return;
      }
      ctx.hint('只能布置在己方半场（下半区）'); audio.sfx('error');
      snapBack(u); return;
    }
    // 落到备战席
    if (py >= benchY && py < benchY + benchCell) {
      const i = Math.floor((px - bx) / benchCell);
      if (i >= 0 && i < 8) {
        let occ = null;
        for (const x of G.units) if (!x.onBoard && x.team === 0 && x.bench === i) occ = x;
        if (occ && occ !== u) { if (u.onBoard) { occ.onBoard = true; occ.gx = u.gx; occ.gy = u.gy; occ.px = cellX(occ.gx); occ.py = cellY(occ.gy); u.onBoard = false; u.bench = i; } else { const bi = u.bench; u.bench = i; occ.bench = bi; } }
        else { u.onBoard = false; u.bench = i; }
        audio.sfx('place'); recalcTraits(); syncShop(); updateHud();
        return;
      }
    }
    snapBack(u);
  });
  function snapBack(u) { if (u.onBoard) { u.px = cellX(u.gx); u.py = cellY(u.gy); } syncShop(); }

  // ---------------- 初始化 ----------------
  updateHud();
  startPrep();

  // ---------------- 更新 ----------------
  function update(dt) {
    G.t += dt;
    if (G.msgT > 0) G.msgT -= dt;
    if (G.phase === 'prep') {
      G.timer -= dt;
      if (G.timer <= 0) startBattle();
      if (input.justPressed('confirm')) startBattle();
      if (input.justPressed('skill1')) { if (!G.locked) { if (G.gold >= 2) { G.gold -= 2; rollShop(); updateHud(); } } }
    } else if (G.phase === 'battle') {
      combatTick(dt);
    } else if (G.phase === 'over') {
      G.over -= dt;
      if (G.over <= 0) nextRound();
    }
    // 己方棋子特效
    if (rng.chance(0.25)) for (const u of ownBoard()) if (u.star === 3) particles.trail(u.px + rng.range(-8, 8), u.py + 6, PALETTE.amber, 2);
  }

  // ---------------- 渲染 ----------------
  function render(alpha, rdt) {
    const c = ctx.ctx;
    c.fillStyle = '#05080f'; c.fillRect(0, 0, W, H);
    c.save();
    shake.apply(c);
    drawBoard(c);
    if (traitsW) drawTraits(c);
    drawUnits(c);
    drawBench(c);
    particles.render(c, 1);
    particles.renderTexts(c, rdt);
    c.restore();
    drawTopBar(c);
    vignette(c, W, H, 0.35);
    if (G.msgT > 0) toast(c, G.msg);
    if (G.phase === 'over') {
      const a = clamp01(G.over / 2.2);
      c.save(); c.globalAlpha = a;
      text(c, G.result, W / 2, H * 0.36, { size: 40, color: G.result === '胜利' ? PALETTE.lime : PALETTE.red, weight: 900, glow: 22 });
      c.restore();
    }
  }
  function toast(c, m) {
    const w = Math.min(W - 40, 380);
    panel(c, (W - w) / 2, 8, w, 30, { fill: 'rgba(8,12,24,.92)', stroke: PALETTE.cyan, r: 15 });
    text(c, m, W / 2, 23, { size: 12.5, color: PALETTE.white });
  }

  function drawTopBar(c) {
    text(c, `第 ${G.round}/8 回合`, W / 2, 16, { size: 13, color: PALETTE.white, weight: 800 });
    if (G.phase === 'prep') {
      const t = Math.max(0, G.timer);
      const w = 150;
      bar(c, W / 2 - w / 2, 28, w, 6, t / PREP_TIME, { fill: t < 6 ? PALETTE.red : PALETTE.cyan, bg: 'rgba(255,255,255,.08)' });
      text(c, `${Math.ceil(t)}s 后开战`, W / 2, 42, { size: 10.5, color: PALETTE.dim });
    } else text(c, G.phase === 'battle' ? '自动战斗中…' : '结算', W / 2, 38, { size: 11.5, color: PALETTE.magenta });
  }

  function drawBoard(c) {
    // 半场底色
    fillRound(c, bx, by, bs, bs / 2, 6, 'rgba(255,46,136,.05)');
    fillRound(c, bx, by + bs / 2, bs, bs / 2, 6, 'rgba(34,224,255,.06)');
    c.save();
    c.strokeStyle = 'rgba(80,110,170,.28)'; c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i <= 8; i++) { c.moveTo(bx + i * cell, by); c.lineTo(bx + i * cell, by + bs); c.moveTo(bx, by + i * cell); c.lineTo(bx + bs, by + i * cell); }
    c.stroke();
    c.restore();
    strokeRound(c, bx, by, bs, bs, 6, 'rgba(34,224,255,.35)', 1.5);
    c.save();
    c.strokeStyle = 'rgba(141,255,77,.35)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(bx, by + bs / 2); c.lineTo(bx + bs, by + bs / 2); c.stroke();
    c.restore();
    // 拖拽高亮
    if (drag.on && drag.moved && drag.x >= bx && drag.x < bx + bs && drag.y >= by && drag.y < by + bs) {
      const gx = Math.floor((drag.x - bx) / cell), gy = Math.floor((drag.y - by) / cell);
      const ok = gy >= 4;
      fillRound(c, bx + gx * cell + 2, by + gy * cell + 2, cell - 4, cell - 4, 5, ok ? 'rgba(141,255,77,.16)' : 'rgba(255,77,94,.16)');
      strokeRound(c, bx + gx * cell + 2, by + gy * cell + 2, cell - 4, cell - 4, 5, ok ? PALETTE.lime : PALETTE.red, 1.5);
    }
    text(c, '敌方半场', bx + bs / 2, by - 8, { size: 10, color: PALETTE.magenta });
  }

  function drawTraits(c) {
    panel(c, 6, by, traitsW - 10, Math.min(bs, 60 + G.traitCache.length * 34), { fill: 'rgba(10,16,32,.8)', stroke: '#243357', r: 10 });
    text(c, '羁绊', 6 + (traitsW - 10) / 2, by + 14, { size: 12, color: PALETTE.white, weight: 800 });
    let y = by + 30;
    if (!G.traitCache.length) { text(c, '暂无', 6 + (traitsW - 10) / 2, y + 10, { size: 11, color: PALETTE.dim }); }
    for (const a of G.traitCache) {
      const w = traitsW - 22;
      fillRound(c, 12, y, w, 28, 7, 'rgba(255,255,255,.04)');
      strokeRound(c, 12, y, w, 28, 7, a.tr.color, 1.2);
      text(c, a.tr.name, 20, y + 14, { size: 11.5, color: a.tr.color, align: 'left', weight: 800 });
      text(c, a.n + '/' + (a.next || a.tr.tiers[a.tier]), 12 + w - 8, y + 14, { size: 11, color: '#eaf2ff', align: 'right', weight: 700 });
      text(c, a.tr.txt[a.tier], 12 + w - 46, y + 14, { size: 9.5, color: PALETTE.dim, align: 'right' });
      y += 32;
    }
  }

  function drawUnits(c) {
    for (const u of G.units) {
      if (!u.onBoard) continue;
      if (!u.alive || u.hp <= 0) {
        c.save(); c.globalAlpha = 0.2;
        drawUnitBody(c, u, u.px, u.py, cell * 0.34, true);
        c.restore();
        continue;
      }
      drawUnitBody(c, u, u.px, u.py, cell * 0.34, false);
      drawBars(c, u);
    }
    // 拖拽中的棋子跟随手指
    if (drag.on && drag.moved && drag.u) drawUnitBody(c, drag.u, drag.x, drag.y, cell * 0.38, false);
  }

  function drawUnitBody(c, u, x, y, r, ghost) {
    const d = u.def, col = u.team === 0 ? TRAITS[d.tr[0]].color : PALETTE.red;
    const dead = !u.alive || u.hp <= 0;
    c.save();
    c.translate(x, y);
    if (u.hurt > 0 && !dead) c.translate(rng.range(-3, 3), rng.range(-3, 3));
    if (G.sel === u.uid && !ghost) glowCircle(c, 0, 0, r + 6, PALETTE.lime, { glow: 14, width: 1.5, alpha: .8 });
    if (u.castFx > 0) glowCircle(c, 0, 0, r + 10 + (0.5 - u.castFx) * 30, PALETTE.violet, { glow: 16, width: 2, alpha: u.castFx });
    // 本体
    c.beginPath();
    if (u.star === 1) { c.moveTo(0, -r); c.lineTo(r * .9, r * .7); c.lineTo(-r * .9, r * .7); c.closePath(); }
    else if (u.star === 2) { roundRect(c, -r * .82, -r * .82, r * 1.64, r * 1.64, 5); }
    else { starPath(c, 0, 0, r * 1.05, 6, 0.62, -Math.PI / 2); }
    c.fillStyle = dead ? 'rgba(60,70,100,.5)' : (u.team === 0 ? 'rgba(34,224,255,.14)' : 'rgba(255,77,94,.16)');
    c.fill();
    c.save(); c.shadowColor = col; c.shadowBlur = 12; c.strokeStyle = col; c.lineWidth = 2; c.stroke(); c.restore();
    glowDot(c, 0, 0, r * 0.34, col, .9);
    // 星级标记
    for (let i = 0; i < u.star; i++) {
      const px2 = (i - (u.star - 1) / 2) * 7;
      c.fillStyle = PALETTE.amber;
      c.beginPath(); c.moveTo(px2, -r - 4); c.lineTo(px2 + 3, -r); c.lineTo(px2, -r + 4); c.lineTo(px2 - 3, -r); c.closePath(); c.fill();
    }
    c.restore();
    if (!ghost) text(c, d.name.slice(0, 3), x, y + r + 9, { size: 8.5, color: '#9fb0d6' });
  }

  function drawBars(c, u) {
    const w = cell * 0.72, x = u.px - w / 2, y = u.py - cell * 0.34 - 12;
    bar(c, x, y, w, 5, u.hp / u.maxHp, { fill: u.team === 0 ? PALETTE.green : PALETTE.red, bg: 'rgba(0,0,0,.55)' });
    if (u.shield > 0) bar(c, x, y - 5, w * clamp01(u.shield / u.maxHp), 3, { fill: PALETTE.cyan, bg: 'rgba(0,0,0,0)' });
    bar(c, x, y + 8, w, 3, u.mana / 100, { fill: PALETTE.violet, bg: 'rgba(0,0,0,.5)' });
  }

  function drawBench(c) {
    const w = benchCell * 8;
    fillRound(c, bx - 3, benchY - 3, w + 6, benchCell + 6, 8, 'rgba(10,16,32,.7)');
    strokeRound(c, bx - 3, benchY - 3, w + 6, benchCell + 6, 8, '#243357', 1.2);
    for (let i = 0; i < 8; i++) {
      const x = bx + i * benchCell;
      strokeRound(c, x + 2, benchY + 2, benchCell - 4, benchCell - 4, 6, 'rgba(80,110,170,.25)', 1);
    }
    text(c, '备战席', bx - 6, benchY + benchCell / 2, { size: 10, color: PALETTE.dim, align: 'right' });
    for (const u of G.units) {
      if (u.onBoard || u.team !== 0) continue;
      const x = benchX(Math.max(0, u.bench));
      drawUnitBody(c, u, x, benchY + benchCell / 2, benchCell * 0.32, false);
    }
  }

  // ---------------- 生命周期 ----------------
  function resize(w, h) {
    W = w; H = h; layout();
    for (const u of G.units) if (u.onBoard) { u.px = cellX(u.gx); u.py = cellY(u.gy); }
  }

  return {
    update, render, resize,
    pause() { audio.duck(0.5, 2000); },
    resume() { },
    destroy() { shopEl.remove(); }
  };
}
