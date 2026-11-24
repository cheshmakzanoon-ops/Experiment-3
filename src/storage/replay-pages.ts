import {
  CAR_STRIDE,
  HEADER,
  F,
  H,
  carBase,
  PROTOCOL_VERSION,
  snapshotIncompatibility,
} from '../simulation/protocol.ts';
import { allFinite, clamp } from '../core/math.ts';

/** Words per road cell in a recorded surface keyframe: water (mm x 1000),
 * rubber, marbles and snow / ice cover (frozen / FROZEN_FULL_SCALE_MM), all
 * 16-bit. Cover is zero in every warm preset. */
export const SURFACE_WORDS = 4;
/** Cover (mm water equivalent) that maps to the 16-bit full scale. */
export const FROZEN_FULL_SCALE_MM = 8;
export interface SurfaceRecord {
  time: number;
  data: Uint16Array;
}
export interface ReplayPage {
  version: number;
  id: number;
  count: number;
  stride: number;
  frames: Float32Array;
  surfaces: SurfaceRecord[];
}
export interface ReplayPageStore {
  put(page: ReplayPage): Promise<void>;
  get(id: number): Promise<ReplayPage>;
  dispose(): Promise<void>;
}

/** Private session cache, separate from saved preferences. Writes resolve only
 * on transaction completion. Closing a session removes only that session's keys. */
export class IndexedReplayStore implements ReplayPageStore {
  private db: Promise<IDBDatabase>;
  private session = globalThis.crypto.randomUUID();
  private connection: IDBDatabase | null = null;
  private closed = false;
  private disposal: Promise<void> | null = null;
  constructor() {
    this.db = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('IndexedDB replay cache unavailable'));
        return;
      }
      const request = indexedDB.open('apex-replay-cache', 1);
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      request.onupgradeneeded = () => request.result.createObjectStore('pages');
      request.onerror = () => fail(request.error ?? new Error('Replay cache open failed'));
      request.onblocked = () => fail(new Error('Another tab blocked the replay cache'));
      request.onsuccess = () => {
        const db = request.result;
        // An open request cannot be cancelled after a blocked event. It can
        // still succeed after rejection or while disposal is awaiting it.
        if (settled || this.closed) {
          db.close();
          if (!settled) {
            settled = true;
            resolve(db);
          }
          return;
        }
        settled = true;
        this.connection = db;
        db.onversionchange = () => {
          this.closed = true;
          this.closeConnection(db);
        };
        db.onclose = () => {
          this.closed = true;
          this.connection = null;
          db.onversionchange = db.onclose = null;
        };
        resolve(db);
      };
    });
    // Consumers observe the original rejection when writing/reading. Avoid an
    // unhandled rejection while a newly-created session has not filled a page.
    void this.db.catch(() => undefined);
  }
  private assertOpen() {
    if (this.closed) throw new Error('Replay cache is closed');
  }
  private closeConnection(db: IDBDatabase) {
    if (this.connection !== db) return;
    this.connection = null;
    db.onversionchange = db.onclose = null;
    db.close();
  }
  private transaction<T>(
    db: IDBDatabase,
    mode: IDBTransactionMode,
    failure: string,
    enqueue: (store: IDBObjectStore) => IDBRequest<T>,
  ) {
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('pages', mode);
      let request: IDBRequest<T>;
      const clear = () => {
        tx.oncomplete = tx.onabort = tx.onerror = null;
      };
      tx.oncomplete = () => {
        clear();
        resolve(request.result);
      };
      tx.onabort = tx.onerror = () => {
        clear();
        reject(tx.error ?? new Error(failure));
      };
      try {
        request = enqueue(tx.objectStore('pages'));
      } catch (error) {
        clear();
        // A synchronous request failure does not automatically abort the
        // transaction. Release it, retaining the original enqueue failure.
        try {
          tx.abort();
        } catch {
          // The transaction may already have become inactive.
        }
        reject(error);
      }
    });
  }
  async put(page: ReplayPage) {
    this.assertOpen();
    const db = await this.db;
    this.assertOpen();
    await this.transaction(db, 'readwrite', 'Replay page write failed', (store) =>
      store.put(page, [this.session, page.id]),
    );
  }
  async get(id: number) {
    this.assertOpen();
    const db = await this.db;
    this.assertOpen();
    const page = await this.transaction<ReplayPage | undefined>(
      db,
      'readonly',
      'Replay page read failed',
      (store) => store.get([this.session, id]),
    );
    if (!page) throw new Error(`Replay page ${id} is missing`);
    return page;
  }
  dispose() {
    if (this.disposal) return this.disposal;
    // Stop new operations synchronously, including those awaiting open().
    this.closed = true;
    this.disposal = this.disposeConnection();
    return this.disposal;
  }
  private async disposeConnection() {
    const db = await this.db;
    // A late open or version change may already have closed this connection.
    if (this.connection !== db) return;
    try {
      // IndexedDB queues this exclusive transaction after earlier page work.
      await this.transaction(db, 'readwrite', 'Replay cache cleanup failed', (store) =>
        store.delete(
          IDBKeyRange.bound([this.session, 0], [this.session, Number.MAX_SAFE_INTEGER]),
        ),
      );
    } finally {
      this.closeConnection(db);
    }
  }
}

