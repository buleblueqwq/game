// 游戏运行时容器：负责创建 ctx、驱动引擎、挂载 HUD、暂停/结束/重开、资源释放
// 所有游戏通过 ctx 访问能力，禁止直接操作 DOM 全局（除 ctx.dom 提供的区域）

import { Engine } from '../core/engine.js';
import { Input } from '../core/input.js';
import { Particles } from '../core/particles.js';
import { ScreenShake, Flash, Camera, fitCanvas, PALETTE } from '../core/gfx.js';
import { getAudio } from '../core/audio.js';
import { makeRng, makeNoise } from '../core/math.js';
import { Pool } from '../core/pool.js';
import { HUD, modal, toast, keyHints, escapeHtml } from '../core/ui.js';
import { submitScore, getScore, pushRecent, forGame, addPlayTime, getSettings } from '../core/storage.js';
import { reportError, caps } from '../core/errors.js';
import { vibrate, PATTERNS } from '../core/haptics.js';
import { WorkerPool } from '../core/engine.js';

/**
 * 游戏模块契约（src/games/<id>.js）：
 *   export const meta = { id, title, category, difficulty, music, howto: [] }
 *   export function create(ctx) -> { update(dt), render(alpha, rdt), resize?(w,h),
 *                                    onInput?(e), pause?(), resume?(), destroy?(),
 *                                    hud?: [{key,label,value}], overlay?: HTMLElement }
 *   export const musicTrack = 'arcade'   // 可选：BGM 曲目名
 */

export class Player {
  constructor(root) {
    this.root = root;
    this.engine = null;
    this.input = null;
    this.game = null;
    this.meta = null;
    this.audio = getAudio();
    this.running = false;
    this.startedAt = 0;
    this.hud = null;
    this.overlays = [];
    this.destroyers = [];
    this.canvas = null;
    this.ctx2d = null;
    this.W = 0; this.H = 0;
    this.dpr = 1;
    this.workers = null;
    this._resizeObs = null;
    this._onResize = null;
  }

