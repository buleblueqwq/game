// AI 棋类对战 —— 五子棋(15×15) + 黑白棋(8×8)，Minimax + Alpha-Beta 剪枝，可调深度 / 观战模式
// 五子棋：线扫描增量评估 + 候选点剪枝 + 迭代加深（节点上限 + 时间预算）
// 黑白棋：位序权重 / 角点 / 行动力 / 稳定子 评估，终局精确求解
import { clamp, lerp, TAU, ease, rgba } from '../core/math.js';
import { PALETTE, neon, glowCircle, roundRect, text, bar, panel, vignette, fillRound, strokeRound } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'ai-board', title: 'AI 棋类对战', category: 'ai', difficulty: 4,
  music: 'menu',
  howto: [
    '点击棋盘落子，顶部标签切换 五子棋 / 黑白棋',
    '滑块调节 AI 搜索深度（1~6），观察节点数与剪枝次数',
    '可切换先手与"AI 对战 AI"观战模式',
    '五子棋黑棋可开启禁手（双三 / 双四判负）'
  ],
  particles: 900
};
export const musicTrack = 'menu';

// ================= 五子棋静态表 =================
const G = 15, GN = G * G;
const DX = [1, 0, 1, 1], DY = [0, 1, 1, -1];
const LINES = [];
const CL_IDX = new Int32Array(GN * 4).fill(-1);
const CL_POS = new Int32Array(GN * 4);
const CL_CNT = new Uint8Array(GN);
const POS_W = new Int8Array(GN);
(function buildLines() {
  const add = (cells) => {
    if (cells.length < 5) return;
    const li = LINES.length;
    LINES.push(Int32Array.from(cells));
    for (let p = 0; p < cells.length; p++) {
      const c = cells[p], k = c * 4 + CL_CNT[c]++;
      CL_IDX[k] = li; CL_POS[k] = p;
    }
  };
  for (let y = 0; y < G; y++) { const r = []; for (let x = 0; x < G; x++) r.push(y * G + x); add(r); }
  for (let x = 0; x < G; x++) { const r = []; for (let y = 0; y < G; y++) r.push(y * G + x); add(r); }
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    if (x === 0 || y === 0) { const r = []; let a = x, b = y; while (a < G && b < G) { r.push(b * G + a); a++; b++; } add(r); }
    if (x === 0 || y === G - 1) { const r = []; let a = x, b = y; while (a < G && b >= 0) { r.push(b * G + a); a++; b--; } add(r); }
  }
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const d = Math.max(Math.abs(x - 7), Math.abs(y - 7));
    POS_W[y * G + x] = 7 - d;
  }
})();

const FIVE = 1e6;
const WIN = 1e6;
const INF = 1e9;
function runScore(len, open) {
  if (len >= 5) return FIVE;
  if (open === 0) return 0;
  if (len === 4) return open === 2 ? 20000 : 2000;
  if (len === 3) return open === 2 ? 4000 : 400;
  if (len === 2) return open === 2 ? 500 : 60;
  return open === 2 ? 40 : 6;
}

// ================= 黑白棋静态表 =================
const O = 8, ON = 64;
const ODX = [1, -1, 0, 0, 1, 1, -1, -1], ODY = [0, 0, 1, -1, 1, -1, 1, -1];
const CORNERS = [0, 7, 56, 63];
const CDIRS = [[[1, 0], [0, 1]], [[-1, 0], [0, 1]], [[1, 0], [0, -1]], [[-1, 0], [0, -1]]];
const RAYS = new Array(ON * 8);
const OPOS = new Int16Array(ON);
(function buildRays() {
  const corner = [0, 7, 56, 63];
  const XSET = [9, 14, 49, 54];
  const CSET = [1, 8, 6, 15, 48, 57, 55, 62];
  for (let c = 0; c < ON; c++) {
    const x = c % O, y = (c / O) | 0;
    let v = 2;
    if (corner.includes(c)) v = 120;
    else if (XSET.includes(c)) v = -30;
    else if (CSET.includes(c)) v = -12;
    else if (x === 0 || y === 0 || x === O - 1 || y === O - 1) v = 6;
    else if (x === 1 || y === 1 || x === O - 2 || y === O - 2) v = 1;
    OPOS[c] = v;
    for (let d = 0; d < 8; d++) {
      const r = [];
      let a = x + ODX[d], b = y + ODY[d];
      while (a >= 0 && a < O && b >= 0 && b < O) { r.push(b * O + a); a += ODX[d]; b += ODY[d]; }
      RAYS[c * 8 + d] = r.length ? Int32Array.from(r) : null;
    }
  }
})();

