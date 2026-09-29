import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { A32JackPose, type PitJackFits } from '../src/rendering/a32-jack-pose.ts';
import {
  PIT_JACKS,
  JACK_PARTS,
  decodePitJacks,
  loadPitJacks,
  pitJackDocument,
  pitJackLod,
} from '../src/rendering/a32-pit-jacks.ts';
import { measurePitJackFits } from '../src/rendering/a32-jack-contact.ts';
import type { FormulaCar } from '../src/rendering/car.ts';
import { PitCrewView } from '../src/rendering/pit-crew.ts';
import { decodeWheelGuns } from '../src/rendering/wheel-gun.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { PIT_SERVICE_CENTER, PIT_SERVICE_HALF_EXTENTS } from '../src/rendering/pit-presentation.ts';

const bytes = () => new Uint8Array(readFileSync(`public/${PIT_JACKS.url}`));
const textureStub = () =>
  new GLTFLoader().register(() => ({
    name: 'A32_CPU_TEXTURE_STUB',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));
const decode = () => decodePitJacks(bytes(), textureStub());
const supplied: PitJackFits = {
  front: [0, -0.3559, 2.8],
  rear: [0, -0.313, -2.25],
  source: 'supplied-player',
};
const rival: PitJackFits = {
  front: [0, -0.216, 2.4],
  rear: [0, -0.278, -2.25],
  source: 'authored-rival',
};
const identity = new T.Matrix4();
function dispose(root: T.Object3D) {
  const gs = new Set<T.BufferGeometry>(),
    ms = new Set<T.Material>(),
    ts = new Set<T.Texture>();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    gs.add(o.geometry);
    if (o instanceof T.InstancedMesh) o.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      ms.add(m);
      for (const x of Object.values(m)) if (x instanceof T.Texture) ts.add(x);
    }
    if (o.customDepthMaterial) ms.add(o.customDepthMaterial);
    if (o.customDistanceMaterial) ms.add(o.customDistanceMaterial);
  });
  gs.forEach((x) => x.dispose());
  ms.forEach((x) => x.dispose());
  ts.forEach((x) => x.dispose());
}
function frame() {
  const f = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice' }).makeFrame(),
    o = carBase(0);
  f[o + F.PIT_PHASE] = 3;
  f[o + F.PIT_CLOCK] = 1.5;
  f[o + F.SPEED] = 0;
  f[o + F.JACK_HEIGHT] = 0.19;
  for (let wheel = 0; wheel < 4; wheel++) {
    f[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LOAD] = 0;
    f[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LENGTH] = 0.33;
  }
  return f;
}
function editDocument(from: string, to: string) {
  const b = bytes(),
    length = new DataView(b.buffer).getUint32(12, true);
  const text = new TextDecoder().decode(b.subarray(20, 20 + length));
  const changed = text.replaceAll(from, to.padEnd(from.length));
  expect(text).toContain(from);
  expect(changed.length).toBe(text.length);
  b.set(new TextEncoder().encode(changed), 20);
  return b;
}

