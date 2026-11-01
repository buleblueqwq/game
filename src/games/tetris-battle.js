// 俄罗斯方块·对战 —— 7-bag、锁定延迟、T-Spin、AI 对手垃圾行对战
import { clamp, makeRng } from '../core/math.js';
import { PALETTE, glowRect, text, bar, vignette, roundRect } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'tetris-battle', title: '俄罗斯方块·对战', category: 'classic', difficulty: 3,
  music: 'arcade', howto: ['← → 移动 · ↑/Z 旋转 · ↓ 软降', '空格 = 硬降 · C = 暂存 · 消行向对手发垃圾行'],
  particles: 800
};
export const musicTrack = 'arcade';

const COLS = 10, ROWS = 22, HIDDEN = 2;
const SHAPES = {
  I: [[[0,1],[1,1],[2,1],[3,1]],[[2,0],[2,1],[2,2],[2,3]],[[0,2],[1,2],[2,2],[3,2]],[[1,0],[1,1],[1,2],[1,3]]],
  O: [[[0,0],[1,0],[0,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]]],
  T: [[[1,0],[0,1],[1,1],[2,1]],[[1,0],[1,1],[2,1],[1,2]],[[0,1],[1,1],[2,1],[1,2]],[[1,0],[0,1],[1,1],[1,2]]],
  S: [[[1,0],[2,0],[0,1],[1,1]],[[1,0],[1,1],[2,1],[2,2]],[[1,1],[2,1],[0,2],[1,2]],[[0,0],[0,1],[1,1],[1,2]]],
  Z: [[[0,0],[1,0],[1,1],[2,1]],[[2,0],[1,1],[2,1],[1,2]],[[0,1],[1,1],[1,2],[2,2]],[[1,0],[0,1],[1,1],[0,2]]],
  J: [[[0,0],[0,1],[1,1],[2,1]],[[1,0],[2,0],[1,1],[1,2]],[[0,1],[1,1],[2,1],[2,2]],[[1,0],[1,1],[0,2],[1,2]]],
  L: [[[2,0],[0,1],[1,1],[2,1]],[[1,0],[1,1],[1,2],[2,2]],[[0,1],[1,1],[2,1],[0,2]],[[0,0],[1,0],[1,1],[1,2]]]
};
const TYPES = ['I','O','T','S','Z','J','L'];
const COLORS = { I: PALETTE.cyan, O: PALETTE.amber, T: PALETTE.violet, S: PALETTE.lime, Z: PALETTE.red, J: PALETTE.blue, L: '#ff9f43' };
const GARBAGE = 9;

function emptyGrid() { return Array.from({ length: ROWS }, () => new Array(COLS).fill(0)); }

