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

interface RigidTemplate {
  geometry: T.BufferGeometry;
  owners: number;
}
interface RigidBinding {
  key: string;
  original: T.BufferGeometry;
  template: RigidTemplate;
  meshes: T.Mesh[];
}

function rigidAttributes(geometry: T.BufferGeometry) {
  if (
    geometry instanceof T.InstancedBufferGeometry ||
    geometry.hasAttribute('skinWeight') ||
    Object.keys(geometry.morphAttributes).length ||
    Object.keys(geometry.userData).length
  )
    return false;
  return (
    Object.values(geometry.attributes).every(
      (a) =>
        a instanceof T.BufferAttribute &&
        !(a instanceof T.InstancedBufferAttribute) &&
        a.usage === T.StaticDrawUsage,
    ) &&
    (!geometry.index || geometry.index.usage === T.StaticDrawUsage)
  );
}

function sameRigidMesh(a: T.BufferGeometry, b: T.BufferGeometry) {
  if (
    a.type !== b.type ||
    a.name !== b.name ||
    a.index?.array !== b.index?.array ||
    a.drawRange.start !== b.drawRange.start ||
    a.drawRange.count !== b.drawRange.count ||
    (!!a.boundingBox && !!b.boundingBox && !a.boundingBox.equals(b.boundingBox)) ||
    (!!a.boundingSphere && !!b.boundingSphere && !a.boundingSphere.equals(b.boundingSphere)) ||
    a.groups.length !== b.groups.length ||
    Object.keys(a.attributes).length !== Object.keys(b.attributes).length
  )
    return false;
  if (
    !a.groups.every(
      (g, i) =>
        g.start === b.groups[i].start &&
        g.count === b.groups[i].count &&
        g.materialIndex === b.groups[i].materialIndex,
    )
  )
    return false;
  return Object.entries(a.attributes).every(([name, attr]) => {
    const other = b.getAttribute(name);
    return (
      other instanceof T.BufferAttribute &&
      attr instanceof T.BufferAttribute &&
      other.constructor === attr.constructor &&
      other.array === attr.array &&
      other.itemSize === attr.itemSize &&
      other.normalized === attr.normalized &&
      other.gpuType === attr.gpuType
    );
  });
}

/** Isolate Three's upload/dispose events from each bike's private construction
 * geometry. A rigid template owns its GPU buffers and borrows immutable CPU data. */
function rigidTemplate(source: T.BufferGeometry) {
  const copy = source.clone();
  for (const [name, attr] of Object.entries(source.attributes))
    (copy.getAttribute(name) as T.BufferAttribute).array = attr.array;
  if (copy.index && source.index) copy.index.array = source.index.array;
  return { geometry: copy, owners: 0 };
}

/** A field contains multiple copies of the same two motorcycle designs. Keep
 * immutable vertex data once per design and detail. Each rider still owns its
 * suspension buffers, skinned geometry, skeleton and instance transforms. */
export class MxGeometryPool {
  private readonly designs = new Map<string, Map<string, WeakRef<VertexArray>>>();

  private readonly rigid = new Map<string, RigidTemplate>();
  private readonly bindings = new Map<T.Object3D, RigidBinding[]>();

  share(design: string, root: T.Object3D) {
    if (this.bindings.has(root)) return;
    const owned: RigidBinding[] = [];
    this.bindings.set(root, owned);
    const slots = this.designs.get(design) ?? new Map<string, WeakRef<VertexArray>>();
    this.designs.set(design, slots);
    const visited = new Map<T.BufferGeometry, RigidBinding | undefined>();
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
      if (!(object instanceof T.Mesh)) return;
      const g = object.geometry as T.BufferGeometry;
      if (visited.has(g)) {
        const binding = visited.get(g);
        if (binding) {
          object.geometry = binding.template.geometry;
          binding.meshes.push(object);
        }
        return;
      }
      const prefix = visited.size + '/';
      visited.set(g, undefined);
      if (g.index) shareAttribute(prefix + 'index', g.index);
      for (const [name, attr] of Object.entries(g.attributes)) shareAttribute(prefix + name, attr);
      for (const [name, targets] of Object.entries(g.morphAttributes))
        targets.forEach((attr, i) => shareAttribute(prefix + name + '/morph/' + i, attr));
      if (!rigidAttributes(g)) return;
      const key = design + '/' + prefix;
      let template = this.rigid.get(key);
      if (!template) {
        template = rigidTemplate(g);
        this.rigid.set(key, template);
      } else if (!sameRigidMesh(g, template.geometry)) return;
      template.owners++;
      const binding = { key, original: g, template, meshes: [object] };
      object.geometry = template.geometry;
      visited.set(g, binding);
      owned.push(binding);
    });
  }

  /** Restore private geometry before the model, its rider and its mounted gear
   * dispose themselves. Other entrants keep their live GPU buffers. */
  release(root: T.Object3D) {
    const owned = this.bindings.get(root);
    if (!owned) return;
    this.bindings.delete(root);
    for (const { meshes, original, template, key } of owned) {
      for (const mesh of meshes) mesh.geometry = original;
      if (--template.owners === 0) {
        template.geometry.dispose();
        this.rigid.delete(key);
      }
    }
  }

  clear() {
    for (const root of this.bindings.keys()) this.release(root);
    this.designs.clear();
  }
}
