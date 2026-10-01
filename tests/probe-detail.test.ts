import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  cubeTexelAngle,
  cullProbeDetail,
  sphereDetail,
  stripDetail,
  trunkDetail,
} from '../src/rendering/probe-detail.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { renderCensus, cubeCensusCameras } from '../src/rendering/render-census.ts';
import { Random } from '../src/core/math.ts';

const texel = cubeTexelAngle(128);
const angle = (eye: T.Vector3, a: T.Vector3, b: T.Vector3) =>
  a.clone().sub(eye).angleTo(b.clone().sub(eye));

describe('probe detail bounds', () => {
  it('measures one texel of a 90-degree cube face', () => {
    expect(texel).toBeCloseTo(Math.PI / 256, 12);
    for (const bad of [0, -4, 1.5, NaN]) expect(() => cubeTexelAngle(bad)).toThrow();
  });
  it('bounds a compact mesh by the angle of its bounding sphere', () => {
    const mesh = new T.Mesh(new T.SphereGeometry(2), new T.MeshBasicMaterial());
    mesh.position.set(100, 0, 0);
    const detail = sphereDetail(mesh);
    expect(detail.angularSize(new T.Vector3())).toBeCloseTo(2 * Math.asin(2 / 100), 4);
    expect(detail.angularSize(new T.Vector3(101, 0, 0))).toBe(Infinity);
  });
  it('never under-estimates a strip, seen along, across or end-on', () => {
    // A 0.14 m painted line, 80 m long, gently curved, sampled every 4 m.
    const width = 0.14,
      left: T.Vector3[] = [],
      right: T.Vector3[] = [],
      centre: T.Vector3[] = [];
    for (let i = 0; i <= 400; i++) {
      const s = i * 0.2,
        heading = s / 200,
        p = new T.Vector3(200 * Math.sin(heading), 0, 200 * (1 - Math.cos(heading))),
        n = new T.Vector3(-Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(width / 2);
      left.push(p.clone().add(n));
      right.push(p.clone().sub(n));
      if (i % 20 === 0) centre.push(p);
    }
    const detail = stripDetail(new T.Object3D(), centre, width);
    const random = new Random(3);
    for (let k = 0; k < 400; k++) {
      const eye = new T.Vector3(
        -60 + random.next() * 200,
        0.2 + random.next() * 4,
        -60 + random.next() * 120,
      );
      let widest = 0;
      for (let i = 0; i < left.length; i++)
        widest = Math.max(widest, angle(eye, left[i], right[i]));
      expect(detail.angularSize(eye)).toBeGreaterThanOrEqual(widest);
    }
    // End-on from 20 m the line is half a texel wide: omitted. From 9 m across: drawn.
    expect(detail.angularSize(new T.Vector3(-20, 1.5, 0))).toBeLessThan(texel);
    expect(detail.angularSize(new T.Vector3(40, 1.5, 13))).toBeGreaterThan(texel);
    expect(() => stripDetail(new T.Object3D(), [new T.Vector3()], 1)).toThrow();
  });
  it('bounds every trunk instance by its thickest section and reach', () => {
    const geometry = new T.CylinderGeometry(0.009, 0.027, 0.67, 7).translate(0, 0.335, 0);
    const trunks = new T.InstancedMesh(geometry, new T.MeshBasicMaterial(), 2);
    const m = new T.Matrix4();
    trunks.setMatrixAt(
      0,
      m.compose(new T.Vector3(0, 0, 0), new T.Quaternion(), new T.Vector3(10, 12, 10)),
    );
    trunks.setMatrixAt(
      1,
      m.compose(new T.Vector3(500, 0, 0), new T.Quaternion(), new T.Vector3(10, 12, 10)),
    );
    const detail = trunkDetail(trunks);
    // Diameter 0.54 m; the nearest trunk decides.
    for (const d of [20, 45, 70]) {
      const eye = new T.Vector3(d, 1.5, 0);
      const bound = detail.angularSize(eye);
      expect(bound).toBeGreaterThanOrEqual(0.54 / d);
      expect(bound).toBeLessThan(0.54 / (d - 0.3) + 1e-9);
    }
    expect(detail.angularSize(new T.Vector3(70, 1.5, 0))).toBeLessThan(texel);
    expect(detail.angularSize(new T.Vector3(0.1, 1, 0))).toBe(Infinity);
  });
  it('hides only visible details below one texel and reports them', () => {
    const [a, b, c] = [new T.Object3D(), new T.Object3D(), new T.Object3D()];
    c.visible = false;
    const hidden = cullProbeDetail(
      [
        { object: a, angularSize: () => texel },
        { object: b, angularSize: () => texel / 2 },
        { object: c, angularSize: () => 0 },
      ],
      new T.Vector3(),
      128,
      [],
    );
    expect(hidden).toEqual([b]);
    expect([a.visible, b.visible, c.visible]).toEqual([true, false, false]);
  });
});

describe('probe detail on the built circuits', () => {
  it('omits over a third of the probe draws and nothing a texel wide', () => {
    class Canvas {
      width = 300;
      height = 150;
      getContext() {
        const noop = () => {};
        return new Proxy(
          {
            canvas: this,
            measureText: () => ({ width: 40 }),
            createLinearGradient: () => ({ addColorStop: noop }),
            createRadialGradient: () => ({ addColorStop: noop }),
            createPattern: () => ({ setTransform: noop }),
            createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
            getImageData: (_x: number, _y: number, w: number, h: number) => ({
              data: new Uint8ClampedArray(w * h * 4),
            }),
          },
          { get: (target, key) => Reflect.get(target, key) ?? noop },
        );
      }
    }
    vi.stubGlobal('document', { createElement: () => new Canvas() });
    vi.stubGlobal('HTMLCanvasElement', Canvas);
    try {
      for (const id of ['aurel', 'vellamar'] as const) {
        const track = new Track('clear', false, undefined, circuitDefinition(id));
        const circuit = new CircuitScene(track);
        const scene = new T.Scene().add(circuit.group);
        circuit.crowd.visible = false;
        const roots = [circuit.group, circuit.props, circuit.surfaces];
        // Painted lines and kerbs are strips; trunks are instance-tested.
        const kinds = circuit.probeDetail.length;
        expect(kinds).toBeGreaterThan(900);
        const p = trackPoint();
        let before = 0,
          after = 0;
        for (let s = 50; s < track.length; s += track.length / 6) {
          track.at(s, p);
          const eye = new T.Vector3(p.x, p.y + 1.5, p.z);
          const cameras = cubeCensusCameras(eye, 1600);
          before += renderCensus(scene, cameras, roots).reduce((n, e) => n + e.draws, 0);
          const hidden = cullProbeDetail(circuit.probeDetail, eye, 128, []);
          after += renderCensus(scene, cameras, roots).reduce((n, e) => n + e.draws, 0);
          // The surface ribbon under the car and its kerbs stay in the probe.
          for (const detail of circuit.probeDetail)
            if (hidden.includes(detail.object)) expect(detail.angularSize(eye)).toBeLessThan(texel);
          hidden.forEach((o) => (o.visible = true));
        }
        expect(after / before).toBeLessThan(0.67);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  }, 300000);
});
