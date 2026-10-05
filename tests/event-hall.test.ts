import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as T from 'three';
import source from '../src/rendering/event-hall.geometry.json' with { type: 'json' };
import manifest from '../src/rendering/event-hall.manifest.json' with { type: 'json' };
import {
  decodeEventHall,
  eventHallGeometry,
  eventHallShell,
  eventHallTier,
  HALL_MESHES,
} from '../src/rendering/event-hall-assets.ts';
import { buildVenueLandmark, LANDMARK, landmarkSitePlan } from '../src/rendering/venue-landmark.ts';
import { Track } from '../src/simulation/track.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
function changed(change: (value: typeof source) => void) {
  const value = structuredClone(source);
  change(value);
  return value;
}
const dims = { SCALAR: 1, VEC2: 2, VEC3: 3 };
interface Accessor {
  bufferView: number;
  byteOffset?: number;
  count: number;
  componentType: 5123 | 5125 | 5126;
  type: keyof typeof dims;
}
interface Glb {
  nodes: { name: string; mesh: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[];
  accessors: Accessor[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
  buffers: { uri?: string }[];
  images?: unknown[];
  materials: unknown[];
}
describe('A71 authored geometry and source integrity', () => {
  it('matches native, author, GLB and runtime identities with no hidden regeneration', () => {
    for (const [path, hash] of [
      [manifest.source, manifest.sourceSHA256],
      [manifest.editable, manifest.editableSHA256],
      [manifest.exchange, manifest.exchangeSHA256],
      ['src/rendering/event-hall.geometry.json', manifest.runtimeSHA256],
    ])
      expect(sha(readFileSync(path))).toBe(hash);
    expect(readFileSync(manifest.editable).length).toBeGreaterThan(100000);
    expect(manifest.finalArtApproved).toBe(false);
  });
  it('bundles exact GLB accessors including normals, UVs and all three index tiers', () => {
    const raw = readFileSync(manifest.exchange);
    expect(raw.length).toBe(manifest.exchangeBytes);
    expect(raw.readUInt32LE(0)).toBe(0x46546c67);
    expect(raw.readUInt32LE(4)).toBe(2);
    expect(raw.readUInt32LE(8)).toBe(raw.length);
    const size = raw.readUInt32LE(12);
    expect(raw.readUInt32LE(16)).toBe(0x4e4f534a);
    const doc: Glb = JSON.parse(raw.subarray(20, 20 + size).toString());
    expect(raw.readUInt32LE(24 + size)).toBe(0x004e4942);
    const binary = raw.subarray(28 + size);
    expect(doc.buffers.every((b) => !b.uri)).toBe(true);
    expect(doc.images ?? []).toEqual([]);
    expect(doc.materials.length).toBe(5);
    for (const name of HALL_MESHES) {
      const node = doc.nodes.find((n) => n.name === `A71_${name}`)!;
      const primitives = doc.meshes[node.mesh].primitives;
      expect(primitives).toHaveLength(1);
      const primitive = primitives[0];
      for (const [attribute, semantic] of [
        ['position', 'POSITION'],
        ['normal', 'NORMAL'],
        ['uv', 'TEXCOORD_0'],
        ['index', 'index'],
      ] as const) {
        const a =
          doc.accessors[semantic === 'index' ? primitive.indices : primitive.attributes[semantic]];
        const view = doc.bufferViews[a.bufferView];
        const bytes = dims[a.type] * (a.componentType === 5123 ? 2 : 4);
        const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
        const result = Buffer.concat(
          Array.from({ length: a.count }, (_, i) =>
            binary.subarray(
              offset + i * (view.byteStride ?? bytes),
              offset + i * (view.byteStride ?? bytes) + bytes,
            ),
          ),
        );
        const encoded = source.meshes[name][attribute];
        expect(result.equals(Buffer.from(encoded.data, 'base64'))).toBe(true);
        expect(a.count).toBe(encoded.count);
        expect(a.componentType).toBe(encoded.componentType);
      }
    }
  });
  for (const [label, value] of [
    ['null root', null],
    ['wrong units', { ...source, units: 'centimetres' }],
    [
      'missing shell',
      changed((s) => {
        delete (s.meshes as Partial<typeof s.meshes>).shell_far;
      }),
    ],
    [
      'truncated accessor',
      changed((s) => {
        s.meshes.canopy.position.data = s.meshes.canopy.position.data.slice(0, -4);
      }),
    ],
    [
      'invalid alphabet',
      changed((s) => {
        s.meshes.canopy.position.data = '!' + s.meshes.canopy.position.data.slice(1);
      }),
    ],
    [
      'oversized count',
      changed((s) => {
        s.meshes.canopy.position.count = 2 ** 30;
      }),
    ],
    [
      'wrong element type',
      changed((s) => {
        s.meshes.column.position.componentType = 5125;
      }),
    ],
    [
      'wrong normal dimension',
      changed((s) => {
        s.meshes.column.normal.itemSize = 2;
      }),
    ],
    [
      'nonfinite position',
      changed((s) => {
        const b = Buffer.from(s.meshes.column.position.data, 'base64');
        b.writeFloatLE(NaN, 0);
        s.meshes.column.position.data = b.toString('base64');
      }),
    ],
    [
      'invalid normal',
      changed((s) => {
        const b = Buffer.from(s.meshes.column.normal.data, 'base64');
        b.writeFloatLE(9, 0);
        s.meshes.column.normal.data = b.toString('base64');
      }),
    ],
    [
      'out of range index',
      changed((s) => {
        const b = Buffer.from(s.meshes.column.index.data, 'base64');
        b.writeUInt16LE(65535, 0);
        s.meshes.column.index.data = b.toString('base64');
      }),
    ],
  ] as const)
    it(`rejects ${label}`, () => expect(() => decodeEventHall(value)).toThrow());
  it('owns fresh buffers per scene while retaining the entire allocation budget', () => {
    let total = 0;
    for (const name of HALL_MESHES) {
      const a = eventHallGeometry(name),
        b = eventHallGeometry(name);
      expect(a.index?.array).not.toBe(b.index?.array);
      expect(a.getAttribute('position').array).not.toBe(b.getAttribute('position').array);
      expect(a.index?.count).toBe(manifest.triangles[name] * 3);
      total += manifest.triangles[name] * (name === 'column' ? 24 : name === 'bollard' ? 20 : 1);
      a.dispose();
      b.dispose();
    }
    expect(total).toBe(manifest.allocatedTrianglesWithInstances);
    expect(total).toBeLessThan(7000);
  });
});
describe('A71 architecture and projected detail', () => {
  it('retains every shell boundary while reducing detail, not hiding the landmark', () => {
    const shell = eventHallShell(),
      index = shell.geometry.index!,
      positions = shell.geometry.getAttribute('position');
    const oldIndex = index.array,
      oldPosition = positions.array;
    for (const tier of [0, 1, 2] as const) {
      shell.select(tier);
      const range = shell.geometry.drawRange;
      expect(range).toEqual(shell.ranges[tier]);
      let bottom = Infinity,
        top = -Infinity;
      for (let i = range.start; i < range.start + range.count; i++) {
        const y = positions.getY(index.getX(i));
        bottom = Math.min(bottom, y);
        top = Math.max(top, y);
      }
      expect(bottom + LANDMARK.centreHeight).toBeCloseTo(4.4, 4);
      expect(top + LANDMARK.centreHeight).toBeCloseTo(38, 4);
      expect(index.array).toBe(oldIndex);
      expect(positions.array).toBe(oldPosition);
    }
    expect(shell.ranges.map((r) => r.count / 3)).toEqual([3008, 736, 240]);
    expect(() => shell.select(3 as 0)).toThrow();
    shell.geometry.dispose();
  });
  it('holds detail through hysteresis but resolves large camera jumps immediately', () => {
    expect(eventHallTier(170)).toBe(0);
    expect(eventHallTier(190, 0)).toBe(0);
    expect(eventHallTier(200, 0)).toBe(1);
    expect(eventHallTier(170, 1)).toBe(1);
    expect(eventHallTier(160, 1)).toBe(0);
    expect(eventHallTier(390, 1)).toBe(1);
    expect(eventHallTier(500, 0)).toBe(2);
    expect(eventHallTier(20, 2)).toBe(0);
    for (const v of [-1, NaN, Infinity]) expect(() => eventHallTier(v)).toThrow();
  });
  it('uses real perspective, cube and shadow cameras without leaking pass selection', () => {
    const shell = eventHallShell(),
      mesh = new T.Mesh(shell.geometry, new T.MeshStandardMaterial());
    shell.bind(mesh);
    mesh.updateMatrixWorld(true);
    const renderer = {
      getCurrentViewport: (out: T.Vector4) => out.set(0, 0, 1280, 720),
      getDrawingBufferSize: (out: T.Vector2) => out.set(1280, 720),
    } as T.WebGLRenderer;
    const scene = new T.Scene(),
      camera = new T.PerspectiveCamera(58, 16 / 9, 0.1, 2000);
    camera.position.z = 500;
    camera.updateMatrixWorld(true);
    const observe = (cam: T.Camera, shadow = false) => {
      if (shadow)
        mesh.onBeforeShadow(
          renderer,
          scene,
          camera,
          cam,
          mesh.geometry,
          mesh.material,
          new T.Group(),
        );
      else mesh.onBeforeRender(renderer, scene, cam, mesh.geometry, mesh.material, new T.Group());
      const range = { ...mesh.geometry.drawRange };
      if (shadow)
        mesh.onAfterShadow(
          renderer,
          scene,
          camera,
          cam,
          mesh.geometry,
          mesh.material,
          new T.Group(),
        );
      else mesh.onAfterRender(renderer, scene, cam, mesh.geometry, mesh.material, new T.Group());
      expect(mesh.geometry.drawRange).toEqual(shell.ranges[0]);
      return range;
    };
    expect(observe(camera)).toEqual(shell.ranges[2]);
    const zoom = camera.clone();
    zoom.fov = 10;
    zoom.updateProjectionMatrix();
    zoom.updateMatrixWorld(true);
    expect(observe(zoom)).toEqual(shell.ranges[0]);
    const shadow = new T.OrthographicCamera(-38, 38, 38, -38, 0.1, 2000);
    shadow.updateMatrixWorld(true);
    expect(observe(shadow, true)).toEqual(shell.ranges[0]);
    shadow.left = -800;
    shadow.right = 800;
    shadow.top = 800;
    shadow.bottom = -800;
    shadow.updateProjectionMatrix();
    expect(observe(shadow, true)).toEqual(shell.ranges[2]);
    const target = new T.WebGLCubeRenderTarget(16),
      cube = new T.CubeCamera(0.1, 1000, target);
    cube.position.z = 500;
    cube.updateMatrixWorld(true);
    for (const c of cube.children) expect(() => observe(c as T.Camera)).not.toThrow();
    expect(observe(camera)).toEqual(shell.ranges[2]);
    target.dispose();
    shell.geometry.dispose();
    mesh.material.dispose();
  });
  it('keeps four recessed glazed bays, continuous canopy skin and sloped approaches', () => {
    const facade = eventHallGeometry('facade'),
      canopy = eventHallGeometry('canopy'),
      plinth = eventHallGeometry('plinth');
    const p = facade.getAttribute('position');
    const radii = [];
    for (let i = 0; i < p.count; i++) radii.push(Math.hypot(p.getX(i), p.getZ(i)));
    expect(Math.min(...radii)).toBeCloseTo(16.35, 4);
    expect(Math.max(...radii)).toBeCloseTo(16.8, 4);
    expect(canopy.boundingBox!.max.z).toBeCloseTo(20.4, 4);
    expect(plinth.boundingBox!.max.z).toBeCloseTo(22.5, 4);
    expect(plinth.boundingBox!.max.y).toBeCloseTo(0.18, 5);
    facade.dispose();
    canopy.dispose();
    plinth.dispose();
  });
  it('keeps plaza furniture clear of the cardinal approach corridors', () => {
    const hall = buildVenueLandmark(new Track());
    const bollards = hall.structure.getObjectByName('Plaza boundary bollards') as T.InstancedMesh;
    const m = new T.Matrix4();
    for (let i = 0; i < bollards.count; i++) {
      bollards.getMatrixAt(i, m);
      const x = m.elements[12],
        z = m.elements[14];
      expect(Math.min(Math.abs(x), Math.abs(z)) - 0.15).toBeGreaterThan(1.8);
    }
    const group = new T.Group();
    group.add(hall.structure, hall.display);
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    group.traverse((o) => {
      if (o instanceof T.Mesh) {
        geometries.add(o.geometry);
        materials.add(o.material as T.Material);
      }
      if (o instanceof T.InstancedMesh) o.dispose();
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  });
  it('does not replace Vellamar with an Aurel event hall', () => {
    const track = new Track('clear', false, undefined, circuitDefinition('vellamar'));
    const hall = buildVenueLandmark(track);
    expect(hall.site).toEqual(landmarkSitePlan(track));
    expect(hall.structure.userData.authoredAsset).toBeUndefined();
    expect(hall.display.name.toLowerCase()).toContain('lighthouse');
  });
});
