import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { infrastructureIdentity } from '../src/rendering/track-infrastructure-diagnostics.ts';
import { decodeConcreteBarriers, CONCRETE_BARRIERS } from '../src/rendering/concrete-barriers.ts';
import { decodeSteelGuardrails, STEEL_GUARDRAILS } from '../src/rendering/steel-guardrails.ts';
import { decodeCatchFence, CATCH_FENCE } from '../src/rendering/catch-fence.ts';
import { decodeImpactBarriers, IMPACT_BARRIERS } from '../src/rendering/impact-barriers.ts';
import { decodeRecoveryGates, RECOVERY_GATES } from '../src/rendering/recovery-gates.ts';
import { decodeMarshalPosts, MARSHAL_POSTS } from '../src/rendering/marshal-posts.ts';
import { decodeStartGantry, START_GANTRY } from '../src/rendering/start-gantry.ts';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { H } from '../src/simulation/protocol.ts';

const assets = [
  [CONCRETE_BARRIERS, decodeConcreteBarriers],
  [STEEL_GUARDRAILS, decodeSteelGuardrails],
  [CATCH_FENCE, decodeCatchFence],
  [IMPACT_BARRIERS, decodeImpactBarriers],
  [RECOVERY_GATES, decodeRecoveryGates],
  [MARSHAL_POSTS, decodeMarshalPosts],
  [START_GANTRY, decodeStartGantry],
] as const;
const loader = () =>
  new GLTFLoader().register(() => ({
    name: 'CPU_geometry_only',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));

describe('A01-A07 integrated infrastructure contract', () => {
  it('retains seven original kits under an eight-MiB transfer budget and bounded packed atlases', () => {
    expect(assets.reduce((bytes, [m]) => bytes + m.bytes, 0)).toBeLessThan(8 * 1024 * 1024);
    for (const [manifest] of assets) {
      expect(manifest.authoredIn).toBe('5.2.2 LTS');
      // A02 retains its single untextured dielectric reflector material.
      expect(manifest.materials).toBe(manifest.assetId === 'A02' ? 2 : 1);
      expect(manifest.images).toBe(3);
      expect(manifest.finalArtApproved).toBe(false);
      const bytes = readFileSync('public/' + manifest.url);
      const jsonLength = bytes.readUInt32LE(12);
      const doc = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
      const bin = 20 + jsonLength + 8;
      for (const image of doc.images) {
        const view = doc.bufferViews[image.bufferView];
        expect(bytes.subarray(bin + view.byteOffset, bin + view.byteOffset + 8)).toEqual(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
        const width = bytes.readUInt32BE(bin + view.byteOffset + 16);
        const height = bytes.readUInt32BE(bin + view.byteOffset + 20);
        expect([256, 512]).toContain(width);
        expect(height).toBe(width);
      }
    }
  });

  for (const [manifest, decode] of assets) {
    it(`${manifest.assetId} rejects zero-area exported triangles across every retained LOD`, async () => {
      const kit = await decode(new Uint8Array(readFileSync('public/' + manifest.url)), loader());
      const a = new T.Vector3(),
        b = new T.Vector3(),
        c = new T.Vector3();
      let triangles = 0;
      try {
        for (const value of kit.templates.values()) {
          const geometries =
            value instanceof T.BufferGeometry ? [value] : value.map((p) => p.geometry);
          for (const geometry of geometries) {
            const index = geometry.index!,
              p = geometry.getAttribute('position');
            for (let i = 0; i < index.count; i += 3) {
              a.fromBufferAttribute(p, index.getX(i));
              b.fromBufferAttribute(p, index.getX(i + 1)).sub(a);
              c.fromBufferAttribute(p, index.getX(i + 2)).sub(a);
              expect(
                b.cross(c).lengthSq(),
                `${manifest.assetId} triangle ${i / 3}`,
              ).toBeGreaterThan(1e-20);
              triangles++;
            }
          }
        }
        expect(triangles).toBeGreaterThan(100);
      } finally {
        kit.dispose();
      }
    });
  }

  it('separates changing LOD counters from immutable source and placement identity', () => {
    const report = {
      assetId: 'A01',
      sha256: 'original',
      chunks: 3,
      modules: 60,
      selectedLods: [1, 1, 1],
      selectedTriangles: 900,
      loaded: true,
      finalArtApproved: false,
    };
    const original = structuredClone(report);
    const identity = infrastructureIdentity(report);
    expect(
      infrastructureIdentity({ ...report, selectedLods: [0, 0, 3], selectedTriangles: 100 }),
    ).toEqual(identity);
    expect(identity).toEqual({
      assetId: 'A01',
      sha256: 'original',
      chunks: 3,
      modules: 60,
      loaded: true,
      finalArtApproved: false,
    });
    expect(report).toEqual(original);
    expect(infrastructureIdentity(null)).toBeNull();
  });

  it('restores actual recorded start lamps after lights-out, held frames and a new-session reset without mutating snapshots', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 0, seed: 1887 });
    const states = new Map<number, Float32Array>();
    const reset = sim.makeFrame().slice();
    for (let i = 0; i < 8 * 120; i++) {
      sim.step(1 / 120);
      const frame = sim.makeFrame();
      if (!states.has(frame[H.LIGHTS])) states.set(frame[H.LIGHTS], frame.slice());
    }
    const lightsOut = sim.makeFrame().slice();
    const lamps = Array.from(
      { length: 5 },
      () => new T.MeshStandardMaterial({ emissive: 0xff210c, emissiveIntensity: 0 }),
    );
    const safetyPanel = new T.MeshStandardMaterial();
    const context = { startLamps: lamps, safetyPanel } as unknown as CircuitScene;
    try {
      expect([...states.keys()]).toEqual([0, 1, 2, 3, 4, 5]);
      for (const frame of [
        states.get(5)!,
        lightsOut,
        states.get(3)!,
        states.get(3)!,
        reset,
        states.get(5)!,
        lightsOut,
      ]) {
        const original = frame.slice();
        CircuitScene.prototype.update.call(context, frame);
        expect(lamps.map((m) => m.emissiveIntensity)).toEqual(
          Array.from({ length: 5 }, (_, i) => (i < frame[H.LIGHTS] ? 25 : 0)),
        );
        expect(frame).toEqual(original);
      }
    } finally {
      lamps.forEach((m) => m.dispose());
      safetyPanel.dispose();
    }
  });
});
