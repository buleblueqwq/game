// 触觉反馈：Navigator.vibrate + 失败静默降级 + 节流（防抖防烫）

import { caps } from './errors.js';
import { getSettings } from './storage.js';

let lastAt = 0;
let enabled = true;
const budget = { tokens: 12, last: 0 }; // 每秒预算，防止高频震动

function refill(now) {
  const dt = now - budget.last;
  if (dt > 1000) { budget.tokens = Math.min(12, budget.tokens + Math.floor(dt / 1000) * 12); budget.last = now; }
}

/** 预设震动模式（ms 数组 / 单个数字） */
export const PATTERNS = {
  tap: 8,
  select: 12,
  hit: [0, 18],
  shoot: 6,
  jump: 10,
  land: 22,
  damage: [0, 30, 20, 45],
  explode: [0, 40, 30, 70],
  combo: [0, 12, 10, 12, 10, 16],
  win: [0, 20, 40, 20, 40, 60],
  lose: [0, 80, 60, 120],
  error: [0, 25, 40, 25],
  step: 4,
  ui: 10
};

export function canVibrate() { return caps.vibration && enabled && getSettings().haptics !== false; }

/**
 * @param {number|number[]} pattern
 * @param {number} throttleMs 同类节流窗口
 */
export function vibrate(pattern = PATTERNS.tap, throttleMs = 40) {
  if (!canVibrate()) return false;
  const now = performance.now();
  refill(now);
  if (budget.tokens <= 0) return false;
  if (now - lastAt < throttleMs) return false;
  lastAt = now;
  budget.tokens--;
  try { navigator.vibrate(pattern); return true; } catch { return false; }
}

export function setHaptics(v) { enabled = !!v; }
export function cancel() { try { navigator.vibrate(0); } catch { /* ignore */ } }

/** 按强度映射：0~1 -> 时长 */
export function buzz(intensity = 0.5) {
  return vibrate(Math.round(6 + intensity * 60));
}
