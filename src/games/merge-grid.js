// 合成 2048 —— 霓虹版：滑动合并、撤销、连击、动画插值
import { clamp, lerp, ease, TAU } from '../core/math.js';
import { PALETTE, neon, roundRect, text, bar, glowRect } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';
import { makeRng } from '../core/math.js';

export const meta = {
  id: 'merge-grid', title: '合成 2048', category: 'classic', difficulty: 2,
  music: 'menu', howto: ['方向键 / WASD / 滑动 合成相同数字', 'R 撤销', '目标：合成 2048'],
  particles: 500
};
export const musicTrack = 'menu';

const N = 4;
const COLORS = { 2: '#3b82f6', 4: '#22d3ee', 8: '#28e0a0', 16: '#8dff4d', 32: '#ffb020', 64: '#ff8a20', 128: '#ff5e7a', 256: '#ff2e88', 512: '#a855f7', 1024: '#7c3aed', 2048: '#22e0ff', 4096: '#eaf2ff' };

export function create(ctx) {
  const { audio, particles, shake, save, rng } = ctx;
  let grid = [], cells = [], cell = 0, ox = 0, oy = 0;
  let score = 0, best = save.get('best', 0), won = false, over = false;
  let undoStack = [], moveAnim = 0, combo = 0, bestCombo = 0;

  function emptyGrid() { return Array.from({ length: N }, () => Array(N).fill(0)); }

  function layout(w, h) {
    const s = Math.min(w, h) - 20;
    cell = Math.floor(s / (N + 0.4));
    ox = Math.round((w - cell * N) / 2);
    oy = Math.round((h - cell * N) / 2 + 10);
  }

  function newGame() {
    grid = emptyGrid(); cells = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) cells.push({ x, y, v: 0, sv: 0, anim: 0, merge: 0 });
    score = 0; won = false; over = false; combo = 0; bestCombo = 0; undoStack = [];
    spawn(); spawn();
    refreshHud();
  }
  function spawn() {
    const e = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!grid[y][x]) e.push([x, y]);
    if (!e.length) return;
    const [x, y] = e[rng.int(0, e.length - 1)];
    grid[y][x] = rng.chance(0.9) ? 2 : 4;
    const c = cellAt(x, y); c.sv = 0; c.anim = 1;
    particles.burst(ox + x * cell + cell / 2, oy + y * cell + cell / 2, 8, { color: PALETTE.cyan, speed: 80, life: .4 });
  }
  function cellAt(x, y) { return cells[y * N + x]; }

  function snapshot() { undoStack.push(JSON.stringify(grid) + '|' + score); if (undoStack.length > 8) undoStack.shift(); }

  function move(dx, dy) {
    if (over || moveAnim > 0) return;
    snapshot();
    let moved = false, gained = 0, merges = 0;
    const order = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) order.push([x, y]);
    if (dx > 0) order.sort((a, b) => b[0] - a[0]); else if (dx < 0) order.sort((a, b) => a[0] - b[0]);
    else if (dy > 0) order.sort((a, b) => b[1] - a[1]); else order.sort((a, b) => a[1] - b[1]);

    for (const [x, y] of order) {
      if (!grid[y][x]) continue;
      let nx = x, ny = y;
      while (true) {
        const tx = nx + dx, ty = ny + dy;
        if (tx < 0 || ty < 0 || tx >= N || ty >= N) break;
        if (!grid[ty][tx]) { nx = tx; ny = ty; continue; }
        if (grid[ty][tx] === grid[y][x] && !cellAt(tx, ty).merged) {
          // 合并
          const v = grid[y][x];
          grid[ny][nx] = 0;
          grid[ty][tx] = v * 2;
          const c = cellAt(tx, ty); c.merged = true; c.sv = v; c.merge = 1; c.anim = 0;
          gained += v * 2; merges++; moved = true;
          const fx = ox + tx * cell + cell / 2, fy = oy + ty * cell + cell / 2;
          particles.burst(fx, fy, 12, { color: COLORS[v * 2] || PALETTE.cyan, speed: 140, life: .5, size: 3 });
          particles.ring(fx, fy, COLORS[v * 2] || PALETTE.cyan, cell);
          audio.sfx('coin'); ctx.vibrate(PATTERNS.tap);
          break;
        }
        break;
      }
      if (nx !== x || ny !== y) { grid[ny][nx] = grid[y][x]; grid[y][x] = 0; cellAt(nx, ny).sv = grid[ny][nx]; cellAt(nx, ny).anim = 1; moved = true; }
    }
    // 清除 merge 标记
    for (const c of cells) c.merged = false;
    if (moved) {
      combo++; bestCombo = Math.max(bestCombo, combo);
      score += gained + combo * 5;
      moveAnim = 1; spawn();
      if (score > best) { best = score; save.set('best', best); }
      if (!won && grid.flat().includes(2048)) { won = true; audio.sfx('win'); shake.add(0.5); particles.text(ox + N * cell / 2, oy + N * cell / 2, '2048!', '#22e0ff'); }
      refreshHud();
      if (isOver()) { over = true; setTimeout(() => ctx.finish(score, { stats: [['最大连击', bestCombo], ['最佳', best]] }), 900); }
    } else { undoStack.pop(); combo = 0; }
  }
  function isOver() {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!grid[y][x]) return false;
      if (x < N - 1 && grid[y][x] === grid[y][x + 1]) return false;
      if (y < N - 1 && grid[y][x] === grid[y + 1][x]) return false;
    }
    return true;
  }
  function undo() {
    if (!undoStack.length || over) return;
    const s = undoStack.pop().split('|'); grid = JSON.parse(s[0]); score = +s[1];
    for (const c of cells) c.v = 0; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) cellAt(x, y).v = grid[y][x];
    audio.sfx('back'); refreshHud();
  }
  function refreshHud() {
    ctx.hud('score', '分数', score);
    ctx.hud('combo', '连击', 'x' + combo);
    ctx.hud('best', '最佳', best);
  }

  // 输入
  const off = ctx.listen(ctx.canvas, 'keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'w'].includes(k)) { e.preventDefault(); move(0, -1); }
    else if (['arrowdown', 's'].includes(k)) { e.preventDefault(); move(0, 1); }
    else if (['arrowleft', 'a'].includes(k)) { e.preventDefault(); move(-1, 0); }
    else if (['arrowright', 'd'].includes(k)) { e.preventDefault(); move(1, 0); }
    else if (k === 'r') undo();
  });
  let ts = null;
  const off2 = ctx.listen(ctx.canvas, 'pointerdown', e => ts = { x: e.clientX, y: e.clientY });
  const off3 = ctx.listen(ctx.canvas, 'pointerup', e => {
    if (!ts) return; const dx = e.clientX - ts.x, dy = e.clientY - ts.y;
    if (Math.hypot(dx, dy) > 24) { const adx = Math.abs(dx), ady = Math.abs(dy); if (adx > ady) move(dx > 0 ? 1 : -1, 0); else move(0, dy > 0 ? 1 : -1); }
    else { /* tap: undo */ }
    ts = null;
  });
  ctx.hudRemove?.('score'); newGame();
  ctx.hint?.('滑动或方向键合成数字到 2048');

  layout(ctx.W, ctx.H);

  function update(dt) {
    moveAnim = Math.max(0, moveAnim - dt * 4);
    for (const c of cells) {
      const target = grid[c.y][c.x];
      c.v = lerp(c.v, target, 1 - Math.exp(-18 * dt));
      if (c.anim > 0) c.anim = Math.max(0, c.anim - dt * 5);
      if (c.merge > 0) c.merge = Math.max(0, c.merge - dt * 3);
    }
  }
  function render(a) {
    const c = ctx.ctx, { W, H } = ctx;
    c.fillStyle = '#070b16'; c.fillRect(0, 0, W, H);
    // 棋盘底盘
    c.save(); c.translate(ox, oy);
    glowRect(c, -8, -8, cell * N + 16, cell * N + 16, PALETTE.blue, { glow: 14, width: 2, r: 12, fill: 'rgba(12,18,34,.9)' });
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      roundRect(c, x * cell + 3, y * cell + 3, cell - 6, cell - 6, 8); c.fillStyle = 'rgba(255,255,255,.04)'; c.fill();
    }
    // 方块
    for (const cc of cells) {
      const v = Math.round(cc.v);
      if (v <= 0 && grid[cc.y][cc.x] === 0) continue;
      const val = grid[cc.y][cc.x] || v;
      if (!val) continue;
      const sc = 1 + cc.anim * 0.18 + cc.merge * 0.12;
      const sz = (cell - 6) * sc;
      const cx = cc.x * cell + 3 + (cell - 6) / 2, cy = cc.y * cell + 3 + (cell - 6) / 2;
      drawTile(c, cx, cy, sz, val);
    }
    c.restore();
    particles.render(c, 1);
    if (over) { c.fillStyle = 'rgba(5,8,15,.55)'; c.fillRect(0, 0, W, H); text(c, won ? 'PERFECT' : 'GAME OVER', W / 2, H / 2, { size: Math.min(44, W * .09), color: PALETTE.red, weight: 900, glow: 18 }); }
    if (won && !over) text(c, '已达成 2048！可继续挑战', W / 2, oy - 4, { size: 11, color: PALETTE.cyan });
  }
  function drawTile(c, cx, cy, sz, val) {
    const col = COLORS[val] || '#eaf2ff';
    const x = cx - sz / 2, y = cy - sz / 2;
    neon(c, cc => roundRect(cc, x, y, sz, sz, 8), col, { glow: 16, width: 2, layers: 2, inner: null, fill: col + '20' });
    text(c, String(val), cx, cy, { size: clamp(sz * 0.34, 12, 40), color: val > 4 ? '#fff' : '#cfe', weight: 800 });
  }

  return { update, render, resize: (w, h) => layout(w, h), destroy() { off?.(); off2?.(); off3?.(); } };
}
