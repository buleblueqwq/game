// 推箱子·重制 —— 撤销、步数、最优评级、内置关卡
import { clamp, lerp, ease, TAU, makeRng } from '../core/math.js';
import { PALETTE, neon, roundRect, text, glowRect, glowCircle } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'sokoban', title: '推箱子·重制', category: 'puzzle', difficulty: 3,
  music: 'puzzle', howto: ['方向键 / WASD 推箱子到目标点', 'Z 撤销 · R 重开', '把所有箱子推到发光格'],
  particles: 300
};
export const musicTrack = 'puzzle';

const LEVELS = [
  ['#####', '#@$.#', '#####'],
  ['#######', '#. #  #', '#  $  #', '#  # .#', '#  $ .#', '#  #  #', '#######'],
  ['#####', '#.#.#', '# $ #', '#.$.#', '#  @ #', '#####'],
  ['######', '#  . #', '# $$ #', '#.$@ #', '#.  .#', '######'],
  [' #### ', '#  ## #', '# # . #', '# $$@ #', '##  . #', ' # .. #', ' #  ###', ' ####  '],
  ['#####', '#   #', '#$#$#', '# $ #', '#.#.#', '# @ #', '#####'],
  [' ####### ', '#  #   # ', '# $# $ # ', '##  #$ ##', ' #  #$  # ', ' # .#. .# ', ' ####### '],
  ['########', '#      #', '# #.$$.#', '# $.@  #', '#   ## #', '#  ... #', '########']
];