describe('A32 authored mechanical handoff', () => {
  it('retains the editable source, original packed atlas and exact export identities', () => {
    expect(readFileSync(PIT_JACKS.editable).length).toBeGreaterThan(100000);
    expect(createHash('sha256').update(readFileSync(PIT_JACKS.author)).digest('hex')).toBe(
      PIT_JACKS.sourceSHA256,
    );
    expect(createHash('sha256').update(bytes()).digest('hex')).toBe(PIT_JACKS.sha256);
    const d = pitJackDocument(bytes());
    expect(d.nodes.filter((n) => n.name.startsWith('SOCKET_'))).toHaveLength(14);
    expect(d.meshes).toHaveLength(32);
    expect(d.images).toHaveLength(3);
    for (const role of ['front', 'rear'] as const) {
      const counts = Object.values(PIT_JACKS.triangles[role]);
      expect(counts[0]).toBeLessThan(24000);
      for (let i = 1; i < 4; i++) expect(counts[i]).toBeLessThan(counts[i - 1]);
    }
    expect(PIT_JACKS.bytes).toBeLessThan(8_000_000);
    expect(PIT_JACKS.bounds.rear.max[0]).toBeGreaterThan(PIT_JACKS.bounds.front.max[0] * 1.4);
    expect(PIT_JACKS.finalArtApproved).toBe(false);
  });
  it('rejects corruption, external images and lost pivots before resource decoding', async () => {
    expect(() => pitJackDocument(bytes().slice(0, -4))).toThrow('byte');
    const header = bytes();
    header[0] = 0;
    expect(() => pitJackDocument(header)).toThrow('header');
    const damaged = bytes();
    damaged[damaged.length - 60] ^= 1;
    await expect(decodePitJacks(damaged)).rejects.toThrow('integrity');
    expect(() =>
      pitJackDocument(editDocument('A32_FRONT_LEVER_PIVOT', 'A32_BROKEN_PIVOT')),
    ).toThrow('hierarchy');
    expect(() =>
      pitJackDocument(editDocument('"mimeType":"image/png"', '"uri":"remote.png"')),
    ).toThrow('self-contained');
  });
  it('loads the real part geometry with one shared PBR material and positive transforms', async () => {
    const j = await decode();
    try {
      expect(j.batches).toHaveLength(32);
      expect(new Set(j.batches.map((b) => b.material)).size).toBe(1);
      expect(new Set(j.batches.map((b) => b.geometry)).size).toBe(32);
      for (const b of j.batches) {
        expect(b.geometry.getAttribute('uv').count).toBe(b.geometry.getAttribute('position').count);
        expect(b.geometry.getAttribute('tangent').count).toBe(
          b.geometry.getAttribute('position').count,
        );
        expect(b.castShadow && b.receiveShadow).toBe(true);
      }
      expect(j.batches[0].geometry).not.toBe(j.batches[16].geometry);
    } finally {
      j.dispose();
    }
  });
  it('keeps car contact and both wheels exact while rigid levers raise and lower', () => {
    const pose = new A32JackPose();
    for (const fits of [supplied, rival])
      for (const role of ['front', 'rear'] as const)
        for (const height of [0, 0.025, 0.07, 0.12, 0.19, 0.22, 0.12, 0]) {
          const floor = -0.43 - height;
          pose.set(role, fits[role], floor);
          expect(pose.contact.distanceTo(new T.Vector3(...fits[role]))).toBeLessThan(1e-10);
          for (const p of pose.parts) expect(p.determinant()).toBeCloseTo(1, 10);
          for (const wheel of pose.wheels) expect(wheel.y).toBeCloseTo(floor, 10);
          const normal = new T.Vector3(0, 1, 0).transformDirection(pose.parts[2]);
          expect(normal.distanceTo(new T.Vector3(0, 1, 0))).toBeLessThan(1e-10);
          const spec = PIT_JACKS.kinematics[role];
          const joint = new T.Vector3(0, 0, spec.length).applyMatrix4(pose.parts[1]);
          expect(
            joint.distanceTo(new T.Vector3().setFromMatrixPosition(pose.parts[2])),
          ).toBeLessThan(1e-10);
          expect(pose.grips[0].distanceTo(pose.grips[1])).toBeCloseTo(spec.gripSpacing, 10);
        }
    expect(() => pose.set('front', [0, NaN, 2.8], -0.43)).toThrow('Invalid');
    expect(() => pose.set('rear', [0, 4, -2.2], -0.43)).toThrow('range');
  });
  it('uses the exported grip and contact sockets, not a separate diagnostic-only rig', async () => {
    const j = await decode(),
      pose = new A32JackPose();
    try {
      for (const role of ['front', 'rear'] as const) {
        const prefix = `A32_${role.toUpperCase()}`;
        pose.set(role, supplied[role], -0.62);
        const target = new T.Vector3(0, 0, PIT_JACKS.kinematics[role].length).applyMatrix4(
          pose.parts[1],
        );
        const actual = new T.Vector3(0, PIT_JACKS.kinematics[role].padTop, 0).applyMatrix4(
          pose.parts[2],
        );
        expect(actual.distanceTo(pose.contact)).toBeLessThan(1e-10);
        expect(
          target.distanceTo(new T.Vector3().setFromMatrixPosition(pose.parts[2])),
        ).toBeLessThan(1e-10);
        for (const [side, k] of [
          ['L', 0],
          ['R', 1],
        ] as const) {
          const socket = j.prototype.getObjectByName(`SOCKET_${prefix}_GRIP_${side}`)!;
          expect(
            socket.position.clone().applyMatrix4(pose.parts[1]).distanceTo(pose.grips[k]),
          ).toBeLessThan(1e-7);
        }
      }
    } finally {
      j.dispose();
    }
  });
  it('shares bounded instance buffers, rewinds exactly and does not upload held snapshots', async () => {
    const j = await decode(),
      pose = new A32JackPose(),
      camera = new T.Vector3();
    try {
      const fill = (height: number) => {
        j.begin();
        for (const role of ['front', 'rear'] as const)
          j.put(role, pose.set(role, supplied[role], -0.43 - height), identity);
        j.setView(camera);
      };
      fill(0.19);
      const initial = j.matrices.slice(),
        uploads = j.uploads;
      j.setView(camera);
      expect(j.uploads).toBe(uploads);
      expect(j.diagnostics().drawBatches).toBe(8);
      fill(0.04);
      expect(j.matrices).not.toEqual(initial);
      fill(0.19);
      expect(j.matrices).toEqual(initial);
      j.setView(new T.Vector3(0, 0, 24));
      expect(j.diagnostics().lodCounts.front[2]).toBe(1);
      j.setView(new T.Vector3(0, 0, 24), 8);
      expect(j.diagnostics().lodCounts.front[0]).toBe(1);
      j.begin();
      for (let i = 0; i < 24; i++) j.put(i % 2 ? 'front' : 'rear', pose, identity);
      expect(() => j.put('front', pose, identity)).toThrow('capacity');
      j.setView(camera);
      expect(j.diagnostics().instances).toBe(24);
      j.begin();
      j.setView(camera);
      expect(j.batches.every((b) => b.count === 0)).toBe(true);
      expect(() => j.put('front', pose, new T.Matrix4().makeScale(-1, 1, 1))).toThrow('Invalid');
    } finally {
      j.dispose();
    }
  });
  it('retains four lens-aware LODs with hysteresis and rejects invalid view inputs', () => {
    expect([0, 10, 25, 80].map((d) => pitJackLod(d))).toEqual([0, 1, 2, 3]);
    expect(pitJackLod(6.4, 0)).toBe(0);
    expect(pitJackLod(7, 0)).toBe(1);
    expect(pitJackLod(40, 3)).toBe(3);
    expect(pitJackLod(34, 3)).toBe(2);
    expect(() => pitJackLod(NaN)).toThrow();
    expect(() => pitJackLod(2, 0, 0)).toThrow();
  });
  it('preserves A31 and A33 in either tool installation order, with reachable jack hands', async () => {
    for (const reverse of [false, true]) {
      const crew = new PitCrewView(),
        j = await decode();
      const guns = await decodeWheelGuns(
        new Uint8Array(readFileSync('public/models/aurel-wheel-gun.glb')),
        textureStub(),
      );
      try {
        if (reverse) {
          crew.installPitJacks(j);
          crew.installWheelGuns(guns);
        } else {
          crew.installWheelGuns(guns);
          crew.installPitJacks(j);
        }
        const f = frame(),
          o = carBase(0),
          cam = new T.Vector3(f[o + F.X], f[o + F.Y], f[o + F.Z]);
        for (const fits of [supplied, rival])
          for (const h of [0, 0.025, 0.08, 0.19, 0.22, 0.08]) {
            crew.setPitJackFits(0, fits);
            f[o + F.JACK_HEIGHT] = h;
            crew.update(f, cam);
            const d = crew.diagnostics();
            expect(d.pitJacks?.instances).toBe(2);
            expect(d.wheelGuns?.instances).toBe(4);
            expect(d.actors).toBe(15);
            expect(crew.summary().unreachableArms).toBe(0);
            expect(crew.summary().maxGripError).toBeLessThan(1e-5);
            const original = f.slice(),
              uploads = j.uploads;
            crew.update(f, cam);
            expect(f).toEqual(original);
            expect(j.uploads).toBe(uploads);
          }
        expect(() => crew.installPitJacks(j)).toThrow('warmup');
      } finally {
        crew.dispose();
        dispose(crew.root);
      }
    }
  });
  it('keeps actual uploaded jack vertices within the conservative service camera envelope', async () => {
    const j = await decode(),
      pose = new A32JackPose(),
      point = new T.Vector3(),
      matrix = new T.Matrix4();
    try {
      for (const fits of [supplied, rival])
        for (const h of [0, 0.08, 0.19, 0.22]) {
          j.begin();
          for (const role of ['front', 'rear'] as const)
            j.put(role, pose.set(role, fits[role], -0.43 - h), identity);
          j.setView(new T.Vector3());
          for (const b of j.batches)
            for (let i = 0; i < b.count; i++) {
              b.getMatrixAt(i, matrix);
              const p = b.geometry.getAttribute('position');
              for (let v = 0; v < p.count; v++) {
                point.fromBufferAttribute(p, v).applyMatrix4(matrix).sub(PIT_SERVICE_CENTER);
                expect(Math.abs(point.x)).toBeLessThan(PIT_SERVICE_HALF_EXTENTS.x);
                expect(Math.abs(point.y)).toBeLessThan(PIT_SERVICE_HALF_EXTENTS.y);
                expect(Math.abs(point.z)).toBeLessThan(PIT_SERVICE_HALF_EXTENTS.z);
              }
            }
        }
    } finally {
      j.dispose();
    }
  });
  it('measures the retained supplied-player and authored-rival surfaces without modifying either', async () => {
    for (const suppliedPlayer of [false, true]) {
      const path = suppliedPlayer
        ? 'public/models/supplied-player.glb.gz'
        : 'src/rendering/apx01-shell.glb.gz';
      const raw = gunzipSync(readFileSync(path));
      const loader = new GLTFLoader().register(() => ({
        name: 'A32_CPU_MATERIAL_STUB',
        loadMaterial: () => Promise.resolve(new T.MeshStandardMaterial({ side: T.DoubleSide })),
      }));
      const model = (await loader.parseAsync(new Uint8Array(raw).buffer, '')).scene;
      const root = new T.Group(),
        body = new T.Group();
      root.add(body);
      if (suppliedPlayer) {
        model.position.y = -0.25;
        root.add(model);
      } else
        for (const part of ['nose', 'tail_carbon', 'tail_alloy', 'engine'])
          body.add(model.getObjectByName(part)!);
      root.userData.authoredBodywork = !suppliedPlayer;
      root.position.set(12, 8, -15);
      root.rotation.set(0, 0.7, 0);
      const car = {
        root,
        staticBody: body,
        suppliedPlayer: suppliedPlayer ? { root: model } : null,
      } as unknown as FormulaCar;
      const before = readFileSync(path);
      const fits = measurePitJackFits(car);
      expect(fits.source).toBe(suppliedPlayer ? 'supplied-player' : 'authored-rival');
      expect(fits.front[2]).toBe(suppliedPlayer ? 2.8 : 2.4);
      expect(fits.rear[2]).toBe(-2.25);
      expect(fits.front[1]).toBeGreaterThan(suppliedPlayer ? -0.37 : -0.23);
      expect(fits.front[1]).toBeLessThan(suppliedPlayer ? -0.34 : -0.2);
      const pose = new A32JackPose();
      for (const role of ['front', 'rear'] as const)
        for (const h of [0, 0.19, 0.22])
          expect(() => pose.set(role, fits[role], -0.43 - h)).not.toThrow();
      expect(readFileSync(path).equals(before)).toBe(true);
      dispose(root);
      dispose(model);
    }
  });
  it('rejects cancelled, missing, oversized and truncated downloads explicitly', async () => {
    const noFetch = (() => {
      throw new Error('unexpected fetch');
    }) as typeof fetch;
    await expect(loadPitJacks(() => true, 'unused', noFetch)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(
      loadPitJacks(
        () => false,
        'unused',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('404');
    await expect(
      loadPitJacks(
        () => false,
        'unused',
        async () => new Response(new Uint8Array(PIT_JACKS.bytes + 1)),
      ),
    ).rejects.toThrow('budget');
    await expect(
      loadPitJacks(
        () => false,
        'unused',
        async () => new Response(new Uint8Array(12)),
      ),
    ).rejects.toThrow('Truncated');
  });
  it('disposes detached geometry and atlas resources only once', async () => {
    const j = await decode(),
      seen = new Set<T.BufferGeometry>();
    let disposed = 0;
    for (const b of j.batches)
      if (!seen.has(b.geometry)) {
        seen.add(b.geometry);
        b.geometry.addEventListener('dispose', () => disposed++);
      }
    j.dispose();
    j.dispose();
    expect(disposed).toBe(32);
    expect(() => j.begin()).toThrow('disposed');
    expect(JACK_PARTS).toHaveLength(4);
  });
});
