import * as T from 'three';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import { useStudioUniforms } from '../studio/studio-frame.ts';

const DROP = 0.88,
  HALF_WIDTH = 0.32;
const rows = 4,
  columns = 4;

/** Both hems sit on the actual piecewise-linear cable, including the change
 * of slope at its centre knot. UV.y measures descent from that fixed hem. */
export function harbourPennant(leftRise: number, rightRise: number) {
  const positions: number[] = [],
    normals: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let j = 0; j < rows; j++) {
    const t = j / rows;
    for (let k = 0; k <= columns; k++) {
      const u = k / columns,
        across = 2 * u - 1;
      const rise = Math.abs(across) * (across < 0 ? leftRise : rightRise);
      positions.push(across * HALF_WIDTH * (1 - t) + 0.045 * t, rise * (1 - t) - DROP * t, 0);
      normals.push(0, 0, 1);
      uv.push(u, t);
      if (j && k) {
        const d = positions.length / 3 - 1,
          c = d - 1,
          b = d - columns - 1,
          a = b - 1;
        index.push(a, c, b, b, c, d);
      }
    }
  }
  const tip = positions.length / 3;
  positions.push(0.045, -DROP, 0);
  normals.push(0, 0, 1);
  uv.push(0.5, 1);
  for (let k = 0; k < columns; k++) index.push(tip - 1 - columns + k, tip, tip - columns + k);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

const CLOTH = /* glsl */ `
float harbourBend(vec3 p, vec3 n, vec2 st) {
  float wind = dot(studioWind.xy, n.xz);
  float strength = wind / sqrt(5.76 + wind * wind);
  float phase = dot(p.xz,vec2(0.107,0.153)) + studioWind.z * (2.1 + 0.07*min(abs(wind),20.0));
  float ripple = sin(phase + st.y*2.2 + st.x*0.4) * 0.31 + sin(phase*1.79 - st.y*2.8) * 0.13;
  return strength * (1.04 + ripple + 0.23 * studioWind.w);
}
vec3 harbourClothOffset(float bend, vec3 n, float t) {
  float angle = bend*t;
  if (abs(bend)<0.001) return n * (0.44*bend*t*t);
  return n * (0.88 * (1.0-cos(angle))/bend) + vec3(0.0,0.88*(t-sin(angle)/bend),0.0);
}`;

/** Colour and both shadow passes use the same time, wind, pinned vertices and
 * curved free edge. No per-frame vertex upload or extra shadow proxy. */
export function bindHarbourCloth(material: T.Material, shade: boolean) {
  chainShaderHook(material, 'harbour-pennant-v1', (shader) => {
    useStudioUniforms(shader, ['studioWind'], 'vertex');
    injectAfter(shader, 'common', CLOTH, 'vertex');
    injectAfter(
      shader,
      'begin_vertex',
      'transformed += harbourClothOffset(harbourBend(position, normal, uv), normal, uv.y);',
      'vertex',
    );
    if (shade)
      injectAfter(
        shader,
        'beginnormal_vertex',
        `float seaFold = harbourBend(position, normal, uv) * uv.y;
      objectNormal = normalize(normal * cos(seaFold) + vec3(0.0, sin(seaFold), 0.0));`,
        'vertex',
      );
  });
}
