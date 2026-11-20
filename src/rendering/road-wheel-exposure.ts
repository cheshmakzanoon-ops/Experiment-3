import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';
import type { RiderDetail } from './rider.ts';

const ANGLES = 256,
  RINGS = 64,
  GRID = 192;
const TURNS = 2 * Math.PI;
const INNER = 0.035;
const startSweep = 0.011,
  fullSweep = 0.058;

/** Centred shutter interval in wheel revolutions. A wheel photographed at
 * 1/180 s retains its direction cues at low speed. A locked wheel stays sharp. */
export function wheelExposureTurns(omega: number | undefined) {
  return Number.isFinite(omega) ? Math.min(0.5, Math.abs(omega!) / (180 * TURNS)) : 0;
}

/** Rasterise the projected triangles of the authored spokes and integrate each
 * radial row over the angle. A pair of filtered prefix samples then resolves
 * any swept arc, including arcs crossing zero, without temporal sampling. */
export function spokeExposureAtlas(wheel: T.BufferGeometry, outer: number) {
  const pos = wheel.getAttribute('position'),
    spoke = wheel.getAttribute('roadSpoke'),
    index = wheel.index;
  if (!pos || !spoke || !index || !(outer > INNER))
    throw new Error('Wheel lacks its spoke projection');
  const raster = new Uint8Array(GRID * GRID),
    scale = (GRID - 2) / (2 * outer),
    origin = (GRID - 1) / 2;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i),
      b = index.getX(i + 1),
      c = index.getX(i + 2);
    if (!spoke.getX(a)) continue;
    const ax = origin + scale * pos.getY(a),
      ay = origin + scale * pos.getZ(a),
      bx = origin + scale * pos.getY(b),
      by = origin + scale * pos.getZ(b),
      cx = origin + scale * pos.getY(c),
      cy = origin + scale * pos.getZ(c);
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-8) continue;
    for (
      let y = Math.max(0, Math.ceil(Math.min(ay, by, cy)));
      y <= Math.min(GRID - 1, Math.floor(Math.max(ay, by, cy)));
      y++
    ) {
      for (
        let x = Math.max(0, Math.ceil(Math.min(ax, bx, cx)));
        x <= Math.min(GRID - 1, Math.floor(Math.max(ax, bx, cx)));
        x++
      ) {
        const ab = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        const bc = (cx - bx) * (y - by) - (cy - by) * (x - bx);
        const ca = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
        if (area > 0 ? Math.min(ab, bc, ca) >= 0 : Math.max(ab, bc, ca) <= 0)
          raster[y * GRID + x] = 1;
      }
    }
  }
  const sample = (r: number, t: number) => {
    const x = origin + Math.cos(t) * r * scale,
      y = origin + Math.sin(t) * r * scale;
    const ix = Math.floor(x),
      iy = Math.floor(y),
      dx = x - ix,
      dy = y - iy,
      o = iy * GRID + ix;
    return (
      (raster[o] * (1 - dx) + raster[o + 1] * dx) * (1 - dy) +
      (raster[o + GRID] * (1 - dx) + raster[o + GRID + 1] * dx) * dy
    );
  };
  const data = new Uint8Array((ANGLES + 1) * RINGS * 4);
  const sums = new Float64Array(ANGLES + 1);
  for (let row = 0; row < RINGS; row++) {
    const radius = T.MathUtils.lerp(INNER, outer, row / (RINGS - 1)),
      delta = ((outer - INNER) / (RINGS - 1)) * 0.22;
    for (let k = 0; k < ANGLES; k++) {
      const a = ((k + 0.25) * TURNS) / ANGLES,
        b = ((k + 0.75) * TURNS) / ANGLES;
      const area =
        (sample(radius - delta, a) +
          sample(radius - delta, b) +
          sample(radius + delta, a) +
          sample(radius + delta, b)) *
        0.25;
      sums[k + 1] = sums[k] + area / ANGLES;
    }
    for (let k = 0; k <= ANGLES; k++) {
      const v = Math.round(sums[k] * 65535),
        offset = 4 * (row * (ANGLES + 1) + k);
      data[offset] = v >>> 8;
      data[offset + 1] = v & 255;
      const mean = Math.round(sums[ANGLES] * 65535);
      data[offset + 2] = mean >>> 8;
      data[offset + 3] = mean & 255;
    }
  }
  const texture = new T.DataTexture(data, ANGLES + 1, RINGS, T.RGBAFormat);
  texture.name = 'Integrated road-wheel spoke coverage';
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const atlases = new Map<string, { texture: T.DataTexture; users: number }>();
function acquire(key: string, geometry: T.BufferGeometry, outer: number) {
  let atlas = atlases.get(key);
  if (!atlas) {
    atlas = { texture: spokeExposureAtlas(geometry, outer), users: 0 };
    atlases.set(key, atlas);
  }
  atlas.users++;
  return atlas.texture;
}
function release(key: string) {
  const atlas = atlases.get(key);
  if (atlas && --atlas.users === 0) {
    atlas.texture.dispose();
    atlases.delete(key);
  }
}

