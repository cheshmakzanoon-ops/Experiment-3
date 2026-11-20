import * as T from 'three';

const CELL = 2;

/** The immutable card table owns the identity, clothing, pose and seat of
 * every attendee. Compact the visible lower-row sculpts into one draw and
 * switch off exactly their cards; the remaining seats keep their occupant. */
export class MxStadiumAudience {
  private readonly candidates: Uint32Array;
  private readonly attributes: readonly [T.BufferAttribute, T.BufferAttribute][];
  private cellX = NaN;
  private cellY = NaN;
  private cellZ = NaN;
  private radius = NaN;
  private readonly localCamera = new T.Vector3();

  constructor(
    private readonly cards: T.InstancedMesh,
    private readonly people: T.InstancedMesh,
    private readonly mask: T.InstancedBufferAttribute,
  ) {
    this.candidates = Uint32Array.from(
      Array.from({ length: cards.count }, (_, i) => i).filter((i) => mask.getX(i) > 0.5),
    );
    this.attributes = [
      [people.instanceMatrix, cards.instanceMatrix],
      [people.instanceColor!, cards.instanceColor!],
      ...['spectatorPhase', 'spectatorSkin', 'spectatorStyle'].map(
        (name) =>
          [people.geometry.getAttribute(name), cards.geometry.getAttribute(name)] as [
            T.BufferAttribute,
            T.BufferAttribute,
          ],
      ),
    ];
    mask.setUsage(T.DynamicDrawUsage);
    for (const [dest] of this.attributes) dest.setUsage(T.DynamicDrawUsage);
  }

  update(camera: T.PerspectiveCamera) {
    if (!this.people.visible) return;
    // Quantisation and a spread in per-seat thresholds keep moving overhead
    // small. The selection is a function of the current view, including lens
    // zoom, so a replay cut restores the very same seats immediately.
    camera.getWorldPosition(this.localCamera);
    this.cards.worldToLocal(this.localCamera);
    const x = Math.round(this.localCamera.x / CELL) * CELL;
    const y = Math.round(this.localCamera.y / CELL) * CELL;
    const z = Math.round(this.localCamera.z / CELL) * CELL;
    const focal =
      Math.tan(T.MathUtils.degToRad(25)) /
      Math.tan(T.MathUtils.degToRad(camera.getEffectiveFOV() * 0.5));
    const radius = Math.round(T.MathUtils.clamp(62 * focal, 48, 180));
    if (x === this.cellX && y === this.cellY && z === this.cellZ && radius === this.radius) return;
    this.cellX = x;
    this.cellY = y;
    this.cellZ = z;
    this.radius = radius;
    const matrices = this.cards.instanceMatrix.array;
    const phases = this.cards.geometry.getAttribute('spectatorPhase');
    let changed = false;
    for (const i of this.candidates) {
      const p = i * 16;
      const dx = matrices[p + 12] - x,
        dy = matrices[p + 13] - y,
        dz = matrices[p + 14] - z;
      // The full variation interval of the lower-row cohort is [0, 0.4π).
      const reach = radius * (0.87 + (0.26 * phases.getX(i)) / (0.4 * Math.PI));
      const active = dx * dx + dy * dy + dz * dz <= reach * reach ? 1 : 0;
      if (active === this.mask.getX(i)) continue;
      this.mask.setX(i, active);
      changed = true;
    }
    if (!changed) return;
    this.mask.needsUpdate = true;
    let count = 0;
    for (const i of this.candidates) {
      if (!this.mask.getX(i)) continue;
      for (const [dest, source] of this.attributes) dest.copyAt(count, source, i);
      count++;
    }
    this.people.count = count;
    for (const [dest] of this.attributes) {
      dest.clearUpdateRanges();
      if (count) dest.addUpdateRange(0, count * dest.itemSize);
      dest.needsUpdate = true;
    }
  }
}
