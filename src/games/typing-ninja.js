// 打字忍者 —— 60 秒计时赛：字母/拼音词条下落、前缀匹配、斩击特效、连击倍率与准确率统计
import { clamp, TAU, ease } from '../core/math.js';
import { PALETTE, roundRect, text as drawText, bar, grid as drawGrid, vignette } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'typing-ninja', title: '打字忍者', category: 'action', difficulty: 3,
  music: 'chase',
  howto: ['直接敲击键盘输入词条字母即可锁定目标', '打完一个词触发斩击，连击提升倍率与下落速度', 'Backspace 退格修正；词条落地扣血并清空连击'],
  particles: 1200
};
export const musicTrack = 'chase';

const TIME_LIMIT = 60;
const MAX_WORDS = 18;
const MAX_SLASH = 10;

// ---------------------------------------------------------------- 词库（英文为主 + 少量拼音）
const WORDS = [
  'ace', 'bit', 'cog', 'dot', 'fox', 'gem', 'hex', 'ion', 'jet', 'key', 'log', 'map', 'net', 'owl', 'pen',
  'ray', 'sky', 'tag', 'vex', 'war', 'zap', 'arc', 'bug', 'dim', 'elm', 'fog', 'ice', 'lab', 'mix', 'orb',
  'rune', 'sun', 'web', 'zen', 'atom', 'blip', 'chip', 'dash', 'echo', 'flux', 'glow', 'hack', 'iris',
  'jolt', 'kite', 'loop', 'mesh', 'nova', 'onyx', 'quad', 'risk', 'scan', 'task', 'unit', 'void', 'wave',
  'xeno', 'yard', 'zero', 'blade', 'code', 'core', 'dusk', 'edge', 'frost', 'grid', 'halo', 'iron', 'jump',
  'knot', 'lens', 'moon', 'node', 'peak', 'quiz', 'ring', 'star', 'tide', 'vibe', 'wolf', 'yarn', 'zone',
  'alpha', 'blitz', 'cipher', 'delta', 'ember', 'forge', 'ghost', 'hover', 'infer', 'karma', 'laser',
  'mirage', 'nexus', 'orbit', 'pixel', 'quartz', 'rogue', 'swift', 'tempo', 'ultra', 'vapor', 'xenon',
  'zephyr', 'azure', 'bloom', 'crisp', 'drift', 'flare', 'glint', 'knock', 'lunar', 'nerve', 'oasis',
  'plume', 'quake', 'ripple', 'shard', 'titan', 'umbra', 'witty', 'saber', 'tempo', 'tulip', 'vivid',
  'arcade', 'binary', 'cobalt', 'dynamo', 'engine', 'fusion', 'galaxy', 'hazard', 'impact', 'jigsaw',
  'kernel', 'lumens', 'matrix', 'neuron', 'oxygen', 'plasma', 'quiver', 'rocket', 'silver', 'tundra',
  'vector', 'window', 'zenith', 'anchor', 'breach', 'canyon', 'dragon', 'falcon', 'goblin', 'hunter',
  'island', 'jungle', 'knight', 'legend', 'marble', 'nectar', 'photon', 'quasar', 'shadow', 'throne',
  'unlock', 'vision', 'yellow', 'zenith', 'blazon', 'chrome', 'docker', 'escape', 'filter', 'guitar',
  'absolute', 'blizzard', 'circuits', 'dominion', 'elephant', 'fragment', 'gradient', 'horizon',
  'infinite', 'jamboree', 'kilobyte', 'lightning', 'monolith', 'nautical', 'overdrive', 'paradigm',
  'quantum', 'rainbow', 'sunflower', 'turbulence', 'undertow', 'velocity', 'xylophone', 'yesterday',
  'zeppelin', 'adventure', 'butterfly', 'chocolate', 'discovery', 'framework', 'generation', 'happiness',
  'jellyfish', 'knowledge', 'landscape', 'mountain', 'obsidian', 'prototype', 'reflector', 'satellite'
];
const PINYIN = [
  'nihao', 'xiexie', 'pinyin', 'shuru', 'zhanji', 'gongfu', 'shufa', 'qigong', 'longmao', 'nihaoma',
  'taiji', 'feiji', 'huoche', 'diannao', 'youxi', 'jishu', 'shenqi', 'kuaile', 'jiayou', 'kaishi',
  'jieshu', 'yanjing', 'heixia', 'zhongguo', 'jinjie', 'chaoji', 'shuoming', 'xiaohao', 'dianao', 'renwu'
];

