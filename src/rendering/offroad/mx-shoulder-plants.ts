import * as T from 'three';
import { Random } from '../../core/math.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

export type MxPlantKind = 'grass' | 'fern' | 'scrub' | 'tuft' | 'meadow';
type Point = readonly [number, number, number];

/** Maximum local displacement at full tip flexibility. The culling sphere
 * and placement footprint must enclose the same wind used by the shader. */
export const MX_SHOULDER_WIND = Object.freeze({ x: 0.045, z: 0.024, flutter: 0.22 });
export const MX_SHOULDER_WIND_RADIUS =
  Math.hypot(MX_SHOULDER_WIND.x, MX_SHOULDER_WIND.z) * (1 + MX_SHOULDER_WIND.flutter);

/** References 033/035/042/047/051: bent grass with dry tips, arching fern
 * fans and darker, broad-leaf undergrowth. These are small, opaque geometric
 * plants, shared by instances; there are no alpha cards or texture uploads. */
export function mxShoulderPlantGeometry(kind: MxPlantKind): T.BufferGeometry {
  const position: number[] = [],
    colour: number[] = [],
    flexibility: number[] = [],
    random = new Random(
      kind === 'grass'
        ? 47033
        : kind === 'fern'
          ? 42051
          : kind === 'tuft'
            ? 33071
            : kind === 'meadow'
              ? 27119
              : 51047,
    );
  const triangle = (a: Point, b: Point, c: Point, tip = 1, span = 1) => {
    for (const p of [a, b, c]) {
      position.push(...p);
      const f = Math.max(0, Math.min(1, p[1] / span));
      // Linear-light multipliers: shaded crown, olive body, pale dry tips.
      colour.push(0.48 + f * 0.47 * tip, 0.59 + f * 0.34, 0.39 + f * 0.26 * tip);
      flexibility.push(
        f *
          f *
          (kind === 'grass' || kind === 'tuft' || kind === 'meadow'
            ? 1
            : kind === 'fern'
              ? 0.65
              : 0.35),
      );
    }
  };
  if (kind === 'meadow') {
    // Uncut field grass seen from a few metres to a few tens: a leaning fan of
    // eleven blades, one triangle each, 28-55 cm. Cheap enough to scatter by the
    // thousand; individually bent so the field reads as grass, not as cards.
    for (let i = 0; i < 11; i++) {
      const angle = i * 2.39996 + random.next() * 0.45,
        dx = Math.cos(angle),
        dz = Math.sin(angle),
        height = 0.28 + Math.pow(random.next(), 1.2) * 0.27,
        lean = 0.05 + random.next() * 0.16,
        base = 0.02 + random.next() * 0.1,
        width = 0.012 + random.next() * 0.01;
      const at = (t: number, side: number): Point => {
        const spread = base + lean * t * t,
          w = width * (1 - t * 0.85) * side;
        return [dx * spread - dz * w, height * (t - 0.2 * t * t), dz * spread + dx * w];
      };
      triangle(at(0, -1), at(0, 1), at(1, 0), i % 4 === 0 ? 1.2 : 0.95, height * 0.8);
    }
  } else if (kind === 'tuft') {
    // Short cropped turf: seven thin blades, one kinked triangle each, 8-22 cm.
    // Many of these line the course edge where the long grass islands thin out.
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.39996 + random.next() * 0.5,
        dx = Math.cos(angle),
        dz = Math.sin(angle),
        height = 0.08 + Math.pow(random.next(), 1.4) * 0.15,
        lean = 0.025 + random.next() * 0.07,
        base = 0.008 + random.next() * 0.022,
        width = 0.0075 + random.next() * 0.0055;
      const at = (t: number, side: number): Point => {
        const spread = base + lean * t * t,
          w = width * (1 - t) * side;
        return [dx * spread - dz * w, height * (t - 0.18 * t * t), dz * spread + dx * w];
      };
      const span = height * 0.85;
      triangle(at(0, -1), at(0, 1), at(0.5, -0.6), i % 3 === 0 ? 1.12 : 0.9, span);
      triangle(at(0, 1), at(0.5, 0.6), at(0.5, -0.6), 1, span);
      triangle(at(0.5, -0.6), at(0.5, 0.6), at(1, 0), 1, span);
    }
  } else if (kind === 'grass') {
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.39996 + random.next() * 0.36,
        dx = Math.cos(angle),
        dz = Math.sin(angle),
        height = 0.52 + random.next() * 0.5,
        bend = 0.22 + random.next() * 0.25,
        base = 0.04 + random.next() * 0.09,
        width = 0.025 + random.next() * 0.017;
      const at = (t: number, side: number): Point => {
        const spread = base + bend * t * t,
          w = width * (1 - t) * side;
        return [dx * spread - dz * w, height * (t - 0.22 * t * t), dz * spread + dx * w];
      };
      // A real bend halfway along the blade, followed by a tapered point.
      triangle(at(0, -1), at(0, 1), at(0.56, -1), i % 3 === 0 ? 1.15 : 0.9);
      triangle(at(0, 1), at(0.56, 1), at(0.56, -1));
      triangle(at(0.56, -1), at(0.56, 1), at(1, 0));
    }
  } else if (kind === 'fern') {
    for (let frond = 0; frond < 6; frond++) {
      const angle = frond * 2.39996,
        dx = Math.cos(angle),
        dz = Math.sin(angle),
        reach = 0.56 + random.next() * 0.27,
        height = 0.5 + random.next() * 0.3;
      const stem = (t: number): Point => [
        dx * reach * t,
        height * Math.sin(t * Math.PI * 0.72),
        dz * reach * t,
      ];
      for (let pair = 0; pair < 6; pair++) {
        const t = 0.18 + pair * 0.12,
          centre = stem(t),
          ahead = stem(t + 0.1),
          length = (0.11 + 0.14 * Math.sin(t * Math.PI)) * (1 - t * 0.5);
        for (const side of [-1, 1]) {
          const leaf: Point = [
            centre[0] - dz * length * side + dx * 0.075,
            centre[1] - 0.035,
            centre[2] + dx * length * side + dz * 0.075,
          ];
          const ridge: Point = [
            (centre[0] + leaf[0]) / 2,
            centre[1] + 0.026,
            (centre[2] + leaf[2]) / 2,
          ];
          triangle(centre, ridge, leaf, 0.8);
          triangle(ridge, ahead, leaf, 0.8);
        }
      }
      const foot = stem(0),
        mid = stem(0.5),
        tip = stem(1);
      triangle([foot[0] - dz * 0.008, 0, foot[2] + dx * 0.008], mid, tip, 0.65);
    }
  } else {
    for (let branch = 0; branch < 7; branch++) {
      const angle = branch * 2.39996,
        dx = Math.cos(angle),
        dz = Math.sin(angle),
        reach = 0.2 + random.next() * 0.37,
        height = 0.43 + random.next() * 0.47;
      const top: Point = [dx * reach, height, dz * reach];
      triangle([-dz * 0.01, 0, dx * 0.01], [dz * 0.01, 0, -dx * 0.01], top, 0.45);
      for (let leaf = 0; leaf < 5; leaf++) {
        const t = 0.35 + leaf * 0.14,
          a = angle + (leaf % 2 ? 1.5 : -1.5),
          vx = Math.cos(a),
          vz = Math.sin(a),
          length = 0.13 + random.next() * 0.1,
          width = length * 0.42,
          base: Point = [top[0] * t, top[1] * t, top[2] * t],
          tip: Point = [base[0] + vx * length, base[1] + 0.07, base[2] + vz * length],
          left: Point = [
            base[0] + vx * length * 0.45 - vz * width,
            base[1] + 0.07,
            base[2] + vz * length * 0.45 + vx * width,
          ],
          right: Point = [
            base[0] + vx * length * 0.45 + vz * width,
            base[1] + 0.045,
            base[2] + vz * length * 0.45 - vx * width,
          ];
        triangle(base, left, tip, 0.8);
        triangle(base, tip, right, 0.8);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.name = `MX formed ${kind} leaves`;
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colour, 3));
  geometry.setAttribute('mxPlantFlex', new T.Float32BufferAttribute(flexibility, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  // Keep the unbent box for terrain/clearance probes, then expand the sphere
  // used by InstancedMesh frustum culling so moving tips cannot pop at an edge.
  geometry.boundingSphere!.radius += MX_SHOULDER_WIND_RADIUS;
  return geometry;
}

/** One clock per venue. Absolute simulation time makes a paused frame still
 * and a backwards replay seek reproduce the same bend, without integration. */
export function mxShoulderPlantMaterial(time: { value: number }) {
  const material = new T.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.93,
    side: T.DoubleSide,
    name: 'MX living shoulder foliage',
  });
  chainShaderHook(material, 'mx-shoulder-wind-v1', (shader) => {
    shader.uniforms.mxPlantTime = time;
    injectDeclarations(
      shader,
      'common',
      'attribute float mxPlantFlex;\nuniform float mxPlantTime;',
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      `
      vec4 mxPlantAnchor = vec4( 0.0, 0.0, 0.0, 1.0 );
      #ifdef USE_INSTANCING
        mxPlantAnchor = instanceMatrix * mxPlantAnchor;
      #endif
      mxPlantAnchor = modelMatrix * mxPlantAnchor;
      float mxGust = sin( mxPlantTime * 1.45 + dot( mxPlantAnchor.xz, vec2( 0.14, 0.09 ) ) );
      float mxFlutter = sin( mxPlantTime * 3.1 + dot( mxPlantAnchor.xz, vec2( 0.7, -0.43 ) ) );
      transformed.xz += vec2( ${MX_SHOULDER_WIND.x}, ${MX_SHOULDER_WIND.z} ) * mxPlantFlex *
        ( mxGust + ${MX_SHOULDER_WIND.flutter} * mxFlutter );
    `,
      'vertex',
    );
    // Thin blades transmit sunlight: seen against a low sun, a leaf glows
    // yellow-green instead of reading as a dark card. The directional light
    // here already carries its shadow, so shaded plants stay unlit.
    injectAfter(
      shader,
      'lights_fragment_begin',
      `
      #if ( NUM_DIR_LIGHTS > 0 )
      {
        float mxBacklit = saturate( -dot( geometryNormal, directLight.direction ) );
        float mxThrough = saturate( dot( geometryViewDir, -directLight.direction ) );
        reflectedLight.directDiffuse += directLight.color * material.diffuseColor
          * vec3( 0.95, 1.12, 0.55 ) * RECIPROCAL_PI * mxBacklit
          * ( 0.3 + 0.7 * mxThrough * mxThrough ) * 0.55;
      }
      #endif
    `,
      'fragment',
    );
  });
  return material;
}

