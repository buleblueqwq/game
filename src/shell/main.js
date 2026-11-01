// 应用入口：路由、大厅首页、生成式封面、设置、全局错误边界

import { GAMES, GAME_MAP, CATEGORIES, coverSeed } from './catalog.js';
import { Player } from './player.js';
import { installGlobalHandlers, reportError, caps, onError } from '../core/errors.js';
import { getAudio } from '../core/audio.js';
import { getSettings, setSetting, isFavorite, toggleFavorite, getStore, saveStore } from '../core/storage.js';
import { modal, toast, settingsPanel, escapeHtml } from '../core/ui.js';
import { vibrate, PATTERNS } from '../core/haptics.js';
import { makeRng, TAU, hexToRgb } from '../core/math.js';

installGlobalHandlers();

const app = document.getElementById('app');
const audio = getAudio();

// ---------------- 路由 ----------------
const routes = {
  home: () => renderHome(),
  game: (id) => renderGame(id)
};

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('game/')) return { name: 'game', id: h.slice(5) };
  return { name: 'home' };
}

let currentPlayer = null;

async function navigate() {
  const r = parseHash();
  if (r.name === 'game') {
    if (!GAME_MAP.has(r.id)) { location.hash = '#/'; return; }
    await renderGame(r.id);
  } else {
    currentPlayer?.unload();
    currentPlayer = null;
    renderHome();
  }
}

addEventListener('hashchange', navigate);

// ---------------- 生成式封面 ----------------
// 每张卡片用确定性随机绘制独一无二的程序图形（无外部图片资源）
function drawCover(cv, id, color, seed) {
  const w = cv.width = 320, h = cv.height = 180;
  const c = cv.getContext('2d');
  const rng = makeRng(seed);
  const [r, g, b] = hexToRgb(color);
  const bg = c.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, `rgb(${r * 0.10 | 0},${g * 0.10 | 0},${b * 0.14 | 0})`);
  bg.addColorStop(1, '#070b16');
  c.fillStyle = bg; c.fillRect(0, 0, w, h);

  const style = seed % 5;
  c.save();
  c.globalCompositeOperation = 'lighter';

  if (style === 0) { // 环阵
    const n = 3 + (seed % 4);
    for (let i = 0; i < n; i++) {
      c.beginPath();
      c.strokeStyle = `rgba(${r},${g},${b},${0.1 + i * 0.07})`;
      c.lineWidth = 1 + (i % 3);
      c.arc(w / 2 + (rng() - .5) * 40, h / 2 + (rng() - .5) * 30, 18 + i * 16, 0, TAU);
      c.stroke();
    }
  } else if (style === 1) { // 网格点阵
    for (let y = 0; y < 9; y++) for (let x = 0; x < 16; x++) {
      const v = rng();
      if (v > 0.62) {
        c.fillStyle = `rgba(${r},${g},${b},${0.15 + v * 0.5})`;
        const s = 2 + v * 5;
        c.fillRect(x * 20 + 6, y * 20 + 6, s, s);
      }
    }
  } else if (style === 2) { // 折线波形
    for (let k = 0; k < 3; k++) {
      c.beginPath();
      c.strokeStyle = `rgba(${r},${g},${b},${0.18 + k * 0.12})`;
      c.lineWidth = 2;
      for (let x = 0; x <= w; x += 8) {
        const y = h / 2 + Math.sin(x * 0.03 + k * 1.7) * (30 - k * 8) + Math.sin(x * 0.011 + k) * 18;
        x ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
  } else if (style === 3) { // 六边形蜂巢
    const R = 22;
    for (let row = -1; row < 6; row++) for (let col = -1; col < 12; col++) {
      const cx = col * R * 1.74 + (row % 2 ? R * .87 : 0), cy = row * R * 1.5;
      if (rng() > 0.55) {
        c.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = i * TAU / 6;
          const x = cx + Math.cos(a) * R * 0.86, y = cy + Math.sin(a) * R * 0.86;
          i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.closePath();
        c.strokeStyle = `rgba(${r},${g},${b},${0.08 + rng() * 0.35})`;
        c.lineWidth = 1.4; c.stroke();
      }
    }
  } else { // 放射光束
    const n = 10 + (seed % 12);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng() * .2;
      const len = 40 + rng() * 120;
      c.beginPath();
      c.strokeStyle = `rgba(${r},${g},${b},${0.08 + rng() * 0.22})`;
      c.lineWidth = 1 + rng() * 2.4;
      c.moveTo(w / 2, h / 2);
      c.lineTo(w / 2 + Math.cos(a) * len, h / 2 + Math.sin(a) * len);
      c.stroke();
    }
  }
  c.restore();

  // 中心辉光
  const gr = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, 120);
  gr.addColorStop(0, `rgba(${r},${g},${b},0.30)`);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = gr; c.fillRect(0, 0, w, h);

  // 暗角 + 扫描线
  const vg = c.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, 200);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.6)');
  c.fillStyle = vg; c.fillRect(0, 0, w, h);
  c.globalAlpha = 0.06; c.fillStyle = '#000';
  for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
  c.globalAlpha = 1;
}

