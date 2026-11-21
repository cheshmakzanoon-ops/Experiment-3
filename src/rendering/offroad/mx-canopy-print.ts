import * as T from 'three';

/** Original event issue flysheets. Each 256-pixel strip contains a triangular
 * roof print, a low valance print and a white swatch for unprinted fabric. */
export const MX_PADDOCK_CREWS = [
  ['#233e56', '#416780', '#d99548', 'RIDGE WORKS'],
  ['#823b32', '#af5744', '#e1c798', 'NORTHLINE'],
  ['#254943', '#437467', '#c1cd74', 'PINE RACING'],
  ['#443958', '#6b5876', '#de9d52', 'SUMMIT MX'],
] as const;
const WIDTH = 1024,
  ROW = 256;
export function mxCanopyPrint() {
  if (typeof document === 'undefined') {
    const texture = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.needsUpdate = true;
    return texture;
  }
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = ROW * MX_PADDOCK_CREWS.length;
  const c = canvas.getContext('2d')!;
  const polygon = (ink: string, points: number[][]) => {
    c.fillStyle = ink;
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
  };
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, canvas.width, canvas.height);
  for (const [i, [base, light, accent, name]] of MX_PADDOCK_CREWS.entries()) {
    c.save();
    c.translate(0, i * ROW);
    c.fillStyle = base;
    c.fillRect(0, 0, WIDTH, 244);
    polygon(light, [
      [0, 0],
      [694, 0],
      [353, 180],
      [0, 180],
    ]);
    polygon(accent, [
      [771, 0],
      [884, 0],
      [561, 180],
      [450, 180],
    ]);
    polygon('#d8d6c5', [
      [893, 0],
      [916, 0],
      [595, 180],
      [571, 180],
    ]);
    // The ridge device is wholly inside the sewn triangular panel.
    polygon('#e9eadf', [
      [397, 116],
      [475, 50],
      [525, 91],
      [555, 72],
      [617, 118],
      [581, 118],
      [554, 97],
      [525, 117],
      [474, 79],
      [432, 116],
    ]);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'italic 900 28px Arial, sans-serif';
    c.fillStyle = '#f0efe8';
    c.fillText(name, 509, 147, 310);
    c.fillStyle = '#19272f';
    c.fillRect(0, 181, WIDTH, 64);
    c.fillStyle = accent;
    c.fillRect(0, 183, WIDTH, 5);
    c.font = 'bold 30px Arial, sans-serif';
    c.textAlign = 'left';
    c.fillStyle = '#e5e6dd';
    c.fillText(name, 52, 216, 378);
    c.font = 'bold 16px Arial, sans-serif';
    c.textAlign = 'right';
    c.fillText('MOTOBOUND  /  RACE SUPPORT', 906, 215, 326);
    for (let k = 0; k < 3; k++)
      polygon(accent, [
        [936 + k * 15, 204],
        [944 + k * 15, 204],
        [935 + k * 15, 224],
        [927 + k * 15, 224],
      ]);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 247, WIDTH, 9);
    c.restore();
  }
  const texture = new T.CanvasTexture(canvas);
  texture.name = 'MX factory flysheet and paddock valance ink';
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export type CanopyCut = 'roof' | 'hem';
/** Remap only at assembly. The exportable kit keeps each panel's artist UVs.
 * World-space wind weights pin hip seams, valance tops and pole corners. */
export function fitMxCanopyFabric(
  g: T.BufferGeometry,
  cut: CanopyCut | undefined,
  cluster: number,
  placement?: T.Matrix4,
) {
  const uv = g.getAttribute('uv'),
    pos = g.getAttribute('position');
  const cloth = placement ? new Float32Array(uv.count * 3) : null;
  const row = ((cluster % MX_PADDOCK_CREWS.length) + MX_PADDOCK_CREWS.length) % MX_PADDOCK_CREWS.length;
  const axis = new T.Vector3();
  const world = new T.Vector3();
  for (let i = 0; i < uv.count; i++) {
    if (!cut) {
      uv.setXY(i, 0.5, 1 - (row * ROW + 251.5) / 1024);
      continue;
    }
    const u = uv.getX(i),
      v = uv.getY(i);
    const x = cut === 'roof' ? 0.5 + (0.5 - u) * v : u;
    const y = cut === 'roof' ? 2 + 175 * v : 190 + (1 - v) * 50;
    uv.setXY(i, (2 + 1020 * x) / WIDTH, 1 - (row * ROW + y) / 1024);
    if (!placement || !cloth) continue;
    const lx = pos.getX(i),
      lz = pos.getZ(i);
    if (Math.abs(lx) > Math.abs(lz)) axis.set(Math.sign(lx), 0, 0);
    else axis.set(0, 0, Math.sign(lz));
    axis.transformDirection(placement);
    world.fromBufferAttribute(pos, i).applyMatrix4(placement);
    const pinned = Math.sin(Math.PI * u);
    const weight =
      cut === 'roof' ? 0.025 * pinned * Math.sin(v * Math.PI) : 0.085 * pinned * (1 - v);
    cloth[i * 3] = axis.x * weight;
    cloth[i * 3 + 1] = axis.z * weight;
    cloth[i * 3 + 2] = world.x * 1.07 + world.z * 1.61 + world.y * 2.1;
  }
  if (cloth) g.setAttribute('mxCloth', new T.BufferAttribute(cloth, 3));
}
