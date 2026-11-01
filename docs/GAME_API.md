# 游戏模块开发契约（Game Module Contract）

每个游戏是 `src/games/<id>.js` 一个 ES 模块，零构建、纯静态。运行时由 `src/shell/player.js` 加载。

## 最小骨架

```js
import { clamp, lerp, TAU, makeRng } from '../core/math.js';
import { PALETTE, glowCircle, roundRect, text, bar, grid } from '../core/gfx.js';
import { PATTERNS } from '../core/haptics.js';

export const meta = {
  id: 'my-game',            // 必须与文件名一致
  title: '我的游戏',
  category: 'action',       // action|strategy|puzzle|physics|ai|sim|rhythm|3d|classic|io
  difficulty: 3,            // 1~5
  music: 'arcade',          // menu|arcade|battle|puzzle|chase|space|victory|tense
  howto: ['操作说明一行', '第二行'],
  particles: 1200           // 可选，粒子容量
};
export const musicTrack = 'arcade';   // 可选，覆盖 meta.music

export function create(ctx) {
  // 初始化…
  return {
    update(dt) {},                 // 固定时间步调用，dt 恒为 1/60（除非 ctx.timeScale）
    render(alpha, rdt) {},         // alpha ∈ [0,1) 插值系数；rdt 为逻辑步长
    resize(w, h) {},               // 可选
    onInput(e) {},                 // 可选，原始输入事件
    pause() {}, resume() {},       // 可选
    destroy() {}                   // 可选，释放资源
  };
}
```

## ctx 字段一览

| 字段 | 类型 | 说明 |
|---|---|---|
| `ctx.canvas` | HTMLCanvasElement | 主画布（已按 DPR 设置尺寸） |
| `ctx.ctx` | CanvasRenderingContext2D | 2D 上下文（alpha:false，已 setTransform(dpr)） |
| `ctx.W` / `ctx.H` | number (getter) | **CSS 像素**逻辑宽高，布局请用这两个 |
| `ctx.dpr` | number | 设备像素比（已上限 2） |
| `ctx.input` | Input | 输入管理器，见下 |
| `ctx.audio` | AudioEngine | 音频，`ctx.audio.sfx('hit')` |
| `ctx.particles` | Particles | 粒子系统 |
| `ctx.shake` | ScreenShake | `shake.add(0.5)` 触发震屏 |
| `ctx.flash` | Flash | `flash.add(0.4, '#fff')` 全屏闪白 |
| `ctx.camera` | Camera | 2D 相机（follow / clampTo / apply / toWorld） |
| `ctx.rng` | function | 确定性随机：`rng()`, `rng.int(a,b)`, `rng.range(a,b)`, `rng.pick(arr)`, `rng.chance(p)`, `rng.shuffle(arr)`, `rng.gauss()` |
| `ctx.noise` | function | 值噪声 `noise(x,y)`，`.fbm(x,y,oct)` |
| `ctx.palette` | object | 统一配色 PALETTE |
| `ctx.caps` | object | `webgl / audio / vibration / mobile / dpr / cores` |
| `ctx.settings` | object | 只读快照 |
| `ctx.save` | object | 本游戏私有存档 `.get(k,def) .set(k,v) .del(k) .all() .clear()` |
| `ctx.hud(key,label,value,opts)` | fn | 左上角 HUD，opts: `{color, icon}` |
| `ctx.hudRemove(key)` | fn | |
| `ctx.hint(msg, ms)` | fn | 底部提示条 |
| `ctx.listen(el,type,fn,opt)` | fn | 注册事件，**销毁时自动解绑** |
| `ctx.onDestroy(fn)` | fn | 注册清理回调 |
| `ctx.overlay(el, cls)` | fn | 挂载 DOM 层（`'overlay-bottom'` / `'overlay-top'`） |
| `ctx.vibrate(pattern)` | fn | 震动，`PATTERNS.hit` 等 |
| `ctx.finish(value, {win,higherBetter,stats})` | fn | 结束并弹结算 |
| `ctx.submit(value)` | fn | 中途提交分数（不结束） |
| `ctx.restart()` / `ctx.exit()` / `ctx.pause()` | fn | |
| `ctx.pool(factory, reset, n, max)` | fn | 对象池（自动清理） |
| `ctx.lib('three' \| 'matter')` | fn→Promise | 按需加载本地 vendor 库 |
| `ctx.worker(src)` | fn | Worker 池（传入 worker 脚本 URL） |
| `ctx.timeScale` | number | 可写，慢动作/加速 |
| `ctx.perf` | PerfMonitor | 运行时注入（可能为 null） |

## 输入（ctx.input）

