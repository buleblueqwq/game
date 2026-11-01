// 通用对象池：子弹 / 粒子 / 敌人 / 网格单元 —— 杜绝每帧 new 造成的 GC 抖动

export class Pool {
  /**
   * @param {()=>object} factory 创建对象
   * @param {(obj)=>void} reset 取出时的重置
   * @param {number} initial 预分配数量
   * @param {number} max 上限，超过后不再回收（防止无限增长）
   */
  constructor(factory, reset = () => {}, initial = 64, max = 4096) {
    this.factory = factory;
    this.reset = reset;
    this.max = max;
    this.free = [];
    this.active = [];
    this.created = 0;
    for (let i = 0; i < initial; i++) { const o = factory(); o.__pooled = true; this.free.push(o); this.created++; }
  }
  spawn() {
    let o = this.free.pop();
    if (!o) {
      if (this.created >= this.max) { // 达到上限：复用最老的活跃对象
        o = this.active.shift() || this.factory();
      } else { o = this.factory(); this.created++; }
      o.__pooled = true;
    }
    this.reset(o);
    o.dead = false;
    this.active.push(o);
    return o;
  }
  /** 压缩活跃数组，回收 dead 对象。每帧调用一次 */
  sweep(onRelease = null) {
    const a = this.active;
    let w = 0;
    for (let i = 0; i < a.length; i++) {
      const o = a[i];
      if (o.dead) { if (onRelease) onRelease(o); if (this.free.length < this.max) this.free.push(o); }
      else a[w++] = o;
    }
    a.length = w;
  }
  /** 就地遍历（避免中间数组） */
  each(fn) { const a = this.active; for (let i = 0; i < a.length; i++) fn(a[i], i); }
  clear() { for (const o of this.active) { o.dead = true; if (this.free.length < this.max) this.free.push(o); } this.active.length = 0; }
  get count() { return this.active.length; }
}

/** 定长环形缓冲：轨迹 / 拖尾 / 输入历史 */
export class RingBuffer {
  constructor(n, factory) {
    this.n = n; this.buf = Array.from({ length: n }, factory);
    this.head = 0; this.size = 0;
  }
  push(v) { const slot = this.buf[this.head]; this.head = (this.head + 1) % this.n; if (this.size < this.n) this.size++; return slot; }
  at(i) { return this.buf[(this.head - 1 - i + this.n * 2) % this.n]; }
  forEach(fn) { for (let i = 0; i < this.size; i++) fn(this.at(i), i); }
  clear() { this.size = 0; this.head = 0; }
}

/** 结构化数组式粒子存储：一次性分配，零 GC（用于上万级粒子） */
export class SoA {
  constructor(capacity, fields) {
    this.cap = capacity;
    this.count = 0;
    this.f = {};
    for (const k of Object.keys(fields)) this.f[k] = new Float32Array(capacity);
  }
  alloc() { return this.count < this.cap ? this.count++ : -1; }
  /** 原地压缩：把 alive=false 的元素移到末尾 */
  compact(isAlive) {
    let w = 0;
    for (let i = 0; i < this.count; i++) {
      if (isAlive(i)) {
        if (w !== i) for (const k in this.f) this.f[k][w] = this.f[k][i];
        w++;
      }
    }
    this.count = w;
  }
  clear() { this.count = 0; }
}
