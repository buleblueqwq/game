// 多轨节奏音游 —— 四轨下落音符（Tap / Hold），判定线 + 连击 + 准确率评分
import { clamp, TAU, makeRng } from '../core/math.js';
import { PALETTE, glowRect, glowCircle, text, bar, vignette, roundRect } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'rhythm', title: '多轨节奏音游', category: 'rhythm', difficulty: 4,
  music: 'arcade', howto: ['D F J K = 四条轨道', '音符落到判定线时按键', '长按音符需按住到尾端'],
  particles: 1000
};
export const musicTrack = 'arcade';

const LANES = 4;
const KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
const LANE_COLORS = [PALETTE.cyan, PALETTE.magenta, PALETTE.lime, PALETTE.amber];
const LEAD = 2.6;          // 前奏
const SONG = 78;           // 曲长（秒）
const WIN = { perfect: 0.045, good: 0.09, ok: 0.15 };  // 判定窗（秒）
const SPEED = 560;         // 下落速度 px/s

export function create(ctx) {
  const { input, audio, particles, shake, save, rng } = ctx;
  const state = {
    t: -LEAD, notes: [], nextIdx: 0, prevRaw: [false, false, false, false],
    touchLane: -1, holdKey: [false, false, false, false], holdNote: [null, null, null, null], holdLast: [0, 0, 0, 0],
    score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, ok: 0, miss: 0,
    accW: 0, accN: 0, best: save.get('best', 0), finished: false, judge: '', judgeT: 0, judgeColor: '#fff',
    W: ctx.W, H: ctx.H
  };

  // 生成谱面（确定性）：以拍为单位，偶尔长押
  function genChart() {
    const notes = [];
    let beat = LEAD + 0.2;
    while (beat < SONG) {
      const r = rng();
      if (r < 0.18) {           // 双押
        const a = rng.int(0, 3); let b = rng.int(0, 3); if (b === a) b = (a + 2) % 4;
        notes.push({ lane: a, t0: beat, t1: beat, hit: false, dead: false });
        notes.push({ lane: b, t0: beat, t1: beat, hit: false, dead: false });
      } else if (r < 0.30 && beat < SONG - 1) {  // 长押
        const ln = rng.range(0.5, 1.1);
        notes.push({ lane: rng.int(0, 3), t0: beat, t1: beat + ln, hit: false, dead: false });
      } else {                  // 单押
        notes.push({ lane: rng.int(0, 3), t0: beat, t1: beat, hit: false, dead: false });
      }
      beat += rng.pick([0.5, 0.5, 0.5, 0.25, 0.75, 1.0]);
    }
    notes.sort((a, b) => a.t0 - b.t0);
    return notes;
  }

  function reset() {
    state.notes = genChart(); state.nextIdx = 0; state.t = -LEAD;
    state.score = 0; state.combo = 0; state.maxCombo = 0;
    state.perfect = state.good = state.ok = state.miss = 0; state.accW = 0; state.accN = 0;
    state.finished = false; state.judge = ''; state.judgeT = 0;
    for (let i = 0; i < LANES; i++) { state.holdNote[i] = null; state.holdKey[i] = false; state.prevRaw[i] = false; }
    particles.clear();
  }

  function laneRect() {
    const w = Math.min(state.W * 0.92, 520);
    const x0 = (state.W - w) / 2;
    const lw = w / LANES;
    const judgeY = state.H - 110;
    return { w, x0, lw, judgeY };
  }

  function judgeHit(lane, now) {
    const { x0, lw, judgeY } = laneRect();
    // 找该轨道最近未判定的 note（tap 或 hold 起点）
    let best = null, bestDt = 1e9;
    for (let i = state.nextIdx; i < state.notes.length; i++) {
      const n = state.notes[i];
      if (n.lane !== lane || n.dead) continue;
      const dt = Math.abs(n.t0 - now);
      if (dt < bestDt) { bestDt = dt; best = n; }
      if (n.t0 - now > WIN.ok) break;
    }
    if (!best || bestDt > WIN.ok) { return; }  // 空击不惩罚
    let kind = bestDt <= WIN.perfect ? 'perfect' : bestDt <= WIN.good ? 'good' : 'ok';
    const val = kind === 'perfect' ? 100 : kind === 'good' ? 60 : 30;
    state.combo++; state.maxCombo = Math.max(state.maxCombo, state.combo);
    const mult = 1 + Math.min(2, state.combo * 0.02);
    state.score += Math.round(val * mult);
    state.accW += (kind === 'perfect' ? 1 : kind === 'good' ? 0.65 : 0.3); state.accN++;
    if (kind === 'perfect') state.perfect++; else if (kind === 'good') state.good++; else state.ok++;
    setJudge(kind === 'perfect' ? 'PERFECT' : kind === 'good' ? 'GOOD' : 'OK',
      kind === 'perfect' ? PALETTE.cyan : kind === 'good' ? PALETTE.lime : PALETTE.amber);
    audio.sfx(kind === 'perfect' ? 'confirm' : 'tick');
    ctx.vibrate(kind === 'perfect' ? PATTERNS.tap : PATTERNS.select);
    const cx = x0 + lane * lw + lw / 2;
    particles.burst(cx, judgeY, kind === 'perfect' ? 16 : 10, { color: LANE_COLORS[lane], speed: 180, life: .5 });
    if (best.t1 > best.t0 + 0.05) {       // 进入长押
      best.hit = true; state.holdNote[lane] = best; state.holdLast[lane] = now;
    } else { best.dead = true; }
  }

  function setJudge(txt, color) { state.judge = txt; state.judgeColor = color; state.judgeT = 0.5; }

  function missNote(n) {
    n.dead = true; state.combo = 0; state.miss++; state.accW += 0; state.accN++;
    setJudge('MISS', PALETTE.red); audio.sfx('error'); ctx.vibrate(PATTERNS.error);
  }

  function layout(w, h) { state.W = w; state.H = h; }
  layout(ctx.W, ctx.H);
  reset();
  ctx.hud('score', '分数', 0);
  ctx.hud('combo', '连击', 0);
  ctx.hud('acc', '准确率', '100%');

  function update(dt) {
    state.t += dt;
    if (state.finished) return;
    if (state.judgeT > 0) state.judgeT -= dt;
    const now = state.t;

    // 漏判检测
    for (let i = 0; i < state.notes.length; i++) {
      const n = state.notes[i];
      if (n.dead) continue;
      if (n.t0 < now - WIN.ok && n.t1 <= n.t0 + 0.05) missNote(n);
      // 长押：起点已过且未接住 -> 漏
      if (!n.hit && n.t0 < now - WIN.ok && n.t1 > n.t0 + 0.05 && now < n.t0) {}
    }

    // 键盘
    for (let i = 0; i < LANES; i++) {
      const cur = input.rawDown(KEYS[i]);
      const just = cur && !state.prevRaw[i];
      state.prevRaw[i] = cur;
      if (just && !state.holdNote[i]) judgeHit(i, now);
      // 长押维护
      if (state.holdNote[i]) {
        const n = state.holdNote[i];
        if (cur) {
          if (now >= n.t0 && now <= n.t1) {
            const add = (now - state.holdLast[i]) * 120; state.holdLast[i] = now;
            state.score += Math.round(add * (1 + Math.min(2, state.combo * 0.02)));
            if (Math.random() < 0.5) { const { x0, lw, judgeY } = laneRect(); particles.trail(x0 + i * lw + lw / 2, judgeY - 6, LANE_COLORS[i], 3); }
            ctx.vibrate(PATTERNS.step);
          }
        }
        if (!cur || now >= n.t1) {
          if (now >= n.t1 - WIN.ok || !cur) {  // 成功收尾
            state.combo++; state.maxCombo = Math.max(state.maxCombo, state.combo);
            state.score += 80; state.accW += 1; state.accN++;
            setJudge('CLEAR', PALETTE.cyan);
          } else { state.combo = 0; }  // 提前松手
          n.dead = true; state.holdNote[i] = null;
        }
      }
    }

    // 触屏：点击轨道区域当作点击
    const p = input.pointer;
    if (p && p.justDown) {
      const { x0, lw, judgeY } = laneRect();
      if (p.y > judgeY - 220) {
        const lane = clamp(Math.floor((p.x - x0) / lw), 0, LANES - 1);
        if (!state.holdNote[lane]) judgeHit(lane, now);
      }
    }

    ctx.hud('score', '分数', state.score);
    ctx.hud('combo', '连击', state.combo);
    const acc = state.accN ? Math.round((state.accW / state.accN) * 100) : 100;
    ctx.hud('acc', '准确率', acc + '%');

    if (now > SONG + 2 && !state.finished) finish();
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
    c.fillStyle = '#05060f'; c.fillRect(0, 0, W, H);
    const { w, x0, lw, judgeY } = laneRect();
    // 轨道
    c.fillStyle = 'rgba(10,14,28,.7)'; c.fillRect(x0, 0, w, H);
    for (let i = 0; i < LANES; i++) {
      c.strokeStyle = 'rgba(60,80,140,.25)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x0 + i * lw, 0); c.lineTo(x0 + i * lw, H); c.stroke();
    }
    c.strokeStyle = 'rgba(60,80,140,.25)';
    c.beginPath(); c.moveTo(x0 + w, 0); c.lineTo(x0 + w, H); c.stroke();

    // 判定线 + 拍点脉冲
    const beatPulse = 0.5 + 0.5 * Math.sin((state.t) * Math.PI * 2 * (1 / 0.5));
    glowRect(c, x0, judgeY - 3, w, 6, PALETTE.white, { glow: 16, fill: 'rgba(255,255,255,.15)' });
    for (let i = 0; i < LANES; i++) {
      const cx = x0 + i * lw + lw / 2;
      const active = state.holdKey[i] || input.rawDown(KEYS[i]);
      glowCircle(c, cx, judgeY, lw * 0.34 * (active ? 1.15 : 1 + beatPulse * 0.05), LANE_COLORS[i],
        { glow: active ? 20 : 10, fill: active ? LANE_COLORS[i] + '55' : 'rgba(255,255,255,.05)' });
    }

    // 音符
    const now = state.t;
    for (let i = 0; i < state.notes.length; i++) {
      const n = state.notes[i];
      if (n.dead) continue;
      if (n.t1 < now - WIN.ok) continue;
      if (n.t0 > now + (judgeY + 40) / SPEED + 0.1) break;
      const cx = x0 + n.lane * lw + lw / 2;
      const yTop = judgeY - (n.t0 - now) * SPEED;
      const yBot = judgeY - (n.t1 - now) * SPEED;
      const col = LANE_COLORS[n.lane];
      if (n.t1 > n.t0 + 0.05) {       // 长押条
        const top = Math.max(0, Math.min(yTop, yBot)), bot = Math.max(yTop, yBot);
        glowRect(c, cx - lw * 0.28, Math.min(top, bot), lw * 0.56, Math.abs(bot - top), col, { glow: 12, fill: col + '33' });
      } else {
        const y = yTop; if (y < -20 || y > H + 20) continue;
        glowRect(c, cx - lw * 0.32, y - 9, lw * 0.64, 18, col, { glow: 14, fill: col + '44' });
      }
    }

    // 判定文字
    if (state.judgeT > 0) {
      const a = clamp(state.judgeT / 0.5, 0, 1);
      text(c, state.judge, W / 2, judgeY - 70, { size: 26, color: state.judgeColor, weight: 900, glow: 16, alpha: a, align: 'center' });
    }
    text(c, '连击 ' + state.combo, W / 2, 40, { size: 18, color: state.combo > 0 ? PALETTE.amber : PALETTE.dim, weight: 800, align: 'center', glow: 8 });

    particles.render(c, 1);
    vignette(c, W, H, 0.4);
  }

  function resize(w, h) { layout(w, h); }
  return { update, render, resize };
}
