import * as T from 'three';
import { clamp, Random } from '../../core/math.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { offroadCourse } from '../../simulation/offroad/venues.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

const SIZE = 256;

/** One shared, mipmapped plan of the outdoor event grounds. The public side
 * of a spectator berm gets a walked verge, the service side keeps two wheel
 * tracks with grass between. Both stop short of adjacent racing lanes. */
export class MxFieldCover {
  readonly texture: T.DataTexture;
  readonly bounds: T.Vector4;
  private users = 0;

  constructor(track: Track) {
    let minX = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxZ = -Infinity;
    for (const p of track.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const border = 40,
      spanX = maxX - minX + 2 * border,
      spanZ = maxZ - minZ + 2 * border;
    minX -= border;
    minZ -= border;
    this.bounds = new T.Vector4(minX, minZ, 1 / spanX, 1 / spanZ);
    const data = new Uint8Array(SIZE * SIZE * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i + 2] = 108;
      data[i + 3] = 255;
    }
    const scaleX = SIZE / spanX,
      scaleZ = SIZE / spanZ;
    const stamp = (
      x: number,
      z: number,
      rx: number,
      rz: number,
      channel: number,
      value: number,
    ) => {
      const u = (x - minX) * scaleX - 0.5,
        v = (z - minZ) * scaleZ - 0.5;
      const du = rx * scaleX,
        dv = rz * scaleZ;
      for (let j = Math.max(0, Math.floor(v - dv)); j <= Math.min(SIZE - 1, v + dv); j++)
        for (let i = Math.max(0, Math.floor(u - du)); i <= Math.min(SIZE - 1, u + du); i++) {
          const r2 = ((i - u) / du) ** 2 + ((j - v) / dv) ** 2;
          if (r2 >= 1) continue;
          const k = (j * SIZE + i) * 4 + channel;
          if (channel === 2) data[k] = clamp(data[k] + value * (1 - r2) ** 2, 0, 255);
          else data[k] = Math.max(data[k], Math.round(value * (1 - r2) ** 0.65));
        }
    };
    // Broad patches of cut and uncut pasture survive at spectator distance.
    // Each patch has soft boundaries and a deterministic, irregular neighbour.
    const rng = new Random(56279);
    for (let n = 0; n < 420; n++) {
      const x = minX + rng.next() * spanX,
        z = minZ + rng.next() * spanZ;
      const width = 2 + rng.next() * 13,
        length = 3 + rng.next() * 18;
      const value = (rng.next() - 0.46) * 185;
      stamp(x, z, width, length, 2, value);
      stamp(x + width * 0.6, z - length * 0.34, width * 0.8, length * 0.72, 2, value * 0.64);
    }
    const course = offroadCourse(track.circuit),
      p = trackPoint(),
      nearest = trackPoint();
    if (course)
      for (const [n, berm] of course.spec.berms.entries()) {
        if (berm.side === undefined) continue;
        const publicSide = n === 0 || n === 3;
        const side = berm.side,
          start = berm.from - (publicSide ? 34 : 12),
          end = berm.to + (publicSide ? 18 : 10);
        for (let s = start; s <= end; s += 0.55) {
          track.at(s, p);
          const along = s - start;
          const strength = Math.min(1, along / 4, (end - s) / 4);
          const setback =
            (publicSide ? 7.8 : 5.5) +
            1.1 * Math.sin(along * 0.075 + n) +
            0.7 * Math.sin(along * 0.21);
          const offset = track.boundaryAt(p, side) + setback;
          const x = p.x + side * p.nx * offset,
            z = p.z + side * p.nz * offset;
          const closest = track.nearest(x, z, nearest);
          if (Math.abs(closest) < track.boundaryAt(nearest, Math.sign(closest)) + 2.4) continue;
          if (publicSide) stamp(x, z, 2.45, 2.45, 0, 182 * strength);
          else {
            stamp(x, z, 1.9, 1.9, 0, 47 * strength);
            for (const tread of [-0.84, 0.84])
              stamp(x + p.nx * tread, z + p.nz * tread, 0.67, 0.67, 1, 208 * strength);
          }
        }
      }
    this.texture = new T.DataTexture(data, SIZE, SIZE, T.RGBAFormat);
    this.texture.name = 'Valley Ridge pasture and access trails';
    this.texture.minFilter = T.LinearMipmapLinearFilter;
    this.texture.magFilter = T.LinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.needsUpdate = true;
  }

  install(material: T.MeshStandardMaterial) {
    const installed = chainShaderHook(material, 'mx-valley-field-cover-v1', (shader) => {
      shader.uniforms.mxFieldCover = { value: this.texture };
      shader.uniforms.mxFieldBounds = { value: this.bounds };
      injectDeclarations(
        shader,
        'common',
        'uniform sampler2D mxFieldCover; uniform vec4 mxFieldBounds;',
        'fragment',
      );
      injectAfter(
        shader,
        'map_fragment',
        `
        vec2 mxFieldUv = (vFinishWorld.xz - mxFieldBounds.xy) * mxFieldBounds.zw;
        vec2 mxEdge = min(mxFieldUv, 1.0 - mxFieldUv);
        float mxInside = smoothstep(0.0, 0.025, min(mxEdge.x, mxEdge.y));
        vec3 mxField = texture2D(mxFieldCover, mxFieldUv).rgb;
        float mxGrowth = mix(0.45, mxField.b, mxInside);
        diffuseColor.rgb *= mix(vec3(0.68,0.83,0.68), vec3(1.22,1.10,0.85), mxGrowth);
        float mxWear = max(mxField.r, mxField.g) * mxInside;
        float mxEarth = 0.82 + 0.38 * finishFilteredNoise(vFinishWorld.xz * 1.3);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.205,0.136,0.077)*mxEarth, mxWear*0.82);
      `,
        'fragment',
      );
    });
    if (!installed) return;
    this.users++;
    const release = () => {
      material.removeEventListener('dispose', release);
      if (--this.users === 0) this.texture.dispose();
    };
    material.addEventListener('dispose', release);
  }
}
