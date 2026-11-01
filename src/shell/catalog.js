// 游戏目录 —— 单一数据源。新增游戏只需在此登记一行 + src/games/<id>.js
// category: action | strategy | puzzle | physics | ai | sim | rhythm | 3d | classic | io

export const CATEGORIES = [
  { id: 'all', name: '全部', icon: '✦', color: '#22e0ff' },
  { id: 'action', name: '动作射击', icon: '⚡', color: '#ff2e88' },
  { id: 'strategy', name: '策略战棋', icon: '♟', color: '#ffb020' },
  { id: 'puzzle', name: '解谜逻辑', icon: '◈', color: '#a855f7' },
  { id: 'physics', name: '物理沙盒', icon: '◍', color: '#28e0a0' },
  { id: 'ai', name: 'AI 算法', icon: '⌘', color: '#22e0ff' },
  { id: 'sim', name: '模拟经营', icon: '◉', color: '#8dff4d' },
  { id: 'rhythm', name: '音乐节奏', icon: '♪', color: '#ff2e88' },
  { id: '3d', name: '3D 立体', icon: '◮', color: '#3b82f6' },
  { id: 'classic', name: '经典重制', icon: '◆', color: '#ffb020' },
  { id: 'io', name: '联机对战', icon: '⇄', color: '#28e0a0' }
];

