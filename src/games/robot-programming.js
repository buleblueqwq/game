// 编程机器人 —— 编写指令序列控制机器人走迷宫、搬运箱子
import { clamp, lerp, TAU, makeRng, dist } from '../core/math.js';
import { PALETTE, neon, roundRect, text, glowRect, glowCircle } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'robot-programming', title: '编程机器人', category: 'puzzle', difficulty: 4,
  music: 'puzzle', howto: ['点底部按钮添加指令', '⏵ 运行程序', '让机器人到达 ★ 目标'],
  particles: 400
};
export const musicTrack = 'puzzle';

const LV = [
  ['########', '#S.....#', '#.####.#', '#.#..#.#', '#.#.#G.#', '#.#....#', '#.######', '########'],
  ['#########', '#S..#..*#', '#.#.#.#.#', '#.#.#.#.#', '#...#.#.#', '#.###.#.#', '#.#...#.#', '#.#.#.#T#', '#.#.#.#.#', '#########'],
  ['#######', '#S....#', '#.###.#', '#.#.*.#', '#.#.#.#', '#...#T#', '#.###.#', '#.....#', '#######'],
  ['########', '#S.....#', '#.####.#', '#.#..#.#', '#.#.#*#.#', '#.#.#.#.#', '#...#T.#', '#.#####G', '########']
];

