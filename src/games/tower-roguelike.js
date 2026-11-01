// 塔防·词条构筑 —— 固定路径 + 每波三选一词条构筑流派（暴击 / 毒 / 弹射 / 连锁…）
import { clamp, lerp, TAU, fmtNum } from '../core/math.js';
import { PALETTE, neon, glowCircle, roundRect, text, bar, grid as drawGrid, panel, vignette, wrapText } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';
export const meta = {
  id: 'tower-roguelike',
  title: '塔防·词条构筑',
  category: 'strategy',
  difficulty: 4,
  music: 'tense',
  howto: [
    '选塔后点亮起的基座即可建造，敌人沿固定路线进攻',
    '每波结束从 3 个词条中选 1 个，词条可叠加形成流派',
    '紫色为反向词条：敌人变强但奖励翻倍；第 20 波是 BOSS'
  ],
  particles: 1400
};
export const musicTrack = 'tense';
const COLS = 22, ROWS = 12;
const MAX_WAVE = 20;
const WAY = [[0, 2], [4, 2], [4, 7], [9, 7], [9, 1], [14, 1], [14, 9], [7, 9], [7, 4], [2, 4], [2, 10], [18, 10]];
const TOWERS = {
  bolt: { name: '速射塔', icon: '↟', color: PALETTE.cyan, cost: 45, dmg: 9, rate: 0.30, range: 2.8, tip: '高频单体，吃攻速/暴击/弹射' },
  arc: { name: '榴弹塔', icon: '◉', color: PALETTE.amber, cost: 75, dmg: 24, rate: 1.15, range: 3.2, splash: 1.0, tip: '范围爆炸，吃溅射/毒/燃烧' }
};
const EDEF = {
  grunt: { hp: 36, spd: 1.95, gold: 6, r: 0.26, armor: 0, col: '#ff6b7a' },
  runner: { hp: 22, spd: 3.25, gold: 5, r: 0.22, armor: 0, col: PALETTE.violet },
  brute: { hp: 130, spd: 1.2, gold: 15, r: 0.37, armor: 4, col: '#ff9a3c' },
  swarm: { hp: 15, spd: 2.5, gold: 3, r: 0.18, armor: 0, col: PALETTE.lime }
};
const BOSS = { hp: 2800, spd: 0.95, gold: 220, r: 0.62, armor: 10, col: PALETTE.magenta };
const RARITY = [
  null,
  { key: '普通', col: '#28e0a0', w: 62 },
  { key: '稀有', col: '#3b82f6', w: 30 },
  { key: '史诗', col: '#ffb020', w: 11 }
];
const CURSED = { key: '诅咒', col: '#ff2e88' };
// ---------------- 词条表（32 条）----------------
const PERKS = [
  { id: 'dmg', n: '重弹', i: '✦', r: 1, max: 6, d: '所有塔伤害 +25%', a: (s, e, k) => { s.dmg += 0.25 * k; } },
  { id: 'rate', n: '工程', i: '⚙', r: 1, max: 6, d: '所有塔攻速 +20%', a: (s, e, k) => { s.rate *= Math.pow(1.2, k); } },
  { id: 'range', n: '校准', i: '◎', r: 1, max: 4, d: '所有塔射程 +18%', a: (s, e, k) => { s.range += 0.18 * k; } },
  { id: 'crit', n: '暴击', i: '✧', r: 1, max: 6, d: '15% 概率造成 3 倍伤害', a: (s, e, k) => { s.critC += 0.15 * k; } },
  { id: 'critm', n: '致命', i: '☠', r: 2, max: 4, d: '暴击倍率 +1.0', a: (s, e, k) => { s.critM += 1 * k; } },
  { id: 'pierce', n: '穿透', i: '➤', r: 1, max: 3, d: '子弹额外穿透 1 个敌人', a: (s, e, k) => { s.pierce += k; } },
  { id: 'bounce', n: '弹射', i: '↗', r: 2, max: 3, d: '命中后弹射到附近敌人', a: (s, e, k) => { s.bounce += k; } },
  { id: 'chain', n: '连锁闪电', i: '⚡', r: 2, max: 3, d: '命中时 30% 触发闪电链（+1 跳）', a: (s, e, k) => { s.chain += k; s.chainP += 0.3 * k; } },
  { id: 'chainp', n: '电磁场', i: '❖', r: 1, max: 4, d: '闪电触发概率 +20%', a: (s, e, k) => { s.chainP += 0.2 * k; } },
  { id: 'poison', n: '毒', i: '☣', r: 1, max: 6, d: '命中附加中毒（每秒伤害 +6）', a: (s, e, k) => { s.poison += 6 * k; } },
  { id: 'venom', n: '剧毒', i: '⚗', r: 3, max: 2, d: '中毒伤害翻倍，且无视护甲', a: (s, e, k) => { s.venom += k; } },
  { id: 'slow', n: '冰霜', i: '❄', r: 2, max: 4, d: '命中减速 15%（可叠加）', a: (s, e, k) => { s.slow = Math.min(0.7, s.slow + 0.15 * k); } },
  { id: 'greed', n: '贪婪', i: '💰', r: 1, max: 5, d: '击杀金币 +50%', a: (s, e, k) => { s.greed += 0.5 * k; } },
  { id: 'tax', n: '战争税', i: '⛁', r: 1, max: 4, d: '每次击杀额外 +2 金', a: (s, e, k) => { s.killGold += 2 * k; } },
  { id: 'income', n: '补给', i: '✚', r: 1, max: 4, d: '每波开始 +25 金', a: (s, e, k) => { s.waveGold += 25 * k; } },
  { id: 'interest', n: '利息', i: '％', r: 2, max: 3, d: '每波结束获得当前金币 8%', a: (s, e, k) => { s.interest += 0.08 * k; } },
  { id: 'armor', n: '穿甲', i: '✖', r: 2, max: 4, d: '无视敌人护甲 +4', a: (s, e, k) => { s.ap += 4 * k; } },
  { id: 'soft', n: '腐蚀', i: '◌', r: 1, max: 3, d: '敌人护甲 -40%', a: (s, e, k) => { s.soft *= Math.pow(0.6, k); } },
  { id: 'bullet', n: '高速弹', i: '⇶', r: 1, max: 3, d: '弹速 +45%，更易命中移动目标', a: (s, e, k) => { s.bulletSpd += 0.45 * k; } },
  { id: 'splash', n: '巨弹', i: '◉', r: 2, max: 4, d: '榴弹塔爆炸范围 +35%', a: (s, e, k) => { s.splash += 0.35 * k; } },
  { id: 'boltD', n: '枪管强化', i: '↟', r: 1, max: 4, d: '速射塔伤害 +35%', a: (s, e, k) => { s.boltD += 0.35 * k; } },
  { id: 'arcD', n: '炮弹强化', i: '◉', r: 1, max: 4, d: '榴弹塔伤害 +35%', a: (s, e, k) => { s.arcD += 0.35 * k; } },
  { id: 'boltR', n: '超频', i: '⋙', r: 2, max: 3, d: '速射塔攻速 +30%', a: (s, e, k) => { s.boltR *= Math.pow(1.3, k); } },
  { id: 'execute', n: '猎杀', i: '☄', r: 2, max: 3, d: '对生命低于 35% 的敌人 +60% 伤害', a: (s, e, k) => { s.execute += 0.6 * k; } },
  { id: 'elite', n: '精英猎手', i: '★', r: 2, max: 3, d: '对精英 / BOSS 伤害 +40%', a: (s, e, k) => { s.eliteDmg += 0.4 * k; } },
  { id: 'multi', n: '双联装', i: '⑂', r: 3, max: 2, d: '每次攻击额外发射 1 发子弹', a: (s, e, k) => { s.multi += k; } },
  { id: 'repair', n: '维修', i: '✜', r: 2, max: 3, d: '每波结束回复 2 点生命', a: (s, e, k) => { s.repair += 2 * k; } },
  { id: 'lucky', n: '幸运', i: '☘', r: 3, max: 1, d: '每波词条选择 +1 个选项', a: (s, e, k) => { s.lucky += k; } },
  { id: 'resonate', n: '共鸣', i: '◈', r: 1, max: 5, d: '每座已建塔使全体伤害 +3%', a: (s, e, k) => { s.reso += 0.03 * k; } },
  { id: 'vamp', n: '汲取', i: '❤', r: 3, max: 2, d: '每击杀 25 个敌人回复 1 点生命', a: (s, e, k) => { s.vamp += k; } },
  // ---- 反向词条 ----
  { id: 'c_hp', n: '血肉献祭', i: '☠', r: 3, max: 3, curse: 1, d: '敌人生命 +30%，但金币奖励 +100%', a: (s, e, k) => { e.hp *= Math.pow(1.3, k); s.greed += 1 * k; } },
  { id: 'c_spd', n: '狂暴', i: '⇉', r: 3, max: 3, curse: 1, d: '敌人速度 +18%，但金币奖励 +70%', a: (s, e, k) => { e.spd *= Math.pow(1.18, k); s.greed += 0.7 * k; } },
  { id: 'c_shield', n: '能量护盾', i: '◘', r: 3, max: 3, curse: 1, d: '敌人获得 20% 减伤，但金币奖励 +80%', a: (s, e, k) => { e.shield += 0.2 * k; s.greed += 0.8 * k; } },
  { id: 'c_split', n: '细胞分裂', i: '❋', r: 3, max: 2, curse: 1, d: '敌人死亡分裂，但金币奖励 +60%', a: (s, e, k) => { e.split += k; s.greed += 0.6 * k; } }
];
const PERK_BY_ID = {};
for (const p of PERKS) PERK_BY_ID[p.id] = p;
const STAT_DEF = {
  dmg: 1, rate: 1, range: 1, critC: 0, critM: 3, pierce: 0, bounce: 0, chain: 0, chainP: 0, poison: 0, venom: 0, slow: 0,
  greed: 1, killGold: 0, waveGold: 0, interest: 0, ap: 0, soft: 1, bulletSpd: 1, splash: 1, boltD: 1, arcD: 1, boltR: 1,
  execute: 0, eliteDmg: 0, multi: 0, repair: 0, lucky: 0, reso: 0, vamp: 0
};
const EMOD_DEF = { hp: 1, spd: 1, shield: 0, split: 0 };
export function create(ctx) {
  const { input, audio, particles, shake, flash, rng, save } = ctx;
  // ---- 布局 ----
  let cell = 34, ox = 0, oy = 0;
  function layout(w, h) {
    const topPad = 46, botPad = h > 620 ? 112 : 92;
    cell = Math.max(11, Math.floor(Math.min((w - 26) / COLS, (h - topPad - botPad) / ROWS)));
    ox = Math.round((w - cell * COLS) / 2);
    oy = Math.round(topPad + Math.max(0, (h - topPad - botPad - cell * ROWS) / 2));
  }
  layout(ctx.W, ctx.H);
  const px = (gx) => ox + gx * cell;
  const py = (gy) => oy + gy * cell;
  // 路线（像素折线）
  const WX = new Float32Array(WAY.length), WY = new Float32Array(WAY.length);
  const SEGL = new Float32Array(WAY.length);
  function rebuildWay() {
    for (let i = 0; i < WAY.length; i++) { WX[i] = px(WAY[i][0]); WY[i] = py(WAY[i][1]); }
    for (let i = 0; i < WAY.length - 1; i++) SEGL[i] = Math.hypot(WX[i + 1] - WX[i], WY[i + 1] - WY[i]);
  }
  rebuildWay();
  // 路径点到线段的距离（用于生成建造基座）
  function distToPath(gx, gy) {
    const x = px(gx), y = py(gy);
    let best = 1e9;
    for (let i = 0; i < WAY.length - 1; i++) {
      const ax = WX[i], ay = WY[i], bx = WX[i + 1], by = WY[i + 1];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1);
      best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
    }
    return best / cell;
  }
  // ---- 建造基座 ----
  const slots = [];
  function genSlots() {
    slots.length = 0;
    const cand = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const d = distToPath(x + 0.5, y + 0.5);
      if (d > 1.15 && d < 2.5) cand.push([x + 0.5, y + 0.5]);
    }
    rng.shuffle(cand);
    for (const c of cand) {
      if (slots.length >= 12) break;
      let ok = true;
      for (const s of slots) if (Math.hypot(s.gx - c[0], s.gy - c[1]) < 2.4) { ok = false; break; }
      if (ok) slots.push({ gx: c[0], gy: c[1], tower: -1 });
    }
  }
  genSlots();
  // ---- 对象池 ----
  const MAXE = 140, MAXB = 200, MAXT = 40, MAXF = 36;
  const enemies = [];   // 敌人池
  for (let i = 0; i < MAXE; i++) enemies.push({ alive: false, type: 'grunt', x: 0, y: 0, seg: 0, u: 0, hp: 1, maxHp: 1, spd: 1, gold: 0, armor: 0, r: 8, col: '#fff', slowT: 0, slowAmt: 0, poiT: 0, poi: 0, hitFx: 0, elite: false, boss: false, scale: 1, wob: 0, split: false });
  const bullets = [];   // 子弹池（hit 位图避免重复命中）
  for (let i = 0; i < MAXB; i++) bullets.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, spd: 300, dmg: 0, r: 3, col: '#fff', ti: -1, pierce: 0, bounce: 0, splash: 0, homing: true, life: 0, hit: new Uint8Array(MAXE), crit: false });
  const towers = [];
  for (let i = 0; i < MAXT; i++) towers.push({ alive: false, type: 'bolt', slot: 0, x: 0, y: 0, cd: 0, ang: 0, ti: -1, born: 0, kills: 0, flash: 0 });
  const fx = [];        // 闪电 / 爆炸环
  for (let i = 0; i < MAXF; i++) fx.push({ alive: false, kind: 0, x1: 0, y1: 0, x2: 0, y2: 0, r: 0, t: 0, max: 0.3, col: '#fff' });
  const floaters = [];
  for (let i = 0; i < 24; i++) floaters.push({ alive: false, x: 0, y: 0, str: '', col: '#fff', t: 0 });
  function addFx(kind, x1, y1, x2, y2, r, col, dur) {
    for (let i = 0; i < MAXF; i++) {
      if (fx[i].alive) continue;
      fx[i].alive = true; fx[i].kind = kind; fx[i].x1 = x1; fx[i].y1 = y1; fx[i].x2 = x2; fx[i].y2 = y2; fx[i].r = r; fx[i].col = col; fx[i].t = 0; fx[i].max = dur;
      return fx[i];
    }
    return null;
  }
  function float(x, y, str, col) { for (let i = 0; i < floaters.length; i++) { if (floaters[i].alive) continue; floaters[i].alive = true; floaters[i].x = x; floaters[i].y = y; floaters[i].str = str; floaters[i].col = col; floaters[i].t = 0; return; } }
  // ---- 状态 ----
  const S = {
    gold: 150, lives: 20, wave: 0, kills: 0, phase: 'prep', prepT: 10,
    selType: 'bolt', selSlot: -1, t: 0, over: false, best: save.get('bestWave', 0),
    stat: { ...STAT_DEF }, emod: { ...EMOD_DEF },
    perkId: [], perkStack: [], picked: 0, offers: [], vampCount: 0,
    hoverSlot: -1, hoverPerk: -1, rewardFlash: 0
  };
  const piX = new Float32Array(40), piY = new Float32Array(40);
  const modsBuf = new Array(4);
  let piN = 0;
  function recalc() {   // 由已获词条重算全部加成
    Object.assign(S.stat, STAT_DEF);
    Object.assign(S.emod, EMOD_DEF);
    for (let i = 0; i < S.perkId.length; i++) PERK_BY_ID[S.perkId[i]].a(S.stat, S.emod, S.perkStack[i]);
    S.stat.resoTotal = 1 + S.stat.reso * towerCount();
    piN = S.perkId.length;
  }
  function towerCount() { let n = 0; for (let i = 0; i < MAXT; i++) if (towers[i].alive) n++; return n; }
  // ---- 波次 ----
  const SQ = 200;
  const sqType = new Array(SQ), sqAt = new Float32Array(SQ), sqFlag = new Uint8Array(SQ);
  let sqN = 0, sqI = 0, spawnT = 0;
  function buildWave(w) {
    sqN = 0;
    const hpMul = Math.pow(1.165, w - 1) * S.emod.hp;
    const pool = [['grunt', 50]];
    if (w >= 3) pool.push(['runner', 26]);
    if (w >= 5) pool.push(['brute', 15]);
    if (w >= 7) pool.push(['swarm', 22]);
    let count = 4 + Math.round(w * 2.1), delay = 0;
    while (count > 0 && sqN < SQ - 4) {
      const t = rng.weighted(pool.map(([n, ww]) => ({ n, w: ww })), (it) => it.w).n;
      const n = Math.min(count, t === 'swarm' ? rng.int(4, 7) : rng.int(2, 4));
      count -= n;
      for (let i = 0; i < n; i++) {
        sqType[sqN] = t; sqAt[sqN] = delay + i * (t === 'swarm' ? 0.24 : 0.6); sqFlag[sqN] = 0; sqN++;
      }
      delay += n * 0.55 + 0.7;
    }
    const eliteN = w % 5 === 0 ? 1 : 0;
    for (let i = 0; i < eliteN; i++) { sqType[sqN] = 'grunt'; sqAt[sqN] = delay + 0.4; sqFlag[sqN] = 1; sqN++; }
    if (w >= MAX_WAVE) { sqType[sqN] = 'boss'; sqAt[sqN] = delay + 1.6; sqFlag[sqN] = 2; sqN++; }
    S.hpMul = hpMul;
  }
  function startWave() {
    if (S.phase !== 'prep' || S.over) return;
    S.wave++;
    S.gold += S.stat.waveGold;
    buildWave(S.wave);
    sqI = 0; spawnT = 0;
    S.phase = 'wave';
    audio.sfx('alarm'); audio.duck(0.3, 700);
    ctx.vibrate(PATTERNS.land);
    ctx.hint('第 ' + S.wave + ' 波' + (S.wave === MAX_WAVE ? ' —— BOSS！' : S.wave % 5 === 0 ? ' —— 精英出没' : ''), 2400);
    refreshUI();
  }
  function spawnEnemy(type, flag) {
    for (let i = 0; i < MAXE; i++) {
      const e = enemies[i];
      if (e.alive) continue;
      const d = flag === 2 ? BOSS : EDEF[type];
      const elite = flag === 1;
      e.alive = true; e.type = flag === 2 ? 'boss' : type; e.elite = elite; e.boss = flag === 2;
      e.maxHp = Math.round(d.hp * S.hpMul * (elite ? 3.2 : 1)); e.hp = e.maxHp;
      e.spd = d.spd * S.emod.spd * (elite ? 0.85 : 1);
      e.gold = Math.round(d.gold * (1 + S.hpMul * 0.12) * (elite ? 3 : 1) * (flag === 2 ? 1 : 1));
      e.armor = d.armor * S.stat.soft; e.col = d.col;
      e.r = d.r * cell * (elite ? 1.35 : 1); e.scale = elite ? 1.25 : 1;
      e.seg = 0; e.u = 0; e.x = WX[0]; e.y = WY[0];
      e.slowT = 0; e.slowAmt = 0; e.poiT = 0; e.poi = 0; e.hitFx = 0; e.wob = rng.range(0, TAU);
      return e;
    }
    return null;
  }
  // ---- 建造 ----
  function buildAt(si) {
    const s = slots[si];
    if (!s || s.tower >= 0) return;
    const def = TOWERS[S.selType];
    if (S.gold < def.cost) { deny('金币不足'); return; }
    let ti = -1;
    for (let i = 0; i < MAXT; i++) if (!towers[i].alive) { ti = i; break; }
    if (ti < 0) return;
    const t = towers[ti];
    t.alive = true; t.type = S.selType; t.slot = si; t.x = px(s.gx); t.y = py(s.gy);
    t.cd = 0; t.ang = -Math.PI / 2; t.ti = -1; t.born = S.t; t.kills = 0; t.flash = 0;
    s.tower = ti; S.gold -= def.cost;
    audio.sfx('build'); ctx.vibrate(PATTERNS.tap); shake.add(0.1);
    particles.ring(t.x, t.y, def.color, cell * 1.3);
    particles.burst(t.x, t.y, 14, { color: def.color, speed: 160, life: .5, kind: 4 });
    float(t.x, t.y - cell * .6, '-' + def.cost, PALETTE.red);
    recalc(); refreshUI();
  }
  function deny(msg) { audio.sfx('error'); ctx.vibrate(PATTERNS.error); ctx.hint(msg, 1600); }
  // ---- 战斗 ----
  function pickTarget(t, range) {
    let best = -1, bestU = -1;
    for (let i = 0; i < MAXE; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      if (Math.hypot(e.x - t.x, e.y - t.y) > range + e.r) continue;
      const u = e.seg + e.u;
      if (u > bestU) { bestU = u; best = i; }   // 打最靠前的
    }
    return best;
  }
  function fire(t, ti) {
    const def = TOWERS[t.type], st = S.stat;
    const shots = 1 + st.multi;
    for (let s = 0; s < shots; s++) {
      let bi = -1;
      for (let i = 0; i < MAXB; i++) if (!bullets[i].alive) { bi = i; break; }
      if (bi < 0) return;
      const b = bullets[bi];
      const base = def.dmg * st.dmg * (t.type === 'bolt' ? st.boltD : st.arcD) * st.resoTotal;
      b.alive = true; b.x = t.x; b.y = t.y; b.col = def.color;
      b.dmg = base; b.spd = (t.type === 'bolt' ? 620 : 400) * st.bulletSpd;
      b.r = t.type === 'bolt' ? 3 : 5.5;
      b.pierce = st.pierce; b.bounce = st.bounce; b.homing = true; b.life = 1.6;
      b.splash = t.type === 'arc' ? def.splash * st.splash * cell : 0;
      b.ti = t.ti; b.hit.fill(0);
      b.crit = rng.chance(st.critC);
      if (b.crit) b.dmg *= st.critM;
      const spread = (s - (shots - 1) / 2) * 0.16;
      const a = t.ang + spread;
      b.vx = Math.cos(a) * b.spd; b.vy = Math.sin(a) * b.spd;
    }
    t.flash = 0.12;
    audio.sfx(t.type === 'bolt' ? 'shoot' : 'place', { gain: .3 });
  }
  function damage(e, ei, dmg, col, pierceAp) {
    const armor = Math.max(0, e.armor - (pierceAp ? 99 : 0));
    let d = Math.max(1, dmg - armor);
    if (S.emod.shield > 0) d *= (1 - Math.min(0.75, S.emod.shield));
    if (e.elite || e.boss) d *= (1 + S.stat.eliteDmg);
    if (S.stat.execute > 0 && e.hp / e.maxHp < 0.35) d *= (1 + S.stat.execute);
    e.hp -= d; e.hitFx = 0.1;
    if (d > 25 || e.boss) float(e.x, e.y - e.r - 6, '' + Math.round(d), e.boss ? PALETTE.magenta : '#fff');
    if (e.hp <= 0) killEnemy(e, ei, col);
  }
  function killEnemy(e, ei, col) {
    e.alive = false;
    S.kills++;
    const g = Math.max(1, Math.round(e.gold * S.stat.greed + S.stat.killGold));
    S.gold += g;
    particles.burst(e.x, e.y, e.boss ? 42 : e.elite ? 24 : 12, { color: e.col, speed: e.boss ? 320 : 170, life: .6, size: e.boss ? 5 : 3, kind: 1 });
    particles.explosion(e.x, e.y, e.boss ? 2 : e.elite ? 1 : .5, e.boss ? PALETTE.magenta : col || PALETTE.amber);
    float(e.x, e.y - e.r - 2, '+' + g, PALETTE.amber);
    audio.sfx(e.boss ? 'explode' : 'coin', { gain: e.boss ? 1 : .4 });
    if (e.boss) { shake.add(0.8); flash.add(0.35, '#ff2e88'); ctx.vibrate(PATTERNS.explode); }
    else if (e.elite) { shake.add(0.3); ctx.vibrate(PATTERNS.combo); }
    // 分裂
    if (S.emod.split > 0 && !e.boss && !e.split) {
      for (let k = 0; k < S.emod.split; k++) {
        const c = spawnEnemy('swarm', 0);
        if (c) {
          c.split = true; c.seg = e.seg; c.u = e.u; c.x = e.x + rng.range(-8, 8); c.y = e.y + rng.range(-8, 8);
          c.maxHp = Math.round(e.maxHp * 0.22); c.hp = c.maxHp; c.r = e.r * 0.6; c.gold = Math.round(e.gold * 0.3);
        }
      }
    }
    if (S.stat.vamp > 0) { S.vampCount++; if (S.vampCount >= Math.max(6, 25 - S.stat.vamp * 6)) { S.vampCount = 0; S.lives = Math.min(20, S.lives + 1); audio.sfx('heal'); } }
    for (let i = 0; i < MAXT; i++) if (towers[i].ti === ei) towers[i].ti = -1;
    for (let i = 0; i < MAXB; i++) if (bullets[i].ti === ei) bullets[i].ti = -1;
  }
  function updateEnemies(dt) {
    for (let i = 0; i < MAXE; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      e.wob += dt * 5;
      if (e.hitFx > 0) e.hitFx -= dt;
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowAmt = 0; }
      if (e.poiT > 0) {
        e.poiT -= dt; e.hp -= e.poi * (1 + S.stat.venom) * dt;
        if (rng.chance(0.12)) particles.trail(e.x + rng.range(-6, 6), e.y + rng.range(-6, 6), '#8dff4d', 2);
        if (e.hp <= 0) { killEnemy(e, i, '#8dff4d'); continue; }
      }
      let d = e.spd * cell * dt * (1 - e.slowAmt);
      while (d > 0) {
        if (e.seg >= WAY.length - 2) { leak(e, i); break; }
        const rem = (1 - e.u) * SEGL[e.seg];
        if (d < rem) { e.u += d / SEGL[e.seg]; d = 0; }
        else { d -= rem; e.seg++; e.u = 0; }
      }
      if (!e.alive) continue;
      e.x = lerp(WX[e.seg], WX[e.seg + 1], e.u);
      e.y = lerp(WY[e.seg], WY[e.seg + 1], e.u);
    }
  }
  function leak(e, i) {
    e.alive = false;
    const d = e.boss ? 8 : e.elite ? 2 : 1;
    S.lives -= d;
    audio.sfx('hurt'); ctx.vibrate(PATTERNS.damage); shake.add(0.5); flash.add(0.25, '#ff4d5e');
    particles.explosion(WX[WAY.length - 1], WY[WAY.length - 1], 1.2, PALETTE.red);
    float(WX[WAY.length - 1], WY[WAY.length - 1] - cell, '-' + d, PALETTE.red);
    if (S.lives <= 0) { S.lives = 0; gameOver(false); }
  }
  function updateTowers(dt) {
    const st = S.stat;
    for (let i = 0; i < MAXT; i++) {
      const t = towers[i];
      if (!t.alive) continue;
      if (t.flash > 0) t.flash -= dt;
      const def = TOWERS[t.type];
      const R = def.range * st.range * cell;
      if (t.ti >= 0) {
        const e = enemies[t.ti];
        if (!e.alive || Math.hypot(e.x - t.x, e.y - t.y) > R + e.r) t.ti = -1;
      }
      if (t.ti < 0) t.ti = pickTarget(t, R);
      if (t.ti >= 0) {
        const e = enemies[t.ti];
        const want = Math.atan2(e.y - t.y, e.x - t.x);
        let diff = ((want - t.ang + Math.PI) % TAU + TAU) % TAU - Math.PI;
        t.ang += diff * Math.min(1, dt * 14);
      }
      t.cd -= dt;
      if (t.cd <= 0 && t.ti >= 0) {
        const rate = def.rate / st.rate / (t.type === 'bolt' ? st.boltR : 1);
        t.cd = rate;
        fire(t, i);
      }
    }
  }
  function updateBullets(dt) {
    const st = S.stat;
    for (let i = 0; i < MAXB; i++) {
      const b = bullets[i];
      if (!b.alive) continue;
      b.life -= dt;
      if (b.life <= 0) { b.alive = false; continue; }
      if (b.homing && b.ti >= 0) {
        const e = enemies[b.ti];
        if (!e.alive) {
          if (b.bounce > 0) { if (!retarget(b)) { b.alive = false; continue; } }
          else { b.alive = false; continue; }
        } else {
          const a = Math.atan2(e.y - b.y, e.x - b.x);
          b.vx = lerp(b.vx, Math.cos(a) * b.spd, 0.35);
          b.vy = lerp(b.vy, Math.sin(a) * b.spd, 0.35);
        }
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (rng.chance(0.45)) particles.trail(b.x, b.y, b.col, b.r * 0.5);
      // 碰撞
      for (let k = 0; k < MAXE; k++) {
        const e = enemies[k];
        if (!e.alive || b.hit[k]) continue;
        if (Math.hypot(e.x - b.x, e.y - b.y) > b.r + e.r) continue;
        b.hit[k] = 1;
        onHit(b, i, e, k);
        if (!b.alive) break;
      }
    }
  }
  function retarget(b) {
    let best = -1, bd = 4.2 * cell;
    for (let k = 0; k < MAXE; k++) {
      const e = enemies[k];
      if (!e.alive || b.hit[k]) continue;
      const d = Math.hypot(e.x - b.x, e.y - b.y);
      if (d < bd) { bd = d; best = k; }
    }
    if (best < 0) return false;
    b.bounce--; b.ti = best; b.homing = true;
    addFx(1, b.x, b.y, enemies[best].x, enemies[best].y, 0, b.col, 0.18);
    return true;
  }
  function onHit(b, bi, e, ei) {
    const st = S.stat;
    damage(e, ei, b.dmg, b.col, false);
    particles.burst(e.x, e.y, b.crit ? 12 : 5, { color: b.crit ? PALETTE.amber : b.col, speed: b.crit ? 220 : 130, life: .35, size: b.crit ? 3.4 : 2.4, kind: 1 });
    if (b.crit) float(e.x, e.y - e.r - 14, '暴击!', PALETTE.amber);
    if (st.poison > 0) { e.poi = st.poison; e.poiT = 3; }
    if (st.slow > 0) { e.slowAmt = Math.max(e.slowAmt, Math.min(0.7, st.slow)); e.slowT = 1.2; }
    if (b.splash > 0) {
      particles.explosion(b.x, b.y, b.splash / cell, PALETTE.amber);
      addFx(0, b.x, b.y, 0, 0, b.splash, PALETTE.amber, 0.3);
      audio.sfx('explode', { gain: .45 }); shake.add(0.12);
      for (let k = 0; k < MAXE; k++) {
        const o = enemies[k];
        if (!o.alive || k === ei) continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (d > b.splash + o.r) continue;
        damage(o, k, b.dmg * 0.55 * (1 - 0.4 * d / (b.splash + o.r)), PALETTE.amber, false);
        if (st.poison > 0) { o.poi = st.poison; o.poiT = 3; }
      }
      b.alive = false;
      return;
    }
    // 闪电链
    if (st.chain > 0 && rng.chance(Math.min(0.95, st.chainP))) {
      let cx = e.x, cy = e.y, from = ei;
      for (let j = 0; j < st.chain; j++) {
        let best = -1, bd = 3.2 * cell;
        for (let k = 0; k < MAXE; k++) {
          const o = enemies[k];
          if (!o.alive || k === from || b.hit[k]) continue;
          const d = Math.hypot(o.x - cx, o.y - cy);
          if (d < bd) { bd = d; best = k; }
        }
        if (best < 0) break;
        const o = enemies[best];
        addFx(1, cx, cy, o.x, o.y, 0, PALETTE.cyan, 0.22);
        damage(o, best, b.dmg * 0.6, PALETTE.cyan, true);
        if (st.poison > 0) { o.poi = st.poison; o.poiT = 3; }
        cx = o.x; cy = o.y; from = best;
      }
      audio.sfx('reflect', { gain: .3 });
    }
    if (b.pierce > 0) { b.pierce--; b.homing = false; return; }
    if (b.bounce > 0 && retarget(b)) return;
    b.alive = false;
  }
  function updateSpawns(dt) {
    if (S.phase !== 'wave') return;
    spawnT += dt;
    while (sqI < sqN && sqAt[sqI] <= spawnT) {
      spawnEnemy(sqType[sqI], sqFlag[sqI]);
      sqI++;
    }
    if (sqI >= sqN && !anyEnemy()) endWave();
  }
  function anyEnemy() { for (let i = 0; i < MAXE; i++) if (enemies[i].alive) return true; return false; }
  function endWave() {
    S.gold += Math.round(28 + S.wave * 5 + S.gold * S.stat.interest);
    if (S.stat.repair > 0) { S.lives = Math.min(20, S.lives + S.stat.repair); audio.sfx('heal'); }
    // 敌人随机强化
    let gained = 0;
    const rolls = 1 + Math.floor(S.wave / 6);
    for (let i = 0; i < rolls; i++) {
      if (rng.chance(0.55 + S.wave * 0.015)) {
        const k = rng.int(0, 2);
        if (k === 0) S.emod.hp *= 1.08;
        else if (k === 1) S.emod.spd = Math.min(1.9, S.emod.spd * 1.05);
        else S.emod.shield = Math.min(0.6, S.emod.shield + 0.05);
        gained++;
      }
    }
    if (S.wave >= MAX_WAVE) { gameOver(true); return; }
    S.phase = 'perk';
    rollOffers();
    showCards();
    audio.sfx('confirm');
    if (S.wave > S.best) { S.best = S.wave; save.set('bestWave', S.best); }
    refreshUI();
  }
  function rollOffers() {
    S.offers.length = 0;
    const avail = [];
    for (const p of PERKS) {
      const at = S.perkId.indexOf(p.id);
      if (at >= 0 && S.perkStack[at] >= p.max) continue;
      avail.push(p);
    }
    const n = 3 + S.stat.lucky;
    for (let i = 0; i < n && avail.length; i++) {
      const pool = avail.map((p) => ({ p, w: p.curse ? 14 : RARITY[p.r].w }));
      const pick = rng.weighted(pool, (it) => it.w).p;
      S.offers.push(pick.id);
      avail.splice(avail.indexOf(pick), 1);
    }
  }
  function takePerk(id) {
    const p = PERK_BY_ID[id];
    const at = S.perkId.indexOf(id);
    if (at >= 0) S.perkStack[at]++;
    else { S.perkId.push(id); S.perkStack.push(1); }
    S.picked++;
    recalc();
    hideCards();
    audio.sfx(p.curse ? 'portal' : 'powerup');
    ctx.vibrate(p.curse ? PATTERNS.error : PATTERNS.combo);
    flash.add(0.2, p.curse ? CURSED.col : RARITY[p.r].col);
    particles.ring(ctx.W / 2, ctx.H / 2, p.curse ? CURSED.col : RARITY[p.r].col, 120);
    ctx.hint('获得词条：' + p.n + (p.curse ? '（敌人强化·奖励翻倍）' : ''), 2600);
    S.phase = 'prep'; S.prepT = 9;
    refreshUI();
  }
  function gameOver(win) {
    if (S.over) return;
    S.over = true;
    const value = S.wave * 100 + S.kills * 8 + S.picked * 25;
    if (S.wave > S.best) { S.best = S.wave; save.set('bestWave', S.best); }
    audio.sfx(win ? 'win' : 'lose'); audio.duck(0.7, 1600);
    flash.add(0.4, win ? '#8dff4d' : '#ff4d5e'); shake.add(0.9);
    ctx.vibrate(win ? PATTERNS.win : PATTERNS.lose);
    ctx.finish(value, {
      win, stats: [['波次', S.wave + ' / ' + MAX_WAVE], ['击杀', S.kills], ['词条', S.picked], ['最佳波次', S.best]]
    });
  }
  function stepSim(dt) {
    S.t += dt;
    updateSpawns(dt);
    updateEnemies(dt);
    updateTowers(dt);
    updateBullets(dt);
    for (let i = 0; i < MAXF; i++) { if (!fx[i].alive) continue; fx[i].t += dt; if (fx[i].t >= fx[i].max) fx[i].alive = false; }
    for (let i = 0; i < floaters.length; i++) { const f = floaters[i]; if (!f.alive) continue; f.t += dt; f.y -= 28 * dt; if (f.t > 0.9) f.alive = false; }
  }
  // ---------- DOM ----------
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
  const root = document.createElement('div');
  root.style.cssText = 'pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:6px;background:none;padding:4px 6px 8px';
  const toolBar = document.createElement('div');
  toolBar.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center';
  const towerBtns = [];
  for (const key of ['bolt', 'arc']) {
    const def = TOWERS[key], b = mkBtn(96);
    b.style.borderColor = def.color + '77';
    ctx.listen(b, 'click', () => { S.selType = key; audio.sfx('select'); ctx.hint(def.name + '：' + def.tip, 2400); refreshUI(); });
    attachHover(b, def.color);
    towerBtns.push(b); toolBar.appendChild(b);
  }
  const btnWave = mkBtn(112, 'btn-primary');
  ctx.listen(btnWave, 'click', () => startWave());
  attachHover(btnWave, PALETTE.cyan);
  const btnReroll = mkBtn(96);
  ctx.listen(btnReroll, 'click', () => { if (S.phase === 'perk') { rollOffers(); showCards(); audio.sfx('swap'); } });
  attachHover(btnReroll, PALETTE.violet);
  toolBar.appendChild(btnWave); toolBar.appendChild(btnReroll);
  root.appendChild(toolBar);
  ctx.overlay(root);
  // 词条三选一卡片层
  const cardLayer = document.createElement('div');
  cardLayer.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;background:rgba(3,6,14,.72);pointer-events:auto;padding:14px';
  ctx.overlay(cardLayer);
  const cardEls = [];
  for (let i = 0; i < 5; i++) {
    const el = document.createElement('div');
    el.style.cssText = 'pointer-events:auto;width:min(210px,30vw);min-height:180px;padding:14px;border-radius:14px;cursor:pointer;transition:.18s;background:linear-gradient(180deg,#131c33,#0c1222);border:1px solid #243357;display:flex;flex-direction:column;gap:8px;align-items:center;text-align:center';
    ctx.listen(el, 'click', () => { if (S.offers[i]) takePerk(S.offers[i]); });
    ctx.listen(el, 'pointerenter', () => { el.style.transform = 'translateY(-6px)'; audio.sfx('hover', { gain: .6 }); });
    ctx.listen(el, 'pointerleave', () => { el.style.transform = 'translateY(0)'; });
    cardEls.push(el); cardLayer.appendChild(el);
  }
  function showCards() {
    cardLayer.style.display = 'flex';
    for (let i = 0; i < cardEls.length; i++) {
      const el = cardEls[i], id = S.offers[i];
      if (!id) { el.style.display = 'none'; continue; }
      const p = PERK_BY_ID[id];
      const at = S.perkId.indexOf(id);
      const rc = p.curse ? CURSED : RARITY[p.r];
      el.style.display = 'flex';
      el.style.borderColor = rc.col;
      el.style.boxShadow = '0 0 22px ' + rc.col + '44';
      el.innerHTML =
        '<div style="font-size:11px;letter-spacing:2px;color:' + rc.col + '">' + rc.key + (p.curse ? ' · 反向' : '') + '</div>' +
        '<div style="font-size:30px;color:' + rc.col + ';text-shadow:0 0 14px ' + rc.col + '">' + p.i + '</div>' +
        '<div style="font-size:16px;font-weight:800;color:#eaf2ff">' + p.n + '</div>' +
        '<div style="font-size:12px;color:#9fb0d4;line-height:1.5">' + p.d + '</div>' +
        '<div style="margin-top:auto;font-size:11px;color:#7d8db3">' + (at >= 0 ? '已有 ' + S.perkStack[at] + ' 层' : '新词条') + ' · 上限 ' + p.max + '</div>';
    }
  }
  function hideCards() { cardLayer.style.display = 'none'; }
  function refreshUI() {
    for (let i = 0; i < towerBtns.length; i++) {
      const key = i === 0 ? 'bolt' : 'arc', def = TOWERS[key], b = towerBtns[i];
      const afford = S.gold >= def.cost;
      b.innerHTML = '<span style="font-size:15px;color:' + def.color + '">' + def.icon + '</span>' +
        '<span style="font-size:11px;color:' + (afford ? '#eaf2ff' : '#7d8db3') + '">' + def.name + ' <b style="color:' + (afford ? PALETTE.amber : PALETTE.red) + '">' + def.cost + '</b></span>';
      b.style.borderColor = S.selType === key ? def.color : def.color + '55';
      b.style.background = S.selType === key ? def.color + '22' : 'rgba(14,20,38,.7)';
    }
    if (S.phase === 'wave') {
      btnWave.innerHTML = '<span style="font-size:13px;color:#7d8db3">进行中</span><span style="font-size:10px">第 ' + S.wave + ' 波</span>';
      btnWave.disabled = true; btnWave.style.opacity = '.6';
    } else if (S.phase === 'perk') {
      btnWave.innerHTML = '<span style="font-size:13px;color:#a855f7">选择词条</span>';
      btnWave.disabled = true; btnWave.style.opacity = '.6';
    } else {
      btnWave.disabled = false; btnWave.style.opacity = '1';
      btnWave.innerHTML = '<span style="font-size:13px;color:' + PALETTE.lime + '">开战</span><span style="font-size:10px;color:#7d8db3">' + Math.ceil(S.prepT) + 's</span>';
    }
    btnReroll.innerHTML = '<span style="font-size:12px;color:' + (S.phase === 'perk' ? PALETTE.violet : '#7d8db3') + '">换一批</span><span style="font-size:10px;color:#7d8db3">-' + 0 + '金</span>';
    ctx.hud('gold', '金币', fmtNum(S.gold), { color: PALETTE.amber });
    ctx.hud('life', '生命', S.lives, { color: S.lives <= 5 ? PALETTE.red : PALETTE.green });
    ctx.hud('wave', '波次', S.wave + ' / ' + MAX_WAVE, { color: PALETTE.cyan });
    ctx.hud('perk', '词条', S.picked);
  }
  // ---------- 输入 ----------
  input.on((e) => {
    if (e.type !== 'key' || S.over) return;
    if (e.code === 'KeyZ') { S.selType = S.selType === 'bolt' ? 'arc' : 'bolt'; audio.sfx('select'); refreshUI(); }
    if (e.code === 'Enter' && S.phase === 'prep') startWave();
    if (S.phase === 'perk' && S.offers.length) {
      const k = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
      if (k >= 0 && S.offers[k]) takePerk(S.offers[k]);
    }
  });
  function handlePointer() {
    const p = input.pointer;
    S.hoverSlot = -1;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (Math.hypot(p.x - px(s.gx), p.y - py(s.gy)) < cell * 0.62) { S.hoverSlot = i; break; }
    }
    if (!p.justDown || S.over || S.phase === 'perk') return;
    if (S.hoverSlot >= 0) {
      const s = slots[S.hoverSlot];
      if (s.tower < 0) buildAt(S.hoverSlot);
      else {
        const t = towers[s.tower];
        audio.sfx('select');
        particles.ring(t.x, t.y, TOWERS[t.type].color, cell * 1.2);
        ctx.hint(TOWERS[t.type].name + ' · 击杀 ' + t.kills, 1800);
      }
    }
  }
  function update(dt) {
    handlePointer();
    if (input.consume('jump', 140) && S.phase === 'prep') startWave();
    if (S.over) return;
    if (S.phase === 'perk') { S.t += dt; return; }   // 选词条时冻结战场
    if (S.phase === 'prep') {
      S.prepT -= dt;
      if (Math.ceil(S.prepT) !== Math.ceil(S.prepT + dt)) refreshUI();
      if (S.prepT <= 0) startWave();
    }
    stepSim(dt);
    if ((S.t * 10 | 0) % 3 === 0) refreshUI();
  }
  // ---------- 渲染 ----------
  function render(alpha, rdt) {
    const c = ctx.ctx, W = ctx.W, H = ctx.H, st = S.stat;
    c.fillStyle = PALETTE.bg;
    c.fillRect(0, 0, W, H);
    c.save();
    shake.apply(c);
    // 面板
    c.fillStyle = '#080d1a';
    roundRect(c, ox - 6, oy - 6, cell * COLS + 12, cell * ROWS + 12, 10); c.fill();
    c.strokeStyle = 'rgba(34,224,255,.18)'; c.lineWidth = 1.5; c.stroke();
    c.save();
    c.translate(ox, oy);
    drawGrid(c, cell * COLS, cell * ROWS, cell, 'rgba(70,110,180,.09)', 1, 0, 0);
    c.restore();
    // 路径
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (let pass = 0; pass < 3; pass++) {
      c.beginPath(); c.moveTo(WX[0], WY[0]);
      for (let i = 1; i < WAY.length; i++) c.lineTo(WX[i], WY[i]);
      c.strokeStyle = pass === 0 ? 'rgba(34,224,255,.16)' : pass === 1 ? 'rgba(34,224,255,.85)' : 'rgba(180,240,255,.6)';
      if (pass === 2) { c.setLineDash([8, 14]); c.lineDashOffset = -S.t * 40; }
      c.lineWidth = pass === 0 ? cell * 0.86 : pass === 1 ? 3 : 2;
      c.stroke();
    }
    c.setLineDash([]);
    c.restore();
    // 起点 / 终点
    glowCircle(c, WX[0], WY[0], cell * 0.4, PALETTE.lime, { glow: 14, width: 2, fill: 'rgba(141,255,77,.14)' });
    const ex = WX[WAY.length - 1], ey = WY[WAY.length - 1];
    const pulse = 1 + Math.sin(S.t * 3) * .1;
    glowCircle(c, ex, ey, cell * 0.55 * pulse, PALETTE.magenta, { glow: 18, width: 2.4, fill: 'rgba(255,46,136,.18)' });
    text(c, '核心', ex, ey, { size: 11, color: PALETTE.magenta, glow: 8 });
    // 基座
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i], x = px(s.gx), y = py(s.gy);
      const built = s.tower >= 0;
      const hov = S.hoverSlot === i;
      c.save();
      c.strokeStyle = built ? 'rgba(255,255,255,.1)' : hov ? PALETTE.lime : 'rgba(141,255,77,.45)';
      c.lineWidth = hov ? 2.4 : 1.4;
      c.setLineDash(built ? [] : [5, 5]);
      c.beginPath(); c.arc(x, y, cell * (hov ? 0.5 : 0.42), 0, TAU); c.stroke();
      c.setLineDash([]);
      if (!built) {
        c.fillStyle = 'rgba(141,255,77,.10)'; c.fill();
        text(c, '+', x, y, { size: 16, color: hov ? PALETTE.lime : 'rgba(141,255,77,.55)' });
        if (hov) glowCircle(c, x, y, TOWERS[S.selType].range * st.range * cell, TOWERS[S.selType].color, { glow: 10, width: 1.4, alpha: .5 });
      }
      c.restore();
    }
    // 塔
    for (let i = 0; i < MAXT; i++) if (towers[i].alive) drawTower(c, towers[i]);
    // 特效（闪电 / 爆炸环）
    for (let i = 0; i < MAXF; i++) {
      const f = fx[i];
      if (!f.alive) continue;
      const p = f.t / f.max;
      if (f.kind === 1) {
        neon(c, (cc) => {
          cc.moveTo(f.x1, f.y1);
          const seg = 5;
          for (let k = 1; k <= seg; k++) {
            const t2 = k / seg;
            cc.lineTo(lerp(f.x1, f.x2, t2) + rng.range(-6, 6), lerp(f.y1, f.y2, t2) + rng.range(-6, 6));
          }
        }, f.col, { glow: 14, width: 2.4, alpha: 1 - p, layers: 2, inner: '#fff' });
      } else {
        c.save(); c.globalAlpha = 1 - p;
        c.strokeStyle = f.col; c.lineWidth = 3 * (1 - p);
        c.beginPath(); c.arc(f.x1, f.y1, f.r * (0.4 + p * 0.9), 0, TAU); c.stroke();
        c.restore();
      }
    }
    // 敌人
    for (let i = 0; i < MAXE; i++) if (enemies[i].alive) drawEnemy(c, enemies[i]);
    // 子弹
    for (let i = 0; i < MAXB; i++) {
      const b = bullets[i];
      if (!b.alive) continue;
      glowCircle(c, b.x, b.y, b.r, b.crit ? PALETTE.amber : b.col, { glow: 9, width: 1.2, alpha: .95, fill: (b.crit ? PALETTE.amber : b.col) + '66' });
    }
    // 飘字
    for (let i = 0; i < floaters.length; i++) {
      const f = floaters[i];
      if (!f.alive) continue;
      c.save(); c.globalAlpha = clamp(1 - f.t / 0.9, 0, 1);
      text(c, f.str, f.x, f.y, { size: 13, color: f.col, weight: 800, stroke: '#000', lw: 3 });
      c.restore();
    }
    particles.renderTexts(c, rdt);
    c.restore();
    drawPerkStrip(c, W, H);
    // 敌人强化提示
    let mn = 0;
    if (S.emod.hp > 1.001) modsBuf[mn++] = '生命 x' + S.emod.hp.toFixed(2);
    if (S.emod.spd > 1.001) modsBuf[mn++] = '速度 x' + S.emod.spd.toFixed(2);
    if (S.emod.shield > 0) modsBuf[mn++] = '减伤 ' + Math.round(S.emod.shield * 100) + '%';
    if (S.emod.split > 0) modsBuf[mn++] = '分裂 x' + S.emod.split;
    if (mn) { let ms = ''; for (let i = 0; i < mn; i++) ms += (i ? ' · ' : '') + modsBuf[i]; text(c, '敌人强化：' + ms, W / 2, H - (ctx.H > 620 ? 122 : 102), { size: 11, color: PALETTE.red, baseline: 'bottom' }); }
    if (S.phase === 'wave') bar(c, W / 2 - 90, 22, 180, 5, sqN ? sqI / sqN : 0, { fill: PALETTE.magenta, bg: 'rgba(255,255,255,.09)' });
    if (S.over) {
      c.fillStyle = 'rgba(4,7,16,.6)'; c.fillRect(0, 0, W, H);
      text(c, S.lives > 0 ? '构筑完成！' : '防线崩溃', W / 2, H / 2, { size: Math.min(44, W * .09), color: S.lives > 0 ? PALETTE.lime : PALETTE.red, weight: 900, glow: 20 });
    }
    vignette(c, W, H, .38);
  }
  function drawTower(c, t) {
    const def = TOWERS[t.type], s = cell * 0.34;
    c.save();
    c.translate(t.x, t.y);
    c.fillStyle = 'rgba(10,16,30,.95)';
    c.beginPath(); c.arc(0, 0, cell * 0.44, 0, TAU); c.fill();
    c.strokeStyle = def.color + '88'; c.lineWidth = 1.4; c.stroke();
    const g = clamp((S.t - t.born) * 5, 0.4, 1);
    c.scale(g, g);
    c.save();
    c.rotate(t.ang + Math.PI / 2);
    c.fillStyle = def.color;
    if (t.type === 'bolt') {
      c.fillRect(-s * 0.22, -s * 1.15, s * 0.44, s * 1.5);
      c.beginPath(); c.moveTo(0, -s * 1.5); c.lineTo(s * 0.42, -s * 0.65); c.lineTo(-s * 0.42, -s * 0.65); c.closePath(); c.fill();
    } else {
      c.beginPath(); c.arc(0, 0, s * 0.8, 0, TAU); c.fill();
      c.fillStyle = '#0a1020'; c.beginPath(); c.arc(0, 0, s * 0.34, 0, TAU); c.fill();
      c.fillStyle = def.color; c.fillRect(-s * 0.2, -s * 1.5, s * 0.4, s * 0.9);
    }
    if (t.flash > 0) { c.fillStyle = '#fff'; c.beginPath(); c.arc(0, -s * 1.6, s * 0.55 * (t.flash / 0.12), 0, TAU); c.fill(); }
    c.restore();
    c.restore();
  }
  function drawEnemy(c, e) {
    const r = e.r;
    c.save();
    c.translate(e.x, e.y);
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.beginPath(); c.ellipse(0, r * 0.8, r * 0.85, r * 0.3, 0, 0, TAU); c.fill();
    const col = e.hitFx > 0 ? '#fff' : e.col;
    if (e.boss || e.elite) {
      const sp = e.boss ? 8 : 6, ro = e.boss ? 1.7 : 1.55;
      c.save(); c.rotate((e.boss ? .5 : -1.2) * S.t); c.strokeStyle = e.boss ? col + '88' : PALETTE.amber; c.lineWidth = e.boss ? 2.4 : 2;
      for (let i = 0; i < sp; i++) {
        const a = i * TAU / sp;
        c.beginPath(); c.moveTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1); c.lineTo(Math.cos(a) * r * ro, Math.sin(a) * r * ro); c.stroke();
      }
      c.restore();
    }
    c.fillStyle = col;
    c.beginPath();
    if (e.type === 'brute') roundRect(c, -r, -r * .85, r * 2, r * 1.7, 4);
    else if (e.type === 'runner') { c.moveTo(r * 1.1, 0); c.lineTo(-r * .8, -r * .75); c.lineTo(-r * .3, 0); c.lineTo(-r * .8, r * .75); c.closePath(); }
    else c.arc(0, 0, r, 0, TAU);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1; c.stroke();
    if (e.poiT > 0) { c.globalAlpha = .55; c.fillStyle = PALETTE.lime; c.beginPath(); c.arc(0, 0, r * 0.55, 0, TAU); c.fill(); c.globalAlpha = 1; }
    if (e.slowT > 0) { c.strokeStyle = PALETTE.cyan; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, r * 1.3, 0, TAU); c.stroke(); }
    c.restore();
    const bw = Math.max(cell * .55, r * 2.2);
    bar(c, e.x - bw / 2, e.y - r - 9, bw, e.boss ? 6 : 3.5, e.hp / e.maxHp, {
      bg: 'rgba(0,0,0,.55)', fill: e.boss ? PALETTE.magenta : e.elite ? PALETTE.amber : e.hp / e.maxHp > .5 ? PALETTE.green : PALETTE.red
    });
  }
  // 已获词条图标条（右上角，悬停显示 tooltip）
  function drawPerkStrip(c, W, H) {
    if (!S.perkId.length) { piN = 0; return; }
    const sz = 26, gap = 4, perRow = Math.max(4, Math.min(12, Math.floor((W - 220) / (sz + gap))));
    let i = 0;
    for (let k = 0; k < S.perkId.length; k++) {
      const p = PERK_BY_ID[S.perkId[k]];
      const rc = p.curse ? CURSED : RARITY[p.r];
      const col = k % perRow, row = Math.floor(k / perRow);
      const x = W - 10 - (col + 1) * (sz + gap), y = 10 + row * (sz + gap);
      piX[k] = x; piY[k] = y;
      c.save();
      c.fillStyle = 'rgba(8,12,24,.85)';
      roundRect(c, x, y, sz, sz, 6); c.fill();
      c.strokeStyle = rc.col; c.lineWidth = 1.4; c.stroke();
      text(c, p.i, x + sz / 2, y + sz / 2 - 1, { size: 14, color: rc.col });
      if (S.perkStack[k] > 1) text(c, 'x' + S.perkStack[k], x + sz - 6, y + sz - 6, { size: 9, color: '#eaf2ff' });
      c.restore();
      i = k;
    }
    piN = S.perkId.length;
    const p = input.pointer;
    for (let k = 0; k < piN; k++) {
      if (p.x >= piX[k] && p.x <= piX[k] + sz && p.y >= piY[k] && p.y <= piY[k] + sz) {
        const pk = PERK_BY_ID[S.perkId[k]], rc = pk.curse ? CURSED : RARITY[pk.r];
        const tw = 220, th = 62, tx = clamp(piX[k] - tw + sz, 8, W - tw - 8), ty = piY[k] + sz + 6;
        panel(c, tx, ty, tw, th, { fill: 'rgba(6,10,20,.95)', stroke: rc.col, r: 8 });
        text(c, pk.n + '  x' + S.perkStack[k], tx + 10, ty + 15, { size: 13, color: rc.col, align: 'left', weight: 800 });
        wrapText(c, pk.d, tx + 10, ty + 28, tw - 20, 14, { size: 11, color: '#9fb0d4' });
        break;
      }
    }
  }
  recalc();
  refreshUI();
  return {
    update, render,
    resize(w, h) { layout(w, h); rebuildWay(); refreshUI(); },
    pause() { audio.duck(0.5, 2000); },
    resume() { }
  };
}