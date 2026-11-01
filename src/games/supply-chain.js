import { clamp, clamp01, lerp, TAU } from '../core/math.js';
import { PALETTE, fillRound, strokeRound, glowCircle, glowRect, glowDot, glowLine, text, bar, panel as drawPanel, vignette, grid as drawGrid } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'supply-chain', title: '供应链大亨', category: 'sim', difficulty: 4, music: 'menu', particles: 1200,
  howto: [
    '底部选择建筑后点击格子建造：矿场只能建在矿脉/煤层上，道路用来连接建筑',
    '货物会沿道路自动运输（铁矿+煤炭→钢板→零件→成品），运到港口按市价卖出',
    '完成 12 笔订单获胜；每秒要付维护费和工资，负债超过 10 秒破产'
  ]
};
export const musicTrack = 'menu';

const GW = 16, GH = 12, NC = GW * GH, MAXP = 90, MAXC = 260;
const EMPTY = 0, MINE = 1, FAC = 2, WH = 3, PORT = 4, ROAD = 5;
const ORE = 0, COAL = 1, STEEL = 2, PARTS = 3, DEVICE = 4;
const ITEMS = ['铁矿', '煤炭', '钢板', '零件', '成品'];
const ICOL = ['#8dff4d', '#ffb020', '#22e0ff', '#a855f7', '#ff2e88'];
const BCOL = ['#44506e', '#8dff4d', '#22e0ff', '#a855f7', '#ffb020', '#7d8db3'];
const BNAME = ['空地', '矿场', '工厂', '仓库', '港口', '道路'];
const COST = [0, 80, 130, 60, 110, 12];
const MAINT = [0, 3, 5, 1.5, 2.5, 0.2];
const WCAP = [0, 3, 4, 2, 2, 0];
const WAGE = 2.2, HIRE = 28;
const RECIPES = [
  { n: '钢板', need: [2, 1, 0, 0, 0], out: STEEL, t: 2.6 },
  { n: '零件', need: [0, 0, 2, 0, 0], out: PARTS, t: 3.0 },
  { n: '成品', need: [0, 0, 1, 2, 0], out: DEVICE, t: 3.8 }
];
const CAPIN = 10, CAPOUT = 8, CAPWH = 30;

