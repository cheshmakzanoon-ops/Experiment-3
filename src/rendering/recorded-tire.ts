import * as T from 'three';
import { clamp } from '../core/math.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';
import type { WheelContactPose } from './wheel-contact.ts';
import { inheritSuppliedCoverageControl } from './supplied-player-materials.ts';
import { inheritSuppliedShaderWorkControl } from './supplied-shader-work.ts';

/** Rubber displacement in the non-spinning wheel frame. Recorded strain is
 * a metric displacement, not a visual force filter. The only presentation
 * bounds protect the rigid bead and limit badly damaged rubber to 4 cm shear.
 * The same function is installed in lit and shadow passes. */
export const RECORDED_TIRE_GLSL = /* glsl */ `
uniform mat4 contactToWheel;
uniform mat4 contactFromWheel;
uniform vec4 contactShape; // authored crown radius, bead radius, spin phase, valid
uniform vec2 contactSpin; // sin/cos computed once from the recorded wheel phase
uniform vec3 contactCompression; // free radius, radial compression, plane distance
uniform vec3 contactNormal;
uniform vec2 contactShear; // forward strain, lateral slip strain

vec3 recordedTirePosition( vec3 original ) {
  if ( contactShape.w < 0.5 ) return original;
  vec3 p = ( contactToWheel * vec4( original, 1.0 ) ).xyz;
  float radial = length( p.yz );
  float crown = clamp( ( radial - contactShape.y ) / ( contactShape.x - contactShape.y ), 0.0, 1.0 );
  // Scaling only the crown leaves the rim and bead at their authored radius.
  p.yz *= 1.0 + ( contactCompression.x - contactShape.x ) * crown / max( contactShape.y, radial );
  // Share the CPU pose's rotation across every vertex and shadow pass. GPU
  // trig approximations need not preserve sin^2 + cos^2 = 1; using them for
  // this forward/inverse pair can scale even an unloaded tyre and its bead.
  float sn = contactSpin.x, cs = contactSpin.y;
  p.yz = vec2( p.y * cs - p.z * sn, p.y * sn + p.z * cs );
  float low = clamp( -dot( p, contactNormal ) / max( 0.01, contactCompression.x ), 0.0, 1.0 );
  float contactWeight = low * low * low * low * crown;
  // RoadContactFrame: rolling forward = axle cross normal, lateral = normal cross forward.
  float plane = max( 1e-8, length( contactNormal.yz ) );
  vec3 forward = vec3( 0.0, -contactNormal.z / plane, contactNormal.y / plane );
  vec3 lateral = vec3( plane, -contactNormal.x * contactNormal.yz / plane );
  float side = sign( p.x );
  p += ( contactShear.x * forward - contactShear.y * lateral ) * contactWeight;
  p.x += side * contactCompression.y * 0.35 * contactWeight;
  float penetration = -contactCompression.z - dot( p, contactNormal );
  // A free airborne crown is never clipped against an old or tilted plane.
  if ( contactCompression.y > 0.0 && crown > 0.0 && penetration > 0.0 )
    p += contactNormal * penetration;
  p.yz = vec2( p.y * cs + p.z * sn, -p.y * sn + p.z * cs );
  return ( contactFromWheel * vec4( p, 1.0 ) ).xyz;
}
`;

export const RECORDED_TIRE_NORMAL_GLSL = /* glsl */ `
if ( contactShape.w > 0.5 ) {
  // Differentiate the same bounded displacement in two surface directions.
  // This works through arbitrary authored wheel transforms and preserves
  // their smooth normals away from the contact patch.
  vec3 cn = normalize( objectNormal );
  vec3 ct = normalize( cross( abs( cn.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ), cn ) );
  vec3 cb = cross( cn, ct );
  float ht = 0.0001 / max( 1e-8, length( mat3( contactToWheel ) * ct ) );
  float hb = 0.0001 / max( 1e-8, length( mat3( contactToWheel ) * cb ) );
  vec3 dt = recordedTirePosition( position + ct * ht ) - recordedTirePosition( position - ct * ht );
  vec3 db = recordedTirePosition( position + cb * hb ) - recordedTirePosition( position - cb * hb );
  vec3 dn = cross( dt, db );
  if ( dot( dn, dn ) > 1e-20 ) objectNormal = normalize( dn );
  #ifdef USE_TANGENT
    float hr = 0.0001 / max( 1e-8, length( mat3( contactToWheel ) * objectTangent ) );
    vec3 rt = recordedTirePosition( position + objectTangent * hr ) - recordedTirePosition( position - objectTangent * hr );
    if ( dot( rt, rt ) > 1e-20 ) objectTangent = normalize( rt );
  #endif
}
`;