export const GAMES = [
  // ---- 动作射击 ----
  { id: 'bullet-hell', title: '弹幕 Boss 战', category: 'action', tags: ['弹幕', '擦弹', 'Boss'], desc: '三种弹幕模式、擦弹判定、三阶段变招的硬核 Boss 战。', color: '#ff2e88', music: 'battle', difficulty: 4 },
  { id: 'platformer', title: '惯性平台跳跃', category: 'action', tags: ['平台', '二段跳', '冲刺'], desc: '带惯性、二段跳、冲刺、机关与可破坏地形的手感向平台跳跃。', color: '#22e0ff', music: 'arcade', difficulty: 4 },
  { id: 'breakout-neon', title: '霓虹弹球', category: 'action', tags: ['弹球', '连击', '道具'], desc: '物理反射弹球，多球、穿透弹、Boss 砖块与连击倍率。', color: '#a855f7', music: 'arcade', difficulty: 2 },
  { id: 'neon-snake', title: '霓虹贪吃蛇', category: 'action', tags: ['贪吃蛇', '加速', '障碍'], desc: '高速贪吃蛇，冲刺加速、动态障碍、分数倍率与幽灵回放。', color: '#8dff4d', music: 'arcade', difficulty: 2 },
  { id: 'typing-ninja', title: '打字忍者', category: 'action', tags: ['打字', '连击', '反应'], desc: '从天而降的假名/单词，正确输入即斩击，连击与准确率评分。', color: '#28e0a0', music: 'chase', difficulty: 3 },

  // ---- 策略战棋 ----
  { id: 'tower-defense', title: '塔防·路径寻路', category: 'strategy', tags: ['塔防', '寻路', 'Boss'], desc: '敌人沿 A* 路径进攻，四种塔、升级、减速与溅射，20 波 + Boss。', color: '#ffb020', music: 'tense', difficulty: 3 },
  { id: 'tower-roguelike', title: '塔防·词条构筑', category: 'strategy', tags: ['Roguelike', '词条', '随机'], desc: '每波随机三选一词条强化塔或敌人，局内构筑流派。', color: '#ff2e88', music: 'tense', difficulty: 4 },
  { id: 'hex-tactics', title: '六边形战棋', category: 'strategy', tags: ['战棋', '六边形', '地形'], desc: '回合制六边形战棋：移动范围、攻击范围、地形加成与技能冷却。', color: '#3b82f6', music: 'tense', difficulty: 4 },
  { id: 'deckbuilder', title: '卡牌构筑', category: 'strategy', tags: ['Roguelike', '卡牌', '遗物'], desc: '抽牌、能量、遗物与敌人意图，组卡闯关的爬塔构筑。', color: '#a855f7', music: 'menu', difficulty: 4 },
  { id: 'autochess', title: '自走棋', category: 'strategy', tags: ['自走棋', '羁绊', '升星'], desc: '购买单位、三合一升星、羁绊加成与自动战斗。', color: '#22e0ff', music: 'arcade', difficulty: 3 },
  { id: 'mini-rts', title: '迷你 RTS', category: 'strategy', tags: ['RTS', '框选', '采集'], desc: '框选单位、采集资源、造兵、编队进攻的轻量即时战略。', color: '#ffb020', music: 'tense', difficulty: 4 },
  { id: 'roguelike-dungeon', title: 'Roguelike 地牢', category: 'strategy', tags: ['地牢', '回合', '构筑'], desc: '随机房间、回合制战斗、随机道具与词条构筑，死亡重开。', color: '#ff4d5e', music: 'space', difficulty: 4 },

  // ---- 解谜逻辑 ----
  { id: 'portal', title: '传送门解谜', category: 'puzzle', tags: ['传送门', '物理', '机关'], desc: '放置双传送门改变运动路径，配合开关、激光与箱子。', color: '#28e0a0', music: 'puzzle', difficulty: 4 },
  { id: 'gravity-maze', title: '重力迷宫', category: 'puzzle', tags: ['重力', '旋转', '迷宫'], desc: '旋转整个场景改变重力方向，让角色滚到终点。', color: '#a855f7', music: 'puzzle', difficulty: 3 },
  { id: 'laser-refraction', title: '激光折射', category: 'puzzle', tags: ['光学', '镜子', '棱镜'], desc: '摆放镜子、棱镜、分光器，把激光引导到目标。', color: '#22e0ff', music: 'puzzle', difficulty: 4 },
  { id: 'logic-circuit', title: '逻辑电路', category: 'puzzle', tags: ['电路', '与或非', '时序'], desc: '连接与门、或门、非门、延时器，让信号点亮目标灯。', color: '#8dff4d', music: 'puzzle', difficulty: 5 },
  { id: 'robot-programming', title: '编程机器人', category: 'puzzle', tags: ['编程', '指令', '迷宫'], desc: '编写指令序列控制机器人走迷宫、搬箱子、避陷阱。', color: '#ffb020', music: 'puzzle', difficulty: 4 },
  { id: 'graph-puzzle', title: '图论连线', category: 'puzzle', tags: ['图论', '度数', '约束'], desc: '在节点间连线，满足度数、颜色与不交叉约束。', color: '#a855f7', music: 'puzzle', difficulty: 4 },
  { id: 'sokoban', title: '推箱子·重制', category: 'puzzle', tags: ['推箱子', '最优解', '撤销'], desc: '经典推箱子，含撤销、步数最优评级与关卡编辑器。', color: '#28e0a0', music: 'puzzle', difficulty: 3 },
  { id: 'hex-minesweeper', title: '六边形扫雷', category: 'puzzle', tags: ['扫雷', '六边形', '推理'], desc: '六边形网格扫雷，数字推理与首次点击必安全。', color: '#3b82f6', music: 'puzzle', difficulty: 3 },
  { id: 'memory-grid', title: '记忆矩阵', category: 'puzzle', tags: ['记忆', '闪电', '序列'], desc: '闪现序列记忆挑战，逐级加速并混入干扰。', color: '#ff2e88', music: 'arcade', difficulty: 2 },

  // ---- 物理沙盒 ----
  { id: 'physics-sandbox', title: '物理沙盒建造', category: 'physics', tags: ['刚体', '绳索', '弹簧'], desc: '刚体、绳索、弹簧、重力，搭建连锁机关或暴力破坏场景。', color: '#28e0a0', music: 'puzzle', difficulty: 3 },
  { id: 'fluid-sph', title: '粒子流体', category: 'physics', tags: ['SPH', '流体', '交互'], desc: '简化 SPH 流体模拟，鼠标扰动，支持容器与障碍物。', color: '#22e0ff', music: 'space', difficulty: 3 },
  { id: 'soft-body', title: '软体物理', category: 'physics', tags: ['软体', '布娃娃', '弹簧'], desc: '控制软体生物/绳索越过障碍，质点弹簧系统驱动。', color: '#a855f7', music: 'arcade', difficulty: 4 },
  { id: 'cellular-automata', title: '细胞自动机', category: 'physics', tags: ['元胞', '生命游戏', '沙水火'], desc: '绘制规则，观察生命游戏、沙、水、火、酸的演化。', color: '#ffb020', music: 'space', difficulty: 2 },
  { id: 'gravity-galaxy', title: '引力星系', category: 'physics', tags: ['引力', 'N体', '合并'], desc: '粒子星系、引力交互、轨道预测与碰撞合并。', color: '#3b82f6', music: 'space', difficulty: 2 },

  // ---- AI 算法 ----
  { id: 'pathfinding-viz', title: '寻路算法竞技场', category: 'ai', tags: ['A*', 'Dijkstra', 'BFS'], desc: '布置障碍，同屏对比 A*、Dijkstra、BFS、贪心的搜索过程。', color: '#22e0ff', music: 'puzzle', difficulty: 3 },
  { id: 'ai-board', title: 'AI 棋类对战', category: 'ai', tags: ['Minimax', '剪枝', '五子棋'], desc: '黑白棋与五子棋，Minimax + Alpha-Beta 剪枝，可调深度观战。', color: '#ffb020', music: 'menu', difficulty: 4 },
  { id: 'ga-racing', title: '遗传算法赛车', category: 'ai', tags: ['遗传算法', '神经网络', '进化'], desc: '车辆自动跑赛道，选择、交叉、变异逐代进化出最优车手。', color: '#8dff4d', music: 'chase', difficulty: 3 },
  { id: 'evolution-sim', title: '进化模拟器', category: 'ai', tags: ['演化', '基因', '生态'], desc: '生物觅食避敌，基因影响速度、视野、体型，观察种群演化。', color: '#28e0a0', music: 'space', difficulty: 2 },
  { id: 'supply-chain', title: '供应链经营', category: 'sim', tags: ['经营', '物流', '价格'], desc: '生产建筑、运输路线、库存与价格波动，完成订单交付。', color: '#ffb020', music: 'menu', difficulty: 4 },

  // ---- 音乐节奏 ----
  { id: 'rhythm', title: '多轨节奏音游', category: 'rhythm', tags: ['音游', '判定', '连击'], desc: '四轨下落音符，Tap/Hold/Slide，判定线与连击准确率。', color: '#ff2e88', music: 'arcade', difficulty: 4 },
  { id: 'synth-rhythm', title: '合成器音游', category: 'rhythm', tags: ['WebAudio', '合成', '谱面'], desc: '实时合成鼓点旋律，按节拍自动生成谱面并演奏。', color: '#a855f7', music: 'arcade', difficulty: 3 },

  // ---- 3D ----
  { id: 'fps-maze', title: '3D 迷宫·第一人称', category: '3d', tags: ['Three.js', 'FPS', '迷宫'], desc: 'Three.js 第一人称迷宫：WASD + 鼠标视角，找钥匙开门逃脱。', color: '#3b82f6', music: 'space', difficulty: 3 },
  { id: 'parkour3d', title: '3D 程序生成跑酷', category: '3d', tags: ['Three.js', '跑酷', '程序生成'], desc: '随机生成的 3D 赛道、障碍与加速带，限时跑分。', color: '#22e0ff', music: 'chase', difficulty: 3 },

  // ---- 联机 ----
  { id: 'io-battle', title: 'IO 多人竞技', category: 'io', tags: ['多人', '实时', '吞噬'], desc: '贪吃蛇 IO：吞噬成长、撞击淘汰，支持多标签页同机对战与 AI 陪练。', color: '#28e0a0', music: 'chase', difficulty: 3 },

  // ---- 经典重制 ----
  { id: 'tetris-battle', title: '俄罗斯方块·对战', category: 'classic', tags: ['方块', '消行', '垃圾行'], desc: '7-bag 随机、锁定延迟、T-Spin 与 AI 对手垃圾行对战。', color: '#ff2e88', music: 'arcade', difficulty: 3 },
  { id: 'merge-grid', title: '合成 2048', category: 'classic', tags: ['2048', '合成', '策略'], desc: '霓虹风格 2048，含动画合成、撤销与连击奖励。', color: '#ffb020', music: 'menu', difficulty: 2 }
];

export const GAME_MAP = new Map(GAMES.map(g => [g.id, g]));
export const CATEGORY_MAP = new Map(CATEGORIES.map(c => [c.id, c]));

/** 稳定的伪随机封面种子 */
export function coverSeed(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
