import * as T from 'three';
import type { RiderDetail } from './rider.ts';

type CloseDetail = Exclude<RiderDetail, 'far'>;

/** Smoked nylon fluid pot. The meniscus sits inside the translucent wall.
 * Bake its colour into the moulded body so the onboard counter and edges
 * behind the pot never need a separate transparent/transmission pass. */
export function gpReservoirBody(detail: CloseDetail, base: T.Color) {
  const profile = [
    [0.001, -0.0153, 0x402d1d],
    [0.015, -0.0153, 0x493522],
    [0.0189, -0.0137, 0x68432a],
    [0.0192, -0.008, 0x79502e],
    [0.0204, 0.0038, 0x82542b],
    [0.0206, 0.005, 0x4e351f],
    [0.0207, 0.0059, 0x95815c],
    [0.0216, 0.0149, 0xb1a581],
    [0.0223, 0.0165, 0xc1b597],
    [0.0222, 0.0185, 0x867a61],
    [0.0195, 0.0191, 0x695d48],
  ] as const;
  const geometry = new T.LatheGeometry(
    profile.map(([r, y]) => new T.Vector2(r, y)),
    detail === 'high' ? 36 : 18,
  );
  const count = geometry.getAttribute('position').count;
  const colours = new Float32Array(count * 3),
    colour = new T.Color();
  for (let i = 0; i < count; i++) {
    colour.setHex(profile[i % profile.length][2]);
    colours[i * 3] = colour.r / Math.max(base.r, 1e-5);
    colours[i * 3 + 1] = colour.g / Math.max(base.g, 1e-5);
    colours[i * 3 + 2] = colour.b / Math.max(base.b, 1e-5);
  }
  geometry.setAttribute('color', new T.BufferAttribute(colours, 3));
  geometry.name = 'GP smoked nylon reservoir with fluid line';
  return geometry;
}

/** Fluted cap, with a recessed pressure diaphragm and coined upper rim. */
export function gpReservoirCap(detail: CloseDetail) {
  const profile = [
    [0.0195, -0.005],
    [0.0228, -0.005],
    [0.0241, -0.0035],
    [0.0241, 0.0033],
    [0.0228, 0.0045],
    [0.0203, 0.0045],
    [0.0188, 0.0029],
    [0.009, 0.0029],
    [0.0078, 0.0037],
    [0, 0.0037],
  ] as const;
  const segments = detail === 'high' ? 64 : 32;
  const geometry = new T.LatheGeometry(
    profile.map(([r, y]) => new T.Vector2(r, y)),
    segments,
  );
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const row = i % profile.length;
    if (row !== 2 && row !== 3) continue;
    const column = Math.floor(i / profile.length);
    const scale = 1 - 0.035 * (1 - Math.cos((2 * Math.PI * 16 * column) / segments));
    pos.setXYZ(i, pos.getX(i) * scale, pos.getY(i), pos.getZ(i) * scale);
  }
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal'),
    seam = new T.Vector3(),
    end = new T.Vector3();
  for (let row = 0; row < profile.length; row++) {
    const last = segments * profile.length + row;
    seam.fromBufferAttribute(normal, row).add(end.fromBufferAttribute(normal, last)).normalize();
    normal.setXYZ(row, seam.x, seam.y, seam.z);
    normal.setXYZ(last, seam.x, seam.y, seam.z);
  }
  geometry.name = 'GP fluted reservoir cap and diaphragm';
  return geometry;
}
