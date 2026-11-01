// 卡牌构筑 Roguelike（爬塔）—— 卡池 / 遗物 / 敌人意图 / 分支地图 / DOM 扇形手牌
import { clamp, clamp01, TAU } from '../core/math.js';
import { PALETTE, glowCircle, roundRect, fillRound, strokeRound, text, bar, panel, vignette, grid as drawGrid, glowLine, glowDot, star as starPath } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'deckbuilder', title: '卡牌构筑', category: 'strategy', difficulty: 4,
  music: 'menu',
  howto: ['点卡牌选中 → 点敌人（或拖到场上）打出', '能量耗尽点「结束回合」，格挡回合开始清零',
    '地图选节点前进：战斗/精英/商店/休息/宝箱/Boss'],
  particles: 1100
};
export const musicTrack = 'menu';

// ============================ 卡池（47 张） ============================
// v=[基础, 升级]  w=[第二数值, 升级]  tgt=需要目标  ex=消耗
const CARDS = [
  // ---- 攻击 ----
  { id: 'strike', name: '打击', cost: 1, type: 'attack', rarity: 'common', tgt: 1, v: [6, 9], d: a => `造成 ${a} 点伤害` },   { id: 'jab', name: '快刺', cost: 0, type: 'attack', rarity: 'common', tgt: 1, v: [4, 6], d: a => `造成 ${a} 点伤害` },
  { id: 'heavy', name: '重击', cost: 2, type: 'attack', rarity: 'common', tgt: 1, v: [14, 19], d: a => `造成 ${a} 点伤害` },   { id: 'triple', name: '三连击', cost: 1, type: 'attack', rarity: 'common', tgt: 1, v: [4, 5], w: [3, 3], d: (a, b) => `造成 ${a} 点伤害 ${b} 次` },
  { id: 'flurry', name: '疾风连击', cost: 2, type: 'attack', rarity: 'uncommon', tgt: 1, v: [3, 4], w: [5, 6], d: (a, b) => `造成 ${a} 点伤害 ${b} 次` },   { id: 'pierce', name: '穿透之刃', cost: 1, type: 'attack', rarity: 'uncommon', tgt: 1, v: [8, 11], d: a => `无视格挡造成 ${a} 点伤害` },
  { id: 'poisonblade', name: '毒刃', cost: 1, type: 'attack', rarity: 'uncommon', tgt: 1, v: [5, 7], w: [3, 4], d: (a, b) => `造成 ${a} 点伤害，中毒 ${b}` },   { id: 'expose', name: '破防斩', cost: 1, type: 'attack', rarity: 'uncommon', tgt: 1, v: [7, 9], w: [2, 3], d: (a, b) => `造成 ${a} 点伤害，易伤 ${b}` },
  { id: 'enfeeble', name: '削弱之击', cost: 1, type: 'attack', rarity: 'common', tgt: 1, v: [6, 8], w: [2, 3], d: (a, b) => `造成 ${a} 点伤害，虚弱 ${b}` },   { id: 'whirl', name: '旋风斩', cost: 2, type: 'attack', rarity: 'uncommon', tgt: 0, v: [8, 11], d: a => `对所有敌人造成 ${a} 点伤害` },
  { id: 'bloodrite', name: '血祭', cost: 0, type: 'attack', rarity: 'uncommon', tgt: 1, v: [10, 14], w: [3, 3], d: (a, b) => `失去 ${b} 生命，造成 ${a} 点伤害` },   { id: 'siphon', name: '汲取', cost: 2, type: 'attack', rarity: 'uncommon', tgt: 1, v: [8, 11], d: a => `造成 ${a} 点伤害并回复等量生命` },
  { id: 'decap', name: '斩首', cost: 3, type: 'attack', rarity: 'rare', tgt: 1, v: [24, 32], d: a => `造成 ${a} 点伤害` },   { id: 'shieldbash', name: '盾击', cost: 1, type: 'attack', rarity: 'common', tgt: 1, v: [5, 7], w: [5, 7], d: (a, b) => `获得 ${b} 格挡，造成 ${a} 点伤害` },
  { id: 'riposte', name: '反击风暴', cost: 1, type: 'attack', rarity: 'uncommon', tgt: 0, v: [6, 9], d: a => `对所有敌人造成 ${a} 点伤害` },   { id: 'bulwark', name: '壁垒猛击', cost: 2, type: 'attack', rarity: 'rare', tgt: 1, v: [1, 1], d: () => `造成等同于当前格挡的伤害（无视格挡）` },
  { id: 'chain', name: '电弧', cost: 2, type: 'attack', rarity: 'rare', tgt: 0, v: [7, 10], d: a => `对所有敌人造成 ${a} 点伤害` },   { id: 'volley', name: '箭雨', cost: 1, type: 'attack', rarity: 'common', tgt: 0, v: [5, 7], d: a => `对所有敌人造成 ${a} 点伤害` },
  // ---- 技能 ----
  { id: 'defend', name: '防御', cost: 1, type: 'skill', rarity: 'common', tgt: 0, v: [5, 8], d: a => `获得 ${a} 点格挡` },   { id: 'ironwall', name: '铁壁', cost: 2, type: 'skill', rarity: 'common', tgt: 0, v: [12, 16], d: a => `获得 ${a} 点格挡` },
  { id: 'dodge', name: '闪避', cost: 1, type: 'skill', rarity: 'common', tgt: 0, v: [4, 6], w: [1, 1], d: (a, b) => `获得 ${a} 点格挡，抽 ${b} 张牌` },   { id: 'insight', name: '洞察', cost: 1, type: 'skill', rarity: 'common', tgt: 0, v: [2, 3], d: a => `抽 ${a} 张牌` },
  { id: 'surge', name: '能量涌动', cost: 0, type: 'skill', rarity: 'uncommon', tgt: 0, ex: 1, v: [2, 2], d: a => `获得 ${a} 点能量（消耗）` },   { id: 'healpot', name: '治疗药剂', cost: 1, type: 'skill', rarity: 'common', tgt: 0, ex: 1, v: [8, 12], d: a => `回复 ${a} 点生命（消耗）` },
  { id: 'poisonmist', name: '毒雾', cost: 1, type: 'skill', rarity: 'uncommon', tgt: 0, v: [5, 7], d: a => `全体敌人中毒 ${a}` },   { id: 'intimidate', name: '恐吓', cost: 0, type: 'skill', rarity: 'uncommon', tgt: 0, v: [2, 3], d: a => `全体敌人虚弱 ${a}` },
  { id: 'frailty', name: '破绽', cost: 1, type: 'skill', rarity: 'uncommon', tgt: 0, v: [2, 3], d: a => `全体敌人易伤 ${a}` },   { id: 'cleanse', name: '净化', cost: 1, type: 'skill', rarity: 'uncommon', tgt: 0, v: [6, 9], d: a => `移除自身负面，获得 ${a} 点格挡` },
  { id: 'prepare', name: '预备', cost: 1, type: 'skill', rarity: 'uncommon', tgt: 0, v: [3, 4], d: a => `抽 ${a} 张牌，随机弃 1 张` },   { id: 'secondwind', name: '回气', cost: 1, type: 'skill', rarity: 'uncommon', tgt: 0, ex: 1, v: [5, 7], d: a => `弃掉手牌，每张获得 ${a} 点格挡` },
  { id: 'flex', name: '曲肌', cost: 0, type: 'skill', rarity: 'common', tgt: 0, v: [2, 3], d: a => `本场力量 +${a}` },   { id: 'shadowstep', name: '暗影步', cost: 1, type: 'skill', rarity: 'uncommon', tgt: 0, v: [8, 11], d: a => `获得 ${a} 点格挡，全体虚弱 1` },
  { id: 'bandage', name: '绷带', cost: 0, type: 'skill', rarity: 'common', tgt: 0, v: [4, 6], d: a => `回复 ${a} 点生命` },   { id: 'entrench', name: '巩固', cost: 1, type: 'skill', rarity: 'rare', tgt: 0, v: [2, 2], d: () => `当前格挡翻倍` },
  { id: 'adrenaline', name: '肾上腺素', cost: 1, type: 'skill', rarity: 'rare', tgt: 0, ex: 1, v: [2, 2], d: a => `获得 ${a} 点能量，抽 1 张（消耗）` },   { id: 'smokebomb', name: '烟雾弹', cost: 1, type: 'skill', rarity: 'uncommon', tgt: 0, v: [2, 2], d: () => `全体敌人虚弱 2、易伤 2` },
  // ---- 能力 ----
  { id: 'inflame', name: '烈焰之力', cost: 1, type: 'power', rarity: 'uncommon', tgt: 0, v: [2, 3], d: a => `力量 +${a}` },   { id: 'metallicize', name: '金属化', cost: 1, type: 'power', rarity: 'uncommon', tgt: 0, v: [3, 4], d: a => `回合结束获得 ${a} 点格挡` },
  { id: 'thorns', name: '荆棘', cost: 1, type: 'power', rarity: 'uncommon', tgt: 0, v: [3, 5], d: a => `受到攻击时反弹 ${a} 点伤害` },   { id: 'demonform', name: '恶魔形态', cost: 3, type: 'power', rarity: 'rare', tgt: 0, v: [2, 3], d: a => `每回合力量 +${a}` },
  { id: 'toxicblood', name: '剧毒血脉', cost: 2, type: 'power', rarity: 'rare', tgt: 0, v: [2, 3], d: a => `每回合开始全体中毒 ${a}` },   { id: 'regen', name: '再生', cost: 1, type: 'power', rarity: 'uncommon', tgt: 0, v: [3, 5], d: a => `每回合回复 ${a} 点生命` },
  { id: 'scholar', name: '学者', cost: 1, type: 'power', rarity: 'rare', tgt: 0, v: [1, 1], d: () => `每回合额外抽 1 张牌` },   { id: 'overload', name: '超载', cost: 2, type: 'power', rarity: 'rare', tgt: 0, v: [1, 1], d: () => `每回合额外获得 1 点能量` },
  { id: 'dexterity', name: '灵巧', cost: 1, type: 'power', rarity: 'uncommon', tgt: 0, v: [2, 3], d: a => `敏捷 +${a}（牌的格挡加成）` },   { id: 'fury', name: '狂怒', cost: 2, type: 'power', rarity: 'rare', tgt: 0, v: [1, 2], d: a => `每回合开始力量 +${a}` }
];
const CARD_BY_ID = {};
for (const c of CARDS) CARD_BY_ID[c.id] = c;

