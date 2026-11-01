# NEON ARCADE · 霓虹游戏厅

> 38 款硬核 HTML5 小游戏合集 —— 零构建静态站点，可一键部署到 GitHub Pages，全离线可玩。

一个用原生 ES Modules + Canvas2D / WebGL(Three.js) / WebAudio 打造的游戏大厅。
所有美术（封面、霓虹辉光）与音乐均为**程序化生成**，不依赖任何图片 / 音频素材文件；
所有第三方库（Three.js、Matter.js）本地打包，无需 CDN。

## 特性

- **38 款游戏**，覆盖 11 个分类：动作、策略、解谜、物理、AI、模拟、节奏、3D、经典、IO、Roguelike。
- **统一游戏引擎内核**（`src/core/`）：
  - 固定时间步长（fixed timestep）+ 插值渲染 + 后台暂停 + 死亡螺旋保护
  - 对象池 / SoA 结构化数组，避免逐帧 GC
  - 确定性种子随机与值噪声（可复现的程序化内容）
  - 全程序化 WebAudio 合成器：8 轨 BGM 序列器 + 音效预设，节点自动断流防泄漏
  - 统一输入抽象：动作映射、输入缓冲、coyote time、多指触摸、手柄
  - 触觉反馈（`navigator.vibrate`，预算节流）
  - 性能监控（1% 低帧追踪）+ 自适应画质分级
  - 版本化存档（localStorage，含迁移、跨标签页同步、收藏、最近游玩）
- **3D 游戏**（3D 迷宫、跑酷）按需加载本地 Three.js，自建 WebGL 画布。
- **PWA 离线**：Service Worker 预缓存外壳 + stale-while-revalidate。
- **错误边界**：游戏崩溃被捕获并弹出可重试界面，不会拖垮整个大厅。
- **响应式 + 移动端安全**：自适应布局、触控控件、指针锁定视角。

## 硬质量门槛（不达标不算高质量）

| 维度 | 目标 |
| --- | --- |
| 帧率 | 桌面 60fps / 移动 45–60fps，固定 16.67ms 逻辑步 |
| 输入延迟 | < 50ms，含输入缓冲与 coyote time |
| 首玩时间 | < 3s 可玩（首屏骨架 + 懒加载） |
| 稳定性 | 30 分钟长时间运行无泄漏、无崩溃 |
| 工程 | 对象池、Web Worker 重计算、WebGL 失败降级、错误边界、存档版本化、自适应画质 |

## 本地运行

任意静态服务器即可（ES Modules 需要 http 协议，不能用 `file://`）：

```bash
cd game
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

## 部署到 GitHub Pages

1. 推送本仓库到 `main` 分支。
2. 仓库 **Settings → Pages → Source** 选择 `Deploy from a branch` → `main` → `/ (root)`。
3. 访问 `https://<user>.github.io/game/`。

> Service Worker 仅在 `https:` 下注册（含 GitHub Pages），因此离线缓存与 PWA 特性需在 Pages 域名下生效。

## 目录结构

```
game/
├── index.html            # 启动骨架
├── sw.js                 # Service Worker（离线缓存）
├── assets/               # 图标 / OG 图 / manifest（均为 SVG，程序化）
├── styles/app.css        # 霓虹 UI 系统
├── src/
│   ├── core/             # 引擎内核（math/pool/engine/input/audio/gfx/particles/ui/storage/haptics/perf/errors）
│   ├── shell/            # 外壳（catalog 注册表 / player 运行时 / main 路由）
│   └── games/            # 38 个游戏模块（每个一个 <id>.js）
├── vendor/               # 本地 Three.js / Matter.js
└── docs/GAME_API.md      # 游戏模块契约
```

## 写一个新游戏

参照 `docs/GAME_API.md`：导出 `meta` 与 `create(ctx)`，`ctx` 提供 canvas、输入、音频、粒子、
绘制、存档、触觉等能力。新增后到 `src/shell/catalog.js` 注册即可出现在大厅。
