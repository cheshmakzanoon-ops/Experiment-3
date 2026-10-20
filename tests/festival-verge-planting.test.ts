import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { foliageTile } from '../src/rendering/landscape.ts';
import { festivalMeadowPlan } from '../src/rendering/open-world/festival-meadow.ts';
import { HorizonDressing } from '../src/rendering/open-world/horizon-dressing.ts';
import { Vegetation } from '../src/rendering/open-world/vegetation.ts';
import { TREE_SPECIES } from '../src/simulation/open-world/placement.ts';
import { carvedGroundHeight } from '../src/simulation/open-world/ground-height.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { trackPoint } from '../src/simulation/track.ts';
import type { TileMeshData } from '../src/workers/open-world-protocol.ts';

// Only replace the DOM canvas factory. The crown geometry, atlas selector,
// instance transforms and production terrain/road queries remain real.
vi.mock('../src/rendering/landscape.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/rendering/landscape.ts')>()),
  foliageAtlas: () => new T.DataTexture(new Uint8Array([60, 82, 41, 255]), 1, 1),
}));

const world = openWorld(),
  circuit = world.network.edges.filter((edge) => edge.roadClass === 'circuit'),
  plan = festivalMeadowPlan(world, [], circuit);

describe('Festival maintained verge and seedhead planting', () => {
  it('restores the bounded near meadow when a loaded photo-grass scene switches to Low', () => {
    const mesh = new T.InstancedMesh(new T.PlaneGeometry(), new T.MeshBasicMaterial(), 100),
      camera = new T.PerspectiveCamera();
    mesh.userData.fullCount = 100;
    const fixture = {
      windTime: { value: 0 },
      lanternTime: { value: 0 },
      materials: { sign: { emissiveIntensity: 0 }, bulb: { emissiveIntensity: 0 } },
      lanterns: null,
      eye: new T.Vector3(),
      staticMeshes: [],
      meadowRange: { value: 0 },
      meadow: new T.Group(),
      meadowChunks: [{ mesh, center: new T.Vector3(), radius: 10 }],
      photoGrass: { update: vi.fn(), root: new T.Group() },
      photoPocket: null,
    };
    try {
      HorizonDressing.prototype.update.call(
        fixture as unknown as HorizonDressing,
        1,
        0,
        camera,
        'high',
      );
      expect(fixture.photoGrass.root.visible).toBe(true);
      expect(fixture.meadow.visible).toBe(false);
      HorizonDressing.prototype.update.call(
        fixture as unknown as HorizonDressing,
        2,
        0,
        camera,
        'low',
      );
      expect(fixture.photoGrass.root.visible).toBe(false);
      expect(fixture.meadow.visible).toBe(true);
      expect(mesh.visible).toBe(true);
      expect(mesh.count).toBeLessThan(40);
      camera.position.set(1000, 0, 1000);
      HorizonDressing.prototype.update.call(
        fixture as unknown as HorizonDressing,
        3,
        0,
        camera,
        'low',
      );
      expect(mesh.visible).toBe(false);
    } finally {
      mesh.geometry.dispose();
      (mesh.material as T.Material).dispose();
      mesh.dispose();
    }
  });

  it('roots dense broken bands on the real Saltmarsh surface and keeps entire clumps outside every shoulder', () => {
    expect(plan.length).toBeGreaterThan(6000);
    expect(plan.length).toBeLessThan(13000);
    const q = trackPoint();
    let short = 0,
      tall = 0;
    for (const clump of plan) {
      const distance = Math.abs(world.network.nearest(clump.x, clump.z, q)),
        edge = world.network.edges[world.network.edgeOf[world.network.lastSegment]];
      expect(
        distance - edge.spec.halfWidth - edge.spec.shoulder - clump.width * 0.55,
      ).toBeGreaterThanOrEqual(0.8 - 1e-6);
      if (clump.height < 0.5) short++;
      if (clump.height > 0.7) tall++;
    }
    expect(short).toBeGreaterThan(2000);
    expect(tall).toBeGreaterThan(2000);
    for (let i = 0; i < plan.length; i += 193) {
      const clump = plan[i];
      expect(clump.y + 0.045).toBeCloseTo(carvedGroundHeight(world.carver, clump.x, clump.z), 6);
    }
  });

  it('remains deterministic and removes roots inside an occupied roadside footprint', () => {
    expect(festivalMeadowPlan(world, [], circuit)).toEqual(plan);
    const centre = plan[Math.floor(plan.length / 2)],
      building = {
        kind: 'house' as const,
        x: centre.x,
        z: centre.z,
        heading: 0,
        hx: 12,
        hz: 12,
        height: 4,
        base: centre.y,
        floors: 1,
        style: 7,
      },
      cleared = festivalMeadowPlan(world, [building], circuit);
    expect(cleared.length).toBeLessThan(plan.length);
    for (const clump of cleared)
      expect(Math.abs(clump.x - centre.x) > 12.4 || Math.abs(clump.z - centre.z) > 12.4).toBe(true);
  });
});

