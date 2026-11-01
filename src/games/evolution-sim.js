// 进化模拟器 —— 草 / 草食 / 肉食 三层生态，基因驱动的自然选择
// 生物状态机（觅食/逃离/追捕/繁殖），空间哈希加速邻域查询，世代基因趋势图
import { clamp, lerp, TAU, ease, rgba } from '../core/math.js';
import { PALETTE, neon, glowCircle, roundRect, text, bar, panel, vignette, fillRound, strokeRound } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'evolution-sim', title: '进化模拟器', category: 'ai', difficulty: 2,
  music: 'space',
  howto: [
    '草食（冷色）吃草、肉食（暖色）捕猎，能量耗尽即死亡并化为养分',
    '能量与年龄达标后分裂繁殖，基因带 ±5~15% 突变',
    '点击任意生物查看基因面板；右上角曲线观察种群与基因演化趋势',
    '天灾 = 随机淘汰 30% 种群，观察瓶颈效应'
  ],
  particles: 1200
};
export const musicTrack = 'space';

// 基因索引
const G_SPD = 0, G_VIS = 1, G_SIZ = 2, G_MET = 3, G_REP = 4, G_ATK = 5, G_CAM = 6, G_EFF = 7;
const GENE_N = 8;
const GENE_NAME = ['速度', '视野', '体型', '代谢', '繁殖阈', '攻击', '伪装', '能效'];
const GENE_COL = ['#22e0ff', '#8dff4d', '#ffb020', '#ff2e88', '#a855f7', '#ff4d5e', '#28e0a0', '#3b82f6'];

const WORLD_W = 1800, WORLD_H = 1200;
const GW = 60, GH = 40, CELL = WORLD_W / GW;   // 30
const HERB_CAP = 340, CARN_CAP = 110;

