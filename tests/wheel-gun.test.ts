import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import {
  WHEEL_GUN,
  decodeWheelGuns,
  gunSocketMatrix,
  loadWheelGuns,
  wheelGunDocument,
  wheelGunLod,
} from '../src/rendering/wheel-gun.ts';
import { PitCrewView } from '../src/rendering/pit-crew.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
const bytes = () => new Uint8Array(readFileSync('public/models/aurel-wheel-gun.glb'));
const decode = () =>
  decodeWheelGuns(
    bytes(),
    new GLTFLoader().register(() => ({
      name: 'CPU_texture_stub',
      loadTexture: () =>
        Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
    })),
  );
function serviceFrame() {
  const simulation = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice' });
  const f = simulation.makeFrame(),
    o = carBase(0);
  f[o + F.PIT_PHASE] = 3;
  f[o + F.PIT_CLOCK] = 0.85;
  f[o + F.SPEED] = 0;
  f[o + F.JACK_HEIGHT] = 0.19;
  for (let i = 0; i < 4; i++) {
    f[o + WHEEL_BASE + i * WHEEL_STRIDE + W.LOAD] = 0;
    f[o + WHEEL_BASE + i * WHEEL_STRIDE + W.LENGTH] = 0.33;
  }
  return f;
}
function disposeCrew(crew: PitCrewView) {
  crew.dispose();
  const g = new Set<T.BufferGeometry>(),
    m = new Set<T.Material>();
  crew.root.traverse((o) => {
    if (o instanceof T.Mesh) {
      g.add(o.geometry);
      for (const x of Array.isArray(o.material) ? o.material : [o.material]) m.add(x);
      if (o instanceof T.InstancedMesh) o.dispose();
    }
  });
  g.forEach((x) => x.dispose());
  m.forEach((x) => x.dispose());
}
describe('A31 wheel-gun production handoff', () => {
  it('retains editable Blender source and exact source/export identities', () => {
    expect(readFileSync(WHEEL_GUN.editable).length).toBeGreaterThan(10000);
    expect(createHash('sha256').update(readFileSync(WHEEL_GUN.author)).digest('hex')).toBe(
      WHEEL_GUN.sourceSHA256,
    );
    expect(createHash('sha256').update(bytes()).digest('hex')).toBe(WHEEL_GUN.sha256);
    const d = wheelGunDocument(bytes());
    expect(d.meshes).toHaveLength(9);
    expect(d.images).toHaveLength(3);
    expect(WHEEL_GUN.triangles[0]).toBeLessThan(24000);
    expect(WHEEL_GUN.triangles[1]).toBeLessThan(WHEEL_GUN.triangles[0]);
    expect(WHEEL_GUN.triangles[2]).toBeLessThan(WHEEL_GUN.triangles[1]);
    expect(WHEEL_GUN.finalArtApproved).toBe(false);
  });
  it('rejects truncated headers and altered production bytes before resource decoding', async () => {
    expect(() => wheelGunDocument(bytes().slice(0, -1))).toThrow('byte');
    const b = bytes();
    b[0] = 0;
    expect(() => wheelGunDocument(b)).toThrow('header');
    const c = bytes();
    c[c.length - 50] ^= 1;
    await expect(decodeWheelGuns(c)).rejects.toThrow('integrity');
  });
  it('rejects missing named parts and external resources in the document', () => {
    const mutate = (from: string, to: string) => {
      const b = bytes(),
        s = new TextDecoder().decode(b.slice(20, new DataView(b.buffer).getUint32(12, true) + 20));
      const j = s.replaceAll(from, to.padEnd(from.length));
      expect(j.length).toBe(s.length);
      b.set(new TextEncoder().encode(j), 20);
      return b;
    };
    expect(() => wheelGunDocument(mutate('A31_LOD0_BODY', 'INVALID_BODY'))).toThrow();
    expect(() => wheelGunDocument(mutate('"mimeType":"image/png"', '"uri":"remote.png"'))).toThrow(
      'self-contained',
    );
  });
  it('loads one shared PBR material, six oriented sockets and a real hollow socket', async () => {
    const guns = await decode();
    try {
      expect(new Set(guns.batches.map((b) => b.material)).size).toBe(1);
      const world = new T.Matrix4().compose(
        new T.Vector3(3, 2, 1),
        new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0.7),
        new T.Vector3(1, 1, 1),
      );
      guns.begin();
      guns.put(world);
      guns.setView(new T.Vector3(3, 2, 1));
      for (const name of Object.keys(WHEEL_GUN.sockets) as (keyof typeof WHEEL_GUN.sockets)[]) {
        const expected = world.clone().multiply(gunSocketMatrix(name, new T.Matrix4()));
        const actual = guns.socketTransform(0, name, new T.Matrix4());
        expected.elements.forEach((v, i) => expect(actual.elements[i]).toBeCloseTo(v, 6));
      }
      const socket = guns.prototype.getObjectByName('A31_LOD0_SOCKET')!;
      const ray = new T.Raycaster(new T.Vector3(0, 0, 0.1), new T.Vector3(0, 0, -1));
      const hits = ray.intersectObject(socket, true);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].point.z).toBeLessThan(-0.02); // open front, actual recessed bore back
    } finally {
      guns.dispose();
    }
  });
  it('keeps trigger and socket pivots independent, with bounded positive-scale instances', async () => {
    const g = await decode();
    try {
      g.begin();
      g.put(new T.Matrix4(), 1, 0.2, 1.3);
      g.setView(new T.Vector3());
      const body = new T.Matrix4(),
        trigger = new T.Matrix4(),
        socket = new T.Matrix4();
      g.batches[0].getMatrixAt(0, body);
      g.batches[1].getMatrixAt(0, trigger);
      g.batches[2].getMatrixAt(0, socket);
      expect(body.equals(new T.Matrix4())).toBe(true);
      expect(trigger.elements[6]).toBeCloseTo(Math.sin(0.18), 6);
      expect(socket.determinant()).toBeCloseTo(1.69, 5);
      expect(() => g.put(new T.Matrix4().makeScale(-1, 1, 1))).toThrow('Invalid');
      expect(() => g.put(new T.Matrix4(), NaN)).toThrow('Invalid');
      expect(() => g.put(new T.Matrix4(), 0, 0, 0.5)).toThrow('Invalid');
      expect(() => g.socketTransform(-1, 'SOCKET_WHEEL_NUT', new T.Matrix4())).toThrow();
      g.begin();
      for (let i = 0; i < 48; i++) g.put(new T.Matrix4());
      expect(() => g.put(new T.Matrix4())).toThrow('capacity');
    } finally {
      g.dispose();
    }
  });
  it('changes LOD under camera-only motion and telephoto lenses without pose rebuilding', async () => {
    expect(wheelGunLod(16, -1)).toBe(2);
    expect(wheelGunLod(16, -1, 8)).toBe(0);
    expect(() => wheelGunLod(NaN)).toThrow();
    const g = await decode();
    try {
      g.begin();
      g.put(new T.Matrix4());
      g.setView(new T.Vector3());
      expect(g.diagnostics().lodCounts).toEqual([1, 0, 0]);
      const upload = g.uploads;
      g.setView(new T.Vector3());
      expect(g.uploads).toBe(upload);
      g.setView(new T.Vector3(9, 0, 0));
      expect(g.diagnostics().lodCounts).toEqual([0, 1, 0]);
      g.setView(new T.Vector3(40, 0, 0));
      expect(g.diagnostics().lodCounts).toEqual([0, 0, 1]);
      g.setView(new T.Vector3(40, 0, 0), 5);
      expect(g.diagnostics().lodCounts).toEqual([1, 0, 0]);
      g.begin();
      g.setView(new T.Vector3());
      expect(g.batches.every((b) => b.count === 0)).toBe(true);
    } finally {
      g.dispose();
    }
  });
  it('replaces—not overlays—the old gun batch; preserves other pit props and immutable/replay state', async () => {
    const guns = await decode(),
      crew = new PitCrewView(),
      f = serviceFrame(),
      before = f.slice(),
      o = carBase(0);
    const camera = new T.Vector3(f[o + F.X], f[o + F.Y], f[o + F.Z]);
    crew.installWheelGuns(guns);
    crew.setWheelGunFits(
      0,
      [0, 1, 2, 3].map((i) => ({
        axial: i < 2 ? 0.177 : 0.201,
        radius: 0.031,
        socketScale: 1,
        source: 'supplied-player',
      })),
    );
    const signature = () => JSON.stringify(Array.from(guns.matrices));
    try {
      crew.update(f, camera);
      expect(crew.summary().wheelGuns?.instances).toBe(4);
      expect(crew.summary().actors).toBe(15);
      expect(crew.summary().unreachableArms).toBe(0);
      expect(f).toEqual(before);
      const first = signature(),
        builds = crew.summary().poseBuilds,
        uploads = guns.uploads;
      crew.update(f, camera);
      expect(crew.summary().poseBuilds).toBe(builds);
      expect(guns.uploads).toBe(uploads);
      crew.update(f, camera.clone().add(new T.Vector3(10, 0, 0)));
      expect(crew.summary().poseBuilds).toBe(builds);
      expect(guns.diagnostics().lodCounts[1]).toBe(4);
      f[o + F.PIT_CLOCK] = 1.4;
      crew.update(f, camera);
      expect(signature()).not.toBe(first);
      crew.update(before, camera);
      expect(signature()).toBe(first);
      const steer = before.slice();
      steer[o + WHEEL_BASE + W.STEER] = 0.15;
      crew.update(steer, camera);
      expect(signature()).not.toBe(first);
      crew.update(before, camera, false);
      expect(guns.count).toBe(0);
      expect(crew.root.visible).toBe(false);
      expect(() => crew.installWheelGuns(guns)).toThrow('before');
    } finally {
      disposeCrew(crew);
    }
  });
  it('bounds loading, cancels without I/O and reports truncation without fallback', async () => {
    const never: typeof fetch = async () => {
      throw new Error('unreachable');
    };
    await expect(
      loadWheelGuns(() => true, 'https://example.test/gun', never),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      loadWheelGuns(
        () => false,
        'https://example.test/gun',
        async () => new Response(bytes().slice(0, 10)),
      ),
    ).rejects.toThrow('Truncated');
    await expect(
      loadWheelGuns(
        () => false,
        'https://example.test/gun',
        async () => new Response(new Uint8Array(WHEEL_GUN.bytes + 1)),
      ),
    ).rejects.toThrow('exceeds');
    await expect(
      loadWheelGuns(
        () => false,
        'https://example.test/gun',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('404');
  });
  it('disposes shared detached resources exactly once', async () => {
    const g = await decode(),
      events = new Map<T.BufferGeometry | T.Material | T.Texture, number>();
    for (const b of g.batches)
      for (const r of [b.geometry, b.material as T.Material])
        if (!events.has(r)) {
          events.set(r, 0);
          r.addEventListener('dispose', () => events.set(r, events.get(r)! + 1));
        }
    g.dispose();
    g.dispose();
    expect([...events.values()].every((v) => v === 1)).toBe(true);
  });
});
