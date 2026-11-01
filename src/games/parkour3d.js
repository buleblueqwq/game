// 3D 程序生成跑酷 —— Three.js 无尽赛道：三车道 + 跳跃/切道 + 坑洞/障碍/金币/加速带 + 第三人称跟随相机
// 复用外壳：ctx.lib('three') 异步加载本地 Three.js；自建 WebGL 画布叠加在 2D 画布之上。
// 硬门槛：固定逻辑步、对象复用(网格复用/剔除)、WebGL 失败降级、自适应像素比。

export const meta = {
  id: 'parkour3d',
  title: '3D 程序生成跑酷',
  category: '3d',
  difficulty: 3,
  music: 'chase',
  howto: ['自动向前奔跑', 'A/D 或 ←/→ 切换车道', '空格跳跃越过坑洞与障碍，吃金币、踩加速带'],
  controls: ['A/D 切道', '空格 跳跃', 'Shift 加速', 'Esc 暂停']
};

const LANE_W = 2.4;
const TRACK = LANE_W * 3 + 0.6;
const CH = 10;            // 区块长度
const G = 24;             // 重力
const JUMP_V = 9.2;
const BASE_SPEED = 8;
const MAX_SPEED = 22;

function laneX(l) { return (l - 1) * LANE_W; }

export function create(ctx) {
  const { audio, input, rng, vibrate } = ctx;
  let THREE = null, renderer = null, scene = null, camera = null, ready = false, failed = false;
  let W = ctx.W, H = ctx.H, dpr = ctx.dpr;

  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:5;display:none;';
  ctx.canvas.parentNode.appendChild(cv);

  let player = { x: 0, y: 0, z: 0, vy: 0, lane: 1, grounded: true };
  let speed = BASE_SPEED, distance = 0, coins = 0, nextZ = -10, dead = false;
  let jumpBuf = 0, coyote = 0, boostT = 0, t = 0;

  const groundSegs = [];   // {z0,z1,group}
  const obstacles = [];    // {lane,z,mesh}
  const coinArr = [];      // {lane,z,mesh,got}
  const boosts = [];       // {lane,z,mesh,used}
  let coinGeo, coinMat, obsGeo, obsMat, boostGeo, boostMat, railMat, floorMat;

  function init3D(T) {
    renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(dpr, 2));
    renderer.setSize(W, H, false);
    scene = new T.Scene();
    scene.background = new T.Color(0x060912);
    scene.fog = new T.Fog(0x060912, 18, 75);

    camera = new T.PerspectiveCamera(62, W / H, 0.1, 300);
    camera.rotation.order = 'YXZ';

    scene.add(new T.HemisphereLight(0x6fb6ff, 0x0a0a16, 0.9));
    const dir = new T.DirectionalLight(0xbfe0ff, 0.8); dir.position.set(6, 18, -6); scene.add(dir);

    // 复用几何/材质
    floorMat = new T.MeshStandardMaterial({ color: 0x0a1226, roughness: 0.9, metalness: 0.05 });
    railMat = new T.MeshStandardMaterial({ color: 0x0a1838, emissive: 0x21a0ff, emissiveIntensity: 1.1, roughness: 0.4 });
    obsGeo = new T.BoxGeometry(0.95, 1.4, 0.95);
    obsMat = new T.MeshStandardMaterial({ color: 0x2a0d18, emissive: 0xff2e5e, emissiveIntensity: 0.85, roughness: 0.4 });
    coinGeo = new T.TorusGeometry(0.32, 0.11, 8, 20);
    coinMat = new T.MeshStandardMaterial({ color: 0xffd23b, emissive: 0xffb000, emissiveIntensity: 0.9, roughness: 0.3 });
    boostGeo = new T.BoxGeometry(1.7, 0.12, 2.4);
    boostMat = new T.MeshStandardMaterial({ color: 0x05202a, emissive: 0x18f0c8, emissiveIntensity: 1.0, roughness: 0.3 });

    // 预生成赛道
    while (nextZ < 70) genChunk(nextZ);
    ready = true; cv.style.display = 'block';
  }

  function addGround(z0, z1) {
    const len = z1 - z0;
    const g = new THREE.Group();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(TRACK, 0.5, len), floorMat);
    floor.position.set(0, -0.25, (z0 + z1) / 2); g.add(floor);
    const railL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, len), railMat);
    railL.position.set(-TRACK / 2 + 0.1, 0.2, (z0 + z1) / 2); g.add(railL);
    const railR = railL.clone(); railR.position.x = TRACK / 2 - 0.1; g.add(railR);
    scene.add(g); groundSegs.push({ z0, z1, group: g });
  }

  function addObstacle(lane, z) {
    const m = new THREE.Mesh(obsGeo, obsMat);
    m.position.set(laneX(lane), 0.7, z); scene.add(m); obstacles.push({ lane, z, mesh: m });
  }
  function addCoin(lane, z) {
    const m = new THREE.Mesh(coinGeo, coinMat);
    m.position.set(laneX(lane), 1.0, z); m.rotation.x = Math.PI / 2; scene.add(m);
    coinArr.push({ lane, z, mesh: m, got: false });
  }
  function addBoost(lane, z) {
    const m = new THREE.Mesh(boostGeo, boostMat);
    m.position.set(laneX(lane), 0.08, z); scene.add(m); boosts.push({ lane, z, mesh: m, used: false });
  }

  function genChunk(z0) {
    const z1 = z0 + CH;
    const warm = distance < 26;
    let pit = false, pitLen = 0, pitStart = 0;
    if (!warm && rng() < 0.34) { pitLen = 2.3 + rng() * 1.5; pitStart = 2 + rng() * (CH - pitLen - 3); pit = true; }
    if (pit) { addGround(z0, z0 + pitStart); addGround(z0 + pitStart + pitLen, z1); }
    else addGround(z0, z1);

    if (!warm) {
      // 障碍（保证至少留一条空道）
      if (rng() < 0.6) {
        const n = rng() < 0.28 ? 2 : 1;
        const sh = [0, 1, 2].sort(() => rng() - 0.5);
        let placed = 0;
        for (const ln of sh) {
          if (placed >= n) break;
          if (pit && z0 + pitStart <= z0 + 6 && z0 + pitStart + pitLen >= z0 + 4) continue; // 坑上方不挡
          addObstacle(ln, z0 + 4.5 + rng() * 2.5); placed++;
        }
      }
      if (rng() < 0.2) { const ln = (rng() * 3) | 0; addBoost(ln, z0 + 5.5); }
    }
    // 金币串
    if (rng() < 0.55) {
      const ln = (rng() * 3) | 0, cnt = 3 + ((rng() * 3) | 0);
      for (let i = 0; i < cnt; i++) addCoin(ln, z0 + 2 + i * 1.15);
    }
    nextZ = z1;
  }

  function groundAt(z) {
    for (const s of groundSegs) if (z >= s.z0 && z <= s.z1) return true;
    return false;
  }

  function cull(arr, behindZ) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].z < behindZ) {
        const m = arr[i].mesh || arr[i].group;
        scene.remove(m);
        arr.splice(i, 1);
      }
    }
  }

  ctx.lib('three').then(T => { THREE = T; try { init3D(T); } catch (e) { failed = true; console.error('parkour3d', e); } })
    .catch(e => { failed = true; console.error('parkour3d', e); });

  function update(dt) {
    if (!ready || dead) return;
    dt = Math.min(dt, 0.04); t += dt;

    // 难度提速
    speed = Math.min(MAX_SPEED, BASE_SPEED + distance * 0.018);
    if (boostT > 0) { boostT -= dt; speed = Math.max(speed, MAX_SPEED * 0.95); }
    distance += speed * dt;
    player.z = distance;

    // 切道
    if (input.justPressed('left')) player.lane = Math.max(0, player.lane - 1);
    if (input.justPressed('right')) player.lane = Math.min(2, player.lane + 1);
    const tx = laneX(player.lane);
    player.x += (tx - player.x) * Math.min(1, dt * 11);

    // 跳跃（缓冲 + coyote）
    if (input.justPressed('jump')) jumpBuf = 0.16;
    jumpBuf -= dt; coyote -= dt;
    const onG = groundAt(player.z) && player.y <= 0.001;
    if (onG) { player.y = 0; player.vy = 0; player.grounded = true; coyote = 0.12; }
    else player.grounded = false;
    if (jumpBuf > 0 && coyote > 0) {
      player.vy = JUMP_V; jumpBuf = 0; coyote = 0; player.grounded = false;
      audio.sfx('jump'); vibrate([12]);
    }
    // 重力
    player.vy -= G * dt; player.y += player.vy * dt;
    if (player.y < 0 && groundAt(player.z)) { player.y = 0; player.vy = 0; player.grounded = true; }

    // 障碍碰撞
    for (const o of obstacles) {
      if (o.lane === player.lane && Math.abs(o.z - player.z) < 0.75 && player.y < 1.35) {
        return die();
      }
    }
    // 金币
    for (const c of coinArr) {
      if (!c.got && c.lane === player.lane && Math.abs(c.z - player.z) < 0.8 && player.y > 0.1 && player.y < 2.3) {
        c.got = true; c.mesh.visible = false; coins++; audio.sfx('coin'); vibrate([8]);
      }
      if (!c.got) c.mesh.rotation.z += dt * 4;
    }
    // 加速带
    for (const b of boosts) {
      if (!b.used && b.lane === player.lane && Math.abs(b.z - player.z) < 1.3) {
        b.used = true; boostT = 2.6; audio.sfx('powerup'); vibrate([14, 8, 14]);
      }
    }

    // 掉落死亡
    if (player.y < -3) return die();

    // 生成 / 剔除
    while (nextZ < player.z + 70) genChunk(nextZ);
    const bz = player.z - 26;
    for (let i = groundSegs.length - 1; i >= 0; i--) if (groundSegs[i].z1 < bz) { scene.remove(groundSegs[i].group); groundSegs.splice(i, 1); }
    cull(obstacles, bz); cull(coinArr, bz); cull(boosts, bz);

    // 相机跟随
    const cx = player.x * 0.5, cy = player.y + 4.6, cz = player.z - 9.5;
    camera.position.x += (cx - camera.position.x) * Math.min(1, dt * 6);
    camera.position.y += (cy - camera.position.y) * Math.min(1, dt * 6);
    camera.position.z += (cz - camera.position.z) * Math.min(1, dt * 9);
    camera.lookAt(player.x * 0.4, player.y + 1.2, player.z + 9);

    ctx.hud('dist', '距离', Math.floor(distance) + 'm');
    ctx.hud('coins', '金币', String(coins));
    ctx.hud('speed', '速度', speed.toFixed(0));
  }

  function die() {
    dead = true;
    audio.sfx('explode'); vibrate([40, 30, 40]);
    const sc = Math.floor(distance) + coins * 15;
    ctx.finish(sc, { win: false, higherBetter: true, stats: [['距离', Math.floor(distance) + 'm'], ['金币', String(coins)]] });
  }

  function drawLoading(c) {
    c.save();
    c.fillStyle = '#060912'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#7fe9ff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '600 18px ui-monospace, monospace';
    c.fillText(failed ? '3D 引擎加载失败（可能不支持 WebGL）' : '生成赛道中…', W / 2, H / 2);
    c.restore();
  }

  function render() {
    if (!ready) { drawLoading(ctx.ctx); return; }
    renderer.render(scene, camera);
  }

  function resize(w, h) {
    W = w; H = h;
    if (renderer && camera) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }

  function destroy() {
    try { if (renderer) renderer.dispose(); } catch {}
    try { cv.remove(); document.exitPointerLock?.(); } catch {}
  }

  return { update, render, resize, destroy };
}
