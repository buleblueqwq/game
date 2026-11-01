// 记忆矩阵 —— 霓虹 Simon 网格版：复述发光序列（蓝=点，红=忽略），逐级加速并混入干扰
import { clamp, lerp, ease, TAU, makeRng } from '../core/math.js';
import { PALETTE, neon, roundRect, text, bar, glowRect, glowDot } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'memory-grid', title: '记忆矩阵', category: 'puzzle', difficulty: 2,
  music: 'arcade', howto: ['记住闪现的方块序列', '蓝格要按，红格忽略！', 'R 重开'],
  particles: 500
};
export const musicTrack = 'arcade';

export function create(ctx) {
  const { audio, particles, shake, save, rng } = ctx;
  const N = 5;
  let cell = 0, ox = 0, oy = 0;
  let cells = [], state = 'wait', seq = [], inputIdx = 0, level = 1, score = 0;
  let timer = 0, playPtr = 0, best = save.get('best', 0), t = 0, flashIdx = -1;

  function layout(w, h) { const s = Math.min(w, h) - 60; cell = Math.floor(s / N); ox = (w - cell * N) / 2; oy = (h - cell * N) / 2 + 10; }
  function init() { cells = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) cells.push({ x, y, glow: 0, bad: false }); }
  function idx(x, y) { return y * N + x; }

  function newRound() {
    seq = []; inputIdx = 0; state = 'play'; timer = 0; playPtr = 0;
    const len = 2 + level;
    for (let i = 0; i < len; i++) {
      const x = rng.int(0, N - 1), y = rng.int(0, N - 1);
      const bad = level >= 2 && rng.chance(0.22);    // 干扰格
      seq.push({ x, y, bad });
    }
    ctx.hint?.('看序列：蓝=按 红=忽略');
  }
  function startGame() { level = 1; score = 0; init(); newRound(); refresh(); }

  function refresh() {
    ctx.hud('level', '关卡', level);
    ctx.hud('score', '分数', score);
    ctx.hud('best', '最佳', best);
    ctx.hud('progress', '进度', `${inputIdx}/${seq.length}`);
  }

  // 播放序列
  function playStep() {
    const s = seq[playPtr];
    flashIdx = idx(s.x, s.y);
    cells[flashIdx].glow = 1;
    const c = cells[flashIdx];
    if (s.bad) audio.sfx('error'); else audio.sfx('tick');
    particles.burst(ox + s.x * cell + cell / 2, oy + s.y * cell + cell / 2, 8, { color: s.bad ? PALETTE.red : PALETTE.cyan, speed: 90, life: .4 });
    playPtr++;
    if (playPtr >= seq.length) { timer = 0.4; state = 'input'; flashIdx = -1; ctx.hint?.('现在复述：按蓝格，跳过红格'); }
  }

  function tap(x, y) {
    if (state !== 'input') return;
    const c = cells[idx(x, y)]; c.glow = 1;
    particles.burst(ox + x * cell + cell / 2, oy + y * cell + cell / 2, 8, { color: PALETTE.cyan, speed: 90, life: .4 });
    const expected = seq[inputIdx];
    const ok = x === expected.x && y === expected.y && !expected.bad;
    if (ok) {
      audio.sfx('select'); ctx.vibrate(PATTERNS.tap); score += 10 * level; inputIdx++;
      ctx.hud('progress', '进度', `${inputIdx}/${seq.length}`);
      if (inputIdx >= seq.length) {
        score += 50 * level; level++; if (score > best) { best = score; save.set('best', best); }
        audio.sfx('powerup'); shake.add(0.2); state = 'wait'; timer = 0.7; refresh();
      }
    } else if (x === expected.x && y === expected.y && expected.bad) {
      // 误触干扰格
      wrong();
    } else { wrong(); }
  }
  function wrong() {
    audio.sfx('die'); shake.add(0.5); ctx.vibrate(PATTERNS.damage); state = 'over';
    flashIdx = -1;
    for (const s of seq) if (!s.bad) cells[idx(s.x, s.y)].glow = 1;
    setTimeout(() => ctx.finish(score, { stats: [['关卡', level], ['最佳', best]] }), 1100);
  }

  const off = ctx.listen(ctx.canvas, 'keydown', e => { if (e.key.toLowerCase() === 'r') startGame(); });
  const off2 = ctx.listen(ctx.canvas, 'pointerdown', e => {
    const r = ctx.canvas.getBoundingClientRect();
    const px = e.clientX - r.left - ox, py = e.clientY - r.top - oy;
    const x = Math.floor(px / cell), y = Math.floor(py / cell);
    if (x >= 0 && x < N && y >= 0 && y < N) tap(x, y);
  });
  layout(ctx.W, ctx.H); startGame();

  function update(dt) {
    t += dt;
    for (const c of cells) c.glow = Math.max(0, c.glow - dt * 3);
    if (state === 'play') {
      timer -= dt;
      if (timer <= 0) { playStep(); timer = Math.max(0.28, 0.6 - level * 0.02); }
    } else if (state === 'wait') { timer -= dt; if (timer <= 0) newRound(); }
  }
  function render(a) {
    const c = ctx.ctx, { W, H } = ctx;
    c.fillStyle = '#070b16'; c.fillRect(0, 0, W, H);
    c.save(); c.translate(ox, oy);
    for (const cc of cells) {
      const x = cc.x * cell, y = cc.y * cell;
      const g = cc.glow;
      const col = g > 0.5 ? PALETTE.cyan : 'rgba(120,150,220,.12)';
      neon(c, cx => roundRect(cx, x + 4, y + 4, cell - 8, cell - 8, 10), PALETTE.cyan, { glow: 8 + g * 18, width: 2, layers: 2, inner: null, fill: `rgba(34,224,255,${g * 0.25})` });
      if (g > 0.5) glowDot(c, x + cell / 2, y + cell / 2, (cell / 2) * (0.6 + g), PALETTE.cyan, g * 0.5);
    }
    c.restore();
    particles.render(c, 1);
    if (state === 'play') { text(c, '记住…', W / 2, oy - 16, { size: 12, color: PALETTE.dim }); }
    if (state === 'over') { c.fillStyle = 'rgba(5,8,15,.5)'; c.fillRect(0, 0, W, H); text(c, 'GAME OVER', W / 2, H / 2, { size: Math.min(40, W * .08), color: PALETTE.red, weight: 900, glow: 18 }); }
  }
  return { update, render, resize: (w, h) => layout(w, h), destroy() { off?.(); off2?.(); } };
}