class Board {
  constructor(isAI, rng) {
    this.isAI = isAI; this.rng = rng; this.reset();
  }
  reset() {
    this.grid = emptyGrid(); this.bag = []; this.pending = 0; this.cur = null;
    this.next = this._next(); this.hold = null; this.canHold = true;
    this.lockT = 0; this.lockResets = 0; this.dead = false; this.lines = 0;
    this.combo = -1; this.lastSpin = false; this.attack = 0; this.t = 0;
    this.aiTarget = null; this.aiT = 0;
    this._spawn();
  }
  _next() {
    if (this.bag.length === 0) { this.bag = TYPES.slice(); for (let i = this.bag.length - 1; i > 0; i--) { const j = this.rng.int(0, i);[this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]]; } }
    return this.bag.pop();
  }
  _spawn(type) {
    const t = type || this._next();
    const x = (t === 'I' || t === 'O') ? 3 : (t === 'O' ? 4 : 3);
    const p = { type: t, rot: 0, x, y: 0 };
    if (this._hit(p, 0, 0)) { this.dead = true; return false; }
    this.cur = p; this.lockT = 0; this.lockResets = 0; this.lastSpin = false; this.canHold = true;
    this.aiTarget = null;
    return true;
  }
  _cells(p) { return SHAPES[p.type][p.rot].map(([cx, cy]) => [p.x + cx, p.y + cy]); }
  _hit(p, dx, dy) {
    for (const [x, y] of this._cells(p)) {
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y >= 0 && this.grid[y][x]) return true;
    }
    return false;
  }
  move(dx) { if (this.cur && !this._hit(this.cur, dx, 0)) { this.cur.x += dx; this._resetLock(); return true; } return false; }
  rotate(dir) {
    if (!this.cur) return false;
    const nr = (this.cur.rot + (dir > 0 ? 1 : 3)) % 4;
    const p = { ...this.cur, rot: nr };
    for (const [kx, ky] of [[0,0],[-1,0],[1,0],[-2,0],[2,0],[0,-1]]) {
      p.x = this.cur.x + kx; p.y = this.cur.y + ky;
      if (!this._hit(p, 0, 0)) {
        const wasSpin = this.cur.type === 'T';
        this.cur = p; this.lastSpin = wasSpin; this._resetLock();
        return true;
      }
    }
    return false;
  }
  _resetLock() { if (this.lockResets < 15) { this.lockT = 0; this.lockResets++; } }
  softDrop() { if (this.cur && !this._hit(this.cur, 0, 1)) { this.cur.y++; this._resetLock(); return true; } return false; }
  hardDrop() {
    if (!this.cur) return;
    let d = 0; while (!this._hit(this.cur, 0, 1)) { this.cur.y++; d++; }
    this.lock(true);
  }
  hold_() {
    if (!this.canHold || !this.cur) return;
    const cur = this.cur.type;
    if (this.hold) { const h = this.hold; this.hold = cur; this._spawn(h); }
    else { this.hold = cur; this._spawn(); }
    this.canHold = false;
  }
  lock(hard) {
    const p = this.cur;
    let spin = false;
    if (this.lastSpin && p.type === 'T') {
      const cx = p.x + 1, cy = p.y + 1;
      let corners = 0;
      for (const [ox, oy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) { const x = cx + ox, y = cy + oy; if (x < 0 || x >= COLS || y >= ROWS || (y >= 0 && this.grid[y][x])) corners++; }
      spin = corners >= 3;
    }
    for (const [x, y] of this._cells(p)) if (y >= 0) this.grid[y][x] = TYPES.indexOf(p.type) + 1;
    const cleared = this._clear();
    this.combo = cleared > 0 ? this.combo + 1 : -1;
    let atk = 0;
    if (cleared > 0) {
      const base = [0, 0, 1, 2, 4][cleared] || 0;
      const bonus = spin ? (cleared > 0 ? 2 + cleared : 1) : 0;
      atk += base + bonus + Math.max(0, this.combo) * 0.5;
      this.lines += cleared;
    }
    if (atk > 0) {
      const cancel = Math.min(this.pending, Math.floor(atk));
      this.pending -= cancel; atk -= cancel;
      this.attack += Math.floor(atk);
    } else if (cleared === 0 && this.pending > 0) {
      this._addGarbage(Math.min(this.pending, 8)); this.pending = Math.max(0, this.pending - 8);
    }
    if (!this._spawn()) this.dead = true;
  }
  _clear() {
    let c = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (this.grid[y].every(v => v)) {
        this.grid.splice(y, 1); this.grid.unshift(new Array(COLS).fill(0)); c++; y++;
      }
    }
    return c;
  }
  _addGarbage(n) {
    const hole = this.rng.int(0, COLS - 1);
    for (let i = 0; i < n; i++) {
      this.grid.shift();
      const row = new Array(COLS).fill(GARBAGE);
      row[hole] = 0;
      this.grid.push(row);
    }
  }
  _resetLockGuard() {}
  gravity(g) {
    if (!this.cur) return;
    if (!this._hit(this.cur, 0, 1)) { this.cur.y++; this.lockT = 0; }
    else { this.lockT += g; if (this.lockT >= 0.5) this.lock(false); }
  }
}