  async load(gameId, mod) {
    this.unload();
    this.meta = mod.meta || { id: gameId, title: gameId };
    const st = forGame(gameId);

    // ---- DOM ----
    this.root.innerHTML = '';
    this.root.className = 'player';
    const stage = document.createElement('div');
    stage.className = 'stage';
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.setAttribute('aria-label', this.meta.title || gameId);
    stage.appendChild(canvas);
    this.root.appendChild(stage);
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.stage = stage;
    this.hud = new HUD(this.root);

    // ---- 输入 ----
    this.input = new Input(window, canvas);

    // ---- 尺寸 ----
    const applySize = () => {
      const r = fitCanvas(canvas, this.ctx2d, this.dpr);
      this.W = r.w; this.H = r.h; this.dpr = r.dpr;
      try { this.game?.resize?.(r.w, r.h); } catch (e) { reportError(gameId + '.resize', e); }
    };
    this._onResize = () => applySize();
    addEventListener('resize', this._onResize);
    if (window.ResizeObserver) { this._resizeObs = new ResizeObserver(applySize); this._resizeObs.observe(stage); }
    applySize();

    // ---- ctx ----
    const particles = new Particles(this.meta.particles || 1400);
    const shake = new ScreenShake();
    const flash = new Flash();
    const camera = new Camera(this.W, this.H);
    const rng = makeRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

    const self = this;
    const ctx = {
      canvas, ctx: this.ctx2d,
      get W() { return self.W; },
      get H() { return self.H; },
      dpr: this.dpr,
      input: this.input,
      audio: this.audio,
      particles, shake, flash, camera, rng,
      noise: makeNoise((Math.random() * 1e9) | 0),
      palette: PALETTE,
      caps,
      settings: getSettings(),
      save: st,
      score: getScore(gameId),
      pool: (factory, reset, n, max) => { const p = new Pool(factory, reset, n, max); this.destroyers.push(() => p.clear()); return p; },
      hud: (key, label, value, opts) => this.hud.set(key, label, value, opts),
      hudRemove: (key) => this.hud.remove(key),
      /** 显示提示条（前 4 秒） */
      hint: (msg, ms = 4000) => this.showHint(msg, ms),
      /** 注册事件，容器销毁时自动解绑 */
      listen: (el, type, fn, opt) => { el.addEventListener(type, fn, opt); this.destroyers.push(() => el.removeEventListener(type, fn, opt)); },
      /** 注册 destroy 回调 */
      onDestroy: (fn) => this.destroyers.push(fn),
      /** 挂载自定义 DOM overlay（如卡牌手牌、按钮条） */
      overlay: (el, cls = 'overlay-bottom') => { el.classList.add(cls); this.root.appendChild(el); this.overlays.push(el); return el; },
      vibrate: (p) => vibrate(p),
      /** 结束游戏并上报分数 */
      finish: (value, { win = false, higherBetter = true, stats = null } = {}) => this.finish(value, win, higherBetter, stats),
      /** 提交中途分数（不结束） */
      submit: (value, higherBetter = true) => submitScore(gameId, value, higherBetter),
      /** 重开本局 */
      restart: () => this.restart(),
      /** 退出到首页 */
      exit: () => this.exit(),
      pause: () => this.pause(),
      isPaused: () => this.engine?.paused,
      perf: null,
      /** 动态加载第三方库（three / matter），返回 Promise */
      lib: (name) => loadLib(name),
      /** Worker 池（用时才初始化） */
      worker: (src) => { if (!this.workers) { this.workers = new WorkerPool(); this.workers.init(src); } return this.workers; },
      timeScale: 1
    };

    this.particles = particles;
    this.shake = shake;
    this.flash = flash;
    this.camera = camera;

    // ---- 创建游戏实例 ----
    try {
      this.game = mod.create(ctx);
      this.ctxRef = ctx;
    } catch (err) {
      reportError(gameId + '.create', err, true);
      this.showCrash(err);
      return false;
    }
    this.gameId = gameId;
    this.mod = mod;

    // ---- 引擎 ----
    let acc = 0;
    this.engine = new Engine({
      update: (dt) => {
        const d = dt * (ctx.timeScale || 1);
        try {
          this.game.update?.(d);
        } catch (err) { reportError(gameId + '.update', err, true); this.pauseWithError(err); }
        particles.update(d);
        shake.update(d);
        flash.update(d);
        this.input.endStep();
      },
      render: (alpha) => {
        const c = this.ctx2d;
        c.save();
        try {
          this.game.render?.(alpha, this.engine.dt);
        } catch (err) { reportError(gameId + '.render', err, true); this.pauseWithError(err); }
        c.restore();
        if (!this.ctxRef?.skipParticles) particles.render(c, this.engine.perf.tier);
        flash.draw(c, this.W, this.H);
        if (this.engine.perf && getSettings().showFps) this.drawStats(c);
      },
      onPause: () => this.game?.pause?.(),
      onResume: () => this.game?.resume?.()
    });

    this.startedAt = performance.now();
    this.running = true;
    this.engine.start();

    // ---- BGM ----
    const track = mod.musicTrack || this.meta.music || 'arcade';
    if (getSettings().music) { this.audio.unlock().then(() => this.audio.playMusic(track)); }

    // ---- 操作提示 ----
    if (this.meta.howto?.length) this.showHint(this.meta.howto.join(' · '), 6000);
    pushRecent(gameId);
    return true;
  }

  drawStats(c) {
    const r = this.engine.perf.report();
    c.save();
    c.font = '600 11px ui-monospace, monospace';
    c.textAlign = 'left'; c.textBaseline = 'top';
    const col = r.fps >= 55 ? '#8dff4d' : r.fps >= 40 ? '#ffb020' : '#ff4d5e';
    c.fillStyle = 'rgba(4,7,16,.72)';
    c.fillRect(8, 8, 132, 52);
    c.fillStyle = col;
    c.fillText(`${r.fps.toFixed(0)} fps  low1 ${r.low1.toFixed(0)}`, 14, 14);
    c.fillStyle = '#7d8db3';
    c.fillText(`up ${r.update}ms  rd ${r.render}ms`, 14, 30);
    c.fillText(`tier ${r.tier}  jank ${r.jank}`, 14, 44);
    c.restore();
  }