// Leave room at the image edge for the compositor’s subpixel projection jitter.
const shoulderCullMargin = new T.Matrix4().makeScale(0.97, 0.97, 1);
const SHOULDER_VIEW_RESERVE = 2; // metres beyond each surveyed plane

/** The source batch holds the authored quality prefix for every camera. The
 * colour view can skip whole cells outside its frustum without adding draws
 * or changing which instance supplies a leaf's colour and wind phase. */
export class MxShoulderView {
  private readonly view: T.InstancedMesh;
  private readonly cells: T.Box3[] = [];
  private readonly cellFor: Uint32Array;
  private readonly visible: Uint8Array;
  private readonly clip = new T.Matrix4();
  private readonly frustum = new T.Frustum();
  private readonly surveyed = new T.Frustum();
  private readonly lastClip = new T.Matrix4();
  private previousCount = -1;

  constructor(private readonly source: T.InstancedMesh) {
    const capacity = source.instanceMatrix.count;
    this.view = new T.InstancedMesh(source.geometry, source.material, capacity);
    this.view.name = source.name + ' in camera';
    this.view.matrixAutoUpdate = false;
    this.view.boundingSphere = source.boundingSphere;
    this.view.instanceMatrix.setUsage(T.DynamicDrawUsage);
    // All four painted plant families have a per-instance tint.
    this.view.setColorAt(0, new T.Color());
    this.view.instanceColor!.setUsage(T.DynamicDrawUsage);
    this.cellFor = new Uint32Array(capacity);
    const index = new Map<string, number>(), pose = new T.Matrix4(), sphere = new T.Sphere(),
      bounds = new T.Box3();
    for (let i = 0; i < capacity; i++) {
      source.getMatrixAt(i, pose);
      // The source sphere already includes both extremes of blade animation.
      sphere.copy(source.geometry.boundingSphere!).applyMatrix4(pose);
      const key = Math.floor(sphere.center.x / 16) + ',' + Math.floor(sphere.center.z / 16);
      let cell = index.get(key);
      if (cell === undefined) {
        cell = this.cells.length;
        this.cells.push(new T.Box3());
        index.set(key, cell);
      }
      this.cells[cell].union(sphere.getBoundingBox(bounds));
      this.cellFor[i] = cell;
    }
    this.visible = new Uint8Array(this.cells.length);
  }

