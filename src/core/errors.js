// 全局错误边界 + 能力探测 + 优雅降级

const state = { handlers: new Set(), booted: false };

export function onError(fn) { state.handlers.add(fn); return () => state.handlers.delete(fn); }
export function reportError(scope, err, fatal = false) {
  const info = {
    scope, fatal,
    message: (err && (err.message || err.reason?.message)) || String(err),
    stack: err && err.stack ? String(err.stack).split('\n').slice(0, 6).join(' | ') : '',
    time: Date.now()
  };
  try {
    const key = 'neon.errors';
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    list.unshift(info);
    localStorage.setItem(key, JSON.stringify(list.slice(0, 30)));
  } catch { /* 存储不可用则忽略 */ }
  for (const h of state.handlers) { try { h(info); } catch { /* 忽略处理器异常 */ } }
  console.warn('[NEON]', scope, info.message, info.stack);
}

export function installGlobalHandlers() {
  if (state.booted) return;
  state.booted = true;
  addEventListener('error', (e) => reportError('window.onerror', e.error || e.message, false));
  addEventListener('unhandledrejection', (e) => reportError('unhandledrejection', e.reason, false));
}

/** 给任意函数包一层 try/catch，返回安全版本（游戏主循环用） */
export function guard(scope, fn) {
  return function (...args) {
    try { return fn.apply(this, args); }
    catch (err) { reportError(scope, err, false); return undefined; }
  };
}

/** 能力探测：WebGL / WebAudio / Vibration / Offscreen / Worker */
export const caps = (() => {
  const c = {
    webgl2: false, webgl: false, audio: false, vibration: false,
    worker: typeof Worker !== 'undefined', offscreen: false,
    fullscreen: !!document.documentElement.requestFullscreen,
    touch: false, dpr: 1, cores: 4, mem: 0, reducedMotion: false, mobile: false
  };
  try {
    const cv = document.createElement('canvas');
    c.webgl2 = !!cv.getContext('webgl2');
    c.webgl = c.webgl2 || !!(cv.getContext('webgl') || cv.getContext('experimental-webgl'));
    c.offscreen = typeof cv.transferControlToOffscreen === 'function';
  } catch { /* ignore */ }
  try {
    c.audio = typeof (window.AudioContext || window.webkitAudioContext) !== 'undefined';
  } catch { /* ignore */ }
  try { c.vibration = typeof navigator.vibrate === 'function'; } catch { /* ignore */ }
  try { c.cores = navigator.hardwareConcurrency || 4; } catch { /* ignore */ }
  try { c.mem = navigator.deviceMemory || performance.memory?.jsHeapSizeLimit || 0; } catch { /* ignore */ }
  c.dpr = Math.min(devicePixelRatio || 1, 3);
  c.touch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  c.mobile = c.touch && Math.min(innerWidth, innerHeight) < 900;
  try { c.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
  return c;
})();

/** 定义一个 try 包装：能力缺失时执行 fallback */
export function withFallback(fn, fallback, scope = 'feature') {
  try { return fn(); } catch (err) { reportError(scope, err, false); return fallback; }
}