export function create(ctx) {
  const { input, audio, particles, shake, flash, rng } = ctx;
  let W = ctx.W, H = ctx.H;
  let fontBase = 22;
  const floorY = { y: 0 };

  const S = {
    t: 0, left: TIME_LIMIT, score: 0, combo: 0, maxCombo: 0, lives: 3, tier: 1,
    typed: 0, errors: 0, good: 0, kills: 0, state: 'play', // play | over
    spawnTimer: 1.0, shakeOff: { x: 0, y: 0 }, best: ctx.save.get('best', 0), finished: false, endTimer: 0,
    hintTier: 1, errorFlash: 0
  };

  // 词条实体池
  const words = [];
  for (let i = 0; i < MAX_WORDS; i++) {
    words.push({ active: false, word: '', len: 0, typed: 0, x: 0, y: 0, vy: 0, wob: 0, alpha: 0, dead: false });
  }
  // 斩击特效池
  const slashes = [];
  for (let i = 0; i < MAX_SLASH; i++) slashes.push({ life: 0, max: 1, x: 0, y: 0, a: 0, w: 0 });

  ctx.hud('score', '分数', 0);
  ctx.hud('combo', '连击', 0, { color: PALETTE.lime });
  ctx.hud('lives', '生命', 3, { color: PALETTE.red });
  ctx.hud('time', '剩余', TIME_LIMIT + 's', { color: PALETTE.cyan });

  // ---------------------------------------------------------------- 布局
  function layout(w, h) {
    W = w; H = h;
    fontBase = clamp(Math.min(w / 34, h / 22), 15, 30);
    floorY.y = H - Math.max(52, H * .1);
    for (const o of words) if (o.active) o.x = clamp(o.x, 60, W - 60);
  }
  layout(W, H);

  // ---------------------------------------------------------------- 词条生成
  const LEN_RANGE = [[3, 5], [4, 7], [5, 9], [6, 99]];

  function pickWord() {
    const [lo, hi] = LEN_RANGE[Math.min(S.tier, 4) - 1];
    let w = 'ace', usedPinyin = false;
    if (S.tier >= 2 && rng.chance(.2)) {
      for (let i = 0; i < 10; i++) {
        const c = rng.pick(PINYIN);
        if (c.length >= lo && c.length <= hi) { w = c; usedPinyin = true; break; }
      }
    }
    if (!usedPinyin) {
      for (let i = 0; i < 14; i++) {
        const c = rng.pick(WORDS);
        if (c.length >= lo && c.length <= hi) { w = c; break; }
      }
    }
    // 避免与现存词条首字母完全重复，降低歧义
    let same = 0;
    for (const o of words) if (o.active && o.word[0] === w[0]) same++;
    if (same >= 2) {
      for (let i = 0; i < 10; i++) {
        const c = rng.pick(WORDS);
        if (c.length >= lo && c.length <= hi && c[0] !== w[0]) { w = c; break; }
      }
    }
    return w;
  }

  function spawnWord() {
    let slot = null;
    for (const o of words) if (!o.active) { slot = o; break; }
    if (!slot) return;
    const w = pickWord();
    slot.active = true; slot.dead = false;
    slot.word = w; slot.len = w.length; slot.typed = 0;
    // 下落速度：难度档 + 连击加成
    slot.vy = H * (.10 + S.tier * .035) * (1 + Math.min(.45, S.combo * .012)) * rng.range(.9, 1.15);
    slot.x = rng.range(70, Math.max(80, W - 70));
    slot.y = -fontBase;
    slot.wob = rng() * TAU;
    slot.alpha = 0;
  }

  function activeCount() {
    let n = 0;
    for (const o of words) if (o.active) n++;
    return n;
  }

  // ---------------------------------------------------------------- 输入
  function findStart(ch) {
    // 选择最靠近底部的候选，保证玩家优先处理最紧急的词
    let best = null;
    for (const o of words) {
      if (!o.active) continue;
      if (o.word[0] !== ch) continue;
      if (!best || o.y > best.y) best = o;
    }
    return best;
  }

  function handleChar(ch) {
    if (S.state !== 'play') return;
    // 优先推进当前目标
    let target = null;
    for (const o of words) if (o.active && o.typed > 0) { target = o; break; }
    if (target) {
      if (target.word[target.typed] === ch) { advance(target); return; }
      // 输入错误：抖动 + 错误音（允许改换目标）
      const alt = findStart(ch);
      if (alt && alt !== target) { target.typed = 0; alt.typed = 1; onCorrect(alt); return; }
      onMiss();
      return;
    }
    const alt = findStart(ch);
    if (alt) { alt.typed = 1; onCorrect(alt); return; }
    onMiss();
  }

  function onCorrect(o) {
    S.good++;
    audio.sfx('tick', { gain: .5 });
    ctx.vibrate(PATTERNS.step);
    if (o.typed >= o.len) finishWord(o);
  }

  function backspace() {
    for (const o of words) {
      if (o.active && o.typed > 0) {
        o.typed = Math.max(0, o.typed - 1);
        audio.sfx('hover', { gain: .4 });
        return;
      }
    }
  }

  function advance(o) {
    o.typed++;
    onCorrect(o);
  }

  function finishWord(o) {
    o.active = false; o.typed = 0;
    S.kills++;
    S.combo++;
    if (S.combo > S.maxCombo) S.maxCombo = S.combo;
    const mult = Math.min(5, 1 + Math.floor(S.combo / 5) * .5);
    const gain = Math.round((o.len * 12 + 10) * mult);
    S.score += gain;
    S.typed += o.len;
    ctx.hud('score', '分数', S.score);
    ctx.hud('combo', '连击', S.combo + ' ×' + mult.toFixed(1), { color: S.combo >= 10 ? PALETTE.amber : PALETTE.lime });
    if (S.combo > 0 && S.combo % 10 === 0) audio.sfx('combo', { combo: S.combo, gain: .8 });
    // 斩击
    slash(o.x, o.y, o.len);
    audio.sfx('reflect', { gain: .7 });
    audio.sfx('shoot', { gain: .35 });
    ctx.vibrate(PATTERNS.combo);
    shake.add(.16);
    particles.burst(o.x, o.y, 20, { color: PALETTE.lime, speed: 300, life: .5, size: 3, kind: 1, drag: 2.2 });
    particles.burst(o.x, o.y, 10, { color: PALETTE.cyan, speed: 180, life: .6, size: 3.4, kind: 5, grav: 300 });
    particles.text(o.x, o.y - 18, '+' + gain, S.combo >= 10 ? '#ffb020' : '#8dff4d');
  }

  function onMiss() {
    S.errors++;
    S.errorFlash = 1;
    audio.sfx('error', { gain: .7 });
    ctx.vibrate(PATTERNS.error);
    shake.add(.06);
  }

  function slash(x, y, len) {
    for (const s of slashes) {
      if (s.life > 0) continue;
      s.life = s.max = .34;
      s.x = x; s.y = y;
      s.a = rng.range(-.5, -.9);
      s.w = len * fontBase * .55 + 22;
      return;
    }
  }

  // 键盘
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (mobileInput && document.activeElement === mobileInput) return;  // 移动端输入框自行处理
    const k = e.key;
    if (k === 'Backspace') { e.preventDefault(); backspace(); return; }
    if (k === ' ' || k === 'Tab') e.preventDefault();
    if (k.length === 1) {
      const ch = k.toLowerCase();
      if (ch >= 'a' && ch <= 'z') { e.preventDefault(); handleChar(ch); }
    }
  };
  ctx.listen(window, 'keydown', onKey);

  // 移动端输入（隐藏/半可见输入框唤起软键盘）
  let mobileInput = null, lastVal = '';
  if (ctx.caps.mobile) {
    mobileInput = document.createElement('input');
    mobileInput.type = 'text';
    mobileInput.setAttribute('autocomplete', 'off');
    mobileInput.setAttribute('autocapitalize', 'off');
    mobileInput.setAttribute('autocorrect', 'off');
    mobileInput.setAttribute('spellcheck', 'false');
    mobileInput.placeholder = '在此输入…';
    mobileInput.style.cssText = 'flex:1 1 60%;pointer-events:auto;background:rgba(8,12,24,.9);border:1px solid #243357;border-radius:10px;color:#eaf2ff;padding:12px;font-size:15px;outline:none';
    ctx.listen(mobileInput, 'input', () => {
      const v = mobileInput.value;
      if (v.length < lastVal.length) { backspace(); }
      else if (v.length > 0) {
        const ch = v[v.length - 1].toLowerCase();
        if (ch >= 'a' && ch <= 'z') handleChar(ch);
      }
      lastVal = v;
      mobileInput.value = '';
      lastVal = '';
    });
    ctx.overlay(mobileInput, 'overlay-bottom');
    ctx.listen(ctx.canvas, 'pointerdown', () => { try { mobileInput.focus(); } catch { /* ignore */ } });
  }

  // ---------------------------------------------------------------- 更新
  function update(dt) {
    S.t += dt;
    if (S.errorFlash > 0) S.errorFlash = Math.max(0, S.errorFlash - dt * 3);
    for (const s of slashes) if (s.life > 0) s.life -= dt;

    if (S.state === 'over') {
      S.endTimer += dt;
      stepWords(dt);
      if (S.endTimer > .9 && !S.finished) {
        S.finished = true;
        const mins = Math.max(TIME_LIMIT - S.left, 1) / 60;
        const wpm = Math.round((S.typed / 5) / mins);
        const total = S.good + S.errors;
        const acc = total ? Math.round(S.good / total * 100) : 100;
        if (S.score > S.best) { S.best = S.score; ctx.save.set('best', S.score); }
        ctx.finish(S.score, {
          win: false,
          stats: [['WPM', wpm], ['准确率', acc + '%'], ['最大连击', S.maxCombo], ['斩杀词条', S.kills]]
        });
      }
      return;
    }

    // 计时
    S.left = Math.max(0, S.left - dt);
    ctx.hud('time', '剩余', Math.ceil(S.left) + 's', { color: S.left <= 10 ? PALETTE.red : PALETTE.cyan });

    // 难度档（每 15s 提升一档，词更长 / 更快 / 更密）
    const tier = clamp(1 + Math.floor((TIME_LIMIT - S.left) / 15), 1, 4);
    if (tier !== S.tier) {
      S.tier = tier;
      audio.sfx('powerup', { gain: .7 });
      flash.add(.18, PALETTE.violet);
      ctx.hint('难度 ' + tier + '：词条更长，下落更快');
    }

    // 生成
    S.spawnTimer -= dt;
    const maxAlive = 3 + S.tier * 1.4;
    if (S.spawnTimer <= 0 && activeCount() < maxAlive) {
      S.spawnTimer = Math.max(.45, 1.5 - S.tier * .22) * rng.range(.85, 1.2);
      spawnWord();
    }
    stepWords(dt);

    if (S.left <= 0) {
      S.state = 'over'; S.endTimer = 0;
      audio.sfx('win'); audio.duck(.4, 1500);
      flash.add(.4, PALETTE.lime);
      for (const o of words) o.active = false;
      const mins = TIME_LIMIT / 60;
      const wpm = Math.round((S.typed / 5) / mins);
      const total = S.good + S.errors;
      const acc = total ? Math.round(S.good / total * 100) : 100;
      S.finished = true;
      if (S.score > S.best) { S.best = S.score; ctx.save.set('best', S.score); }
      ctx.finish(S.score, {
        win: S.lives > 0,
        stats: [['WPM', wpm], ['准确率', acc + '%'], ['最大连击', S.maxCombo], ['斩杀词条', S.kills]]
      });
    }
  }

  function stepWords(dt) {
    for (const o of words) {
      if (!o.active) continue;
      o.y += o.vy * dt;
      o.wob += dt * 2.4;
      if (o.alpha < 1) o.alpha = Math.min(1, o.alpha + dt * 4);
      if (o.y >= floorY.y) { missWord(o); }
    }
  }

  function missWord(o) {
    o.active = false;
    if (S.state !== 'play') return;
    S.combo = 0;
    S.lives--;
    ctx.hud('combo', '连击', 0);
    ctx.hud('lives', '生命', Math.max(0, S.lives), { color: PALETTE.red });
    audio.sfx('hurt'); audio.duck(.4, 700);
    ctx.vibrate(PATTERNS.damage);
    shake.add(.45); flash.add(.3, PALETTE.red);
    particles.explosion(o.x, floorY.y, .8, PALETTE.red);
    if (S.lives <= 0) {
      S.state = 'over'; S.endTimer = 0;
      audio.sfx('die');
      for (const w2 of words) w2.active = false;
    }
  }

  // ---------------------------------------------------------------- 渲染
  function render(alpha, rdt) {
    const c = ctx.ctx;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a1226'); g.addColorStop(.6, '#060a16'); g.addColorStop(1, '#04070e');
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    c.save();
    shake.apply(c);
    drawBg(c);
    drawWords(c);
    drawSlashes(c);
    particles.renderTexts(c, rdt);
    c.restore();

    drawFrame(c);
    vignette(c, W, H, .42);

    if (S.state === 'over' && S.lives <= 0) {
      drawText(c, '力尽于此', W / 2, H * .45, { size: Math.min(40, W * .09), color: PALETTE.red, weight: 900, glow: 20 });
    }
  }

  function drawBg(c) {
    // 远山 + 月
    const my = H * .22, mx = W * .82;
    const mg = c.createRadialGradient(mx, my, 4, mx, my, Math.max(60, W * .1));
    mg.addColorStop(0, 'rgba(255,46,136,.35)'); mg.addColorStop(1, 'rgba(255,46,136,0)');
    c.fillStyle = mg; c.beginPath(); c.arc(mx, my, Math.max(60, W * .1), 0, TAU); c.fill();
    c.strokeStyle = 'rgba(34,224,255,.14)'; c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i <= W; i += 8) {
      const y = H * .78 + Math.sin(i * .012 + S.t * .3) * 16 + Math.sin(i * .031) * 10;
      i ? c.lineTo(i, y) : c.moveTo(i, y);
    }
    c.stroke();
    drawGrid(c, W, H, 72, 'rgba(60,90,150,.05)', 1, 0, (S.t * 18) % 72);

    // 危险线
    c.save();
    c.globalAlpha = .35 + Math.sin(S.t * 4) * .12;
    const dg = c.createLinearGradient(0, floorY.y - 30, 0, floorY.y + 6);
    dg.addColorStop(0, 'rgba(255,77,94,0)'); dg.addColorStop(1, 'rgba(255,77,94,.35)');
    c.fillStyle = dg; c.fillRect(0, floorY.y - 30, W, 36);
    c.strokeStyle = PALETTE.red; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, floorY.y + 4); c.lineTo(W, floorY.y + 4); c.stroke();
    c.restore();
  }

  function drawWords(c) {
    for (const o of words) {
      if (!o.active) continue;
      const size = fontBase * (o.len > 7 ? .86 : 1);
      const wobX = Math.sin(o.wob) * 3 * (S.errorFlash > 0 && o.typed > 0 ? 4 : 1);
      const x = o.x + wobX, y = o.y;
      // 判定框
      const half = o.len * size * .30 + 12;
      const dangerK = clamp((o.y - floorY.y * .55) / (floorY.y * .45), 0, 1);
      c.save();
      c.globalAlpha = o.alpha * (.35 + dangerK * .5);
      c.fillStyle = o.typed > 0 ? 'rgba(141,255,77,.10)' : 'rgba(34,224,255,.07)';
      roundRect(c, x - half, y - size * .78, half * 2, size * 1.56, 6); c.fill();
      c.strokeStyle = o.typed > 0 ? PALETTE.lime : (dangerK > .6 ? PALETTE.red : PALETTE.cyan);
      c.lineWidth = 1.4; c.stroke();
      c.restore();

      // 已输入前缀（高亮）/ 剩余部分
      const totalW = o.len * size * .60;
      let cx = x - totalW / 2;
      c.save();
      c.globalAlpha = o.alpha;
      c.textAlign = 'left'; c.textBaseline = 'middle';
      c.font = `700 ${size}px ui-monospace, "SFMono-Regular", Consolas, monospace`;
      for (let i = 0; i < o.len; i++) {
        const ch = o.word[i];
        const chW = size * .60;
        if (i < o.typed) {
          c.fillStyle = PALETTE.lime;
          c.shadowColor = PALETTE.lime; c.shadowBlur = 10;
        } else if (i === o.typed && o.typed > 0) {
          c.fillStyle = PALETTE.white;
          c.shadowColor = PALETTE.white; c.shadowBlur = 12;
        } else {
          c.fillStyle = dangerK > .6 ? PALETTE.red : PALETTE.dim;
          c.shadowBlur = 0;
        }
        c.fillText(ch, cx, y + Math.sin(o.wob + i * .5) * 1.2);
        cx += chW;
      }
      c.shadowBlur = 0;
      // 已输入部分的下划线进度
      if (o.typed > 0) {
        c.strokeStyle = PALETTE.lime; c.lineWidth = 2;
        c.beginPath();
        c.moveTo(x - totalW / 2, y + size * .7);
        c.lineTo(x - totalW / 2 + o.typed * size * .6, y + size * .7);
        c.stroke();
      }
      c.restore();
    }
  }

  function drawSlashes(c) {
    for (const s of slashes) {
      if (s.life <= 0) continue;
      const k = s.life / s.max;
      const grow = 1 - k;
      c.save();
      c.translate(s.x, s.y);
      c.rotate(s.a);
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = k;
      const len = s.w * (.5 + ease.outExpo(grow));
      c.strokeStyle = PALETTE.lime; c.lineWidth = 6 * k + 1;
      c.shadowColor = PALETTE.lime; c.shadowBlur = 18;
      c.beginPath(); c.moveTo(-len, 0); c.lineTo(len, 0); c.stroke();
      c.strokeStyle = '#ffffff'; c.lineWidth = 2 * k + .5;
      c.beginPath(); c.moveTo(-len * .8, 0); c.lineTo(len * .8, 0); c.stroke();
      c.restore();
    }
  }

  function drawFrame(c) {
    // 顶部计时条 + 生命
    const bw = Math.min(W - 40, 480), bx = (W - bw) / 2, by = 12;
    bar(c, bx, by, bw, 7, S.left / TIME_LIMIT, {
      bg: 'rgba(255,255,255,.08)',
      fill: S.left <= 10 ? PALETTE.red : PALETTE.cyan, r: 3,
      glowColor: S.left <= 10 ? PALETTE.red : PALETTE.cyan
    });
    drawText(c, Math.ceil(S.left) + 's', W / 2, by + 20, { size: 12, color: S.left <= 10 ? PALETTE.red : PALETTE.dim, baseline: 'top' });

    // 生命（红点）
    for (let i = 0; i < 3; i++) {
      const x = bx - 16 - i * 18, y = by + 4;
      c.fillStyle = i < S.lives ? PALETTE.red : 'rgba(125,141,179,.25)';
      c.beginPath(); c.arc(x, y, 5, 0, TAU); c.fill();
    }
    // 难度
    drawText(c, 'LV ' + S.tier, bx + bw + 16, by + 4, { size: 12, color: PALETTE.violet, align: 'left' });

    // 连击
    if (S.combo > 1) {
      const s = 1 + Math.min(.5, S.combo * .012);
      drawText(c, S.combo + ' COMBO', W / 2, floorY.y + 22, {
        size: Math.min(22, W * .05) * s, color: S.combo >= 10 ? PALETTE.amber : PALETTE.lime, weight: 900, glow: 14
      });
    }
    if (S.state === 'play' && activeCount() === 0 && S.t < 3) {
      drawText(c, '准备…', W / 2, H * .4, { size: 20, color: PALETTE.dim });
    }
  }

  return {
    update, render,
    resize(w, h) { layout(w, h); },
    pause() { audio.duck(.5, 3000); },
    resume() { }
  };
}