  showHint(msg, ms = 4000) {
    let el = this.root.querySelector('.hint-bar');
    if (!el) { el = document.createElement('div'); el.className = 'hint-bar'; this.root.appendChild(el); }
    el.innerHTML = escapeHtml(msg);
    el.classList.add('in');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => el.classList.remove('in'), ms);
  }

  finish(value, win = false, higherBetter = true, stats = null) {
    const best = submitScore(this.gameId, value, higherBetter);
    this.audio.sfx(win ? 'win' : 'lose');
    vibrate(win ? PATTERNS.win : PATTERNS.lose);
    addPlayTime(performance.now() - this.startedAt);
    const cur = getScore(this.gameId);
    const s = this.ctxRef?.settings || getSettings();
    const body = document.createElement('div');
    body.className = 'result-body';
    const rows = [
      ['本局', String(typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(2)) : value)],
      ['历史最佳', String(typeof cur.best === 'number' ? (Number.isInteger(cur.best) ? cur.best : cur.best.toFixed(2)) : cur.best)]
    ];
    if (stats) for (const [k, v] of stats) rows.push([k, String(v)]);
    body.innerHTML = `
      <div class="result-score ${win ? 'win' : ''}">${win ? '★ 通关' : '○ 结束'}</div>
      <div class="result-rows">${rows.map(([k, v]) => `<div class="rr"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('')}</div>
      ${best ? '<div class="result-best">🏆 新纪录！</div>' : ''}`;
    this.engine?.pause(true);
    const m = modal({
      title: this.meta.title,
      body,
      actions: [
        { label: '再来一局', cls: 'btn-primary', onClick: () => this.restart() },
        { label: '返回大厅', onClick: () => this.exit() }
      ],
      dismissable: false
    });
    this.resultModal = m;
  }

  restart() {
    this.resultModal?.close?.();
    this.resultModal = null;
    const id = this.gameId, mod = this.mod;
    setTimeout(() => { this.load(id, mod); }, 30);
  }

  exit() {
    this.resultModal?.close?.();
    this.unload();
    location.hash = '#/';
  }

  pause() {
    if (!this.engine || this.engine.paused) return;
    this.engine.pause();
    this.audio.duck(0.55, 5000);
    const m = modal({
      title: '暂停',
      body: '<p class="dim">呼吸一下，随时回来。</p>',
      actions: [
        { label: '继续', cls: 'btn-primary', onClick: () => this.engine.resume() },
        { label: '重开', onClick: () => this.restart() },
        { label: '返回大厅', onClick: () => this.exit() }
      ]
    });
    m.el.addEventListener('pointerdown', () => { }, { once: true });
    const closeAndResume = () => { if (this.engine?.paused) this.engine.resume(); };
    m.el.querySelectorAll('.btn').forEach(b => b.addEventListener('click', closeAndResume, { once: true }));
  }

  pauseWithError(err) {
    this.engine?.pause(true);
    this.showCrash(err);
  }

  showCrash(err) {
    const msg = (err && err.message) || String(err);
    modal({
      title: '游戏遇到问题',
      body: `<p class="dim">${escapeHtml(msg)}</p><p class="dim small">已记录日志。可重试或返回大厅。</p>`,
      actions: [
        { label: '重试', cls: 'btn-primary', onClick: () => this.restart() },
        { label: '返回大厅', onClick: () => this.exit() }
      ],
      dismissable: false
    });
  }

  unload() {
    this.running = false;
    clearTimeout(this._hintT);
    try { this.engine?.stop(); } catch { /* ignore */ }
    try { this.input?.destroy(); } catch { /* ignore */ }
    try { this.game?.destroy?.(); } catch (e) { reportError('destroy', e); }
    for (const fn of this.destroyers) { try { fn(); } catch { /* ignore */ } }
    this.destroyers = [];
    for (const el of this.overlays) el.remove();
    this.overlays = [];
    try { this.workers?.destroy(); } catch { /* ignore */ }
    this.workers = null;
    try { this._resizeObs?.disconnect(); } catch { /* ignore */ }
    if (this._onResize) removeEventListener('resize', this._onResize);
    this._onResize = null;
    try { this.hud?.destroy(); } catch { /* ignore */ }
    this.audio?.stopMusic(0.3);
    this.game = null;
    this.root.innerHTML = '';
  }
}

// ---------- 第三方库按需加载（本地 vendor，失败即降级） ----------
const libCache = new Map();
export function loadLib(name) {
  if (libCache.has(name)) return libCache.get(name);
  const base = new URL('../../', import.meta.url).href;
  const p = (() => {
    if (name === 'three') {
      return import(/* @vite-ignore */ base + 'vendor/three.module.min.js').then(m => m);
    }
    if (name === 'matter') {
      return import(/* @vite-ignore */ base + 'vendor/matter.min.js')
        .then(() => (window.Matter || globalThis.Matter))
        .catch(async () => {
          // UMD 在非模块环境不导出：回退到 script 标签注入
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = base + 'vendor/matter.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
          });
          return window.Matter;
        });
    }
    return Promise.reject(new Error('unknown lib: ' + name));
  })();
  libCache.set(name, p);
  return p;
}