const boundsMargin = new WeakMap<T.BufferGeometry, number>();

/** One wheel's immutable bind dimensions and current recorded pose. Catalogue
 * rubber is non-spinning (phase 0 here, tread rolls in its material); imported
 * rubber rotates with its mesh and supplies that mesh's exact recorded phase. */
export class RecordedTire {
  readonly uniforms: {
    contactShape: T.IUniform<T.Vector4>;
    contactSpin: T.IUniform<T.Vector2>;
    contactCompression: T.IUniform<T.Vector3>;
    contactNormal: T.IUniform<T.Vector3>;
    contactShear: T.IUniform<T.Vector2>;
  };
  constructor(
    readonly radius: number,
    readonly bead: number,
  ) {
    if (!Number.isFinite(radius + bead) || bead <= 0 || radius <= bead + 0.007)
      throw new Error('Invalid tire bind dimensions');
    this.uniforms = {
      contactShape: { value: new T.Vector4(radius, bead, 0, 0) },
      contactSpin: { value: new T.Vector2(0, 1) },
      contactCompression: { value: new T.Vector3(radius, 0, radius) },
      contactNormal: { value: new T.Vector3(0, 1, 0) },
      contactShear: { value: new T.Vector2() },
    };
  }

  update(phase: number, radius: number, flatSpot: number, contact?: WheelContactPose) {
    const u = this.uniforms;
    // Clear every dynamic value when the solver does not provide this model.
    // Menus and GP/MX therefore retain their own authored presentation paths.
    u.contactShape.value.z = 0;
    u.contactShape.value.w = 0;
    u.contactSpin.value.set(0, 1);
    u.contactCompression.value.set(this.radius, 0, this.radius);
    u.contactNormal.value.set(0, 1, 0);
    u.contactShear.value.set(0, 0);
    if (!contact?.valid) return;
    if (
      !Number.isFinite(
        phase +
          radius +
          flatSpot +
          contact.radial +
          contact.planeDistance +
          contact.longitudinal +
          contact.lateral +
          contact.normalX +
          contact.normalY +
          contact.normalZ,
      ) ||
      Math.hypot(contact.normalY, contact.normalZ) < 1e-8 ||
      contact.radial < 0
    )
      throw new Error('Invalid tire contact presentation');
    const free = clamp(
      (radius || this.radius) - clamp(flatSpot, 0, 1) * 0.002 * (1 + Math.cos(phase)),
      this.bead + 0.007,
      this.radius,
    );
    u.contactShape.value.z = phase;
    u.contactShape.value.w = 1;
    u.contactSpin.value.set(Math.sin(phase), Math.cos(phase));
    u.contactCompression.value.set(
      free,
      clamp(contact.radial, 0, free - this.bead - 0.006),
      clamp(contact.planeDistance, this.bead + 0.006, free),
    );
    u.contactNormal.value.set(contact.normalX, contact.normalY, contact.normalZ).normalize();
    u.contactShear.value.set(
      clamp(contact.longitudinal, -0.04, 0.04),
      clamp(contact.lateral, -0.04, 0.04),
    );
  }

