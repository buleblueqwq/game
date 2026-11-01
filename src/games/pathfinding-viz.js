// 寻路算法竞技场 —— BFS / Dijkstra / A* / Greedy / 双向BFS 同屏逐步可视化对比
// 核心：统一搜索步进器 + 增量离屏图层（避免每帧重画 960×4 个格子）
import { lerp, mixHex, rgba } from '../core/math.js';
import { PALETTE, neon, glowCircle, roundRect, text, bar, panel, vignette, offscreen, fillRound, strokeRound } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'pathfinding-viz', title: '寻路算法竞技场', category: 'ai', difficulty: 3,
  music: 'puzzle',
  howto: [
    '在网格上拖拽绘制墙（红）/泥地（黄）/擦除，画笔可切换',
    '拖动 S 起点与 G 终点改变位置，搜索自动重算',
    '空格 = 单步；点击视口左上角标题可切换该格算法',
    '对比"访问节点 / 路径代价 / 耗时"，观察 A* 启发权重退化'
  ],
  particles: 700
};
export const musicTrack = 'puzzle';

const COLS = 40, ROWS = 24, N = COLS * ROWS;
const EMPTY = 0, WALL = 1, MUD = 2;
const MUD_COST = 5, SQRT2 = Math.SQRT2;
const RAMP = 26;

const ALGOS = [
  { key: 'bfs', name: 'BFS', color: '#22e0ff' },
  { key: 'dij', name: 'Dijkstra', color: '#8dff4d' },
  { key: 'ast', name: 'A*', color: '#ffb020' },
  { key: 'gre', name: 'Greedy', color: '#ff2e88' },
  { key: 'bib', name: '双向BFS', color: '#a855f7' }
];
const ALGO_MAP = new Map(ALGOS.map(a => [a.key, a]));

/** 二叉最小堆（预分配，零 GC） */
class Heap {
  constructor(cap) { this.k = new Float32Array(cap); this.v = new Int32Array(cap); this.n = 0; this.cap = cap; }
  clear() { this.n = 0; }
  push(k, v) {
    if (this.n >= this.cap) return;
    let i = this.n++;
    this.k[i] = k; this.v[i] = v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= this.k[i]) break;
      const tk = this.k[p], tv = this.v[p];
      this.k[p] = this.k[i]; this.v[p] = this.v[i];
      this.k[i] = tk; this.v[i] = tv; i = p;
    }
  }
  pop() {
    const top = this.v[0];
    const n = --this.n;
    this.k[0] = this.k[n]; this.v[0] = this.v[n];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < n && this.k[l] < this.k[m]) m = l;
      if (r < n && this.k[r] < this.k[m]) m = r;
      if (m === i) break;
      const tk = this.k[m], tv = this.v[m];
      this.k[m] = this.k[i]; this.v[m] = this.v[i];
      this.k[i] = tk; this.v[i] = tv; i = m;
    }
    return top;
  }
}

