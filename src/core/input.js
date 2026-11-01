// 统一输入层：键盘 / 鼠标 / 触摸 / 手柄 + 输入缓冲 + 宽容帧（coyote time）
// 所有输入以"动作(action)"抽象，游戏只关心语义

import { reportError } from './errors.js';
import { vibrate, PATTERNS } from './haptics.js';
import { clamp } from './math.js';

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Space: 'jump', KeyZ: 'primary', KeyJ: 'primary', Enter: 'confirm',
  KeyX: 'secondary', KeyK: 'secondary', KeyC: 'dash', ShiftLeft: 'dash',
  Escape: 'pause', KeyP: 'pause', Backspace: 'back',
  KeyR: 'restart', KeyE: 'interact', KeyQ: 'skill1', KeyF: 'skill2',
  Tab: 'map', KeyM: 'mute'
};

export class Input {
  constructor(target = window, canvas = null) {
    this.target = target;
    this.canvas = canvas;
    this.down = new Set();       // 当前按住的 action
    this.pressed = new Set();    // 本逻辑步内"刚按下"
    this.released = new Set();
    this.buffer = new Map();     // action -> {t, used} 输入缓冲
    this.bufferMs = 130;         // 缓冲窗口：按下后 130ms 内仍生效
    this.pointer = { x: 0, y: 0, nx: 0, ny: 0, down: false, justDown: false, justUp: false, id: -1, pressure: 0 };
    this.pointers = new Map();   // 多指
    this.wheel = 0;
    this.keys = new Map();       // raw code -> bool
    this.listeners = new Set();
    this.enabled = true;
    this.gamepadIndex = -1;
    this.gpPrev = new Map();
    this._bind();
  }
  _bind() {
    const t = this.target;
    this._h = [];
    const on = (el, type, fn, opt) => { el.addEventListener(type, fn, opt); this._h.push([el, type, fn, opt]); };

    on(t, 'keydown', (e) => {
      if (e.repeat) return;
      const a = KEYMAP[e.code];
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.set(e.code, true);
      if (a) this._press(a, e.timeStamp);
      this._emit({ type: 'key', action: a, code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey });
    });
    on(t, 'keyup', (e) => {
      const a = KEYMAP[e.code];
      this.keys.set(e.code, false);
      if (a) { this.down.delete(a); this.released.add(a); }
      this._emit({ type: 'keyup', action: a, code: e.code });
    });
    on(window, 'blur', () => { this.down.clear(); this.pointer.down = false; this.keys.clear(); });

    const cv = this.canvas || t;
    const posFrom = (e) => {
      const r = (this.canvas || document.body).getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    on(cv, 'pointerdown', (e) => {
      if (!this.enabled) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = posFrom(e);
      this.pointer.x = p.x; this.pointer.y = p.y;
      this.pointer.down = true; this.pointer.justDown = true; this.pointer.id = e.pointerId;
      this._press('primary', e.timeStamp);
      try { cv.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      this._emit({ type: 'pointerdown', x: p.x, y: p.y, pointerId: e.pointerId, button: e.button });
      vibrate(PATTERNS.tap);
    }, { passive: true });
    on(window, 'pointermove', (e) => {
      const p = posFrom(e);
      this.pointer.x = p.x; this.pointer.y = p.y;
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._emit({ type: 'pointermove', x: p.x, y: p.y, pointerId: e.pointerId });
    }, { passive: true });
    on(window, 'pointerup', (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointer.id === e.pointerId) {
        const p = posFrom(e);
        this.pointer.x = p.x; this.pointer.y = p.y;
        this.pointer.down = false; this.pointer.justUp = true; this.pointer.id = -1;
        this.released.add('primary');
      }
      this._emit({ type: 'pointerup', x: this.pointer.x, y: this.pointer.y, pointerId: e.pointerId });
    }, { passive: true });
    on(window, 'pointercancel', (e) => { this.pointers.delete(e.pointerId); this.pointer.down = false; }, { passive: true });
    on(cv, 'wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    on(cv, 'contextmenu', (e) => e.preventDefault());

    // 手柄热插拔
    on(window, 'gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    on(window, 'gamepaddisconnected', () => { this.gamepadIndex = -1; });
  }
  _press(action, ts) {
    this.down.add(action);
    this.pressed.add(action);
    this.buffer.set(action, { t: performance.now(), used: false, ts });
  }
  _emit(e) { for (const fn of this.listeners) { try { fn(e); } catch (err) { reportError('input.listener', err); } } }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** 每个逻辑步开始时调用：把 pressed 并入缓冲 */
  beginStep() { }
  /** 每个逻辑步结束时调用：清理一次性状态 */
  endStep() {
    this.pressed.clear();
    this.released.clear();
    this.pointer.justDown = false;
    this.pointer.justUp = false;
    this.wheel = 0;
    const now = performance.now();
    for (const [k, v] of this.buffer) if (now - v.t > this.bufferMs) this.buffer.delete(k);
  }

  isDown(a) { return this.down.has(a); }
  justPressed(a) { return this.pressed.has(a); }
  /** 带缓冲的按下判定：按下后 bufferMs 内返回 true 并消耗 */
  consume(a, window = this.bufferMs) {
    const b = this.buffer.get(a);
    if (b && !b.used && performance.now() - b.t <= window) { b.used = true; this.buffer.delete(a); return true; }
    if (this.pressed.has(a)) { this.pressed.delete(a); return true; }
    return false;
  }
  rawDown(code) { return !!this.keys.get(code); }
  axis() {
    let x = 0, y = 0;
    if (this.down.has('left')) x -= 1;
    if (this.down.has('right')) x += 1;
    if (this.down.has('up')) y -= 1;
    if (this.down.has('down')) y += 1;
    const gp = this.gamepad();
    if (gp) {
      x += Math.abs(gp.axes[0]) > 0.25 ? gp.axes[0] : 0;
      y += Math.abs(gp.axes[1]) > 0.25 ? gp.axes[1] : 0;
    }
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }
  gamepad() {
    if (this.gamepadIndex < 0 || !navigator.getGamepads) return null;
    const gps = navigator.getGamepads();
    const gp = gps[this.gamepadIndex];
    if (!gp) return null;
    // 映射手柄按键到 action
    const map = { 0: 'jump', 2: 'primary', 1: 'secondary', 5: 'dash', 9: 'pause', 4: 'skill1' };
    for (const [bi, a] of Object.entries(map)) {
      const on = !!gp.buttons[bi]?.pressed;
      if (on && !this.gpPrev.get(bi)) { this._press(a, performance.now()); }
      this.gpPrev.set(bi, on);
    }
    return gp;
  }
  destroy() { for (const [el, type, fn, opt] of this._h) el.removeEventListener(type, fn, opt); this._h = []; this.listeners.clear(); }
}

/**
 * 宽容帧计时器：coyote time（离开平台后仍可跳）+ jump buffer（落地前按跳仍生效）
 */
export class ToleranceTimer {
  constructor(coyoteMs = 110, bufferMs = 130) {
    this.coyoteMs = coyoteMs; this.bufferMs = bufferMs;
    this.coyote = 0; this.buffer = 0;
  }
  update(dtMs) { this.coyote -= dtMs; this.buffer -= dtMs; }
  refreshCoyote() { this.coyote = this.coyoteMs; }
  requestJump() { this.buffer = this.bufferMs; }
  get canJump() { return this.coyote > 0 && this.buffer > 0; }
  consumeJump() { this.coyote = 0; this.buffer = 0; }
}

/** 虚拟摇杆 / 触屏按钮渲染（移动端） */
export class TouchControls {
  constructor(layers = []) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.zones = [];
    for (const l of layers) {
      const el = document.createElement('div');
      el.className = 'touch-zone ' + (l.cls || '');
      el.style.cssText = l.css || '';
      el.textContent = l.label || '';
      el.dataset.action = l.action || '';
      this.root.appendChild(el);
      this.zones.push({ el, action: l.action, down: false });
    }
    this._bind();
  }
  _bind() {
    for (const z of this.zones) {
      const down = (e) => { e.preventDefault(); z.down = true; z.el.classList.add('active'); vibrate(PATTERNS.tap); };
      const up = (e) => { e.preventDefault(); z.down = false; z.el.classList.remove('active'); };
      z.el.addEventListener('pointerdown', down);
      z.el.addEventListener('pointerup', up);
      z.el.addEventListener('pointercancel', up);
      z.el.addEventListener('pointerleave', up);
    }
  }
  isDown(action) { return this.zones.some(z => z.action === action && z.down); }
  mount(parent) { parent.appendChild(this.root); }
  destroy() { this.root.remove(); }
}