export function create(ctx) {
  const { input, audio, particles, shake, save, rng } = ctx;

  // ---------------- 状态 ----------------
  const S = {
    paused: false, speed: 1, showVision: false, t: 0, simT: 0,
    grassRate: 0.042, mutRate: 0.10, initPop: 90,
    maxGen: 1, herbN: 0, carnN: 0, sel: null, finished: false,
    births: 0, deaths: 0, eaten: 0, genSampleT: 0
  };

  const grass = new Float32Array(GW * GH);
  const nutr = new Float32Array(GW * GH);

  // ---------------- 生物池 ----------------
  // kind: 0 草食 1 肉食
  const creatures = [];
  const freeList = [];

  function makeCreature() {
    return {
      kind: 0, x: 0, y: 0, vx: 0, vy: 0, energy: 0, age: 0, gen: 1,
      g: new Float32Array(GENE_N), state: 0, tx: 0, ty: 0, hasTarget: false,
      alive: false, flash: 0, dead: 0, lastRep: -99
    };
  }

  function spawn(kind, x, y, g, gen) {
    const c = freeList.length ? freeList.pop() : makeCreature();
    c.kind = kind; c.x = x; c.y = y; c.vx = 0; c.vy = 0;
    c.energy = kind === 0 ? 62 : 78; c.age = 0; c.gen = gen;
    for (let i = 0; i < GENE_N; i++) c.g[i] = g[i];
    c.state = 0; c.hasTarget = false; c.alive = true; c.flash = S.t; c.dead = 0; c.lastRep = -99;
    creatures.push(c);
    if (kind === 0) herbCount++; else carnCount++;
    if (gen > S.maxGen) S.maxGen = gen;
    return c;
  }

  function baseGenes(kind) {
    const g = new Float32Array(GENE_N);
    g[G_SPD] = kind === 0 ? 74 : 88;
    g[G_VIS] = kind === 0 ? 105 : 140;
    g[G_SIZ] = kind === 0 ? 5.0 : 6.4;
    g[G_MET] = 1.0;
    g[G_REP] = kind === 0 ? 116 : 156;
    g[G_ATK] = kind === 0 ? 0 : 8;
    g[G_CAM] = 0.2;
    g[G_EFF] = 1.0;
    return g;
  }

  function mutate(g, rate) {
    for (let i = 0; i < GENE_N; i++) {
      if (rng.chance(rate)) {
        const f = 1 + rng.gauss() * 0.10;               // ±5~15%
        g[i] = clamp(g[i] * clamp(f, 0.85, 1.15), 0.01, 1e6);
      }
    }
    g[G_SPD] = clamp(g[G_SPD], 26, 165);
    g[G_VIS] = clamp(g[G_VIS], 35, 230);
    g[G_SIZ] = clamp(g[G_SIZ], 2.4, 12);
    g[G_MET] = clamp(g[G_MET], 0.35, 2.6);
    g[G_REP] = clamp(g[G_REP], 55, 210);
    g[G_ATK] = clamp(g[G_ATK], 0, 26);
    g[G_CAM] = clamp(g[G_CAM], 0, 1);
    g[G_EFF] = clamp(g[G_EFF], 0.45, 1.7);
    return g;
  }

  function resetWorld() {
    for (const c of creatures) freeList.push(c);
    creatures.length = 0;
    grass.fill(0); nutr.fill(0);
    for (let i = 0; i < GW * GH; i++) grass[i] = rng.range(0.15, 0.9);
    S.maxGen = 1; S.births = 0; S.deaths = 0; S.eaten = 0; S.sel = null;
    popHist.length = 0; geneHist.length = 0;
    const nH = Math.round(S.initPop * 0.78), nC = Math.round(S.initPop * 0.22);
    for (let i = 0; i < nH; i++) {
      const g = baseGenes(0); mutate(g, 0.45);
      spawn(0, rng.range(40, WORLD_W - 40), rng.range(40, WORLD_H - 40), g, 1);
    }
    for (let i = 0; i < nC; i++) {
      const g = baseGenes(1); mutate(g, 0.45);
      spawn(1, rng.range(40, WORLD_W - 40), rng.range(40, WORLD_H - 40), g, 1);
    }
    sampleGenes();
  }

  // ---------------- 空间哈希 ----------------
  const BS = 90, BW = Math.ceil(WORLD_W / BS), BH = Math.ceil(WORLD_H / BS);
  const buckets = [];
  for (let i = 0; i < BW * BH; i++) buckets.push([]);
  function bucketIdx(x, y) {
    const bx = clamp((x / BS) | 0, 0, BW - 1), by = clamp((y / BS) | 0, 0, BH - 1);
    return by * BW + bx;
  }
  function rebuildHash() {
    for (let i = 0; i < buckets.length; i++) buckets[i].length = 0;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (!c.alive) continue;
      buckets[bucketIdx(c.x, c.y)].push(c);
    }
  }
  const nearBuf = [];
  function forEachNear(x, y, r, fn) {
    nearBuf.length = 0;
    const x0 = clamp(((x - r) / BS) | 0, 0, BW - 1), x1 = clamp(((x + r) / BS) | 0, 0, BW - 1);
    const y0 = clamp(((y - r) / BS) | 0, 0, BH - 1), y1 = clamp(((y + r) / BS) | 0, 0, BH - 1);
    for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) {
      const b = buckets[by * BW + bx];
      for (let k = 0; k < b.length; k++) nearBuf.push(b[k]);
    }
    for (let i = 0; i < nearBuf.length; i++) fn(nearBuf[i]);
  }

  // ---------------- 统计 ----------------
  const popHist = [];      // {h, c}
  const geneHist = [];      // {gen, spd, vis, siz, cam, h, c}
  let avgSpd = 0, avgVis = 0, avgSiz = 0, avgCam = 0, avgMet = 0;

  function sampleGenes() {
    let n = 0, sp = 0, vi = 0, si = 0, ca = 0, me = 0;
    for (const c of creatures) {
      if (!c.alive || c.kind !== 0) continue;
      sp += c.g[G_SPD]; vi += c.g[G_VIS]; si += c.g[G_SIZ]; ca += c.g[G_CAM]; me += c.g[G_MET]; n++;
    }
    if (!n) { avgSpd = avgVis = avgSiz = avgCam = avgMet = 0; return; }
    avgSpd = sp / n; avgVis = vi / n; avgSiz = si / n; avgCam = ca / n; avgMet = me / n;
    if (geneHist.length >= 90) geneHist.shift();
    geneHist.push({ gen: S.maxGen, spd: avgSpd, vis: avgVis, siz: avgSiz, cam: avgCam, met: avgMet, h: S.herbN, c: S.carnN });
  }

  // ---------------- 生态更新 ----------------
  function grassAt(x, y) {
    const gx = clamp((x / CELL) | 0, 0, GW - 1), gy = clamp((y / CELL) | 0, 0, GH - 1);
    return gy * GW + gx;
  }

  function growGrass(dt) {
    const r = S.grassRate * dt;
    for (let i = 0; i < grass.length; i++) {
      const n = nutr[i];
      if (n > 0) { nutr[i] = Math.max(0, n - dt * 0.25); }
      if (grass[i] < 1) grass[i] = Math.min(1, grass[i] + r * (1 + n * 2.2));
    }
  }

  function steer(c, tx, ty, maxSpeed, gain, dt) {
    let dx = tx - c.x, dy = ty - c.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    const dvx = dx * maxSpeed - c.vx, dvy = dy * maxSpeed - c.vy;
    const F = 300 * gain;
    const m = Math.hypot(dvx, dvy) || 1;
    const ax = dvx / m * F, ay = dvy / m * F;
    c.vx += ax * dt; c.vy += ay * dt;
  }

  function limitSpeed(c, maxSpeed) {
    const v = Math.hypot(c.vx, c.vy);
    if (v > maxSpeed) { c.vx = c.vx / v * maxSpeed; c.vy = c.vy / v * maxSpeed; }
  }

  function kill(c, cause) {
    if (!c.alive) return;
    c.alive = false; c.dead = S.t; S.deaths++;
    const gi = grassAt(c.x, c.y);
    nutr[gi] = Math.min(3, nutr[gi] + 0.8 + c.g[G_SIZ] * 0.08);
    if (S.deaths % 7 === 0) particles.burst(c.x, c.y, 6, { color: c.kind ? PALETTE.red : PALETTE.dim, speed: 70, life: .6, size: 2.4, kind: 2 });
  }

  const geneBuf = new Float32Array(GENE_N);
  function reproduce(c) {
    for (let i = 0; i < GENE_N; i++) geneBuf[i] = c.g[i];
    mutate(geneBuf, S.mutRate);
    if (c.kind === 0) geneBuf[G_ATK] = 0;
    c.energy *= 0.9;
    const child = spawn(c.kind, c.x + rng.range(-14, 14), c.y + rng.range(-14, 14), geneBuf, c.gen + 1);
    child.energy = c.energy * 0.5;
    child.flash = S.t;
    S.births++;
    particles.sparkle(c.x, c.y, c.kind ? PALETTE.amber : PALETTE.cyan);
  }

  let herbCount = 0, carnCount = 0;

  function simStep(dt) {
    S.simT += dt;
    growGrass(dt);
    rebuildHash();
    herbCount = 0; carnCount = 0;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (!c.alive) continue;
      if (c.kind === 0) herbCount++; else carnCount++;
    }

    const n0 = creatures.length;              // 本帧新生的个体不参与本帧迭代
    for (let i = 0; i < n0; i++) {
      const c = creatures[i];
      if (!c.alive) continue;
      const g = c.g;
      c.age += dt;
      const maxSpeed = g[G_SPD] * (c.energy < 22 ? 0.55 : 1);

      // ---- 决策 ----
      c.hasTarget = false;
      if (c.kind === 0) {
        // 逃离肉食
        let fx = 0, fy = 0, fd = 1e9, threat = false;
        forEachNear(c.x, c.y, g[G_VIS], (o) => {
          if (o === c || !o.alive || o.kind !== 1) return;
          const d = Math.hypot(o.x - c.x, o.y - c.y);
          const seen = d < g[G_VIS];
          if (seen && d < fd) { fd = d; fx = o.x; fy = o.y; threat = true; }
        });
        if (threat) {
          c.state = 1;
          steer(c, c.x * 2 - fx, c.y * 2 - fy, maxSpeed, 1.25, dt);
        } else {
          // 觅食：视野内最好的草
          let bx = 0, by = 0, bv = -1, bd = 1e9;
          const R = Math.ceil(g[G_VIS] / CELL);
          const cgx = clamp((c.x / CELL) | 0, 0, GW - 1), cgy = clamp((c.y / CELL) | 0, 0, GH - 1);
          for (let yy = cgy - R; yy <= cgy + R; yy++) {
            if (yy < 0 || yy >= GH) continue;
            for (let xx = cgx - R; xx <= cgx + R; xx++) {
              if (xx < 0 || xx >= GW) continue;
              const v = grass[yy * GW + xx];
              if (v < 0.16) continue;
              const px2 = xx * CELL + CELL / 2, py2 = yy * CELL + CELL / 2;
              const d = Math.hypot(px2 - c.x, py2 - c.y);
              if (d > g[G_VIS]) continue;
              const score = v * 2.2 - d / 260;
              if (score > bv) { bv = score; bx = px2; by = py2; bd = d; }
            }
          }
          if (bv > -1) {
            c.state = 0; c.hasTarget = true; c.tx = bx; c.ty = by;
            steer(c, bx, by, maxSpeed, 1, dt);
            if (bd < g[G_SIZ] + 7) {
              const gi = grassAt(bx, by);
              const amount = Math.min(grass[gi], 0.45);
              grass[gi] -= amount;
              c.energy += amount * 26 * g[G_EFF];
            }
          } else {
            c.state = 0;
            // 游荡
            c.vx += rng.range(-1, 1) * 90 * dt; c.vy += rng.range(-1, 1) * 90 * dt;
          }
        }
      } else {
        // 肉食：追捕
        let px2 = 0, py2 = 0, pd = 1e9, prey = null;
        forEachNear(c.x, c.y, g[G_VIS], (o) => {
          if (o === c || !o.alive || o.kind !== 0) return;
          const d = Math.hypot(o.x - c.x, o.y - c.y);
          const eff = d / (1 - 0.42 * o.g[G_CAM]);     // 伪装降低被发现距离
          if (eff < g[G_VIS] && eff < pd) { pd = eff; px2 = o.x; py2 = o.y; prey = o; }
        });
        if (prey) {
          c.state = 2; c.hasTarget = true; c.tx = px2; c.ty = py2;
          steer(c, px2, py2, maxSpeed, 1.15, dt);
          const d = Math.hypot(prey.x - c.x, prey.y - c.y);
          if (d < g[G_SIZ] + prey.g[G_SIZ] + 3) {
            if (g[G_ATK] > prey.g[G_SIZ] * 1.4 || rng.chance(0.55 + g[G_ATK] * 0.02)) {
              c.energy += 26 + prey.energy * 0.55 + prey.g[G_SIZ] * 2.2;
              c.energy = Math.min(230, c.energy);
              S.eaten++;
              particles.burst(prey.x, prey.y, 12, { color: PALETTE.red, speed: 150, life: .55, size: 3, kind: 1 });
              kill(prey, 'eaten');
            }
          }
        } else {
          c.state = 0;
          c.vx += rng.range(-1, 1) * 80 * dt; c.vy += rng.range(-1, 1) * 80 * dt;
        }
      }

      // ---- 移动 & 能量 ----
      limitSpeed(c, maxSpeed);
      c.x += c.vx * dt; c.y += c.vy * dt;
      if (c.x < 6) { c.x = 6; c.vx = Math.abs(c.vx); }
      if (c.x > WORLD_W - 6) { c.x = WORLD_W - 6; c.vx = -Math.abs(c.vx); }
      if (c.y < 6) { c.y = 6; c.vy = Math.abs(c.vy); }
      if (c.y > WORLD_H - 6) { c.y = WORLD_H - 6; c.vy = -Math.abs(c.vy); }
      const v = Math.hypot(c.vx, c.vy);
      const cost = (0.30 + g[G_SIZ] * 0.075) * (v * v / 2200) * g[G_MET] * 5.4 + 0.85 * g[G_MET];
      c.energy -= cost * dt;

      // ---- 死亡 / 繁殖 ----
      if (c.energy <= 0 || c.age > 96) { kill(c, 'starve'); continue; }
      if (c.energy > g[G_REP] && c.age > 6) {
        const cap = c.kind === 0 ? HERB_CAP : CARN_CAP;
        // 用本帧实时计数判定容量，避免同步化繁殖造成的种群过冲
        if ((c.kind === 0 ? herbCount : carnCount) < cap && c.age - c.lastRep > 4.5) {
          c.state = 3; c.lastRep = c.age; reproduce(c);
        }
      }
    }

    // 回收尸体
    for (let i = creatures.length - 1; i >= 0; i--) {
      const c = creatures[i];
      if (c.alive) continue;
      if (S.t - c.dead > 0.6) {
        if (S.sel === c) S.sel = null;
        creatures.splice(i, 1);
        freeList.push(c);
      }
    }
    S.herbN = herbCount; S.carnN = carnCount;
  }

  function catastrophe() {
    let killed = 0;
    for (const c of creatures) {
      if (!c.alive) continue;
      if (rng.chance(0.30)) { kill(c, 'cat'); killed++; }
    }
    audio.sfx('explode'); shake.add(0.7); ctx.vibrate(PATTERNS.explode);
    particles.explosion(WORLD_W / 2, WORLD_H / 2, 2.2, PALETTE.red);
    ctx.hint('天灾降临：淘汰 ' + killed + ' 个个体', 2600);
  }

  // ---------------- 布局 ----------------
  let scale = 1, ox = 0, oy = 0, bottomPad = 62, ctrl = null, VW = 0, VH = 0;
  function layout(w, h) {
    bottomPad = (ctrl && ctrl.offsetHeight ? ctrl.offsetHeight : 58) + 12;
    VW = w; VH = h - bottomPad;
    const panelW = w > 900 ? 250 : 0;
    const availW = w - panelW - 16, availH = VH - 12;
    scale = Math.min(availW / WORLD_W, availH / WORLD_H);
    ox = (w - panelW - WORLD_W * scale) / 2;
    oy = (VH - WORLD_H * scale) / 2;
  }
  const sx = (x) => ox + x * scale;
  const sy = (y) => oy + y * scale;

  // ---------------- 控件 ----------------
  function mkBtn(label, fn, cls) {
    const b = document.createElement('button');
    b.className = 'btn ' + (cls || 'btn-ghost');
    b.textContent = label;
    b.style.cssText = 'padding:6px 9px;font-size:12px;line-height:1.1';
    ctx.listen(b, 'click', (e) => { e.preventDefault(); audio.sfx('click'); ctx.vibrate(PATTERNS.tap); fn(b); });
    return b;
  }
  function mkSlider(label, min, max, val, step, fn) {
    const l = document.createElement('label');
    l.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:#7d8db3';
    const s = document.createElement('span'); s.textContent = label;
    const r = document.createElement('input');
    r.type = 'range'; r.className = 'range'; r.style.width = '78px';
    r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(val);
    ctx.listen(r, 'input', () => fn(+r.value));
    l.appendChild(s); l.appendChild(r);
    return l;
  }
  function buildControls() {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center;align-items:center';
    el.appendChild(mkBtn('暂停', (b) => { S.paused = !S.paused; b.textContent = S.paused ? '继续' : '暂停'; }));
    el.appendChild(mkBtn('速度1x', (b) => { S.speed = S.speed === 1 ? 2 : S.speed === 2 ? 5 : 1; b.textContent = '速度' + S.speed + 'x'; }));
    el.appendChild(mkBtn('撒草', () => {
      for (let k = 0; k < 90; k++) grass[rng.int(0, GW * GH - 1)] = 1;
      audio.sfx('heal'); ctx.vibrate(PATTERNS.tap);
    }));
    el.appendChild(mkBtn('天灾', () => catastrophe(), 'btn-danger'));
    el.appendChild(mkBtn('视野圈:关', (b) => { S.showVision = !S.showVision; b.textContent = '视野圈:' + (S.showVision ? '开' : '关'); }));
    el.appendChild(mkSlider('草生长', 1, 25, 4, 1, (v) => { S.grassRate = v / 100; }));
    el.appendChild(mkSlider('突变率', 2, 40, 10, 1, (v) => { S.mutRate = v / 100; }));
    el.appendChild(mkSlider('初始种群', 30, 220, 90, 10, (v) => { S.initPop = v; }));
    el.appendChild(mkBtn('重置世界', () => { resetWorld(); audio.sfx('back'); }));
    ctx.overlay(el, 'overlay-bottom');
    ctrl = el;
  }

  function hudUpdate() {
    ctx.hud('gen', '世代', S.maxGen);
    ctx.hud('herb', '草食', S.herbN, { color: PALETTE.cyan });
    ctx.hud('carn', '肉食', S.carnN, { color: PALETTE.amber });
    ctx.hud('time', '生态时间', Math.floor(S.simT) + 's');
  }

  // ---------------- 更新 ----------------
  function update(dt) {
    S.t += dt;
    const p = input.pointer;
    if (p.justDown) {
      // 点选生物
      let bi = -1, bd = 1e9;
      for (let i = 0; i < creatures.length; i++) {
        const c = creatures[i];
        if (!c.alive) continue;
        const dx = sx(c.x) - p.x, dy = sy(c.y) - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 18 && d < bd) { bd = d; bi = i; }
      }
      S.sel = bi >= 0 ? creatures[bi] : null;
      if (bi >= 0) { audio.sfx('select'); ctx.vibrate(PATTERNS.select); }
      // 点击世界撒草
      if (bi < 0 && p.x > ox && p.x < ox + WORLD_W * scale && p.y > oy && p.y < oy + WORLD_H * scale) {
        const wx = clamp((p.x - ox) / scale, 0, WORLD_W - 1), wy = clamp((p.y - oy) / scale, 0, WORLD_H - 1);
        for (let k = 0; k < 12; k++) {
          const gi = grassAt(wx + rng.range(-40, 40), wy + rng.range(-40, 40));
          grass[gi] = Math.min(1, grass[gi] + 0.7);
        }
        particles.sparkle(p.x, p.y, PALETTE.lime);
        audio.sfx('place');
      }
    }
    if (S.paused || S.finished) return;
    for (let k = 0; k < S.speed; k++) simStep(1 / 60);
    // 采样
    S.genSampleT += dt * S.speed;
    if (S.genSampleT > 0.5) {
      S.genSampleT = 0;
      if (popHist.length >= 260) popHist.shift();
      popHist.push({ h: S.herbN, c: S.carnN });
    }
    if (((S.t * 2) | 0) !== ((S.t * 2 - dt * 2) | 0)) { sampleGenes(); hudUpdate(); }
    if (S.maxGen >= 25 && !S.finished) {
      S.finished = true;
      ctx.finish(S.maxGen, {
        win: true, higherBetter: true,
        stats: [['最高世代', S.maxGen], ['出生', S.births], ['死亡', S.deaths], ['被捕食', S.eaten],
        ['平均速度', avgSpd.toFixed(1)], ['平均视野', avgVis.toFixed(0)], ['平均体型', avgSiz.toFixed(1)]]
      });
    }
    if (S.herbN === 0 && S.carnN === 0 && S.simT > 4 && !S.finished) {
      S.finished = true;
      ctx.finish(S.maxGen, { win: false, higherBetter: true, stats: [['世代', S.maxGen], ['结果', '生态崩溃']] });
    }
  }

  // ---------------- 渲染 ----------------
  function drawWorld(c) {
    // 地面
    fillRound(c, ox - 4, oy - 4, WORLD_W * scale + 8, WORLD_H * scale + 8, 8, 'rgba(9,14,26,0.9)');
    strokeRound(c, ox - 4.5, oy - 4.5, WORLD_W * scale + 9, WORLD_H * scale + 9, 8, rgba(PALETTE.green, 0.22), 1.3);
    // 草
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const v = grass[y * GW + x];
        if (v < 0.06) continue;
        const X = sx(x * CELL + CELL / 2), Y = sy(y * CELL + CELL / 2);
        const a = 0.10 + v * 0.55;
        c.fillStyle = `rgba(120,255,120,${a})`;
        const r = Math.max(0.8, (1.0 + v * 1.6) * scale);
        c.fillRect(X - r / 2, Y - r / 2, r, r);
      }
    }
    // 捕食连线 + 视野圈
    if (S.showVision) {
      c.strokeStyle = 'rgba(34,224,255,0.10)'; c.lineWidth = 1;
      for (const cr of creatures) {
        if (!cr.alive) continue;
        c.beginPath(); c.arc(sx(cr.x), sy(cr.y), cr.g[G_VIS] * scale, 0, TAU); c.stroke();
      }
    }
    for (const cr of creatures) {
      if (!cr.alive || cr.kind !== 1 || !cr.hasTarget) continue;
      c.strokeStyle = 'rgba(255,77,94,0.35)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(sx(cr.x), sy(cr.y)); c.lineTo(sx(cr.tx), sy(cr.ty)); c.stroke();
    }
    // 生物
    for (let i = 0; i < creatures.length; i++) {
      const cr = creatures[i];
      if (!cr.alive) continue;
      const X = sx(cr.x), Y = sy(cr.y);
      const r = Math.max(2.4, cr.g[G_SIZ] * scale * 1.15);
      const ang = Math.atan2(cr.vy, cr.vx);
      const cold = cr.kind === 0;
      const col = cold
        ? `hsl(${188 - cr.g[G_CAM] * 40},90%,${52 + cr.g[G_SPD] * 0.06}%)`
        : `hsl(${26 + cr.g[G_ATK] * 1.6},95%,${52 + cr.g[G_SIZ] * 2}%)`;
      const birth = S.t - cr.flash < 0.5 ? 1 + (1 - (S.t - cr.flash) / 0.5) * 0.8 : 1;
      c.save();
      c.translate(X, Y); c.rotate(ang); c.scale(birth, birth);
      if (cr === S.sel) { c.shadowColor = '#fff'; c.shadowBlur = 14; }
      else if (cr.kind === 1) { c.shadowColor = col; c.shadowBlur = 7; }
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(r * 1.5, 0); c.lineTo(-r * 0.9, r * 0.85); c.lineTo(-r * 0.45, 0); c.lineTo(-r * 0.9, -r * 0.85);
      c.closePath(); c.fill();
      c.restore();
      // 能量环
      if (scale > 0.42 && cr.energy < 45) {
        c.strokeStyle = 'rgba(255,77,94,0.5)'; c.lineWidth = 1;
        c.beginPath(); c.arc(X, Y, r * 1.9, 0, TAU); c.stroke();
      }
      if (cr === S.sel) glowCircle(c, X, Y, r * 2.2, '#ffffff', { glow: 12, width: 1.5, alpha: 0.9 });
    }
  }

  function drawCharts(c, W) {
    const pw = Math.min(250, W * 0.30), ph = 96;
    const x = W - pw - 10, y = 10;
    panel(c, x, y, pw, ph, { fill: 'rgba(8,12,24,0.88)', stroke: '#243357' });
    text(c, '种群数量', x + 8, y + 13, { size: 11, color: PALETTE.cyan, align: 'left', weight: 800 });
    text(c, `草食 ${S.herbN} · 肉食 ${S.carnN}`, x + pw - 8, y + 13, { size: 10, color: PALETTE.dim, align: 'right' });
    if (popHist.length < 2) { text(c, '采集中…', x + pw / 2, y + ph / 2 + 6, { size: 11, color: PALETTE.dim }); }
    else {
      let mx = 1;
      for (const s of popHist) mx = Math.max(mx, s.h, s.c);
      const px2 = (i) => x + 8 + (i / (popHist.length - 1)) * (pw - 16);
      const py2 = (v) => y + ph - 10 - (v / mx) * (ph - 28);
      c.strokeStyle = 'rgba(60,80,130,0.25)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x + 6, py2(0)); c.lineTo(x + pw - 6, py2(0)); c.stroke();
      c.strokeStyle = PALETTE.cyan; c.lineWidth = 1.8; c.beginPath();
      for (let i = 0; i < popHist.length; i++) { const X2 = px2(i), Y2 = py2(popHist[i].h); i ? c.lineTo(X2, Y2) : c.moveTo(X2, Y2); }
      c.stroke();
      c.strokeStyle = PALETTE.amber; c.lineWidth = 1.8; c.beginPath();
      for (let i = 0; i < popHist.length; i++) { const X2 = px2(i), Y2 = py2(popHist[i].c); i ? c.lineTo(X2, Y2) : c.moveTo(X2, Y2); }
      c.stroke();
    }
    // 基因趋势
    const gy2 = y + ph + 8, gh2 = 118;
    panel(c, x, gy2, pw, gh2, { fill: 'rgba(8,12,24,0.88)', stroke: '#243357' });
    text(c, '平均基因（草食）', x + 8, gy2 + 13, { size: 11, color: PALETTE.lime, align: 'left', weight: 800 });
    text(c, 'G' + S.maxGen, x + pw - 8, gy2 + 13, { size: 10, color: PALETTE.dim, align: 'right' });
    const vals = [avgSpd / 165, avgVis / 230, avgSiz / 12, avgCam, avgMet / 2.6];
    const names = ['速度', '视野', '体型', '伪装', '代谢'];
    const cols = [PALETTE.cyan, PALETTE.lime, PALETTE.amber, PALETTE.violet, PALETTE.red];
    for (let i = 0; i < 5; i++) {
      const by = gy2 + 24 + i * 15;
      text(c, names[i], x + 8, by, { size: 9.5, color: PALETTE.dim, align: 'left' });
      bar(c, x + 40, by - 3, pw - 54, 6, vals[i], { fill: cols[i], bg: 'rgba(255,255,255,0.08)' });
    }
    // 世代趋势迷你线
    if (geneHist.length > 2) {
      const bx = x + 8, by = gy2 + gh2 - 24, bw = pw - 16, bh = 18;
      let mn = 1e9, mx2 = -1e9;
      for (const s of geneHist) { mn = Math.min(mn, s.spd, s.vis / 1.4); mx2 = Math.max(mx2, s.spd, s.vis / 1.4); }
      if (mx2 - mn < 1) mx2 = mn + 1;
      c.strokeStyle = PALETTE.cyan; c.lineWidth = 1.4; c.beginPath();
      for (let i = 0; i < geneHist.length; i++) {
        const X2 = bx + (i / (geneHist.length - 1)) * bw;
        const Y2 = by + bh - ((geneHist[i].spd - mn) / (mx2 - mn)) * bh;
        i ? c.lineTo(X2, Y2) : c.moveTo(X2, Y2);
      }
      c.stroke();
      c.strokeStyle = PALETTE.lime; c.lineWidth = 1.4; c.beginPath();
      for (let i = 0; i < geneHist.length; i++) {
        const X2 = bx + (i / (geneHist.length - 1)) * bw;
        const Y2 = by + bh - ((geneHist[i].vis / 1.4 - mn) / (mx2 - mn)) * bh;
        i ? c.lineTo(X2, Y2) : c.moveTo(X2, Y2);
      }
      c.stroke();
    }
  }

  function drawGenePanel(c, W, H) {
    const cr = S.sel;
    if (!cr || !cr.alive) return;
    if (!cr.alive) return;
    const pw = 176, ph = 26 + GENE_N * 16 + 30;
    const x = 10, y = H - bottomPad - ph - 8;
    panel(c, x, y, pw, ph, { fill: 'rgba(8,12,24,0.9)', stroke: cr.kind ? PALETTE.amber : PALETTE.cyan });
    text(c, (cr.kind ? '肉食生物' : '草食生物') + ' · 第 ' + cr.gen + ' 代', x + 8, y + 13,
      { size: 11, color: cr.kind ? PALETTE.amber : PALETTE.cyan, align: 'left', weight: 800 });
    for (let i = 0; i < GENE_N; i++) {
      const by = y + 28 + i * 16;
      let v = 0, mx = 1;
      if (i === G_SPD) { v = cr.g[i] / 165; mx = 165; }
      else if (i === G_VIS) { v = cr.g[i] / 230; }
      else if (i === G_SIZ) { v = cr.g[i] / 12; }
      else if (i === G_MET) { v = cr.g[i] / 2.6; }
      else if (i === G_REP) { v = cr.g[i] / 210; }
      else if (i === G_ATK) { v = cr.g[i] / 26; }
      else if (i === G_CAM) { v = cr.g[i]; }
      else { v = cr.g[i] / 1.7; }
      if (cr.kind === 0 && i === G_ATK) { text(c, '攻击 (无)', x + 8, by, { size: 9.5, color: '#3b456b', align: 'left' }); continue; }
      text(c, GENE_NAME[i], x + 8, by, { size: 9.5, color: PALETTE.dim, align: 'left' });
      bar(c, x + 48, by - 3, pw - 92, 6, v, { fill: GENE_COL[i], bg: 'rgba(255,255,255,0.08)' });
      text(c, cr.g[i].toFixed(1), x + pw - 8, by, { size: 9.5, color: PALETTE.white, align: 'right' });
    }
    const ly = y + ph - 16;
    text(c, `能量 ${cr.energy.toFixed(0)} · 年龄 ${cr.age.toFixed(0)}s`, x + 8, ly, { size: 10, color: PALETTE.dim, align: 'left' });
    const st = ['觅食', '逃离', '追捕', '繁殖'][cr.state] || '游荡';
    text(c, st, x + pw - 8, ly, { size: 10, color: PALETTE.lime, align: 'right' });
  }

  function render(alpha, rdt) {
    const c = ctx.ctx, W = ctx.W, H = ctx.H;
    c.fillStyle = PALETTE.bg; c.fillRect(0, 0, W, H);
    c.save();
    c.beginPath(); c.rect(0, 0, W, VH); c.clip();
    drawWorld(c);
    c.restore();
    particles.render(c, 1);
    particles.renderTexts(c, rdt);
    drawCharts(c, W);
    drawGenePanel(c, W, H);
    text(c, `出生 ${S.births} · 死亡 ${S.deaths} · 被捕食 ${S.eaten} · 目标：演化到 25 代`,
      10, VH - 10, { size: 11, color: PALETTE.dim, align: 'left' });
    if (S.paused) text(c, '已暂停', W / 2, VH / 2, { size: 26, color: PALETTE.amber, weight: 900, glow: 16 });
    vignette(c, W, VH, 0.3);
  }

  function resize(w, h) { layout(w, h); }

  buildControls();
  layout(ctx.W, ctx.H);
  resetWorld();
  hudUpdate();
  ctx.hint('观察右上角基因趋势：速度、视野、体型会随世代漂移', 5000);

  return { update, render, resize, destroy() { } };
}