export function create(ctx) {
  const { audio, particles, shake, save, rng } = ctx;
  let lvIdx = save.get('level', 0) || 0, map, cols, rows, cell = 0, ox = 0, oy = 0;
  let program = [], expanded = [], pc = 0, running = false, timer = 0, robot = null, boxes = [], won = false, win = null, t = 0;
  let carrying = null;

  function load(i) {
    map = LV[i % LV.length].map(r => r.split('')); rows = map.length; cols = map[0].length;
    boxes = []; carrying = null; won = false; running = false; pc = 0; program = []; expanded = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const ch = map[y][x];
      if (ch === 'S') robot = { x, y, dir: 2 };
      if (ch === '*') boxes.push({ x, y, on: false });
    }
    layout(ctx.W, ctx.H); refresh(); ctx.hint?.('编写程序让机器人到 ★');
  }
  function layout(w, h) { cell = Math.floor(Math.min(w / cols, h / rows) * 0.7); ox = (w - cell * cols) / 2; oy = (h - cell * rows) / 2 + 10; }

  function expand(list, depth = 0) {
    const out = [];
    for (const ins of list) {
      if (ins.op === 'LOOP' && depth < 3) { for (let k = 0; k < ins.times; k++) out.push(...expand(ins.body, depth + 1)); }
      else out.push(ins);
    }
    return out;
  }
  function run() { if (running || won) return; expanded = expand(program); pc = 0; running = true; timer = 0; audio.sfx('confirm'); }
  function resetBot() { load(lvIdx); }

  function step() {
    if (pc >= expanded.length) { running = false; return; }
    const ins = expanded[pc]; pc++;
    const dvec = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    if (ins.op === 'L') robot.dir = (robot.dir + 3) % 4;
    else if (ins.op === 'R') robot.dir = (robot.dir + 1) % 4;
    else if (ins.op === 'F') {
      const [dx, dy] = dvec[robot.dir]; const nx = robot.x + dx, ny = robot.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || map[ny][nx] === '#') { audio.sfx('error'); ctx.vibrate(PATTERNS.error); running = false; return; }
      robot.x = nx; robot.y = ny;
      if (carrying) { carrying.x = nx; carrying.y = ny; }
      audio.sfx('step'); particles.trail(ox + nx * cell + cell / 2, oy + ny * cell + cell / 2, PALETTE.cyan, 2);
    } else if (ins.op === 'P') {
      if (!carrying) { const bi = boxes.find(b => b.x === robot.x && b.y === robot.y); if (bi) { carrying = bi; audio.sfx('pickup'); ctx.vibrate(PATTERNS.select); } }
    } else if (ins.op === 'D') {
      if (carrying) { carrying = null; audio.sfx('place'); ctx.vibrate(PATTERNS.tap); }
    }
    // 目标判定
    if (map[robot.y][robot.x] === 'G') winGame();
    // 箱子目标
    for (const b of boxes) if (map[b.y][b.x] === 'T') b.on = true;
  }
  function winGame() { won = true; running = false; audio.sfx('win'); shake.add(0.3); ctx.vibrate(PATTERNS.win); particles.burst(ox + robot.x * cell + cell / 2, oy + robot.y * cell + cell / 2, 28, { color: PALETTE.lime, speed: 200, life: .8 }); save.set('level', (lvIdx + 1) % LV.length); setTimeout(() => { lvIdx = (lvIdx + 1) % LV.length; save.set('level', lvIdx); load(lvIdx); }, 1400); }

  function refresh() { ctx.hud('lv', '关卡', lvIdx + 1); ctx.hud('prog', '指令', expanded.length || program.length); ctx.hud('carrying', '持箱', carrying ? '是' : '否'); }

  // 指令面板
  const panel = document.createElement('div'); panel.className = 'overlay-bottom'; panel.style.flexDirection = 'column'; panel.style.alignItems = 'stretch';
  const row1 = document.createElement('div'); row1.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center';
  const OPS = [['F', '前进'], ['L', '左转'], ['R', '右转'], ['P', '拾取'], ['D', '放下'], ['LOOP', '循环'], ['↺', '清空'], ['⏵', '运行']];
  for (const [op, n] of OPS) {
    const b = document.createElement('button'); b.className = 'btn btn-ghost'; b.textContent = n; b.style.padding = '8px 12px';
    b.onclick = () => {
      if (op === '↺') { program = []; updateProg(); }
      else if (op === '⏵') run();
      else if (op === 'LOOP') { const times = prompt('循环次数？', '3'); if (times && parseInt(times) > 0) program.push({ op: 'LOOP', times: clamp(parseInt(times), 1, 9), body: [] }); updateProg(); }
      else program.push({ op }); updateProg();
    };
    row1.appendChild(b);
  }
  panel.appendChild(row1);
  const progEl = document.createElement('div'); progEl.style.cssText = 'font-family:var(--mono);font-size:11px;color:var(--cyan);text-align:center;max-height:54px;overflow:auto;margin-top:6px;line-height:1.5';
  panel.appendChild(progEl);
  ctx.overlay(panel);
  function updateProg() { progEl.textContent = program.length ? program.map(p => p.op === 'LOOP' ? `(LOOP${p.times} …)` : p.op).join(' ') : '（空程序）'; refresh(); }

  const off = ctx.listen(ctx.canvas, 'keydown', e => { if (e.key === ' ') { e.preventDefault(); run(); } if (e.key.toLowerCase() === 'r') resetBot(); });

  load(lvIdx);

  function update(dt) { t += dt; if (running) { timer += dt; while (timer > 0.14 && running) { timer -= 0.14; step(); } } }
  function w2s(x, y) { return [ox + x * cell + cell / 2, oy + y * cell + cell / 2]; }
  function render(a) {
    const c = ctx.ctx, { W, H } = ctx; c.fillStyle = '#070b16'; c.fillRect(0, 0, W, H);
    c.save(); c.translate(ox, oy);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const ch = map[y][x], X = x * cell, Y = y * cell;
      if (ch === '#') neon(c, cc => roundRect(cc, X + 1, Y + 1, cell - 2, cell - 2, 4), '#3a4a6e', { glow: 3, width: 1.5, layers: 1, inner: null, fill: 'rgba(30,42,72,.9)' });
      else { roundRect(c, X + 1, Y + 1, cell - 2, cell - 2, 4); c.fillStyle = 'rgba(255,255,255,.02)'; c.fill(); }
      if (ch === 'G') { const [sx, sy] = w2s(x, y); glowCircle(c, sx, sy, cell * 0.3 + Math.sin(t * 4) * 3, PALETTE.lime, { glow: 16, width: 2, fill: 'rgba(141,255,77,.2)' }); text(c, '★', sx, sy, { size: cell * 0.4, color: '#fff' }); }
      if (ch === 'T') { const [sx, sy] = w2s(x, y); glowRect(c, X + cell * 0.2, Y + cell * 0.2, cell * 0.6, cell * 0.6, PALETTE.amber, { glow: 8, width: 2, r: 4, fill: 'rgba(255,176,32,.18)' }); }
    }
    for (const b of boxes) if (!carrying || b !== carrying) { const [sx, sy] = w2s(b.x, b.y); neon(c, cc => roundRect(cc, sx - cell * 0.3, sy - cell * 0.3, cell * 0.6, cell * 0.6, 4), PALETTE.amber, { glow: 8, width: 2, layers: 2, fill: 'rgba(255,176,32,.22)' }); }
    // 机器人
    if (robot) { const [sx, sy] = w2s(robot.x, robot.y); glowCircle(c, sx, sy, cell * 0.32, PALETTE.cyan, { glow: 14, width: 2, fill: 'rgba(34,224,255,.25)' }); const dv = [[0, -1], [1, 0], [0, 1], [-1, 0]][robot.dir]; glowLine(c, sx, sy, sx + dv[0] * cell * 0.28, sy + dv[1] * cell * 0.28, PALETTE.white, 3, 8); if (carrying) { const [bx, by] = w2s(carrying.x, carrying.y); neon(c, cc => roundRect(cc, bx - cell * 0.3, by - cell * 0.3, cell * 0.6, cell * 0.6, 4), PALETTE.amber, { glow: 8, width: 2, layers: 2, fill: 'rgba(255,176,32,.22)' }); } }
    c.restore();
    particles.render(c, 1);
    if (won) text(c, 'SOLVED', W / 2, H / 2, { size: Math.min(40, W * .08), color: PALETTE.lime, weight: 900, glow: 18 });
  }
  return { update, render, resize: (w, h) => layout(w, h), destroy() { off?.(); } };
}
