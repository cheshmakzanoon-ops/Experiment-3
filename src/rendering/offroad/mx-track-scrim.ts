import * as T from 'three';
import { rodGeometry } from '../vehicle-bodies/loft.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

const EYELET_FROM_END = 0.048, EYELET_FROM_HEM = 0.026;
const panelHeight = 0.72;

/** Seat hardware on the two real triangles of each folded corner. The inner
 * bore punches both the visible print and its shadow at the same coordinates. */
export function fitMxScrim(
  cloth: T.PlaneGeometry, posts: readonly [T.Vector3, T.Vector3], side: number,
) {
  const positions = cloth.getAttribute('position'), uv = cloth.getAttribute('uv');
  const width = Math.hypot(posts[1].x - posts[0].x, posts[1].z - posts[0].z) * 0.992;
  const coordinates = new Float32Array(3 * positions.count);
  for (let i = 0; i < positions.count; i++)
    coordinates.set([uv.getX(i), uv.getY(i), width], i * 3);
  cloth.setAttribute('mxScrimPanel', new T.Float32BufferAttribute(coordinates, 3));
  const hardware: T.BufferGeometry[] = [];
  const columns = cloth.parameters.widthSegments, rows = cloth.parameters.heightSegments;
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  const normal = new T.Vector3(), seat = new T.Vector3();
  for (const end of [0, 1]) for (const top of [0, 1]) {
    const u = end ? 1 - EYELET_FROM_END / width : EYELET_FROM_END / width;
    const v = top ? 1 - EYELET_FROM_HEM / panelHeight : EYELET_FROM_HEM / panelHeight;
    const x = u * columns, y = (1 - v) * rows;
    const corner = Math.floor(y) * (columns + 1) + Math.floor(x);
    const fx = x % 1, fy = y % 1;
    if (fx + fy < 1) {
      a.fromBufferAttribute(positions, corner);
      b.fromBufferAttribute(positions, corner + 1).sub(a);
      c.fromBufferAttribute(positions, corner + columns + 1).sub(a);
      seat.copy(a).addScaledVector(b, fx).addScaledVector(c, fy);
    } else {
      a.fromBufferAttribute(positions, corner + columns + 2);
      b.fromBufferAttribute(positions, corner + columns + 1).sub(a);
      c.fromBufferAttribute(positions, corner + 1).sub(a);
      seat.copy(a).addScaledVector(b, 1 - fx).addScaledVector(c, 1 - fy);
    }
    normal.crossVectors(c, b).normalize();
    const ring = new T.TorusGeometry(0.012, 0.0033, 4, 8);
    ring.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), normal));
    hardware.push(ring.translate(seat.x, seat.y, seat.z));
    const post = posts[side < 0 ? 1 - end : end];
    // Twin legs return around the pole and pass through the rolled eye.
    for (const face of [-1, 1]) {
      const eye = seat.clone().addScaledVector(normal, face * 0.005);
      const loop = post.clone().addScaledVector(normal, face * 0.026);
      loop.y += top ? 0.96 : 0.26;
      hardware.push(rodGeometry(eye, loop, 0.0025, 5));
    }
  }
  return hardware;
}

export function installMxScrim(material: T.Material, colour: boolean) {
  chainShaderHook(material, 'mx-backed-track-scrim-v1', shader => {
    injectDeclarations(shader, 'common', 'attribute vec3 mxScrimPanel; varying vec3 vMxScrim;', 'vertex');
    injectDeclarations(shader, 'common', 'varying vec3 vMxScrim;', 'fragment');
    injectAfter(shader, 'begin_vertex', 'vMxScrim = mxScrimPanel;', 'vertex');
    injectAfter(shader, 'alphatest_fragment', `
      if (vMxScrim.z > 0.) {
        vec2 border = min(vMxScrim.xy, 1. - vMxScrim.xy) * vec2(vMxScrim.z, ${panelHeight});
        float eye = length(border - vec2(${EYELET_FROM_END}, ${EYELET_FROM_HEM}));
        if (eye < .0085 && fwidth(eye) < .013) discard;
        ${colour ? `
        // Ink passes through one ply. The turned-over hem has two plies and
        // a denser line of stitching, visible on the reverse at trackside.
        float edge = min(border.x, border.y), footprint = max(fwidth(edge), .0001);
        float hem = 1. - smoothstep(.023 - footprint, .023 + footprint, edge);
        if (!gl_FrontFacing)
          diffuseColor.rgb = mix(vec3(.51, .47, .365), diffuseColor.rgb, .52 - .13 * hem);
        float thread = (1. - smoothstep(.0006, .0018, abs(edge - .018)))
                     * (1. - smoothstep(.001, .008, footprint));
        diffuseColor.rgb *= 1. - .065 * hem - .16 * thread;
        // Filter the woven openings to their mean once an individual yarn
        // falls below a pixel. The print then reads cleanly on a moving bike.
        vec2 yarn = vMxScrim.xy * vec2(vMxScrim.z, .72) / vec2(.0021, .0018);
        vec2 yarnPixel = fwidth(yarn);
        float visibleYarn = 1. - smoothstep(.25, .8, max(yarnPixel.x, yarnPixel.y));
        if (visibleYarn > 0.) {
          vec2 rib = .5 + .5 * cos(6.2831853 * yarn);
          float crossing = cos(3.1415927 * yarn.x) * cos(3.1415927 * yarn.y);
          float relief = mix(rib.x, rib.y, .5 + .5 * crossing);
          diffuseColor.rgb *= 1. + visibleYarn * (.13 * (relief - .5) - .13 * rib.x * rib.y);
        }
        ` : ''}
      }`, 'fragment');
  });
}
