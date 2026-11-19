import * as T from 'three';
import type { QualityPreset } from '../options.ts';

export interface StreetLightSocket {
  position: T.Vector3;
  target: T.Vector3;
}
interface Candidate {
  socket: StreetLightSocket;
  index: number;
  score: number;
}
interface Slot {
  light: T.SpotLight;
  index: number;
  requested: number;
  level: number;
  shadowScore: number;
  shadowValid: boolean;
  shadowDirty: boolean;
  capturedTime: number;
  capturedRevision: number;
}

/** A local cone, not a world-sized shadow camera. Target counts and texels
 * are bounded separately from the existing diffuse/specular light pools. */
export const STREET_SHADOWS = Object.freeze({
  high: { count: 1, size: 512 },
  ultra: { count: 2, size: 1024 },
  reach: 32,
  near: 0.4,
  far: 29,
  retention: 0.72,
});

/** Real, inverse-square illumination from the existing town lamp heads.
 * Four local pools on MEDIUM, six on HIGH, eight on ULTRA; LOW keeps emissive
 * heads only. No new poles, collision objects or full-world light array.
 * High/Ultra additionally shadow one/two nearby pools. Stable assignments fade
 * to dark before moving a slot between sockets; the previous socket's map is
 * discarded before its light can fade back in at another position. */
export class StreetLightPools {
  readonly root = new T.Group();
  private readonly candidates: Candidate[];
  private readonly slots: Slot[] = [];
  private readonly selected = new Set<number>();
  private readonly assigned = new Set<number>();
  private readonly eye = new T.Vector3();
  private readonly shadowEye = new T.Vector3(Infinity, Infinity, Infinity);
  private readonly shadowSlots = new Set<Slot>();
  private readonly shadowProgramSlots = new Set<Slot>();
  private shadowPreset: QualityPreset = 'medium';
  private shadowsEnabled = true;
  private maxShadowSize = 1024;
  private shadowBudget = 0;
  private shadowSize = 0;
  private shadowUpdates = 0;
  private lastRequestedUpdates = 0;
  private disposed = false;
  constructor(readonly sockets: readonly StreetLightSocket[]) {
    this.root.name = 'Budgeted town street illumination';
    this.candidates = sockets.map((socket, index) => ({ socket, index, score: Infinity }));
    for (let i = 0; i < 8; i++) {
      const light = new T.SpotLight(0xffdfb1, 0, 29, 0.72, 0.72, 2);
      light.name = `Town lamp pool ${i + 1}`;
      light.castShadow = false;
      light.visible = false;
      light.shadow.autoUpdate = false;
      light.shadow.needsUpdate = false;
      light.shadow.intensity = 0;
      light.shadow.bias = -0.00012;
      light.shadow.normalBias = 0.015;
      light.shadow.camera.near = STREET_SHADOWS.near;
      light.shadow.camera.far = STREET_SHADOWS.far;
      light.shadow.camera.updateProjectionMatrix();
      this.root.add(light, light.target);
      this.slots.push({
        light,
        index: -1,
        requested: -1,
        level: 0,
        shadowScore: Infinity,
        shadowValid: false,
        shadowDirty: true,
        capturedTime: NaN,
        capturedRevision: -1,
      });
    }
  }

  /** Apply immediately during a graphics change, including the independent
   * shadows-off option. Allocation remains lazy until the main scene draw. */
  configureShadows(quality: QualityPreset, enabled = true, maxTextureSize = 1024) {
    if (this.disposed) return;
    this.shadowPreset = quality;
    this.shadowsEnabled = enabled;
    this.maxShadowSize =
      Number.isFinite(maxTextureSize) && maxTextureSize >= 1 ? Math.floor(maxTextureSize) : 1;
    const budget = quality === 'high' || quality === 'ultra' ? STREET_SHADOWS[quality] : null;
    this.shadowBudget = enabled && budget ? budget.count : 0;
    const size = this.shadowBudget && budget ? Math.min(budget.size, this.maxShadowSize) : 0;
    if (size !== this.shadowSize) {
      for (const slot of this.slots) this.releaseShadow(slot);
      this.shadowSize = size;
    }
    this.selectShadows();
  }

