import * as T from 'three';
import type { QualityPreset } from '../options.ts';

/** A real, already-rendered sign or suspended bulb. Positions and targets are
 * world-space; a group identifies one frontage or one string of bulbs. */
export interface FestivalPracticalSocket {
  readonly position: T.Vector3;
  readonly target: T.Vector3;
  readonly color: number;
  readonly kind: 'storefront' | 'festoon';
  readonly group: number;
}

const CAPACITY = 4;
const REACH = 42;
const SHAPES = {
  storefront: { intensity: 145, distance: 12, angle: 0.5, penumbra: 0.82 },
  festoon: { intensity: 190, distance: 17, angle: 0.62, penumbra: 0.88 },
} as const;
interface Candidate {
  readonly socket: FestivalPracticalSocket;
  readonly outwardX: number;
  readonly outwardZ: number;
}
interface Slot {
  readonly light: T.SpotLight;
  index: number;
  requested: number;
  level: number;
}

const finiteVector = (v: T.Vector3) =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** Small physical light pools from original storefronts and harbour bulbs.
 * The emitter geometry remains in HorizonDressing. Four reusable, unshadowed
 * cones contribute to Three.js diffuse/specular lighting and wet materials;
 * they add no render target, texture, mesh or shadow-map pass. Frontage cones
 * remain wholly outside their source facade, and their short range limits
 * spill. They do not provide general occlusion through other buildings.
 *
 * Selection is bounded O(sockets * 4), without a sort or frame allocations.
 * Each facade/string can occupy only one slot; retained sockets have a small
 * distance advantage. Relocation always occurs at zero intensity. */
export class FestivalPracticalLights {
  readonly root = new T.Group();
  readonly state = { capacity: CAPACITY, sockets: 0, visible: 0, active: 0 };
  private readonly candidates: Candidate[] = [];
  private readonly slots: Slot[] = [];
  private readonly selected = new Int32Array(CAPACITY).fill(-1);
  private readonly scores = new Float64Array(CAPACITY).fill(Infinity);
  private readonly eye = new T.Vector3();
  private disposed = false;

  constructor(sockets: readonly FestivalPracticalSocket[]) {
    this.root.name = 'Festival storefront and festoon illumination';
    for (const socket of sockets) {
      const shape = SHAPES[socket.kind];
      if (
        !shape ||
        !finiteVector(socket.position) ||
        !finiteVector(socket.target) ||
        !Number.isFinite(socket.color) ||
        !Number.isInteger(socket.group)
      )
        continue;
      const dx = socket.target.x - socket.position.x,
        dz = socket.target.z - socket.position.z,
        down = socket.position.y - socket.target.y,
        horizontal = Math.hypot(dx, dz),
        length = Math.hypot(horizontal, down);
      if (down < 0.4 || length >= shape.distance - 0.5) continue;
      // Every ray in a storefront cone must have a positive projection on
      // its facade's outward normal. Steep/invalid hillside aims are omitted.
      if (
        socket.kind === 'storefront' &&
        (horizontal < 1 || horizontal / length <= Math.sin(shape.angle) + 0.05)
      )
        continue;
      this.candidates.push({
        socket,
        outwardX: horizontal > 0.001 ? dx / horizontal : 0,
        outwardZ: horizontal > 0.001 ? dz / horizontal : 0,
      });
    }
    this.state.sockets = this.candidates.length;
    for (let i = 0; i < CAPACITY; i++) {
      const light = new T.SpotLight(0xffe1b9, 0, 12, 0.5, 0.82, 2);
      light.name = `Festival practical light ${i + 1}`;
      light.castShadow = false;
      light.visible = false;
      this.root.add(light, light.target);
      this.slots.push({ light, index: -1, requested: -1, level: 0 });
    }
  }