/** Private-session accidental-corruption witness, not authentication of an
 * imported replay. Integer-word hashing is spread across capture, so sealing a
 * multi-megabyte page does not monopolize the input/render thread. */
const HASH_SEED = 0x811c9dc5;
function hashWords(
  words: Uint32Array | Uint16Array,
  hash = HASH_SEED,
  start = 0,
  end = words.length,
) {
  // Same FNV-1a words: XOR reads its operands as int32, so the running value
  // can stay int32 (unboxed) and become unsigned once at the end.
  let h = hash | 0;
  for (let i = start; i < end; i++) h = Math.imul(h ^ words[i], 0x01000193);
  return h >>> 0;
}
interface PageMeta {
  start: number;
  end: number;
  count: number;
  frameHash: number;
  surfaces: { time: number; length: number; hash: number }[];
}
/** Full-session pose history with bounded resident pages. No scene geometry,
 * textures or game objects are retained. Random seeks never let an old async
 * read overwrite the currently requested position. Storage failure stops the
 * archive with an explicit error instead of silently discarding old laps. */
export class SessionReplay {
  readonly stride: number;
  private current: ReplayPage;
  private metadata: PageMeta[] = [];
  private frameHash = HASH_SEED;
  private surfaceHashes = new WeakMap<SurfaceRecord, number>();
  private cache = new Map<number, ReplayPage>();
  private pendingReads = new Map<number, Promise<void>>();
  private preparedSeekTime: number | null = null;
  private failedReads = new Set<number>();
  // A flashback can queue a replacement while the old page with the same id
  // is still writing. Count and protect each page object independently.
  private writing = new Set<ReplayPage>();
  private writes: Promise<void> = Promise.resolve();
  private lastTime = -Infinity;
  private surface: SurfaceRecord | null = null;
  private closed = false;
  private failure: string | null = null;
  private totalCount = 0;
  private decodedWater = new Float32Array(0);
  private decodedRubber = new Float32Array(0);
  private decodedMarbles = new Float32Array(0);
  private decodedFrozen = new Float32Array(0);
  private decodedSurface: SurfaceRecord | null = null;
  constructor(
    readonly cars: number,
    private store: ReplayPageStore = new IndexedReplayStore(),
    private notify: (message: string) => void = () => undefined,
    readonly pageFrames = 300,
  ) {
    if (
      !Number.isInteger(cars) ||
      cars < 1 ||
      cars > 12 ||
      !Number.isInteger(pageFrames) ||
      pageFrames < 2 ||
      pageFrames > 900
    )
      throw new Error('Invalid replay configuration');
    this.stride = HEADER + CAR_STRIDE * cars;
    this.current = this.page(0);
  }
  private page(id: number): ReplayPage {
    return {
      version: PROTOCOL_VERSION,
      id,
      count: 0,
      stride: this.stride,
      frames: new Float32Array(this.stride * this.pageFrames),
      surfaces: this.surface ? [this.surface] : [],
    };
  }
  append(frame: Float32Array) {
    if (this.closed || this.failure) return;
    if (
      !(frame instanceof Float32Array) ||
      frame.length !== this.stride ||
      !allFinite(frame) ||
      snapshotIncompatibility(frame) !== null ||
      frame[H.CARS] !== this.cars ||
      frame[H.TIME] < 0 ||
      frame[H.TIME] < this.lastTime
    ) {
      this.fail('Invalid replay snapshot');
      return;
    }
    for (let id = 0; id < this.cars; id++) {
      const q = carBase(id) + F.QX;
      const norm = frame[q] ** 2 + frame[q + 1] ** 2 + frame[q + 2] ** 2 + frame[q + 3] ** 2;
      if (Math.abs(norm - 1) > 0.001) {
        this.fail('Invalid replay snapshot: non-unit car orientation');
        return;
      }
    }
    const time = frame[H.TIME];
    if (time - this.lastTime < 1 / 15 - 0.001) return;
    if (this.current.count === this.pageFrames) this.seal();
    if (this.failure) return;
    this.lastTime = time;
    this.current.frames.set(frame, this.current.count * this.stride);
    this.frameHash = hashWords(
      new Uint32Array(frame.buffer, frame.byteOffset, frame.length),
      this.frameHash,
    );
    this.current.count++;
    this.totalCount++;
  }
  recordSurface(
    water: Float32Array,
    rubber: Float32Array,
    time: number,
    marbles?: Float32Array,
    frozen?: Float32Array,
  ) {
    if (this.closed || this.failure) return;
    if (
      !(water instanceof Float32Array) ||
      !(rubber instanceof Float32Array) ||
      water.length === 0 ||
      (this.surface !== null && water.length * SURFACE_WORDS !== this.surface.data.length) ||
      water.length !== rubber.length ||
      (marbles !== undefined &&
        (!(marbles instanceof Float32Array) ||
          marbles.length !== water.length ||
          !allFinite(marbles))) ||
      (frozen !== undefined &&
        (!(frozen instanceof Float32Array) ||
          frozen.length !== water.length ||
          !allFinite(frozen))) ||
      !Number.isFinite(time) ||
      time < 0 ||
      !allFinite(water) ||
      !allFinite(rubber)
    ) {
      this.fail('Invalid replay surface');
      return;
    }
    if (this.surface && time <= this.surface.time) return;
    const data = new Uint16Array(water.length * SURFACE_WORDS);
    for (let i = 0; i < water.length; i++) {
      data[i * SURFACE_WORDS] = Math.round(clamp(water[i], 0, 65.535) * 1000);
      data[i * SURFACE_WORDS + 1] = Math.round(clamp(rubber[i], 0, 1) * 65535);
      data[i * SURFACE_WORDS + 2] = Math.round(clamp(marbles?.[i] ?? 0, 0, 1) * 65535);
      data[i * SURFACE_WORDS + 3] = Math.round(
        clamp((frozen?.[i] ?? 0) / FROZEN_FULL_SCALE_MM, 0, 1) * 65535,
      );
    }
    this.surface = { time, data };
    this.surfaceHashes.set(this.surface, hashWords(data));
    this.current.surfaces.push(this.surface);
  }
  private seal() {
    if (this.writing.size >= 3) {
      this.fail('Replay cache cannot keep up; recording stopped without deleting earlier laps.');
      return;
    }
    const page = this.current;
    this.metadata.push({
      start: page.frames[H.TIME],
      end: page.frames[(page.count - 1) * this.stride + H.TIME],
      count: page.count,
      frameHash: this.frameHash,
      surfaces: page.surfaces.map((record) => ({
        time: record.time,
        length: record.data.length,
        hash: this.surfaceHashes.get(record)!,
      })),
    });
    this.cache.set(page.id, page);
    this.writing.add(page);
    this.writes = this.writes.then(async () => {
      try {
        await this.store.put(page);
      } catch (error) {
        this.fail(`Replay storage failed: ${String(error)}`);
      } finally {
        this.writing.delete(page);
        this.trim();
      }
    });
    this.current = this.page(page.id + 1);
    this.frameHash = HASH_SEED;
    // Surface messages can lead a batched pose delivery. Carry the last state
    // valid at the left endpoint AND every newer keyframe, not just the latest
    // (possibly future) weather. Records are immutable after capture.
    const end = this.metadata[page.id].end;
    let preceding = page.surfaces.length - 1;
    while (preceding > 0 && page.surfaces[preceding].time > end) preceding--;
    this.current.surfaces = page.surfaces.slice(Math.max(0, preceding));
    this.trim();
  }
  private trim() {
    if (this.cache.size <= 4) return;
    for (const [id, page] of this.cache) {
      if (!this.writing.has(page)) this.cache.delete(id);
      if (this.cache.size <= 4) break;
    }
  }
  private fail(message: string) {
    if (!this.failure) {
      this.failure = message;
      this.notify(message);
    }
  }
  private read(id: number): ReplayPage | null {
    if (id === this.current.id) return this.current;
    const cached = this.cache.get(id);
    if (cached) {
      this.cache.delete(id);
      this.cache.set(id, cached);
      return cached;
    }
    const metadata = this.metadata[id];
    if (
      metadata &&
      !this.pendingReads.has(id) &&
      !this.failedReads.has(id) &&
      this.pendingReads.size < 2 &&
      !this.closed
    ) {
      // A flashback can reopen this page or reuse its numeric id while I/O
      // is pending. Only the original sealed witness may admit the result.
      // Earlier, unchanged pages can still complete; read slots remain held
      // until their actual promises settle.
      const currentTimeline = () => !this.closed && this.metadata[id] === metadata;
      const request = this.store
        .get(id)
        .then(async (page) => {
          if (!currentTimeline()) return;
          if (
            !page ||
            page.id !== id ||
            page.version !== PROTOCOL_VERSION ||
            page.stride !== this.stride ||
            page.count !== metadata.count ||
            !(page.frames instanceof Float32Array) ||
            page.frames.length !== this.stride * this.pageFrames ||
            page.frames[H.TIME] !== metadata.start ||
            page.frames[(page.count - 1) * this.stride + H.TIME] !== metadata.end ||
            !Array.isArray(page.surfaces) ||
            page.surfaces.length !== metadata.surfaces.length ||
            page.surfaces.some(
              (record, index) =>
                !record ||
                !Number.isFinite(record.time) ||
                record.time < 0 ||
                !(record.data instanceof Uint16Array) ||
                !record.data.length ||
                record.data.length % SURFACE_WORDS !== 0 ||
                (this.surface !== null && record.data.length !== this.surface.data.length) ||
                (index > 0 &&
                  (record.time <= page.surfaces[index - 1].time ||
                    record.data.length !== page.surfaces[0].data.length)),
            )
          )
            throw new Error('Incompatible replay page');
          let frameHash = HASH_SEED,
            deadline = performance.now() + 4;
          const words = new Uint32Array(
            page.frames.buffer,
            page.frames.byteOffset,
            page.frames.length,
          );
          for (let i = 0; i < page.count; i++) {
            const offset = i * this.stride;
            if (
              snapshotIncompatibility(
                page.frames.subarray(offset, offset + this.stride),
                page.version,
              ) !== null ||
              page.frames[offset + H.CARS] !== this.cars ||
              (i > 0 && page.frames[offset + H.TIME] <= page.frames[offset - this.stride + H.TIME])
            )
              throw new Error('Incompatible replay page');
            for (let field = offset; field < offset + this.stride; field++)
              if (!Number.isFinite(page.frames[field])) throw new Error('Incompatible replay page');
            frameHash = hashWords(words, frameHash, offset, offset + this.stride);
            if (performance.now() >= deadline) {
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
              if (!currentTimeline()) return;
              deadline = performance.now() + 4;
            }
          }
          if (frameHash !== metadata.frameHash)
            throw new Error('Incompatible replay page: recorded bytes changed');
          for (let i = 0; i < page.surfaces.length; i++) {
            const record = page.surfaces[i],
              witness = metadata.surfaces[i];
            if (
              record.time !== witness.time ||
              record.data.length !== witness.length ||
              hashWords(record.data) !== witness.hash
            )
              throw new Error('Incompatible replay page: recorded surface changed');
            // Loaded records have new identities. A flashback may reopen this
            // page and carry them into newly sealed pages on the resumed run.
            this.surfaceHashes.set(record, witness.hash);
            if (performance.now() >= deadline) {
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
              if (!currentTimeline()) return;
              deadline = performance.now() + 4;
            }
          }
          if (!currentTimeline()) return;
          this.cache.set(id, page);
          this.trim();
        })
        .catch((error) => {
          if (!currentTimeline()) return;
          this.failedReads.add(id);
          this.fail(`Replay read failed: ${String(error)}`);
        })
        .finally(() => {
          this.pendingReads.delete(id);
          // A rapid scrub may have filled both read slots with earlier targets.
          // Start the latest requested pages as soon as a slot is released,
          // independently of the next render callback.
          this.prefetchSeek();
        });
      this.pendingReads.set(id, request);
    }
    return null;
  }
  /** Start the exact seek's disk reads while the renderer finishes its current
   * frame. This never samples a pose, changes the displayed weather, or
   * acknowledges the playback clock. The normal sample/present path owns those.
   * Repeated requests replace one pending target; reads remain bounded at two. */
  prepareSeek(seconds: number): void {
    if (this.closed || this.failure || !this.count || !Number.isFinite(seconds)) return;
    this.preparedSeekTime = clamp(this.start + seconds, this.start, this.end);
    this.prefetchSeek();
  }
  private prefetchSeek(): void {
    if (this.preparedSeekTime === null || this.closed || this.failure) return;
    const time = clamp(this.preparedSeekTime, this.start, this.end),
      pageId = this.pageAt(time),
      page = this.read(pageId);
    // The last sample of a sealed page interpolates against the next page.
    // Load both sides immediately instead of waiting for a second GPU slot.
    const nextReady =
      pageId >= this.current.id || time < this.metadata[pageId].end || !!this.read(pageId + 1);
    if (page && nextReady) this.preparedSeekTime = null;
  }
  private pageAt(time: number): number {
    let lo = 0,
      hi = this.metadata.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.metadata[mid].end < time) lo = mid + 1;
      else hi = mid;
    }
    // Retain the preceding frame when interpolating a cross-page interval.
    let pageId = lo;
    if (pageId > 0) {
      const start =
        pageId === this.current.id ? this.current.frames[H.TIME] : this.metadata[pageId].start;
      if (time < start) pageId--;
    }
    return pageId;
  }
  /** Visit a causal slice of the stored worker frames without moving the
   * replay clock or decoding a different weather surface. Preroll uses at
   * most two pages, which cover over twenty seconds at the normal page
   * size. A disk miss never hands the consumer a partial interval. */
  visitRecentFrames(endTime: number, duration: number, visit: (frame: Float32Array) => void) {
    if (this.closed || !this.count || !Number.isFinite(endTime + duration) || duration < 0)
      return false;
    const end = clamp(endTime, this.start, this.end);
    const start = Math.max(this.start, end - duration);
    const last = this.pageAt(end);
    const first = Math.max(last - 1, this.pageAt(start));
    const earlier = this.read(first);
    const later = first === last ? earlier : this.read(last);
    if (!earlier || !later) return false;
    const walk = (page: ReplayPage) => {
      for (let index = 0; index < page.count; index++) {
        const offset = index * this.stride, time = page.frames[offset + H.TIME];
        if (time > end) break;
        if (time >= start) visit(page.frames.subarray(offset, offset + this.stride));
      }
    };
    walk(earlier);
    if (later !== earlier) walk(later);
    return true;
  }
  sample(seconds: number, a: Float32Array, b: Float32Array): number | null {
    if (this.closed || !this.count || !Number.isFinite(seconds)) return null;
    if (a.length !== this.stride || b.length !== this.stride)
      throw new Error('Invalid replay output buffers');
    const time = clamp(this.start + seconds, this.start, this.end),
      pageId = this.pageAt(time),
      page = this.read(pageId);
    if (!page) return null;
    let left = 0,
      right = page.count - 1;
    while (right - left > 1) {
      const mid = (left + right) >>> 1;
      if (page.frames[mid * this.stride + H.TIME] <= time) left = mid;
      else right = mid;
    }
    if (time >= page.frames[right * this.stride + H.TIME]) left = right;
    let next = page,
      nextIndex = Math.min(left + 1, page.count - 1);
    if (left === page.count - 1 && pageId < this.current.id) {
      const found = this.read(pageId + 1);
      if (!found) return null;
      if (found.count) {
        next = found;
        nextIndex = 0;
      }
    }
    a.set(page.frames.subarray(left * this.stride, (left + 1) * this.stride));
    b.set(next.frames.subarray(nextIndex * this.stride, (nextIndex + 1) * this.stride));
    this.selectSurface(page, next, time);
    return clamp((time - a[H.TIME]) / (b[H.TIME] - a[H.TIME] || 1), 0, 1);
  }
  private selectSurface(page: ReplayPage, next: ReplayPage, time: number) {
    let surface: SurfaceRecord | undefined;
    for (const record of page.surfaces) if (record.time <= time) surface = record;
    if (next !== page)
      for (const record of next.surfaces)
        if (record.time <= time && (!surface || record.time > surface.time)) surface = record;
    if (!surface) {
      // A backwards seek must never keep a decoded surface from the future.
      if (this.decodedSurface) {
        this.decodedSurface = null;
        this.decodedWater = new Float32Array(0);
        this.decodedRubber = new Float32Array(0);
        this.decodedMarbles = new Float32Array(0);
        this.decodedFrozen = new Float32Array(0);
      }
      return;
    }
    if (surface === this.decodedSurface) return;
    this.decodedSurface = surface;
    const size = surface.data.length / SURFACE_WORDS;
    if (size !== this.decodedWater.length) {
      this.decodedWater = new Float32Array(size);
      this.decodedRubber = new Float32Array(size);
      this.decodedMarbles = new Float32Array(size);
      this.decodedFrozen = new Float32Array(size);
    }
    for (let i = 0; i < size; i++) {
      this.decodedWater[i] = surface.data[i * SURFACE_WORDS] / 1000;
      this.decodedRubber[i] = surface.data[i * SURFACE_WORDS + 1] / 65535;
      this.decodedMarbles[i] = surface.data[i * SURFACE_WORDS + 2] / 65535;
      this.decodedFrozen[i] = (surface.data[i * SURFACE_WORDS + 3] / 65535) * FROZEN_FULL_SCALE_MM;
    }
  }
  get surfaceState() {
    return {
      water: this.decodedWater,
      rubber: this.decodedRubber,
      marbles: this.decodedMarbles,
      frozen: this.decodedFrozen,
      time: this.decodedSurface?.time ?? -1,
    };
  }
  get count() {
    return this.totalCount;
  }
  /** The page that would hold the end of the recording after `truncate(time)`:
   * the open page, or a cached, fully written recent page; null otherwise. */
  private truncationPage(time: number) {
    if (this.closed || this.failure || !Number.isFinite(time) || time < this.start) return null;
    if (this.current.count && this.current.frames[H.TIME] <= time) return this.current;
    let id = this.metadata.length - 1;
    while (id >= 0 && this.metadata[id].start > time) id--;
    const page = this.cache.get(id);
    return page && !this.writing.has(page) ? page : null;
  }
  /** D31 flashback: can the recording be cut back to `time` synchronously? */
  canTruncate(time: number) {
    return this.truncationPage(time) !== null;
  }
  /** D31 flashback: forget every frame recorded after `time`; the resumed
   * session records its own future from there. The open page or a cached
   * recent page (about the last 80 s) is reopened; later stored pages are
   * overwritten by id as the new timeline seals them. */
  truncate(time: number) {
    const page = this.truncationPage(time);
    if (!page) return false;
    this.preparedSeekTime = null;
    if (page !== this.current) {
      this.metadata.length = page.id;
      for (const id of [...this.cache.keys()]) if (id >= page.id) this.cache.delete(id);
      for (const id of [...this.failedReads]) if (id >= page.id) this.failedReads.delete(id);
      this.current = page;
    }
    const stride = this.stride;
    let count = 0;
    while (count < page.count && page.frames[count * stride + H.TIME] <= time) count++;
    page.count = count;
    page.frames.fill(0, count * stride);
    this.frameHash = HASH_SEED;
    for (let i = 0; i < count; i++) {
      const frame = page.frames.subarray(i * stride, (i + 1) * stride);
      this.frameHash = hashWords(
        new Uint32Array(frame.buffer, frame.byteOffset, frame.length),
        this.frameHash,
      );
    }
    this.lastTime = count ? page.frames[(count - 1) * stride + H.TIME] : -Infinity;
    this.totalCount = this.metadata.reduce((sum, meta) => sum + meta.count, 0) + count;
    // Keep the weather keyframe valid at the cut and drop the old future's.
    let keep = page.surfaces.length;
    while (keep > 0 && page.surfaces[keep - 1].time > time) keep--;
    page.surfaces.length = keep;
    this.surface = page.surfaces[keep - 1] ?? null;
    return true;
  }
  get start() {
    return this.metadata[0]?.start ?? (this.current.count ? this.current.frames[H.TIME] : 0);
  }
  get end() {
    return this.current.count
      ? this.current.frames[(this.current.count - 1) * this.stride + H.TIME]
      : (this.metadata.at(-1)?.end ?? 0);
  }
  get duration() {
    return this.end - this.start;
  }
  get error() {
    return this.failure;
  }
  /** Page-residency witness for replay-clock diagnosis (F01): which pages are
   * resident, pending or failed, and how many sealed pages exist. */
  diagnostics() {
    return {
      currentPage: this.current.id,
      preparedSeekTime: this.preparedSeekTime,
      sealedPages: this.metadata.length,
      cached: [...this.cache.keys()],
      pending: [...this.pendingReads.keys()],
      failed: [...this.failedReads],
      writing: [...this.writing].map((page) => page.id),
    };
  }
  get bytes() {
    return (
      this.current.frames.byteLength +
      this.current.surfaces.reduce((sum, record) => sum + record.data.byteLength, 0) +
      [...this.cache.values()].reduce(
        (sum, page) =>
          sum + page.frames.byteLength + page.surfaces.reduce((n, s) => n + s.data.byteLength, 0),
        0,
      )
    );
  }
  makeFrame() {
    return new Float32Array(this.stride);
  }
  async settle() {
    await this.writes;
    while (this.pendingReads.size) await Promise.all(this.pendingReads.values());
  }
  async dispose() {
    this.closed = true;
    this.preparedSeekTime = null;
    await this.settle();
    this.cache.clear();
    try {
      await this.store.dispose();
    } catch (error) {
      this.notify(`Replay cache cleanup failed: ${String(error)}`);
    }
  }
}