function treeData(): TileMeshData {
  return {
    type: 'tile',
    id: 1,
    heights: new Float32Array(),
    normals: new Float32Array(),
    splat: new Float32Array(),
    shade: new Float32Array(),
    minY: 20,
    maxY: 20,
    ms: 0,
    trees: new Float32Array([
      10,
      0,
      12,
      TREE_SPECIES.BROADLEAF,
      0.4,
      0,
      20,
      30,
      0,
      12,
      TREE_SPECIES.BROADLEAF,
      1.2,
      0.95,
      20,
      50,
      0,
      16,
      TREE_SPECIES.CONIFER,
      0.7,
      0.5,
      20,
      70,
      0,
      2,
      TREE_SPECIES.SHRUB,
      0.2,
      0.5,
      20,
    ]),
  };
}

describe('Festival fallback tree species and rooting', () => {
  it('selects broadleaf atlas crowns for broadleaf placements at both LODs and preserves bark/collider scale', () => {
    const vegetation = new Vegetation(),
      matrix = new T.Matrix4(),
      position = new T.Vector3(),
      scale = new T.Vector3(),
      rotation = new T.Quaternion();
    try {
      for (const level of [0, 1]) {
        vegetation.sync(new Map([[level + 1, { data: treeData(), level }]]));
        let broadleaf = 0,
          conifer = 0;
        vegetation.root.traverse((node) => {
          if (!(node instanceof T.InstancedMesh)) return;
          const material = node.material as T.MeshStandardMaterial;
          for (let i = 0; i < node.count; i++) {
            node.getMatrixAt(i, matrix);
            matrix.decompose(position, rotation, scale);
            if (material.map && position.x < 40) {
              expect(foliageTile(scale.x / scale.y)).not.toBe(1);
              expect(node.customDepthMaterial).toBeDefined();
              broadleaf++;
            } else if (material.map && position.x === 50) {
              expect(foliageTile(scale.x / scale.y)).toBe(1);
              conifer++;
            } else if (!material.map && position.x < 40) {
              expect(scale.x).toBeCloseTo(12 * 0.62, 5);
              expect(position.y).toBeCloseTo(20 - 0.15, 5);
            }
          }
        });
        expect(broadleaf).toBe(2);
        expect(conifer).toBe(1);
      }
    } finally {
      vegetation.dispose();
    }
  });

  it('uses a porous rooted shrub crown instead of a solid polyhedron and releases tile instances', () => {
    const vegetation = new Vegetation(),
      matrix = new T.Matrix4();
    try {
      vegetation.sync(new Map([[1, { data: treeData(), level: 0 }]]));
      const shrub = vegetation.root.children[0].children.find((node) => {
        if (!(node instanceof T.InstancedMesh)) return false;
        node.getMatrixAt(0, matrix);
        return matrix.elements[12] === 70;
      }) as T.InstancedMesh;
      expect(shrub).toBeDefined();
      expect((shrub.material as T.MeshStandardMaterial).alphaTest).toBeGreaterThan(0);
      expect(shrub.geometry.getAttribute('cardCentre').array.every((value) => value === 0)).toBe(
        true,
      );
      shrub.geometry.computeBoundingBox();
      shrub.getMatrixAt(0, matrix);
      expect(
        shrub.geometry.boundingBox!.min.y * matrix.elements[5] + matrix.elements[13],
      ).toBeCloseTo(20 - 0.045, 5);
      vegetation.sync(new Map());
      expect(vegetation.stats).toEqual({ tiles: 0, instances: 0 });
    } finally {
      vegetation.dispose();
    }
  });
});
