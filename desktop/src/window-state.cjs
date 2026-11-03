'use strict';
/**
 * Window placement and display-mode persistence. Pure helpers plus a tiny
 * atomic JSON store; Electron's `screen` is injected by the caller.
 */
const nodeFs = require('node:fs');
const nodePath = require('node:path');

const MODES = Object.freeze(['fullscreen', 'borderless', 'windowed']);
const MIN_WIDTH = 960;
const MIN_HEIGHT = 540;
const DEFAULT_SIZE = Object.freeze({ width: 1600, height: 900 });

const isNumber = (n) => typeof n === 'number' && Number.isFinite(n);

/** Share of `bounds` that lies on `area` (0..1). */
function overlap(bounds, area) {
  const w = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const h = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return w > 0 && h > 0 ? (w * h) / (bounds.width * bounds.height) : 0;
}

/**
 * Turn whatever was on disk into a state that is safe to apply: a monitor that
 * was unplugged, a corrupt file or an absurd size must never produce an
 * off-screen or unusably small window.
 * @param {unknown} raw
 * @param {{workArea: {x:number,y:number,width:number,height:number}}[]} displays
 */
function sanitizeState(raw, displays) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const mode = MODES.includes(data.mode) ? data.mode : 'fullscreen';
  const primary = displays[0]?.workArea ?? { x: 0, y: 0, ...DEFAULT_SIZE };
  const width = isNumber(data.width)
    ? Math.min(Math.max(Math.round(data.width), MIN_WIDTH), 16384)
    : Math.min(DEFAULT_SIZE.width, primary.width);
  const height = isNumber(data.height)
    ? Math.min(Math.max(Math.round(data.height), MIN_HEIGHT), 16384)
    : Math.min(DEFAULT_SIZE.height, primary.height);
  const bounds = { x: Math.round(data.x), y: Math.round(data.y), width, height };
  const placed =
    isNumber(data.x) &&
    isNumber(data.y) &&
    displays.some((d) => overlap(bounds, d.workArea) >= 0.5);
  return {
    mode,
    width,
    height,
    ...(placed ? { x: bounds.x, y: bounds.y } : {}),
    maximized: data.maximized === true,
  };
}

class WindowStateStore {
  constructor({ dir, fs = nodeFs, name = 'window-state.json', log = () => {} }) {
    this.fs = fs;
    this.file = nodePath.join(dir, name);
    this.log = log;
    this.timer = null;
    this.pending = null;
  }

  read() {
    try {
      return JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }

  save(state) {
    this.pending = state;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
    this.timer.unref?.();
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending) return;
    const state = this.pending;
    this.pending = null;
    try {
      this.fs.mkdirSync(nodePath.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      this.fs.writeFileSync(tmp, JSON.stringify(state));
      this.fs.renameSync(tmp, this.file);
    } catch (error) {
      this.log(`window state not saved: ${String(error)}`);
    }
  }
}

module.exports = { MODES, MIN_WIDTH, MIN_HEIGHT, sanitizeState, overlap, WindowStateStore };
