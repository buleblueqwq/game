// 激光折射 —— 在空格放置镜子/分光器，把激光引导到接收器
import { clamp, lerp, TAU, ease, dist } from '../core/math.js';
import { PALETTE, neon, roundRect, text, glowLine, glowCircle, glowRect } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'laser-refraction', title: '激光折射', category: 'puzzle', difficulty: 4,
  music: 'puzzle', howto: ['从底部栏拖/点选元件', '点击空格放置（再点旋转）', '点亮所有接收器 R'],
  particles: 600
};
export const musicTrack = 'puzzle';

// 关卡：网格字符
// '#' 墙  '.' 空(可放)  '>' '<' '^' 'v' 发射器(方向)  'R' 接收器  'Z' 预设 '/'  'X' 预设 '\'  'S' 预设分光器
const LV = [
  { grid: [
    ['#', '#', '#', '#', '#', '#', '#', '#', '#', '#'],
    ['#', '>', '.', '.', '.', '.', '.', '.', 'R', '#'],
    ['#', '#', '#', '#', '#', '#', '#', '#', '#', '#']], inv: { M: 2 }, sol: 2 },
  { grid: [
    ['#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#'],
    ['#', '>', '.', '.', '.', '#', '.', '.', '.', '.', 'R', '#'],
    ['#', '.', '.', '.', '.', '#', '.', '#', '#', '#', '#', '#'],
    ['#', '#', '#', '#', '#', '#', '.', '.', '.', '.', 'R', '#'],
    ['#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#']], inv: { M: 3 }, sol: 2 },
  { grid: [
    ['#', '#', '#', '#', '#', '#', '#', '#', '#', '#'],
    ['#', '>', '.', '.', '.', '.', '.', '.', '.', '#'],
    ['#', '#', '#', '.', '#', '#', '#', '.', '.', '#'],
    ['#', '.', '.', '.', '.', 'R', '#', '#', '.', '#'],
    ['#', '#', '#', '#', '#', '#', '#', '#', '.', '#'],
    ['#', 'R', '.', '.', '.', '.', '.', '.', '.', '#'],
    ['#', '#', '#', '#', '#', '#', '#', '#', '#', '#']], inv: { M: 4 }, sol: 2 },
  { grid: [
    ['#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#'],
    ['#', '>', '.', '.', '.', '.', '.', '.', '.', '.', '.', '#'],
    ['#', '#', '.', '#', '#', '#', '#', '#', '#', '#', '.', '#'],
    ['#', '.', '.', '.', '.', 'R', '#', '#', '#', '#', '.', '#'],
    ['#', '#', '#', '#', '#', '.', '#', '#', '#', '#', '.', '#'],
    ['#', 'R', '.', '.', '.', '.', '.', '.', '.', '.', '.', '#'],
    ['#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#']], inv: { M: 5, S: 1 }, sol: 2 },
  { grid: [
    ['#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#'],
    ['#', 'v', '#', '#', '.', '.', '.', '#', '#', '.', '.', '#'],
    ['#', '.', '.', '.', '.', '#', '.', '.', '.', '.', 'R', '#'],
    ['#', '.', '#', '#', '.', '#', '#', '#', '#', '#', '#', '#'],
    ['#', '.', '.', '.', '.', 'R', '#', '.', '.', '.', '.', '#'],
    ['#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#']], inv: { M: 5 }, sol: 2 },
  { grid: [
    ['#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#'],
    ['#', '>', '.', '.', '.', '.', '.', '.', '.', '.', 'R', '#'],
    ['#', '#', '#', '.', '#', '#', '#', '#', '#', '.', '#', '#'],
    ['#', 'R', '.', '.', '.', 'S', '.', '.', '.', '.', 'R', '#'],
    ['#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#']], inv: { M: 4, S: 1 }, sol: 3 }
];

