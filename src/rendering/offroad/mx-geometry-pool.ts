import * as T from 'three';

type VertexArray = T.BufferAttribute['array'];

function sameStorage(a: VertexArray, b: VertexArray) {
  if (a === b) return true;
  if (a.constructor !== b.constructor || a.byteLength !== b.byteLength) return false;
  const left = new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
    right = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

/** A field contains multiple copies of the same two motorcycle designs. Keep
 * immutable vertex data once per design and detail. Each rider still owns its
 * geometry, upload state, suspension buffers, skeleton and instance transforms. */
export class MxGeometryPool {
  private readonly designs = new Map<string, Map<string, WeakRef<VertexArray>>>();

  share(design: string, root: T.Object3D) {
    const slots = this.designs.get(design) ?? new Map<string, WeakRef<VertexArray>>();
    this.designs.set(design, slots);
    const visited = new Set<T.BufferGeometry>();
    const shareAttribute = (
      slot: string,
      attr: T.BufferAttribute | T.InterleavedBufferAttribute,
    ) => {
      if (
        !(attr instanceof T.BufferAttribute) ||
        attr instanceof T.InstancedBufferAttribute ||
        attr.usage !== T.StaticDrawUsage
      )
        return;
      const other = slots.get(slot)?.deref();
      if (!other) slots.set(slot, new WeakRef(attr.array));
      else if (sameStorage(attr.array, other)) attr.array = other;
    };
    root.traverse((object) => {
      if (!(object instanceof T.Mesh) || visited.has(object.geometry)) return;
      const g = object.geometry as T.BufferGeometry;
      const prefix = visited.size + '/';
      visited.add(g);
      if (g.index) shareAttribute(prefix + 'index', g.index);
      for (const [name, attr] of Object.entries(g.attributes)) shareAttribute(prefix + name, attr);
      for (const [name, targets] of Object.entries(g.morphAttributes))
        targets.forEach((attr, i) => shareAttribute(prefix + name + '/morph/' + i, attr));
    });
  }

  clear() {
    this.designs.clear();
  }
}