export function create(ctx) {
  const { input, audio, particles, shake, save, rng } = ctx;

  // ---------------- 状态 ----------------
  const grid = new Uint8Array(N);
  let start = 12 * COLS + 4, goal = 12 * COLS + 35;
  let diagonal = true, hType = 0, hWeight = 1;
  let brush = 1;                 // 1 墙 2 泥 0 擦除
  let quad = true, speed = 2;    // 0 单步 1 慢 2 快 3 瞬间
  let slots = ['bfs', 'dij', 'ast', 'gre'];
  let refCost = Infinity;
  let running = true, rounds = 0, stepReq = false;
  let t = 0, recalcTimer = 0, pending = false, lastEdit = 0;
  let finished = false;

  const SPEED_STEPS = [0, 3, 22, 1e9];
  const SPEED_NAME = ['单步', '慢', '快', '瞬间'];

  const idxOf = (x, y) => y * COLS + x;
  // ---------------- 搜索状态 ----------------
  function makeSearch(key) {
    return {
      key, def: ALGO_MAP.get(key),
      g: new Float32Array(N), prev: new Int32Array(N), mark: new Uint8Array(N),
      gB: new Float32Array(N), prevB: new Int32Array(N), markB: new Uint8Array(N),
      seq: new Int32Array(N), heap: new Heap(N * 8),
      q: new Int32Array(N), qh: 0, qt: 0,
      qB: new Int32Array(N), qhB: 0, qtB: 0,
      visited: 0, expanded: 0, done: false, found: false, meet: -1,
      path: [], pathCost: 0, steps: 0, ms: 0, drawn: 0
    };
  }
  const searches = new Map();
  for (const a of ALGOS) searches.set(a.key, makeSearch(a.key));
  let activeList = [];
  function refreshActive() {
    activeList.length = 0;
    if (quad) for (const k of slots) activeList.push(searches.get(k));
    else activeList.push(searches.get(slots[0]));
  }

  // 启发式
  function heur(i) {
    const dx = Math.abs((i % COLS) - (goal % COLS));
    const dy = Math.abs(((i / COLS) | 0) - ((goal / COLS) | 0));
    if (hType === 1) return Math.sqrt(dx * dx + dy * dy);
    return diagonal ? (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)) : (dx + dy);
  }

  // 邻居展开（写入预分配缓冲）
  const nbIdx = new Int32Array(8), nbCost = new Float32Array(8);
  function neighbors(i) {
    const x = i % COLS, y = (i / COLS) | 0;
    let c = 0;
    const push = (nx, ny, mult) => {
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return;
      const j = ny * COLS + nx;
      if (grid[j] === WALL) return;
      nbIdx[c] = j;
      nbCost[c] = (grid[j] === MUD ? MUD_COST : 1) * mult;
      c++;
    };
    push(x + 1, y, 1); push(x - 1, y, 1); push(x, y + 1, 1); push(x, y - 1, 1);
    if (diagonal) {
      const can = (dx, dy) => {
        const a = idxOf(x + dx, y), b = idxOf(x, y + dy);
        return grid[a] !== WALL && grid[b] !== WALL;
      };
      if (x + 1 < COLS && y + 1 < ROWS && can(1, 1)) push(x + 1, y + 1, SQRT2);
      if (x - 1 >= 0 && y + 1 < ROWS && can(-1, 1)) push(x - 1, y + 1, SQRT2);
      if (x + 1 < COLS && y - 1 >= 0 && can(1, -1)) push(x + 1, y - 1, SQRT2);
      if (x - 1 >= 0 && y - 1 >= 0 && can(-1, -1)) push(x - 1, y - 1, SQRT2);
    }
    return c;
  }

  function initSearch(s) {
    s.g.fill(Infinity); s.prev.fill(-1); s.mark.fill(0); s.seq.fill(0);
    s.heap.clear(); s.qh = s.qt = 0;
    s.visited = 0; s.expanded = 0; s.done = false; s.found = false; s.meet = -1;
    s.path.length = 0; s.pathCost = 0; s.steps = 0; s.ms = 0; s.drawn = 0;
    if (s.key === 'bib') {
      s.gB.fill(Infinity); s.prevB.fill(-1); s.markB.fill(0);
      s.qhB = s.qtB = 0;
      s.mark[start] = 1; s.q[s.qt++] = start;
      s.markB[goal] = 1; s.qB[s.qtB++] = goal;
    } else if (s.key === 'bfs') {
      s.mark[start] = 1; s.q[s.qt++] = start;
    } else {
      s.g[start] = 0; s.heap.push(heur(start) * (s.key === 'dij' ? 0 : s.key === 'gre' ? 1 : hWeight), start);
    }
  }

  function closeNode(s, i) {
    s.mark[i] = 2; s.seq[s.expanded++] = i; s.visited++;
  }

  function stepBfs(s) {
    if (s.qh >= s.qt) { s.done = true; return; }
    const cur = s.q[s.qh++];
    if (s.mark[cur] === 2) return;
    closeNode(s, cur);
    if (cur === goal) { s.found = true; s.done = true; buildPath(s, cur, false); return; }
    const n = neighbors(cur);
    for (let k = 0; k < n; k++) {
      const j = nbIdx[k];
      if (s.mark[j]) continue;
      s.mark[j] = 1; s.prev[j] = cur; s.q[s.qt++] = j;
    }
  }

  function stepBest(s) {
    if (s.heap.n === 0) { s.done = true; return; }
    const cur = s.heap.pop();
    if (s.mark[cur] === 2) return;
    closeNode(s, cur);
    if (cur === goal) { s.found = true; s.done = true; buildPath(s, cur, false); return; }
    const n = neighbors(cur);
    for (let k = 0; k < n; k++) {
      const j = nbIdx[k];
      if (s.mark[j] === 2) continue;
      const ng = s.g[cur] + nbCost[k];
      if (ng < s.g[j]) {
        s.g[j] = ng; s.prev[j] = cur; s.mark[j] = 1;
        let f = ng;
        if (s.key === 'ast') f = ng + hWeight * heur(j);
        else if (s.key === 'gre') f = heur(j);
        s.heap.push(f, j);
      }
    }
  }

  function stepBib(s) {
    // 两侧交替各扩展一个节点
    for (let side = 0; side < 2; side++) {
      const A = side === 0;
      const q = A ? s.q : s.qB, mk = A ? s.mark : s.markB, pv = A ? s.prev : s.prevB;
      const qh = A ? 'qh' : 'qhB', qt = A ? 'qt' : 'qtB';
      if (s[qh] >= s[qt]) { if (!A && s.qh >= s.qt) { s.done = true; } continue; }
      const cur = q[s[qh]++];
      if (mk[cur] === 2) continue;
      mk[cur] = 2; s.seq[s.expanded++] = cur; s.visited++;
      const other = A ? s.markB : s.mark;
      if (other[cur] === 2) { s.meet = cur; s.found = true; s.done = true; buildPath(s, cur, true); return; }
      const n = neighbors(cur);
      for (let k = 0; k < n; k++) {
        const j = nbIdx[k];
        if (mk[j]) continue;
        mk[j] = 1; pv[j] = cur; q[s[qt]++] = j;
      }
    }
  }

  function stepSearch(s) {
    if (s.done) return;
    s.steps++;
    if (s.key === 'bfs') stepBfs(s);
    else if (s.key === 'bib') stepBib(s);
    else stepBest(s);
  }

  function pathCostOf(list) {
    let c = 0;
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      const dx = Math.abs((a % COLS) - (b % COLS)), dy = Math.abs(((a / COLS) | 0) - ((b / COLS) | 0));
      const mult = (dx && dy) ? SQRT2 : 1;
      c += (grid[b] === MUD ? MUD_COST : 1) * mult;
    }
    return c;
  }

  function buildPath(s, end, bi) {
    const out = s.path;
    out.length = 0;
    if (bi) {
      let c = end;
      while (c !== -1) { out.push(c); c = s.prev[c]; }
      out.reverse();
      c = s.prevB[end];
      while (c !== -1) { out.push(c); c = s.prevB[c]; }
    } else {
      let c = end;
      while (c !== -1) { out.push(c); c = s.prev[c]; }
      out.reverse();
    }
    s.pathCost = out.length ? pathCostOf(out) : 0;
  }

  /** 参考最优：瞬时 Dijkstra（用于判定"是否最优"） */
  function computeRef() {
    const g = new Float32Array(N).fill(Infinity);
    const done = new Uint8Array(N);
    const h = new Heap(N * 8);
    g[start] = 0; h.push(0, start);
    let guard = 0;
    while (h.n && guard++ < N * 8) {
      const cur = h.pop();
      if (done[cur]) continue;
      done[cur] = 1;
      if (cur === goal) break;
      const n = neighbors(cur);
      for (let k = 0; k < n; k++) {
        const j = nbIdx[k], ng = g[cur] + nbCost[k];
        if (ng < g[j]) { g[j] = ng; h.push(ng, j); }
      }
    }
    return done[goal] ? g[goal] : Infinity;
  }

  // ---------------- 地形生成 ----------------
  function clearGrid() { grid.fill(EMPTY); }
  function protect(i) { return i === start || i === goal; }

  function randomWalls() {
    clearGrid();
    for (let i = 0; i < N; i++) if (rng.chance(0.28) && !protect(i)) grid[i] = WALL;
  }

  function recDiv(x, y, w, h) {
    if (w < 5 || h < 5) return;
    const horiz = w < h ? true : (h < w ? false : rng.chance(0.5));
    if (horiz) {
      const wy = y + 2 + 2 * rng.int(0, Math.max(0, ((h - 4) >> 1) - 1));
      if (wy - y < 2 || y + h - wy - 1 < 2) return;
      const px = x + rng.int(0, w - 1);
      for (let i = x; i < x + w; i++) { const j = idxOf(i, wy); if (i !== px && !protect(j)) grid[j] = WALL; }
      recDiv(x, y, w, wy - y); recDiv(x, wy + 1, w, y + h - wy - 1);
    } else {
      const wx = x + 2 + 2 * rng.int(0, Math.max(0, ((w - 4) >> 1) - 1));
      if (wx - x < 2 || x + w - wx - 1 < 2) return;
      const py = y + rng.int(0, h - 1);
      for (let i = y; i < y + h; i++) { const j = idxOf(wx, i); if (i !== py && !protect(j)) grid[j] = WALL; }
      recDiv(x, y, wx - x, h); recDiv(wx + 1, y, x + w - wx - 1, h);
    }
  }
  function mazeDiv() {
    clearGrid();
    for (let x = 0; x < COLS; x++) { grid[idxOf(x, 0)] = WALL; grid[idxOf(x, ROWS - 1)] = WALL; }
    for (let y = 0; y < ROWS; y++) { grid[idxOf(0, y)] = WALL; grid[idxOf(COLS - 1, y)] = WALL; }
    recDiv(1, 1, COLS - 2, ROWS - 2);
  }

  function terrain() {
    clearGrid();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = ctx.noise.fbm(x * 0.13, y * 0.13, 4);
        const j = idxOf(x, y);
        if (protect(j)) continue;
        if (v > 0.30) grid[j] = WALL;
        else if (v > 0.05) grid[j] = MUD;
      }
    }
  }

  // ---------------- 布局 ----------------
  let boardX = 0, boardY = 0, boardW = 0, boardH = 0, panelW = 0, topPad = 34, bottomPad = 64;
  const views = [];
  const layers = [];
  let ctrl = null;

  function layout(w, h) {
    bottomPad = (ctrl && ctrl.offsetHeight ? ctrl.offsetHeight : 56) + 12;
    topPad = w < 640 ? 42 : 34;
    panelW = w >= 840 ? Math.min(248, w * 0.27) : 0;
    boardX = 8; boardY = topPad;
    boardW = Math.max(80, w - 16 - panelW);
    boardH = Math.max(80, h - topPad - bottomPad - 8);
    const gap = 8;
    views.length = 0;
    if (quad) {
      const vw = (boardW - gap) / 2, vh = (boardH - gap) / 2;
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++)
        views.push({ x: boardX + c * (vw + gap), y: boardY + r * (vh + gap), w: vw, h: vh });
    } else {
      views.push({ x: boardX, y: boardY, w: boardW, h: boardH });
    }
    for (let i = 0; i < views.length; i++) {
      const v = views[i];
      const need = !layers[i] || layers[i].w !== Math.round(v.w) || layers[i].h !== Math.round(v.h);
      if (need) layers[i] = offscreen(Math.round(v.w), Math.round(v.h), ctx.dpr);
    }
    layers.length = views.length;
    redrawBase();
  }

  function cellSize(v) {
    return Math.max(2, Math.min((v.w - 2) / COLS, (v.h - 16) / ROWS));
  }
  function viewGeom(v) {
    const cs = cellSize(v);
    return { cs, ox: v.x + (v.w - cs * COLS) / 2, oy: v.y + 14 + (v.h - 16 - cs * ROWS) / 2 };
  }

  // ---------------- 图层 ----------------
  const ramps = new Map();
  for (const a of ALGOS) {
    const r = [];
    for (let i = 0; i < RAMP; i++) {
      const p = i / (RAMP - 1);
      const c1 = mixHex('#0a1430', a.color, 0.25 + p * 0.75);
      r.push(mixHex(c1, '#ffffff', Math.max(0, p - 0.55) * 0.9));
    }
    ramps.set(a.key, r);
  }

  function redrawBase() {
    for (let i = 0; i < views.length; i++) {
      const v = views[i], g = viewGeom(v), L = layers[i];
      if (!L) continue;
      const c = L.ctx;
      c.clearRect(0, 0, L.w, L.h);
      c.fillStyle = 'rgba(8,13,26,0.92)';
      c.fillRect(0, 0, L.w, L.h);
      const lx = g.ox - v.x, ly = g.oy - v.y;
      // 网格线
      c.strokeStyle = 'rgba(70,100,160,0.10)'; c.lineWidth = 1;
      c.beginPath();
      for (let x = 0; x <= COLS; x++) { c.moveTo(lx + x * g.cs, ly); c.lineTo(lx + x * g.cs, ly + ROWS * g.cs); }
      for (let y = 0; y <= ROWS; y++) { c.moveTo(lx, ly + y * g.cs); c.lineTo(lx + COLS * g.cs, ly + y * g.cs); }
      c.stroke();
      // 地形
      for (let j = 0; j < N; j++) {
        const t = grid[j];
        if (!t) continue;
        const x = lx + (j % COLS) * g.cs, y = ly + ((j / COLS) | 0) * g.cs;
        if (t === WALL) {
          c.fillStyle = 'rgba(120,30,52,0.55)';
          c.fillRect(x + 0.5, y + 0.5, g.cs - 1, g.cs - 1);
          if (g.cs > 7) { c.strokeStyle = 'rgba(255,77,94,0.5)'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, g.cs - 1, g.cs - 1); }
        } else {
          c.fillStyle = 'rgba(120,84,20,0.55)';
          c.fillRect(x + 0.5, y + 0.5, g.cs - 1, g.cs - 1);
          if (g.cs > 7) {
            c.strokeStyle = 'rgba(255,176,32,0.6)'; c.lineWidth = 1; c.beginPath();
            c.moveTo(x + 1, y + g.cs - 1); c.lineTo(x + g.cs - 1, y + 1); c.stroke();
          }
        }
      }
    }
  }

  /** 把新关闭的节点增量画进图层 */
  function flushClosed() {
    const list = activeList;
    for (let i = 0; i < views.length && i < list.length; i++) {
      const s = list[i], v = views[i], g = viewGeom(v), L = layers[i];
      if (!L) continue;
      const c = L.ctx, ramp = ramps.get(s.key);
      const lx = g.ox - v.x, ly = g.oy - v.y;
      const total = Math.max(1, N * 0.55);
      while (s.drawn < s.expanded) {
        const j = s.seq[s.drawn++];
        if (j === start || j === goal) continue;
        const k = Math.min(RAMP - 1, ((s.drawn / total) * RAMP) | 0);
        c.fillStyle = ramp[k];
        const x = lx + (j % COLS) * g.cs, y = ly + ((j / COLS) | 0) * g.cs;
        c.globalAlpha = 0.85;
        c.fillRect(x + 0.6, y + 0.6, g.cs - 1.2, g.cs - 1.2);
        c.globalAlpha = 1;
      }
    }
  }

  // ---------------- 重算 ----------------
  function recalc(silent) {
    refCost = computeRef();
    refreshActive();
    for (const s of activeList) initSearch(s);
    redrawBase();
    running = true; pending = false; recalcTimer = 0;
    if (!silent) {
      rounds++;
      ctx.hud('round', '对比轮次', rounds);
      ctx.hud('opt', '最优代价', refCost === Infinity ? '不可达' : refCost.toFixed(1),
        { color: refCost === Infinity ? PALETTE.red : PALETTE.lime });
    }
  }

  // ---------------- 交互 ----------------
  let drag = 0; // 0 none 1 paint 2 start 3 goal
  let lastPaint = -1;

  function pickCell(px, py) {
    for (let i = 0; i < views.length; i++) {
      const v = views[i], g = viewGeom(v);
      if (px < v.x || px > v.x + v.w || py < v.y || py > v.y + v.h) continue;
      const cx = Math.floor((px - g.ox) / g.cs), cy = Math.floor((py - g.oy) / g.cs);
      if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return null;
      return { i: idxOf(cx, cy), view: i };
    }
    return null;
  }

  function paintAt(j) {
    if (j === start || j === goal) return;
    if (grid[j] === brush) return;
    grid[j] = brush;
    lastEdit = t; pending = true;
  }

  function handleInput() {
    const p = input.pointer;
    if (p.justDown) {
      // 视口标题点击 → 切换算法
      for (let i = 0; i < views.length; i++) {
        const v = views[i];
        if (p.x >= v.x && p.x <= v.x + Math.min(150, v.w) && p.y >= v.y && p.y <= v.y + 14) {
          const cur = ALGOS.findIndex(a => a.key === slots[i]);
          slots[i] = ALGOS[(cur + 1) % ALGOS.length].key;
          audio.sfx('swap'); ctx.vibrate(PATTERNS.tap); recalc(true);
          return;
        }
      }
      const hit = pickCell(p.x, p.y);
      if (hit) {
        if (hit.i === start) drag = 2;
        else if (hit.i === goal) drag = 3;
        else { drag = 1; paintAt(hit.i); }
        ctx.vibrate(PATTERNS.step);
      }
    }
    if (p.down && drag) {
      const hit = pickCell(p.x, p.y);
      if (hit) {
        if (drag === 1) { if (hit.i !== lastPaint) { paintAt(hit.i); lastPaint = hit.i; } }
        else if (drag === 2) { if (hit.i !== goal && grid[hit.i] !== WALL) { start = hit.i; pending = true; lastEdit = t; } }
        else if (drag === 3) { if (hit.i !== start && grid[hit.i] !== WALL) { goal = hit.i; pending = true; lastEdit = t; } }
      }
    }
    if (p.justUp) {
      if (drag) { pending = true; lastEdit = t; }
      drag = 0; lastPaint = -1;
    }
    if (input.justPressed('jump')) { stepReq = true; }
    if (input.justPressed('interact')) { audio.sfx('click'); recalc(false); }
  }

  // ---------------- 控件（DOM） ----------------
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
    el.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:100%';
    const bView = mkBtn('四分屏', (b) => { quad = !quad; b.textContent = quad ? '四分屏' : '单屏'; recalc(true); });
    const bBrush = mkBtn('画笔:墙', (b) => { brush = brush === 1 ? 2 : brush === 2 ? 0 : 1; b.textContent = '画笔:' + (brush === 1 ? '墙' : brush === 2 ? '泥地' : '擦除'); });
    const bDiag = mkBtn('对角:开', (b) => { diagonal = !diagonal; b.textContent = '对角:' + (diagonal ? '开' : '关'); recalc(false); });
    const bH = mkBtn('启发:曼哈顿', (b) => { hType = hType ? 0 : 1; b.textContent = '启发:' + (hType ? '欧几里得' : '曼哈顿'); recalc(false); });
    const bSpd = mkBtn('速度:快', (b) => { speed = (speed + 1) % 4; b.textContent = '速度:' + SPEED_NAME[speed]; ctx.hud('spd', '速度', SPEED_NAME[speed]); });
    const bStep = mkBtn('单步', () => { stepReq = true; });
    el.appendChild(bView); el.appendChild(bBrush); el.appendChild(bDiag);
    el.appendChild(bH); el.appendChild(bSpd); el.appendChild(bStep);
    el.appendChild(mkBtn('随机障碍', () => { randomWalls(); recalc(false); audio.sfx('build'); }));
    el.appendChild(mkBtn('迷宫', () => { mazeDiv(); recalc(false); audio.sfx('build'); }));
    el.appendChild(mkBtn('权重地形', () => { terrain(); recalc(false); audio.sfx('build'); }));
    el.appendChild(mkBtn('清空', () => { clearGrid(); recalc(false); audio.sfx('back'); }));
    const hw = document.createElement('label');
    hw.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:#7d8db3;padding:0 4px';
    const hwIn = document.createElement('input');
    hwIn.type = 'range'; hwIn.min = '0'; hwIn.max = '30'; hwIn.value = '10';
    hwIn.className = 'range'; hwIn.style.width = '84px';
    ctx.listen(hwIn, 'input', () => { hWeight = hwIn.value / 10; if (speed === 3) recalc(true); else recalc(true); });
    const lb = document.createElement('span'); lb.textContent = 'A*权重';
    hw.appendChild(lb); hw.appendChild(hwIn);
    el.appendChild(hw);
    el.appendChild(mkBtn('结算', () => finishNow(), 'btn-primary'));
    ctx.overlay(el, 'overlay-bottom');
    ctrl = el;
    return el;
  }

  function finishNow() {
    if (finished) return;
    finished = true;
    ctx.finish(rounds, {
      win: rounds >= 10, higherBetter: true,
      stats: [['对比轮次', rounds], ['最优代价', refCost === Infinity ? '不可达' : refCost.toFixed(1)], ['网格', COLS + '×' + ROWS]]
    });
  }

  buildControls();

  // ---------------- 更新 ----------------
  function update(dt) {
    t += dt;
    handleInput();
    if (pending) {
      recalcTimer += dt;
      if (!drag && recalcTimer > 0.14 && t - lastEdit > 0.1) recalc(true);
    }
    if (!running) return;
    const list = activeList;
    let allDone = true;
    for (const s of list) if (!s.done) allDone = false;
    if (allDone) {
      if (!finished && rounds >= 30) finishNow();
      return;
    }
    let n = SPEED_STEPS[speed];
    if (speed === 0) { n = stepReq ? 1 : 0; stepReq = false; }
    if (n > 0) {
      for (const s of list) {
        if (s.done) continue;
        const a = performance.now();
        let k = 0;
        while (!s.done && k < n && k < 4000) { stepSearch(s); k++; }
        s.ms += performance.now() - a;
      }
    }
    flushClosed();
    // frontier 闪烁音效（仅在慢速时）
    if (speed <= 1 && list.some(s => !s.done) && ((t * 8) | 0) !== ((t * 8 - dt * 8) | 0)) audio.sfx('tick', { gain: 0.4 });
  }

  // ---------------- 渲染 ----------------
  function drawPath(c, s, g) {
    if (!s.path.length) return;
    const col = s.def.color;
    const pts = s.path;
    neon(c, (cc) => {
      for (let i = 0; i < pts.length; i++) {
        const x = g.ox + (pts[i] % COLS) * g.cs + g.cs / 2, y = g.oy + ((pts[i] / COLS) | 0) * g.cs + g.cs / 2;
        i ? cc.lineTo(x, y) : cc.moveTo(x, y);
      }
    }, col, { glow: 12, width: Math.max(1.6, g.cs * 0.16), layers: 2, inner: '#fff' });
    // 流动光点
    const total = pts.length;
    const flow = (t * 2.2) % 1;
    for (let k = 0; k < 3; k++) {
      let f = (flow + k / 3) % 1;
      const fi = f * (total - 1);
      const i0 = Math.min(total - 2, fi | 0);
      const fr = fi - i0;
      const a = pts[i0], b = pts[i0 + 1];
      const x = lerp(g.ox + (a % COLS) * g.cs, g.ox + (b % COLS) * g.cs, fr) + g.cs / 2;
      const y = lerp(g.oy + ((a / COLS) | 0) * g.cs, g.oy + ((b / COLS) | 0) * g.cs, fr) + g.cs / 2;
      glowCircle(c, x, y, Math.max(1.6, g.cs * 0.2), '#ffffff', { glow: 10, width: 1, alpha: 0.9 });
    }
  }

  function drawView(c, i, s, v) {
    const g = viewGeom(v);
    const col = s.def.color;
    // 边框 + 标题
    fillRound(c, v.x, v.y, v.w, v.h, 8, 'rgba(9,14,28,0.9)');
    if (layers[i]) c.drawImage(layers[i].canvas, v.x, v.y, v.w, v.h);
    strokeRound(c, v.x + 0.5, v.y + 0.5, v.w - 1, v.h - 1, 8, rgba(col, 0.35), 1.2);
    fillRound(c, v.x, v.y, Math.min(150, v.w), 14, 6, rgba(col, 0.16));
    text(c, s.def.name, v.x + 6, v.y + 7.5, { size: 10.5, color: col, align: 'left', weight: 800 });
    if (quad) text(c, '点击切换', v.x + Math.min(150, v.w) - 6, v.y + 7.5, { size: 9, color: PALETTE.dim, align: 'right' });

    // frontier（open set）闪烁
    const blink = 0.45 + 0.55 * Math.abs(Math.sin(t * 5));
    c.fillStyle = rgba(col, 0.95);
    for (let j = 0; j < N; j++) {
      if (s.mark[j] !== 1) continue;
      const x = g.ox + (j % COLS) * g.cs, y = g.oy + ((j / COLS) | 0) * g.cs;
      c.globalAlpha = blink;
      c.fillRect(x + 0.8, y + 0.8, g.cs - 1.6, g.cs - 1.6);
    }
    c.globalAlpha = 1;
    if (s.key === 'bib') {
      c.fillStyle = rgba('#a855f7', 0.9);
      for (let j = 0; j < N; j++) {
        if (s.markB[j] !== 1) continue;
        const x = g.ox + (j % COLS) * g.cs, y = g.oy + ((j / COLS) | 0) * g.cs;
        c.globalAlpha = blink * 0.8;
        c.fillRect(x + 0.8, y + 0.8, g.cs - 1.6, g.cs - 1.6);
      }
      c.globalAlpha = 1;
    }

    // 路径
    if (s.found) drawPath(c, s, g);

    // 起点 / 终点
    const sx = g.ox + (start % COLS) * g.cs + g.cs / 2, sy = g.oy + ((start / COLS) | 0) * g.cs + g.cs / 2;
    const gx2 = g.ox + (goal % COLS) * g.cs + g.cs / 2, gy2 = g.oy + ((goal / COLS) | 0) * g.cs + g.cs / 2;
    const r = Math.max(3, g.cs * 0.42);
    glowCircle(c, sx, sy, r, PALETTE.lime, { glow: 14, width: 2, fill: 'rgba(141,255,77,0.28)' });
    glowCircle(c, gx2, gy2, r, PALETTE.magenta, { glow: 14, width: 2, fill: 'rgba(255,46,136,0.28)' });
    if (g.cs > 9) {
      text(c, 'S', sx, sy + 0.5, { size: g.cs * 0.5, color: '#fff', weight: 900 });
      text(c, 'G', gx2, gy2 + 0.5, { size: g.cs * 0.5, color: '#fff', weight: 900 });
    }
    // 状态角标
    const label = s.done ? (s.found ? `完成 ${s.visited}` : '不可达') : `访问 ${s.visited}`;
    text(c, label, v.x + v.w - 6, v.y + v.h - 8, { size: 10, color: s.done && !s.found ? PALETTE.red : col, align: 'right', weight: 700 });
  }

  const ROWH = 30;
  function drawTable(c) {
    const list = activeList;
    const rows = list.length;
    const w = panelW > 0 ? panelW - 12 : Math.min(300, ctx.W * 0.6);
    const h = 44 + rows * ROWH;
    const x = panelW > 0 ? ctx.W - panelW + 4 : ctx.W - w - 8;
    const y = panelW > 0 ? boardY + 6 : ctx.H - bottomPad - h - 6;
    panel(c, x, y, w, h, { fill: 'rgba(8,12,24,0.86)', stroke: '#243357' });
    text(c, '对比面板', x + 8, y + 14, { size: 12, color: PALETTE.cyan, align: 'left', weight: 800 });
    text(c, refCost === Infinity ? '无解' : '最优 ' + refCost.toFixed(1), x + w - 8, y + 14,
      { size: 11, color: refCost === Infinity ? PALETTE.red : PALETTE.lime, align: 'right', weight: 700 });
    const cols = [x + 8, x + 8 + w * 0.30, x + 8 + w * 0.48, x + 8 + w * 0.66, x + 8 + w * 0.82];
    const hy = y + 30;
    text(c, '算法', cols[0], hy, { size: 10, color: PALETTE.dim, align: 'left' });
    text(c, '访问', cols[1], hy, { size: 10, color: PALETTE.dim, align: 'left' });
    text(c, '步/代价', cols[2], hy, { size: 10, color: PALETTE.dim, align: 'left' });
    text(c, 'ms', cols[3], hy, { size: 10, color: PALETTE.dim, align: 'left' });
    text(c, '最优', cols[4], hy, { size: 10, color: PALETTE.dim, align: 'left' });
    for (let i = 0; i < rows; i++) {
      const s = list[i], ry = hy + 14 + i * ROWH;
      const col = s.def.color;
      const optimal = s.found && refCost !== Infinity && Math.abs(s.pathCost - refCost) < 1e-3;
      const ratio = refCost !== Infinity && s.found ? (s.pathCost / refCost) : 0;
      fillRound(c, x + 4, ry - 1, w - 8, ROWH - 3, 4, rgba(col, s.done ? 0.10 : 0.05));
      text(c, s.def.name, cols[0] + 2, ry + 11, { size: 11, color: col, align: 'left', weight: 800 });
      text(c, String(s.visited), cols[1], ry + 11, { size: 11, color: PALETTE.white, align: 'left' });
      text(c, s.found ? `${s.path.length - 1}/${s.pathCost.toFixed(0)}` : '—', cols[2], ry + 11,
        { size: 10.5, color: ratio > 1.05 ? PALETTE.amber : PALETTE.white, align: 'left' });
      text(c, s.ms.toFixed(1), cols[3], ry + 11, { size: 10.5, color: PALETTE.dim, align: 'left' });
      text(c, s.done ? (s.found ? (optimal ? '✓' : '✗') : '✗') : '…', cols[4], ry + 11,
        { size: 12, color: s.done ? (s.found ? (optimal ? PALETTE.lime : PALETTE.red) : PALETTE.red) : PALETTE.dim, align: 'left', weight: 800 });
      // 访问量条（相对网格总量）
      if (s.done || s.visited) bar(c, x + 6, ry + 22, w - 12, 3, s.visited / (N * 0.6), { fill: col, bg: 'rgba(255,255,255,0.07)' });
    }
  }

  function render(alpha, rdt) {
    const c = ctx.ctx, W = ctx.W, H = ctx.H;
    c.fillStyle = PALETTE.bg;
    c.fillRect(0, 0, W, H);
    // 背景网格
    c.save();
    c.strokeStyle = 'rgba(40,60,110,0.10)'; c.lineWidth = 1; c.beginPath();
    for (let x = 0; x < W; x += 44) { c.moveTo(x + .5, 0); c.lineTo(x + .5, H); }
    for (let y = 0; y < H; y += 44) { c.moveTo(0, y + .5); c.lineTo(W, y + .5); }
    c.stroke(); c.restore();

    const list = activeList;
    for (let i = 0; i < views.length && i < list.length; i++) drawView(c, i, list[i], views[i]);
    drawTable(c);

    // 顶部提示
    text(c, `画笔:${brush === 1 ? '墙' : brush === 2 ? '泥地(代价5)' : '擦除'} · 对角:${diagonal ? '8向' : '4向'} · A*权重:${hWeight.toFixed(1)}`,
      W - 6, 14, { size: 11, color: PALETTE.dim, align: 'right' });

    particles.render(c, 1);
    particles.renderTexts(c, rdt);
    vignette(c, W, H, 0.35);
  }

  // ---------------- 生命周期 ----------------
  function resize(w, h) { layout(w, h); }

  // 初始地形
  terrain();
  layout(ctx.W, ctx.H);
  recalc(false);
  ctx.hud('round', '对比轮次', 0);
  ctx.hud('opt', '最优代价', '—');
  ctx.hud('spd', '速度', SPEED_NAME[speed]);

  return {
    update, render, resize,
    destroy() { }
  };
}
