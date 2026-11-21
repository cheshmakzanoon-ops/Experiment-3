import * as T from 'three';

let shared: T.Texture | undefined;
let users = 0;

/** Unlit masks for moulded lettering (R) and the balance paint spot (G).
 * Each row wraps one circumference. Leave the seam black so both sides can
 * read the marking in their own outward-facing tangent direction. */
function createStamp() {
  if (typeof document === 'undefined') {
    const t = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#000';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.textBaseline = 'middle';
  c.textAlign = 'center';
  for (let axle = 0; axle < 2; axle++) {
    c.save();
    c.translate(0, axle * 64);
    c.fillStyle = '#f00';
    c.font = 'italic 900 38px sans-serif';
    c.fillText('MOTOBOUND', 242, 32, 183);
    c.font = 'bold 29px sans-serif';
    c.fillText(axle ? 'MX  /  18' : 'MX  /  21', 730, 30, 106);
    c.font = 'bold 10px sans-serif';
    c.fillText(axle ? 'REAR   •   NHS' : 'FRONT   •   NHS', 730, 49, 90);
    // Three mould bars and a painted bead alignment spot use separate masks.
    for (let bar = 0; bar < 3; bar++) c.fillRect(386 + 6 * bar, 23 + 3 * bar, 3, 18 - 3 * bar);
    c.fillStyle = '#0f0';
    c.beginPath();
    c.ellipse(570, 32, 2.4, 8.5, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  const t = new T.CanvasTexture(canvas);
  t.name = 'MX sidewall mould and balance paint';
  t.wrapS = T.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** A whole grid and its mid-detail copies sample one immutable mask. */
export function retainMxTyreLettering(material: T.Material) {
  shared ??= createStamp();
  users++;
  const release = () => {
    material.removeEventListener('dispose', release);
    if (--users === 0) {
      shared!.dispose();
      shared = undefined;
    }
  };
  material.addEventListener('dispose', release);
  return shared;
}
