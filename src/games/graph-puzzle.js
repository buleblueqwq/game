// 图论连线 —— 拖拽连线使每个节点度数达到目标值
import { clamp, lerp, TAU, makeRng, dist } from '../core/math.js';
import { PALETTE, neon, roundRect, text, glowCircle, glowLine } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'graph-puzzle', title: '图论连线', category: 'puzzle', difficulty: 4,
  music: 'puzzle', howto: ['在节点间拖拽连线', '让每个节点度数=目标值', '点击连线可删除'],
  particles: 400
};
export const musicTrack = 'puzzle';

export function create(ctx) {
  const { audio, particles, shake, save, rng } = ctx;
  let nodes = [], edges = new Set(), level = save.get('level', 0) || 0, won = false, t = 0, dragFrom = null, dragTo = null, mx = 0, my = 0;
  let cx = 0, cy = 0, rad = 0;

  function gen() {
    const n = 6 + Math.min(7, level);
    nodes = []; const minD = 90;
    for (let i = 0; i < n; i++) {
      let x, y, ok = false, tries = 0;
      const R = 0.38;
      do { x = rng.range(-R, R); y = rng.range(-R, R); ok = true; for (const o of nodes) if (dist(x, y, o.x, o.y) < minD / 600) ok = false; tries++; } while (!ok && tries < 100);
      nodes.push({ x, y, deg: 0, target: 0, done: false });
    }
    // 生成有解图：随机生成树 + 随机加边
    edges = new Set(); const idxs = nodes.map((_, i) => i); rng.shuffle(idxs);
    for (let i = 1; i < n; i++) { const a = idxs[i], b = idxs[rng.int(0, i - 1)]; edges.add(edgeKey(a, b)); }
    let extra = Math.floor(n * 0.5);
    while (extra > 0) { const a = rng.int(0, n - 1), b = rng.int(0, n - 1); if (a !== b && !edges.has(edgeKey(a, b))) { edges.add(edgeKey(a, b)); extra--; } }
    for (const e of edges) { const [a, b] = e.split('-').map(Number); nodes[a].target++; nodes[b].target++; }
    recalc();
  }
  function edgeKey(a, b) { return a < b ? a + '-' + b : b + '-' + a; }
  function recalc() { for (const nd of nodes) nd.deg = 0; for (const e of edges) { const [a, b] = e.split('-').map(Number); nodes[a].deg++; nodes[b].deg++; } for (const nd of nodes) nd.done = nd.deg === nd.target; }
  function nodeAt(x, y) { for (let i = 0; i < nodes.length; i++) { const nd = nodes[i]; if (dist(x, y, nd.x, nd.y) < rad * 0.22) return i; } return -1; }

  function win() { won = true; audio.sfx('win'); shake.add(0.3); ctx.vibrate(PATTERNS.win); particles.burst(cx, cy, 30, { color: PALETTE.lime, speed: 200, life: .8 }); save.set('level', level + 1); setTimeout(() => { level++; save.set('level', level); gen(); won = false; ctx.hint?.('关卡 ' + (level + 1)); }, 1400); }
  function checkWin() { if (nodes.every(n => n.deg === n.target)) win(); }

  function s2w(e) { const r = ctx.canvas.getBoundingClientRect(); return [(e.clientX - r.left - cx), (e.clientY - r.top - cy)]; }
  function layout(w, h) { cx = w / 2; cy = h / 2 - 10; rad = Math.min(w, h) * 0.4; }

  const off = ctx.listen(ctx.canvas, 'pointerdown', e => { const [x, y] = s2w(e); const i = nodeAt(x, y); if (i >= 0) { dragFrom = i; dragTo = i; [mx, my] = [x, y]; } });
  const off2 = ctx.listen(ctx.canvas, 'pointermove', e => { if (dragFrom === null) return; const [x, y] = s2w(e); mx = x; my = y; const i = nodeAt(x, y); if (i >= 0 && i !== dragFrom) dragTo = i; });
  const off3 = ctx.listen(window, 'pointerup', e => {
    if (dragFrom !== null && dragTo !== null && dragFrom !== dragTo) {
      const k = edgeKey(dragFrom, dragTo);
      if (edges.has(k)) { edges.delete(k); audio.sfx('back'); } else { edges.add(k); audio.sfx('place'); ctx.vibrate(PATTERNS.tap); }
      recalc(); checkWin();
    }
    // 点击连线删除
    dragFrom = dragTo = null;
  });
  const off4 = ctx.listen(ctx.canvas, 'keydown', e => { if (e.key.toLowerCase() === 'r') { gen(); won = false; } });
  const off5 = ctx.listen(ctx.canvas, 'pointerdown', e => {
    // 检测点击已有边删除
    const [x, y] = s2w(e); if (dragFrom !== null) return;
    for (const ed of edges) { const [a, b] = ed.split('-').map(Number); const mxd = (nodes[a].x + nodes[b].x) / 2, myd = (nodes[a].y + nodes[b].y) / 2; if (dist(x, y, mxd, myd) < 14 / 600 * rad) { /* 用最近点 */ } }
  });

  const bar = document.createElement('div'); bar.className = 'overlay-bottom';
  const rb = document.createElement('button'); rb.className = 'btn'; rb.textContent = '↺ 新图'; rb.onclick = () => { gen(); won = false; }; bar.appendChild(rb);
  const rbc = document.createElement('button'); rbc.className = 'btn'; rbc.textContent = '✔ 校验'; rbc.onclick = checkWin; bar.appendChild(rbc);
  ctx.overlay(bar);

  gen(); layout(ctx.W, ctx.H); ctx.hint?.('拖拽点亮所有节点');

  function update(dt) { t += dt; }
  function render(a) {
    const c = ctx.ctx, { W, H } = ctx; c.fillStyle = '#070b16'; c.fillRect(0, 0, W, H);
    c.save(); c.translate(cx, cy);
    // 边
    for (const ed of edges) { const [a, b] = ed.split('-').map(Number); const ca = nodes[a], cb = nodes[b]; const col = (ca.done && cb.done) ? PALETTE.lime : PALETTE.cyan; glowLine(c, ca.x * rad, ca.y * rad, cb.x * rad, cb.y * rad, col, 3, 10); }
    if (dragFrom !== null && dragTo !== null && dragFrom !== dragTo) { const ca = nodes[dragFrom]; glowLine(c, ca.x * rad, ca.y * rad, mx, my, PALETTE.violet, 2, 8); }
    // 节点
    for (const nd of nodes) {
      const r = rad * 0.12; const col = nd.done ? PALETTE.lime : (nd.deg === nd.target ? PALETTE.lime : PALETTE.cyan);
      glowCircle(c, nd.x * rad, nd.y * rad, r, col, { glow: 12, width: 2, fill: 'rgba(20,30,55,.9)' });
      text(c, nd.deg + '/' + nd.target, nd.x * rad, nd.y * rad, { size: r * 0.9, color: '#fff', weight: 800 });
    }
    c.restore();
    particles.render(c, 1);
    if (won) text(c, 'SOLVED', W / 2, H / 2, { size: Math.min(40, W * .08), color: PALETTE.lime, weight: 900, glow: 18 });
  }
  return { update, render, resize: (w, h) => layout(w, h), destroy() { off?.(); off2?.(); off3?.(); off4?.(); off5?.(); } };
}