const RARITY_COLOR = { common: '#9fb0d6', uncommon: '#22e0ff', rare: '#ffb020' };
const TYPE_COLOR = { attack: '#ff4d5e', skill: '#22e0ff', power: '#a855f7' };
const TYPE_NAME = { attack: '攻击', skill: '技能', power: '能力' };

// ============================ 遗物（14 种） ============================
const RELICS = [
  { id: 'core', g: '能', name: '能量核心', desc: '每回合额外 +1 能量' },   { id: 'scope', g: '抽', name: '星象仪', desc: '每场战斗开始多抽 1 张牌' },
  { id: 'vial', g: '血', name: '血瓶', desc: '每击杀一个敌人回复 4 生命' },   { id: 'shell', g: '龟', name: '龟壳', desc: '回合开始保留一半格挡' },
  { id: 'band', g: '力', name: '力量护腕', desc: '战斗开始获得 2 力量' },   { id: 'pvial', g: '毒', name: '毒液瓶', desc: '战斗开始全体敌人中毒 3' },
  { id: 'bag', g: '金', name: '金币袋', desc: '战斗胜利额外 +15 金币' },   { id: 'stone', g: '刃', name: '磨刀石', desc: '攻击牌伤害 +2' },
  { id: 'kit', g: '医', name: '医疗包', desc: '每场战斗结束回复 6 生命' },   { id: 'glass', g: '沙', name: '沙漏', desc: '回合结束若格挡 > 0 回复 3 生命' },
  { id: 'scroll', g: '卷', name: '智慧卷轴', desc: '商店所有价格 -25%' },   { id: 'crown', g: '荆', name: '荆棘之冠', desc: '战斗开始获得 4 荆棘' },
  { id: 'luck', g: '幸', name: '幸运硬币', desc: '每回合 30% 概率 +1 能量' },   { id: 'lantern', g: '灯', name: '微光提灯', desc: '战斗开始获得 2 敏捷' }
];

// ============================ 敌人 ============================
const MOBS = [
  { name: '酸液史莱姆', hp: [22, 26], kind: 'blob', moves: [{ k: 'attack', v: 8 }, { k: 'debuff', st: 'weak', v: 2 }, { k: 'defend', v: 6 }] },   { name: '霓虹蝠群', hp: [16, 20], kind: 'tri', moves: [{ k: 'attack', v: 4, t: 2 }, { k: 'attack', v: 7 }] },
  { name: '机械守卫', hp: [32, 38], kind: 'square', moves: [{ k: 'attack', v: 11 }, { k: 'defend', v: 8 }, { k: 'attack', v: 6, t: 2 }] },   { name: '邪教徒', hp: [26, 30], kind: 'star', moves: [{ k: 'buff', v: 3 }, { k: 'attack', v: 8 }] },
  { name: '毒蛛', hp: [22, 26], kind: 'hex', moves: [{ k: 'attack', v: 5, psn: 3 }, { k: 'debuff', st: 'weak', v: 2 }] },   { name: '骷髅兵', hp: [28, 34], kind: 'bone', moves: [{ k: 'attack', v: 9 }, { k: 'defend', v: 6 }, { k: 'attack', v: 5, t: 2 }] },
  { name: '巡游无人机', hp: [20, 24], kind: 'tri', moves: [{ k: 'attack', v: 6 }, { k: 'attack', v: 3, t: 3 }] }
];
const ELITES = [
  { name: '石像鬼·精英', hp: [58, 66], kind: 'square', moves: [{ k: 'attack', v: 14 }, { k: 'defend', v: 12 }, { k: 'debuff', st: 'vulnerable', v: 2 }] },   { name: '双头猎犬·精英', hp: [62, 70], kind: 'blob', moves: [{ k: 'attack', v: 9, t: 2 }, { k: 'buff', v: 3 }, { k: 'attack', v: 16 }] }
];
const BOSS = { name: '虚空之主', hp: [148, 148], kind: 'boss', moves: [{ k: 'attack', v: 18 }, { k: 'attack', v: 8, t: 3 }, { k: 'buff', v: 4 }, { k: 'defend', v: 15 }, { k: 'debuff', st: 'weak', v: 2 }] };

const INTENT_ICON = { attack: '攻', defend: '御', buff: '强', debuff: '弱' };

