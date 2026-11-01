// IO 多人竞技 —— 贪吃蛇 IO：吞噬成长、撞击淘汰；AI 陪练 + 多标签页同机对战（防御式降级）
import { clamp, TAU, makeRng, dist, lerp, angleTo } from '../core/math.js';
import { PALETTE, glowCircle, text, vignette, bar } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'io-battle', title: 'IO 多人竞技', category: 'io', difficulty: 3,
  music: 'chase', howto: ['移动鼠标 / 方向键 = 转向', '按住加速消耗长度', '吞食物成长，撞别人身体即淘汰'],
  particles: 1000
};
export const musicTrack = 'chase';

const STEP = 0.07;     // 逻辑步长（蛇移动间隔）
const BASE_SPEED = 130;
const TURN = 4.2;      // 转向速率 rad/s

export function create(ctx) {
  const { input, audio, particles, shake, save, rng } = ctx;
  const state = {
    W: ctx.W, H: ctx.H, world: null, snakes: [], food: [], t: 0, stepT: 0,
    me: null, tabId: Math.random().toString(36).slice(2), bc: null, remotes: new Map(),
    best: save.get('best', 0), over: false, score: 0, camX: 0, camY: 0, scale: 1, finished: false
  };
  state.world = { w: Math.max(1700, state.W * 2.0), h: Math.max(1100, state.H * 2.0) };

  function layout(w, h) { state.W = w; state.H = h; }
  layout(ctx.W, ctx.H);

  function mkSnake(side, x, y, angle, len) {
    const segs = [];
    for (let i = 0; i < len; i++) segs.push({ x: x - Math.cos(angle) * i * 6, y: y - Math.sin(angle) * i * 6 });
    return { id: side === 'player' ? 'me' : 'ai' + Math.random().toString(36).slice(2), side, angle, speed: BASE_SPEED,
      segs, len, r: 7, boost: false, dead: false, color: side === 'player' ? PALETTE.cyan : rng.pick([PALETTE.red, PALETTE.amber, PALETTE.violet, PALETTE.lime, PALETTE.blue]),
      aiT: 0, target: null };
  }

  function seedFood(n) {
    for (let i = 0; i < n; i++) state.food.push({ x: rng.range(0, state.world.w), y: rng.range(0, state.world.h), r: 5, color: rng.pick([PALETTE.lime, PALETTE.amber, PALETTE.cyan, PALETTE.magenta]) });
  }

  function reset() {
    state.snakes.length = 0; state.food.length = 0; state.remotes.clear(); state.over = false; state.score = 0;
    const w = state.world;
    state.me = mkSnake('player', w.w * 0.5, w.h * 0.5, 0, 14); state.snakes.push(state.me);
    for (let i = 0; i < 6; i++) state.snakes.push(mkSnake('ai', rng.range(200, w.w - 200), rng.range(200, w.h - 200), rng.range(0, TAU), rng.int(12, 30)));
    seedFood(220);
  }
  reset();

  // 多标签页同步（防御式）
  try { if (typeof BroadcastChannel !== 'undefined') { state.bc = new BroadcastChannel('neon-io'); state.bc.onmessage = (e) => { try { const d = e.data; if (d && d.id !== state.tabId) state.remotes.set(d.id, { ...d, age: 0 }); } catch {} }; } } catch {}
  let bcT = 0;

  function stepSnake(s, dt) {
    s.boost = s.side === 'player' ? (input.isDown('dash') || (input.pointer && input.pointer.down)) : s.boost;
    if (s.side === 'player') {
      const p = input.pointer;
      if (p && p.down) {
        const wx = (p.x - state.W / 2) / state.scale + state.camX;
        const wy = (p.y - state.H / 2) / state.scale + state.camY;
        const ta = Math.atan2(wy - s.segs[0].y, wx - s.segs[0].x);
        s.angle = stepAngle(s.angle, ta, TURN * dt);
      }
      if (input.isDown('left')) s.angle = stepAngle(s.angle, s.angle - 1.4, TURN * dt);
      if (input.isDown('right')) s.angle = stepAngle(s.angle, s.angle + 1.4, TURN * dt);
    } else {
      aiThink(s, dt);
    }
    const sp = s.boost ? s.speed * 1.9 : s.speed;
    if (s.boost && s.len > 10) { s.len -= 0.06 * dt * 60 * 0.06; if (Math.random() < 0.3) dropFood(s.segs[s.segs.length - 1].x, s.segs[s.segs.length - 1].y, 1); }
    const head = s.segs[0];
    head.x += Math.cos(s.angle) * sp * STEP; head.y += Math.sin(s.angle) * sp * STEP;
    // 环绕世界
    if (head.x < 0) head.x += state.world.w; if (head.x > state.world.w) head.x -= state.world.w;
    if (head.y < 0) head.y += state.world.h; if (head.y > state.world.h) head.y -= state.world.h;
    // 身体跟随
    for (let i = 1; i < s.segs.length; i++) {
      const a = s.segs[i - 1], b = s.segs[i];
      const ang = Math.atan2(a.y - b.y, a.x - b.x);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const want = 6;
      if (d > want) { b.x += Math.cos(ang) * (d - want); b.y += Math.sin(ang) * (d - want); }
    }
    // 增长
    const targetLen = Math.round(s.len);
    while (s.segs.length < targetLen) { const tail = s.segs[s.segs.length - 1]; s.segs.push({ x: tail.x, y: tail.y }); }
    while (s.segs.length > targetLen + 1) s.segs.pop();
    s.r = 6 + Math.min(14, s.len * 0.05);
    // 吃食物
    for (let i = state.food.length - 1; i >= 0; i--) {
      const f = state.food[i];
      if (dist(head.x, head.y, f.x, f.y) < s.r + f.r) { state.food.splice(i, 1); s.len += 0.7; if (s.side === 'player') { state.score += 1; audio.sfx('coin'); ctx.vibrate(PATTERNS.tap); } }
    }
    if (state.food.length < 180) seedFood(4);
  }
  function stepAngle(a, target, max) { let d = ((target - a + Math.PI * 3) % (TAU)) - Math.PI; if (d > Math.PI) d -= TAU; return a + clamp(d, -max, max); }

  function aiThink(s, dt) {
    s.aiT -= dt;
    if (s.aiT <= 0 || !s.target) {
      s.aiT = 0.4;
      // 找最近食物
      let best = null, bd = 1e9;
      for (const f of state.food) { const d = dist(s.segs[0].x, s.segs[0].y, f.x, f.y); if (d < bd) { bd = d; best = f; } }
      s.target = best;
    }
    // 避障：若前方有别的蛇身，转向
    const hx = s.segs[0].x, hy = s.segs[0].y;
    let danger = false;
    for (const o of state.snakes) { if (o === s) continue; for (let i = 0; i < o.segs.length; i += 3) { if (dist(hx, hy, o.segs[i].x, o.segs[i].y) < s.r + o.r + 14) { danger = true; break; } } if (danger) break; }
    let ta = s.target ? Math.atan2(s.target.y - hy, s.target.x - hx) : s.angle;
    if (danger) ta = s.angle + (Math.random() < 0.5 ? 1.6 : -1.6);
    s.angle = stepAngle(s.angle, ta, TURN * dt);
  }

  function dropFood(x, y, n) { for (let i = 0; i < n; i++) state.food.push({ x: x + rng.range(-6, 6), y: y + rng.range(-6, 6), r: 5, color: PALETTE.amber }); }

  function checkCollisions() {
    const all = state.snakes.concat(remoteSnakes());
    for (const s of state.snakes) {
      if (s.dead) continue;
      const h = s.segs[0];
      for (const o of all) {
        if (o === s) continue;
        const stepK = o.side === 'remote' ? 2 : 1;
        for (let i = 0; i < o.segs.length; i += stepK) {
          const seg = o.segs[i];
          const rr = (s.r + (o.r || 7)) * 0.85;
          if (dist(h.x, h.y, seg.x, seg.y) < rr) {
            // 头对头：小者亡
            if (i === 0 && s.len <= o.len) { kill(s); }
            else if (i === 0 && s.len > o.len) { /* 对方会死 */ }
            else kill(s);
            break;
          }
        }
        if (s.dead) break;
      }
    }
    // 远程头撞击本地玩家由上方覆盖；清理死亡
    for (let i = state.snakes.length - 1; i >= 0; i--) { if (state.snakes[i].dead) { const s = state.snakes[i]; dropFood(s.segs[Math.floor(s.segs.length / 2)].x, s.segs[Math.floor(s.segs.length / 2)].y, Math.floor(s.len / 2)); if (s.side === 'player') onDead(); else audio.sfx('explode'); particles.explosion(s.segs[0].x, s.segs[0].y, 1, s.color); state.snakes.splice(i, 1); } }
  }
  function kill(s) { if (!s.dead) { s.dead = true; if (s.side !== 'player') {} } }
  function remoteSnakes() { const arr = []; for (const r of state.remotes.values()) { if (r.age < 2 && r.segs && r.segs.length) arr.push({ side: 'remote', segs: r.segs, r: r.r || 7, len: r.len || r.segs.length, color: r.color || PALETTE.magenta }); } return arr; }

  function onDead() {
    if (state.over) return;
    state.over = true; state.finished = true;
    audio.sfx('die'); audio.duck(0.6, 900); ctx.vibrate(PATTERNS.damage); shake.add(0.8);
    if (state.score > state.best) { state.best = state.score; save.set('best', state.best); }
    ctx.finish(state.score, { win: false, higherBetter: true, stats: [['长度', Math.round(state.me.len)], ['最佳', state.best]] });
  }

  function update(dt) {
    state.t += dt;
    // 相机
    const h = state.me.segs[0];
    state.camX = lerp(state.camX, h.x, 1 - Math.pow(0.001, dt));
    state.camY = lerp(state.camY, h.y, 1 - Math.pow(0.001, dt));
    state.scale = clamp(Math.min(state.W, state.H) / 760, 0.6, 1.4);
    if (state.over) { particles.update(dt); return; }
    // 远程快照老化
    for (const [k, r] of state.remotes) { r.age += dt; if (r.age > 3) state.remotes.delete(k); }
    // 逻辑步
    state.stepT += dt;
    let guard = 0;
    while (state.stepT >= STEP && !state.over && guard++ < 4) { state.stepT -= STEP; for (const s of state.snakes) if (!s.dead) stepSnake(s, STEP); checkCollisions(); }
    // 广播本机蛇
    bcT -= dt;
    if (state.bc && bcT <= 0) { bcT = 0.1; try { state.bc.postMessage({ id: state.tabId, segs: state.me.segs.filter((_, i) => i % 2 === 0).map(s => [Math.round(s.x), Math.round(s.y)]).slice(0, 60), len: state.me.len, r: state.me.r, color: state.me.color }); } catch {} }
    ctx.hud('len', '长度', Math.round(state.me.len));
    ctx.hud('score', '分数', state.score);
    ctx.hud('best', '最佳', state.best);
  }

  function render(alpha, rdt = 0.016) {
    const c = ctx.ctx; const { W, H } = ctx;
    c.fillStyle = '#04060e'; c.fillRect(0, 0, W, H);
    c.save();
    c.translate(W / 2, H / 2); c.scale(state.scale, state.scale); c.translate(-state.camX, -state.camY);
    // 世界边框
    c.strokeStyle = 'rgba(40,60,110,.4)'; c.lineWidth = 2;
    c.strokeRect(0, 0, state.world.w, state.world.h);
    // 食物
    for (const f of state.food) glowCircle(c, f.x, f.y, f.r, f.color, { glow: 6, fill: f.color + '66' });
    // 蛇
    const all = state.snakes.concat(remoteSnakes());
    for (const s of all) {
      for (let i = s.segs.length - 1; i >= 0; i--) { const sg = s.segs[i]; const rr = s.r * (1 - i / (s.segs.length + 8)); glowCircle(c, sg.x, sg.y, Math.max(2, rr), s.color, { glow: 8, fill: s.color + '33' }); }
      const hd = s.segs[0]; glowCircle(c, hd.x, hd.y, s.r + 2, s.color, { glow: 14, fill: 'rgba(255,255,255,.2)' });
      // 眼睛
      c.fillStyle = '#fff'; c.beginPath(); c.arc(hd.x + Math.cos(s.angle) * s.r * .4, hd.y + Math.sin(s.angle) * s.r * .4, 2, 0, TAU); c.fill();
    }
    particles.render(c, 1);
    c.restore();
    if (state.over) { text(c, 'GAME OVER', W / 2, H / 2, { size: 40, color: PALETTE.red, weight: 900, glow: 18, align: 'center' }); text(c, '按 R 重开', W / 2, H / 2 + 34, { size: 13, color: PALETTE.dim, align: 'center' }); }
    vignette(c, W, H, 0.45);
  }

  function resize(w, h) { layout(w, h); }
  return { update, render, resize, destroy() { try { state.bc && state.bc.close(); } catch {} } };
}
