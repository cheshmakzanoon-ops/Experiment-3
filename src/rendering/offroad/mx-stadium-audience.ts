import * as T from 'three';

const CELL = 2;
const ANGLE_STEP = Math.PI / 36;
// The seated/standing and waving envelope fits within two metres of its
// anchor. Include the furthest true eye in a quantised camera cell. Twice
// that distance bounds the change in dot(v,f) - |v| cos(a) on the cone.
const VIEW_MARGIN = 2 * (2 + (Math.sqrt(3) * CELL) / 2);

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
  private yaw = NaN;
  private pitch = NaN;
  private diagonal = NaN;
  private readonly inverse = new T.Matrix4();
  private readonly forward = new T.Vector3();
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
    this.cards.updateWorldMatrix(true, false);
    this.inverse.copy(this.cards.matrixWorld).invert();
    camera.getWorldPosition(this.localCamera).applyMatrix4(this.inverse);
    camera.getWorldDirection(this.forward).transformDirection(this.inverse);
    const yaw = Math.round(Math.atan2(this.forward.x, this.forward.z) / ANGLE_STEP);
    const pitch = Math.round(Math.asin(T.MathUtils.clamp(this.forward.y, -1, 1)) / ANGLE_STEP);
    // A circle circumscribes the four image corners even when the camera
    // rolls. Off-axis lenses use their furthest corner from the optical axis.
    const lens = camera.projectionMatrix.elements;
    const horizontal = (1 + Math.abs(lens[8])) / lens[0];
    const vertical = (1 + Math.abs(lens[9])) / lens[5];
    const diagonal = Math.ceil(Math.atan(Math.hypot(horizontal, vertical)) / ANGLE_STEP);
    const x = Math.round(this.localCamera.x / CELL) * CELL;
    const y = Math.round(this.localCamera.y / CELL) * CELL;
    const z = Math.round(this.localCamera.z / CELL) * CELL;
    const focal =
      Math.tan(T.MathUtils.degToRad(25)) /
      Math.tan(T.MathUtils.degToRad(camera.getEffectiveFOV() * 0.5));
    const radius = Math.round(T.MathUtils.clamp(62 * focal, 48, 180));
    if (
      x === this.cellX &&
      y === this.cellY &&
      z === this.cellZ &&
      radius === this.radius &&
      yaw === this.yaw &&
      pitch === this.pitch &&
      diagonal === this.diagonal
    )
      return;
    this.yaw = yaw;
    this.pitch = pitch;
    this.diagonal = diagonal;
    const heading = yaw * ANGLE_STEP,
      elevation = pitch * ANGLE_STEP;
    const cosPitch = Math.cos(elevation),
      fx = Math.sin(heading) * cosPitch,
      fy = Math.sin(elevation),
      fz = Math.cos(heading) * cosPitch;
    // Half a bucket for yaw and pitch each. Rounding the half-angle outward
    // also keeps changes in lens, pose and resolution outside visible seats.
    const cosView = Math.cos((diagonal + 1) * ANGLE_STEP);
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
      const distanceSq = dx * dx + dy * dy + dz * dz;
      const active =
        distanceSq <= reach * reach &&
        dx * fx + dy * fy + dz * fz + VIEW_MARGIN >= Math.sqrt(distanceSq) * cosView
          ? 1
          : 0;
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
