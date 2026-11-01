// 存档系统：命名空间 + 版本号 + 迁移 + 配额保护 + 跨标签同步

const NS = 'neon.arcade.v1';
const SCHEMA_VERSION = 3;

const migrations = {
  // 1 -> 2: 旧版 scores 结构扁平化
  1: (s) => ({ ...s, scores: Object.fromEntries(Object.entries(s.scores || {}).map(([k, v]) => [k, typeof v === 'number' ? { best: v, plays: 0 } : v])) }),
  2: (s) => ({ ...s, settings: { ...(s.settings || {}) }, favorites: s.favorites || [] })
};

function readRaw() {
  try {
    const txt = localStorage.getItem(NS);
    if (!txt) return null;
    return JSON.parse(txt);
  } catch { return null; }
}

let cache = null;
let writeTimer = 0;

export function getStore() {
  if (cache) return cache;
  let s = readRaw();
  if (!s) {
    s = { v: SCHEMA_VERSION, scores: {}, settings: {}, favorites: [], recent: [], sessions: 0, totalPlayMs: 0 };
  } else {
    let v = s.v || 1;
    while (v < SCHEMA_VERSION) {
      const m = migrations[v];
      if (m) { try { s = m(s); } catch { /* 迁移失败保留原样 */ } }
      v++;
    }
    s.v = SCHEMA_VERSION;
  }
  cache = s;
  return cache;
}

export function saveStore(immediate = false) {
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = 0; }
  const doWrite = () => {
    try { localStorage.setItem(NS, JSON.stringify(getStore())); }
    catch (e) {
      // 配额超限：清掉最旧的一半分数再试
      try {
        const s = getStore();
        const keys = Object.keys(s.scores || {});
        keys.slice(0, Math.floor(keys.length / 2)).forEach(k => delete s.scores[k]);
        localStorage.setItem(NS, JSON.stringify(s));
      } catch { /* 彻底失败：降级为内存态 */ }
    }
  };
  if (immediate) doWrite(); else writeTimer = setTimeout(doWrite, 400);
}

/** 游戏私有存档：storage.forGame('tower-defense') */
export function forGame(id) {
  const root = getStore();
  if (!root.games) root.games = {};
  if (!root.games[id]) root.games[id] = {};
  return {
    get(key, def) { const v = root.games[id][key]; return v === undefined ? def : v; },
    set(key, val) { root.games[id][key] = val; saveStore(); return val; },
    del(key) { delete root.games[id][key]; saveStore(); },
    all() { return root.games[id]; },
    clear() { root.games[id] = {}; saveStore(); }
  };
}

export function getScore(id) { return getStore().scores[id] || { best: 0, plays: 0, last: 0 }; }
export function submitScore(id, value, higherBetter = true) {
  const s = getStore();
  const cur = s.scores[id] || { best: 0, plays: 0, last: 0 };
  const better = higherBetter ? value > cur.best : (cur.best === 0 || value < cur.best);
  cur.plays = (cur.plays || 0) + 1;
  cur.last = value;
  if (better) cur.best = value;
  s.scores[id] = cur;
  saveStore();
  return better;
}

export function getSettings() {
  const s = getStore();
  if (!s.settings) s.settings = {};
  const d = {
    music: true, sfx: true, master: 0.7, haptics: true,
    quality: 'auto', showFps: false, reducedFx: false, lang: 'zh'
  };
  return Object.assign(d, s.settings);
}
export function setSetting(k, v) { const s = getStore(); s.settings = Object.assign(getSettings(), { [k]: v }); saveStore(); }

export function toggleFavorite(id) {
  const s = getStore();
  const i = s.favorites.indexOf(id);
  if (i >= 0) s.favorites.splice(i, 1); else s.favorites.push(id);
  saveStore(true);
  return i < 0;
}
export function isFavorite(id) { return getStore().favorites.includes(id); }

export function pushRecent(id) {
  const s = getStore();
  s.recent = [id, ...(s.recent || []).filter(x => x !== id)].slice(0, 12);
  saveStore();
}

export function addPlayTime(ms) {
  const s = getStore();
  s.totalPlayMs = (s.totalPlayMs || 0) + ms;
  saveStore();
}

// 跨标签同步
addEventListener('storage', (e) => {
  if (e.key === NS) { cache = null; }
});

export const SCHEMA = SCHEMA_VERSION;
