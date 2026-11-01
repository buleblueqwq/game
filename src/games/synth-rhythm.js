// 合成器音游 —— 实时 WebAudio 合成鼓机 + 贝斯 + 琶音；玩家在音符逼近圈收拢到目标环时敲击
import { clamp, TAU, makeRng } from '../core/math.js';
import { PALETTE, glowCircle, glowLine, text, bar, vignette } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'synth-rhythm', title: '合成器音游', category: 'rhythm', difficulty: 3,
  music: 'space', howto: ['点击 / 空格 = 敲击', '逼近圈收拢到目标环时命中', '全曲实时合成，跟住律动'],
  particles: 1000
};
export const musicTrack = 'space';

const BPM = 128;
const BEAT = 60 / BPM;
const APPROACH = 2;          // 逼近时长（拍）
const TOTAL_BEATS = 200;     // 约 94 秒
const WIN = { perfect: 0.05, good: 0.11, ok: 0.18 };
const DEG_COLORS = [PALETTE.cyan, PALETTE.magenta, PALETTE.lime, PALETTE.amber, PALETTE.violet, PALETTE.blue];
const SCALE = [0, 2, 3, 5, 7, 8, 10]; // 小调

export function create(ctx) {
  const { input, audio, particles, save, rng } = ctx;
  const state = {
    t: 0, notes: [], nextBeat: 0, beatIdx: 0, spawnedTo: -1,
    score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, ok: 0, miss: 0, accW: 0, accN: 0,
    best: save.get('best', 0), finished: false, judge: '', judgeT: 0, judgeColor: '#fff',
    prevSpace: false, prevEnter: false, W: ctx.W, H: ctx.H, flash: 0
  };

  function layout(w, h) { state.W = w; state.H = h; }
  layout(ctx.W, ctx.H);

  function genChart() {
    const notes = [];
    const start = 8;
    for (let b = start; b < TOTAL_BEATS - 2; b++) {
      const r = rng();
      if (r < 0.12) continue;                 // 偶尔留白
      if (r < 0.22 && b < TOTAL_BEATS - 4) {  // 双押
        const a1 = rng.angle(); const a2 = a1 + Math.PI + rng.range(-0.6, 0.6);
        notes.push(mk(b, a1)); notes.push(mk(b, a2));
      } else {
        notes.push(mk(b, rng.angle()));
      }
    }
    function mk(b, ang) { return { ang, t: b * BEAT, deg: rng.int(0, SCALE.length - 1), hit: false, dead: false }; }
    return notes;
  }
  state.notes = genChart();

  function hub() { return { cx: state.W / 2, cy: state.H * 0.52, R: Math.min(state.W, state.H) * 0.30 }; }

  function playBeat(bi) {
    const bar = bi % 4;
    // kick
    audio.tone({ freq: 160, to: 46, type: 'sine', dur: 0.14, gain: 0.5 });
    // hat
    audio.noise({ dur: 0.035, gain: 0.10, freq: 7000, filter: 'highpass' });
    // snare on 2 & 4
    if (bar === 1 || bar === 3) {
      audio.noise({ dur: 0.13, gain: 0.22, freq: 2200, to: 900, filter: 'bandpass', q: 1 });
      audio.tone({ freq: 210, to: 160, type: 'triangle', dur: 0.1, gain: 0.12 });
    }
    // bass
    if (bar === 0 || bar === 2) {
      const root = 36 + [0, 0, 5, 7][bar === 0 ? 0 : 1];
      audio.tone({ freq: 440 * Math.pow(2, (root - 69) / 12), type: 'sawtooth', dur: 0.22, gain: 0.18, filter: 420 });
    }
    // arp pluck（旋律）
    const deg = SCALE[(bi * 2) % SCALE.length];
    audio.tone({ freq: 440 * Math.pow(2, (60 + deg - 69) / 12), type: 'triangle', dur: 0.16, gain: 0.14, reverb: 0.3 });
  }

  function setJudge(txt, color) { state.judge = txt; state.judgeColor = color; state.judgeT = 0.5; }

  function hit(lane) {
    const now = state.t;
    let best = null, bestDt = 1e9;
    for (const n of state.notes) {
      if (n.dead || n.hit) continue;
      const dt = Math.abs(n.t - now);
      if (dt < bestDt) { bestDt = dt; best = n; }
    }
    if (!best || bestDt > WIN.ok) return;
    const kind = bestDt <= WIN.perfect ? 'perfect' : bestDt <= WIN.good ? 'good' : 'ok';
    const val = kind === 'perfect' ? 100 : kind === 'good' ? 60 : 30;
    state.combo++; state.maxCombo = Math.max(state.maxCombo, state.combo);
    const mult = 1 + Math.min(2, state.combo * 0.02);
    state.score += Math.round(val * mult);
    state.accW += (kind === 'perfect' ? 1 : kind === 'good' ? 0.65 : 0.3); state.accN++;
    if (kind === 'perfect') state.perfect++; else if (kind === 'good') state.good++; else state.ok++;
    setJudge(kind === 'perfect' ? 'PERFECT' : kind === 'good' ? 'GOOD' : 'OK',
      kind === 'perfect' ? PALETTE.cyan : kind === 'good' ? PALETTE.lime : PALETTE.amber);
    const { cx, cy, R } = hub();
    const x = cx + Math.cos(best.ang) * R, y = cy + Math.sin(best.ang) * R;
    best.hit = true; best.dead = true;
    audio.tone({ freq: 880 * Math.pow(2, best.deg / 12), type: 'sine', dur: 0.18, gain: 0.2, reverb: 0.4 });
    particles.burst(x, y, kind === 'perfect' ? 18 : 11, { color: DEG_COLORS[best.deg], speed: 200, life: .55 });
    particles.ring(x, y, DEG_COLORS[best.deg], R * 0.3);
    ctx.vibrate(kind === 'perfect' ? PATTERNS.tap : PATTERNS.select);
    state.flash = 0.12;
  }

  function miss(n) { n.dead = true; state.combo = 0; state.miss++; state.accW += 0; state.accN++; setJudge('MISS', PALETTE.red); audio.sfx('error'); ctx.vibrate(PATTERNS.error); }

  ctx.hud('score', '分数', 0);
  ctx.hud('combo', '连击', 0);
  ctx.hud('acc', '准确率', '100%');

  function update(dt) {
    state.t += dt;
    if (state.finished) return;
    if (state.judgeT > 0) state.judgeT -= dt;
    if (state.flash > 0) state.flash -= dt;

    // 节拍合成
    while (state.nextBeat <= state.t) {
      playBeat(state.beatIdx);
      state.beatIdx++; state.nextBeat += BEAT;
    }

    // 漏判
    for (const n of state.notes) { if (!n.dead && !n.hit && n.t < state.t - WIN.ok) miss(n); }

    // 输入
    const p = input.pointer;
    if (p && p.justDown) hit();
    const sp = input.rawDown('Space'), en = input.rawDown('Enter');
    if ((sp && !state.prevSpace) || (en && !state.prevEnter)) hit();
    state.prevSpace = sp; state.prevEnter = en;

    ctx.hud('score', '分数', state.score);
    ctx.hud('combo', '连击', state.combo);
    const acc = state.accN ? Math.round((state.accW / state.accN) * 100) : 100;
    ctx.hud('acc', '准确率', acc + '%');

    if (state.beatIdx >= TOTAL_BEATS && state.t > state.notes[state.notes.length - 1].t + 1) finish();
  }

  function finish() {
    if (state.finished) return; state.finished = true;
    const acc = state.accN ? (state.accW / state.accN) * 100 : 0;
    if (state.score > state.best) { state.best = state.score; save.set('best', state.best); }
    audio.sfx(acc > 90 ? 'win' : 'lose');
    ctx.vibrate(acc > 90 ? PATTERNS.win : PATTERNS.lose);
    ctx.finish(state.score, {
      win: acc > 85, higherBetter: true,
      stats: [['准确率', acc.toFixed(1) + '%'], ['最大连击', state.maxCombo], ['Perfect', state.perfect], ['Miss', state.miss]]
    });
  }

  function render(alpha, rdt = 0.016) {
    const c = ctx.ctx; const { W, H } = ctx;
    c.fillStyle = '#04060f'; c.fillRect(0, 0, W, H);
    const { cx, cy, R } = hub();
    const phase = (state.t % BEAT) / BEAT;
    const pulse = 1 + (1 - phase) * 0.12;

    // 目标环
    glowCircle(c, cx, cy, R, PALETTE.white, { glow: 14, width: 2, fill: 'rgba(255,255,255,.03)' });
    // 中心枢纽
    glowCircle(c, cx, cy, R * 0.16 * pulse, PALETTE.cyan, { glow: 20, fill: 'rgba(34,224,255,.18)' });
    // 节拍辐条
    const beatFlash = 1 - phase;
    c.strokeStyle = `rgba(120,160,255,${0.05 + beatFlash * 0.12})`;
    c.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8;
      glowLine(c, cx + Math.cos(a) * R * 0.22, cy + Math.sin(a) * R * 0.22, cx + Math.cos(a) * R, cy + Math.sin(a) * R, `rgba(120,160,255,${0.05 + beatFlash * 0.1})`, 1, 6);
    }

    // 音符 + 逼近圈
    for (const n of state.notes) {
      if (n.dead) continue;
      const dt = n.t - state.t;
      if (dt > APPROACH || dt < -WIN.ok) continue;
      const x = cx + Math.cos(n.ang) * R, y = cy + Math.sin(n.ang) * R;
      const col = DEG_COLORS[n.deg];
      if (dt >= 0) {
        const k = dt / APPROACH;                  // 1→0
        const ar = R * (1 + 0.9 * k);             // 逼近圈半径
        c.strokeStyle = col; c.lineWidth = 3; c.globalAlpha = 0.8;
        c.beginPath(); c.arc(x, y, ar, 0, TAU); c.stroke(); c.globalAlpha = 1;
      }
      glowCircle(c, x, y, R * 0.07 * (1 + (dt < 0 ? -dt * 4 : 0)), col, { glow: 12, fill: col + '55' });
    }

    // 判定文字
    if (state.judgeT > 0) {
      const a = clamp(state.judgeT / 0.5, 0, 1);
      text(c, state.judge, cx, cy - R - 30, { size: 24, color: state.judgeColor, weight: 900, glow: 16, alpha: a, align: 'center' });
    }
    text(c, '连击 ' + state.combo, W / 2, 36, { size: 18, color: state.combo > 0 ? PALETTE.amber : PALETTE.dim, weight: 800, align: 'center', glow: 8 });

    if (state.flash > 0) { c.fillStyle = `rgba(255,255,255,${state.flash * 0.5})`; c.fillRect(0, 0, W, H); }
    particles.render(c, 1);
    vignette(c, W, H, 0.45);
  }

  function resize(w, h) { layout(w, h); }
  return { update, render, resize };
}