  update(camera: T.Camera, night: number, quality: QualityPreset, dt: number) {
    if (this.disposed) return;
    if (quality !== this.shadowPreset)
      this.configureShadows(quality, this.shadowsEnabled, this.maxShadowSize);
    const strength = Number.isFinite(night) ? T.MathUtils.clamp(night, 0, 1) : 0;
    const count =
      quality === 'low' || strength <= 0.01
        ? 0
        : quality === 'medium'
          ? 4
          : quality === 'high'
            ? 6
            : 8;
    camera.getWorldPosition(this.eye);
    // The caster LOD/visibility follows the camera even in photo mode. A held
    // camera and held simulation reuse their completed maps without work.
    if (!this.eye.equals(this.shadowEye)) {
      this.invalidate();
      this.shadowEye.copy(this.eye);
    }
    this.assigned.clear();
    for (const slot of this.slots) if (slot.index >= 0) this.assigned.add(slot.index);
    for (const item of this.candidates) {
      const p = item.socket.position;
      const distance = p.distanceToSquared(this.eye);
      // Retention bias prevents alternating assignments on a Voronoi edge.
      item.score = distance * (this.assigned.has(item.index) ? 0.82 : 1);
    }
    this.candidates.sort((a, b) => a.score - b.score || a.index - b.index);
    this.selected.clear();
    for (const candidate of this.candidates) {
      if (this.selected.size >= count || candidate.score > 72 * 72) break;
      this.selected.add(candidate.index);
    }
    // Preserve sockets already represented. Reserve each new destination once.
    const desired = new Set(this.selected);
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      slot.requested = i < count && this.selected.has(slot.index) ? slot.index : -1;
      if (slot.requested >= 0) desired.delete(slot.requested);
    }
    for (let i = 0; i < count; i++)
      if (this.slots[i].requested < 0) {
        const first = desired.values().next();
        if (!first.done) {
          this.slots[i].requested = first.value;
          desired.delete(first.value);
        }
      }
    const step = Number.isFinite(dt) ? T.MathUtils.clamp(dt, 0, 0.08) : 0;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const stable = slot.index === slot.requested && slot.index >= 0 && i < count;
      slot.level = T.MathUtils.clamp(slot.level + step * (stable ? 2.2 : -4), 0, 1);
      if (!stable && slot.level === 0) {
        if (slot.index !== slot.requested) this.releaseShadow(slot);
        slot.index = slot.requested;
        if (slot.index >= 0) {
          slot.light.position.copy(this.sockets[slot.index].position);
          slot.light.target.position.copy(this.sockets[slot.index].target);
          slot.light.target.updateMatrixWorld();
        }
      }
      // Fixed shader light count within a quality/lighting state, even in an
      // unlit rural area, avoids recompilation every time a lamp enters range.
      slot.light.visible = i < count;
      slot.light.intensity = 520 * strength * slot.level;
    }
    this.selectShadows();
  }

  private selectShadows() {
    this.shadowSlots.clear();
    for (const slot of this.slots) {
      const usable =
        slot.light.visible && slot.index >= 0 && (slot.level > 0 || slot.index === slot.requested);
      const distance = usable ? slot.light.position.distanceToSquared(this.eye) : Infinity;
      slot.shadowScore =
        distance <= STREET_SHADOWS.reach ** 2
          ? distance * (slot.shadowValid ? STREET_SHADOWS.retention : 1)
          : Infinity;
    }
    for (let i = 0; i < this.shadowBudget; i++) {
      let closest: Slot | null = null;
      for (const slot of this.slots)
        if (!this.shadowSlots.has(slot) && slot.shadowScore < (closest?.shadowScore ?? Infinity))
          closest = slot;
      if (!closest) break;
      this.shadowSlots.add(closest);
    }
    // Keep the shader's shadow-light count stable while its night pools are
    // enabled. Dormant slots carry zero shadow strength and no target, so a
    // rural/town boundary cannot trigger a new program for every material.
    this.shadowProgramSlots.clear();
    for (const slot of this.shadowSlots) this.shadowProgramSlots.add(slot);
    for (const retain of [true, false])
      for (const slot of this.slots) {
        if (this.shadowProgramSlots.size >= this.shadowBudget) break;
        if (slot.light.visible && (!retain || slot.light.castShadow))
          this.shadowProgramSlots.add(slot);
      }
    for (const slot of this.slots) {
      if (!this.shadowSlots.has(slot)) {
        if (slot.shadowValid || slot.light.shadow.map || slot.light.shadow.mapPass)
          this.releaseShadow(slot);
        slot.light.castShadow = this.shadowProgramSlots.has(slot);
        slot.light.shadow.intensity = 0;
        if (slot.light.castShadow) slot.light.shadow.mapSize.set(this.shadowSize, this.shadowSize);
        continue;
      }
      if (!slot.light.castShadow) {
        slot.light.castShadow = true;
        slot.light.shadow.mapSize.set(this.shadowSize, this.shadowSize);
        slot.shadowDirty = true;
        // Auxiliary captures precede the main frame. Until a first complete
        // map exists they see unoccluded light, never a previous socket's map.
        slot.light.shadow.intensity = 0;
      }
    }
  }

  private releaseShadow(slot: Slot) {
    const shadow = slot.light.shadow;
    shadow.map?.dispose();
    if (shadow.mapPass !== shadow.map) shadow.mapPass?.dispose();
    shadow.map = shadow.mapPass = null;
    shadow.needsUpdate = false;
    shadow.intensity = 0;
    slot.light.castShadow = false;
    slot.shadowValid = false;
    slot.shadowDirty = true;
    slot.capturedTime = NaN;
    slot.capturedRevision = -1;
  }

  /** Authored scenery, travel or other same-time caster changes. */
  invalidate() {
    if (this.disposed) return;
    for (const slot of this.slots) slot.shadowDirty = true;
  }

  /** Request maps only around the main scene draw, after far bakes and probe
   * captures have restored moving objects. A bare castShadow flag would let
   * those auxiliary passes consume a map with cars deliberately hidden.
   *
   * The global update request is explicit: a shared renderer can retain
   * shadowMap.autoUpdate=false from another owner. Per-light manual updates
   * also prevent late-scene or reflection draws from repeating this work. */
  renderWithShadows(
    renderer: T.WebGLRenderer,
    time: number,
    terrainRevision: number,
    draw: () => void,
  ) {
    if (this.disposed) return;
    this.lastRequestedUpdates = 0;
    const pending: Slot[] = [];
    if (!renderer.shadowMap.enabled) {
      for (const slot of this.slots) this.releaseShadow(slot);
    } else {
      for (const slot of this.shadowSlots) {
        if (!slot.light.visible || !slot.light.castShadow) continue;
        const clock = Number.isFinite(time)
          ? time
          : Number.isFinite(slot.capturedTime)
            ? slot.capturedTime
            : 0;
        if (
          slot.shadowDirty ||
          !slot.shadowValid ||
          !slot.light.shadow.map ||
          clock !== slot.capturedTime ||
          terrainRevision !== slot.capturedRevision
        ) {
          slot.light.shadow.needsUpdate = true;
          slot.light.shadow.intensity = 1;
          pending.push(slot);
        }
      }
    }
    const previousRequest = renderer.shadowMap.needsUpdate;
    if (pending.length) renderer.shadowMap.needsUpdate = true;
    this.lastRequestedUpdates = pending.length;
    let complete = false;
    try {
      draw();
      complete = true;
      for (const slot of pending) {
        const shadow = slot.light.shadow;
        if (!shadow.map || shadow.needsUpdate) continue;
        slot.shadowValid = true;
        slot.shadowDirty = false;
        slot.capturedTime = Number.isFinite(time)
          ? time
          : Number.isFinite(slot.capturedTime)
            ? slot.capturedTime
            : 0;
        slot.capturedRevision = terrainRevision;
        this.shadowUpdates++;
      }
    } finally {
      // A context-lost/hidden-scene draw may return without consuming our
      // request. Do not leave that request for the next auxiliary capture.
      if (
        !complete ||
        pending.some((slot) => slot.light.shadow.needsUpdate || !slot.light.shadow.map)
      )
        renderer.shadowMap.needsUpdate = previousRequest;
      for (const slot of pending) {
        // Failed or skipped draws cannot publish a partially updated map.
        if (!complete || slot.light.shadow.needsUpdate || !slot.shadowValid) {
          slot.shadowDirty = true;
          slot.shadowValid = false;
          slot.light.shadow.intensity = 0;
        }
        slot.light.shadow.needsUpdate = false;
      }
    }
  }

  get activeSockets() {
    return this.slots.filter((s) => s.light.visible && s.level > 0).map((s) => s.index);
  }
  diagnostics() {
    return {
      shadowBudget: this.shadowBudget,
      shadowMapSize: this.shadowSize,
      shadowReach: STREET_SHADOWS.reach,
      shadowSockets: [...this.shadowSlots].map((s) => s.index),
      shaderShadowLights: this.slots.filter((s) => s.light.castShadow && s.light.visible).length,
      readyShadows: this.slots.filter((s) => s.light.castShadow && s.shadowValid).length,
      allocatedMaps: this.slots.filter((s) => s.light.shadow.map !== null).length,
      allocatedTexels: this.slots.reduce(
        (sum, s) =>
          sum + (s.light.shadow.map ? s.light.shadow.map.width * s.light.shadow.map.height : 0),
        0,
      ),
      requestedUpdates: this.lastRequestedUpdates,
      updates: this.shadowUpdates,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) {
      this.releaseShadow(slot);
      slot.light.dispose();
    }
    this.shadowSlots.clear();
    this.shadowProgramSlots.clear();
    this.root.removeFromParent();
    this.root.clear();
  }
}
