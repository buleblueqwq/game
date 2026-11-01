// 六边形扫雷 —— 六边形网格、首次安全、递归展开、旗标记
import { clamp, lerp, ease, TAU, makeRng, hexPath as _hp } from '../core/math.js';
import { PALETTE, neon, roundRect, text, glowRect } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'hex-minesweeper', title: '六边形扫雷', category: 'puzzle', difficulty: 3,
  music: 'puzzle', howto: ['点击翻开六边形', '右键/长按 插旗标记雷', '标记所有雷即胜'],
  particles: 400
};
export const musicTrack = 'puzzle';

export function create(ctx) {
  const { audio, particles, shake, save, rng } = ctx;
  const RINGS = 4;                 // 六边形半径（环数）
  let R = 0, cx0 = 0, cy0 = 0, Wd = 0, Hd = 0;
  let tiles = [], started = false, over = false, won = false, flags = 0, mines = 0, revealed = 0, best = save.get('best', 0), score = 0, t = 0;

  // 轴向坐标六边形网格
  function build() {
    tiles = []; const seen = new Set();
    for (let q = -RINGS; q <= RINGS; q++) {
      for (let r = -RINGS; r <= RINGS; r++) {
        const s = -q - r;
        if (Math.abs(s) <= RINGS) { const key = q + ',' + r; if (!seen.has(key)) { seen.add(key); tiles.push({ q, r, mine: false, open: false, flag: false, n: 0, reveal: 0, px: 0, py: 0 }); } }
      }
    }
  }
  function layout(w, h) {
    Wd = w; Hd = h; R = Math.min(w, h) / (RINGS * 2 + 2) * 0.86;
    cx0 = w / 2; cy0 = h / 2 - 6;
    for (const t of tiles) {
      // pointy-top 六边形：x = R*√3*(q + r/2), y = R*3/2*r
      t.px = cx0 + R * Math.sqrt(3) * (t.q + t.r / 2);
      t.py = cy0 + R * 1.5 * t.r;
    }
  }
  function neighbors(t) {
    const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const out = [];
    for (const [dq, dr] of dirs) { const nt = tiles.find(x => x.q === t.q + dq && x.r === t.r + dr); if (nt) out.push(nt); }
    return out;
  }
  function placeMines(safe) {
    const pool = tiles.filter(t => t !== safe);
    for (let i = pool.length - 1; i > 0; i--) { const j = rng.int(0, i); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    mines = Math.max(5, Math.round(tiles.length * 0.16));
    for (let i = 0; i < mines; i++) pool[i].mine = true;
    for (const t of tiles) t.n = neighbors(t).filter(x => x.mine).length;
  }
  function openTile(t) {
    if (t.open || t.flag) return;
    if (!started) { started = true; placeMines(t); }
    flood(t);
    refresh();
    if (t.mine) { over = true; audio.sfx('explode'); shake.add(0.7); ctx.vibrate(PATTERNS.damage); particles.burst(t.px, t.py, 24, { color: PALETTE.red, speed: 220, life: .7 }); revealAll(); setTimeout(() => ctx.finish(score, { stats: [['标记', flags], ['最佳', best]] }), 900); }
    else checkWin();
  }
  function flood(t) {
    if (t.open || t.flag || t.mine) return;
    const stack = [t];
    while (stack.length) {
      const x = stack.pop();
      if (x.open || x.flag || x.mine) continue;
      x.open = true; x.reveal = 1; revealed++;
      audio.sfx('click');
      if (x.n === 0) for (const nb of neighbors(x)) if (!nb.open && !nb.mine && !nb.flag) stack.push(nb);
    }
  }
  function toggleFlag(t) {
    if (t.open) return;
    t.flag = !t.flag; flags += t.flag ? 1 : -1; audio.sfx('lock'); ctx.vibrate(PATTERNS.tap); refresh(); checkWin();
  }
  function checkWin() {
    if (tiles.every(x => x.mine ? x.flag : x.open)) {
      won = true; over = true; score = Math.max(0, Math.round((tiles.length - mines) * 10 - flags * 0 + 200));
      if (score > best) { best = score; save.set('best', best); }
      audio.sfx('win'); shake.add(0.4); setTimeout(() => ctx.finish(score, { win: true, stats: [['标记', flags], ['最佳', best]] }), 700);
    }
  }
  function revealAll() { for (const t of tiles) if (t.mine) t.open = true; }
  function refresh() { ctx.hud('mines', '剩余雷', Math.max(0, mines - flags)); ctx.hud('clear', '已开', revealed); ctx.hud('best', '最佳', best); }

  // 命中检测：点到最近六边形
  function pick(px, py) {
    let best = null, bd = 1e9;
    for (const t of tiles) { const d = (t.px - px) ** 2 + (t.py - py) ** 2; if (d < bd) { bd = d; best = t; } }
    return (Math.sqrt(bd) < R) ? best : null;
  }

  const off = [];
  off.push(ctx.listen(ctx.canvas, 'keydown', e => { if (e.key.toLowerCase() === 'r') restart(); }));
  off.push(ctx.listen(ctx.canvas, 'contextmenu', e => e.preventDefault()));
  let longT = null, longTimer = 0;
  off.push(ctx.listen(ctx.canvas, 'pointerdown', e => { longT = e; longTimer = setTimeout(() => { if (longT) { const t = pick(...toLocal(longT)); if (t) toggleFlag(t); longT = null; } }, 380); }));
  off.push(ctx.listen(ctx.canvas, 'pointerup', e => {
    clearTimeout(longTimer); if (!longT) return;
    const t = pick(...toLocal(e));
    if (t) { if (e.button === 2) toggleFlag(t); else openTile(t); }
    longT = null;
  }));
  function toLocal(e) { const r = ctx.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  function restart() { started = over = won = false; flags = 0; revealed = 0; score = 0; for (const t of tiles) { t.mine = t.open = t.flag = false; t.n = 0; } refresh(); ctx.hint?.('点击任意格开始（首点必安全）'); }
  build(); layout(ctx.W, ctx.H); restart(); ctx.hint?.('点击任意格开始（首点必安全）');

  function update(dt) { t += dt; for (const t of tiles) t.reveal = Math.max(0, t.reveal - dt * 4); }
  function render(a) {
    const c = ctx.ctx, { W, H } = ctx; c.fillStyle = '#070b16'; c.fillRect(0, 0, W, H);
    c.save(); c.lineWidth = 1.4;
    for (const t of tiles) {
      c.save(); c.translate(t.px, t.py);
      hexPath(c, 0, 0, R * 0.92);
      if (t.open && !t.mine) { c.fillStyle = 'rgba(34,224,255,.06)'; c.fill(); c.strokeStyle = 'rgba(34,224,255,.35)'; }
      else if (t.mine && over) { c.fillStyle = 'rgba(255,77,94,.5)'; c.fill(); c.strokeStyle = PALETTE.red; }
      else { c.fillStyle = 'rgba(20,30,55,.7)'; c.fill(); c.strokeStyle = 'rgba(90,120,190,.4)'; }
      c.stroke();
      if (t.flag && !t.open) { c.fillStyle = PALETTE.amber; c.beginPath(); c.moveTo(0, -R * .4); c.lineTo(R * .35, R * .3); c.lineTo(-R * .35, R * .3); c.closePath(); c.fill(); }
      if (t.open && !t.mine && t.n > 0) {
        const col = [PALETTE.cyan, '#22e0ff', '#28e0a0', '#ffb020', '#ff8a20', '#ff2e88'][Math.min(t.n, 5)];
        text(c, String(t.n), 0, 0, { size: R * .55, color: col, weight: 800 });
      }
      c.restore();
    }
    c.restore();
    if (!started) text(c, '点击任意格开始', W / 2, H - 24, { size: 12, color: PALETTE.dim });
    if (over && won) { c.fillStyle = 'rgba(5,8,15,.4)'; c.fillRect(0, 0, W, H); text(c, 'CLEARED', W / 2, H / 2, { size: Math.min(40, W * .08), color: PALETTE.green, weight: 900, glow: 18 }); }
  }
  function hexPath(c, x, y, r) { c.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * TAU / 6; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? c.lineTo(px, py) : c.moveTo(px, py); } c.closePath(); }
  return { update, render, resize: (w, h) => layout(w, h), destroy() { off.forEach(f => f()); } };
}
