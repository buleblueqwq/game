// DOM UI 工具：Toast / 模态框 / HUD 条 / 按钮 / 设置面板
// 优先用 DOM 承载 UI（比 Canvas 省帧、可无障碍、易排版）

import { getSettings, setSetting } from './storage.js';
import { vibrate, PATTERNS } from './haptics.js';

let toastHost = null;
export function toast(msg, { type = 'info', ms = 2200 } = {}) {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(msg)}</span>`;
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const kill = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 320); };
  const timer = setTimeout(kill, ms);
  el.addEventListener('click', () => { clearTimeout(timer); kill(); });
  return el;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 模态框：返回 {close, el, body} */
export function modal({ title = '', body = '', actions = [], dismissable = true, cls = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  const card = document.createElement('div');
  card.className = 'modal-card ' + cls;
  card.innerHTML = `
    ${title ? `<h3 class="modal-title">${escapeHtml(title)}</h3>` : ''}
    <div class="modal-body">${typeof body === 'string' ? body : ''}</div>
    <div class="modal-actions"></div>`;
  if (typeof body !== 'string') card.querySelector('.modal-body').appendChild(body);
  const actHost = card.querySelector('.modal-actions');
  const api = { close, el: wrap, body: card.querySelector('.modal-body') };
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.cls || 'btn-ghost');
    b.textContent = a.label;
    b.onclick = () => { vibrate(PATTERNS.select); a.onClick?.(api); if (a.close !== false) close(); };
    actHost.appendChild(b);
  }
  function close() {
    wrap.classList.remove('in');
    setTimeout(() => wrap.remove(), 260);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape' && dismissable) close(); }
  document.addEventListener('keydown', onKey);
  if (dismissable) wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  wrap.appendChild(card);
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  return api;
}

/** 通用按钮 */
export function button(label, onClick, cls = 'btn-ghost') {
  const b = document.createElement('button');
  b.className = 'btn ' + cls;
  b.textContent = label;
  b.onclick = (e) => { e.stopPropagation(); vibrate(PATTERNS.select); onClick?.(e); };
  return b;
}

/** 顶部 HUD 容器（分数/生命/波次等） */
export class HUD {
  constructor(parent) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    parent.appendChild(this.el);
    this.fields = new Map();
  }
  set(key, label, value, { color = null, icon = null } = {}) {
    let f = this.fields.get(key);
    if (!f) {
      f = document.createElement('div');
      f.className = 'hud-field';
      f.innerHTML = `<span class="hud-label"></span><span class="hud-value"></span>`;
      this.el.appendChild(f);
      this.fields.set(key, f);
    }
    const lv = f.querySelector('.hud-value');
    if (lv.textContent !== String(value)) { lv.textContent = value; lv.classList.remove('pop'); void lv.offsetWidth; lv.classList.add('pop'); }
    f.querySelector('.hud-label').textContent = label;
    if (icon) f.querySelector('.hud-label').textContent = icon + ' ' + label;
    if (color) lv.style.color = color;
    return f;
  }
  remove(key) { const f = this.fields.get(key); if (f) { f.remove(); this.fields.delete(key); } }
  clear() { for (const [, f] of this.fields) f.remove(); this.fields.clear(); }
  destroy() { this.el.remove(); }
}

/** 设置面板（音频/画质/震动） */
export function settingsPanel(audioEngine, onQuality) {
  const s = getSettings();
  const div = document.createElement('div');
  div.className = 'settings-grid';
  const row = (label, control) => {
    const r = document.createElement('label');
    r.className = 'set-row';
    r.innerHTML = `<span>${label}</span>`;
    r.appendChild(control);
    div.appendChild(r);
    return r;
  };
  const toggle = (key, val, cb) => {
    const t = document.createElement('input');
    t.type = 'checkbox'; t.className = 'switch'; t.checked = val;
    t.onchange = () => { cb(t.checked); vibrate(PATTERNS.tap); };
    return t;
  };
  const slider = (key, val, cb) => {
    const t = document.createElement('input');
    t.type = 'range'; t.min = 0; t.max = 100; t.value = Math.round(val * 100); t.className = 'range';
    t.oninput = () => cb(t.value / 100);
    return t;
  };
  const sel = (opts, val, cb) => {
    const t = document.createElement('select');
    t.className = 'select';
    for (const [v, l] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; t.appendChild(o); }
    t.value = val;
    t.onchange = () => cb(t.value);
    return t;
  };
  row('音乐', toggle('music', s.music, v => { setSetting('music', v); audioEngine?.setMusic(v); }));
  row('音效', toggle('sfx', s.sfx, v => { setSetting('sfx', v); audioEngine?.setSfx(v); }));
  row('震动', toggle('haptics', s.haptics, v => { setSetting('haptics', v); vibrate(PATTERNS.tap); }));
  row('总音量', slider('master', s.master, v => { setSetting('master', v); audioEngine?.setMaster(v); }));
  row('画质', sel([['auto', '自适应'], ['high', '高'], ['medium', '中'], ['low', '低（省电）']], s.quality, v => { setSetting('quality', v); onQuality?.(v); }));
  row('显示 FPS', toggle('fps', s.showFps, v => setSetting('showFps', v)));
  row('降低特效', toggle('fx', s.reducedFx, v => setSetting('reducedFx', v)));
  return div;
}

/** 加载进度条 */
export class LoadingBar {
  constructor(parent, label = '加载中') {
    this.el = document.createElement('div');
    this.el.className = 'loading-bar';
    this.el.innerHTML = `<div class="lb-track"><div class="lb-fill"></div></div><div class="lb-label">${escapeHtml(label)}</div>`;
    parent.appendChild(this.el);
    this.fill = this.el.querySelector('.lb-fill');
    this.labelEl = this.el.querySelector('.lb-label');
  }
  set(pct, label) {
    this.fill.style.width = Math.round(Math.max(0, Math.min(1, pct)) * 100) + '%';
    if (label) this.labelEl.textContent = label;
  }
  done() { this.el.classList.add('done'); setTimeout(() => this.el.remove(), 300); }
  destroy() { this.el.remove(); }
}

/** 简易键盘提示条 */
export function keyHints(hints) {
  const el = document.createElement('div');
  el.className = 'key-hints';
  el.innerHTML = hints.map(h => `<span><kbd>${escapeHtml(h[0])}</kbd>${escapeHtml(h[1])}</span>`).join('');
  return el;
}
