// 逻辑电路 —— 在空格放置导线，连接输入/门/输出，点亮目标灯
import { clamp, lerp, TAU, ease, dist } from '../core/math.js';
import { PALETTE, neon, roundRect, text, glowRect, glowCircle } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'logic-circuit', title: '逻辑电路', category: 'puzzle', difficulty: 5,
  music: 'puzzle', howto: ['点击空白格放导线', '点击 I 切换输入开关', '点亮右下角 O 目标灯'],
  particles: 400
};
export const musicTrack = 'puzzle';

// 关卡字符：'I' 输入(可切换) 'O' 输出 'A' AND 'R' OR 'N' NOT 'D' DELAY '#' 墙 '.' 空(可放导线)
const LV = [
  { grid: [
    ['#', '#', '#', '#', '#', '#', '#'],
    ['#', 'I', '.', 'A', '.', 'O', '#'],
    ['#', '.', '.', '.', '.', '.', '#'],
    ['#', '#', '#', '#', '#', '#', '#']], hint: '把 I 与 A 连通，A 输出到 O' },
  { grid: [
    ['#', '#', '#', '#', '#', '#', '#', '#'],
    ['#', 'I', '.', 'R', '.', 'O', '.', '#'],
    ['#', 'I', '.', '.', '.', '.', '.', '#'],
    ['#', '#', '#', '#', '#', '#', '#', '#']], hint: '两个输入 OR 后点亮 O' },
  { grid: [
    ['#', '#', '#', '#', '#', '#', '#', '#'],
    ['#', 'I', '.', '.', 'N', '.', 'O', '#'],
    ['#', '#', '#', '.', '.', '.', '#', '#'],
    ['#', '#', '#', '#', '#', '#', '#', '#']], hint: '非门：输入开则输出灭' },
  { grid: [
    ['#', '#', '#', '#', '#', '#', '#', '#', '#'],
    ['#', 'I', '.', 'A', '.', 'D', '.', 'O', '#'],
    ['#', 'I', '.', '.', '.', '.', '.', '.', '#'],
    ['#', '#', '#', '#', '#', '#', '#', '#', '#']], hint: 'AND 后接延迟，点亮 O' },
  { grid: [
    ['#', '#', '#', '#', '#', '#', '#', '#', '#'],
    ['#', 'I', '.', 'A', '.', 'R', '.', 'O', '#'],
    ['#', 'I', '.', '.', '.', '.', '.', '.', '#'],
    ['#', 'I', '.', 'A', '.', '.', '.', '.', '#'],
    ['#', '#', '#', '#', '#', '#', '#', '#', '#']], hint: '两组 AND 再 OR' },
  { grid: [
    ['#', '#', '#', '#', '#', '#', '#', '#', '#'],
    ['#', 'I', '.', 'N', '.', 'A', '.', 'O', '#'],
    ['#', 'I', '.', '.', '.', '.', '.', '.', '#'],
    ['#', '#', '#', '.', '#', '#', '.', '#', '#'],
    ['#', '#', '#', '#', '#', '#', '#', '#', '#']], hint: '先非再与' }
];