const viewWeight = `
  float roadViewWeight(vec3 local) {
    vec3 wheelAxis=normalize(modelMatrix[0].xyz);
    vec3 sight=normalize(cameraPosition-(modelMatrix*vec4(local,1.)).xyz);
    return smoothstep(.12,.45,abs(dot(sight,wheelAxis)));
  }`;
const clipVertex = `
  uniform vec3 roadShutter;
  ${viewWeight}
`;
const sweepWeight = `smoothstep(${startSweep},${fullSweep},sweep)`;

/** Rims and hubs still render at the wheel's exact recorded angle. Cull only
 * the resolved share of the spokes; solid faces return at a grazing view. */
function installWheelMask(material: T.Material, shutter: { value: T.Vector3 }) {
  chainShaderHook(material, 'road-wheel-shutter-mask-v1', (shader) => {
    shader.uniforms.roadShutter = shutter;
    injectDeclarations(
      shader,
      'common',
      `attribute vec2 roadSpoke; varying float roadFade; ${clipVertex}`,
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      `
      float sweep=mix(roadShutter.x,roadShutter.y,step(roadShutter.z,roadSpoke.y));
      roadFade=roadSpoke.x*${sweepWeight}*roadViewWeight(transformed);`,
      'vertex',
    );
    injectDeclarations(shader, 'common', 'varying float roadFade;', 'fragment');
    injectAfter(
      shader,
      'alphatest_fragment',
      `
      if(roadFade>.0001){
        // Fixed coverage pattern during a held frame; the resolving interval
        // is short and the opaque rim, disc and hub never enter this branch.
        float threshold=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
        if(roadFade>threshold) discard;
      }`,
      'fragment',
    );
  });
}

/** One draw per exposed wheel. A dished, double-sided sheet represents the
 * same spokes averaged during the shutter. The wheel barrel, hub, disc and
 * stationary caliper retain their three-dimensional depth and occlusion. */
