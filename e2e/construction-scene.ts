import * as T from 'three';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { Track } from '../src/simulation/track.ts';

function signature(scene: T.Group) {
  let hash = 2166136261,
    meshes = 0,
    vertices = 0,
    instances = 0;
  const fold = (buffer: ArrayBufferLike, offset: number, length: number) => {
    for (const byte of new Uint8Array(buffer, offset, length))
      hash = Math.imul(hash ^ byte, 16777619);
  };
  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    meshes++;
    for (const name of Object.keys(object.geometry.attributes).sort()) {
      const attribute = object.geometry.getAttribute(name) as T.BufferAttribute;
      fold(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength);
    }
    const index = object.geometry.getIndex();
    if (index) fold(index.array.buffer, index.array.byteOffset, index.array.byteLength);
    vertices += object.geometry.getAttribute('position').count;
    if (object instanceof T.InstancedMesh) {
      instances += object.count;
      fold(
        object.instanceMatrix.array.buffer,
        object.instanceMatrix.array.byteOffset,
        object.instanceMatrix.array.byteLength,
      );
    }
  });
  return { hash: hash >>> 0, meshes, vertices, instances };
}
export async function compareConstruction() {
  const track = new Track('clear', true);
  const synchronous = new CircuitScene(track);
  const expected = signature(synchronous.group);
  const progressive = new CircuitScene(track, true);
  const before = signature(progressive.group);
  const fraction: number[] = [];
  let turns = 0;
  await progressive.construction.run(
    (p) => fraction.push(p.fraction),
    () => false,
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      turns++;
    },
  );
  const actual = signature(progressive.group);
  // Geometry/texture allocations are disposed explicitly; this fixture does not
  // create a graphics context and makes no GPU-rendering claim.
  for (const circuit of [synchronous, progressive]) {
    const geometry = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    circuit.group.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      geometry.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof T.Texture) textures.add(value);
      }
    });
    geometry.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
    circuit.stateTexture.dispose();
  }
  return {
    before,
    expected,
    actual,
    turns,
    fraction,
    statistics: progressive.construction.statistics,
  };
}
