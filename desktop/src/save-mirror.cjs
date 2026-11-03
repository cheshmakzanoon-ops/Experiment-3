'use strict';
/**
 * Crash-safe JSON mirror of the game's persisted key/value store.
 *
 * The game keeps profiles in IndexedDB (src/storage/data.ts). IndexedDB is
 * reliable but opaque to Steam Cloud and to a player who reinstalls, so the
 * desktop shell mirrors every write into plain files under userData:
 *
 *   <name>.json        current state (checksummed)
 *   <name>.json.bak    the previous good state
 *   <name>.json.tmp    transient: the next state, fsynced before the swap
 *
 * Writes are atomic: tmp is written and fsynced, the current file is copied to
 * .bak, then tmp is renamed over the current file. A crash at any step leaves a
 * readable file; load() falls back primary -> .bak -> .tmp and quarantines a
 * corrupt primary instead of deleting it. Pure Node (injectable fs) so the
 * behaviour is unit-tested from the root vitest suite.
 */
const nodeFs = require('node:fs');
const nodePath = require('node:path');
const { createHash } = require('node:crypto');
const { encode, decode } = require('./codec.cjs');

const FORMAT = 'motobound-saves';
const VERSION = 1;
const MAX_QUARANTINE = 3;

const digest = (entries) => createHash('sha256').update(JSON.stringify(entries)).digest('hex');

class SaveMirror {
  /**
   * @param {{dir: string, name?: string, debounceMs?: number, fs?: typeof nodeFs,
   *   now?: () => number, log?: (message: string) => void}} options
   */
  constructor(options) {
    this.dir = options.dir;
    this.name = options.name ?? 'saves';
    this.debounceMs = options.debounceMs ?? 400;
    this.fs = options.fs ?? nodeFs;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
    this.primary = nodePath.join(this.dir, `${this.name}.json`);
    this.backup = `${this.primary}.bak`;
    this.temp = `${this.primary}.tmp`;
    /** @type {Record<string, unknown>} encoded entries */
    this.entries = {};
    this.revision = 0;
    this.savedAt = 0;
    this.dirty = false;
    this.timer = null;
    this.writes = 0;
    this.lastError = null;
    this.recovered = null;
    this.source = 'empty';
    /** True once the primary on disk is known to be a verified, complete state. */
    this.primaryOk = false;
  }

  parse(path) {
    const raw = this.fs.readFileSync(path, 'utf8');
    const data = JSON.parse(raw);
    if (data?.format !== FORMAT || data.version !== VERSION)
      throw new Error('not a MOTOBOUND save mirror');
    if (!data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries))
      throw new Error('entries missing');
    if (data.checksum !== digest(data.entries)) throw new Error('checksum mismatch');
    if (!Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error('bad revision');
    return data;
  }

  quarantine(path, reason) {
    try {
      if (!this.fs.existsSync(path)) return;
      const dest = nodePath.join(this.dir, `${this.name}.corrupt-${this.now()}.json`);
      this.fs.renameSync(path, dest);
      this.log(`quarantined ${nodePath.basename(path)} (${reason}) -> ${nodePath.basename(dest)}`);
      const old = this.fs
        .readdirSync(this.dir)
        .filter((f) => f.startsWith(`${this.name}.corrupt-`))
        .sort();
      for (const stale of old.slice(0, Math.max(0, old.length - MAX_QUARANTINE)))
        this.fs.rmSync(nodePath.join(this.dir, stale), { force: true });
    } catch (error) {
      this.log(`quarantine failed: ${String(error)}`);
    }
  }

  /** Read the best available state. Never throws. */
  load() {
    this.fs.mkdirSync(this.dir, { recursive: true });
    let source = 'empty';
    for (const [label, path] of [
      ['primary', this.primary],
      ['backup', this.backup],
      ['temp', this.temp],
    ]) {
      if (!this.fs.existsSync(path)) continue;
      try {
        const data = this.parse(path);
        this.entries = data.entries;
        this.revision = data.revision;
        this.savedAt = data.savedAt ?? 0;
        source = label;
        this.primaryOk = label === 'primary';
        break;
      } catch (error) {
        this.log(`${label} unreadable: ${String(error)}`);
        if (label === 'primary') this.quarantine(path, String(error));
      }
    }
    this.source = source;
    this.recovered = source === 'primary' || source === 'empty' ? null : source;
    if (this.recovered) {
      // Heal: promote the recovered state so the next start reads the primary.
      this.dirty = true;
      this.flush();
    }
    return this.snapshot(source);
  }

  snapshot(source = this.source) {
    const entries = {};
    for (const key of Object.keys(this.entries)) entries[key] = decode(this.entries[key]);
    return { revision: this.revision, savedAt: this.savedAt, source, entries };
  }

  keys() {
    return Object.keys(this.entries);
  }

  /** Record one write. `revision` is the renderer's monotonic counter. */
  put(key, value, revision) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 512)
      throw new TypeError('key must be a non-empty string');
    this.entries[key] = encode(value);
    if (Number.isSafeInteger(revision) && revision > this.revision) this.revision = revision;
    this.schedule();
  }

  /** Replace everything (the renderer's IndexedDB was newer than this file). */
  replaceAll(entries, revision) {
    const next = {};
    for (const key of Object.keys(entries)) next[key] = encode(entries[key]);
    this.entries = next;
    if (Number.isSafeInteger(revision)) this.revision = Math.max(this.revision, revision);
    this.schedule();
  }

  schedule() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  /** Synchronous, atomic write. Safe to call from `before-quit`. */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return false;
    try {
      this.fs.mkdirSync(this.dir, { recursive: true });
      this.savedAt = this.now();
      const payload = JSON.stringify({
        format: FORMAT,
        version: VERSION,
        revision: this.revision,
        savedAt: this.savedAt,
        checksum: digest(this.entries),
        entries: this.entries,
      });
      const fd = this.fs.openSync(this.temp, 'w');
      try {
        this.fs.writeSync(fd, payload);
        this.fs.fsyncSync(fd);
      } finally {
        this.fs.closeSync(fd);
      }
      if (this.fs.existsSync(this.primary)) {
        try {
          if (!this.primaryOk) this.parse(this.primary); // only a verified file becomes the backup
          this.fs.copyFileSync(this.primary, this.backup);
        } catch {
          /* a corrupt primary must not overwrite the backup */
        }
      }
      this.fs.renameSync(this.temp, this.primary);
      this.primaryOk = true;
      this.dirty = false;
      this.writes++;
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = String(error);
      this.log(`save mirror write failed: ${this.lastError}`);
      return false;
    }
  }
}

module.exports = { SaveMirror, FORMAT, VERSION };
