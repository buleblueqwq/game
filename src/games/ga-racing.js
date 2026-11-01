// 遗传算法赛车 —— 程序化闭合赛道 + 前馈神经网络驾驶员 + 遗传算法进化
// 关键性能设计：赛道栅格化占用图（射线/碰撞 O(1)）、SoA 种群、基因组单块 Float32Array
import { clamp, lerp, TAU, ease, rgba } from '../core/math.js';
import { PALETTE, neon, glowCircle, roundRect, text, bar, panel, vignette, fillRound, strokeRound, wave } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'ga-racing', title: '遗传算法赛车', category: 'ai', difficulty: 3,
  music: 'chase',
  howto: [
    '赛车全自动驾驶：7 路距离传感器 + 速度 → 神经网络输出转向与油门',
    '每代全部撞毁或超时后自动进化：锦标赛选择 + 交叉 + 高斯变异',
    '加速倍率 1x/2x/4x/16x，可"快进到下一代"',
    '目标：50 代内跑完一整圈；右上角曲线观察适应度进化'
  ],
  particles: 1000
};
export const musicTrack = 'chase';

// ---------- 神经网络拓扑 ----------
const IN = 8, HID = 8, OUT = 2;
const GENE = IN * HID + HID + HID * OUT + OUT;   // 90
const W1 = 0, B1 = IN * HID, W2 = B1 + HID, B2 = W2 + HID * OUT;

const POP = 60;
const SENS = 7;
const SENS_ANG = [-1.31, -0.87, -0.44, 0, 0.44, 0.87, 1.31];
const RANGE = 165;
const MAXV = 380, ACCEL = 420, DRAG = 1.1, TURN = 3.4;