export function create(ctx) {
  const { audio, particles, shake, save, rng } = ctx;
  let lvIdx = save.get('level', 0) || 0, grid = [], w = 0, h = 0, cs = 0, ox = 0, oy = 0;
  let px = 0, py = 0, moves = 0, bestMoves = 0, history = [], done = false, best = save.get('best', 0), solved = 0, t = 0;

  function load(i) {
    const map = LEVELS[i % LEVELS.length];
    h = map.length; w = Math.max(...map.map(r => r.length));
    grid = map.map(r => r.split('').map(ch => ({ wall: ch === '#', goal: ch === '.' || ch === '*' || ch === '+', box: ch === '$' || ch === '*', target: ch === '@' || ch === '+' })));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (grid[y][x].target) { px = x; py = y; grid[y][x].target = false; } }
    moves = 0; history = []; done = false; bestMoves = save.get('bestm' + i, 0);
    layout(ctx.W, ctx.H);
  }
  function layout(W, H) { cs = Math.max(18, Math.floor(Math.min(W / (w + 1), H / (h + 2)))); ox = (W - cs * w) / 2; oy = (H - cs * h) / 2 + 6; }
  function inb(x, y) { return x >= 0 && y >= 0 && x < w && y < h; }
  function move(dx, dy) {
    if (done) return;
    const nx = px + dx, ny = py + dy; if (!inb(nx, ny) || grid[ny][nx].wall) { audio.sfx('error'); return; }
    if (grid[ny][nx].box) {
      const bx = nx + dx, by = ny + dy;
      if (!inb(bx, by) || grid[by][bx].wall || grid[by][bx].box) { audio.sfx('error'); return; }
      history.push({ px, py, bx, by, moves });
      grid[by][bx].box = true; grid[ny][nx].box = false; px = nx; py = ny; moves++;
    } else { history.push({ px, py, moves }); px = nx; py = ny; moves++; }
    audio.sfx('place'); ctx.vibrate(PATTERNS.tap);
    if (checkWin()) win(); else refresh();
  }
  function undo() { if (!history.length || done) return; const s = history.pop(); px = s.px; py = s.py; if (s.bx !== undefined) { grid[s.by][s.bx].box = false; grid[s.py][s.px].box = true; } moves = s.moves; audio.sfx('back'); refresh(); }
  function checkWin() { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[y][x].goal && !grid[y][x].box) return false; return true; }
  function win() {
    done = true; solved++; audio.sfx('win'); shake.add(0.3); ctx.vibrate(PATTERNS.win);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[y][x].box) particles.burst(ox + x * cs + cs / 2, oy + y * cs + cs / 2, 14, { color: PALETTE.lime, speed: 130, life: .6 });
    if (bestMoves === 0 || moves < bestMoves) { bestMoves = moves; save.set('bestm' + lvIdx, moves); }
    save.set('level', (lvIdx + 1) % LEVELS.length);
    setTimeout(() => { lvIdx = (lvIdx + 1) % LEVELS.length; save.set('level', lvIdx); load(lvIdx); refresh(); ctx.hint?.('过关！下一关'); }, 1300);
    refresh();
  }
  function refresh() { ctx.hud('lv', '关卡', lvIdx + 1); ctx.hud('moves', '步数', moves); ctx.hud('best', '最优', bestMoves || '-'); }

  const off = ctx.listen(ctx.canvas, 'keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') { e.preventDefault(); move(0, -1); }
    else if (k === 'arrowdown' || k === 's') { e.preventDefault(); move(0, 1); }
    else if (k === 'arrowleft' || k === 'a') { e.preventDefault(); move(-1, 0); }
    else if (k === 'arrowright' || k === 'd') { e.preventDefault(); move(1, 0); }
    else if (k === 'z') undo(); else if (k === 'r') { load(lvIdx); refresh(); }
  });
  let ts = null; const off2 = ctx.listen(ctx.canvas, 'pointerdown', e => ts = { x: e.clientX, y: e.clientY });
  const off3 = ctx.listen(ctx.canvas, 'pointerup', e => {
    if (!ts) return; const dx = e.clientX - ts.x, dy = e.clientY - ts.y;
    if (Math.hypot(dx, dy) > 20) { const adx = Math.abs(dx), ady = Math.abs(dy); if (adx > ady) move(dx > 0 ? 1 : -1, 0); else move(0, dy > 0 ? 1 : -1); }
    ts = null;
  });

  load(lvIdx); refresh(); ctx.hint?.('把所有箱子推到发光格 · Z 撤销');

  function update(dt) { t += dt; }
  function render(a) {
    const c = ctx.ctx, { W, H } = ctx; c.fillStyle = '#070b16'; c.fillRect(0, 0, W, H);
    c.save(); c.translate(ox, oy);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const cell = grid[y][x]; const X = x * cs, Y = y * cs;
      if (cell.wall) { neon(c, cc => roundRect(cc, X + 2, Y + 2, cs - 4, cs - 4, 4), PALETTE.blue, { glow: 6, width: 1.5, layers: 1, inner: null, fill: 'rgba(40,60,110,.5)' }); }
      else { roundRect(c, X + 2, Y + 2, cs - 4, cs - 4, 4); c.fillStyle = 'rgba(255,255,255,.03)'; c.fill(); }
      if (cell.goal) { c.save(); c.translate(X + cs / 2, Y + cs / 2); glowCircle(c, 0, 0, cs * 0.18, PALETTE.lime, { glow: 10, width: 2 }); c.restore(); }
      if (cell.box) {
        const onGoal = cell.goal;
        neon(c, cc => roundRect(cc, X + 5, Y + 5, cs - 10, cs - 10, 4), onGoal ? PALETTE.lime : PALETTE.amber, { glow: 10, width: 2, layers: 2, inner: '#fff8', fill: (onGoal ? 'rgba(141,255,77,.2)' : 'rgba(255,176,32,.2)') });
      }
    }
    // 玩家
    c.save(); c.translate(px * cs + cs / 2, py * cs + cs / 2);
    glowCircle(c, 0, 0, cs * 0.3, PALETTE.cyan, { glow: 14, width: 2, fill: 'rgba(34,224,255,.25)' });
    c.fillStyle = '#fff'; c.beginPath(); c.arc(0, 0, cs * 0.1, 0, TAU); c.fill();
    c.restore();
    c.restore();
    particles.render(c, 1);
    if (done) text(c, 'CLEAR!', W / 2, oy - 4, { size: 14, color: PALETTE.lime, weight: 800 });
  }
  return { update, render, resize: (W, H) => layout(W, H), destroy() { off?.(); off2?.(); off3?.(); } };
}