export function create(ctx) {
  const c = ctx.ctx;
  const R = ctx.rng, A = ctx.audio, PT = ctx.particles, NO = ctx.noise;
  let W = 960, H = 600, cs = 30, gx0 = 0, gy0 = 0;

  const BT = new Uint8Array(NC);        // 建筑类型
  const BR = new Int8Array(NC);         // 工厂配方
  const BW = new Int8Array(NC);         // 工人数
  const BP = new Float32Array(NC);      // 生产进度 0..1
  const BQ = new Float32Array(NC);      // 生产脉冲动画
  const BF = new Float32Array(NC);      // 警告闪烁
  const BS = new Float32Array(NC);      // 发货计时
  const RES = new Uint8Array(NC);       // 资源矿脉
  const INV = new Int32Array(NC * 5);   // 库存
  const IFC = new Int32Array(NC * 5);   // 在途
  const CONG = new Int16Array(NC);      // 拥堵
  const DIST = new Int16Array(NC);
  const PREV = new Int16Array(NC);
  const QQ = new Int32Array(NC);
  const LIST = [];

  const S = {
    money: 700, labor: 8, used: 0, tool: 0, sel: -1, t: 0, debt: 0, done: 0, fail: 0,
    earned: 0, spent: 0, over: false, hintT: 6, tick: 0
  };
  const ORD = { item: STEEL, qty: 4, got: 0, lim: 60, t: 0, reward: 120 };
  const PR = [6, 5, 34, 78, 165];
  const _po = { color: '#fff', speed: 60, life: 0.5, size: 2, kind: 0, grav: 0 };
  const _fp = new Int16Array(MAXP);

  /* ---------- 布局 ---------- */
  function layout(w, h) {
    W = w; H = h;
    cs = clamp(Math.floor(Math.min((w - 24) / GW, (h - 118) / GH)), 13, 46);
    gx0 = Math.round((w - cs * GW) / 2);
    gy0 = Math.round(52 + Math.max(0, (h - 118 - cs * GH) / 2));
  }
  function cellAt(px, py) {
    const x = Math.floor((px - gx0) / cs), y = Math.floor((py - gy0) / cs);
    if (x < 0 || y < 0 || x >= GW || y >= GH) return -1;
    return y * GW + x;
  }
  function cx(i) { return gx0 + (i % GW) * cs + cs / 2; }
  function cy(i) { return gy0 + ((i / GW) | 0) * cs + cs / 2; }

  /* ---------- 地图 ---------- */
  function genMap() {
    BT.fill(0); BR.fill(-1); BW.fill(0); BP.fill(0); RES.fill(0); INV.fill(0); IFC.fill(0);
    LIST.length = 0;
    let ore = 0, coal = 0;
    for (let k = 0; k < 240 && (ore < 7 || coal < 6); k++) {
      const i = R.int(0, NC - 1);
      if (RES[i]) continue;
      const x = i % GW, y = (i / GW) | 0;
      if (x < 1 || y < 1 || x > GW - 2 || y > GH - 2) continue;
      if (ore < 7 && R.chance(0.55)) { RES[i] = 1; ore++; } else if (coal < 6) { RES[i] = 2; coal++; }
    }
    // 保证起始资金够开一条最小产业链：矿+路+厂+港
  }

  /* ---------- 建造 ---------- */
  function tryPlace(i, t) {
    if (i < 0 || BT[i]) { A.sfx('error'); return; }
    if (t === MINE && !RES[i]) { A.sfx('error'); say('矿场只能建在矿脉或煤层上'); return; }
    if (t !== MINE && RES[i]) { A.sfx('error'); say('矿脉上只能建矿场'); return; }
    if (S.money < COST[t]) { A.sfx('error'); say('资金不足'); return; }
    S.money -= COST[t]; S.spent += COST[t];
    BT[i] = t; BW[i] = 0; BP[i] = 0; BR[i] = t === FAC ? 0 : -1;
    LIST.push(i);
    A.sfx(t === ROAD ? 'place' : 'build'); ctx.vibrate(PATTERNS.tap);
    _po.color = BCOL[t]; _po.speed = 90; _po.life = 0.5; _po.size = 2.6; _po.kind = 4; _po.grav = 60;
    PT.burst(cx(i), cy(i), 12, _po);
    if (t === MINE || t === FAC) { BW[i] = 1; }
    recalcLabor();
    say('建成' + BNAME[t]);
  }
  function demolish(i) {
    if (i < 0 || !BT[i]) return;
    const t = BT[i];
    S.money += Math.round(COST[t] * 0.4);
    for (let k = 0; k < 5; k++) { INV[i * 5 + k] = 0; IFC[i * 5 + k] = 0; }
    for (let k = 0; k < CAR.length; k++) { const g = CAR[k]; if (g.on && (g.src === i || g.dst === i)) g.on = false; }
    BT[i] = 0; BR[i] = -1; BW[i] = 0; BP[i] = 0;
    const at = LIST.indexOf(i); if (at >= 0) LIST.splice(at, 1);
    A.sfx('back'); ctx.vibrate(PATTERNS.tap);
    _po.color = '#ff4d5e'; _po.speed = 80; _po.life = 0.5; _po.size = 2.4; _po.kind = 4; _po.grav = 120;
    PT.burst(cx(i), cy(i), 10, _po);
    recalcLabor(); syncDetail();
  }
  function recalcLabor() { let u = 0; for (let k = 0; k < LIST.length; k++) u += BW[LIST[k]]; S.used = u; }
  function hire(n) {
    if (n > 0) { if (S.money < HIRE) { A.sfx('error'); say('资金不足'); return; } S.money -= HIRE; S.labor++; A.sfx('coin'); }
    else { if (S.labor <= 0) return; S.labor--; A.sfx('back'); }
    syncBar(); syncDetail();
  }
  function addWorker(i, d) {
    if (!BT[i]) return;
    const cap = WCAP[BT[i]];
    if (!cap) return;
    if (d > 0) { if (BW[i] >= cap || S.used >= S.labor) { A.sfx('error'); say(BW[i] >= cap ? '该建筑工位已满' : '没有空闲工人，先雇佣'); return; } BW[i]++; }
    else { if (BW[i] <= 0) return; BW[i]--; }
    A.sfx('click'); recalcLabor(); syncDetail();
  }
  function cycleRecipe(i) { if (BT[i] !== FAC) return; BR[i] = (BR[i] + 1) % RECIPES.length; BP[i] = 0; A.sfx('swap'); syncDetail(); }

  /* ---------- 寻路 ---------- */
  function bfsRoad(dst) {
    DIST.fill(-1); PREV.fill(-1);
    let head = 0, tail = 0;
    DIST[dst] = 0; QQ[tail++] = dst;
    while (head < tail) {
      const cur = QQ[head++], cd = DIST[cur], x = cur % GW, y = (cur / GW) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const ni = ny * GW + nx;
        if (DIST[ni] >= 0 || BT[ni] !== ROAD) continue;
        DIST[ni] = cd + 1; PREV[ni] = cur; QQ[tail++] = ni;
      }
    }
  }
  function planPath(src, dst) {
    if (src === dst) return -1;
    bfsRoad(dst);
    let best = -1, bv = 1e9;
    const sx = src % GW, sy = (src / GW) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = sx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = sy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const ni = ny * GW + nx;
      if (DIST[ni] >= 0 && DIST[ni] < bv) { bv = DIST[ni]; best = ni; }
    }
    if (best < 0) {
      const dx = Math.abs(sx - (dst % GW)), dy = Math.abs(sy - ((dst / GW) | 0));
      if (dx + dy === 1) { _fp[0] = src; _fp[1] = dst; return 2; }
      return -1;
    }
    let n = 0;
    _fp[n++] = src;
    let cur = best;
    const chain = [];
    while (cur !== dst && cur >= 0) { chain.push(cur); cur = PREV[cur]; }
    if (cur !== dst) return -1;
    for (let i = 0; i < chain.length; i++) _fp[n++] = chain[i];
    _fp[n++] = dst;
    return n;
  }

  /* ---------- 货物 ---------- */
  const CAR = [];
  for (let k = 0; k < MAXC; k++) CAR.push({ on: false, x: 0, y: 0, pi: 0, pn: 0, t: 0, item: 0, qty: 1, src: -1, dst: -1, path: new Int16Array(MAXP) });
  function spawnCargo(src, dst, item, qty) {
    const pn = planPath(src, dst);
    if (pn < 0) return false;
    let g = null;
    for (let k = 0; k < MAXC; k++) if (!CAR[k].on) { g = CAR[k]; break; }
    if (!g) return false;
    for (let k = 0; k < pn; k++) g.path[k] = _fp[k];
    g.on = true; g.pn = pn; g.pi = 0; g.t = 0; g.item = item; g.qty = qty; g.src = src; g.dst = dst;
    g.x = _fp[0] % GW; g.y = (_fp[0] / GW) | 0;
    IFC[dst * 5 + item] += qty;
    return true;
  }
  function arrive(g) {
    const d = g.dst;
    INV[d * 5 + g.item] += g.qty;
    IFC[d * 5 + g.item] -= g.qty;
    if (IFC[d * 5 + g.item] < 0) IFC[d * 5 + g.item] = 0;
    if (BT[d] === PORT) sellAt(d, g.item, g.qty);
    g.on = false;
    _po.color = ICOL[g.item]; _po.speed = 50; _po.life = 0.35; _po.size = 2; _po.kind = 0; _po.grav = 0;
    PT.burst(cx(d), cy(d), 5, _po);
  }
  function sellAt(d, item, qty) {
    const gain = Math.round(PR[item] * qty);
    S.money += gain; S.earned += gain;
    PT.text(cx(d), cy(d) - cs * 0.4, '+' + gain, '#ffb020');
    _po.color = '#ffb020'; _po.speed = 60; _po.life = 0.5; _po.size = 2.2; _po.kind = 4; _po.grav = 130;
    PT.burst(cx(d), cy(d), 7, _po);
    A.sfx('coin');
    if (ORD.item === item && ORD.got < ORD.qty) {
      ORD.got += qty;
      if (ORD.got >= ORD.qty) completeOrder();
    }
  }
  function newOrder() {
    const tier = clamp(Math.floor(S.done / 4), 0, 2);
    const item = STEEL + (R.chance(0.5) ? tier : R.int(0, tier));
    ORD.item = item;
    ORD.qty = 3 + Math.floor(S.done * 0.5) + R.int(0, 2);
    ORD.got = 0; ORD.t = 0;
    ORD.lim = 45 + ORD.qty * 9;
    ORD.reward = Math.round(PR[item] * ORD.qty * 0.9 + 60 + S.done * 12);
    A.sfx('confirm');
    say('新订单：' + ORD.qty + ' × ' + ITEMS[item] + '（限时 ' + ORD.lim + 's，奖励 ' + ORD.reward + '）');
  }
  function completeOrder() {
    S.money += ORD.reward; S.earned += ORD.reward; S.done++;
    A.sfx('win'); ctx.vibrate(PATTERNS.win); ctx.flash.add(0.35, '#8dff4d');
    PT.text(W / 2, gy0 - 18, '订单完成 +' + ORD.reward, '#8dff4d');
    if (S.done >= 12) { endRun(true); return; }
    newOrder();
  }
  function failOrder() {
    const pen = Math.round(ORD.reward * 0.25);
    S.money -= pen; S.fail++;
    A.sfx('lose'); ctx.flash.add(0.3, '#ff4d5e');
    say('订单超时，罚金 ' + pen);
    newOrder();
  }
  function endRun(win) {
    if (S.over) return;
    S.over = true;
    A.sfx(win ? 'win' : 'lose');
    ctx.vibrate(win ? PATTERNS.win : PATTERNS.lose);
    ctx.flash.add(0.5, win ? '#8dff4d' : '#ff4d5e');
    const sc = Math.round(S.money + S.done * 300 - S.fail * 90 + S.earned * 0.2);
    ctx.finish(sc, { win, higherBetter: true, stats: { 完成订单: S.done + '/12', 超时: S.fail, 资产: Math.round(S.money), 累计营收: Math.round(S.earned) } });
  }

  /* ---------- 生产与物流 ---------- */
  function invAt(i, k) { return INV[i * 5 + k]; }
  function roomFor(i, k, cap) { return INV[i * 5 + k] + IFC[i * 5 + k] < cap; }
  function eff(i) { const cap = WCAP[BT[i]]; return cap ? BW[i] / cap : 1; }
  function mineItem(i) { return RES[i] === 2 ? COAL : ORE; }

  function nearestDest(src, item, kind) {
    let best = -1, bv = 1e9;
    for (let k = 0; k < LIST.length; k++) {
      const j = LIST[k];
      if (j === src || BT[j] !== kind) continue;
      if (kind === FAC) { const r = RECIPES[BR[j] < 0 ? 0 : BR[j]]; if (!r.need[item]) continue; if (!roomFor(j, item, CAPIN)) continue; }
      else if (!roomFor(j, item, CAPWH)) continue;
      bfsRoad(j);
      const sx = src % GW, sy = (src / GW) | 0;
      let v = 1e9;
      for (let d = 0; d < 4; d++) {
        const nx = sx + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = sy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const ni = ny * GW + nx;
        if (DIST[ni] >= 0 && DIST[ni] < v) v = DIST[ni];
      }
      if (v < bv) { bv = v; best = j; }
    }
    return best;
  }
  function tryShip(i) {
    const t = BT[i];
    let item = -1;
    if (t === MINE) item = mineItem(i);
    else if (t === FAC) item = RECIPES[BR[i] < 0 ? 0 : BR[i]].out;
    else {
      let bv = -1;
      for (let k = 0; k < 5; k++) if (INV[i * 5 + k] > bv) { bv = INV[i * 5 + k]; item = k; }
      if (bv <= 0) return;
    }
    if (item < 0 || INV[i * 5 + item] <= 0) return;
    let dst = -1;
    if (t === MINE) { dst = nearestDest(i, item, FAC); if (dst < 0) dst = nearestDest(i, item, WH); }
    else { dst = nearestDest(i, item, PORT); if (dst < 0) dst = nearestDest(i, item, WH); }
    if (dst < 0) { BF[i] = 0.9; return; }
    if (spawnCargo(i, dst, item, 1)) { INV[i * 5 + item]--; A.sfx('shoot'); }
    else BF[i] = 0.6;
  }

  function produce(dt) {
    for (let k = 0; k < LIST.length; k++) {
      const i = LIST[k], t = BT[i], e = eff(i);
      BS[i] += dt;
      if (BQ[i] > 0) BQ[i] -= dt * 1.6;
      if (BF[i] > 0) BF[i] -= dt * 0.7;
      if (t === ROAD || t === PORT) continue;
      if (BW[i] <= 0 && t !== WH) { BF[i] = Math.max(BF[i], 0.5); continue; }
      if (t === MINE) {
        const it = mineItem(i);
        if (!roomFor(i, it, CAPOUT)) { BF[i] = Math.max(BF[i], 0.45); continue; }
        BP[i] += dt * 0.42 * (0.4 + e);
        if (BP[i] >= 1) { BP[i] = 0; INV[i * 5 + it]++; BQ[i] = 1; fx(i, ICOL[it], 6); }
      } else if (t === FAC) {
        const r = RECIPES[BR[i] < 0 ? 0 : BR[i]];
        let ok = true;
        for (let m = 0; m < 5; m++) if (r.need[m] && INV[i * 5 + m] < r.need[m]) { ok = false; BF[i] = Math.max(BF[i], 0.45); break; }
        if (!ok) continue;
        if (!roomFor(i, r.out, CAPOUT)) { BF[i] = Math.max(BF[i], 0.45); continue; }
        BP[i] += dt * (0.42 / r.t) * (0.35 + e);
        if (BP[i] >= 1) {
          BP[i] = 0;
          for (let m = 0; m < 5; m++) if (r.need[m]) INV[i * 5 + m] -= r.need[m];
          INV[i * 5 + r.out]++; BQ[i] = 1; fx(i, ICOL[r.out], 9);
        }
      }
      if (BS[i] > 1.1) { BS[i] = 0; tryShip(i); }
    }
  }
  function fx(i, col, n) {
    _po.color = col; _po.speed = 70; _po.life = 0.4; _po.size = 2.2; _po.kind = 1; _po.grav = 90;
    PT.burst(cx(i), cy(i), n, _po);
    PT.ring(cx(i), cy(i), col, cs * 0.6);
  }

  function moveCargo(dt) {
    CONG.fill(0);
    for (let k = 0; k < MAXC; k++) { const g = CAR[k]; if (g.on) { const ci = ((g.y | 0) * GW + (g.x | 0)); if (ci >= 0 && ci < NC) CONG[ci]++; } }
    for (let k = 0; k < MAXC; k++) {
      const g = CAR[k];
      if (!g.on) continue;
      const ci = ((g.y | 0) * GW + (g.x | 0));
      const jam = ci >= 0 && ci < NC ? CONG[ci] : 0;
      g.t += dt * 2.6 / (1 + jam * 0.45);
      while (g.t >= 1) {
        g.t -= 1; g.pi++;
        if (g.pi >= g.pn - 1) { arrive(g); break; }
      }
      if (!g.on) continue;
      const a = g.path[g.pi], b = g.path[g.pi + 1];
      g.x = lerp(a % GW, b % GW, g.t);
      g.y = lerp((a / GW) | 0, (b / GW) | 0, g.t);
      if (R.chance(0.25)) PT.trail(gx0 + g.x * cs + cs / 2, gy0 + g.y * cs + cs / 2, ICOL[g.item], 1.8);
    }
  }

  /* ---------- 经济 ---------- */
  function economy(dt) {
    S.tick += dt;
    if (S.tick >= 1) {
      S.tick -= 1;
      let m = 0;
      for (let k = 0; k < LIST.length; k++) m += MAINT[BT[LIST[k]]];
      m += S.used * WAGE;
      S.money -= m; S.spent += m;
      if (m > 0 && R.chance(0.4)) PT.text(gx0 + 6, gy0 - 16, '-' + m.toFixed(0) + '/s', '#ff4d5e');
    }
    if (S.money < 0) {
      S.debt += dt;
      if (S.debt >= 10) endRun(false);
    } else S.debt = 0;
    ORD.t += dt;
    if (ORD.t >= ORD.lim) failOrder();
  }
  function market(t) {
    for (let k = 0; k < 5; k++) {
      const base = PR[k];
      const s = Math.sin(t * 0.32 + k * 2.1) * 0.3 + Math.sin(t * 0.87 + k) * 0.12 + NO(t * 0.22 + k * 9) * 0.22;
      PR[k] = Math.max(2, Math.round(base * (1 + clamp(s, -0.55, 0.8)) * 10) / 10);
      if (PR[k] < base * 0.35) PR[k] = base * 0.35;
    }
  }

  /* ---------- 消息 ---------- */
  const MSGS = []; let msgT = 0;
  function say(s) { MSGS.push(s); if (MSGS.length > 3) MSGS.shift(); msgT = 4; }

  /* ---------- DOM ---------- */
  let barEl = null, cardEl = null;
  function mkBtn(label, fn, parent, cls) {
    const b = document.createElement('button');
    b.className = cls || 'btn btn-ghost';
    b.textContent = label;
    b.style.cssText = 'padding:6px 9px;font-size:12px;';
    b.addEventListener('click', () => { A.sfx('click'); ctx.vibrate(PATTERNS.tap); fn(); });
    parent.appendChild(b);
    return b;
  }
  const toolBtns = [];
  function buildBar() {
    barEl = document.createElement('div');
    barEl.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:58px;display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap;background:none;pointer-events:auto;padding:0 8px;';
    ctx.overlay(barEl);
    const tools = [[MINE, '矿场 80'], [FAC, '工厂 130'], [WH, '仓库 60'], [PORT, '港口 110'], [ROAD, '道路 12'], [-1, '拆除']];
    for (let k = 0; k < tools.length; k++) {
      const [t, nm] = tools[k];
      const b = mkBtn(nm, () => { S.tool = (S.tool === t) ? 0 : t; S.sel = -1; syncBar(); syncDetail(); }, barEl);
      toolBtns.push({ b, t });
    }
    mkBtn('雇佣+' + HIRE, () => hire(1), barEl);
    mkBtn('解雇', () => hire(-1), barEl);
    syncBar();
  }
  function syncBar() {
    for (let k = 0; k < toolBtns.length; k++) {
      const o = toolBtns[k];
      const on = S.tool === o.t;
      o.b.style.borderColor = on ? '#22e0ff' : '';
      o.b.style.color = on ? '#22e0ff' : '';
      o.b.style.background = on ? 'rgba(34,224,255,.14)' : '';
      o.b.style.fontWeight = on ? '700' : '';
    }
  }
  function buildCard() {
    cardEl = document.createElement('div');
    cardEl.style.cssText = 'position:absolute;right:6px;top:44px;width:206px;max-height:64%;overflow:auto;display:none;padding:10px 12px;background:rgba(10,14,28,.93);border:1px solid #2b3a63;border-radius:10px;color:#eaf2ff;font-size:12px;z-index:15;pointer-events:auto;';
    ctx.overlay(cardEl, 'overlay-top');
    cardEl.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]'); if (!t) return;
      const act = t.getAttribute('data-act');
      A.sfx('click');
      if (S.sel < 0) return;
      if (act === 'w+') addWorker(S.sel, 1);
      else if (act === 'w-') addWorker(S.sel, -1);
      else if (act === 'rec') cycleRecipe(S.sel);
      else if (act === 'del') { demolish(S.sel); S.sel = -1; }
    });
  }
  function syncDetail() {
    if (!cardEl) return;
    if (S.sel < 0 || !BT[S.sel]) { cardEl.style.display = 'none'; return; }
    const i = S.sel, t = BT[i];
    let h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="color:' + BCOL[t] + '">' + BNAME[t] + '</b><span style="color:#7d8db3">格 ' + (i % GW) + ',' + ((i / GW) | 0) + '</span></div>';
    if (t === MINE) h += '<div style="color:#7d8db3">产出：' + ITEMS[mineItem(i)] + '</div>';
    if (t === FAC) h += '<div>配方：<b style="color:#22e0ff">' + RECIPES[BR[i] < 0 ? 0 : BR[i]].n + '</b> <button class="btn btn-ghost" data-act="rec" style="padding:2px 6px;font-size:11px">切换</button></div>';
    if (WCAP[t]) h += '<div>工人：' + BW[i] + '/' + WCAP[t] + '　效率 ' + Math.round(eff(i) * 100) + '% <button class="btn btn-ghost" data-act="w-" style="padding:2px 6px;font-size:11px">-</button><button class="btn btn-ghost" data-act="w+" style="padding:2px 6px;font-size:11px">+</button></div>';
    let inv = '';
    for (let k = 0; k < 5; k++) {
      const v = INV[i * 5 + k];
      if (v > 0 || IFC[i * 5 + k] > 0) inv += '<span style="color:' + ICOL[k] + '">' + ITEMS[k] + ' ' + v + (IFC[i * 5 + k] ? '(+' + IFC[i * 5 + k] + ')' : '') + '</span>　';
    }
    h += '<div style="margin:6px 0;color:#7d8db3">' + (inv || '库存空') + '</div>';
    if (t === FAC) h += '<div style="color:#7d8db3;font-size:11px">进度 ' + Math.round(BP[i] * 100) + '%</div>';
    if (BF[i] > 0.3) h += '<div style="color:#ff4d5e;font-size:11px">' + (BW[i] <= 0 && t !== WH ? '缺少工人！' : '缺少原料或没有通路！') + '</div>';
    h += '<button class="btn btn-ghost" data-act="del" style="padding:4px 8px;font-size:11px;margin-top:6px">拆除（返还40%）</button>';
    cardEl.innerHTML = h;
    cardEl.style.display = 'block';
  }

  /* ---------- 输入 ---------- */
  function onDown(e) {
    if (S.over) return;
    const r = ctx.canvas.getBoundingClientRect();
    const i = cellAt(e.clientX - r.left, e.clientY - r.top);
    if (i < 0) return;
    if (S.tool === -1) { demolish(i); S.sel = -1; syncDetail(); return; }
    if (S.tool > 0) { tryPlace(i, S.tool); syncDetail(); return; }
    S.sel = BT[i] ? i : -1;
    A.sfx('select');
    syncDetail();
  }

  /* ---------- 更新 ---------- */
  function update(dt) {
    if (S.over) return;
    S.t += dt;
    if (S.hintT > 0) S.hintT -= dt;
    if (msgT > 0) msgT -= dt;
    market(S.t);
    produce(dt);
    moveCargo(dt);
    economy(dt);
    ctx.hud('money', '资金', Math.round(S.money) + (S.debt > 0 ? ' ⚠' : ''), { color: S.money < 0 ? PALETTE.red : PALETTE.amber });
    ctx.hud('order', '订单', ITEMS[ORD.item] + ' ' + ORD.got + '/' + ORD.qty + ' (' + Math.max(0, Math.ceil(ORD.lim - ORD.t)) + 's)', { color: ORD.lim - ORD.t < 12 ? PALETTE.red : PALETTE.cyan });
    ctx.hud('prog', '进度', S.done + '/12');
    ctx.hud('lab', '工人', S.used + '/' + S.labor);
    if ((S.t | 0) % 2 === 0 && S.sel >= 0) syncDetail();
  }

  /* ---------- 渲染 ---------- */
  function drawGround() {
    drawGrid(c, W, H, Math.max(20, cs), 'rgba(27,36,64,.5)', 1, gx0 % cs, gy0 % cs);
    for (let i = 0; i < NC; i++) {
      const x = gx0 + (i % GW) * cs, y = gy0 + ((i / GW) | 0) * cs;
      fillRound(c, x + 1, y + 1, cs - 2, cs - 2, 3, 'rgba(19,28,51,.55)');
      if (RES[i]) {
        const col = RES[i] === 2 ? '#ffb020' : '#8dff4d';
        c.save(); c.globalAlpha = 0.85;
        for (let k = 0; k < 3; k++) {
          const a = i * 2.1 + k * 2.3;
          glowDot(c, x + cs * (0.3 + 0.22 * Math.cos(a)), y + cs * (0.3 + 0.22 * Math.sin(a)), cs * 0.07, col, 0.9);
        }
        c.restore();
        strokeRound(c, x + 1, y + 1, cs - 2, cs - 2, 3, 'rgba(' + (RES[i] === 2 ? '255,176,32' : '141,255,77') + ',.28)', 1);
      }
    }
    strokeRound(c, gx0, gy0, cs * GW, cs * GH, 6, 'rgba(36,51,87,.9)', 1.5);
  }
  function drawRoad(i) {
    const x = gx0 + (i % GW) * cs, y = gy0 + ((i / GW) | 0) * cs, mx = x + cs / 2, my = y + cs / 2;
    fillRound(c, x + 1, y + 1, cs - 2, cs - 2, 3, 'rgba(36,51,87,.75)');
    c.strokeStyle = 'rgba(34,224,255,.35)'; c.lineWidth = Math.max(1.5, cs * 0.08); c.lineCap = 'round';
    const gx = i % GW, gy = (i / GW) | 0;
    let any = false;
    for (let k = 0; k < 4; k++) {
      const nx = gx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = gy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const ni = ny * GW + nx;
      if (!BT[ni]) continue;
      any = true;
      c.beginPath(); c.moveTo(mx, my); c.lineTo(gx0 + nx * cs + cs / 2, gy0 + ny * cs + cs / 2); c.stroke();
    }
    if (!any) { c.beginPath(); c.moveTo(x + cs * 0.3, my); c.lineTo(x + cs * 0.7, my); c.stroke(); }
    if (CONG[i] > 2) glowDot(c, mx, my, cs * 0.12, '#ff4d5e', 0.6 + 0.3 * Math.sin(S.t * 8));
  }
  function drawBuilding(i) {
    const t = BT[i];
    const x = gx0 + (i % GW) * cs, y = gy0 + ((i / GW) | 0) * cs, mx = x + cs / 2, my = y + cs / 2;
    const col = BCOL[t], r = cs * 0.34;
    if (t === PORT) { fillRound(c, x + 2, y + 2, cs - 4, cs - 4, 4, 'rgba(255,176,32,.12)'); }
    else if (t === WH) fillRound(c, x + 2, y + 2, cs - 4, cs - 4, 4, 'rgba(168,85,247,.12)');
    else fillRound(c, x + 2, y + 2, cs - 4, cs - 4, 4, 'rgba(34,224,255,.07)');
    c.save(); c.translate(mx, my);
    c.beginPath();
    if (t === MINE) { c.moveTo(-r, r); c.lineTo(-r * 0.35, -r); c.lineTo(r * 0.35, -r); c.lineTo(r, r); c.closePath(); }
    else if (t === FAC) { c.rect(-r, -r * 0.8, r * 2, r * 1.6); }
    else if (t === WH) { c.moveTo(-r, -r * 0.7); c.lineTo(0, -r); c.lineTo(r, -r * 0.7); c.lineTo(r, r); c.lineTo(-r, r); c.closePath(); }
    else if (t === PORT) { c.moveTo(-r, r); c.lineTo(-r, -r * 0.5); c.lineTo(0, -r); c.lineTo(r, -r * 0.5); c.lineTo(r, r); c.closePath(); }
    c.fillStyle = 'rgba(10,14,28,.8)'; c.fill();
    c.strokeStyle = col; c.lineWidth = 2; c.shadowColor = col; c.shadowBlur = 10; c.stroke();
    c.restore();
    if (t === MINE || t === FAC) {
      const p = clamp01(BP[i]);
      if (p > 0.01) bar(c, x + 3, y + cs - 6, cs - 6, 3, p, { fill: t === MINE ? '#8dff4d' : '#22e0ff', bg: 'rgba(0,0,0,.4)' });
    }
    if (BQ[i] > 0) glowCircle(c, mx, my, r * (1.1 + (1 - BQ[i]) * 1.4), col, { glow: 12, width: 1.5, alpha: BQ[i] * 0.7 });
    if (BF[i] > 0.05) {
      const a = clamp01(BF[i]) * (0.4 + 0.6 * Math.abs(Math.sin(S.t * 6)));
      strokeRound(c, x + 2, y + 2, cs - 4, cs - 4, 4, 'rgba(255,77,94,' + a.toFixed(2) + ')', 2);
    }
    if (WCAP[t]) {
      for (let k = 0; k < WCAP[t]; k++) {
        const px = x + 5 + k * 5, py = y + 5;
        c.fillStyle = k < BW[i] ? '#eaf2ff' : 'rgba(125,141,179,.35)';
        c.fillRect(px, py, 3, 3);
      }
    }
    if (t === FAC) text(c, RECIPES[BR[i] < 0 ? 0 : BR[i]].n, mx, my + r + 7, { size: Math.max(8, cs * 0.3), color: '#22e0ff', alpha: 0.9 });
    if (t === MINE) text(c, ITEMS[mineItem(i)], mx, my + r + 7, { size: Math.max(8, cs * 0.3), color: ICOL[mineItem(i)], alpha: 0.9 });
  }
  function drawCargo() {
    for (let k = 0; k < MAXC; k++) {
      const g = CAR[k];
      if (!g.on) continue;
      const px = gx0 + g.x * cs + cs / 2, py = gy0 + g.y * cs + cs / 2;
      const s = cs * 0.19;
      glowDot(c, px, py, s * 1.6, ICOL[g.item], 0.35);
      fillRound(c, px - s, py - s, s * 2, s * 2, 1.5, ICOL[g.item]);
    }
  }
  function drawTop() {
    const bw = Math.min(W - 20, 340), bx = (W - bw) / 2, by = 8;
    drawPanel(c, bx, by, bw, 34, { fill: 'rgba(10,14,28,.8)', stroke: '#243357' });
    text(c, '订单：' + ORD.qty + '×' + ITEMS[ORD.item], bx + 8, by + 11, { size: 11, color: PALETTE.white, align: 'left' });
    bar(c, bx + 8, by + 20, bw * 0.45, 6, ORD.got / ORD.qty, { fill: PALETTE.lime, bg: 'rgba(255,255,255,.08)' });
    bar(c, bx + bw * 0.5, by + 20, bw * 0.2, 6, ORD.t / ORD.lim, { fill: ORD.lim - ORD.t < 12 ? PALETTE.red : PALETTE.cyan, bg: 'rgba(255,255,255,.08)' });
    text(c, '奖励 ' + ORD.reward, bx + bw - 8, by + 11, { size: 11, color: PALETTE.amber, align: 'right' });
    text(c, '完成 ' + S.done + '/12', bx + bw - 8, by + 25, { size: 11, color: PALETTE.dim, align: 'right' });
    // 市价
    const px0 = 8, py0 = gy0 - 0;
    for (let k = 0; k < 5; k++) text(c, ITEMS[k] + ' ' + PR[k].toFixed(0), px0, 10 + k * 14, { size: 11, color: ICOL[k], align: 'left' });
  }
  function drawMsgs() {
    if (msgT <= 0) return;
    const a = clamp01(msgT);
    for (let k = 0; k < MSGS.length; k++) text(c, MSGS[k], gx0, gy0 + cs * GH + 12 + k * 15, { size: 12, color: PALETTE.white, align: 'left', alpha: a * (k === MSGS.length - 1 ? 1 : 0.5) });
  }
  function drawHint() {
    if (S.hintT <= 0) return;
    text(c, '提示：先在矿脉上建矿场 → 铺道路 → 建工厂/港口，点击已有建筑可查看与调配', W / 2, gy0 + cs * GH + 14, { size: 12, color: PALETTE.dim, alpha: clamp01(S.hintT / 2) });
  }

  function render(alpha, rdt) {
    c.save();
    ctx.shake.apply(c);
    c.fillStyle = PALETTE.bg; c.fillRect(0, 0, W, H);
    drawGround();
    for (let i = 0; i < NC; i++) if (BT[i] === ROAD) drawRoad(i);
    for (let i = 0; i < NC; i++) if (BT[i] && BT[i] !== ROAD) drawBuilding(i);
    drawCargo();
    if (S.sel >= 0 && BT[S.sel]) {
      const x = gx0 + (S.sel % GW) * cs, y = gy0 + ((S.sel / GW) | 0) * cs;
      strokeRound(c, x, y, cs, cs, 4, '#eaf2ff', 2);
    }
    PT.render(c, 1);
    PT.renderTexts(c, rdt);
    c.restore();
    drawTop();
    drawMsgs();
    drawHint();
    if (S.money < 0) {
      const a = 0.25 + 0.25 * Math.sin(S.t * 7);
      c.save(); c.globalAlpha = a; c.fillStyle = '#ff4d5e'; c.fillRect(0, 0, W, H); c.restore();
      text(c, '破产警告 ' + Math.ceil(10 - S.debt) + 's', W / 2, H / 2, { size: 26, color: '#fff', glow: 14 });
    }
    vignette(c, W, H, 0.45);
  }

  /* ---------- 生命周期 ---------- */
  buildBar(); buildCard();
  genMap();
  layout(ctx.W, ctx.H);
  ctx.listen(ctx.canvas, 'pointerdown', onDown);
  ctx.hint(meta.howto[0]);
  newOrder();

  return {
    update, render,
    resize(w, h) { layout(w, h); },
    pause() { },
    resume() { },
    destroy() { barEl?.remove(); cardEl?.remove(); }
  };
}