export function create(ctx) {
  const { input, audio, particles, shake, save, rng } = ctx;

  // ---------------- 全局状态 ----------------
  const S = {
    game: 'gomoku',           // 'gomoku' | 'othello'
    depth: 4,
    playerFirst: true,
    autoAI: false,
    forbid: false,
    thinking: false, thinkT: 0,
    over: false, result: 0,   // 0 进行中 1 玩家胜 2 AI胜 3 平
    t: 0, animT: 0, msgT: 0,
    streak: save.get('streak', 0),
    best: save.get('bestStreak', 0),
    wins: save.get('wins', 0), losses: save.get('losses', 0),
    nodes: 0, prunes: 0, ms: 0, score: 0, usedDepth: 0,
    lastMove: -1, winLine: null, msg: '', finished: false
  };

  // ---------------- 五子棋 ----------------
  const gb = new Int8Array(GN);
  const near = new Uint8Array(GN);
  let totB = 0, totW = 0, posB = 0, posW = 0;
  let lastFive = false;
  const tmp = new Float32Array(2);

  function evalLine(li) {
    const cells = LINES[li], L = cells.length;
    let sb = 0, sw = 0, i = 0;
    while (i < L) {
      const v = gb[cells[i]];
      if (!v) { i++; continue; }
      let j = i;
      while (j < L && gb[cells[j]] === v) j++;
      const s = runScore(j - i, (i > 0 && gb[cells[i - 1]] === 0 ? 1 : 0) + (j < L && gb[cells[j]] === 0 ? 1 : 0));
      if (v === 1) sb += s; else sw += s;
      i = j;
    }
    tmp[0] = sb; tmp[1] = sw;
  }

  function placeG(c, p) {
    const n = CL_CNT[c];
    for (let k = 0; k < n; k++) { evalLine(CL_IDX[c * 4 + k]); totB -= tmp[0]; totW -= tmp[1]; }
    gb[c] = p;
    for (let k = 0; k < n; k++) { evalLine(CL_IDX[c * 4 + k]); totB += tmp[0]; totW += tmp[1]; }
    if (p === 1) posB += POS_W[c]; else posW += POS_W[c];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = c % G + dx, y = ((c / G) | 0) + dy;
      if (x >= 0 && x < G && y >= 0 && y < G) near[y * G + x] = 1;
    }
    lastFive = isFive(c, p);
  }
  function undoG(c, p) {
    const n = CL_CNT[c];
    for (let k = 0; k < n; k++) { evalLine(CL_IDX[c * 4 + k]); totB -= tmp[0]; totW -= tmp[1]; }
    gb[c] = 0;
    for (let k = 0; k < n; k++) { evalLine(CL_IDX[c * 4 + k]); totB += tmp[0]; totW += tmp[1]; }
    if (p === 1) posB -= POS_W[c]; else posW -= POS_W[c];
    lastFive = false;
  }
  function isFive(c, p) {
    const x = c % G, y = (c / G) | 0;
    for (let d = 0; d < 4; d++) {
      let n = 1;
      for (let s = 1; s < 5; s++) { const a = x + DX[d] * s, b = y + DY[d] * s; if (a < 0 || a >= G || b < 0 || b >= G || gb[b * G + a] !== p) break; n++; }
      for (let s = 1; s < 5; s++) { const a = x - DX[d] * s, b = y - DY[d] * s; if (a < 0 || a >= G || b < 0 || b >= G || gb[b * G + a] !== p) break; n++; }
      if (n >= 5) return true;
    }
    return false;
  }
  function evalG(p) {
    const mine = p === 1 ? totB + posB * 2 : totW + posW * 2;
    const opp = p === 1 ? totW + posW * 2 : totB + posB * 2;
    return mine - opp * 1.15;
  }
  function recomputeTotals() {
    totB = 0; totW = 0; posB = 0; posW = 0;
    for (let li = 0; li < LINES.length; li++) { evalLine(li); totB += tmp[0]; totW += tmp[1]; }
    for (let c = 0; c < GN; c++) if (gb[c] === 1) posB += POS_W[c]; else if (gb[c] === 2) posW += POS_W[c];
  }
  function recomputeNear() {
    near.fill(0);
    for (let c = 0; c < GN; c++) {
      if (!gb[c]) continue;
      const x = c % G, y = (c / G) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const a = x + dx, b = y + dy;
        if (a >= 0 && a < G && b >= 0 && b < G) near[b * G + a] = 1;
      }
    }
  }

  /** 局部窗口价值：假设在 (li,pos) 处放 p */
  function lineWin(li, pos, p) {
    const cells = LINES[li], L = cells.length;
    let left = 0, i = pos - 1;
    while (i >= 0 && left < 4 && gb[cells[i]] === p) { left++; i--; }
    const openL = i >= 0 && gb[cells[i]] === 0 ? 1 : 0;
    let right = 0; i = pos + 1;
    while (i < L && right < 4 && gb[cells[i]] === p) { right++; i++; }
    const openR = i < L && gb[cells[i]] === 0 ? 1 : 0;
    return runScore(1 + left + right, openL + openR);
  }

  // 搜索缓冲
  const candC = [], candS = [];
  for (let d = 0; d < 10; d++) { candC.push(new Int32Array(GN)); candS.push(new Float32Array(GN)); }
  let nodes = 0, prunes = 0, aborted = false, deadline = 0, nodeCap = 200000;
  let rootDepth = 1, rootBest = -1;

  function genMoves(p, d) {
    const cells = candC[d], sc = candS[d], op = 3 - p;
    let cnt = 0;
    for (let c = 0; c < GN; c++) {
      if (gb[c] || !near[c]) continue;
      const n = CL_CNT[c];
      let s = POS_W[c] * 0.6;
      for (let k = 0; k < n; k++) {
        const li = CL_IDX[c * 4 + k], pos = CL_POS[c * 4 + k];
        s += lineWin(li, pos, p) + lineWin(li, pos, op) * 0.85;
      }
      cells[cnt] = c; sc[cnt] = s; cnt++;
    }
    const K = d >= 5 ? 14 : d >= 3 ? 12 : 10;
    const lim = Math.min(K, cnt);
    for (let i = 0; i < lim; i++) {
      let bi = i;
      for (let j = i + 1; j < cnt; j++) if (sc[j] > sc[bi]) bi = j;
      if (bi !== i) {
        const tc = cells[i]; cells[i] = cells[bi]; cells[bi] = tc;
        const ts = sc[i]; sc[i] = sc[bi]; sc[bi] = ts;
      }
    }
    return lim;
  }

  function negamax(depth, alpha, beta, p) {
    nodes++;
    if ((nodes & 255) === 0 && performance.now() > deadline) { aborted = true; return 0; }
    if (nodes > nodeCap) { aborted = true; return 0; }
    if (lastFive) return -(WIN + depth);
    if (depth <= 0) return evalG(p);
    const d = depth > 9 ? 9 : depth;
    const cnt = genMoves(p, d);
    if (cnt === 0) return evalG(p);
    let best = -INF;
    for (let i = 0; i < cnt; i++) {
      const m = candC[d][i];
      placeG(m, p);
      const v = -negamax(depth - 1, -beta, -alpha, 3 - p);
      undoG(m, p);
      if (aborted) return best === -INF ? 0 : best;
      if (v > best) { best = v; if (depth === rootDepth) rootBest = m; }
      if (best > alpha) alpha = best;
      if (alpha >= beta) { prunes++; break; }
    }
    return best;
  }

  /** 禁手：黑棋双三 / 双四 / 长连 */
  function isForbidden(c) {
    gb[c] = 1;
    let threes = 0, fours = 0, long = false;
    for (let k = 0; k < CL_CNT[c]; k++) {
      const li = CL_IDX[c * 4 + k], pos = CL_POS[c * 4 + k], cells = LINES[li], L = cells.length;
      let l = 0, i = pos - 1;
      while (i >= 0 && gb[cells[i]] === 1) { l++; i--; }
      const ol = i >= 0 && gb[cells[i]] === 0 ? 1 : 0;
      let r = 0; i = pos + 1;
      while (i < L && gb[cells[i]] === 1) { r++; i++; }
      const or2 = i < L && gb[cells[i]] === 0 ? 1 : 0;
      const len = 1 + l + r, open = ol + or2;
      if (len > 5) long = true;
      else if (len === 5) { if (!long) fours += 2; }
      else if (len === 4 && open >= 1) fours++;
      else if (len === 3 && open === 2) threes++;
    }
    gb[c] = 0;
    return long || threes >= 2 || fours >= 2;
  }

  function thinkGomoku(p) {
    recomputeNear();
    nodes = 0; prunes = 0; aborted = false;
    nodeCap = ctx.caps.mobile ? 90000 : 260000;
    deadline = performance.now() + (ctx.caps.mobile ? 480 : 900);
    const t0 = performance.now();
    let best = -1, got = 0;
    for (let d = 1; d <= S.depth; d++) {
      rootDepth = d; rootBest = -1; aborted = false;
      const v = negamax(d, -INF, INF, p);
      if (aborted || rootBest < 0) break;
      best = rootBest; got = d; S.score = v;
      if (Math.abs(v) > WIN * 0.9) break;
    }
    S.ms = performance.now() - t0;
    S.nodes = nodes; S.prunes = prunes; S.usedDepth = got;
    if (best < 0 || gb[best]) {
      for (let c = 0; c < GN; c++) if (!gb[c] && near[c]) { best = c; break; }
      if (best < 0 || gb[best]) best = GN >> 1;
    }
    return best;
  }

  // ---------------- 黑白棋 ----------------
  const ob = new Int8Array(ON);
  const SZ = Math.max(GN, ON);
  const flipT = new Float32Array(SZ), flipFrom = new Int8Array(SZ), spawnT = new Float32Array(SZ);
  const undoStack = new Int32Array(64 * 24);
  const mvBuf = new Int32Array(64 * 64), mvScore = new Float32Array(64 * 64), mvFlips = new Int32Array(64 * 64);

  function resetOthello() {
    ob.fill(0);
    ob[27] = 2; ob[28] = 1; ob[35] = 1; ob[36] = 2;
    flipT.fill(0); flipFrom.fill(0); spawnT.fill(0);
  }

  function hasMoveO(p) {
    const op = 3 - p;
    for (let c = 0; c < ON; c++) {
      if (ob[c]) continue;
      for (let d = 0; d < 8; d++) {
        const ray = RAYS[c * 8 + d];
        if (!ray || ob[ray[0]] !== op) continue;
        let k = 1;
        while (k < ray.length && ob[ray[k]] === op) k++;
        if (k < ray.length && ob[ray[k]] === p) return true;
      }
    }
    return false;
  }

  function genMovesO(p, ply) {
    const op = 3 - p, base = ply * 64;
    let cnt = 0;
    for (let c = 0; c < ON; c++) {
      if (ob[c]) continue;
      let flips = 0, ok = false;
      for (let d = 0; d < 8; d++) {
        const ray = RAYS[c * 8 + d];
        if (!ray || ob[ray[0]] !== op) continue;
        let k = 1;
        while (k < ray.length && ob[ray[k]] === op) k++;
        if (k < ray.length && ob[ray[k]] === p) { flips += k; ok = true; }
      }
      if (!ok) continue;
      mvBuf[base + cnt] = c; mvFlips[base + cnt] = flips;
      mvScore[base + cnt] = OPOS[c] * 4 - flips;
      cnt++;
    }
    for (let i = 0; i < cnt - 1; i++) {
      let bi = i;
      for (let j = i + 1; j < cnt; j++) if (mvScore[base + j] > mvScore[base + bi]) bi = j;
      if (bi !== i) {
        let tv = mvBuf[base + i]; mvBuf[base + i] = mvBuf[base + bi]; mvBuf[base + bi] = tv;
        tv = mvFlips[base + i]; mvFlips[base + i] = mvFlips[base + bi]; mvFlips[base + bi] = tv;
        const ts = mvScore[base + i]; mvScore[base + i] = mvScore[base + bi]; mvScore[base + bi] = ts;
      }
    }
    return cnt;
  }

  function doMoveO(c, p, ply) {
    const op = 3 - p, base = ply * 24;
    ob[c] = p;
    let n = 0;
    for (let d = 0; d < 8; d++) {
      const ray = RAYS[c * 8 + d];
      if (!ray || ob[ray[0]] !== op) continue;
      let k = 1;
      while (k < ray.length && ob[ray[k]] === op) k++;
      if (k >= ray.length || ob[ray[k]] !== p) continue;
      for (let j = 0; j < k; j++) { ob[ray[j]] = p; undoStack[base + 1 + n++] = ray[j]; }
    }
    undoStack[base] = n;
    return n;
  }
  function undoMoveO(c, p, ply) {
    const op = 3 - p, base = ply * 24, n = undoStack[base];
    for (let i = 0; i < n; i++) { const f = undoStack[base + 1 + i]; ob[f] = op; }
    ob[c] = 0;
  }

  function countDiscs(p) { let n = 0; for (let c = 0; c < ON; c++) if (ob[c] === p) n++; return n; }

  function evalO(p) {
    const op = 3 - p;
    let mine = 0, opp = 0, pos = 0, frontier = 0, empties = 0;
    for (let c = 0; c < ON; c++) {
      const v = ob[c];
      if (!v) { empties++; continue; }
      const w = OPOS[c];
      if (v === p) { mine++; pos += w; } else { opp++; pos -= w; }
      const x = c % O, y = (c / O) | 0;
      let adjEmpty = false;
      for (let d = 0; d < 8; d++) {
        const a = x + ODX[d], b = y + ODY[d];
        if (a >= 0 && a < O && b >= 0 && b < O && !ob[b * O + a]) { adjEmpty = true; break; }
      }
      if (adjEmpty) frontier += (v === p ? 1 : -1);
    }
    const stable = stableCount(p) - stableCount(3 - p);
    let s;
    if (empties > 40) s = pos * 1.0 + stable * 12 + (mine - opp) * 0.6 - frontier * 3;
    else if (empties > 12) s = pos * 1.0 + stable * 16 + (mine - opp) * 2 - frontier * 2;
    else s = pos * 0.5 + stable * 20 + (mine - opp) * 12 - frontier;
    return s;
  }

  function stableCount(p) {
    let n = 0;
    for (let i = 0; i < 4; i++) {
      if (ob[CORNERS[i]] !== p) continue;
      n++;
      for (let d = 0; d < 2; d++) {
        const dd = CDIRS[i][d];
        let a = CORNERS[i] % O + dd[0], b = ((CORNERS[i] / O) | 0) + dd[1];
        while (a >= 0 && a < O && b >= 0 && b < O && ob[b * O + a] === p) { n++; a += dd[0]; b += dd[1]; }
      }
    }
    return n;
  }

  let oNodes = 0, oPrunes = 0, oAbort = false, oDeadline = 0, oRoot = 1, oBest = -1;
  function negamaxO(depth, alpha, beta, p, ply) {
    oNodes++;
    if ((oNodes & 255) === 0 && performance.now() > oDeadline) { oAbort = true; return 0; }
    const cnt = genMovesO(p, ply);
    if (cnt === 0) {
      if (!hasMoveO(3 - p)) {
        const diff = countDiscs(p) - countDiscs(3 - p);
        return diff > 0 ? WIN + diff * 100 : diff < 0 ? -WIN + diff * 100 : 0;
      }
      if (depth <= 0) return evalO(p);
      return -negamaxO(depth - 1, -beta, -alpha, 3 - p, ply + 1);
    }
    if (depth <= 0) return evalO(p);
    const base = ply * 64;
    let best = -INF;
    for (let i = 0; i < cnt; i++) {
      const m = mvBuf[base + i];
      doMoveO(m, p, ply);
      const v = -negamaxO(depth - 1, -beta, -alpha, 3 - p, ply + 1);
      undoMoveO(m, p, ply);
      if (oAbort) return best === -INF ? 0 : best;
      if (v > best) { best = v; if (depth === oRoot) oBest = m; }
      if (best > alpha) alpha = best;
      if (alpha >= beta) { oPrunes++; break; }
    }
    return best;
  }

  function thinkOthello(p) {
    oNodes = 0; oPrunes = 0; oAbort = false;
    oDeadline = performance.now() + (ctx.caps.mobile ? 450 : 850);
    const t0 = performance.now();
    let empties = 0;
    for (let c = 0; c < ON; c++) if (!ob[c]) empties++;
    const maxD = empties <= 12 ? empties : Math.min(S.depth + 2, empties);
    let best = -1, got = 0;
    for (let d = 2; d <= maxD; d++) {
      oRoot = d; oBest = -1; oAbort = false;
      const v = negamaxO(d, -INF, INF, p, 0);
      if (oAbort || oBest < 0) break;
      best = oBest; got = d; S.score = v;
    }
    S.ms = performance.now() - t0;
    S.nodes = oNodes; S.prunes = oPrunes; S.usedDepth = got;
    if (best < 0) { const cnt = genMovesO(p, 0); if (cnt) best = mvBuf[0]; }
    return best;
  }

  // ---------------- 落子 / 回合 ----------------
  function humanColor() { return S.playerFirst ? 1 : 2; }
  function aiColor() { return S.playerFirst ? 2 : 1; }
  let turn = 1;

  function newGame() {
    S.over = false; S.result = 0; S.thinking = false; S.thinkT = 0;
    S.lastMove = -1; S.winLine = null; S.msg = ''; S.finished = false;
    S.nodes = 0; S.prunes = 0; S.ms = 0; S.score = 0; S.usedDepth = 0;
    if (S.game === 'gomoku') {
      gb.fill(0); near.fill(0); near[(7 * G + 7)] = 1;
      recomputeTotals(); turn = 1;
    } else {
      resetOthello(); turn = 1;
    }
    spawnT.fill(0); flipT.fill(0);
    updateHud();
    if (turn !== humanColor() || S.autoAI) S.thinking = true, S.thinkT = 0.35;
  }

  function doPlaceG(c, p) {
    placeG(c, p);
    S.lastMove = c;
    spawnT[c] = S.t;
    audio.sfx('place'); ctx.vibrate(PATTERNS.tap);
    const col = p === 1 ? '#7dd3fc' : '#ffb020';
    particles.burst(gx(c), gy(c), 12, { color: col, speed: 120, life: .45, size: 2.6 });
    if (lastFive) { endGame(p === humanColor() ? 1 : 2, c, p); return; }
    let full = true;
    for (let i = 0; i < GN; i++) if (!gb[i]) { full = false; break; }
    if (full) { endGame(3, -1, 0); return; }
    turn = 3 - p;
    if (S.autoAI || turn === aiColor()) { S.thinking = true; S.thinkT = 0.3; }
    updateHud();
  }

  function doPlaceO(c, p) {
    const flips = doMoveO(c, p, 0);
    S.lastMove = c;
    spawnT[c] = S.t;
    for (let i = 0; i < flips; i++) {
      const f = undoStack[0 * 24 + 1 + i];
      flipT[f] = S.t; flipFrom[f] = 3 - p;
    }
    audio.sfx(flips > 3 ? 'combo' : 'place'); ctx.vibrate(PATTERNS.hit);
    particles.burst(ox(c), oy(c), 14, { color: p === 1 ? '#22e0ff' : '#ff2e88', speed: 150, life: .5, size: 3 });
    turn = 3 - p;
    if (!hasMoveO(turn)) {
      if (!hasMoveO(p)) { endGameO(); return; }
      turn = p;
      S.msg = (turn === humanColor() ? '你' : 'AI') + '无子可下，跳过'; S.msgT = 2.2;
      audio.sfx('error');
    }
    if (S.autoAI || turn === aiColor()) { S.thinking = true; S.thinkT = 0.3; }
    updateHud();
  }

  function endGameO() {
    const me = humanColor(), ai = 3 - me;
    const a = countDiscs(me), b = countDiscs(ai);
    S.over = true;
    S.result = a > b ? 1 : a < b ? 2 : 3;
    finishMatch(a, b);
  }

  function endGame(res, c, p) {
    S.over = true; S.result = res;
    if (c >= 0) {
      S.winLine = winLineOf(c, p);
      const x0 = gx(S.winLine[0]), y0 = gy(S.winLine[0]);
      const x1 = gx(S.winLine[S.winLine.length - 1]), y1 = gy(S.winLine[S.winLine.length - 1]);
      for (let i = 0; i < 5; i++) {
        const f = i / 4;
        particles.explosion(lerp(x0, x1, f), lerp(y0, y1, f), 0.8, PALETTE.amber);
      }
      shake.add(0.5);
    }
    finishMatch(0, 0);
  }

  function winLineOf(c, p) {
    const x = c % G, y = (c / G) | 0;
    for (let d = 0; d < 4; d++) {
      let sx = x, sy = y;
      let a = x - DX[d], b = y - DY[d];
      while (a >= 0 && a < G && b >= 0 && b < G && gb[b * G + a] === p) { sx = a; sy = b; a -= DX[d]; b -= DY[d]; }
      let len = 0;
      a = sx; b = sy;
      while (a >= 0 && a < G && b >= 0 && b < G && gb[b * G + a] === p) { len++; a += DX[d]; b += DY[d]; }
      if (len >= 5) {
        const out = [];
        for (let i = 0; i < len; i++) out.push((sy + DY[d] * i) * G + (sx + DX[d] * i));
        return out;
      }
    }
    return [c];
  }

  function finishMatch(myPts, aiPts) {
    if (S.finished) return;
    S.finished = true;
    let value;
    if (S.result === 1) {
      S.streak++; S.wins++;
      if (S.streak > S.best) S.best = S.streak;
      value = 1000 + S.streak * 120;
    } else if (S.result === 3) { value = 300; }
    else { S.streak = 0; S.losses++; value = 100; }
    save.set('streak', S.streak); save.set('bestStreak', S.best);
    save.set('wins', S.wins); save.set('losses', S.losses);
    updateHud();
    audio.sfx(S.result === 1 ? 'win' : S.result === 3 ? 'confirm' : 'lose');
    audio.duck(0.5, 800);
    ctx.vibrate(S.result === 1 ? PATTERNS.win : PATTERNS.lose);
    const stats = [
      ['棋种', S.game === 'gomoku' ? '五子棋' : '黑白棋'],
      ['搜索深度', S.usedDepth],
      ['搜索节点', S.nodes],
      ['剪枝次数', S.prunes],
      ['思考耗时', S.ms.toFixed(0) + 'ms'],
      ['当前连胜', S.streak],
      ['最佳连胜', S.best]
    ];
    if (S.game === 'othello') stats.push(['比分', myPts + ' : ' + aiPts]);
    setTimeout(() => ctx.finish(value, { win: S.result === 1, higherBetter: true, stats }), 900);
  }

  // ---------------- 布局 ----------------
  let boardX = 0, boardY = 0, boardS = 0, cs = 0, topPad = 46, bottomPad = 64;
  let ctrl = null;
  const TABS = [{ x: 0, y: 0, w: 0, h: 0, k: 'gomoku', n: '五子棋' }, { x: 0, y: 0, w: 0, h: 0, k: 'othello', n: '黑白棋' }];

  function layout(w, h) {
    bottomPad = (ctrl && ctrl.offsetHeight ? ctrl.offsetHeight : 58) + 14;
    topPad = 44;
    const availH = h - topPad - bottomPad - 10;
    const availW = w - 16;
    boardS = Math.max(80, Math.min(availW, availH));
    boardX = (w - boardS) / 2;
    boardY = topPad + (availH - boardS) / 2;
    cs = boardS / (S.game === 'gomoku' ? G : O);
    let tx = w / 2 - 106;
    for (const tb of TABS) { tb.x = tx; tb.y = 8; tb.w = 100; tb.h = 30; tx += 106; }
  }
  const gx = (c) => boardX + (c % G) * cs + cs / 2;
  const gy = (c) => boardY + (((c / G) | 0)) * cs + cs / 2;
  const ox = (c) => boardX + (c % O) * cs + cs / 2;
  const oy = (c) => boardY + (((c / O) | 0)) * cs + cs / 2;
  function cellAt(px, py, n) {
    const i = Math.floor((px - boardX) / cs), j = Math.floor((py - boardY) / cs);
    if (i < 0 || j < 0 || i >= n || j >= n) return -1;
    return j * n + i;
  }

  // ---------------- 控件 ----------------
  function mkBtn(label, fn, cls) {
    const b = document.createElement('button');
    b.className = 'btn ' + (cls || 'btn-ghost');
    b.textContent = label;
    b.style.cssText = 'padding:6px 9px;font-size:12px;line-height:1.1';
    ctx.listen(b, 'click', (e) => { e.preventDefault(); audio.sfx('click'); ctx.vibrate(PATTERNS.tap); fn(b); });
    return b;
  }
  function buildControls() {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center;align-items:center';
    el.appendChild(mkBtn('五子棋/黑白棋', (b) => {
      S.game = S.game === 'gomoku' ? 'othello' : 'gomoku';
      b.textContent = S.game === 'gomoku' ? '五子棋/黑白棋' : '五子棋/黑白棋';
      audio.sfx('swap'); newGame(); layout(ctx.W, ctx.H);
    }));
    const dep = document.createElement('label');
    dep.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:#7d8db3';
    const depIn = document.createElement('input');
    depIn.type = 'range'; depIn.min = '1'; depIn.max = '6'; depIn.value = String(S.depth);
    depIn.className = 'range'; depIn.style.width = '90px';
    const depLb = document.createElement('span'); depLb.textContent = '深度 ' + S.depth;
    ctx.listen(depIn, 'input', () => { S.depth = +depIn.value; depLb.textContent = '深度 ' + S.depth; });
    dep.appendChild(depLb); dep.appendChild(depIn);
    el.appendChild(dep);
    el.appendChild(mkBtn('先手:玩家', (b) => { S.playerFirst = !S.playerFirst; b.textContent = '先手:' + (S.playerFirst ? '玩家' : 'AI'); newGame(); }));
    el.appendChild(mkBtn('观战:关', (b) => { S.autoAI = !S.autoAI; b.textContent = '观战:' + (S.autoAI ? '开' : '关'); if (S.autoAI) { S.thinking = true; S.thinkT = 0.3; } }));
    el.appendChild(mkBtn('禁手:关', (b) => { S.forbid = !S.forbid; b.textContent = '禁手:' + (S.forbid ? '开' : '关'); }));
    el.appendChild(mkBtn('新局', () => { newGame(); }));
    ctx.overlay(el, 'overlay-bottom');
    ctrl = el;
  }

  function updateHud() {
    ctx.hud('streak', '连胜', S.streak, { color: S.streak > 0 ? PALETTE.lime : null });
    ctx.hud('nodes', '节点', S.nodes);
    ctx.hud('info', '深度/剪枝', S.usedDepth + ' / ' + S.prunes);
  }

  buildControls();

  // ---------------- 更新 ----------------
  function update(dt) {
    S.t += dt;
    if (S.msgT > 0) { S.msgT -= dt; if (S.msgT <= 0) S.msg = ''; }
    const p = input.pointer;
    if (p.justDown) {
      for (const tb of TABS) {
        if (p.x >= tb.x && p.x <= tb.x + tb.w && p.y >= tb.y && p.y <= tb.y + tb.h) {
          if (tb.k !== S.game) { S.game = tb.k; audio.sfx('swap'); newGame(); layout(ctx.W, ctx.H); }
          return;
        }
      }
      if (!S.over && !S.thinking && !S.autoAI && turn === humanColor()) {
        if (S.game === 'gomoku') {
          const c = cellAt(p.x, p.y, G);
          if (c >= 0 && !gb[c]) {
            if (S.forbid && humanColor() === 1 && isForbidden(c)) {
              S.msg = '禁手：黑棋双三/双四/长连'; S.msgT = 2.2; audio.sfx('error'); ctx.vibrate(PATTERNS.error);
            } else doPlaceG(c, humanColor());
          }
        } else {
          const c = cellAt(p.x, p.y, O);
          if (c >= 0 && !ob[c]) {
            const cnt = genMovesO(humanColor(), 0);
            let ok = false;
            for (let i = 0; i < cnt; i++) if (mvBuf[i] === c) ok = true;
            if (ok) doPlaceO(c, humanColor());
            else { audio.sfx('error'); S.msg = '该点不能落子'; S.msgT = 1.8; }
          }
        }
      }
    }
    if (S.thinking) {
      S.thinkT -= dt;
      if (S.thinkT <= 0) {
        S.thinking = false;
        const p2 = turn;
        if (S.game === 'gomoku') {
          const c = thinkGomoku(p2);
          doPlaceG(c, p2);
        } else {
          const c = thinkOthello(p2);
          if (c >= 0) doPlaceO(c, p2); else { if (!hasMoveO(3 - p2)) endGameO(); }
        }
        updateHud();
      }
    }
  }

  // ---------------- 渲染 ----------------
  function drawTabs(c) {
    for (const tb of TABS) {
      const on = tb.k === S.game;
      fillRound(c, tb.x, tb.y, tb.w, tb.h, 8, on ? rgba(PALETTE.cyan, 0.18) : 'rgba(12,18,34,0.7)');
      strokeRound(c, tb.x + .5, tb.y + .5, tb.w - 1, tb.h - 1, 8, on ? PALETTE.cyan : '#243357', 1.2);
      text(c, tb.n, tb.x + tb.w / 2, tb.y + tb.h / 2, { size: 13, color: on ? PALETTE.cyan : PALETTE.dim, weight: 800 });
    }
  }

  function drawGomoku(c) {
    fillRound(c, boardX - 8, boardY - 8, boardS + 16, boardS + 16, 10, 'rgba(10,15,30,0.92)');
    strokeRound(c, boardX - 8.5, boardY - 8.5, boardS + 17, boardS + 17, 10, rgba(PALETTE.cyan, 0.22), 1.4);
    c.strokeStyle = 'rgba(80,110,170,0.35)'; c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < G; i++) {
      c.moveTo(boardX + i * cs + cs / 2, boardY + cs / 2); c.lineTo(boardX + i * cs + cs / 2, boardY + boardS - cs / 2);
      c.moveTo(boardX + cs / 2, boardY + i * cs + cs / 2); c.lineTo(boardX + boardS - cs / 2, boardY + i * cs + cs / 2);
    }
    c.stroke();
    c.fillStyle = 'rgba(120,160,220,0.6)';
    for (const [sx2, sy2] of [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]]) {
      c.beginPath(); c.arc(boardX + sx2 * cs + cs / 2, boardY + sy2 * cs + cs / 2, Math.max(1.5, cs * 0.07), 0, TAU); c.fill();
    }
    // 悬停提示
    const hp = input.pointer;
    if (!S.over && !S.thinking && turn === humanColor() && hp.x > boardX && hp.x < boardX + boardS) {
      const hc = cellAt(hp.x, hp.y, G);
      if (hc >= 0 && !gb[hc]) {
        const bad = S.forbid && humanColor() === 1 && isForbidden(hc);
        c.fillStyle = bad ? rgba(PALETTE.red, 0.35) : rgba(humanColor() === 1 ? '#7dd3fc' : '#ffb020', 0.28);
        c.beginPath(); c.arc(gx(hc), gy(hc), cs * 0.42, 0, TAU); c.fill();
        if (bad) text(c, '禁', gx(hc), gy(hc), { size: cs * 0.45, color: '#fff', weight: 900 });
      }
    }
    // 棋子
    for (let i = 0; i < GN; i++) {
      const v = gb[i];
      if (!v) continue;
      const age = S.t - spawnT[i];
      const sc2 = age < 0.28 ? ease.outBack(clamp(age / 0.28, 0, 1)) : 1;
      const r = cs * 0.42 * sc2;
      const X = gx(i), Y = gy(i);
      const dark = v === 1;
      const g = c.createRadialGradient(X - r * .3, Y - r * .3, r * .1, X, Y, r);
      g.addColorStop(0, dark ? '#9fd8ff' : '#ffd79a');
      g.addColorStop(0.55, dark ? '#1b3b66' : '#c2510f');
      g.addColorStop(1, dark ? '#081527' : '#4a1c02');
      c.save(); c.shadowColor = dark ? '#22e0ff' : '#ffb020'; c.shadowBlur = cs * 0.5;
      c.fillStyle = g; c.beginPath(); c.arc(X, Y, r, 0, TAU); c.fill();
      c.restore();
      if (i === S.lastMove) {
        glowCircle(c, X, Y, r * 0.55, PALETTE.lime, { glow: 10, width: 1.6, alpha: 0.95 });
      }
    }
    // 五连高亮
    if (S.winLine && S.winLine.length) {
      neon(c, (cc) => {
        for (let i = 0; i < S.winLine.length; i++) {
          const X = gx(S.winLine[i]), Y = gy(S.winLine[i]);
          i ? cc.lineTo(X, Y) : cc.moveTo(X, Y);
        }
      }, PALETTE.amber, { glow: 18, width: Math.max(2, cs * 0.14), layers: 3 });
    }
  }

  function drawOthello(c) {
    fillRound(c, boardX - 8, boardY - 8, boardS + 16, boardS + 16, 10, 'rgba(10,15,30,0.92)');
    strokeRound(c, boardX - 8.5, boardY - 8.5, boardS + 17, boardS + 17, 10, rgba(PALETTE.cyan, 0.22), 1.4);
    for (let j = 0; j < O; j++) for (let i = 0; i < O; i++) {
      c.fillStyle = (i + j) % 2 ? 'rgba(20,32,60,0.85)' : 'rgba(14,22,44,0.85)';
      c.fillRect(boardX + i * cs, boardY + j * cs, cs, cs);
    }
    c.strokeStyle = 'rgba(80,110,170,0.35)'; c.lineWidth = 1; c.beginPath();
    for (let i = 0; i <= O; i++) {
      c.moveTo(boardX + i * cs, boardY); c.lineTo(boardX + i * cs, boardY + boardS);
      c.moveTo(boardX, boardY + i * cs); c.lineTo(boardX + boardS, boardY + i * cs);
    }
    c.stroke();
    // 可落子提示
    if (!S.over && !S.thinking && turn === humanColor()) {
      const cnt = genMovesO(humanColor(), 0);
      const pulse = 0.35 + 0.3 * Math.sin(S.t * 4);
      for (let i = 0; i < cnt; i++) {
        const cc2 = mvBuf[i];
        c.fillStyle = rgba(PALETTE.lime, pulse);
        c.beginPath(); c.arc(ox(cc2), oy(cc2), cs * 0.12, 0, TAU); c.fill();
      }
    }
    for (let i = 0; i < ON; i++) {
      const v = ob[i];
      if (!v) continue;
      const X = ox(i), Y = oy(i);
      let sx2 = 1, col = v;
      const fa = S.t - flipT[i];
      if (fa < 0.34 && flipT[i] > 0) { sx2 = Math.abs(Math.cos(fa / 0.34 * Math.PI)); col = fa < 0.17 ? flipFrom[i] : v; }
      const age = S.t - spawnT[i];
      const sc2 = age < 0.28 ? ease.outBack(clamp(age / 0.28, 0, 1)) : 1;
      const r = cs * 0.40 * sc2;
      const dark = col === 1;
      c.save();
      c.translate(X, Y); c.scale(Math.max(0.05, sx2), 1);
      const g = c.createRadialGradient(-r * .3, -r * .3, r * .1, 0, 0, r);
      g.addColorStop(0, dark ? '#8fe9ff' : '#ff9fc0');
      g.addColorStop(0.6, dark ? '#12557a' : '#a01040');
      g.addColorStop(1, dark ? '#04182a' : '#33000f');
      c.shadowColor = dark ? '#22e0ff' : '#ff2e88'; c.shadowBlur = cs * 0.4;
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
      c.restore();
      if (i === S.lastMove) glowCircle(c, X, Y, r * 0.5, PALETTE.lime, { glow: 10, width: 1.6, alpha: 0.95 });
    }
    // 比分
    const me = humanColor();
    const a = countDiscs(me), b = countDiscs(3 - me);
    text(c, `你 ${a}  ·  AI ${b}`, boardX + boardS / 2, boardY - 22, { size: 13, color: PALETTE.white, weight: 800 });
  }

  function render(alpha, rdt) {
    const c = ctx.ctx, W = ctx.W, H = ctx.H;
    c.fillStyle = PALETTE.bg; c.fillRect(0, 0, W, H);
    drawTabs(c);
    if (S.game === 'gomoku') drawGomoku(c); else drawOthello(c);

    // 状态栏
    if (S.thinking) {
      const dots = '.'.repeat(1 + ((S.t * 3) | 0) % 3);
      panel(c, W / 2 - 78, boardY + 4, 156, 30, { fill: 'rgba(8,12,24,0.9)', stroke: PALETTE.cyan });
      text(c, 'AI 思考中' + dots, W / 2, boardY + 19, { size: 13, color: PALETTE.cyan, weight: 800 });
    }
    if (S.msg) {
      text(c, S.msg, W / 2, H - bottomPad - 16, { size: 12, color: PALETTE.amber });
    }
    // AI 统计小面板
    const px2 = 10, py2 = H - bottomPad - 74;
    panel(c, px2, py2, 168, 66, { fill: 'rgba(8,12,24,0.82)', stroke: '#243357' });
    text(c, 'Minimax + α-β', px2 + 8, py2 + 13, { size: 11, color: PALETTE.cyan, align: 'left', weight: 800 });
    text(c, `节点 ${S.nodes}  剪枝 ${S.prunes}`, px2 + 8, py2 + 31, { size: 10.5, color: PALETTE.dim, align: 'left' });
    text(c, `深度 ${S.usedDepth}  耗时 ${S.ms.toFixed(0)}ms`, px2 + 8, py2 + 46, { size: 10.5, color: PALETTE.dim, align: 'left' });
    text(c, `评估 ${S.score >= 0 ? '+' : ''}${S.score.toFixed(0)}`, px2 + 8, py2 + 60, { size: 10.5, color: PALETTE.amber, align: 'left' });

    particles.render(c, 1);
    particles.renderTexts(c, rdt);
    vignette(c, W, H, 0.35);
  }

  function resize(w, h) { layout(w, h); }

  layout(ctx.W, ctx.H);
  newGame();
  ctx.hint('点击棋盘落子 · 顶部切换棋种 · 底部调节 AI 深度', 5000);

  return { update, render, resize, destroy() { } };
}