// ---- AI：评估每个落点 ----
function evalBoard(grid) {
  let agg = 0, holes = 0, bump = 0; const hs = new Array(COLS).fill(0);
  for (let x = 0; x < COLS; x++) { let seen = false; for (let y = 0; y < ROWS; y++) { if (grid[y][x]) { if (!seen) { hs[x] = ROWS - y; seen = true; } } else if (seen) holes++; } agg += hs[x]; }
  for (let x = 0; x < COLS - 1; x++) bump += Math.abs(hs[x] - hs[x + 1]);
  return -0.51 * agg + 0.76 * 0 - 0.36 * holes - 0.18 * bump;
}
function aiChoose(board) {
  let best = null, bestScore = -1e9;
  const type = board.cur.type;
  for (let rot = 0; rot < 4; rot++) {
    for (let x = -2; x < COLS; x++) {
      // 复制到临时网格
      const g = board.grid.map(r => r.slice());
      const cells = SHAPES[type][rot];
      let py = -2; let ok = true;
      const place = (yy) => cells.every(([cx, cy]) => { const X = x + cx, Y = yy + cy; return X >= 0 && X < COLS && Y < ROWS && (Y < 0 || !g[Y][X]); });
      if (!place(py)) continue;
      while (place(py + 1)) py++;
      // 写入
      let top = 0;
      for (const [cx, cy] of cells) { const X = x + cx, Y = py + cy; if (Y >= 0) { g[Y][X] = TYPES.indexOf(type) + 1; top = Math.max(top, Y); } }
      // 清行
      let lines = 0;
      for (let y = ROWS - 1; y >= 0; y--) if (g[y].every(v => v)) { g.splice(y, 1); g.unshift(new Array(COLS).fill(0)); lines++; y++; }
      const sc = evalBoard(g) + lines * 4;
      if (sc > bestScore) { bestScore = sc; best = { rot, x }; }
    }
  }
  return best;
}
function aiStep(board, dt) {
  if (!board.cur || board.dead) return;
  if (!board.aiTarget) board.aiTarget = aiChoose(board);
  const tg = board.aiTarget; if (!tg) { board.hardDrop(); return; }
  board.aiT += dt;
  if (board.aiT < 0.06) return;
  board.aiT = 0;
  if (board.cur.rot !== tg.rot) { board.rotate(1); return; }
  if (board.cur.x < tg.x) { if (!board.move(1)) board.hardDrop(); return; }
  if (board.cur.x > tg.x) { if (!board.move(-1)) board.hardDrop(); return; }
  board.hardDrop(); board.aiTarget = null;
}

