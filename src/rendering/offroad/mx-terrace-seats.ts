import * as T from 'three';

/** The outdoor seat-to-seat handoff is ranked by the phase baked into each
 * fan. Store the two expensive sculpts in descending rank and the distant
 * sculpts in ascending rank. Three can then issue a prefix of the very same
 * seats, including their original pose, garment, phase and skin. */
export class MxTerraceSeats {
  private readonly ranks: Float32Array;

  constructor(levels: readonly T.InstancedMesh[]) {
    const source = levels[0];
    const attributes = ['spectatorPhase', 'spectatorSkin', 'spectatorStyle'] as const;
    const columns = attributes.map(key => source.geometry.getAttribute(key) as T.InstancedBufferAttribute);
    const phase = columns[0];
    const ids = Array.from({ length: phase.count }, (_, i) => i)
      .sort((a, b) => phase.getX(a) - phase.getX(b));
    this.ranks = Float32Array.from(ids, id => Math.min(0.9999999, phase.getX(id) / (2 * Math.PI)));
    const transforms = source.instanceMatrix, tints = source.instanceColor!;
    for (const first of [0, 2]) {
      const order = first === 0 ? [...ids].reverse() : ids;
      const sorted = [transforms, tints, ...columns].map(attribute => {
        const copy = new T.InstancedBufferAttribute(
          new Float32Array(attribute.array.length), attribute.itemSize, attribute.normalized, attribute.meshPerAttribute,
        );
        for (let i = 0; i < order.length; i++) copy.copyAt(i, attribute, order[i]);
        return copy;
      });
      for (const mesh of levels.slice(first, first + 2)) {
        mesh.instanceMatrix = sorted[0];
        mesh.instanceColor = sorted[1];
        for (let i = 0; i < attributes.length; i++) mesh.geometry.setAttribute(attributes[i], sorted[2 + i]);
      }
    }
  }

  count(level: number, range: T.Vector2) {
    if (range.y <= range.x) return 0;
    const descending = level < 2;
    // The existing shader makes the final decision. Keep a rounding margin
    // at fractional thresholds so CPU and GLSL precision cannot drop a seat.
    const limit = descending ? range.x - 0.000001 : range.y + 0.000001;
    let lo = 0, hi = this.ranks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ranks[mid] < limit) lo = mid + 1;
      else hi = mid;
    }
    return descending ? this.ranks.length - lo : lo;
  }
}
