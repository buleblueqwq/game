// 3D 迷宫·第一人称 —— Three.js 程序生成迷宫 + 指针锁定视角 + 钥匙/出口 + 圆-线段碰撞 + 小地图
// 复用外壳：ctx.lib('three') 异步加载本地 Three.js；自建 WebGL 画布叠加在 2D 画布之上。
// 硬门槛：固定 60Hz 逻辑、对象复用、WebGL 失败降级、自适应像素比、错误边界。

export const meta = {
  id: 'fps-maze',
  title: '3D 迷宫·第一人称',
  category: '3d',
  difficulty: 3,
  music: 'space',
  howto: ['点击画面锁定鼠标视角', 'WASD 移动 · 鼠标转视角', '先找金钥匙，再抵达绿色出口逃脱'],
  controls: ['WASD 移动', '鼠标 视角', 'Shift 疾跑', 'E 互动', 'Esc 暂停']
};

const CELL = 4;          // 单元格世界尺寸
const WALL_H = 3.2;      // 墙高
const WALL_T = 0.4;      // 墙厚
const P_R = 0.45;        // 玩家半径
const EYE = 1.6;         // 视高
const COLS = 13, ROWS = 13;

function genMaze(cols, rows) {
  const cells = [];
  for (let y = 0; y < rows; y++) {
    cells[y] = [];
    for (let x = 0; x < cols; x++) cells[y][x] = { N: true, E: true, S: true, W: true, v: false };
  }
  const stack = [[0, 0]]; cells[0][0].v = true;
  const D = [['N', 0, -1, 'S'], ['S', 0, 1, 'N'], ['E', 1, 0, 'W'], ['W', -1, 0, 'E']];
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const opts = [];
    for (const [d, dx, dy, o] of D) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !cells[ny][nx].v) opts.push([d, dx, dy, o, nx, ny]);
    }
    if (!opts.length) { stack.pop(); continue; }
    const [d, dx, dy, o, nx, ny] = opts[(Math.random() * opts.length) | 0];
    cells[y][x][d] = false; cells[ny][nx][o] = false; cells[ny][nx].v = true; stack.push([nx, ny]);
  }
  return cells;
}

function closestOnSeg(px, pz, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - x0) * dx + (pz - z0) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [x0 + dx * t, z0 + dz * t];
}