  private withinSurveyReserve() {
    const { center, radius } = this.source.boundingSphere!;
    for (let i = 0; i < this.frustum.planes.length; i++) {
      const current = this.frustum.planes[i], old = this.surveyed.planes[i];
      const dx = current.normal.x - old.normal.x, dy = current.normal.y - old.normal.y,
        dz = current.normal.z - old.normal.z;
      const centreShift = dx * center.x + dy * center.y + dz * center.z + current.constant - old.constant;
      // A linear plane distance changes by at most this much anywhere in
      // the batch sphere, including a blade at the far edge of the course.
      if (Math.abs(centreShift) + radius * Math.hypot(dx, dy, dz) > SHOULDER_VIEW_RESERVE)
        return false;
    }
    return true;
  }

  private selectCells(camera: T.Camera) {
    this.clip.multiplyMatrices(shoulderCullMargin, camera.projectionMatrix)
      .multiply(camera.matrixWorldInverse).multiply(this.source.matrixWorld);
    if (this.previousCount >= 0 && this.lastClip.equals(this.clip)) return false;
    this.lastClip.copy(this.clip);
    this.frustum.setFromProjectionMatrix(this.clip, camera.coordinateSystem, camera.reversedDepth);
    if (this.previousCount >= 0 && this.withinSurveyReserve()) return false;
    this.surveyed.copy(this.frustum);
    for (const plane of this.frustum.planes) plane.constant += SHOULDER_VIEW_RESERVE;
    let changed = false;
    for (let i = 0; i < this.cells.length; i++) {
      const visible = this.frustum.intersectsBox(this.cells[i]) ? 1 : 0;
      if (visible !== this.visible[i]) changed = true;
      this.visible[i] = visible;
    }
    return changed;
  }