```js
input.isDown('left')          // 持续按住
input.justPressed('jump')     // 本步刚按下
input.consume('jump', 130)    // 带缓冲消费（推荐：宽容输入）
input.axis()                  // {x,y} 归一化方向（键盘+手柄）
input.pointer                 // {x,y,down,justDown,justUp} 画布坐标（CSS px）
input.pointers                // Map 多指
input.wheel                   // -1/0/1 每步滚轮方向
input.rawDown('KeyQ')         // 原始键码
input.on(fn)                  // 监听原始事件 {type,action,code,x,y,...}
```

动作名：`up down left right jump primary secondary dash confirm pause back restart interact skill1 skill2 map mute`

**重要**：逻辑步结束时 `pressed/justDown/wheel` 会被清空，只在 `update()` 里读取才有效。

## 音频（ctx.audio）

```js
audio.sfx('shoot');                     // 预设音效
audio.sfx('combo', {combo: 12, gain: .8});
audio.tone({freq:440, to:220, type:'square', dur:.2, gain:.3, filter:1800});
audio.noise({dur:.3, gain:.2, freq:1200, to:200, filter:'bandpass'});
audio.fm({carrier:220, ratio:3, index:400, dur:.4});
audio.playMusic('battle'); audio.stopMusic(); audio.setMusicIntensity(0.9);
audio.duck(0.5, 600);                   // 闪避（重要事件时压低 BGM）
```

预设音效名：`click hover select back error confirm shoot laser hit explode jump land dash coin powerup heal hurt die win lose combo place portal reflect charge alarm tick swap build lock whoosh`

曲目：`menu arcade battle puzzle chase space victory tense`

## 粒子（ctx.particles）

```js
particles.burst(x, y, 16, {color:'#22e0ff', speed:200, life:.6, size:3, kind:1, grav:0, drag:1.6, angle, spread});
particles.explosion(x, y, scale, color);
particles.ring(x, y, color, r);
particles.trail(x, y, color, size);
particles.sparkle(x, y, color);
particles.text(x, y, '+100', '#8dff4d');   // 需自行调用 particles.renderTexts(c, dt)
particles.emit({x,y,vx,vy,life,size,color,kind,grav,drag,rot,vr});
```
kind：`0` 圆点 · `1` 火花线 · `2` 烟雾 · `3` 扩散环 · `4` 方块 · `5` 三角碎片

## 绘制辅助（src/core/gfx.js）

`fitCanvas roundRect fillRound strokeRound neon glowDot glowLine glowCircle glowRect vgrad radial grid horizonGrid makeStarfield scanlines vignette text wrapText bar poly hexPath star panel wave Camera ScreenShake Flash Trail Counter PALETTE`

```js
import { neon, glowCircle, text, bar, PALETTE, hexPath } from '../core/gfx.js';
neon(ctx, c => { c.moveTo(x1,y1); c.lineTo(x2,y2); }, '#22e0ff', {glow:14, width:2});
glowCircle(ctx, x, y, r, '#ff2e88', {fill:'rgba(255,46,136,.2)'});
text(ctx, 'SCORE', x, y, {size:18, color:'#fff', align:'center', weight:800, glow:12, stroke:'#000'});
```

## 数学（src/core/math.js）

`clamp clamp01 lerp invLerp remap damp dist dist2 angleTo lerpAngle smoothstep ease.* makeRng makeNoise pointInPoly segIntersect circleSeg reflect aabb circleHit hexToRgb rgba mixHex fmtTime fmtNum TAU`

## 硬性质量要求（会被自动化检查）

1. **禁止**在 `update/render` 中 `new` 对象；用 `ctx.pool()` 或预分配数组。
2. **禁止**使用 `setInterval`；动画一律基于 `update(dt)`。
3. **禁止** `document.querySelector` 搜索外部节点；只用 `ctx.listen` / `ctx.overlay`。
4. 必须实现 `resize(w,h)` 并重算布局；不得依赖初始尺寸。
5. 随机一律用 `ctx.rng`（保证可复现），不要用 `Math.random`（除非纯装饰）。
6. 所有资源在 `destroy()` 中释放；`ctx.listen` / `ctx.pool` 会自动清理。
7. 单帧渲染不得创建大量临时数组；粒子上限受 `ctx.settings.reducedFx` 影响时可降载。
8. 移动端友好：提供触摸操作（`ctx.input.pointer` 或 `ctx.overlay` 虚拟按钮），关键反馈调用 `ctx.vibrate`。
9. 游戏结束必须调用 `ctx.finish(...)`，不要自己写结算 DOM。
10. 首帧前完成布局，`render` 里不要做耗时预计算（可缓存到离屏 canvas）。

## 样式

游戏内如需额外 DOM，用 `ctx.overlay(el)`；可直接内联 style 或复用 `.btn` `.hud-field` 等类。
主题色用 CSS 变量 `--c`（卡片已注入），游戏内请用 `PALETTE`。
