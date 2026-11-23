import { mod, smooth } from '../core/math.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { injectAfter, injectDeclarations, type StudioShader } from './studio/shader-hooks.ts';

/** Edge painting follows the corner's approach on the inside, and its exit
 * on the outside. Render ribbons query this short periodic table instead of
 * resampling the spline for every 16 cm corrugation and every cross-section. */
export class FormulaEdgeProfile {
  private readonly samples: Float32Array;
  readonly count: number;
  constructor(
    private readonly length: number,
    curvatureAt: (s: number) => number,
  ) {
    this.count = Math.ceil(length / 4);
    this.samples = new Float32Array(this.count * 2);
    for (let i = 0; i < this.count; i++) {
      const s = (i * length) / this.count;
      const here = curvatureAt(s),
        ahead = curvatureAt(s + 23),
        behind = curvatureAt(s - 39);
      for (const side of [-1, 1]) {
        const demand = Math.max(
          here * side,
          ahead * side * 0.8,
          -here * side * 0.83,
          -behind * side * 0.92,
        );
        this.samples[2 * i + (side > 0 ? 1 : 0)] = smooth(0.0034, 0.0068, demand);
      }
    }
  }
  static forTrack(track: Track) {
    const point = trackPoint();
    return new FormulaEdgeProfile(track.length, (s) => track.at(s, point).curvature);
  }
  at(s: number, side: number) {
    const u = (mod(s, this.length) * this.count) / this.length;
    const i = Math.floor(u),
      k = side > 0 ? 1 : 0;
    const a = this.samples[2 * i + k];
    return a + (this.samples[2 * ((i + 1) % this.count) + k] - a) * (u - i);
  }
}

/** The same corner coverage drives both adjoining materials. A shared uniform
 * switches a mixed/replay session in place without replacing materials. */
export function bindFormulaEdge(shader: StudioShader, active: { value: number }) {
  shader.uniforms.apexFormulaEdge = active;
  injectDeclarations(
    shader,
    'common',
    'attribute float formulaCorner; varying float vFormulaCorner;',
    'vertex',
  );
  injectAfter(shader, 'begin_vertex', 'vFormulaCorner = formulaCorner;', 'vertex');
  injectDeclarations(
    shader,
    'common',
    'uniform float apexFormulaEdge; varying float vFormulaCorner;',
    'fragment',
  );
}

export const FORMULA_KERB_COLOUR = /* glsl */ `
  // Unpainted precast along straights. The sealed joints are narrow up close
  // and converge to their coverage when the kerb recedes in the mirror.
  float plain = apexFormulaEdge * (1.0 - smoothstep(.36, .58, vFormulaCorner));
  float jointPhase = vFinishMetres.y / 2.4;
  float joint = apexStripeCoverage(jointPhase, max(fwidth(jointPhase), .0005), .005);
  vec3 casting = vec3(.265, .257, .237) * (.80 + .22 * grit + .09 * grime);
  casting *= 1.0 - .38 * joint;
  casting = mix(casting, vec3(.047, .045, .042), .50 * kerbWear);
  paint = mix(paint, casting, plain);
`;

export const FORMULA_APRON_COLOUR = /* glsl */ `
  // Tarmac shoulder and the sealed seam of the narrow kerb drain on the
  // straights. Corner escape paint resumes on entry and follows the exit side.
  float plain = apexFormulaEdge * (1.0 - smoothstep(.36, .58, vFormulaCorner));
  float footprint = max(fwidth(e), .004);
  float channel = 1.0 - smoothstep(.042, .042 + footprint, abs(e - 1.26));
  vec3 shoulder = base * (.73 + .13 * grain);
  shoulder = mix(shoulder, vec3(.052, .057, .056), channel * min(1.0, .084 / footprint));
  surface = mix(surface, shoulder, plain);
`;