// ---------------- 首页 ----------------
let homeState = { q: '', cat: 'all', sort: 'default' };

function renderHome() {
  app.innerHTML = '';
  app.className = 'home-root';
  const store = getStore();

  // Hero
  const hero = document.createElement('section');
  hero.className = 'hero';
  hero.innerHTML = `
    <canvas class="hero-bg"></canvas>
    <div class="hero-inner">
      <div class="hero-badge">HTML5 · CANVAS · WEBGL · WEBAUDIO · ZERO BUILD</div>
      <h1 class="hero-title"><span class="t1">NEON</span> <span class="t2">ARCADE</span></h1>
      <p class="hero-sub">${GAMES.length} 款硬核网页小游戏 · 固定时间步 60Hz · 程序化音乐 · 全离线可玩</p>
      <div class="hero-stats">
        <div><b>${GAMES.length}</b><span>游戏</span></div>
        <div><b>${Object.keys(store.scores || {}).length}</b><span>已玩</span></div>
        <div><b>${Math.round((store.totalPlayMs || 0) / 60000)}</b><span>分钟</span></div>
        <div><b>${(store.favorites || []).length}</b><span>收藏</span></div>
      </div>
      <div class="hero-actions">
        <button class="btn btn-primary hero-cta" id="btn-random">🎲 随机来一局</button>
        <button class="btn btn-ghost" id="btn-fav">★ 我的收藏</button>
        <button class="btn btn-ghost" id="btn-settings">⚙ 设置</button>
      </div>
    </div>`;
  app.appendChild(hero);
  startHeroBg(hero.querySelector('.hero-bg'));

  // 工具栏
  const bar = document.createElement('div');
  bar.className = 'toolbar';
  bar.innerHTML = `
    <div class="search-wrap">
      <svg viewBox="0 0 24 24" class="search-icon"><path d="M21 21l-4.3-4.3M19 11a8 8 0 11-16 0 8 8 0 0116 0z"/></svg>
      <input id="search" class="search" placeholder="搜索游戏、标签…（如 塔防 / 音游 / 3D）" autocomplete="off">
      <button class="clear-btn" id="clear-q" hidden>✕</button>
    </div>
    <select id="sort" class="select">
      <option value="default">默认排序</option>
      <option value="diff">难度升序</option>
      <option value="diff-desc">难度降序</option>
      <option value="best">最佳成绩</option>
      <option value="plays">游玩次数</option>
      <option value="name">名称</option>
    </select>`;
  app.appendChild(bar);

  // 分类
  const cats = document.createElement('div');
  cats.className = 'cat-row';
  const mkCat = (c) => {
    const b = document.createElement('button');
    const n = c.id === 'all' ? GAMES.length : GAMES.filter(g => g.category === c.id).length;
    b.className = 'cat-chip' + (homeState.cat === c.id ? ' on' : '');
    b.innerHTML = `<i>${c.icon}</i>${escapeHtml(c.name)}<em>${n}</em>`;
    b.style.setProperty('--c', c.color);
    b.onclick = () => { homeState.cat = c.id; vibrate(PATTERNS.tap); audio.sfx('click'); refresh(); };
    return b;
  };
  CATEGORIES.forEach(c => cats.appendChild(mkCat(c)));
  app.appendChild(cats);

  // 网格
  const grid = document.createElement('div');
  grid.className = 'grid';
  app.appendChild(grid);

  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.innerHTML = '<div class="empty-ico">🛸</div><p>没有匹配的游戏，换个关键词试试。</p>';
  app.appendChild(empty);

  function filtered() {
    const q = homeState.q.trim().toLowerCase();
    let list = GAMES.filter(g => homeState.cat === 'all' || g.category === homeState.cat);
    if (homeState.cat === 'fav') list = GAMES.filter(g => isFavorite(g.id));
    if (q) list = list.filter(g =>
      g.title.toLowerCase().includes(q) || g.id.includes(q) ||
      (g.tags || []).some(t => t.toLowerCase().includes(q)) ||
      g.desc.toLowerCase().includes(q));
    const sc = store.scores || {};
    if (homeState.sort === 'diff') list = [...list].sort((a, b) => (a.difficulty || 3) - (b.difficulty || 3));
    else if (homeState.sort === 'diff-desc') list = [...list].sort((a, b) => (b.difficulty || 3) - (a.difficulty || 3));
    else if (homeState.sort === 'best') list = [...list].sort((a, b) => (sc[b.id]?.best || 0) - (sc[a.id]?.best || 0));
    else if (homeState.sort === 'plays') list = [...list].sort((a, b) => (sc[b.id]?.plays || 0) - (sc[a.id]?.plays || 0));
    else if (homeState.sort === 'name') list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh'));
    return list;
  }

  function refresh() {
    cats.querySelectorAll('.cat-chip').forEach((b, i) => b.classList.toggle('on', CATEGORIES[i].id === homeState.cat || (homeState.cat === 'fav' && CATEGORIES[i].id === 'all')));
    const list = filtered();
    empty.style.display = list.length ? 'none' : 'flex';
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    list.forEach((g, i) => frag.appendChild(makeCard(g, i)));
    grid.appendChild(frag);
    lazyCovers();
  }

  function makeCard(g, i) {
    const sc = store.scores?.[g.id];
    const fav = isFavorite(g.id);
    const el = document.createElement('article');
    el.className = 'card';
    el.style.setProperty('--c', g.color);
    el.style.setProperty('--i', i);
    el.tabIndex = 0;
    el.innerHTML = `
      <div class="card-cover"><canvas data-id="${g.id}" width="320" height="180"></canvas>
        <span class="card-fav ${fav ? 'on' : ''}" data-fav="${g.id}" title="收藏">★</span>
        <span class="card-cat">${escapeHtml((CATEGORIES.find(c => c.id === g.category) || {}).name || '')}</span>
        ${sc?.best ? `<span class="card-best">最佳 ${escapeHtml(String(sc.best))}</span>` : ''}
      </div>
      <div class="card-body">
        <h3>${escapeHtml(g.title)}</h3>
        <p>${escapeHtml(g.desc)}</p>
        <div class="card-tags">${(g.tags || []).map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div>
        <div class="card-foot">
          <span class="diff" title="难度">${'◆'.repeat(g.difficulty || 3)}<i>${'◆'.repeat(5 - (g.difficulty || 3))}</i></span>
          ${sc?.plays ? `<span class="plays">${sc.plays} 次</span>` : '<span class="plays new">NEW</span>'}
        </div>
      </div>`;
    const open = () => { audio.unlock(); audio.sfx('select'); location.hash = '#/game/' + g.id; };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    el.addEventListener('pointerenter', () => audio.sfx('hover'));
    el.querySelector('[data-fav]').addEventListener('click', (e) => {
      e.stopPropagation();
      const on = toggleFavorite(g.id);
      e.currentTarget.classList.toggle('on', on);
      vibrate(PATTERNS.select); audio.sfx(on ? 'coin' : 'back');
      if (homeState.cat === 'fav') refresh();
    });
    return el;
  }

  // 惰性绘制封面（避免首屏阻塞 <3s 预算）
  let lazyTimer = 0;
  function lazyCovers() {
    const cvs = [...grid.querySelectorAll('canvas[data-id]')];
    let i = 0;
    clearInterval(lazyTimer);
    lazyTimer = setInterval(() => {
      const t0 = performance.now();
      while (i < cvs.length && performance.now() - t0 < 8) {
        const cv = cvs[i++];
        const g = GAME_MAP.get(cv.dataset.id);
        if (g) drawCover(cv, g.id, g.color, coverSeed(g.id));
      }
      if (i >= cvs.length) clearInterval(lazyTimer);
    }, 16);
  }

  // 事件
  const q = bar.querySelector('#search');
  q.value = homeState.q;
  q.addEventListener('input', () => { homeState.q = q.value; bar.querySelector('#clear-q').hidden = !q.value; refresh(); });
  bar.querySelector('#clear-q').addEventListener('click', () => { q.value = ''; homeState.q = ''; bar.querySelector('#clear-q').hidden = true; refresh(); q.focus(); });
  bar.querySelector('#sort').addEventListener('change', (e) => { homeState.sort = e.target.value; refresh(); });

  hero.querySelector('#btn-random').onclick = () => {
    audio.unlock(); audio.sfx('powerup'); vibrate(PATTERNS.select);
    const g = GAMES[Math.floor(Math.random() * GAMES.length)];
    location.hash = '#/game/' + g.id;
  };
  hero.querySelector('#btn-fav').onclick = () => {
    homeState.cat = homeState.cat === 'fav' ? 'all' : 'fav';
    audio.sfx('click');
    if (homeState.cat === 'fav') toast('已切换到收藏视图');
    refresh();
    cats.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  hero.querySelector('#btn-settings').onclick = openSettings;

  refresh();
  requestAnimationFrame(() => app.classList.add('ready'));
}

// ---------------- Hero 背景动画 ----------------
function startHeroBg(cv) {
  const c = cv.getContext('2d');
  let w = 0, h = 0, dpr = Math.min(devicePixelRatio || 1, 2);
  const resize = () => {
    const r = cv.getBoundingClientRect();
    w = r.width; h = r.height;
    cv.width = w * dpr; cv.height = h * dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);
  const rng = makeRng(20261031);
  const dots = Array.from({ length: 90 }, () => ({ x: rng() * w, y: rng() * h, vx: (rng() - .5) * 22, vy: (rng() - .5) * 22, r: rng() * 1.8 + .6, h: rng() }));
  let t = 0, raf = 0, last = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (document.hidden) return;
    c.fillStyle = 'rgba(7,11,22,0.28)';
    c.fillRect(0, 0, w, h);
    // 网格
    c.strokeStyle = 'rgba(34,224,255,0.045)'; c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x < w; x += 46) { c.moveTo(x, 0); c.lineTo(x, h); }
    for (let y = 0; y < h; y += 46) { c.moveTo(0, y); c.lineTo(w, y); }
    c.stroke();
    // 星点连线
    for (const d of dots) {
      d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.x < 0 || d.x > w) d.vx *= -1;
      if (d.y < 0 || d.y > h) d.vy *= -1;
      c.fillStyle = `hsla(${180 + d.h * 120},100%,65%,${0.25 + 0.4 * Math.abs(Math.sin(t * 2 + d.h * 9))})`;
      c.beginPath(); c.arc(d.x, d.y, d.r, 0, TAU); c.fill();
    }
    c.strokeStyle = 'rgba(34,224,255,0.075)';
    c.beginPath();
    for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) {
      const dx = dots[i].x - dots[j].x, dy = dots[i].y - dots[j].y;
      const dd = dx * dx + dy * dy;
      if (dd < 10000) { c.moveTo(dots[i].x, dots[i].y); c.lineTo(dots[j].x, dots[j].y); }
    }
    c.stroke();
  };
  raf = requestAnimationFrame(loop);
  return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); };
}