export function create(ctx) {
  const { input, audio, particles, shake, flash, save, rng } = ctx;
  let W = ctx.W, H = ctx.H;
  // ---------------- 状态 ----------------
  const S = {
    screen: 'map', t: 0, floor: 0, gold: 100, kills: 0,
    deck: [], relics: [], battle: null, map: null, drawPile: [], hand: [], discard: [], exhaust: [],
    pos: { f: 0, i: 0 }, cleared: false, done: false, msg: '', msgT: 0
  };
  const P = {
    hp: 75, maxhp: 75, block: 0, energy: 3, maxEnergy: 3,
    st: { strength: 0, weak: 0, vulnerable: 0, poison: 0, dex: 0 },
    pw: { metallicize: 0, thorns: 0, regen: 0, demon: 0, toxic: 0, draw: 0, energy: 0, fury: 0 },
    x: 0, y: 0, r: 34, hurt: 0, flashAt: -9
  };
  const hasRelic = id => S.relics.indexOf(id) >= 0;
  // ---------------- 牌堆操作 ----------------
  function shuffleDeck() { S.drawPile = rng.shuffle(S.deck.slice()); S.discard = []; S.exhaust = []; S.hand = []; }
  function drawCards(n) {
    for (let i = 0; i < n; i++) {
      if (!S.drawPile.length) {
        if (!S.discard.length) break;
        S.drawPile = rng.shuffle(S.discard); S.discard = []; audio.sfx('swap');
      }
      if (S.hand.length >= 10) { S.discard.push(S.drawPile.pop()); continue; }
      S.hand.push(S.drawPile.pop());
    }
  }
  const cardName = inst => CARD_BY_ID[inst.id].name + (inst.lvl ? '+' : '');
  // ---------------- 战斗核心 ----------------
  const alive = i => { const B = S.battle; return B && i != null && B.enemies[i] && B.enemies[i].hp > 0; };
  function firstAlive() { const B = S.battle; for (let i = 0; i < B.enemies.length; i++) if (B.enemies[i].hp > 0) return i; return -1; }
  function pAtk(base) { let d = base + P.st.strength; if (P.st.weak > 0) d *= 0.75; return Math.max(0, Math.floor(d)); }
  function hit(ti, base, pierce) {
    if (!alive(ti)) return 0;
    const e = S.battle.enemies[ti];
    let d = pAtk(base);
    if (e.st.vulnerable > 0) d *= 1.5;
    d = Math.max(0, Math.floor(d));
    if (!pierce) { const b = Math.min(e.block, d); e.block -= b; d -= b; }
    e.hp -= d; e.hurt = 0.45;
    audio.sfx('hit'); shake.add(0.16 + Math.min(0.3, d * 0.008)); ctx.vibrate(PATTERNS.hit);
    particles.burst(e.x, e.y, 12, { color: PALETTE.amber, speed: 200, life: .5, size: 3, kind: 1 });
    particles.text(e.x, e.y - e.r - 6, '-' + d, '#ffb020');
    if (e.hp <= 0) killEnemy(ti);
    return d;
  }
  function hitAll(base, pierce) { let s = 0; for (let i = 0; i < S.battle.enemies.length; i++) if (alive(i)) s += hit(i, base, pierce); return s; }
  function killEnemy(i) {
    const e = S.battle.enemies[i];
    e.hp = 0; S.kills++;
    particles.explosion(e.x, e.y, 1.1, PALETTE.magenta); audio.sfx('explode');
    if (hasRelic('vial')) healPlayer(4, true);
  }
  function gainBlock(n, fromCard) {
    const v = n + (fromCard ? P.st.dex : 0);
    P.block += v;
    particles.burst(P.x, P.y, 10, { color: PALETTE.cyan, speed: 130, life: .5, kind: 0 });
    particles.text(P.x, P.y - P.r - 10, '+' + v + ' 格挡', '#22e0ff');
    audio.sfx('reflect');
  }
  function healPlayer(n, silent) {
    const b = P.hp; P.hp = Math.min(P.maxhp, P.hp + n);
    if (P.hp > b) {
      particles.burst(P.x, P.y, 12, { color: PALETTE.green, speed: 90, life: .8, kind: 3 });
      particles.text(P.x, P.y - P.r - 10, '+' + (P.hp - b), '#28e0a0');
      if (!silent) audio.sfx('heal');
    }
  }
  function loseHp(n) {
    P.hp -= n; P.hurt = 0.5;
    particles.text(P.x, P.y - P.r - 10, '-' + n, '#ff4d5e');
    if (P.hp <= 0) { P.hp = 0; endBattle(false); }
  }
  function addStatus(e, key, n) {
    if (!e) return;
    e.st[key] = (e.st[key] || 0) + n;
    particles.burst(e.x, e.y - e.r * .5, 8, { color: key === 'poison' ? PALETTE.green : key === 'weak' ? PALETTE.violet : PALETTE.magenta, speed: 110, life: .6, kind: 2 });
  }
  function startBattle(kind) {
    const B = S.battle = { kind, turn: 0, phase: 'player', enemies: [], timer: 0, ei: 0, over: 0 };
    const list = kind === 'boss' ? [BOSS] : kind === 'elite' ? [rng.pick(ELITES)] : [];
    if (!list.length) { const n = rng.int(1, S.floor >= 4 ? 3 : 2); for (let i = 0; i < n; i++) list.push(rng.pick(MOBS)); }
    const scale = 1 + S.floor * 0.11;
    for (const m of list) {
      const hp = Math.round(rng.int(m.hp[0], m.hp[1]) * scale);
      B.enemies.push({
        name: m.name, kind: m.kind, hp, maxhp: hp, block: 0, moves: m.moves, move: null, intent: null,
        st: { strength: 0, weak: 0, vulnerable: 0, poison: 0 },
        x: 0, y: 0, r: 32, hurt: 0, boss: m === BOSS, bob: rng.range(0, TAU)
      });
    }
    P.block = 0;
    P.st.strength = 0; P.st.weak = 0; P.st.vulnerable = 0; P.st.poison = 0; P.st.dex = 0;
    P.pw.metallicize = 0; P.pw.thorns = 0; P.pw.regen = 0; P.pw.demon = 0; P.pw.toxic = 0; P.pw.draw = 0; P.pw.energy = 0; P.pw.fury = 0;
    if (hasRelic('band')) P.st.strength += 2;
    if (hasRelic('lantern')) P.st.dex += 2;
    if (hasRelic('crown')) P.pw.thorns += 4;
    if (hasRelic('pvial')) for (const e of B.enemies) addStatus(e, 'poison', 3);
    shuffleDeck(); layoutBattle();
    for (const e of B.enemies) planEnemy(e);
    startPlayerTurn(true);
    S.screen = 'battle';
    audio.sfx('portal'); flash.add(0.25, '#a855f7');
    say(`第 ${S.floor + 1} 层 · ${kind === 'boss' ? 'BOSS 战' : kind === 'elite' ? '精英战' : '战斗'}`, 2.2);
  }
  function startPlayerTurn(first) {
    const B = S.battle;
    B.turn++; B.phase = 'player'; B.ei = 0; B.timer = 0;
    P.block = hasRelic('shell') ? Math.floor(P.block * 0.5) : 0;
    if (P.pw.fury) { P.st.strength += P.pw.fury; particles.text(P.x, P.y - 20, '力量+' + P.pw.fury, '#ffb020'); }
    if (P.pw.demon) { P.st.strength += P.pw.demon; particles.text(P.x, P.y - 6, '力量+' + P.pw.demon, '#ffb020'); }
    if (P.pw.toxic) for (const e of B.enemies) if (e.hp > 0) addStatus(e, 'poison', P.pw.toxic);
    if (P.st.poison > 0) { // 中毒结算
      P.hp -= P.st.poison; P.hurt = 0.4;
      particles.burst(P.x, P.y, 8, { color: PALETTE.green, speed: 90, life: .6, kind: 2 });
      particles.text(P.x, P.y - P.r - 14, '中毒 -' + P.st.poison, '#28e0a0');
      P.st.poison--;
      if (P.hp <= 0) { P.hp = 0; endBattle(false); return; }
    }
    P.maxEnergy = 3 + (hasRelic('core') ? 1 : 0) + P.pw.energy;
    P.energy = P.maxEnergy;
    if (hasRelic('luck') && rng.chance(0.3)) { P.energy++; particles.text(P.x, P.y - 34, '幸运 +1 能量', '#ffb020'); }
    drawCards(5 + (hasRelic('scope') ? 1 : 0) + P.pw.draw);
    audio.sfx(first ? 'charge' : 'swap');
    sel = -1; syncHand(); updateHud();
  }
  function planEnemy(e) {
    const m = rng.pick(e.moves);
    e.move = m;
    const sc = 1 + S.floor * 0.09 + e.st.strength * 0.35;
    e.intent = { k: m.k, v: Math.max(1, Math.round((m.v || 0) * sc)), t: m.t || 1, st: m.st || null, psn: m.psn || 0 };
  }
  function endTurn() {
    const B = S.battle; if (!B || B.phase !== 'player') return;
    while (S.hand.length) S.discard.push(S.hand.pop());
    sel = -1; syncHand();
    if (P.pw.metallicize) gainBlock(P.pw.metallicize, false);
    if (P.pw.regen) healPlayer(P.pw.regen, true);
    if (hasRelic('glass') && P.block > 0) healPlayer(3, true);
    B.phase = 'enemy'; B.ei = 0; B.timer = 0.35;
    if (P.st.weak > 0) P.st.weak--;
    if (P.st.vulnerable > 0) P.st.vulnerable--;
    audio.sfx('back');
  }
  function enemyStep() {
    const B = S.battle, e = B.enemies[B.ei];
    if (!e) { nextRound(); return; }
    e.block = 0;
    if (e.hp <= 0) { B.ei++; B.timer = 0.12; return; }
    if (e.st.poison > 0) { // 中毒结算
      e.hp -= e.st.poison; e.hurt = 0.35;
      particles.burst(e.x, e.y, 8, { color: PALETTE.green, speed: 90, life: .6, kind: 2 });
      particles.text(e.x, e.y - e.r - 14, '-' + e.st.poison, '#28e0a0');
      e.st.poison--;
      if (e.hp <= 0) { killEnemy(B.ei); B.ei++; B.timer = 0.3; return; }
    }
    const it = e.intent;
    if (it.k === 'attack') {
      for (let i = 0; i < it.t; i++) {
        let d = it.v + e.st.strength;
        if (e.st.weak > 0) d *= 0.75;
        if (P.st.vulnerable > 0) d *= 1.5;
        d = Math.max(0, Math.floor(d));
        const b = Math.min(P.block, d); P.block -= b; d -= b;
        P.hp -= d; P.hurt = 0.5;
        audio.sfx('hurt'); shake.add(0.3 + Math.min(0.4, d * 0.01)); ctx.vibrate(PATTERNS.damage);
        particles.burst(P.x, P.y, 14, { color: PALETTE.red, speed: 220, life: .5, kind: 1 });
        particles.text(P.x, P.y - P.r - 14, '-' + d, '#ff4d5e');
        if (it.psn) addStatus(P, 'poison', it.psn);
        if (P.hp <= 0) { P.hp = 0; endBattle(false); return; }
        if (P.pw.thorns > 0 && e.hp > 0) hit(B.ei, P.pw.thorns, false);
      }
    } else if (it.k === 'defend') {
      e.block += it.v;
      particles.burst(e.x, e.y, 10, { color: PALETTE.cyan, speed: 120, life: .5, kind: 0 });
      particles.text(e.x, e.y - e.r - 6, '+' + it.v + ' 格挡', '#22e0ff');
      audio.sfx('reflect');
    } else if (it.k === 'buff') {
      e.st.strength += it.v;
      particles.text(e.x, e.y - e.r - 6, '力量 +' + it.v, '#ffb020');
      audio.sfx('powerup');
    } else if (it.k === 'debuff') {
      P.st[it.st] = (P.st[it.st] || 0) + it.v;
      particles.text(P.x, P.y - P.r - 14, (it.st === 'weak' ? '虚弱' : '易伤') + ' +' + it.v, '#a855f7');
      audio.sfx('error');
    }
    B.ei++; B.timer = 0.42;
    if (B.ei >= B.enemies.length) B.timer = 0.55;
  }
  function nextRound() { for (const e of S.battle.enemies) if (e.hp > 0) planEnemy(e); startPlayerTurn(false); }
  function checkWin() {
    const B = S.battle;
    if (B.phase === 'over' || B.phase === 'done') return;
    for (const e of B.enemies) if (e.hp > 0) return;
    B.phase = 'over'; B.over = 1.1;
  }
  function endBattle(win) {
    const B = S.battle;
    if (!B || B.phase === 'done') return;
    B.phase = 'done';
    if (!win) {
      audio.sfx('die'); audio.duck(0.6, 900); shake.add(0.9); ctx.vibrate(PATTERNS.lose);
      setTimeout(() => ctx.finish(score(), { win: false, stats: [['到达层数', S.floor + 1], ['击杀', S.kills], ['金币', S.gold], ['遗物', S.relics.length]] }), 700);
      return;
    }
    audio.sfx('win'); ctx.vibrate(PATTERNS.win); flash.add(0.3, '#8dff4d');
    let g = 12 + rng.int(6, 16) + (B.kind === 'elite' ? 22 : 0) + (B.kind === 'boss' ? 60 : 0);
    if (hasRelic('bag')) g += 15;
    S.gold += g;
    if (hasRelic('kit')) healPlayer(6, true);
    particles.burst(P.x, P.y, 24, { color: PALETTE.amber, speed: 200, life: .9, kind: 4 });
    S.cleared = true;
    if (B.kind === 'boss') {
      setTimeout(() => ctx.finish(score(), { win: true, stats: [['击杀', S.kills], ['金币', S.gold], ['遗物', S.relics.length], ['牌组', S.deck.length]] }), 900);
      return;
    }
    S.screen = 'reward'; showReward(g);
  }
  function score() { return S.floor * 250 + S.kills * 12 + S.gold + S.relics.length * 60 + S.deck.length * 6; }
  // ---------------- 出牌 ----------------
  function playCard(i, ti) {
    const B = S.battle; if (!B || B.phase !== 'player') return false;
    const inst = S.hand[i]; if (!inst) return false;
    const def = CARD_BY_ID[inst.id];
    if (B.energy < def.cost) { audio.sfx('error'); ctx.hint('能量不足'); shake.add(0.1); return false; }
    const a = def.v ? def.v[inst.lvl] : 0, b = def.w ? def.w[inst.lvl] : 0;
    if (def.tgt) { if (!alive(ti)) ti = firstAlive(); if (ti < 0) return false; }
    B.energy -= def.cost;
    S.hand.splice(i, 1);
    sel = -1;
    const bonus = (hasRelic('stone') && def.type === 'attack') ? 2 : 0;
    switch (def.id) {
      case 'strike': case 'jab': case 'heavy': hit(ti, a + bonus); break;
      case 'triple': case 'flurry': for (let k = 0; k < b; k++) if (alive(ti)) hit(ti, a + bonus); break;
      case 'pierce': hit(ti, a + bonus, true); break;
      case 'poisonblade': hit(ti, a + bonus); addStatus(B.enemies[ti], 'poison', b); break;
      case 'expose': hit(ti, a + bonus); addStatus(B.enemies[ti], 'vulnerable', b); break;
      case 'enfeeble': hit(ti, a + bonus); addStatus(B.enemies[ti], 'weak', b); break;
      case 'whirl': case 'riposte': case 'chain': case 'volley': hitAll(a + bonus); break;
      case 'bloodrite': loseHp(b); hit(ti, a + bonus); break;
      case 'siphon': { const d = hit(ti, a + bonus); healPlayer(d, true); break; }
      case 'decap': hit(ti, a + bonus); break;
      case 'shieldbash': gainBlock(b, true); hit(ti, a + bonus); break;
      case 'bulwark': hit(ti, P.block, true); break;
      case 'defend': case 'ironwall': gainBlock(a, true); break;
      case 'dodge': gainBlock(a, true); drawCards(b); break;
      case 'insight': drawCards(a); break;
      case 'surge': P.energy += a; particles.text(P.x, P.y - 40, '+' + a + ' 能量', '#ffb020'); break;
      case 'healpot': healPlayer(a); break;
      case 'poisonmist': for (const e of B.enemies) if (e.hp > 0) addStatus(e, 'poison', a); break;
      case 'intimidate': for (const e of B.enemies) if (e.hp > 0) addStatus(e, 'weak', a); break;
      case 'frailty': for (const e of B.enemies) if (e.hp > 0) addStatus(e, 'vulnerable', a); break;
      case 'cleanse': P.st.weak = 0; P.st.vulnerable = 0; P.st.poison = 0; gainBlock(a, true); break;
      case 'prepare': drawCards(a); if (S.hand.length) S.discard.push(S.hand.splice(rng.int(0, S.hand.length - 1), 1)[0]); break;
      case 'secondwind': { const n = S.hand.length; while (S.hand.length) S.discard.push(S.hand.pop()); gainBlock(n * a, true); break; }
      case 'flex': P.st.strength += a; particles.text(P.x, P.y - 30, '力量+' + a, '#ffb020'); break;
      case 'shadowstep': gainBlock(a, true); for (const e of B.enemies) if (e.hp > 0) addStatus(e, 'weak', 1); break;
      case 'bandage': healPlayer(a); break;
      case 'entrench': P.block *= 2; particles.text(P.x, P.y - 30, '格挡 x2', '#22e0ff'); break;
      case 'adrenaline': P.energy += a; drawCards(1); break;
      case 'smokebomb': for (const e of B.enemies) if (e.hp > 0) { addStatus(e, 'weak', 2); addStatus(e, 'vulnerable', 2); } break;
      case 'inflame': P.st.strength += a; break;
      case 'metallicize': P.pw.metallicize += a; break;
      case 'thorns': P.pw.thorns += a; break;
      case 'demonform': P.pw.demon += a; break;
      case 'toxicblood': P.pw.toxic += a; break;
      case 'regen': P.pw.regen += a; break;
      case 'scholar': P.pw.draw += a; break;
      case 'overload': P.pw.energy += a; break;
      case 'dexterity': P.st.dex += a; break;
      case 'fury': P.pw.fury += a; break;
    }
    if (def.ex) S.exhaust.push(inst); else S.discard.push(inst);
    audio.sfx(def.type === 'attack' ? 'hit' : def.type === 'power' ? 'powerup' : 'select');
    // 打出拖尾
    particles.burst(W * 0.5, H * 0.72, 10, { color: TYPE_COLOR[def.type], speed: 150, life: .45, kind: 1 });
    syncHand(); updateHud(); checkWin();
    return true;
  }
  // ---------------- 地图 ----------------
  function genMap() {
    const floors = [];
    for (let f = 0; f < 10; f++) {
      const n = f === 0 || f === 9 ? 1 : rng.int(2, 4);
      const arr = [];
      for (let i = 0; i < n; i++) {
        let type = 'battle';
        if (f === 9) type = 'boss';
        else if (f > 0) {
          const r = rng();
          type = r < 0.54 ? 'battle' : r < 0.66 ? 'elite' : r < 0.76 ? 'shop' : r < 0.89 ? 'rest' : 'treasure';
          if (f < 2 && type === 'elite') type = 'battle';
        }
        arr.push({ i, type, next: [], x: 0, y: 0 });
      }
      floors.push(arr);
    }
    for (let f = 0; f < 9; f++) {
      const a = floors[f], b = floors[f + 1];
      for (let i = 0; i < a.length; i++) {
        const frac = a.length === 1 ? 0.5 : i / (a.length - 1);
        const j = clamp(Math.round(frac * (b.length - 1)), 0, b.length - 1);
        a[i].next.push(j);
        if (b.length > 1 && rng.chance(0.55)) {
          const alt = j + (rng.chance(0.5) ? 1 : -1);
          if (alt >= 0 && alt < b.length && a[i].next.indexOf(alt) < 0) a[i].next.push(alt);
        }
      }
      for (let j = 0; j < b.length; j++) {
        let has = false;
        for (const nd of a) if (nd.next.indexOf(j) >= 0) has = true;
        if (!has) a[clamp(Math.round(j / Math.max(1, b.length - 1) * (a.length - 1)), 0, a.length - 1)].next.push(j);
      }
    }
    S.map = floors; S.pos = { f: 0, i: 0 }; S.cleared = false;
  }
  function mapPos(f, i, n) {
    const top = H * 0.14, bot = H * 0.9;
    const y = bot - (bot - top) * (f / 9);
    const sp = Math.min(120, W / (n + 1));
    const x = W * 0.5 + (i - (n - 1) / 2) * sp;
    return { x, y };
  }
  const NODE_INFO = {
    battle: { c: PALETTE.red, g: '战', n: '战斗' },
    elite: { c: PALETTE.magenta, g: '精', n: '精英' },
    shop: { c: PALETTE.amber, g: '商', n: '商店' },
    rest: { c: PALETTE.green, g: '休', n: '休息' },
    treasure: { c: PALETTE.cyan, g: '宝', n: '宝箱' },
    boss: { c: PALETTE.violet, g: '王', n: 'BOSS' }
  };
  function enterNode(f, i) {
    const nd = S.map[f][i];
    S.pos = { f, i }; S.cleared = false;
    if (nd.type === 'battle' || nd.type === 'elite' || nd.type === 'boss') { layoutBattle(); startBattle(nd.type); }
    else if (nd.type === 'rest') { S.screen = 'rest'; showRest(); }
    else if (nd.type === 'shop') { S.screen = 'shop'; showShop(); }
    else { // 宝箱
      const gold = 30 + rng.int(10, 40); S.gold += gold;
      const pool = RELICS.filter(r => S.relics.indexOf(r.id) < 0);
      if (pool.length) { const r = rng.pick(pool); S.relics.push(r.id); say('获得遗物：' + r.name + '（' + r.desc + '）', 3); }
      audio.sfx('coin'); particles.sparkle(W * .5, H * .4, PALETTE.amber);
      S.cleared = true; S.screen = 'map';
    }
    updateHud();
  }
  const say = (m, s) => { S.msg = m; S.msgT = s; };
  // ============================ DOM：手牌 ============================
  const CW = 104, CH = 148;
  const handEl = ctx.overlay(document.createElement('div'), 'ov-hand');
  handEl.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;padding:0;background:none;pointer-events:none;z-index:9;';
  const cardEls = [];
  for (let i = 0; i < 12; i++) {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;left:0;top:0;width:${CW}px;height:${CH}px;display:none;pointer-events:auto;box-sizing:border-box;padding:6px 7px;border-radius:11px;cursor:pointer;user-select:none;touch-action:none;will-change:transform;background:linear-gradient(165deg,#18233f,#0a1020);border:1px solid #2b3a63;box-shadow:0 8px 20px rgba(0,0,0,.55);`;
    el.innerHTML = `<div class="cc" style="position:absolute;left:-6px;top:-6px;width:26px;height:26px;border-radius:50%;background:#22e0ff;color:#04101c;font-weight:900;font-size:13px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px rgba(34,224,255,.6)"></div>`
      + `<div class="cn" style="margin-top:16px;text-align:center;font-size:12.5px;font-weight:800;color:#eaf2ff;line-height:1.2"></div>`
      + `<div style="height:1px;background:#2b3a63;margin:5px 0"></div>`
      + `<div class="cd" style="text-align:center;font-size:10.5px;line-height:1.35;color:#9fb0d6"></div>`
      + `<div class="ct" style="position:absolute;left:0;right:0;bottom:5px;text-align:center;font-size:9.5px;color:#7d8db3"></div>`;
    handEl.appendChild(el);
    cardEls.push({ el, cc: el.querySelector('.cc'), cn: el.querySelector('.cn'), cd: el.querySelector('.cd'), ct: el.querySelector('.ct'), idx: i });
  }
  let hover = -1, sel = -1;
  const drag = { i: -1, x: 0, y: 0, sx: 0, sy: 0, on: 0, moved: 0 };
  for (let i = 0; i < cardEls.length; i++) {
    const ce = cardEls[i];
    ctx.listen(ce.el, 'pointerenter', () => { if (drag.i < 0) { hover = i; audio.sfx('hover'); } });
    ctx.listen(ce.el, 'pointerleave', () => { if (hover === i) hover = -1; });
    ctx.listen(ce.el, 'pointerdown', (e) => {
      e.preventDefault();
      drag.i = i; drag.on = 1; drag.moved = 0;
      drag.sx = e.clientX; drag.sy = e.clientY; drag.x = 0; drag.y = 0;
      audio.sfx('click');
    });
  }
  ctx.listen(window, 'pointermove', (e) => {
    if (!drag.on) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    drag.x = dx; drag.y = dy;
    if (Math.abs(dx) + Math.abs(dy) > 12) drag.moved = 1;
  });
  ctx.listen(window, 'pointerup', (e) => {
    if (!drag.on) return;
    drag.on = 0;
    const i = drag.i; drag.i = -1;
    if (i < 0 || i >= S.hand.length) return;
    const r = ctx.canvas.getBoundingClientRect();
    const py = e.clientY - r.top, pxx = e.clientX - r.left;
    if (drag.moved) { if (py < H * 0.70) playCard(i, nearestEnemy(pxx, py)); else sel = i; }
    else {
      sel = sel === i ? -1 : i;
      if (sel === i && !CARD_BY_ID[S.hand[i].id].tgt) playCard(i, -1);
    }
    audio.sfx('select'); ctx.vibrate(PATTERNS.tap);
    syncHand();
  });
  function nearestEnemy(px, py) {
    const B = S.battle; if (!B) return -1;
    let best = -1, bd = 1e9;
    for (let i = 0; i < B.enemies.length; i++) {
      const e = B.enemies[i]; if (e.hp <= 0) continue;
      const d = (e.x - px) * (e.x - px) + (e.y - py) * (e.y - py);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function syncHand() {
    const n = S.hand.length;
    const inBattle = S.screen === 'battle' && S.battle && S.battle.phase === 'player';
    for (let i = 0; i < cardEls.length; i++) {
      const ce = cardEls[i];
      if (i >= n || !inBattle) { ce.el.style.display = 'none'; continue; }
      const inst = S.hand[i], def = CARD_BY_ID[inst.id];
      const afford = S.battle.energy >= def.cost;
      ce.el.style.display = 'block';
      ce.cc.textContent = def.cost;
      ce.cc.style.background = afford ? PALETTE.cyan : '#44506e';
      ce.cn.textContent = cardName(inst);
      ce.cd.textContent = def.d(def0(def, inst), def1(def, inst));
      ce.ct.textContent = TYPE_NAME[def.type] + (def.ex ? ' · 消耗' : '');
      ce.el.style.borderColor = sel === i ? PALETTE.lime : TYPE_COLOR[def.type];
      ce.el.style.opacity = afford ? '1' : '0.55';
    }
    if (sel >= n) sel = -1;
    if (hover >= n) hover = -1;
    if (inBattle) layoutHand();
  }
  // ============================ DOM：按钮条 ============================
  const barEl = ctx.overlay(document.createElement('div'), 'ov-bar');
  barEl.style.cssText = 'position:absolute;right:10px;bottom:10px;z-index:11;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;padding:0;background:none;';
  function mkBtn(label, fn, color) {
    const b = document.createElement('button');
    b.className = 'btn btn-ghost';
    b.textContent = label;
    b.style.cssText = `pointer-events:auto;font-size:12px;padding:8px 14px;border-radius:10px;border:1px solid ${color};background:rgba(10,16,32,.9);color:${color};font-weight:700;`;
    b.onclick = () => { audio.sfx('confirm'); ctx.vibrate(PATTERNS.tap); fn(); };
    barEl.appendChild(b);
    return b;
  }
  const btnEnd = mkBtn('结束回合', () => endTurn(), PALETTE.lime);
  mkBtn('牌组', () => showList('牌组', S.deck.map(cardName)), PALETTE.cyan);
  mkBtn('遗物', () => showList('遗物', S.relics.map(id => { const r = RELICS.find(x => x.id === id); return r.name + '：' + r.desc; })), PALETTE.amber);
  // ============================ DOM：通用面板 ============================
  const panelEl = ctx.overlay(document.createElement('div'), 'ov-panel');
  panelEl.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:13;display:none;width:min(560px,94%);max-height:86%;overflow:auto;padding:16px;border-radius:16px;background:linear-gradient(180deg,#141d36,#0b1121);border:1px solid #2b3a63;box-shadow:0 20px 50px rgba(0,0,0,.6);';
  ctx.listen(panelEl, 'click', (e) => {
    const t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t) return;
    audio.sfx('confirm'); ctx.vibrate(PATTERNS.select);
    panelAction(t.getAttribute('data-act'), t.getAttribute('data-arg'));
  });
  let panelCb = null;
  function showPanel(title, html) {
    panelEl.innerHTML = `<div style="font-size:16px;font-weight:800;margin-bottom:10px;color:#eaf2ff">${title}</div>` + html
      + `<div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost" data-act="close" style="font-size:12px;padding:7px 14px">关闭</button></div>`;
    panelEl.style.display = 'block';
  }
  function hidePanel() { panelEl.style.display = 'none'; panelEl.innerHTML = ''; }
  function showList(title, items) {
    const body = items.length ? items.map(s => `<div style="padding:6px 8px;border-bottom:1px solid #1c2745;font-size:12.5px;color:#c7d4ee">${s}</div>`).join('')
      : '<div style="color:#7d8db3;font-size:12.5px">（空）</div>';
    showPanel(title + '（' + items.length + '）', `<div style="max-height:52vh;overflow:auto">${body}</div>`);
  }
  function cardHtml(inst, idx, price) {
    const d = CARD_BY_ID[inst.id], col = RARITY_COLOR[d.rarity];
    const btn = `<button class="btn btn-ghost" data-act="pick" data-arg="${idx}" style="margin-top:6px;width:100%;font-size:11px;padding:5px;border-color:${col};color:${col}">${price == null ? '选择' : price + ' 金'}</button>`;
    return `<div style="display:inline-block;width:118px;vertical-align:top;margin:6px;padding:9px;border-radius:11px;background:linear-gradient(165deg,#18233f,#0a1020);border:1px solid ${col};box-shadow:0 0 14px ${col}33">
      <div style="font-size:11px;color:${col};font-weight:800">${d.cost} 能量 · ${TYPE_NAME[d.type]}</div>
      <div style="font-size:13px;font-weight:800;color:#eaf2ff;margin:4px 0">${cardName(inst)}</div>
      <div style="font-size:10.5px;line-height:1.4;color:#9fb0d6;min-height:44px">${d.d(def0(d, inst), def1(d, inst))}</div>${btn}</div>`;
  }
  const def0 = (d, inst) => (d.v ? d.v[inst.lvl] : 0);
  const def1 = (d, inst) => (d.w ? d.w[inst.lvl] : 0);
  let offerCards = [];
  function panelAction(act, arg) {
    if (!panelCb) { hidePanel(); return; }
    const f = panelCb; panelCb = null; hidePanel();
    f(act === 'pick' ? parseInt(arg, 10) : (act === 'close' || act === 'cancel' ? null : act));
  }
  function offerCards3() {
    const out = [];
    for (let k = 0; k < 3; k++) {
      const r = rng();
      const rar = r < 0.1 ? 'rare' : r < 0.42 ? 'uncommon' : 'common';
      const pool = CARDS.filter(c => c.rarity === rar);
      const d = rng.pick(pool.length ? pool : CARDS);
      if (out.some(o => o.id === d.id)) { k--; continue; }
      out.push({ id: d.id, lvl: 0 });
    }
    return out;
  }
  const rowHtml = (t, act, arg, color) => `<div data-act="${act}" data-arg="${arg == null ? '' : arg}" style="padding:7px 9px;margin:4px 0;border:1px solid ${color};border-radius:9px;font-size:12.5px;color:#c7d4ee;cursor:pointer">${t}</div>`;
  function pickPanel(title, head, rows, cb) {
    showPanel(title, (head ? `<div style="font-size:12.5px;color:#9fb0d6;margin-bottom:8px">${head}</div>` : '') + rows.join(''));
    panelCb = cb;
  }
  function showReward(gold) {
    offerCards = offerCards3();
    pickPanel('战斗奖励', `胜利 +${gold} 金币 · 三选一（可跳过）`,
      offerCards.map((c, i) => cardHtml(c, i, null)).concat(rowHtml('跳过', 'skip', 0, '#2b3a63')),
      (r) => {
        if (typeof r === 'number' && offerCards[r]) { S.deck.push(offerCards[r]); audio.sfx('powerup'); particles.sparkle(W * .5, H * .4, PALETTE.cyan); }
        S.screen = 'map'; updateHud();
      });
  }
  function showRest() {
    pickPanel('休息处', `生命 ${P.hp}/${P.maxhp}`, [
      rowHtml(`休息：回复 ${Math.round(P.maxhp * 0.3)} 生命`, 'heal', 0, '#28e0a0'),
      rowHtml('锻造：升级一张卡牌', 'smith', 0, '#ffb020')],
      (r) => {
        if (r === 'heal') { healPlayer(Math.round(P.maxhp * 0.3)); audio.sfx('heal'); }
        else if (r === 'smith') { showUpgrade(); return; }
        S.screen = 'map'; updateHud();
      });
  }
  function showUpgrade() {
    const list = rng.shuffle(S.deck.filter(c => c.lvl === 0)).slice(0, 6);
    if (!list.length) { S.screen = 'map'; return; }
    const d1 = (c) => CARD_BY_ID[c.id].d(def0(CARD_BY_ID[c.id], { lvl: 1 }), def1(CARD_BY_ID[c.id], { lvl: 1 }));
    pickPanel('锻造', '选择一张卡牌永久升级', list.map((c, i) => rowHtml(`${cardName(c)} → ${d1(c)}`, 'pick', i, '#2b3a63')),
      (r) => {
        if (typeof r === 'number' && list[r]) { list[r].lvl = 1; audio.sfx('build'); }
        S.screen = 'map'; updateHud();
      });
  }
  function showRemove() {
    pickPanel('移除一张卡牌', '点击要移除的卡', S.deck.map((c, i) => rowHtml(cardName(c), 'pick', i, '#2b3a63')),
      (r) => {
        if (typeof r === 'number' && S.deck[r]) { S.deck.splice(r, 1); audio.sfx('back'); }
        S.screen = 'map'; updateHud();
      });
  }
  const priceOf = (base) => (hasRelic('scroll') ? Math.max(4, Math.round(base * 0.75)) : base);
  function showShop() {
    const cardOffers = offerCards3().concat(offerCards3());
    const prices = cardOffers.map(c => priceOf(CARD_BY_ID[c.id].rarity === 'rare' ? 60 : CARD_BY_ID[c.id].rarity === 'uncommon' ? 40 : 25));
    const relicOffers = rng.shuffle(RELICS.filter(r => S.relics.indexOf(r.id) < 0)).slice(0, 2);
    const relicPrices = relicOffers.map(() => priceOf(110));
    const remPrice = priceOf(70);
    offerCards = cardOffers;
    const rows = cardOffers.map((c, i) => cardHtml(c, i, prices[i]));
    for (let i = 0; i < relicOffers.length; i++) rows.push(rowHtml(`<b style="color:#ffb020">${relicOffers[i].name}</b> · ${relicOffers[i].desc}<span style="float:right;color:#8dff4d">${relicPrices[i]} 金</span>`, 'relic' + i, 0, '#ffb020'));
    rows.push(rowHtml(`移除一张卡牌<span style="float:right;color:#8dff4d">${remPrice} 金</span>`, 'remove', 0, '#ff4d5e'));
    rows.push(rowHtml('离开商店', 'leave', 0, '#2b3a63'));
    pickPanel('商店', `金币：${S.gold}`, rows, (r) => {
      if (r == null || r === 'leave') { S.screen = 'map'; return; }
      if (r === 'relic0' || r === 'relic1') {
        const i = r === 'relic0' ? 0 : 1;
        if (relicOffers[i] && S.gold >= relicPrices[i]) { S.gold -= relicPrices[i]; S.relics.push(relicOffers[i].id); audio.sfx('powerup'); }
        else { audio.sfx('error'); ctx.hint('金币不足'); }
        updateHud(); showShop(); return;
      }
      if (r === 'remove') {
        if (S.gold < remPrice) { audio.sfx('error'); ctx.hint('金币不足'); showShop(); return; }
        S.gold -= remPrice; updateHud(); showRemove(); return;
      }
      if (typeof r === 'number' && offerCards[r]) {
        const p = prices[r];
        if (S.gold >= p) { S.gold -= p; S.deck.push(offerCards[r]); audio.sfx('coin'); }
        else { audio.sfx('error'); ctx.hint('金币不足'); }
        updateHud();
      }
      showShop();
    });
  }
  // ============================ 布局 ============================
  function layoutBattle() {
    const B = S.battle; if (!B) return;
    const n = B.enemies.length;
    for (let i = 0; i < n; i++) {
      const e = B.enemies[i];
      e.x = W * 0.63 + (i - (n - 1) / 2) * Math.min(150, W * 0.14);
      e.y = H * 0.44 + (i % 2 ? 26 : -14);
      e.r = e.boss ? 46 : 32;
    }
    P.x = W * 0.20; P.y = H * 0.52; P.r = 34;
  }
  function updateHud() {
    ctx.hud('hp', '生命', P.hp + '/' + P.maxhp, { color: P.hp < P.maxhp * 0.3 ? PALETTE.red : PALETTE.green });
    ctx.hud('gold', '金币', S.gold, { color: PALETTE.amber });
    ctx.hud('floor', '层数', (S.floor + 1) + '/10');
    ctx.hud('relic', '遗物', S.relics.length, { color: PALETTE.violet });
  }
  // ============================ 初始化 ============================
  function newRun() {
    S.floor = 0; S.gold = 100; S.kills = 0; S.relics = []; P.hp = P.maxhp = 75; P.block = 0;
    S.deck = [];
    for (let i = 0; i < 5; i++) S.deck.push({ id: 'strike', lvl: 0 });
    for (let i = 0; i < 4; i++) S.deck.push({ id: 'defend', lvl: 0 });
    S.deck.push({ id: 'jab', lvl: 0 }, { id: 'heavy', lvl: 0 });
    genMap(); updateHud(); S.screen = 'map';
    say('选择路径，向第 10 层的 BOSS 前进', 3);
  }
  newRun();
  // ============================ 更新 ============================
  function update(dt) {
    S.t += dt;
    if (S.msgT > 0) S.msgT -= dt;
    if (P.hurt > 0) P.hurt -= dt;
    const B = S.battle;
    if (S.screen === 'battle' && B) {
      for (const e of B.enemies) if (e.hurt > 0) e.hurt -= dt;
      if (B.phase === 'player') {
        if (input.pointer.justDown) {
          const px = input.pointer.x, py = input.pointer.y;
          if (sel >= 0 && S.hand[sel]) {                       // 点场上 = 对最近敌人打出
            const ti = nearestEnemy(px, py);
            if (ti >= 0 || !CARD_BY_ID[S.hand[sel].id].tgt) playCard(sel, ti);
            else { audio.sfx('error'); sel = -1; }
            syncHand();
          } else if (py < H * 0.78) ctx.hint('先点一张手牌，再点敌人打出');
        }
        if (input.justPressed('confirm') || input.justPressed('secondary')) endTurn();
        checkWin();
        if (rng.chance(0.4)) particles.trail(P.x + rng.range(-20, 20), P.y + 30, PALETTE.cyan, 2);
      } else if (B.phase === 'enemy') {
        B.timer -= dt;
        if (B.timer <= 0) { enemyStep(); if (B.phase !== 'enemy') return; }
        if (B.ei >= B.enemies.length && B.timer <= 0) nextRound();
      } else if (B.phase === 'over') {
        B.over -= dt;
        if (B.over <= 0) endBattle(true);
      }
    }
    // 地图：点击节点
    if (S.screen === 'map' && input.pointer.justDown) {
      const px = input.pointer.x, py = input.pointer.y;
      const f = S.cleared ? S.pos.f + 1 : S.pos.f;
      if (f >= S.map.length) return;
      const arr = S.map[f];
      for (let j = 0; j < arr.length; j++) {
        if (S.cleared && S.map[S.pos.f][S.pos.i].next.indexOf(j) < 0) continue;
        if (!S.cleared && j !== S.pos.i) continue;
        const p = mapPos(f, j, arr.length);
        if ((px - p.x) * (px - p.x) + (py - p.y) * (py - p.y) < 28 * 28) {
          S.floor = f; audio.sfx('confirm'); enterNode(f, j);
          break;
        }
      }
    }
  }
  // ============================ 渲染 ============================
  function render(alpha, rdt) {
    const c = ctx.ctx;
    c.fillStyle = '#05080f'; c.fillRect(0, 0, W, H);
    drawGrid(c, W, H, 44, 'rgba(40,60,110,.10)', 1, 0, 0);
    c.save();
    shake.apply(c);
    if (S.screen === 'battle') drawBattle(c); else drawMap(c);
    particles.render(c, 1);
    particles.renderTexts(c, rdt);
    c.restore();
    vignette(c, W, H, 0.42);
    if (S.msgT > 0) {
      panel(c, W / 2 - 190, H * 0.06, 380, 34, { fill: 'rgba(8,12,24,.9)', stroke: PALETTE.cyan, r: 17 });
      text(c, S.msg, W / 2, H * 0.06 + 17, { size: 13, color: PALETTE.white, alpha: clamp01(S.msgT) });
    }
    btnEnd.style.display = S.screen === 'battle' ? '' : 'none';
    layoutHand();
  }
  // 手牌扇形布局（hover 上浮放大、拖拽跟随）
  function layoutHand() {
    if (S.screen !== 'battle' || !S.battle || S.battle.phase !== 'player') return;
    const n = S.hand.length, baseY = H - CH - 6, cx = W * 0.5;
    const sp = Math.min(CW * 0.86, (W - 40) / Math.max(1, n));
    for (let i = 0; i < n && i < cardEls.length; i++) {
      const ce = cardEls[i], off = i - (n - 1) / 2;
      let x = cx + off * sp - CW / 2, y = baseY + off * off * 5, s = 1, z = 10, rot = off * 4.5;
      if (drag.on && drag.i === i) { x += drag.x; y += drag.y; s = 1.08; z = 30; rot *= .3; }
      else if (hover === i) { y -= 34; s = 1.22; z = 25; rot = 0; ce.el.style.boxShadow = '0 0 22px rgba(34,224,255,.55)'; }
      else if (sel === i) { y -= 22; s = 1.16; z = 24; rot = 0; ce.el.style.boxShadow = '0 0 20px rgba(141,255,77,.6)'; }
      else ce.el.style.boxShadow = '0 8px 20px rgba(0,0,0,.55)';
      ce.el.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0) rotate(${rot.toFixed(1)}deg) scale(${s})`;
      ce.el.style.zIndex = z;
    }
  }
  // ---------------- 战斗画面 ----------------
  function drawBattle(c) {
    const B = S.battle;
    c.save();
    c.strokeStyle = 'rgba(34,224,255,.18)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, H * 0.70); c.lineTo(W, H * 0.70); c.stroke();
    c.restore();
    drawPlayer(c);
    for (let i = 0; i < B.enemies.length; i++) drawEnemy(c, B.enemies[i]);
    text(c, '回合 ' + B.turn + (B.phase === 'enemy' ? ' · 敌方行动' : ''), W / 2, 22,
      { size: 14, color: B.phase === 'enemy' ? PALETTE.red : PALETTE.cyan, weight: 800 });
    energyOrb(c, W * 0.5 - 120, H - CH - 34 + CH / 2, 30);
    drawPile(c, 16, H - 34, '抽牌', S.drawPile.length, PALETTE.cyan);
    drawPile(c, W - 92, H - 34, '弃牌', S.discard.length, PALETTE.amber);
    drawPile(c, W - 176, H - 34, '消耗', S.exhaust.length, PALETTE.red);
    if (sel >= 0 && S.hand[sel]) {
      const def = CARD_BY_ID[S.hand[sel].id];
      text(c, def.tgt ? '点击敌人打出：' + cardName(S.hand[sel]) : '点击场上任意位置打出', W / 2, H * 0.62, { size: 13, color: PALETTE.lime, glow: 10 });
    }
    if (B.phase === 'over') text(c, '战斗胜利！', W / 2, H * 0.34, { size: 34, color: PALETTE.lime, weight: 900, glow: 20 });
  }
  function energyOrb(c, x, y, r) {
    glowCircle(c, x, y, r, S.battle.energy > 0 ? PALETTE.cyan : '#44506e', { glow: 16, width: 3, fill: 'rgba(34,224,255,.10)' });
    text(c, S.battle.energy + '/' + P.maxEnergy, x, y, { size: 15, color: '#fff', weight: 900 });
    text(c, '能量', x, y + r + 12, { size: 10, color: PALETTE.dim });
  }
  function drawPile(c, x, y, label, n, color) {
    fillRound(c, x, y, 76, 26, 8, 'rgba(12,18,34,.9)');
    strokeRound(c, x, y, 76, 26, 8, color, 1.2);
    text(c, label + ' ' + n, x + 38, y + 13, { size: 11.5, color: '#eaf2ff', weight: 700 });
  }
  function drawPlayer(c) {
    const hurtK = P.hurt > 0 ? clamp01(P.hurt / 0.5) : 0;
    c.save();
    c.translate(P.x, P.y + Math.sin(S.t * 1.6) * 4);
    if (hurtK > 0) c.translate(rng.range(-4, 4) * hurtK, rng.range(-4, 4) * hurtK);
    glowCircle(c, 0, 0, P.r + 10, PALETTE.cyan, { glow: 18, width: 2, alpha: .8 });
    c.beginPath();
    for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * TAU / 6; const X = Math.cos(a) * P.r, Y = Math.sin(a) * P.r; i ? c.lineTo(X, Y) : c.moveTo(X, Y); }
    c.closePath();
    c.fillStyle = 'rgba(34,224,255,.16)'; c.fill();
    neonStroke(c, PALETTE.cyan, 2.5, 12);
    glowDot(c, 0, 0, 16 * (1 + Math.sin(S.t * 4) * .12), PALETTE.white, .9);
    c.restore();
    bar(c, P.x - 65, P.y + P.r + 16, 130, 12, P.hp / P.maxhp, { fill: PALETTE.green, bg: '#1a2136', glowColor: PALETTE.green });
    text(c, Math.ceil(P.hp) + '/' + P.maxhp, P.x, P.y + P.r + 22, { size: 11, color: '#fff', weight: 800 });
    if (P.block > 0) {
      glowCircle(c, P.x - P.r - 18, P.y, 15, PALETTE.cyan, { glow: 12, width: 2, fill: 'rgba(34,224,255,.18)' });
      text(c, String(P.block), P.x - P.r - 18, P.y, { size: 12, color: '#fff', weight: 900 });
    }
    drawStatusRow(c, P.x - 60, P.y + P.r + 34, P.st, P.pw, true);
  }
  function neonStroke(c, color, w, glow) {
    c.save(); c.lineJoin = 'round'; c.shadowColor = color; c.shadowBlur = glow;
    c.strokeStyle = color; c.lineWidth = w; c.stroke(); c.restore();
  }
  function drawStatusRow(c, x, y, st, pw, isPlayer) {
    if (st.strength) x = chip(c, x, y, '力' + st.strength, PALETTE.amber);
    if (st.dex) x = chip(c, x, y, '敏' + st.dex, PALETTE.cyan);
    if (st.vulnerable) x = chip(c, x, y, '易伤' + st.vulnerable, PALETTE.magenta);
    if (st.weak) x = chip(c, x, y, '虚弱' + st.weak, PALETTE.violet);
    if (st.poison) x = chip(c, x, y, '毒' + st.poison, PALETTE.green);
    if (isPlayer && pw.thorns) x = chip(c, x, y, '荆' + pw.thorns, PALETTE.red);
    if (isPlayer && pw.metallicize) x = chip(c, x, y, '金' + pw.metallicize, PALETTE.cyan);
    if (isPlayer && pw.regen) x = chip(c, x, y, '再' + pw.regen, PALETTE.green);
  }
  function chip(c, x, y, label, color) {
    const w = 12 + label.length * 11;
    fillRound(c, x, y, w, 18, 9, 'rgba(10,16,30,.9)');
    strokeRound(c, x, y, w, 18, 9, color, 1);
    text(c, label, x + w / 2, y + 9, { size: 10.5, color, weight: 800 });
    return x + w + 5;
  }
  function drawEnemy(c, e) {
    if (e.hp <= 0) {
      c.save(); c.globalAlpha = 0.18; drawShape(c, e.kind, e.x, e.y, e.r, PALETTE.dim, 0); c.restore();
      return;
    }
    const hurtK = e.hurt > 0 ? clamp01(e.hurt / 0.45) : 0;
    c.save();
    c.translate(e.x, e.y + Math.sin(S.t * 2 + e.bob) * 5);
    if (hurtK > 0) c.translate(rng.range(-5, 5) * hurtK, rng.range(-5, 5) * hurtK);
    drawShape(c, e.kind, 0, 0, e.r, e.boss ? PALETTE.violet : PALETTE.magenta, S.t + e.bob);
    c.restore();
    const bw = e.boss ? 170 : 96;
    bar(c, e.x - bw / 2, e.y + e.r + 12, bw, 10, e.hp / e.maxhp, { fill: PALETTE.red, bg: '#1a2136', glowColor: PALETTE.red });
    text(c, Math.ceil(e.hp) + '/' + e.maxhp, e.x, e.y + e.r + 17, { size: 10, color: '#fff', weight: 800 });
    text(c, e.name, e.x, e.y - e.r - 34, { size: 11.5, color: PALETTE.white, weight: 700 });
    if (e.block > 0) {
      glowCircle(c, e.x - e.r - 14, e.y, 13, PALETTE.cyan, { glow: 10, width: 2, fill: 'rgba(34,224,255,.2)' });
      text(c, String(e.block), e.x - e.r - 14, e.y, { size: 11, color: '#fff', weight: 900 });
    }
    drawIntent(c, e);
    drawStatusRow(c, e.x - 46, e.y + e.r + 26, e.st, null, false);
  }
  function drawIntent(c, e) {
    const it = e.intent; if (!it) return;
    const y = e.y - e.r - 62;
    let col = PALETTE.red, val = '';
    if (it.k === 'attack') { col = PALETTE.red; val = it.t > 1 ? `${it.v}×${it.t}` : String(it.v); }
    else if (it.k === 'defend') { col = PALETTE.cyan; val = String(it.v); }
    else if (it.k === 'buff') { col = PALETTE.amber; val = '+' + it.v; }
    else { col = PALETTE.violet; val = it.st === 'weak' ? '弱' + it.v : '易' + it.v; }
    const w = 26 + val.length * 8;
    fillRound(c, e.x - w / 2, y - 11, w, 22, 11, 'rgba(8,12,24,.92)');
    strokeRound(c, e.x - w / 2, y - 11, w, 22, 11, col, 1.4);
    text(c, INTENT_ICON[it.k] + ' ' + val, e.x, y, { size: 12, color: col, weight: 800 });
  }
  function drawShape(c, kind, x, y, r, color, t) {
    c.save(); c.translate(x, y); c.beginPath();
    if (kind === 'blob') {
      for (let i = 0; i <= 24; i++) {
        const a = i / 24 * TAU, rr = r * (0.86 + 0.14 * Math.sin(a * 3 + t * 2));
        const X = Math.cos(a) * rr, Y = Math.sin(a) * rr * 0.82;
        i ? c.lineTo(X, Y) : c.moveTo(X, Y);
      }
      c.closePath();
    } else if (kind === 'tri') { c.moveTo(0, -r); c.lineTo(r * .88, r * .7); c.lineTo(-r * .88, r * .7); c.closePath(); }
    else if (kind === 'square') roundRect(c, -r * .8, -r * .8, r * 1.6, r * 1.6, 6);
    else if (kind === 'hex') { for (let i = 0; i < 6; i++) { const a = i * TAU / 6; const X = Math.cos(a) * r, Y = Math.sin(a) * r; i ? c.lineTo(X, Y) : c.moveTo(X, Y); } c.closePath(); }
    else if (kind === 'bone') { c.moveTo(0, -r); c.lineTo(r * .5, -r * .4); c.lineTo(r * .3, r * .8); c.lineTo(-r * .3, r * .8); c.lineTo(-r * .5, -r * .4); c.closePath(); }
    else starPath(c, 0, 0, r * (kind === 'boss' ? 1.1 : 1), kind === 'boss' ? 8 : 5, 0.5, t * .5);
    c.fillStyle = 'rgba(255,46,136,.14)'; c.fill();
    neonStroke(c, color, 2.4, 14);
    glowDot(c, 0, 0, r * .32, color, .8);
    c.restore();
  }
  // ---------------- 地图画面 ----------------
  function drawMap(c) {
    const floors = S.map;
    for (let f = 0; f < floors.length; f++) {
      const arr = floors[f];
      for (let i = 0; i < arr.length; i++) {
        const p = mapPos(f, i, arr.length);
        arr[i].x = p.x; arr[i].y = p.y;
        if (f + 1 < floors.length) for (const j of arr[i].next) {
          const q = mapPos(f + 1, j, floors[f + 1].length);
          const ok = S.cleared && f === S.pos.f && i === S.pos.i;
          glowLine(c, p.x, p.y, q.x, q.y, ok ? PALETTE.lime : 'rgba(60,80,130,.55)', ok ? 2 : 1, ok ? 10 : 3);
        }
      }
    }
    for (let f = 0; f < floors.length; f++) for (let i = 0; i < floors[f].length; i++) {
      const nd = floors[f][i], info = NODE_INFO[nd.type];
      const reachable = S.cleared && f === S.pos.f + 1 && floors[S.pos.f][S.pos.i].next.indexOf(i) >= 0;
      const cur = f === S.pos.f && i === S.pos.i, passed = f < S.pos.f;
      const pulse = reachable ? 1 + Math.sin(S.t * 5) * .08 : 1;
      const r = (nd.type === 'boss' ? 24 : 17) * pulse;
      glowCircle(c, nd.x, nd.y, r, passed ? '#3c4a6e' : reachable ? PALETTE.lime : info.c,
        { glow: reachable ? 18 : 10, width: 2, fill: passed ? 'rgba(60,70,100,.25)' : 'rgba(10,16,30,.9)', alpha: passed ? .6 : 1 });
      text(c, info.g, nd.x, nd.y, { size: nd.type === 'boss' ? 18 : 13, color: passed ? PALETTE.dim : info.c, weight: 900 });
      if (cur) {
        glowCircle(c, nd.x, nd.y, r + 8 + Math.sin(S.t * 4) * 2, PALETTE.white, { glow: 14, width: 1.5, alpha: .7 });
        if (!S.cleared) text(c, '点击开始', nd.x, nd.y + r + 16, { size: 11, color: PALETTE.lime });
      }
    }
    text(c, '第 ' + (S.pos.f + 1) + ' 层 · ' + NODE_INFO[S.map[S.pos.f][S.pos.i].type].n, W / 2, H - 16, { size: 13, color: PALETTE.white, weight: 700 });
  }
  // ---------------- 生命周期 ----------------
  function resize(w, h) { W = w; H = h; layoutBattle(); syncHand(); }
  return {
    update, render, resize,
    pause() { audio.duck(0.5, 2000); },
    resume() { },
    destroy() { handEl.remove(); barEl.remove(); panelEl.remove(); }
  };
}