  begin(camera: T.Camera) {
    const source = this.source, view = this.view;
    if (!source.visible || !source.parent || !source.layers.test(camera.layers)) return;
    source.updateWorldMatrix(true, false);
    const changed = this.selectCells(camera) || source.count !== this.previousCount;
    if (changed) {
      let count = 0;
      for (let i = 0; i < source.count; i++) {
        if (!this.visible[this.cellFor[i]]) continue;
        view.instanceMatrix.copyAt(count, source.instanceMatrix, i);
        view.instanceColor!.copyAt(count, source.instanceColor!, i);
        count++;
      }
      view.count = count;
      for (const attribute of [view.instanceMatrix, view.instanceColor!]) {
        attribute.clearUpdateRanges();
        if (count > 0) {
          attribute.addUpdateRange(0, count * attribute.itemSize);
          attribute.needsUpdate = true;
        }
      }
      this.previousCount = source.count;
    }
    view.visible = view.count > 0;
    view.matrix.copy(source.matrix);
    view.matrixWorldNeedsUpdate = true;
    view.layers.mask = source.layers.mask;
    view.material = source.material;
    view.renderOrder = source.renderOrder;
    view.receiveShadow = source.receiveShadow;
    source.parent.add(view);
    source.visible = false;
  }

  end() {
    if (!this.view.parent) return;
    this.view.removeFromParent();
    this.source.visible = true;
  }

  dispose() {
    this.end();
    this.view.dispose();
  }
}