  update(camera: T.Camera, night: number, quality: QualityPreset, dt: number) {
    if (this.disposed) return;
    const strength = Number.isFinite(night) ? T.MathUtils.clamp(night, 0, 1) : 0;
    const count =
      strength <= 0.01 || quality === 'low'
        ? 0
        : quality === 'medium'
          ? 2
          : quality === 'high'
            ? 3
            : 4;
    camera.getWorldPosition(this.eye);
    if (count === 0 || !finiteVector(this.eye)) {
      this.reset();
      return;
    }
    this.selected.fill(-1);
    this.scores.fill(Infinity);
    for (let index = 0; index < this.candidates.length; index++) {
      const candidate = this.candidates[index],
        socket = candidate.socket,
        dx = this.eye.x - socket.position.x,
        dz = this.eye.z - socket.position.z;
      // A viewer behind the facade must not keep its outward light assigned
      // just because the building's rear is closer than another shopfront.
      if (socket.kind === 'storefront' && dx * candidate.outwardX + dz * candidate.outwardZ < -0.2)
        continue;
      let score = socket.position.distanceToSquared(this.eye);
      if (score > REACH * REACH) continue;
      for (let i = 0; i < count; i++)
        if (this.slots[i].index === index) {
          score *= 0.76;
          break;
        }
      // Competing bulbs on one string never consume multiple local slots.
      let existing = -1;
      for (let i = 0; i < count; i++) {
        const selected = this.selected[i];
        if (selected >= 0 && this.candidates[selected].socket.group === socket.group) {
          existing = i;
          break;
        }
      }
      if (existing >= 0) {
        if (score >= this.scores[existing]) continue;
        for (let i = existing; i < count - 1; i++) {
          this.selected[i] = this.selected[i + 1];
          this.scores[i] = this.scores[i + 1];
        }
        this.selected[count - 1] = -1;
        this.scores[count - 1] = Infinity;
      }
      for (let i = 0; i < count; i++)
        if (score < this.scores[i]) {
          for (let j = count - 1; j > i; j--) {
            this.selected[j] = this.selected[j - 1];
            this.scores[j] = this.scores[j - 1];
          }
          this.selected[i] = index;
          this.scores[i] = score;
          break;
        }
    }
    for (let i = 0; i < CAPACITY; i++) {
      const slot = this.slots[i];
      slot.requested = -1;
      if (i >= count || slot.index < 0) continue;
      for (let j = 0; j < count; j++)
        if (this.selected[j] === slot.index) {
          slot.requested = slot.index;
          this.selected[j] = -1;
          break;
        }
    }
    for (let i = 0; i < count; i++) {
      if (this.slots[i].requested >= 0) continue;
      for (let j = 0; j < count; j++)
        if (this.selected[j] >= 0) {
          this.slots[i].requested = this.selected[j];
          this.selected[j] = -1;
          break;
        }
    }
    const step = Number.isFinite(dt) ? T.MathUtils.clamp(dt, 0, 0.08) : 0;
    this.state.visible = count;
    this.state.active = 0;
    for (let i = 0; i < CAPACITY; i++) {
      const slot = this.slots[i],
        stable = slot.index === slot.requested && slot.index >= 0 && i < count;
      let groupOccupied = false;
      if (stable)
        for (let j = 0; j < CAPACITY; j++) {
          const other = this.slots[j];
          if (
            i !== j &&
            other.index >= 0 &&
            other.level > 0 &&
            this.candidates[other.index].socket.group === this.candidates[slot.index].socket.group
          ) {
            groupOccupied = true;
            break;
          }
        }
      slot.level = T.MathUtils.clamp(
        slot.level + step * (stable && !groupOccupied ? 2.5 : -5),
        0,
        1,
      );
      if (!stable && slot.level === 0) {
        slot.index = slot.requested;
        if (slot.index >= 0) {
          const socket = this.candidates[slot.index].socket,
            shape = SHAPES[socket.kind];
          slot.light.position.copy(socket.position);
          slot.light.target.position.copy(socket.target);
          slot.light.target.updateMatrixWorld();
          slot.light.color.setHex(socket.color);
          slot.light.distance = shape.distance;
          slot.light.angle = shape.angle;
          slot.light.penumbra = shape.penumbra;
        }
      }
      // Keep a fixed shader light count for a quality/night state, including
      // quiet rural areas. Crossing a shop does not recompile scene materials.
      slot.light.visible = i < count;
      slot.light.intensity =
        slot.index < 0
          ? 0
          : SHAPES[this.candidates[slot.index].socket.kind].intensity * strength * slot.level;
      if (slot.light.visible && slot.light.intensity > 0) this.state.active++;
    }
  }

  /** A session reset/quality disable discards all partially faded assignments. */
  reset() {
    this.selected.fill(-1);
    this.scores.fill(Infinity);
    for (const slot of this.slots) {
      slot.index = slot.requested = -1;
      slot.level = 0;
      slot.light.visible = false;
      slot.light.intensity = 0;
    }
    this.state.visible = this.state.active = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    for (const { light } of this.slots) light.dispose();
    this.root.removeFromParent();
    this.root.clear();
  }
}
