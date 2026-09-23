import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as T from 'three';
import {
  HeroShells,
  HERO_PARTS,
  validateHeroDocument,
  bakeHeroGeometry,
} from '../src/rendering/hero-shells.ts';
import {
  mountAuthoredWheel,
  mountAuthoredWing,
  uprightSocketX,
} from '../src/rendering/car-assembly.ts';
import { TireCarcass } from '../src/rendering/tire-carcass.ts';
import {
  FRONT_SPACERS,
  FRONT_SURFACES,
  wingSurfacePoint,
  ENGINE_FIN,
} from '../src/rendering/car-architecture.ts';
import { bodySurface, ENGINE_SECTIONS } from '../src/rendering/car-surfaces.ts';
import contract from '../src/rendering/apx01-assembly.json';
import manifest from '../src/rendering/apx01-shell.manifest.json';
const bytes = new Uint8Array(
  readFileSync(new URL('../src/rendering/apx01-shell.glb.gz', import.meta.url)),
);
const raw = gunzipSync(bytes);
const document = () => JSON.parse(raw.subarray(20, 20 + raw.readUInt32LE(12)).toString());
let hero: HeroShells;
beforeAll(async () => {
  hero = await HeroShells.decode(bytes);
});
afterAll(() => hero?.dispose());

// This is geometry/component evidence, not a substitute for a rendered game lap.
describe('27H.1 complete native mechanical assembly', () => {
  it('contains every bounded material role and finite, unit-normal, indexed geometry', () => {
    expect(HERO_PARTS).toHaveLength(41);
    expect(hero.diagnostics()).toMatchObject({
      revision: contract.revision,
      partCount: 41,
      materialBindings: contract.parts,
      finalArtApproved: false,
    });
    expect(manifest.parts.slice().sort()).toEqual(HERO_PARTS.slice().sort());
    expect(manifest.bytes).toBeLessThanOrEqual(contract.maxRawBytes);
    expect(bytes.length).toBe(manifest.compressedBytes);
    let triangles = 0;
    for (const role of HERO_PARTS) {
      const geometry = hero.copy(role),
        positions = geometry.getAttribute('position'),
        normals = geometry.getAttribute('normal');
      triangles += geometry.index!.count / 3;
      expect(positions.count, role).toBeLessThanOrEqual(contract.maxVerticesPerPart);
      expect(geometry.index!.count, role).toBeLessThanOrEqual(contract.maxIndicesPerPart);
      for (let i = 0; i < positions.count; i++) {
        expect(
          Number.isFinite(positions.getX(i) + positions.getY(i) + positions.getZ(i)),
          role,
        ).toBe(true);
        expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)), role).toBeCloseTo(
          1,
          5,
        );
      }
      geometry.dispose();
    }
    expect(triangles).toBe(Object.values(manifest.triangles).reduce((a, b) => a + b, 0));
    expect(triangles).toBeLessThanOrEqual(contract.maxTriangles);
  });
  it('accepts only the static checked-in role/material scene contract', () => {
    expect(() => validateHeroDocument(document())).not.toThrow();
  });
  it.each([
    'image',
    'external-buffer',
    'animation',
    'skin',
    'camera',
    'duplicate-role',
    'unknown-role',
    'wrong-material',
    'mesh-reuse',
    'missing-root',
    'invalid-primitive',
    'unknown-extension',
    'sparse',
    'vertex-budget',
    'view-overrun',
  ])('rejects %s before GLTFLoader', (defect) => {
    const j = document();
    switch (defect) {
      case 'image':
        j.images = [{ uri: 'external.png' }];
        break;
      case 'external-buffer':
        j.buffers[0].uri = 'external.bin';
        break;
      case 'animation':
        j.animations = [{}];
        break;
      case 'skin':
        j.skins = [{}];
        break;
      case 'camera':
        j.nodes[0].camera = 0;
        break;
      case 'duplicate-role':
        j.nodes[1].extras = j.nodes[0].extras;
        break;
      case 'unknown-role':
        j.nodes[0].extras.apex_role = 'arbitrary';
        break;
      case 'wrong-material':
        j.materials[0].name = 'unbound';
        break;
      case 'mesh-reuse':
        j.nodes[1].mesh = j.nodes[0].mesh;
        break;
      case 'missing-root':
        j.scenes[0].nodes.pop();
        break;
      case 'invalid-primitive':
        j.meshes[0].primitives[0].mode = 1;
        break;
      case 'unknown-extension':
        j.extensionsUsed.push('EXT_unbounded');
        break;
      case 'sparse':
        j.accessors[j.meshes[0].primitives[0].attributes.POSITION].sparse = {};
        break;
      case 'vertex-budget':
        j.accessors[j.meshes[0].primitives[0].attributes.POSITION].count = 32769;
        break;
      case 'view-overrun':
        j.bufferViews[0].byteLength = j.buffers[0].byteLength + 1;
        break;
    }
    expect(() => validateHeroDocument(j)).toThrow();
  });
  it.each(['front_rim', 'rear_rim', 'front_duct', 'rear_upright', 'front_hat'] as const)(
    'reflects %s without reversing scoops, normals or culling',
    (role) => {
      const right = hero.copy(role),
        left = hero.copy(role, -1);
      const rp = right.getAttribute('position'),
        lp = left.getAttribute('position'),
        rn = right.getAttribute('normal'),
        ln = left.getAttribute('normal');
      for (let i = 0; i < rp.count; i += 17) {
        expect(lp.getX(i)).toBeCloseTo(-rp.getX(i), 7);
        expect(lp.getZ(i)).toBe(rp.getZ(i));
        expect(ln.getX(i)).toBeCloseTo(-rn.getX(i), 7);
        expect(ln.getZ(i)).toBe(rn.getZ(i));
      }
      for (let i = 0; i < right.index!.count; i += 3) {
        expect(left.index!.getX(i)).toBe(right.index!.getX(i));
        expect(left.index!.getX(i + 1)).toBe(right.index!.getX(i + 2));
        expect(left.index!.getX(i + 2)).toBe(right.index!.getX(i + 1));
      }
      right.dispose();
      left.dispose();
    },
  );
  it('keeps the entire front aero envelope outside the steered tyre sweep', () => {
    // Deliberately conservative: 350 mm crown includes load bulge. The actual
    // 380 mrad lock is sampled continuously, rather than testing only straight.
    let tyreFront = -Infinity;
    for (let steer = -0.38; steer <= 0.38001; steer += 0.002)
      tyreFront = Math.max(
        tyreFront,
        1.82 + 0.35 * Math.cos(steer) + 0.17 * Math.abs(Math.sin(steer)),
      );
    for (const role of ['front_paint', 'front_carbon', 'front_alloy'] as const) {
      const g = hero.copy(role),
        p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++)
        if (Math.abs(p.getX(i)) > 0.46)
          expect(p.getZ(i), `${role} vertex ${i}`).toBeGreaterThan(tyreFront + 0.009);
      g.dispose();
    }
  });
  it('seats each cascade spacer in its two evaluated airfoil surfaces', () => {
    FRONT_SPACERS.forEach((outline, i) => {
      const low = wingSurfacePoint(FRONT_SURFACES[i], 0.73, 0.6, 1),
        high = wingSurfacePoint(FRONT_SURFACES[i + 1], 0.73, 0.28, -1);
      expect((outline[0][0] + outline[1][0]) / 2).toBeCloseTo(low[0], 8);
      expect(outline[0][1]).toBeCloseTo(low[1] - 0.001, 8);
      expect(outline[2][1]).toBeCloseTo(high[1] + 0.001, 8);
    });
  });
  it('seats every dorsal lower-edge station inside the actual engine skin', () => {
    for (const [z, y] of ENGINE_FIN.slice(5))
      expect(y).toBeCloseTo(bodySurface(ENGINE_SECTIONS, z, 0.5, 0, 0.18).y - 0.004, 8);
  });
  it.each(['front', 'rear'] as const)(
    'leaves a genuine open %s brake-duct throat and a solid lip',
    (end) => {
      const g = hero.copy(`${end}_duct`),
        material = new T.MeshBasicMaterial({ side: T.DoubleSide }),
        object = new T.Mesh(g, material);
      object.updateMatrixWorld();
      const x = uprightSocketX(end === 'front', 1) - 0.021;
      const ray = new T.Raycaster(new T.Vector3(x, 0.017, 0.25), new T.Vector3(0, 0, -1), 0, 0.034);
      expect(ray.intersectObject(object)).toHaveLength(0);
      ray.ray.origin.x += 0.027;
      expect(ray.intersectObject(object).length).toBeGreaterThan(0);
      g.dispose();
      material.dispose();
    },
  );
  it('preserves the rotor central bore and actual perforations', () => {
    const g = hero.copy('brake_rotor'),
      mat = new T.MeshBasicMaterial({ side: T.DoubleSide }),
      object = new T.Mesh(g, mat);
    object.updateMatrixWorld();
    const ray = new T.Raycaster(new T.Vector3(1, 0, 0), new T.Vector3(-1, 0, 0));
    expect(ray.intersectObject(object)).toHaveLength(0);
    // One of the engineered circular ventilation holes, not a dark decal.
    ray.ray.origin.z = -0.15;
    expect(ray.intersectObject(object)).toHaveLength(0);
    ray.ray.origin.z = -0.14;
    expect(ray.intersectObject(object).length).toBeGreaterThan(0);
    g.dispose();
    mat.dispose();
  });
  it('keeps carrier hardware out of the removable wheel and groups aero under damage pivots', () => {
    const carrier = new T.Group(),
      spin = new T.Group(),
      front = new T.Group(),
      rear = new T.Group();
    const materials = {
      paint: new T.MeshPhysicalMaterial(),
      carbon: new T.MeshStandardMaterial(),
      metal: new T.MeshStandardMaterial(),
      dark: new T.MeshStandardMaterial(),
    };
    mountAuthoredWheel(carrier, spin, hero, 'front', -1, materials);
    mountAuthoredWing(front, hero, 'front', materials);
    mountAuthoredWing(rear, hero, 'rear', materials);
    expect(spin.children.map((c) => c.name)).toEqual([
      'APX front_rim -1',
      'APX front_cover -1',
      'APX front_hub -1',
    ]);
    expect(carrier.children.map((c) => c.name)).toEqual([
      'APX front_duct -1',
      'APX front_upright -1',
      'APX front_caliper -1',
    ]);
    expect(front.children).toHaveLength(3);
    expect(rear.children).toHaveLength(3);
    const mesh = spin.children[0] as T.Mesh;
    expect(mesh.material).toBe(materials.metal);
    spin.position.x = -0.48;
    expect(carrier.position.x).toBe(0);
    for (const group of [carrier, spin, front, rear])
      group.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
    Object.values(materials).forEach((m) => m.dispose());
  });
  it.each([0, 0.17, 1.3, Math.PI, -5.1])(
    'deforms the authored sidewall and lettering without lifting the bead at phase %f',
    (phase) => {
      const rubber = hero.copy('tire_front'),
        a = new T.MeshStandardMaterial(),
        b = new T.MeshBasicMaterial();
      const original = Float32Array.from(rubber.getAttribute('position').array);
      const carcass = new TireCarcass(0.155, a, b, rubber);
      carcass.update(phase, 0.335, 7000, 155);
      const p = rubber.getAttribute('position'),
        n = rubber.getAttribute('normal');
      let lowest = Infinity;
      for (let i = 0; i < p.count; i++) {
        lowest = Math.min(lowest, p.getY(i) * Math.cos(phase) - p.getZ(i) * Math.sin(phase));
        expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
        if (Math.hypot(original[i * 3 + 1], original[i * 3 + 2]) < 0.24501) {
          expect(p.getX(i)).toBeCloseTo(original[i * 3], 5);
          expect(p.getY(i)).toBeCloseTo(original[i * 3 + 1], 5);
          expect(p.getZ(i)).toBeCloseTo(original[i * 3 + 2], 5);
        }
      }
      expect(lowest).toBeCloseTo(-0.335, 6);
      carcass.update(0.4, 0.258, 3000, 12, 0.5);
      const puncture = Float32Array.from(p.array);
      carcass.update(8, 0.335, 2000, 180);
      carcass.update(0.4, 0.258, 3000, 12, 0.5);
      expect(p.array).toEqual(puncture);
      carcass.root.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      a.dispose();
      b.dispose();
    },
  );
  it.each(['bad-index', 'zero-normal', 'negative-transform', 'mismatched-uv'])(
    'rejects %s during metre-space baking',
    (defect) => {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], 3));
      g.setAttribute('normal', new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
      g.setIndex([0, 1, 2]);
      const material = new T.MeshBasicMaterial(),
        mesh = new T.Mesh(g, material);
      if (defect === 'bad-index') g.setIndex([0, 1, 3]);
      if (defect === 'zero-normal') g.getAttribute('normal').setXYZ(0, 0, 0, 0);
      if (defect === 'negative-transform') mesh.scale.x = -1;
      if (defect === 'mismatched-uv')
        g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
      mesh.updateMatrixWorld();
      expect(() => bakeHeroGeometry(mesh)).toThrow();
      g.dispose();
      material.dispose();
    },
  );
});