// ---------------- 设置 ----------------
function openSettings() {
  audio.unlock();
  const m = modal({
    title: '设置',
    body: settingsPanel(audio, (q) => toast('画质：' + q))
  });
  const s = getSettings();
  const extra = document.createElement('div');
  extra.className = 'set-extra';
  extra.innerHTML = `
    <div class="set-meta">
      <span>设备：${caps.mobile ? '移动端' : '桌面端'} · ${caps.cores} 核 · DPR ${caps.dpr}</span>
      <span>WebGL ${caps.webgl ? '✓' : '✗'} · WebAudio ${caps.audio ? '✓' : '✗'} · 震动 ${caps.vibration ? '✓' : '✗'}</span>
    </div>
    <div class="set-audio-test">
      <button class="btn btn-ghost" id="test-sfx">试听音效</button>
      <button class="btn btn-ghost" id="test-music">试听音乐</button>
      <button class="btn btn-ghost" id="test-buzz">测试震动</button>
    </div>
    <div class="set-danger">
      <button class="btn btn-danger" id="wipe">清除全部存档</button>
    </div>`;
  m.body.appendChild(extra);
  extra.querySelector('#test-sfx').onclick = () => { audio.unlock().then(() => { audio.sfx('powerup'); audio.sfx('explode'); }); };
  extra.querySelector('#test-music').onclick = () => { audio.unlock().then(() => audio.playMusic(audio.music ? null : 'menu')); };
  extra.querySelector('#test-buzz').onclick = () => { vibrate(PATTERNS.combo); toast(caps.vibration ? '震动已触发' : '当前设备不支持震动'); };
  extra.querySelector('#wipe').onclick = () => {
    modal({
      title: '确认清除？', body: '<p class="dim">所有分数、收藏与进度都会被删除。</p>',
      actions: [{ label: '确认清除', cls: 'btn-danger', onClick: () => { localStorage.removeItem('neon.arcade.v1'); location.reload(); } }, { label: '取消' }]
    });
  };
}