export function create(ctx) {
  const { input, audio, particles, save, rng } = ctx;
  const state = { player: new Board(false, rng), ai: new Board(true, makeRng((rng.int(0, 1e9)))), t: 0, over: false, winner: null, best: save.get('best', 0), W: ctx.W, H: ctx.H, lT: 0, rT: 0, prev: {} };

  function layout(w, h) { state.W = w; state.H = h; }
  layout(ctx.W, ctx.H);

  ctx.hud('lines', '消行', 0);
  ctx.hud('pending', '待受垃圾', 0);
  ctx.hud('enemy', '对手消行', 0);

  function playerInput(dt) {
    const b = state.player; if (!b.cur || b.dead) return;
    // DAS 左右
    const das = (key, sign, timerKey) => {
      if (input.justPressed(key)) { b.move(sign); state[timerKey] = 0.16; }
      else if (input.isDown(key)) { state[timerKey] -= dt; if (state[timerKey] <= 0) { b.move(sign); state[timerKey] = 0.045; } }
      else state[timerKey] = 0;
    };
    das('left', -1, 'lT'); das('right', 1, 'rT');
    if (input.justPressed('up') || input.justPressed('primary')) b.rotate(1);
    if (input.justPressed('secondary') || input.justPressed('skill1')) b.rotate(-1);
    if (input.isDown('down')) { if (!b.softDrop()) {} }
    if (input.justPressed('jump')) { b.hardDrop(); audio.sfx('lock'); ctx.vibrate(PATTERNS.lock); }
    if (input.justPressed('interact')) { b.hold_(); audio.sfx('swap'); }
  }

  function checkOver() {
    if (state.over) return;
    if (state.player.dead || state.ai.dead) {
      state.over = true;
      state.winner = state.ai.dead && !state.player.dead ? '你' : state.player.dead && !state.ai.dead ? 'AI' : (state.player.lines >= state.ai.lines ? '你' : 'AI');
      const win = state.winner === '你';
      if (state.player.lines > state.best) { state.best = state.player.lines; save.set('best', state.best); }
      audio.sfx(win ? 'win' : 'lose'); ctx.vibrate(win ? PATTERNS.win : PATTERNS.lose);
      ctx.finish(state.player.lines, { win, higherBetter: true, stats: [['对手消行', state.ai.lines], ['最佳', state.best]] });
    }
  }

  function update(dt) {
    state.t += dt;
    if (state.over) return;
    playerInput(dt);
    // 重力
    const gl = Math.max(0.05, 0.8 - state.player.lines * 0.012);
    const gv = input.isDown('down') ? gl * 0.08 : gl;
    state.player.gravity(gv);
    state.ai.gravity(0.5 - Math.min(0.35, state.ai.lines * 0.01));
    aiStep(state.ai, dt);
    // 交换攻击
    if (state.player.attack > 0) { state.ai.pending += state.player.attack; state.player.attack = 0; }
    if (state.ai.attack > 0) { state.player.pending += state.ai.attack; state.ai.attack = 0; }
    // HUD
    ctx.hud('lines', '消行', state.player.lines);
    ctx.hud('pending', '待受垃圾', state.player.pending);
    ctx.hud('enemy', '对手消行', state.ai.lines);
    checkOver();
  }

  // ---- 渲染 ----
  function drawBoard(c, b, ox, oy, cell, label, accent) {
    const w = COLS * cell, h = ROWS * cell;
    c.fillStyle = 'rgba(8,12,24,.86)'; roundRect(c, ox - 4, oy - 4, w + 8, h + 8, 8); c.fill();
    c.strokeStyle = accent + '55'; c.lineWidth = 1.5; c.stroke();
    c.save(); c.beginPath(); roundRect(c, ox, oy, w, h, 6); c.clip();
    for (let y = HIDDEN; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const v = b.grid[y][x]; if (!v) continue;
      const col = v === GARBAGE ? '#5a6478' : Object.values(COLORS)[v - 1];
      const px = ox + x * cell, py = oy + (y - HIDDEN) * cell;
      c.fillStyle = col; c.fillRect(px + 1, py + 1, cell - 2, cell - 2);
      c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(px + 1, py + 1, cell - 2, 2);
    }
    if (b.cur) for (const [x, y] of b._cells(b.cur)) { if (y < HIDDEN) continue; const px = ox + x * cell, py = oy + (y - HIDDEN) * cell; c.fillStyle = COLORS[b.cur.type]; c.globalAlpha = 0.9; c.fillRect(px + 1, py + 1, cell - 2, cell - 2); c.globalAlpha = 1; }
    c.restore();
    text(c, label, ox, oy - 10, { size: 12, color: accent, weight: 700 });
    // 待受垃圾条
    if (b.pending > 0) { bar(c, ox, oy + h + 6, w, 5, Math.min(1, b.pending / 8), { fill: PALETTE.red }); }
  }
  function drawMini(c, type, ox, oy, cell, label) {
    text(c, label, ox, oy - 6, { size: 11, color: PALETTE.dim });
    const cells = SHAPES[type][0]; const s = cell * 0.7;
    for (const [x, y] of cells) { c.fillStyle = COLORS[type]; c.fillRect(ox + x * s, oy + y * s, s - 1, s - 1); }
  }

  function render(alpha, rdt = 0.016) {
    const c = ctx.ctx; const { W, H } = ctx;
    c.fillStyle = '#05060f'; c.fillRect(0, 0, W, H);
    const cell = Math.max(10, Math.floor(Math.min((H - 120) / (ROWS - HIDDEN), (W * 0.42) / COLS)));
    const boardW = COLS * cell;
    const gap = Math.min(40, W * 0.05);
    const totalW = boardW * 2 + gap;
    const x0 = (W - totalW) / 2;
    const oy = (H - (ROWS - HIDDEN) * cell) / 2 + 10;
    drawBoard(c, state.player, x0, oy, cell, '你', PALETTE.cyan);
    drawBoard(c, state.ai, x0 + boardW + gap, oy, cell, 'AI', PALETTE.red);
    // next / hold
    const by = oy - 4;
    drawMini(c, state.player.next, x0, by - 70, cell, 'NEXT');
    if (state.player.hold) drawMini(c, state.player.hold, x0, by - 36, cell, 'HOLD');
    // 攻击连线提示
    if (state.player.pending > 0) text(c, '⚠ 受击', x0 + boardW / 2, oy + (ROWS - HIDDEN) * cell + 22, { size: 12, color: PALETTE.red, align: 'center', weight: 700 });
    if (state.ai.pending > 0) text(c, '⚠ 受击', x0 + boardW + gap + boardW / 2, oy + (ROWS - HIDDEN) * cell + 22, { size: 12, color: PALETTE.red, align: 'center', weight: 700 });
    vignette(c, W, H, 0.4);
  }

  function resize(w, h) { layout(w, h); }
  return { update, render, resize };
}
