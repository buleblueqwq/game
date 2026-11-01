// 迷你 RTS —— 框选单位、采集资源、造兵、编队进攻；AI 对手自动生产并进攻
import { clamp, dist, TAU, makeRng } from '../core/math.js';
import { PALETTE, glowCircle, glowRect, glowLine, text, bar, vignette, roundRect, star } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'mini-rts', title: '迷你 RTS', category: 'strategy', difficulty: 4,
  music: 'tense', howto: ['拖拽框选单位 · 点击空地移动', '点击晶体让工人采集 · 点击敌人进攻', '底部按钮造兵，摧毁敌方基地获胜'],
  particles: 800
};
export const musicTrack = 'tense';

const COST = { worker: 20, soldier: 35 };
const BASE_HP = 220;

export function create(ctx) {
  const { input, audio, particles, shake, save, rng } = ctx;
  const state = {
    W: ctx.W, H: ctx.H, t: 0, units: [], crystals: [], pBase: null, eBase: null,
    sel: new Set(), res: 60, eRes: 60, eTimer: 0, over: false, win: false,
    best: save.get('best', 0), drag: null, downPos: null, finished: false
  };

  function layout(w, h) { state.W = w; state.H = h; }
  layout(ctx.W, ctx.H);

  function makeUnit(side, kind, x, y) {
    return { side, kind, x, y, vx: 0, vy: 0, hp: kind === 'worker' ? 32 : 56, maxhp: kind === 'worker' ? 32 : 56,
      cmd: null, carry: 0, atkCd: 0, target: null, r: kind === 'worker' ? 8 : 10, speed: kind === 'worker' ? 95 : 110, id: Math.random() };
  }

  function reset() {
    state.units.length = 0; state.crystals.length = 0; state.sel.clear();
    const W = state.W, H = state.H;
    state.pBase = { x: W * 0.1, y: H / 2, hp: BASE_HP, max: BASE_HP, side: 'player', r: 26 };
    state.eBase = { x: W * 0.9, y: H / 2, hp: BASE_HP, max: BASE_HP, side: 'enemy', r: 26 };
    for (let i = 0; i < 3; i++) state.units.push(makeUnit('player', 'worker', W * 0.16 + i * 16, H / 2 + (i - 1) * 18));
    for (let i = 0; i < 2; i++) state.units.push(makeUnit('enemy', 'worker', W * 0.84 - i * 16, H / 2 + (i - 1) * 18));
    // 晶体
    const n = 6;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + 0.3;
      const d = Math.min(W, H) * 0.3;
      state.crystals.push({ x: W / 2 + Math.cos(ang) * d, y: H / 2 + Math.sin(ang) * d * 0.7, amount: 999, r: 12 });
    }
    state.res = 60; state.eRes = 60; state.eTimer = 2; state.over = false; state.win = false; state.t = 0;
    particles.clear();
  }
  reset();

  // 操作 UI
  const panel = document.createElement('div');
  panel.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;';
  const mkBtn = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = label; b.style.cssText = 'font-size:13px;padding:8px 14px;';
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    panel.appendChild(b); return b;
  };
  const wBtn = mkBtn('造工人 (20)', () => build('worker'));
  const sBtn = mkBtn('造士兵 (35)', () => build('soldier'));
  ctx.overlay(panel, 'overlay-bottom');

  function build(kind) {
    if (state.over) return;
    if (state.res < COST[kind]) { audio.sfx('error'); return; }
    state.res -= COST[kind];
    const b = state.pBase;
    state.units.push(makeUnit('player', kind, b.x + 30 + rng.range(-10, 10), b.y + rng.range(-20, 20)));
    audio.sfx('build'); ctx.vibrate(PATTERNS.build); particles.burst(b.x, b.y, 10, { color: PALETTE.cyan, speed: 120, life: .5 });
  }

  function enemyBuild(kind) {
    const b = state.eBase;
    state.units.push(makeUnit('enemy', kind, b.x - 30 - rng.range(-10, 10), b.y + rng.range(-20, 20)));
  }

  // 选择 / 指令（鼠标 + 触屏统一用画布事件）
  let dragStart = null, dragging = false;
  const offDown = ctx.listen(ctx.canvas, 'pointerdown', (e) => {
    const r = ctx.canvas.getBoundingClientRect();
    dragStart = { x: e.clientX - r.left, y: e.clientY - r.top, b: e.button };
    dragging = false;
  });
  const offMove = ctx.listen(ctx.canvas, 'pointermove', (e) => {
    if (!dragStart) return;
    const r = ctx.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (Math.hypot(x - dragStart.x, y - dragStart.y) > 8) dragging = true;
    state.drag = dragging ? { x0: dragStart.x, y0: dragStart.y, x1: x, y1: y } : null;
  });
  const offUp = ctx.listen(ctx.canvas, 'pointerup', (e) => {
    if (!dragStart) return;
    const r = ctx.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const right = dragStart.b === 2;
    state.drag = null;
    if (dragging) { boxSelect(dragStart.x, dragStart.y, x, y, right); }
    else { click(x, y, right); }
    dragStart = null; dragging = false;
  });
  const offCtx = ctx.listen(ctx.canvas, 'contextmenu', (e) => e.preventDefault());

  function boxSelect(x0, y0, x1, y1, add) {
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
    if (!add) state.sel.clear();
    let any = false;
    for (const u of state.units) {
      if (u.side !== 'player') continue;
      if (u.x >= minx && u.x <= maxx && u.y >= miny && u.y <= maxy) { state.sel.add(u); any = true; }
    }
    audio.sfx('select'); ctx.vibrate(PATTERNS.select);
  }
  function click(x, y, forceCmd) {
    // 点到己方单位 -> 选中
    let hit = null, hd = 1e9;
    for (const u of state.units) { if (u.side !== 'player') continue; const d = dist(u.x, u.y, x, y); if (d < u.r + 8 && d < hd) { hd = d; hit = u; } }
    if (hit && !forceCmd) { state.sel.clear(); state.sel.add(hit); audio.sfx('select'); ctx.vibrate(PATTERNS.select); return; }
    if (state.sel.size === 0) return;
    // 命令：敌方？晶体？否则移动
    const en = pickEnemy(x, y);
    const cr = pickCrystal(x, y);
    for (const u of state.sel) {
      if (en) { u.cmd = { type: 'attack', target: en }; u.target = en; }
      else if (cr && u.kind === 'worker') { u.cmd = { type: 'gather', target: cr }; u.target = cr; }
      else { u.cmd = { type: 'move', x, y }; u.target = null; }
    }
    audio.sfx('click'); ctx.vibrate(PATTERNS.tap);
  }
  function pickEnemy(x, y) {
    let best = null, bd = 24;
    for (const u of state.units) { if (u.side === 'enemy') { const d = dist(u.x, u.y, x, y); if (d < bd) { bd = d; best = u; } } }
    if (state.eBase && dist(state.eBase.x, state.eBase.y, x, y) < state.eBase.r + 14) return state.eBase;
    return best;
  }
  function pickCrystal(x, y) {
    for (const cr of state.crystals) if (dist(cr.x, cr.y, x, y) < cr.r + 12) return cr;
    return null;
  }

  function moveToward(u, tx, ty, sp, dt) {
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    if (d < 2) return true;
    const v = Math.min(sp, d / Math.max(dt, 1e-3));
    u.x += (dx / d) * v * dt; u.y += (dy / d) * v * dt;
    return false;
  }

  function updateUnit(u, dt) {
    u.atkCd = Math.max(0, u.atkCd - dt);
    if (u.kind === 'worker' && u.cmd && u.cmd.type === 'gather') {
      const cr = u.cmd.target;
      if (!cr || cr.amount <= 0) { u.cmd = null; return; }
      if (u.carry < 10) {
        if (moveToward(u, cr.x, cr.y, u.speed, dt)) { cr.amount -= 1; u.carry += 1; if (u.side === 'player') {} }
      } else {
        const bx = u.side === 'player' ? state.pBase.x : state.eBase.x;
        const by = u.side === 'player' ? state.pBase.y : state.eBase.y;
        if (moveToward(u, bx, by, u.speed, dt)) {
          if (u.side === 'player') state.res += u.carry; else state.eRes += u.carry;
          u.carry = 0;
        }
      }
      return;
    }
    // 战斗：找目标
    let tgt = u.target;
    if (tgt && (tgt.hp <= 0 || (tgt.amount !== undefined && tgt.amount <= 0))) tgt = null;
    if (!tgt || (tgt.side === u.side)) {
      // 自动索敌
      let best = null, bd = 160;
      for (const o of state.units) { if (o.side === u.side || o.hp <= 0) continue; const d = dist(u.x, u.y, o.x, o.y); if (d < bd) { bd = d; best = o; } }
      const eb = u.side === 'player' ? state.eBase : state.pBase;
      if (eb && eb.hp > 0) { const d = dist(u.x, u.y, eb.x, eb.y); if (d < bd) { bd = d; best = eb; } }
      tgt = best;
    }
    // 士兵优先执行 cmd（攻击/移动）；工人无 cmd 时 idle
    if (u.cmd && u.cmd.type === 'move') { if (moveToward(u, u.cmd.x, u.cmd.y, u.speed, dt)) u.cmd = null; u.target = null; return; }
    if (u.cmd && u.cmd.type === 'attack' && tgt) { u.target = tgt; }
    if (!tgt) { u.target = null; if (u.cmd && u.cmd.type === 'attack') {} return; }
    const tr = (tgt.r || 10);
    const reach = u.r + tr + 4;
    const d = dist(u.x, u.y, tgt.x, tgt.y);
    if (d > reach) moveToward(u, tgt.x, tgt.y, u.speed, dt);
    else if (u.atkCd <= 0) {
      tgt.hp -= u.kind === 'worker' ? 5 : 13;
      u.atkCd = 0.5;
      if (tgt.side) particles.burst(tgt.x, tgt.y, 4, { color: PALETTE.red, speed: 90, life: .3 });
      if (tgt.hp <= 0 && tgt.side) { particles.explosion(tgt.x, tgt.y, 0.4, PALETTE.red); audio.sfx('hit'); }
    }
    if (u.cmd && u.cmd.type === 'attack' && d <= reach) u.cmd = null;
  }

  function update(dt) {
    state.t += dt;
    if (state.over) return;
    for (const u of state.units) if (u.hp > 0) updateUnit(u, dt);
    // 清理死亡
    for (let i = state.units.length - 1; i >= 0; i--) { const u = state.units[i]; if (u.hp <= 0) { state.sel.delete(u); state.units.splice(i, 1); } }
    // 敌方 AI
    state.eRes += 9 * dt;
    state.eTimer -= dt;
    const eSoldiers = state.units.filter(u => u.side === 'enemy' && u.kind === 'soldier').length;
    if (state.eTimer <= 0) {
      state.eTimer = 3.2;
      if (state.eRes >= COST.soldier && eSoldiers < 8) { state.eRes -= COST.soldier; enemyBuild('soldier'); audio.sfx('build'); }
      else if (state.eRes >= COST.worker) { state.eRes -= COST.worker; enemyBuild('worker'); }
    }
    // 敌方工人采集
    const eWorkers = state.units.filter(u => u.side === 'enemy' && u.kind === 'worker' && !u.cmd);
    if (eWorkers.length) { const cr = state.crystals[0]; for (const w of eWorkers) { if (!w.cmd) w.cmd = { type: 'gather', target: cr }; } }

    ctx.hud('res', '资源', Math.floor(state.res));
    ctx.hud('army', '兵力', state.units.filter(u => u.side === 'player' && u.kind === 'soldier').length);
    ctx.hud('eBase', '敌堡', Math.max(0, Math.ceil(state.eBase.hp)));

    if (state.eBase.hp <= 0 && !state.over) end(true);
    if (state.pBase.hp <= 0 && !state.over) end(false);
  }

  function end(win) {
    state.over = true; state.win = win;
    const score = Math.floor(state.res) + state.units.filter(u => u.side === 'player').length * 10 + (win ? 500 : 0);
    if (score > state.best) { state.best = score; save.set('best', score); }
    audio.sfx(win ? 'win' : 'lose'); ctx.vibrate(win ? PATTERNS.win : PATTERNS.lose);
    ctx.finish(score, { win, higherBetter: true, stats: [['敌堡', Math.max(0, Math.ceil(state.eBase.hp))], ['资源', Math.floor(state.res)]] });
  }

  function render(alpha, rdt = 0.016) {
    const c = ctx.ctx; const { W, H } = ctx;
    c.fillStyle = '#05080f'; c.fillRect(0, 0, W, H);
    // 网格地面
    c.strokeStyle = 'rgba(40,60,110,.18)'; c.lineWidth = 1;
    const gs = 40;
    for (let x = 0; x < W; x += gs) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = 0; y < H; y += gs) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    // 晶体
    for (const cr of state.crystals) { star(c, cr.x, cr.y, cr.r, 4, 0.5, 0); c.fillStyle = PALETTE.violet; c.globalAlpha = 0.9; c.fill(); c.globalAlpha = 1; glowCircle(c, cr.x, cr.y, cr.r + 3, PALETTE.violet, { glow: 10 }); }
    // 基地
    drawBase(c, state.pBase, PALETTE.cyan);
    drawBase(c, state.eBase, PALETTE.red);
    // 单位
    for (const u of state.units) {
      const col = u.side === 'player' ? (u.kind === 'worker' ? PALETTE.lime : PALETTE.cyan) : (u.kind === 'worker' ? '#c9a23a' : PALETTE.red);
      glowCircle(c, u.x, u.y, u.r, col, { glow: 8, fill: col + '44' });
      if (u.kind === 'soldier') { c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.arc(u.x, u.y, u.r + 3, 0, TAU); c.stroke(); }
      if (u.carry > 0) glowCircle(c, u.x, u.y - u.r - 4, 3, PALETTE.amber, { glow: 6, fill: PALETTE.amber });
      if (state.sel.has(u)) { c.strokeStyle = PALETTE.white; c.lineWidth = 1.5; c.beginPath(); c.arc(u.x, u.y, u.r + 6, 0, TAU); c.stroke(); }
      // 血条
      if (u.hp < u.maxhp) bar(c, u.x - u.r, u.y - u.r - 8, u.r * 2, 3, u.hp / u.maxhp, { fill: PALETTE.green });
    }
    // 选择框
    if (state.drag) { const d = state.drag; c.strokeStyle = PALETTE.cyan; c.lineWidth = 1.5; c.fillStyle = 'rgba(34,224,255,.08)'; c.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); c.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); }
    particles.render(c, 1);
    // 顶部状态
    text(c, `资源 ${Math.floor(state.res)}`, 16, 26, { size: 14, color: PALETTE.lime, weight: 700 });
    text(c, `兵力 ${state.units.filter(u => u.side === 'player' && u.kind === 'soldier').length}`, 16, 46, { size: 12, color: PALETTE.dim });
    vignette(c, W, H, 0.4);
  }

  function drawBase(c, b, col) {
    glowRect(c, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2, col, { glow: 18, fill: col + '22', r: 6 });
    text(c, b.side === 'player' ? '我方' : '敌方', b.x, b.y - b.r - 8, { size: 11, color: col, align: 'center', weight: 700 });
    bar(c, b.x - b.r, b.y + b.r + 4, b.r * 2, 4, b.hp / b.max, { fill: b.hp > b.max * 0.3 ? PALETTE.green : PALETTE.red });
  }

  function resize(w, h) { layout(w, h); }
  return { update, render, resize, destroy() { offDown?.(); offMove?.(); offUp?.(); offCtx?.(); } };
}