// ---------------- 游戏页 ----------------
async function renderGame(id) {
  app.innerHTML = '';
  app.className = 'game-root';
  const top = document.createElement('div');
  top.className = 'game-top';
  const g = GAME_MAP.get(id);
  top.innerHTML = `
    <button class="icon-btn" id="back" title="返回大厅 (Esc)">←</button>
    <div class="gt-title">${escapeHtml(g.title)}</div>
    <div class="gt-actions">
      <button class="icon-btn" id="pause" title="暂停 (Esc)">⏸</button>
      <button class="icon-btn" id="restart" title="重开 (R)">⟳</button>
      <button class="icon-btn" id="fav2" title="收藏">${isFavorite(id) ? '★' : '☆'}</button>
    </div>`;
  app.appendChild(top);
  const mount = document.createElement('div');
  mount.className = 'game-mount';
  app.appendChild(mount);

  top.querySelector('#back').onclick = () => { audio.sfx('back'); location.hash = '#/'; };
  top.querySelector('#fav2').onclick = (e) => { const on = toggleFavorite(id); e.currentTarget.textContent = on ? '★' : '☆'; audio.sfx(on ? 'coin' : 'back'); };

  const player = new Player(mount);
  currentPlayer = player;
  top.querySelector('#pause').onclick = () => player.pause();
  top.querySelector('#restart').onclick = () => { audio.sfx('click'); player.restart(); };

  const onKey = (e) => {
    if (e.key === 'Escape') { if (player.engine && !player.engine.paused) player.pause(); else location.hash = '#/'; }
    if (e.key === 'r' || e.key === 'R') player.restart();
  };
  addEventListener('keydown', onKey);
  player.onDestroy?.(() => { });
  const prevUnload = player.unload.bind(player);
  player.unload = () => { removeEventListener('keydown', onKey); prevUnload(); };

  // 动态加载模块（带进度与失败重试）
  let mod = null, attempt = 0, lastErr = null;
  const loadBar = document.createElement('div');
  loadBar.className = 'load-bar';
  loadBar.innerHTML = `<div class="lb-track"><div class="lb-fill"></div></div><div class="lb-label">加载 ${escapeHtml(g.title)}…</div>`;
  mount.appendChild(loadBar);
  while (attempt < 3 && !mod) {
    try {
      loadBar.querySelector('.lb-fill').style.width = (30 + attempt * 25) + '%';
      mod = await import(/* @vite-ignore */ `../games/${id}.js`);
    } catch (err) { lastErr = err; attempt++; await new Promise(r => setTimeout(r, 300 * attempt)); }
  }
  loadBar.querySelector('.lb-fill').style.width = '100%';
  setTimeout(() => loadBar.remove(), 220);
  if (!mod) {
    reportError('module.load:' + id, lastErr, true);
    mount.innerHTML = `<div class="crash"><h3>加载失败</h3><p class="dim">${escapeHtml(String(lastErr))}</p><button class="btn btn-primary" onclick="location.hash='#/'">返回大厅</button></div>`;
    return;
  }
  const ok = await player.load(id, mod);
  if (!ok) return;
  top.querySelector('#pause').onclick = () => player.pause();
}

// ---------------- 启动 ----------------
function boot() {
  // 首次交互解锁音频
  const unlock = () => { audio.unlock(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);

  onError((info) => {
    if (info.fatal) toast('出现异常：' + info.message, { type: 'error', ms: 4000 });
  });

  navigate();

  // PWA-ish：注册 Service Worker（离线可玩）
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register(new URL('../../sw.js', import.meta.url).href).catch(() => { });
  }
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot); else boot();

// 暴露一点调试接口
window.__NEON__ = { GAMES, audio, caps, toast, reportError };