function exposureSurface(outer: number, halfWidth: number, detail: RiderDetail) {
  const pieces = detail === 'high' ? 40 : 24,
    p: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  for (let j = 0; j < 3; j++) {
    const v = j / 2,
      radius = T.MathUtils.lerp(INNER, outer, v),
      x = halfWidth * (0.17 - 0.24 * v);
    for (let k = 0; k <= pieces; k++) {
      const t = k / pieces,
        a = t * TURNS;
      p.push(x, radius * Math.cos(a), radius * Math.sin(a));
      uv.push(t, v);
      if (j < 2 && k < pieces) {
        const i = j * (pieces + 1) + k;
        idx.push(i, i + pieces + 1, i + 1, i + 1, i + pieces + 1, i + pieces + 2);
      }
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class RoadWheelExposure {
  private readonly shutter = { value: new T.Vector3(0, 0, 0.08) };
  private readonly masks = new Set<T.Material>();
  private readonly frontLayers: T.Mesh[] = [];
  private readonly rearLayers: T.Mesh[] = [];
  private readonly surfaces = new Map<string, T.MeshStandardMaterial>();
  update(front: number | undefined, rear: number | undefined) {
    const nextFront = wheelExposureTurns(front), nextRear = wheelExposureTurns(rear);
    if ((this.shutter.value.x > startSweep) !== (nextFront > startSweep))
      for (const layer of this.frontLayers) layer.visible = nextFront > startSweep;
    if ((this.shutter.value.y > startSweep) !== (nextRear > startSweep))
      for (const layer of this.rearLayers) layer.visible = nextRear > startSweep;
    this.shutter.value.x = nextFront;
    this.shutter.value.y = nextRear;
  }
  layer(
    geometry: T.BufferGeometry,
    base: T.MeshStandardMaterial,
    design: string,
    rim: number,
    halfWidth: number,
    threshold: number,
    front: boolean,
    detail: RiderDetail,
    outer = rim - 0.012,
  ) {
    if (detail === 'far') return;
    this.shutter.value.z = threshold;
    if (!this.masks.has(base)) {
      installWheelMask(base, this.shutter);
      this.masks.add(base);
    }
    const key = [design, outer, halfWidth, detail].join('/');
    const surfaceKey = key + (front ? '/front' : '/rear');
    let surface = this.surfaces.get(surfaceKey);
    if (!surface) {
      const atlas = acquire(key, geometry, outer);
      surface = new T.MeshStandardMaterial({
        color: base.color,
        metalness: base.metalness,
        roughness: Math.max(0.46, base.roughness),
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        name: 'Exposed ' + design + ' wheel spokes',
      });
      surface.forceSinglePass = true;
      const shutter = this.shutter;
      chainShaderHook(surface, 'road-wheel-averaged-spokes-v1', (shader) => {
        shader.uniforms.roadShutter = shutter;
        shader.uniforms.roadSpokeAtlas = { value: atlas };
        shader.uniforms.roadFrontWheel = { value: front ? 1 : 0 };
        injectDeclarations(
          shader,
          'common',
          `varying vec2 roadPolar; varying float roadFacing;
          uniform float roadFrontWheel; ${clipVertex}`,
          'vertex',
        );
        injectAfter(
          shader,
          'begin_vertex',
          'roadPolar=uv; roadFacing=roadViewWeight(transformed);',
          'vertex',
        );
        injectAfter(
          shader,
          'project_vertex',
          `if(mix(roadShutter.y,roadShutter.x,roadFrontWheel)<=${startSweep}) gl_Position=vec4(2.,2.,2.,1.);`,
          'vertex',
        );
        injectDeclarations(
          shader,
          'common',
          `
          uniform sampler2D roadSpokeAtlas; uniform vec3 roadShutter; uniform float roadFrontWheel;
          varying vec2 roadPolar; varying float roadFacing;
          float roadPrefix(float turns,float r){
            vec4 data=texture2D(roadSpokeAtlas,vec2((fract(turns)*${ANGLES}.+.5)/${ANGLES + 1}.,(r*${RINGS - 1}.+.5)/${RINGS}.));
            vec2 decode=vec2(65280.,255.)/65535.;
            return floor(turns)*dot(data.ba,decode)+dot(data.rg,decode);
          }`,
          'fragment',
        );
        injectAfter(
          shader,
          'color_fragment',
          `
          float sweep=mix(roadShutter.y,roadShutter.x,roadFrontWheel);
          float span=max(sweep,min(.3,fwidth(roadPolar.x)));
          float lo=roadPolar.x-span*.5,hi=roadPolar.x+span*.5;
          float coverage=(roadPrefix(hi,roadPolar.y)-roadPrefix(lo,roadPolar.y))/max(span,.0001);
          diffuseColor.a*=clamp(coverage,0.,1.)*${sweepWeight}*roadFacing;
          if(diffuseColor.a<.004) discard;`,
          'fragment',
        );
      });
      surface.addEventListener('dispose', () => release(key));
      this.surfaces.set(surfaceKey, surface);
    }
    const mesh = new T.Mesh(exposureSurface(outer, halfWidth, detail), surface);
    mesh.name = 'Rotational exposure of ' + (front ? 'front' : 'rear') + ' spokes';
    mesh.raycast = () => {};
    (front ? this.frontLayers : this.rearLayers).push(mesh);
    mesh.visible = (front ? this.shutter.value.x : this.shutter.value.y) > startSweep;
    return mesh;
  }
  dispose() {
    for (const surface of this.surfaces.values()) surface.dispose();
    this.frontLayers.length = this.rearLayers.length = 0;
    this.surfaces.clear();
    this.masks.clear();
  }
}