export function create(ctx) {
  const { input, audio, particles, shake, save, rng } = ctx;

  // ---------------- 赛道生成 ----------------
  let M = 0;                       // 中心线点数
  let cxA, cyA, hwA, nxA, nyA;     // 中心线 / 半宽 / 法线
  let oxA, oyA, ixA, iyA;          // 外边界 / 内边界
  let occ = null, GW = 0, GH = 0, OX = 0, OY = 0, CELL = 7;
  let checkpoints = [], boosts = [], startIdx = 0;
  let worldMinX = 0, worldMinY = 0, worldMaxX = 0, worldMaxY = 0;
  let trackLen = 0;

  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  function buildTrack() {
    const n = rng.int(9, 13);
    const R = 640;
    const pts = [], wid = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng.range(-0.22, 0.22);
      const r = R * rng.range(0.44, 1.05);
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      wid.push(rng.range(30, 58));
    }
    // Catmull-Rom 稠密采样
    const dense = [], dw = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const w1 = wid[i], w2 = wid[(i + 1) % n];
      const approx = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const k = clamp(Math.round(approx / 13), 6, 48);
      for (let s = 0; s < k; s++) {
        const t = s / k;
        dense.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
        dw.push(lerp(w1, w2, t));
      }
    }
    M = dense.length;
    cxA = new Float32Array(M); cyA = new Float32Array(M); hwA = new Float32Array(M);
    nxA = new Float32Array(M); nyA = new Float32Array(M);
    oxA = new Float32Array(M); oyA = new Float32Array(M); ixA = new Float32Array(M); iyA = new Float32Array(M);
    for (let i = 0; i < M; i++) {
      cxA[i] = dense[i][0]; cyA[i] = dense[i][1]; hwA[i] = dw[i];
      worldMinX = Math.min(worldMinX || 1e9, dense[i][0]); worldMaxX = Math.max(worldMaxX || -1e9, dense[i][0]);
      worldMinY = Math.min(worldMinY || 1e9, dense[i][1]); worldMaxY = Math.max(worldMaxY || -1e9, dense[i][1]);
    }
    // 平滑半宽
    const sm = new Float32Array(M);
    for (let i = 0; i < M; i++) {
      let s = 0;
      for (let k = -6; k <= 6; k++) s += hwA[(i + k + M) % M];
      sm[i] = s / 13;
    }
    for (let i = 0; i < M; i++) {
      hwA[i] = sm[i];
      const a = cxA[(i + 1) % M] - cxA[(i - 1 + M) % M], b = cyA[(i + 1) % M] - cyA[(i - 1 + M) % M];
      const L = Math.hypot(a, b) || 1;
      const tx = a / L, ty = b / L;
      nxA[i] = -ty; nyA[i] = tx;
      oxA[i] = cxA[i] + nxA[i] * hwA[i]; oyA[i] = cyA[i] + nyA[i] * hwA[i];
      ixA[i] = cxA[i] - nxA[i] * hwA[i]; iyA[i] = cyA[i] - nyA[i] * hwA[i];
    }
    trackLen = 0;
    for (let i = 0; i < M; i++) trackLen += Math.hypot(cxA[(i + 1) % M] - cxA[i], cyA[(i + 1) % M] - cyA[i]);

    // 占用栅格
    const pad = 140;
    OX = worldMinX - pad; OY = worldMinY - pad;
    GW = Math.ceil((worldMaxX + pad - OX) / CELL); GH = Math.ceil((worldMaxY + pad - OY) / CELL);
    occ = new Uint8Array(GW * GH);
    const rr = Math.ceil(110 / CELL);
    for (let i = 0; i < M; i++) {
      const gx = ((cxA[i] - OX) / CELL) | 0, gy = ((cyA[i] - OY) / CELL) | 0;
      const rad = hwA[i] / CELL;
      const r2 = rad * rad;
      const x0 = Math.max(0, gx - rr), x1 = Math.min(GW - 1, gx + rr);
      const y0 = Math.max(0, gy - rr), y1 = Math.min(GH - 1, gy + rr);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x - gx, dy = y - gy;
        if (dx * dx + dy * dy <= r2) occ[y * GW + x] = 1;
      }
    }
    // 检查点 + 加速带
    const cpn = 16;
    checkpoints.length = 0;
    for (let i = 0; i < cpn; i++) checkpoints.push(Math.round(i * M / cpn));
    boosts.length = 0;
    for (let i = 0; i < 5; i++) boosts.push({ i: rng.int(0, M - 1), len: 6 });

    startIdx = 0;
  }

  function onTrack(x, y) {
    const gx = ((x - OX) / CELL) | 0, gy = ((y - OY) / CELL) | 0;
    if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return false;
    return occ[gy * GW + gx] === 1;
  }
  function rayDist(x, y, ang) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let d = 5;
    while (d < RANGE) {
      const gx = ((x + dx * d - OX) / CELL) | 0, gy = ((y + dy * d - OY) / CELL) | 0;
      if (gx < 0 || gy < 0 || gx >= GW || gy >= GH || occ[gy * GW + gx] === 0) return d;
      d += 7;
    }
    return RANGE;
  }
  /** 局部搜索最近中心线点，返回索引；同时给出距离 */
  let nearDist = 0;
  function nearestSeg(x, y, from) {
    let bi = from, bd = 1e18;
    for (let k = -14; k <= 14; k++) {
      const i = (from + k + M) % M;
      const dx = x - cxA[i], dy = y - cyA[i];
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bi = i; }
    }
    nearDist = Math.sqrt(bd);
    // 若局部搜索失败（偏离太大），做一次全局粗搜
    if (nearDist > 260) {
      for (let i = 0; i < M; i += 3) {
        const dx = x - cxA[i], dy = y - cyA[i];
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bi = i; }
      }
      nearDist = Math.sqrt(bd);
    }
    return bi;
  }

  // ---------------- 种群 ----------------
  const gen = new Float32Array(POP * GENE), ngen = new Float32Array(POP * GENE);
  const px = new Float32Array(POP), py = new Float32Array(POP), pa = new Float32Array(POP), pv = new Float32Array(POP);
  const alive = new Uint8Array(POP), segI = new Int32Array(POP);
  const fit = new Float32Array(POP), cpN = new Int32Array(POP), dist = new Float32Array(POP);
  const life = new Float32Array(POP), lastIdx = new Int32Array(POP), lapFlag = new Uint8Array(POP);
  const prog = new Float32Array(POP), posA = new Float32Array(POP);
  const trail = new Float32Array(POP * 24), trailN = new Uint8Array(POP);
  const inp = new Float32Array(IN), hid = new Float32Array(HID);
  const order = new Int32Array(POP);
  const histBest = new Float32Array(400), histAvg = new Float32Array(400);
  let histN = 0;

  const ST = {
    generation: 1, simT: 0, aliveN: POP, paused: false, speed: 2, showAll: true,
    showRays: false, follow: true, camX: 0, camY: 0, zoom: 1,
    mutate: 0.06, amp: 0.35, selMode: 0, crossMode: 0,
    bestFit: 0, avgFit: 0, diversity: 0, leader: 0, fastGen: false,
    t: 0, finished: false, bestGen: 0, crashed: 0
  };
  const MAX_GEN_TIME = 18;

  function randomGenome(off) {
    for (let i = 0; i < GENE; i++) gen[off + i] = rng.gauss() * 0.9;
  }
  function resetPopulation() {
    for (let i = 0; i < POP; i++) randomGenome(i * GENE);
    ST.generation = 1; histN = 0; ST.bestGen = 0;
    histBest.fill(0); histAvg.fill(0);
    spawnCars();
  }

  function spawnCars() {
    ST.simT = 0; ST.aliveN = POP; ST.crashed = 0; ST.bestFit = 0;
    const tx = cxA[(startIdx + 1) % M] - cxA[startIdx], ty = cyA[(startIdx + 1) % M] - cyA[startIdx];
    const ang = Math.atan2(ty, tx);
    for (let i = 0; i < POP; i++) {
      const lane = ((i % 5) - 2) * 15;
      px[i] = cxA[startIdx] + nxA[startIdx] * lane;
      py[i] = cyA[startIdx] + nyA[startIdx] * lane;
      pa[i] = ang; pv[i] = 0;
      alive[i] = 1; segI[i] = startIdx; lastIdx[i] = startIdx;
      fit[i] = 0; cpN[i] = 0; dist[i] = 0; life[i] = 0; lapFlag[i] = 0; prog[i] = 0; posA[i] = 0;
      trailN[i] = 0;
    }
    ST.leader = 0;
    ST.camX = cxA[startIdx]; ST.camY = cyA[startIdx];
  }

  const nnOut = [0, 0];
  function nnForward(off) {
    for (let j = 0; j < HID; j++) {
      let s = gen[off + B1 + j];
      for (let i = 0; i < IN; i++) s += inp[i] * gen[off + W1 + j * IN + i];
      hid[j] = Math.tanh(s);
    }
    let o0 = gen[off + B2], o1 = gen[off + B2 + 1];
    for (let j = 0; j < HID; j++) {
      o0 += hid[j] * gen[off + W2 + j];
      o1 += hid[j] * gen[off + W2 + HID + j];
    }
    nnOut[0] = Math.tanh(o0); nnOut[1] = 1 / (1 + Math.exp(-o1));
  }

  function boostAt(i) {
    for (let k = 0; k < boosts.length; k++) {
      const b = boosts[k];
      let d = i - b.i; if (d < 0) d += M;
      if (d < b.len) return true;
    }
    return false;
  }

  function simStep(dt) {
    ST.simT += dt;
    let bestI = -1, bestF = -1e18;
    for (let i = 0; i < POP; i++) {
      if (!alive[i]) continue;
      life[i] += dt;
      // 传感器
      for (let s = 0; s < SENS; s++) inp[s] = rayDist(px[i], py[i], pa[i] + SENS_ANG[s]) / RANGE;
      inp[SENS] = pv[i] / MAXV;
      nnForward(i * GENE);
      const steer = nnOut[0], thr = nnOut[1];
      const boost = boostAt(segI[i]);
      const maxv = boost ? MAXV * 1.35 : MAXV;
      pv[i] += (thr * ACCEL * (boost ? 1.5 : 1) - DRAG * pv[i]) * dt;
      pv[i] = clamp(pv[i], 0, maxv);
      pa[i] += steer * TURN * clamp(pv[i] / MAXV, 0.15, 1.3) * dt;
      const nx2 = px[i] + Math.cos(pa[i]) * pv[i] * dt, ny2 = py[i] + Math.sin(pa[i]) * pv[i] * dt;
      px[i] = nx2; py[i] = ny2;
      dist[i] += pv[i] * dt;

      const ni = nearestSeg(px[i], py[i], segI[i]);
      segI[i] = ni;
      // 连续弧长进度（处理绕回起点）
      let adv = ni - lastIdx[i];
      if (adv < -M / 2) adv += M; else if (adv > M / 2) adv -= M;
      lastIdx[i] = ni;
      posA[i] += adv;                       // 有符号展开位置（可回退）
      if (posA[i] > prog[i]) prog[i] = posA[i]; // 最远进度，单调
      cpN[i] = clamp(Math.floor(prog[i] / (M / 16)), 0, 16);
      if (prog[i] >= M) lapFlag[i] = 1;

      const off = nearDist - hwA[ni];
      if (off > 2 || !onTrack(px[i], py[i])) { killCar(i); continue; }
      if (life[i] > MAX_GEN_TIME) { killCar(i); continue; }

      const f = cpN[i] * 1000 + dist[i] * 0.7 - life[i] * 3 + (lapFlag[i] ? 6000 : 0);
      fit[i] = f;
      if (f > bestF) { bestF = f; bestI = i; }
      // 轨迹
      const tn = trailN[i] % 12;
      trail[i * 24 + tn * 2] = px[i]; trail[i * 24 + tn * 2 + 1] = py[i];
      trailN[i]++;
    }
    if (bestI >= 0) ST.leader = bestI;
    if (bestF > ST.bestFit) ST.bestFit = bestF;
    ST.aliveN = 0;
    for (let i = 0; i < POP; i++) if (alive[i]) ST.aliveN++;
    if (ST.aliveN === 0 || ST.simT > MAX_GEN_TIME) nextGeneration();
  }

  function killCar(i) {
    if (!alive[i]) return;
    alive[i] = 0;
    ST.crashed++;
    if (ST.crashed < 10 && ctx.settings.reducedFx !== true) {
      particles.explosion(px[i], py[i], 0.55, PALETTE.amber);
    }
  }

  // ---------------- 遗传算法 ----------------
  function computeFitness() {
    let sum = 0, mx = -1e18;
    for (let i = 0; i < POP; i++) {
      if (fit[i] <= -1e17) fit[i] = cpN[i] * 1000 + dist[i] * 0.7 - life[i] * 3 + (lapFlag[i] ? 6000 : 0);
      sum += fit[i]; if (fit[i] > mx) mx = fit[i];
    }
    ST.avgFit = sum / POP; ST.bestFit = mx;
  }

  function pickTournament() {
    let bi = rng.int(0, POP - 1);
    for (let k = 0; k < 4; k++) {
      const j = rng.int(0, POP - 1);
      if (fit[j] > fit[bi]) bi = j;
    }
    return bi;
  }
  let wheelAcc = null;
  function pickRoulette() {
    if (!wheelAcc) wheelAcc = new Float32Array(POP);
    let mn = Infinity;
    for (let i = 0; i < POP; i++) mn = Math.min(mn, fit[i]);
    let s = 0;
    for (let i = 0; i < POP; i++) { s += fit[i] - mn + 1; wheelAcc[i] = s; }
    const r = rng() * s;
    for (let i = 0; i < POP; i++) if (r <= wheelAcc[i]) return i;
    return POP - 1;
  }
  const pickParent = () => (ST.selMode === 0 ? pickTournament() : pickRoulette());

  function computeDiversity() {
    let s = 0, n = 0;
    for (let k = 0; k < 14; k++) {
      const a = rng.int(0, POP - 1) * GENE, b = rng.int(0, POP - 1) * GENE;
      let d = 0;
      for (let i = 0; i < GENE; i += 3) d += Math.abs(gen[a + i] - gen[b + i]);
      s += d / (GENE / 3); n++;
    }
    ST.diversity = s / n;
  }

  function evolve() {
    computeFitness();
    computeDiversity();
    // 排序（降序）
    for (let i = 0; i < POP; i++) order[i] = i;
    for (let i = 1; i < POP; i++) {
      const v = order[i], fv = fit[v];
      let j = i - 1;
      while (j >= 0 && fit[order[j]] < fv) { order[j + 1] = order[j]; j--; }
      order[j + 1] = v;
    }
    const E = Math.max(2, Math.round(POP * 0.05));
    for (let e = 0; e < E; e++) {
      const src = order[e] * GENE, dst = e * GENE;
      for (let i = 0; i < GENE; i++) ngen[dst + i] = gen[src + i];
    }
    for (let k = E; k < POP; k++) {
      const a = pickParent() * GENE, b = pickParent() * GENE, dst = k * GENE;
      if (ST.crossMode === 0) {
        for (let i = 0; i < GENE; i++) ngen[dst + i] = rng.chance(0.5) ? gen[a + i] : gen[b + i];
      } else {
        const cut = rng.int(1, GENE - 2);
        for (let i = 0; i < cut; i++) ngen[dst + i] = gen[a + i];
        for (let i = cut; i < GENE; i++) ngen[dst + i] = gen[b + i];
      }
      for (let i = 0; i < GENE; i++) {
        if (rng.chance(ST.mutate)) ngen[dst + i] += rng.gauss() * ST.amp;
        ngen[dst + i] = clamp(ngen[dst + i], -5, 5);
      }
    }
    gen.set(ngen);
  }

  function nextGeneration() {
    // 记录历史
    computeFitness();
    if (histN < histBest.length) { histBest[histN] = ST.bestFit; histAvg[histN] = ST.avgFit; histN++; }
    let lapDone = false;
    for (let i = 0; i < POP; i++) if (lapFlag[i]) lapDone = true;
    if (lapDone && !ST.bestGen) ST.bestGen = ST.generation;
    audio.sfx('swap'); ctx.vibrate(PATTERNS.select);
    if (lapDone) {
      ST.finished = true;
      ctx.finish(ST.generation, {
        win: true, higherBetter: false,
        stats: [['完成代数', ST.generation], ['最佳适应度', ST.bestFit.toFixed(0)], ['存活', ST.aliveN + '/' + POP]]
      });
      return;
    }
    if (ST.generation >= 50) {
      ST.finished = true;
      ctx.finish(999, {
        win: false, higherBetter: false,
        stats: [['代数', ST.generation], ['最佳适应度', ST.bestFit.toFixed(0)], ['最佳检查点', Math.round(ST.bestFit / 1000)]]
      });
      return;
    }
    evolve();
    ST.generation++;
    ST.fastGen = false;
    spawnCars();
    hudUpdate();
  }

  function hudUpdate() {
    ctx.hud('gen', '代数', ST.generation + '/50');
    ctx.hud('alive', '存活', ST.aliveN);
    ctx.hud('fit', '最佳适应度', ST.bestFit.toFixed(0), { color: PALETTE.lime });
    ctx.hud('div', '基因多样性', ST.diversity.toFixed(2));
  }

  // ---------------- 控件 ----------------
  let ctrl = null, bottomPad = 66;
  function mkBtn(label, fn, cls) {
    const b = document.createElement('button');
    b.className = 'btn ' + (cls || 'btn-ghost');
    b.textContent = label;
    b.style.cssText = 'padding:6px 9px;font-size:12px;line-height:1.1';
    ctx.listen(b, 'click', (e) => { e.preventDefault(); audio.sfx('click'); ctx.vibrate(PATTERNS.tap); fn(b); });
    return b;
  }
  function mkSlider(label, min, max, val, step, fn) {
    const l = document.createElement('label');
    l.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:#7d8db3';
    const s = document.createElement('span'); s.textContent = label;
    const r = document.createElement('input');
    r.type = 'range'; r.className = 'range'; r.style.width = '80px';
    r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(val);
    ctx.listen(r, 'input', () => fn(+r.value));
    l.appendChild(s); l.appendChild(r);
    return l;
  }
  function buildControls() {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center;align-items:center';
    el.appendChild(mkBtn('暂停', (b) => { ST.paused = !ST.paused; b.textContent = ST.paused ? '继续' : '暂停'; }));
    el.appendChild(mkBtn('速度2x', (b) => { ST.speed = ST.speed === 1 ? 2 : ST.speed === 2 ? 4 : ST.speed === 4 ? 16 : 1; b.textContent = '速度' + ST.speed + 'x'; }));
    el.appendChild(mkBtn('快进一代', () => { ST.fastGen = true; ST.paused = false; }));
    el.appendChild(mkBtn('重置种群', () => { resetPopulation(); hudUpdate(); audio.sfx('back'); }));
    el.appendChild(mkBtn('全部车:开', (b) => { ST.showAll = !ST.showAll; b.textContent = '全部车:' + (ST.showAll ? '开' : '关'); }));
    el.appendChild(mkBtn('射线:关', (b) => { ST.showRays = !ST.showRays; b.textContent = '射线:' + (ST.showRays ? '开' : '关'); }));
    el.appendChild(mkBtn('选择:锦标赛', (b) => { ST.selMode = ST.selMode ? 0 : 1; b.textContent = '选择:' + (ST.selMode ? '轮盘赌' : '锦标赛'); }));
    el.appendChild(mkBtn('交叉:均匀', (b) => { ST.crossMode = ST.crossMode ? 0 : 1; b.textContent = '交叉:' + (ST.crossMode ? '单点' : '均匀'); }));
    el.appendChild(mkSlider('变异率', 0.5, 20, 6, 0.5, (v) => { ST.mutate = v / 100; }));
    el.appendChild(mkSlider('变异幅', 5, 80, 35, 1, (v) => { ST.amp = v / 100; }));
    ctx.overlay(el, 'overlay-bottom');
    ctrl = el;
  }

  // ---------------- 布局 ----------------
  let VW = 0, VH = 0;
  function layout(w, h) {
    bottomPad = (ctrl && ctrl.offsetHeight ? ctrl.offsetHeight : 62) + 12;
    VW = w; VH = h - bottomPad;
    ST.zoom = clamp(Math.min(VW, VH) / 900, 0.45, 1.4);
  }

  // ---------------- 更新 ----------------
  let dragX = 0, dragY = 0, dragging = false;
  function update(dt) {
    ST.t += dt;
    const p = input.pointer;
    if (p.justDown && p.y < VH) { dragging = true; dragX = p.x; dragY = p.y; }
    if (p.down && dragging) {
      if (Math.abs(p.x - dragX) + Math.abs(p.y - dragY) > 3) ST.follow = false;
      ST.camX -= (p.x - dragX) / ST.zoom; ST.camY -= (p.y - dragY) / ST.zoom;
      dragX = p.x; dragY = p.y;
    }
    if (p.justUp) dragging = false;
    if (input.justPressed('confirm') || input.justPressed('jump')) ST.follow = true;

    if (ST.finished || ST.paused) return;
    const sub = ST.fastGen ? 24 : ST.speed;
    for (let k = 0; k < sub; k++) {
      if (ST.finished) break;
      simStep(1 / 60);
      if (ST.fastGen && ST.simT === 0) break;
    }
    if (ST.follow) {
      const L = ST.leader;
      const tx = px[L], ty = py[L];
      ST.camX = lerp(ST.camX, tx, 1 - Math.exp(-6 * dt));
      ST.camY = lerp(ST.camY, ty, 1 - Math.exp(-6 * dt));
    }
    if (((ST.t * 4) | 0) !== ((ST.t * 4 - dt * 4) | 0)) hudUpdate();
  }

  // ---------------- 渲染 ----------------
  function drawTrack(c) {
    // 路面
    c.beginPath();
    c.moveTo(oxA[0], oyA[0]);
    for (let i = 1; i < M; i++) c.lineTo(oxA[i], oyA[i]);
    c.closePath();
    c.fillStyle = 'rgba(18,26,48,0.95)';
    c.fill();
    c.beginPath();
    c.moveTo(ixA[0], iyA[0]);
    for (let i = 1; i < M; i++) c.lineTo(ixA[i], iyA[i]);
    c.closePath();
    c.fillStyle = PALETTE.bg;
    c.fill();
    // 内外霓虹边线
    c.save();
    c.strokeStyle = 'rgba(34,224,255,0.55)'; c.lineWidth = 2.5;
    c.shadowColor = PALETTE.cyan; c.shadowBlur = 10;
    c.beginPath(); c.moveTo(oxA[0], oyA[0]);
    for (let i = 1; i < M; i++) c.lineTo(oxA[i], oyA[i]);
    c.closePath(); c.stroke();
    c.strokeStyle = 'rgba(255,46,136,0.45)';
    c.shadowColor = PALETTE.magenta;
    c.beginPath(); c.moveTo(ixA[0], iyA[0]);
    for (let i = 1; i < M; i++) c.lineTo(ixA[i], iyA[i]);
    c.closePath(); c.stroke();
    c.restore();
    // 起点线
    const s0 = startIdx;
    c.save();
    c.strokeStyle = '#ffffff'; c.lineWidth = 4; c.shadowColor = '#fff'; c.shadowBlur = 12;
    c.beginPath(); c.moveTo(oxA[s0], oyA[s0]); c.lineTo(ixA[s0], iyA[s0]); c.stroke();
    c.restore();
    // 检查点
    for (let k = 0; k < checkpoints.length; k++) {
      const i = checkpoints[k];
      c.strokeStyle = 'rgba(141,255,77,0.25)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(oxA[i], oyA[i]); c.lineTo(ixA[i], iyA[i]); c.stroke();
    }
    // 加速带
    const pulse = 0.5 + 0.5 * Math.sin(ST.t * 6);
    for (let k = 0; k < boosts.length; k++) {
      const b = boosts[k];
      c.strokeStyle = `rgba(255,176,32,${0.35 + pulse * 0.4})`;
      c.lineWidth = 10;
      c.beginPath();
      for (let s = 0; s < b.len; s++) {
        const i = (b.i + s) % M;
        s ? c.lineTo(cxA[i], cyA[i]) : c.moveTo(cxA[i], cyA[i]);
      }
      c.stroke();
    }
  }

  function drawCar(c, i, leader) {
    const X = px[i], Y = py[i];
    const col = leader ? PALETTE.amber : (lapFlag[i] ? PALETTE.lime : PALETTE.cyan);
    // 轨迹
    const n = Math.min(12, trailN[i]);
    if (n > 1) {
      c.strokeStyle = leader ? 'rgba(255,176,32,0.55)' : 'rgba(34,224,255,0.18)';
      c.lineWidth = leader ? 2 : 1;
      c.beginPath();
      let started = false;
      for (let k = 0; k < n; k++) {
        const idx = (trailN[i] - n + k) % 12;
        const x = trail[i * 24 + idx * 2], y = trail[i * 24 + idx * 2 + 1];
        if (!x && !y) continue;
        started ? c.lineTo(x, y) : (c.moveTo(x, y), started = true);
      }
      c.stroke();
    }
    if (!alive[i]) return;
    c.save();
    c.translate(X, Y); c.rotate(pa[i]);
    const s = leader ? 11 : 8;
    if (leader) { c.shadowColor = col; c.shadowBlur = 16; }
    c.globalAlpha = leader ? 1 : (ST.showAll ? 0.42 : 0.12);
    c.fillStyle = col;
    c.beginPath(); c.moveTo(s, 0); c.lineTo(-s * 0.7, s * 0.62); c.lineTo(-s * 0.7, -s * 0.62); c.closePath(); c.fill();
    c.restore();
    c.globalAlpha = 1;
  }

  function drawRays(c, i) {
    if (!alive[i]) return;
    for (let s = 0; s < SENS; s++) {
      const d = rayDist(px[i], py[i], pa[i] + SENS_ANG[s]);
      c.strokeStyle = 'rgba(255,176,32,0.45)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(px[i], py[i]);
      c.lineTo(px[i] + Math.cos(pa[i] + SENS_ANG[s]) * d, py[i] + Math.sin(pa[i] + SENS_ANG[s]) * d);
      c.stroke();
    }
  }

  function drawChart(c, W) {
    const w = Math.min(260, W * 0.30), h = 108;
    const x = W - w - 10, y = 10;
    panel(c, x, y, w, h, { fill: 'rgba(8,12,24,0.88)', stroke: '#243357' });
    text(c, '适应度进化', x + 8, y + 13, { size: 11, color: PALETTE.cyan, align: 'left', weight: 800 });
    if (histN < 2) { text(c, '采集中…', x + w / 2, y + h / 2 + 8, { size: 11, color: PALETTE.dim }); return; }
    let mx = -1e18, mn = 1e18;
    for (let i = 0; i < histN; i++) { mx = Math.max(mx, histBest[i]); mn = Math.min(mn, histAvg[i]); }
    if (mx - mn < 1) mx = mn + 1;
    const px2 = (i) => x + 8 + (i / Math.max(1, histN - 1)) * (w - 16);
    const py2 = (v) => y + h - 22 - ((v - mn) / (mx - mn)) * (h - 34);
    // 网格
    c.strokeStyle = 'rgba(60,80,130,0.25)'; c.lineWidth = 1;
    c.beginPath(); for (let k = 0; k <= 3; k++) { const yy = y + 22 + k * (h - 40) / 3; c.moveTo(x + 6, yy); c.lineTo(x + w - 6, yy); } c.stroke();
    // 平均
    c.strokeStyle = 'rgba(125,141,179,0.8)'; c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i < histN; i++) { const X2 = px2(i), Y2 = py2(histAvg[i]); i ? c.lineTo(X2, Y2) : c.moveTo(X2, Y2); }
    c.stroke();
    // 最佳
    c.save(); c.shadowColor = PALETTE.lime; c.shadowBlur = 8;
    c.strokeStyle = PALETTE.lime; c.lineWidth = 2; c.beginPath();
    for (let i = 0; i < histN; i++) { const X2 = px2(i), Y2 = py2(histBest[i]); i ? c.lineTo(X2, Y2) : c.moveTo(X2, Y2); }
    c.stroke(); c.restore();
    text(c, '最佳 ' + ST.bestFit.toFixed(0), x + w - 8, y + 13, { size: 10, color: PALETTE.lime, align: 'right' });
    text(c, 'G' + ST.generation, x + 8, y + h - 8, { size: 10, color: PALETTE.dim, align: 'left' });
  }

  function drawMinimap(c, W, H) {
    const w = 150, x = W - w - 10, y = 128;
    const sx = w / (worldMaxX - worldMinX), sy = w / (worldMaxY - worldMinY);
    const s = Math.min(sx, sy) * 0.92;
    panel(c, x, y, w, w, { fill: 'rgba(8,12,24,0.88)', stroke: '#243357' });
    c.save();
    c.translate(x + w / 2, y + w / 2); c.scale(s, s);
    c.translate(-(worldMinX + worldMaxX) / 2, -(worldMinY + worldMaxY) / 2);
    c.strokeStyle = 'rgba(34,224,255,0.7)'; c.lineWidth = 3 / s; c.beginPath();
    for (let i = 0; i < M; i += 2) { const X2 = cxA[i], Y2 = cyA[i]; i ? c.lineTo(X2, Y2) : c.moveTo(X2, Y2); }
    c.closePath(); c.stroke();
    for (let i = 0; i < POP; i++) {
      if (!alive[i]) continue;
      c.fillStyle = i === ST.leader ? PALETTE.amber : 'rgba(34,224,255,0.7)';
      const r = (i === ST.leader ? 9 : 5) / s;
      c.beginPath(); c.arc(px[i], py[i], r, 0, TAU); c.fill();
    }
    c.restore();
  }

  function render(alpha, rdt) {
    const c = ctx.ctx, W = ctx.W, H = ctx.H;
    c.fillStyle = PALETTE.bg; c.fillRect(0, 0, W, H);
    c.save();
    c.beginPath(); c.rect(0, 0, W, VH); c.clip();
    // 星空/网格底
    c.strokeStyle = 'rgba(40,60,110,0.12)'; c.lineWidth = 1; c.beginPath();
    const g = 60;
    const ox2 = -(ST.camX * ST.zoom) % g, oy2 = -(ST.camY * ST.zoom) % g;
    for (let x = ox2; x < W; x += g) { c.moveTo(x, 0); c.lineTo(x, VH); }
    for (let y = oy2; y < VH; y += g) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    c.translate(W / 2, VH / 2); c.scale(ST.zoom, ST.zoom); c.translate(-ST.camX, -ST.camY);
    drawTrack(c);
    if (!ST.showAll) {
      drawCar(c, ST.leader, true);
    } else {
      for (let i = 0; i < POP; i++) if (i !== ST.leader) drawCar(c, i, false);
      drawCar(c, ST.leader, true);
    }
    if (ST.showRays) drawRays(c, ST.leader);
    c.restore();

    particles.render(c, 1);
    particles.renderTexts(c, rdt);
    drawChart(c, W);
    drawMinimap(c, W, H);
    // 底部状态
    text(c, `存活 ${ST.aliveN}/${POP} · 多样性 ${ST.diversity.toFixed(2)} · 变异 ${(ST.mutate * 100).toFixed(1)}% · ${ST.follow ? '跟随中' : '自由视角（点确认键复位）'}`,
      10, VH - 12, { size: 11, color: PALETTE.dim, align: 'left' });
    if (ST.paused) text(c, '已暂停', W / 2, VH / 2, { size: 26, color: PALETTE.amber, weight: 900, glow: 16 });
    vignette(c, W, VH, 0.35);
  }

  function resize(w, h) { layout(w, h); }

  buildControls();
  buildTrack();
  layout(ctx.W, ctx.H);
  resetPopulation();
  hudUpdate();
  ctx.hint('神经网络驾驶员正在进化…用 16x 或"快进一代"加速', 5200);

  return { update, render, resize, destroy() { } };
}
