import * as T from 'three';
import { clamp } from '../core/math.ts';
import type { RoadBikeWheelPose } from './road-bike-pose.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';

/** Loaded GP slicks. The spring rates are presentation calibration for the
 * original tyres. Belt stiffness contributes at low inflation, while a hot,
 * highly inflated tyre flattens less under the same recorded axle load. */
export function gpTyreDeflection(load: number, pressure: number, rear: boolean) {
  if (!(load > 0) || !Number.isFinite(load)) return 0;
  const inflation = Number.isFinite(pressure) && pressure > 0 ? clamp(pressure, 65, 330) : 180;
  const rate = rear ? 85000 + 605 * inflation : 71000 + 490 * inflation;
  return Math.min(load / rate, rear ? 0.018 : 0.016);
}

/** The spinning skin and its sidewall paint follow a contact plane fixed in
 * the world. The rim, brake hardware and bead stay rigid. Uniforms are per
 * entrant, shared by both axles, their shadow passes and all model LODs. */
export class GpTyreCarcass {
  private readonly front = { value: new T.Vector4(0, 1, 0, 0) };
  private readonly rear = { value: new T.Vector4(0, 1, 0, 0) };
  private readonly squash = { value: new T.Vector2() };
  readonly depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
  readonly distance = new T.MeshDistanceMaterial();

  constructor(rubber: T.MeshStandardMaterial, paint: T.MeshStandardMaterial) {
    this.install(rubber, true);
    this.install(paint, true);
    this.install(this.depth, false);
    this.install(this.distance, false);
  }
  update(wheels: RoadBikeWheelPose | undefined) {
    if (!wheels) {
      this.squash.value.set(0, 0);
      return;
    }
    this.front.value.copy(wheels.carcassPlanes[0]);
    this.rear.value.copy(wheels.carcassPlanes[1]);
    this.squash.value.copy(wheels.carcassDeflection);
  }
  private install(material: T.Material, lit: boolean) {
    chainShaderHook(material, 'gp-loaded-slick-v1', (shader) => {
      Object.assign(shader.uniforms, {
        gpFootFront: this.front,
        gpFootRear: this.rear,
        gpFootSquash: this.squash,
      });
      if (!shader.vertexShader.includes('attribute vec4 gpTyreBind;'))
        injectDeclarations(shader, 'common', 'attribute vec4 gpTyreBind;', 'vertex');
      injectDeclarations(
        shader,
        'common',
        'uniform vec4 gpFootFront, gpFootRear; uniform vec2 gpFootSquash;',
        'vertex',
      );
      injectAfter(
        shader,
        'batching_vertex',
        `
        vec3 gpLift = vec3(0.), gpFootNormal = vec3(0.,1.,0.);
        float gpFlat = 0.;
        float gpIsRear = step(.08, gpTyreBind.w);
        float gpIndent = mix(gpFootSquash.x, gpFootSquash.y, gpIsRear);
        if (gpTyreBind.w > .025 && gpIndent > .00001) {
          vec4 wheel = mix(gpFootFront, gpFootRear, gpIsRear);
          gpFootNormal = normalize((vec4(wheel.xyz,0.) * modelMatrix).xyz);
          float h = dot(gpFootNormal, gpTyreBind.xyz) + wheel.w;
          float blend = max(.0001, .32 * gpIndent);
          float roundEdge = max(blend-abs(h),0.);
          gpLift = gpFootNormal * (max(0.,-h) + roundEdge*roundEdge/(4.*blend));
          gpFlat = clamp(.5-.5*h/blend,0.,1.);
          float flank = smoothstep(.48,.94, abs(gpTyreBind.x)/gpTyreBind.w)
            * smoothstep(.222,.254,length(gpTyreBind.yz)) * (1.-smoothstep(.003,.055,h));
          vec3 sideways = vec3(1.,0.,0.) - gpFootNormal * gpFootNormal.x;
          gpLift += sideways * (sign(gpTyreBind.x) * .28 * gpIndent * flank);
        }
      `,
        'vertex',
      );
      if (lit)
        injectAfter(
          shader,
          'beginnormal_vertex',
          'objectNormal = normalize(mix(objectNormal,-gpFootNormal,gpFlat));',
          'vertex',
        );
      injectAfter(shader, 'begin_vertex', 'transformed += gpLift;', 'vertex');
    });
  }
  dispose() {
    this.depth.dispose();
    this.distance.dispose();
  }
}