export function create(ctx) {
  const { audio, particles, shake, save, rng } = ctx;
  let lvIdx = save.get('level', 0) || 0, rows, cols, grid, cell = 0, ox = 0, oy = 0;
  let won = false, t = 0, done = false, outOn = false;

  function parse(i) {
    const src = LV[i % LV.length]; rows = src.grid.length; cols = src.grid[0].length;
    grid = src.grid.map((row, y) => row.map((ch, x) => ({ ch, x, y, wire: false, level: 0, prev: 0, gateOut: 0, on: false })));
  }
  function layout(w, h) { cell = Math.floor(Math.min(w / cols, h / rows) * 0.88); ox = (w - cell * cols) / 2; oy = (h - cell * rows) / 2; }
  function isGate(ch) { return 'ARN'.includes(ch); }

  function tick() {
    // 读取输入端口：IN 在左/上相邻；门 input 在左/上相邻 WIRE
    // 先算每个 WIRE 的新电平 = 邻居中 IN.on 或 门输出指向它
    const newWire = [];
    for (const r of grid) for (const c of r) {
      if (!c.wire) continue;
      let v = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.x + dx, ny = c.y + dy; if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = grid[ny][nx];
        if (n.ch === 'I' && n.on) v = 1;
        if (isGate(n.ch) && n.gateOut && pointsToMe(n, dx, dy)) v = 1;
      }
      newWire.push([c, v]);
    }
    // 门计算（输入 = 左/上相邻 WIRE.prev）
    for (const r of grid) for (const c of r) {
      if (isGate(c.ch)) {
        let a = 0, b = 0;
        for (const [dx, dy] of [[-1, 0], [0, -1]]) { const nx = c.x + dx, ny = c.y + dy; if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && grid[ny][nx].wire) { if (dx === -1 && !a) a = grid[ny][nx].prev; if (dy === -1 && !b) b = grid[ny][nx].prev; } }
        if (c.ch === 'A') c.gateOut = a && b ? 1 : 0;
        else if (c.ch === 'R') c.gateOut = a || b ? 1 : 0;
        else if (c.ch === 'N') c.gateOut = a ? 0 : 1;
      }
    }
    // 应用 wire 新电平 + 计算 OUT
    let out = 0;
    for (const [c, v] of newWire) { c.prev = c.level; c.level = v; }
    for (const r of grid) for (const c of r) { if (c.ch === 'O') { let v = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = c.x + dx, ny = c.y + dy; if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && grid[ny][nx].wire) v = Math.max(v, grid[ny][nx].level); } c.level = v; if (v) out = 1; } }
    outOn = out;
    if (out && !done) win();
    else if (!out && done) { done = false; }
  }
  function pointsToMe(gate, dx, dy) {
    // 门输出端口在 右/下
    return (dx === 1 && gate.gateOut) || (dy === 1 && gate.gateOut) || (dx === -1 && false) || (dy === -1 && false);
  }

  function click(gx, gy, right) {
    if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return;
    const c = grid[gy][gx];
    if (right) { if (c.wire) { c.wire = false; audio.sfx('back'); tick(); } return; }
    if (c.ch === 'I') { c.on = !c.on; audio.sfx('tick'); ctx.vibrate(PATTERNS.tap); tick(); return; }
    if (c.ch === '.') { c.wire = !c.wire; audio.sfx('place'); ctx.vibrate(PATTERNS.tap); tick(); }
  }
  function win() { done = true; won = true; audio.sfx('win'); shake.add(0.3); ctx.vibrate(PATTERNS.win); particles.burst(...center(), 20, { color: PALETTE.lime, speed: 160, life: .6 }); save.set('level', (lvIdx + 1) % LV.length); setTimeout(() => { lvIdx = (lvIdx + 1) % LV.length; save.set('level', lvIdx); parse(lvIdx); layout(ctx.W, ctx.H); done = false; refresh(); ctx.hint?.(LV[lvIdx % LV.length].hint); }, 1500); }

  function center() { let sx = 0, sy = 0, n = 0; for (const r of grid) for (const c of r) if (c.ch === 'O') { sx = ox + c.x * cell + cell / 2; sy = oy + c.y * cell + cell / 2; n++; } return [sx, sy]; }
  function refresh() { ctx.hud('lv', '关卡', lvIdx + 1); ctx.hud('out', '输出', outOn ? 'ON' : 'OFF'); }

  const off = ctx.listen(ctx.canvas, 'pointerdown', e => {
    const r = ctx.canvas.getBoundingClientRect(); const gx = Math.floor((e.clientX - r.left - ox) / cell), gy = Math.floor((e.clientY - r.top - oy) / cell);
    click(gx, gy, e.button === 2);
  });
  const off2 = ctx.listen(ctx.canvas, 'contextmenu', e => e.preventDefault());
  const off3 = ctx.listen(ctx.canvas, 'keydown', e => { if (e.key.toLowerCase() === 'r') { parse(lvIdx); layout(ctx.W, ctx.H); done = false; tick(); refresh(); } });

  const bar = document.createElement('div'); bar.className = 'overlay-bottom';
  bar.innerHTML = '<span style="color:var(--dim);font-size:12px;align-self:center">点击空格放导线 · 点 I 切换 · 右键删除</span>';
  const rb = document.createElement('button'); rb.className = 'btn'; rb.textContent = '↺ 重置'; rb.onclick = () => { parse(lvIdx); layout(ctx.W, ctx.H); done = false; tick(); refresh(); }; bar.appendChild(rb);
  ctx.overlay(bar);

  parse(lvIdx); layout(ctx.W, ctx.H); tick(); refresh(); ctx.hint?.(LV[lvIdx % LV.length].hint);

  function update(dt) { t += dt; }
  function w2s(x, y) { return [ox + x * cell + cell / 2, oy + y * cell + cell / 2]; }
  function render(a) {
    const c = ctx.ctx, { W, H } = ctx; c.fillStyle = '#070b16'; c.fillRect(0, 0, W, H);
    c.save();
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const o = grid[y][x], X = ox + x * cell, Y = oy + y * cell; const [sx, sy] = w2s(x, y);
      if (o.ch === '#') neon(c, cc => roundRect(cc, X + 1, Y + 1, cell - 2, cell - 2, 3), '#3a4a6e', { glow: 2, width: 1, layers: 1, inner: null, fill: 'rgba(25,35,62,.9)' });
      else roundRect(c, X + 1, Y + 1, cell - 2, cell - 2, 4), c.fillStyle = 'rgba(255,255,255,.02)', c.fill();
      if (o.wire) { const col = o.level ? PALETTE.cyan : 'rgba(80,110,160,.4)'; glowRect(c, X + cell * 0.18, Y + cell * 0.18, cell * 0.64, cell * 0.64, col, { glow: o.level ? 10 : 0, width: 2, r: 4, fill: o.level ? 'rgba(34,224,255,.2)' : 'rgba(40,60,100,.2)' }); }
      if (o.ch === 'I') { glowCircle(c, sx, sy, cell * 0.3, o.on ? PALETTE.lime : PALETTE.dim, { glow: o.on ? 12 : 3, width: 2, fill: o.on ? 'rgba(141,255,77,.25)' : 'rgba(80,100,140,.15)' }); text(c, 'IN', sx, sy, { size: 9, color: '#fff' }); }
      if (o.ch === 'O') { glowCircle(c, sx, sy, cell * 0.32, o.level ? PALETTE.lime : PALETTE.dim, { glow: o.level ? 16 : 4, width: 2, fill: o.level ? 'rgba(141,255,77,.3)' : 'rgba(80,100,140,.15)' }); text(c, 'OUT', sx, sy, { size: 8, color: '#fff' }); }
      if (isGate(o.ch)) { const col = PALETTE.violet; glowRect(c, X + cell * 0.12, Y + cell * 0.12, cell * 0.76, cell * 0.76, col, { glow: 6, width: 2, r: 4, fill: 'rgba(168,85,247,.16)' }); text(c, o.ch, sx, sy, { size: cell * 0.4, color: '#fff', weight: 800 }); }
    }
    c.restore();
    if (done) text(c, 'SOLVED', W / 2, H / 2, { size: Math.min(40, W * .08), color: PALETTE.lime, weight: 900, glow: 18 });
  }
  return { update, render, resize: (w, h) => layout(w, h), destroy() { off?.(); off2?.(); off3?.(); } };
}
