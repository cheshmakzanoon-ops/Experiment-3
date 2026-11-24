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
    this.entriesChecksum = null;
    // The profile file certifies the ghost state that belongs to its complete
    // revision. null means an old envelope; false explicitly marks unbatched
    // writes. Extra fields retain the version-1 file/codec format.
    this.completion = null;
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
    if (data.completion != null) {
      const c = data.completion;
      if (
        (c !== false &&
          (c.revision !== data.revision ||
            !Number.isSafeInteger(c.ghostRevision) ||
            c.ghostRevision < 0 ||
            typeof c.ghostChecksum !== 'string' ||
            !/^[0-9a-f]{64}$/.test(c.ghostChecksum))) ||
        data.completionChecksum !== digest([data.revision, data.checksum, c])
      )
        throw new Error('bad completion certificate');
    }
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
        this.entriesChecksum = data.checksum;
        this.completion = data.completion ?? null;
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

  checksum() {
    return (this.entriesChecksum ??= digest(this.entries));
  }

  /** Encode every value before publishing any of a transaction's state. */
  prepare(entries) {
    return Object.fromEntries(
      entries.map(([key, value]) => {
        if (typeof key !== 'string' || key.length === 0 || key.length > 512)
          throw new TypeError('key must be a non-empty string');
        return [key, encode(value)];
      }),
    );
  }

  install(entries, revision, completion = false) {
    this.entries = entries;
    this.entriesChecksum = null;
    this.completion = completion;
    if (Number.isSafeInteger(revision)) this.revision = Math.max(this.revision, revision);
    this.schedule();
  }

  /** Record one write. `revision` is the renderer's monotonic counter. */
  put(key, value, revision) {
    this.install({ ...this.entries, ...this.prepare([[key, value]]) }, revision);
  }

  /** Replace everything (the renderer's IndexedDB was newer than this file). */
  replaceAll(entries, revision) {
    this.install(this.prepare(Object.entries(entries)), revision);
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
      const checksum = this.checksum();
      const payload = JSON.stringify({
        format: FORMAT,
        version: VERSION,
        revision: this.revision,
        savedAt: this.savedAt,
        checksum,
        entries: this.entries,
        ...(this.completion !== null
          ? {
              completion: this.completion,
              completionChecksum: digest([this.revision, checksum, this.completion]),
            }
          : {}),
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

/**
 * The save IPC service is pure Node so split-file crash recovery is testable.
 * A predecessor check prevents a missing batch being hidden by a later one.
 * The small profile file names the exact ghost state it commits; ghost files
 * need writing only when ghost data changes. Either disk-write order is safe:
 * after an interrupted pair, the certificate fails and IndexedDB re-seeds it.
 */
function saveMirrorService(mirrors, path) {
  const { main, ghosts } = mirrors;
  const state = () => {
    const revision = Math.max(main.revision, ghosts.revision);
    const c = main.completion;
    const empty = revision === 0 && main.keys().length === 0 && ghosts.keys().length === 0;
    const complete = empty
      ? true
      : c === null && ghosts.completion === null
        ? undefined
        : Boolean(
            c &&
              c.revision === main.revision &&
              c.ghostRevision === ghosts.revision &&
              c.ghostChecksum === ghosts.checksum(),
          );
    return { revision, complete };
  };
  const validateRevision = (revision) => {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('bad revision');
  };
  const split = (entries) => {
    const groups = { main: [], ghosts: [] };
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string')
        throw new TypeError('bad save entry');
      (entry[0].startsWith('ghost:') ? groups.ghosts : groups.main).push(entry);
    }
    // Both encodings must succeed before either live mirror is touched.
    return { main: main.prepare(groups.main), ghosts: ghosts.prepare(groups.ghosts) };
  };
  const install = (next, revision, writeGhosts) => {
    if (writeGhosts) ghosts.install(next.ghosts, revision);
    main.install(next.main, revision, {
      revision,
      ghostRevision: ghosts.revision,
      ghostChecksum: ghosts.checksum(),
    });
  };
  return {
    info: () => ({
      ...state(),
      savedAt: Math.max(main.savedAt, ghosts.savedAt),
      source: main.source,
      keys: [...main.keys(), ...ghosts.keys()],
      path,
    }),
    load: () => ({
      ...state(),
      entries: { ...main.snapshot().entries, ...ghosts.snapshot().entries },
    }),
    // Retained for older renderers. Unbatched writes invalidate the certificate.
    put: (key, value, revision) => {
      if (typeof key !== 'string') throw new TypeError('key');
      (key.startsWith('ghost:') ? ghosts : main).put(key, value, revision);
      return Math.max(main.revision, ghosts.revision);
    },
    commit: (entries, revision, previousRevision) => {
      validateRevision(revision);
      validateRevision(previousRevision);
      const current = state();
      if (
        !current.complete ||
        current.revision !== previousRevision ||
        revision <= previousRevision
      )
        throw new Error('save mirror requires a complete predecessor; re-seed from IndexedDB');
      if (!Array.isArray(entries) || entries.length === 0 || entries.length > 256)
        throw new TypeError('bad save batch');
      const updates = split(entries);
      install(
        {
          main: { ...main.entries, ...updates.main },
          ghosts: { ...ghosts.entries, ...updates.ghosts },
        },
        revision,
        Object.keys(updates.ghosts).length > 0,
      );
      return revision;
    },
    seed: (entries, revision) => {
      validateRevision(revision);
      if (!entries || typeof entries !== 'object' || Array.isArray(entries))
        throw new TypeError('entries');
      if (revision < state().revision) throw new Error('stale save snapshot');
      install(split(Object.entries(entries)), revision, true);
      return true;
    },
    flush: () => {
      main.flush();
      ghosts.flush();
      return !main.dirty && !ghosts.dirty;
    },
  };
}

module.exports = { SaveMirror, saveMirrorService, FORMAT, VERSION };