export function create(ctx) {
  const { audio, particles, shake, save, rng } = ctx;
  let lvIdx = save.get('level', 0) || 0, cols, rows, grid, cell = 0, ox = 0, oy = 0;
  let placed = {}, inv = {}, won = false, selected = 'M', beams = [], t = 0, best = save.get('best', 0), done = false;

  function parse(i) {
    const src = LV[i % LV.length]; rows = src.grid.length; cols = src.grid[0].length; inv = { ...src.inv };
    grid = src.grid.map((row, y) => row.map((ch, x) => ({ ch, x, y, placed: null, rot: 0 })));
    placed = {};
  }
  function layout(w, h) { cell = Math.floor(Math.min(w / cols, h / rows) * 0.92); ox = (w - cell * cols) / 2; oy = (h - cell * rows) / 2; }

  function trace() {
    beams = []; const queue = []; const seen = new Set();
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const ch = grid[y][x].ch;
      if ('><^v'.includes(ch)) { const dir = { '>': [1, 0], '<': [-1, 0], '^': [0, -1], 'v': [0, 1] }[ch]; queue.push({ x, y, dx: dir[0], dy: dir[1] }); }
    }
    let steps = 0;
    while (queue.length && steps < 2000) {
      const seg = queue.shift(); steps++;
      let { x, y, dx, dy } = seg;
      // 沿方向步进直到离开或遇元件
      const pts = [{ x, y }];
      while (true) {
        x += dx; y += dy; steps++;
        if (x < 0 || y < 0 || x >= cols || y >= rows) { pts.push({ x, y }); break; }
        const cellObj = grid[y][x]; const ch = cellObj.placed ? cellObj.placed.type : cellObj.ch;
        if (ch === '#') { pts.push({ x, y }); break; }
        if (cellObj.ch === 'R') { pts.push({ x, y }); cellObj.lit = true; break; }
        if (ch === 'M' || ch === 'Z' || ch === 'X' || ch === 'S' || cellObj.placed) {
          pts.push({ x, y });
          // 反射/分光
          const type = cellObj.placed ? cellObj.placed.type : ch;
          const rot = cellObj.placed ? cellObj.placed.rot : 0;
          const slash = (type === 'M') ? (rot ? '\\' : '/') : (type === 'Z' ? '/' : type === 'X' ? '\\' : null);
          if (slash === '/') { const nd = [-dy, -dx]; dx = nd[0]; dy = nd[1]; continue; }
          else if (slash === '\\') { const nd = [dy, dx]; dx = nd[0]; dy = nd[1]; continue; }
          else if (type === 'S') {
            beams.push({ pts, color: PALETTE.cyan });
            const nd1 = [-dy, -dx], nd2 = [dy, dx];
            const k = x + ',' + y + ',' + nd1[0] + ',' + nd1[1]; if (!seen.has(k)) { seen.add(k); queue.push({ x, y: y, dx: nd1[0], dy: nd1[1] }); }
            const x2 = x + nd2[0], y2 = y + nd2[1]; if (x2 >= 0 && y2 >= 0 && x2 < cols && y2 < rows && grid[y2][x2].ch !== '#') { const k2 = x2 + ',' + y2 + ',' + nd2[0] + ',' + nd2[1]; if (!seen.has(k2)) { seen.add(k2); queue.push({ x: x2, y: y2, dx: nd2[0], dy: nd2[1] }); } }
            break;
          }
        }
      }
      if (ch_ends(pts[pts.length - 1])) {}
      beams.push({ pts, color: PALETTE.cyan });
    }
    // 检查通关
    let allLit = true;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (grid[y][x].ch === 'R' && !grid[y][x].lit) allLit = false;
    if (allLit && !done) win();
  }
  function ch_ends(p) { return p.x < 0 || p.y < 0; }

  function placeOrRotate(x, y) {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const cellObj = grid[y][x];
    if (!'.'.includes(cellObj.ch)) { audio.sfx('error'); return; }
    if (!cellObj.placed) {
      if ((inv[selected] || 0) <= 0) { audio.sfx('error'); return; }
      inv[selected]--; cellObj.placed = { type: selected === 'M' ? 'M' : 'S', rot: 0 }; audio.sfx('place'); ctx.vibrate(PATTERNS.tap);
    } else {
      // 旋转 '/' <-> '\'
      cellObj.placed.rot ^= 1; audio.sfx('tick');
    }
    trace();
  }
  function erase(x, y) {
    const cellObj = grid[y] && grid[y][x]; if (!cellObj || !cellObj.placed) return;
    inv[cellObj.placed.type === 'M' ? 'M' : 'S']++; cellObj.placed = null; audio.sfx('back'); trace();
  }

  function win() { done = true; won = true; audio.sfx('win'); shake.add(0.3); ctx.vibrate(PATTERNS.win); save.set('level', (lvIdx + 1) % LV.length); setTimeout(() => { lvIdx = (lvIdx + 1) % LV.length; save.set('level', lvIdx); parse(lvIdx); layout(ctx.W, ctx.H); done = false; trace(); refresh(); ctx.hint?.('关卡 ' + (lvIdx + 1)); }, 1400); }

  function refresh() { ctx.hud('lv', '关卡', lvIdx + 1); ctx.hud('inv', '镜/分', (inv.M || 0) + '/' + (inv.S || 0)); }

  // 交互：点击放置，右键擦除
  const off = ctx.listen(ctx.canvas, 'pointerdown', e => {
    const r = ctx.canvas.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const gx = Math.floor((sx - ox) / cell), gy = Math.floor((sy - oy) / cell);
    if (e.button === 2) erase(gx, gy); else placeOrRotate(gx, gy);
  });
  const off2 = ctx.listen(ctx.canvas, 'contextmenu', e => e.preventDefault());
  const off3 = ctx.listen(ctx.canvas, 'keydown', e => { if (e.key.toLowerCase() === 'r') { parse(lvIdx); layout(ctx.W, ctx.H); done = false; trace(); refresh(); } });

  // 底部元件栏
  const bar = document.createElement('div'); bar.className = 'overlay-bottom';
  for (const [k, label, col] of [['M', '镜子 /', PALETTE.cyan], ['S', '分光器', PALETTE.violet]]) {
    const b = document.createElement('button'); b.className = 'btn btn-ghost'; b.textContent = label; b.style.borderColor = k === selected ? col : '';
    b.onclick = () => { selected = k; [...bar.children].forEach(c => c.style.borderColor = ''); b.style.borderColor = col; };
    bar.appendChild(b);
  }
  const resetBtn = document.createElement('button'); resetBtn.className = 'btn'; resetBtn.textContent = '↺ 重置'; resetBtn.onclick = () => { parse(lvIdx); layout(ctx.W, ctx.H); done = false; trace(); refresh(); }; bar.appendChild(resetBtn);
  ctx.overlay(bar);

  parse(lvIdx); layout(ctx.W, ctx.H); trace(); refresh(); ctx.hint?.('放置镜子把光引到所有 R');

  function update(dt) { t += dt; }
  function w2s(x, y) { return [ox + x * cell + cell / 2, oy + y * cell + cell / 2]; }
  function render(a) {
    const c = ctx.ctx, { W, H } = ctx; c.fillStyle = '#070b16'; c.fillRect(0, 0, W, H);
    c.save();
    // 网格
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const o = grid[y][x], X = ox + x * cell, Y = oy + y * cell;
      if (o.ch === '#') neon(c, cc => roundRect(cc, X + 1, Y + 1, cell - 2, cell - 2, 3), '#3a4a6e', { glow: 2, width: 1, layers: 1, inner: null, fill: 'rgba(30,42,72,.9)' });
      else { roundRect(c, X + 1, Y + 1, cell - 2, cell - 2, 3); c.fillStyle = 'rgba(255,255,255,.02)'; c.fill(); }
      const ch = o.ch;
      if ('><^v'.includes(ch)) { const [sx, sy] = w2s(x, y); c.save(); c.translate(sx, sy); glowCircle(c, 0, 0, cell * 0.22, PALETTE.red, { glow: 12, width: 2, fill: 'rgba(255,77,94,.25)' }); c.restore(); }
      if (o.ch === 'R') { const [sx, sy] = w2s(x, y); glowCircle(c, sx, sy, cell * 0.3, o.lit ? PALETTE.lime : PALETTE.dim, { glow: o.lit ? 16 : 4, width: 2, fill: o.lit ? 'rgba(141,255,77,.25)' : 'rgba(120,140,180,.1)' }); }
      if (o.placed) { const [sx, sy] = w2s(x, y); c.strokeStyle = o.placed.type === 'S' ? PALETTE.violet : PALETTE.cyan; c.lineWidth = 3; c.shadowColor = c.strokeStyle; c.shadowBlur = 10; c.beginPath(); if (o.placed.rot) { c.moveTo(sx - cell * .3, sy - cell * .3); c.lineTo(sx + cell * .3, sy + cell * .3); } else { c.moveTo(sx - cell * .3, sy + cell * .3); c.lineTo(sx + cell * .3, sy - cell * .3); } c.stroke(); c.shadowBlur = 0; }
    }
    // 光束
    for (const b of beams) {
      c.strokeStyle = b.color; c.lineWidth = 3; c.shadowColor = b.color; c.shadowBlur = 14;
      c.beginPath(); for (let i = 0; i < b.pts.length; i++) { const [sx, sy] = w2s(b.pts[i].x, b.pts[i].y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); } c.stroke();
      // 流动光点
      if (b.pts.length > 1) { const p0 = b.pts[0], p1 = b.pts[b.pts.length - 1]; const f = (t * 0.5) % 1; const fx = lerp(w2s(p0.x, p0.y)[0], w2s(p1.x, p1.y)[0], f), fy = lerp(w2s(p0.x, p0.y)[1], w2s(p1.x, p1.y)[1], f); glowCircle(c, fx, fy, 4, PALETTE.white, { glow: 8 }); }
      c.shadowBlur = 0;
    }
    c.restore();
    if (done) text(c, 'SOLVED', W / 2, H / 2, { size: Math.min(40, W * .08), color: PALETTE.lime, weight: 900, glow: 18 });
  }
  return { update, render, resize: (w, h) => layout(w, h), destroy() { off?.(); off2?.(); off3?.(); } };
}