  /** Bind rubber only. `toWheel` maps authored vertices into the wheel's
   * non-steered bind frame; the caller owns any material copies it supplies.
   * Lit and depth materials share the very same pose uniform objects. */
  bind(mesh: T.Mesh, toWheel = new T.Matrix4()) {
    if (Array.isArray(mesh.material)) throw new Error('Tire primitives require one material');
    if (!toWheel.elements.every(Number.isFinite) || Math.abs(toWheel.determinant()) < 1e-12)
      throw new Error('Invalid tire bind transform');
    const binding = {
      ...this.uniforms,
      contactToWheel: { value: toWheel.clone() },
      contactFromWheel: { value: toWheel.clone().invert() },
    };
    const install = (material: T.Material, normals: boolean) => {
      chainShaderHook(material, 'recorded-tire-contact-v2', (shader) => {
        Object.assign(shader.uniforms, binding);
        injectDeclarations(shader, 'common', RECORDED_TIRE_GLSL, 'vertex');
        // Override a legacy load-only deformation only when measured data exists.
        injectAfter(
          shader,
          'begin_vertex',
          'if ( contactShape.w > 0.5 ) transformed = recordedTirePosition( position );',
          'vertex',
        );
        if (normals) injectAfter(shader, 'beginnormal_vertex', RECORDED_TIRE_NORMAL_GLSL, 'vertex');
      });
    };
    install(mesh.material, true);
    const m = mesh.material as T.MeshStandardMaterial;
    const cutout = {
      map: m.map ?? null,
      alphaMap: m.alphaMap ?? null,
      alphaTest: m.alphaTest,
      side: m.side,
    };
    mesh.customDepthMaterial = new T.MeshDepthMaterial({
      ...cutout,
      depthPacking: T.RGBADepthPacking,
    });
    mesh.customDistanceMaterial = new T.MeshDistanceMaterial(cutout);
    install(mesh.customDepthMaterial, false);
    install(mesh.customDistanceMaterial, false);
    // A shader cannot update CPU culling bounds. Expand the existing sphere
    // once, in mesh units, for bounded shear/bulge and radius contraction.
    const g = mesh.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const scale = new T.Vector3().setFromMatrixScale(toWheel);
    const margin =
      (0.09 + Math.max(0, this.radius - this.bead)) / Math.min(scale.x, scale.y, scale.z);
    g.boundingSphere!.radius += Math.max(0, margin - (boundsMargin.get(g) ?? 0));
    boundsMargin.set(g, Math.max(margin, boundsMargin.get(g) ?? 0));
    mesh.userData.vertexDisplacementMargin = margin;
  }
}

export function isSuppliedTireRubber(material: T.Material) {
  return (
    material.name.startsWith('Tyre | lightly') ||
    material.name.startsWith('Tyre | compound') ||
    material.name.startsWith('Decal | tyre_')
  );
}

/** The supplied hero stores mesh vertices in source-car coordinates inside a
 * scaled/rotated child. Measure its crown in the spin frame before binding;
 * assuming a procedural radius would sink its larger authored tire into the
 * road when moving the axle to the physical hub. Rigid primitives are excluded. */
export function bindSuppliedTire(spin: T.Object3D, bead = 0.245) {
  spin.updateWorldMatrix(true, true);
  const inverse = spin.matrixWorld.clone().invert();
  const rubber: { mesh: T.Mesh; toWheel: T.Matrix4 }[] = [];
  const p = new T.Vector3();
  let radius = bead + 0.008;
  spin.traverse((o) => {
    if (
      !(o instanceof T.Mesh) ||
      o instanceof T.SkinnedMesh ||
      Array.isArray(o.material) ||
      !isSuppliedTireRubber(o.material)
    )
      return;
    const toWheel = inverse.clone().multiply(o.matrixWorld);
    rubber.push({ mesh: o, toWheel });
    if (!o.material.name.startsWith('Tyre | lightly')) return;
    const positions = o.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i).applyMatrix4(toWheel);
      radius = Math.max(radius, Math.hypot(p.y, p.z));
    }
  });
  const tire = new RecordedTire(radius, bead),
    detached = new Set<T.Material>();
  for (const { mesh, toWheel } of rubber) {
    const source = mesh.material as T.Material;
    const copy = source.clone();
    // Material.clone does not copy hooks. Retain lookdev, decal coverage and
    // per-wheel blur before chaining this primitive's static bind transform.
    copy.onBeforeCompile = source.onBeforeCompile;
    copy.onBeforeRender = source.onBeforeRender;
    copy.customProgramCacheKey = source.customProgramCacheKey;
    inheritSuppliedCoverageControl(source, copy);
    inheritSuppliedShaderWorkControl(source, copy);
    mesh.material = copy;
    tire.bind(mesh, toWheel);
    detached.add(source);
  }
  return { tire, detached, primitives: rubber.length };
}