export function create(ctx) {
  const { audio, input, rng, vibrate } = ctx;
  let THREE = null, renderer = null, scene = null, camera = null, ready = false, failed = false;
  let W = ctx.W, H = ctx.H, dpr = ctx.dpr;
  const clock = { last: performance.now() };

  // 自建 WebGL 画布，叠加在 2D 画布之上
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:5;display:none;cursor:crosshair;';
  ctx.canvas.parentNode.appendChild(cv);

  // 小地图 overlay
  const mm = document.createElement('canvas');
  mm.width = 132; mm.height = 132;
  mm.style.cssText = 'position:absolute;right:10px;top:10px;z-index:7;border-radius:10px;box-shadow:0 0 18px rgba(40,120,255,.35);background:rgba(6,10,20,.7);';
  (ctx.canvas.parentNode.parentNode || document.body).appendChild(mm);
  const mmx = mm.getContext('2d');

  let cells, segs, key, exit, keyMesh, exitMesh, playerLight, player = { x: CELL / 2, z: CELL / 2 };
  let yaw = 0, pitch = 0, locked = false, dragging = false, keyGot = false, won = false, t = 0;
  let score = 0;

  function init3D(T) {
    renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(dpr, 2));
    renderer.setSize(W, H, false);
    renderer.shadowMap.enabled = false;
    scene = new T.Scene();
    scene.background = new T.Color(0x05070e);
    scene.fog = new T.Fog(0x05070e, 2.5, 24);

    camera = new T.PerspectiveCamera(72, W / H, 0.05, 200);
    camera.rotation.order = 'YXZ';

    scene.add(new T.AmbientLight(0x33406a, 0.7));
    const hemi = new T.HemisphereLight(0x4a6cff, 0x0a0a14, 0.5); scene.add(hemi);
    playerLight = new T.PointLight(0x9fc0ff, 2.0, 22, 1.6); scene.add(playerLight);

    // 地板 + 霓虹网格
    const floor = new T.Mesh(
      new T.PlaneGeometry(COLS * CELL + 8, ROWS * CELL + 8),
      new T.MeshStandardMaterial({ color: 0x070b16, roughness: 0.95, metalness: 0.0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(COLS * CELL / 2, 0, ROWS * CELL / 2);
    scene.add(floor);
    const grid = new T.GridHelper(COLS * CELL, COLS, 0x1b6fff, 0x0e2a55);
    grid.position.set(COLS * CELL / 2, 0.02, ROWS * CELL / 2);
    scene.add(grid);

    // 迷宫墙体（InstancedMesh，单 draw call）
    cells = genMaze(COLS, ROWS);
    segs = [];
    const walls = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const c = cells[y][x];
      if (c.N) { const x0 = x * CELL, z0 = y * CELL; segs.push([x0, z0, x0 + CELL, z0]); walls.push({ h: true, x0, z0 }); }
      if (c.W) { const x0 = x * CELL, z0 = y * CELL; segs.push([x0, z0, x0, z0 + CELL]); walls.push({ h: false, x0, z0 }); }
    }
    const wallGeo = new T.BoxGeometry(1, 1, 1);
    const wallMat = new T.MeshStandardMaterial({ color: 0x0b1b3a, emissive: 0x1b6fff, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.2 });
    const inst = new T.InstancedMesh(wallGeo, wallMat, walls.length);
    const dummy = new T.Object3D();
    walls.forEach((w, i) => {
      if (w.h) { dummy.position.set(w.x0 + CELL / 2, WALL_H / 2, w.z0); dummy.scale.set(CELL, WALL_H, WALL_T); }
      else { dummy.position.set(w.x0, WALL_H / 2, w.z0 + CELL / 2); dummy.scale.set(WALL_T, WALL_H, CELL); }
      dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);

    // 钥匙 & 出口
    const far = (cx, cy) => Math.abs(cx) + Math.abs(cy);
    let kx = COLS - 1, ky = ROWS - 1;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (far(x, y) > far(kx, ky)) { kx = x; ky = y; }
    // 钥匙放在次远格，出口放在最远格
    key = { x: (kx === 1 ? 2 : 1) * CELL + CELL / 2, z: (ky === 1 ? 2 : 1) * CELL + CELL / 2 };
    exit = { x: kx * CELL + CELL / 2, z: ky * CELL + CELL / 2 };
    // 简单让钥匙随机到一个较远格
    const cand = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (far(x, y) > 6) cand.push([x, y]);
    const kc = cand[(rng() * cand.length) | 0];
    key = { x: kc[0] * CELL + CELL / 2, z: kc[1] * CELL + CELL / 2 };

    keyMesh = new T.Mesh(new T.IcosahedronGeometry(0.42, 0),
      new T.MeshStandardMaterial({ color: 0xffd23b, emissive: 0xffb000, emissiveIntensity: 0.9, roughness: 0.3 }));
    keyMesh.position.set(key.x, 1.0, key.z); scene.add(keyMesh);
    exitMesh = new T.Mesh(new T.TorusGeometry(0.9, 0.12, 12, 32),
      new T.MeshStandardMaterial({ color: 0x21ff9b, emissive: 0x14d97f, emissiveIntensity: 1.0 }));
    exitMesh.position.set(exit.x, 1.2, exit.z); exitMesh.rotation.x = Math.PI / 2; scene.add(exitMesh);

    player = { x: CELL / 2, z: CELL / 2 };
    yaw = 0; pitch = 0;
    ready = true; cv.style.display = 'block';
  }

  ctx.lib('three').then(T => { THREE = T; try { init3D(T); } catch (e) { failed = true; reportErr(e); } })
    .catch(e => { failed = true; reportErr(e); });

  function reportErr(e) { try { console.error('fps-maze', e); } catch {} }

  // 指针锁定 + 拖拽视角（兼容桌面与移动端）
  ctx.listen(cv, 'click', () => { if (!locked && cv.requestPointerLock) cv.requestPointerLock(); });
  ctx.listen(document, 'pointerlockchange', () => { locked = document.pointerLockElement === cv; });
  ctx.listen(cv, 'pointerdown', () => { if (!locked) dragging = true; });
  ctx.listen(window, 'pointerup', () => { dragging = false; });
  ctx.listen(window, 'mousemove', (e) => {
    if (!ready) return;
    if (locked || dragging) applyLook(e.movementX || 0, e.movementY || 0);
  });
  function applyLook(dx, dy) {
    yaw -= dx * 0.0024; pitch -= dy * 0.0024;
    pitch = pitch < -1.35 ? -1.35 : pitch > 1.35 ? 1.35 : pitch;
  }

  function tryMove(nx, nz) {
    for (let it = 0; it < 2; it++) {
      for (const s of segs) {
        if (Math.min(s[0], s[2]) > nx + P_R || Math.max(s[0], s[2]) < nx - P_R) continue;
        if (Math.min(s[1], s[3]) > nz + P_R || Math.max(s[1], s[3]) < nz - P_R) continue;
        const [cx, cz] = closestOnSeg(nx, nz, s[0], s[1], s[2], s[3]);
        let dx = nx - cx, dz = nz - cz, d = Math.hypot(dx, dz);
        if (d < P_R) {
          if (d < 1e-4) { dx = 0; dz = nz < cz ? -1 : 1; d = 1; }
          nx = cx + dx / d * P_R; nz = cz + dz / d * P_R;
        }
      }
    }
    return [nx, nz];
  }

  function update(dt) {
    if (!ready || won) return;
    dt = Math.min(dt, 0.05);
    t += dt;

    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let mx = 0, mz = 0;
    if (input.isDown('up')) { mx += fx; mz += fz; }
    if (input.isDown('down')) { mx -= fx; mz -= fz; }
    if (input.isDown('right')) { mx += rx; mz += rz; }
    if (input.isDown('left')) { mx -= rx; mz -= rz; }
    const l = Math.hypot(mx, mz);
    const speed = (input.isDown('dash') ? 6.5 : 4.2);
    if (l > 0) {
      mx = mx / l * speed * dt; mz = mz / l * speed * dt;
      const [nx, nz] = tryMove(player.x + mx, player.z + mz);
      player.x = nx; player.z = nz;
    }

    // 钥匙拾取
    if (!keyGot) {
      const d = Math.hypot(player.x - key.x, player.z - key.z);
      if (d < 1.0) {
        keyGot = true; if (keyMesh) keyMesh.visible = false;
        audio.sfx('powerup'); vibrate([18]);
        ctx.hud('key', '钥匙', '✓ 已获得', { color: '#ffd23b' });
      }
    }
    // 出口
    const de = Math.hypot(player.x - exit.x, player.z - exit.z);
    if (keyGot && de < 1.3) {
      won = true;
      const time = t;
      audio.sfx('win'); vibrate([30, 40, 30]);
      ctx.finish(Math.round(time * 10) / 10, { win: true, higherBetter: false, stats: [['钥匙', '已拾取'], ['逃脱用时', time.toFixed(1) + 's']] });
      return;
    }

    // 相机 / 灯光跟随
    camera.position.set(player.x, EYE, player.z);
    camera.rotation.y = yaw; camera.rotation.x = pitch;
    if (playerLight) playerLight.position.set(player.x, EYE + 0.4, player.z);
    if (keyMesh) { keyMesh.rotation.y += dt * 1.6; keyMesh.position.y = 1.0 + Math.sin(t * 3) * 0.15; }
    if (exitMesh) exitMesh.rotation.z += dt * 0.8;

    score = Math.hypot(player.x, player.z);
    ctx.hud('time', '用时', t.toFixed(1) + 's');
    ctx.hud('dist', '距出口', de.toFixed(0) + 'm');
  }

  function drawLoading(c) {
    c.save();
    c.fillStyle = '#070b16'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#7fb0ff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '600 18px ui-monospace, monospace';
    c.fillText(failed ? '3D 引擎加载失败（可能不支持 WebGL）' : '加载 3D 引擎…', W / 2, H / 2);
    c.restore();
  }

  function drawMinimap() {
    if (!cells) return;
    const s = mm.width, pad = 6, sx = (s - pad * 2) / COLS, sz = (s - pad * 2) / ROWS;
    mmx.clearRect(0, 0, s, s);
    mmx.fillStyle = 'rgba(6,10,20,.85)'; mmx.fillRect(0, 0, s, s);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const open = !cells[y][x].N && !cells[y][x].W;
      mmx.fillStyle = '#0d1b33';
      mmx.fillRect(pad + x * sx, pad + y * sz, sx, sz);
    }
    // 出口 / 钥匙
    mmx.fillStyle = '#21ff9b';
    mmx.fillRect(pad + (exit.x / CELL - 0.5) * sx, pad + (exit.z / CELL - 0.5) * sz, sx, sz);
    if (!keyGot) { mmx.fillStyle = '#ffd23b'; mmx.fillRect(pad + (key.x / CELL - 0.5) * sx, pad + (key.z / CELL - 0.5) * sz, sx, sz); }
    // 玩家
    mmx.fillStyle = '#ffffff';
    mmx.beginPath(); mmx.arc(pad + player.x / CELL * sx, pad + player.z / CELL * sz, 3, 0, 7); mmx.fill();
    // 朝向
    mmx.strokeStyle = '#ffffff'; mmx.lineWidth = 1.5; mmx.beginPath();
    mmx.moveTo(pad + player.x / CELL * sx, pad + player.z / CELL * sz);
    mmx.lineTo(pad + (player.x / CELL - fx0() * 1.2) * sx, pad + (player.z / CELL - fz0() * 1.2) * sz); mmx.stroke();
  }
  function fx0() { return -Math.sin(yaw); }
  function fz0() { return -Math.cos(yaw); }

  function render() {
    if (!ready) { drawLoading(ctx.ctx); return; }
    renderer.render(scene, camera);
    drawMinimap();
  }

  function resize(w, h) {
    W = w; H = h;
    if (renderer && camera) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
  }

  function destroy() {
    try { if (renderer) renderer.dispose(); } catch {}
    try { cv.remove(); mm.remove(); } catch {}
    try { document.exitPointerLock?.(); } catch {}
  }

  return { update, render, resize, destroy };
}
