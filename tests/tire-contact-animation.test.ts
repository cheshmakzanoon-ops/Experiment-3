import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { TireCarcass } from '../src/rendering/tire-carcass.ts';
import { bindSuppliedTire, RecordedTire } from '../src/rendering/recorded-tire.ts';
import {
  contactCylinderRadius,
  wheelContactPose,
  type WheelContactPose,
} from '../src/rendering/wheel-contact.ts';
import {
  configureSuppliedMaterial,
  suppliedDecalCoverageControl,
} from '../src/rendering/supplied-player-materials.ts';
import {
  installSuppliedShaderWork,
  suppliedShaderWorkControl,
} from '../src/rendering/supplied-shader-work.ts';
import { installSuppliedWheelBlur } from '../src/rendering/studio/wheel-blur.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { BODY_SHEETS } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { WheelAssembly } from '../src/rendering/vehicle-bodies/wheel.ts';

function contact(overrides: Partial<WheelContactPose> = {}): WheelContactPose {
  return {
    ...wheelContactPose(),
    valid: true,
    radial: 0.02,
    planeDistance: 0.315,
    hubLength: 0.23,
    ...overrides,
  };
}
function tireFixture() {
  const tread = new T.MeshStandardMaterial(),
    marking = new T.MeshStandardMaterial();
  const tire = new TireCarcass(0.155, tread, marking);
  const meshes = tire.root.children as T.Mesh[];
  const original = meshes.map((mesh) =>
    Float32Array.from(mesh.geometry.getAttribute('position').array),
  );
  return {
    tire,
    meshes,
    original,
    dispose: () => {
      meshes.forEach((mesh) => mesh.geometry.dispose());
      tread.dispose();
      marking.dispose();
    },
  };
}
const compile = (
  material: T.Material,
  id: 'standard' | 'physical' | 'depth' | 'distanceRGBA' = 'standard',
) => {
  const source = T.ShaderLib[id];
  const shader = {
    uniforms: T.UniformsUtils.clone(source.uniforms),
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
  } as unknown as StudioShader;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};

describe('recorded carcass deformation', () => {
  it.each([0, 0.3, 1.8, -2.1])(
    'keeps the patch on its recorded inclined plane and leaves the bead rigid at phase %f',
    (phase) => {
      const f = tireFixture(),
        normal = new T.Vector3(0.12, 1, -0.08).normalize();
      const measured = contact({
        normalX: normal.x,
        normalY: normal.y,
        normalZ: normal.z,
        longitudinal: 0.005,
        lateral: -0.007,
      });
      try {
        f.tire.update(phase, 0.335, 7000, 100, 0, measured);
        let lowest = Infinity,
          onPlane = 0,
          fixed = 0;
        const spin = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), phase),
          p = new T.Vector3();
        for (let mesh = 0; mesh < f.meshes.length; mesh++) {
          const positions = f.meshes[mesh].geometry.getAttribute('position'),
            normals = f.meshes[mesh].geometry.getAttribute('normal');
          for (let vertex = 0; vertex < positions.count; vertex++) {
            p.fromBufferAttribute(positions, vertex).applyQuaternion(spin);
            const distance = p.dot(normal);
            lowest = Math.min(lowest, distance);
            if (Math.abs(distance + measured.planeDistance) < 1e-6) onPlane++;
            expect(
              Math.hypot(normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex)),
            ).toBeCloseTo(1, 4);
            const old = f.original[mesh],
              radial = Math.hypot(old[vertex * 3 + 1], old[vertex * 3 + 2]);
            if (radial < 0.245001) {
              for (let axis = 0; axis < 3; axis++)
                expect(positions.getComponent(vertex, axis)).toBeCloseTo(old[vertex * 3 + axis], 6);
              fixed++;
            }
          }
        }
        expect(lowest).toBeCloseTo(-measured.planeDistance, 6);
        expect(onPlane).toBeGreaterThan(3);
        expect(fixed).toBeGreaterThan(100);
      } finally {
        f.dispose();
      }
    },
  );

  it('uses the physical strain sign and amount, rather than a force-dependent lag', () => {
    const f = tireFixture();
    try {
      f.tire.update(0, 0.335, 1000, 155, 0, contact());
      const zero = Float32Array.from(f.meshes[0].geometry.getAttribute('position').array);
      f.tire.update(0, 0.335, 1e8, 1, 0, contact({ longitudinal: 0.006, lateral: 0.008 }));
      const positions = f.meshes[0].geometry.getAttribute('position');
      let compared = 0;
      for (let i = 0; i < positions.count; i++) {
        if (
          Math.abs(f.original[0][i * 3 + 1] + 0.335) > 1e-6 ||
          Math.abs(f.original[0][i * 3 + 2]) > 1e-6
        )
          continue;
        expect(positions.getX(i) - zero[i * 3]).toBeCloseTo(-0.008, 6);
        expect(positions.getZ(i) - zero[i * 3 + 2]).toBeCloseTo(0.006, 6);
        expect(positions.getY(i)).toBeCloseTo(-0.315, 6);
        compared++;
      }
      expect(compared).toBeGreaterThan(0);
    } finally {
      f.dispose();
    }
  });

  it('does not flatten an unloaded rotating crown against a tilted or stale road normal', () => {
    const f = tireFixture();
    try {
      f.tire.update(1.2, 0.335, 0, 155, 0, contact({ radial: 0 }));
      const round = f.meshes.map((mesh) =>
        Float32Array.from(mesh.geometry.getAttribute('position').array),
      );
      const n = new T.Vector3(0.7, -0.3, 0.5).normalize();
      f.tire.update(
        1.2,
        0.335,
        0,
        155,
        0,
        contact({ radial: 0, planeDistance: 0.26, normalX: n.x, normalY: n.y, normalZ: n.z }),
      );
      f.meshes.forEach((mesh, i) =>
        expect(mesh.geometry.getAttribute('position').array).toEqual(round[i]),
      );
    } finally {
      f.dispose();
    }
  });

  it('reconstructs the same geometry after intervening phases, and rejects nonfinite contact input', () => {
    const f = tireFixture(),
      measured = contact({ longitudinal: 0.004, lateral: -0.006 });
    try {
      f.tire.update(0.7, 0.335, 4000, 155, 0, measured);
      const saved = f.meshes.map((mesh) =>
        Float32Array.from(mesh.geometry.getAttribute('position').array),
      );
      f.tire.update(-2.1, 0.28, 1000, 50, 0.5, contact({ planeDistance: 0.265 }));
      f.tire.update(0.7, 0.335, 4000, 155, 0, measured);
      f.meshes.forEach((mesh, i) =>
        expect(mesh.geometry.getAttribute('position').array).toEqual(saved[i]),
      );
      expect(() => f.tire.update(0, 0.335, 1, 155, 0, contact({ lateral: NaN }))).toThrow(
        'Non-finite',
      );
      expect(() => f.tire.update(0, 0.335, 1, 155, 0, contact({ normalX: 1, normalY: 0 }))).toThrow(
        'Invalid tire contact',
      );
    } finally {
      f.dispose();
    }
  });
});

describe('recorded GPU tire binding', () => {
  it('shares physical pose across catalogue lit and shadow passes while preserving rigid parts', () => {
    const sheet = Object.values(BODY_SHEETS).find((sheet) => sheet.wheels.rimRadius < 0.3)!.wheels;
    const wheel = new WheelAssembly(0.335, 1, true, sheet, 0);
    const rim = wheel.spin.getObjectByName('Rim') as T.Mesh;
    const rimPosition = Float32Array.from(rim.geometry.getAttribute('position').array);
    wheel.update(-0.18, 0.2, -0.04, 7.5, 5000, 150, 300, contact({ lateral: 0.005 }), 0.33);
    const lit = compile(wheel.tyre.material as T.Material),
      depth = compile(wheel.tyre.customDepthMaterial!, 'depth'),
      distance = compile(wheel.tyre.customDistanceMaterial!, 'distanceRGBA');
    expect(wheel.pivot.position.y).toBe(-0.18);
    expect(wheel.spin.rotation.x).toBe(7.5);
    expect(wheel.contact.uniforms.contactShape.value.z).toBe(0);
    expect(wheel.contact.uniforms.contactShape.value.w).toBe(1);
    for (const shader of [lit, depth, distance]) {
      expect(shader.uniforms.contactCompression).toBe(wheel.contact.uniforms.contactCompression);
      expect(shader.uniforms.contactShear).toBe(wheel.contact.uniforms.contactShear);
      expect(shader.vertexShader).toContain('transformed = recordedTirePosition( position )');
    }
    expect(lit.vertexShader).toContain('objectNormal = normalize( dn )');
    expect(studioHookKeys(rim.material as T.Material)).not.toContain('recorded-tire-contact-v1');
    expect(rim.geometry.getAttribute('position').array).toEqual(rimPosition);
    expect(rim.scale.toArray()).toEqual([1, 1, 1]);
    wheel.update(-0.1, 0, 0, 0, 2000, 155, 0, wheelContactPose());
    expect(wheel.contact.uniforms.contactShape.value.w).toBe(0);
    expect(wheel.contact.uniforms.contactShear.value.toArray()).toEqual([0, 0]);
  });

  it('binds transformed authored rubber and sidewall art to its own wheel, retaining source hooks', () => {
    const rubber = new T.MeshStandardMaterial();
    rubber.name = 'Tyre | lightly scrubbed slick';
    const decal = new T.MeshPhysicalMaterial({
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
    });
    decal.name = 'Decal | tyre_pzero';
    const rimMaterial = new T.MeshStandardMaterial();
    rimMaterial.name = 'Rim | alloy';
    for (const material of [rubber, decal]) {
      configureSuppliedMaterial(material);
      installSuppliedShaderWork(material);
    }
    const spins = [0, 1].map((index) => {
      const spin = new T.Group(),
        authored = new T.Group();
      spin.position.x = index * 2;
      authored.rotation.y = Math.PI / 2;
      authored.scale.setScalar(0.7);
      authored.position.set(0.1, -0.02, 0.15);
      const matrix = new T.Matrix4()
        .compose(authored.position, authored.quaternion, authored.scale)
        .invert();
      authored.add(
        new T.Mesh(
          new T.CylinderGeometry(0.35, 0.35, 0.3, 32).rotateZ(Math.PI / 2).applyMatrix4(matrix),
          rubber,
        ),
      );
      authored.add(
        new T.Mesh(
          new T.TorusGeometry(0.29, 0.001, 4, 16)
            .rotateY(Math.PI / 2)
            .translate(0.151, 0, 0)
            .applyMatrix4(matrix),
          decal,
        ),
      );
      authored.add(
        new T.Mesh(
          new T.CylinderGeometry(0.24, 0.24, 0.3, 16).rotateZ(Math.PI / 2).applyMatrix4(matrix),
          rimMaterial,
        ),
      );
      spin.add(authored);
      return spin;
    });
    const blur = installSuppliedWheelBlur(spins);
    const bound = spins.map((spin) => bindSuppliedTire(spin));
    bound.forEach(({ tire, primitives }, index) => {
      expect(tire.radius).toBeCloseTo(0.35, 6);
      expect(primitives).toBe(2);
      const [tread, art, rim] = spins[index].children[0].children as T.Mesh[];
      expect(tread.material).not.toBe(rubber);
      expect(rim.material).toBe(rimMaterial);
      expect(suppliedShaderWorkControl(tread.material as T.Material)).toBe(
        suppliedShaderWorkControl(rubber),
      );
      expect(suppliedDecalCoverageControl(art.material as T.Material)).not.toBeNull();
      const shader = compile(art.material as T.Material, 'physical');
      expect(shader.uniforms.wheelBlurAmount).toBe(blur.blur[index]);
      expect(shader.uniforms.contactShape).toBe(tire.uniforms.contactShape);
      const position = new T.Vector3().fromBufferAttribute(
        tread.geometry.getAttribute('position'),
        0,
      );
      const wheelPoint = position.clone().applyMatrix4(shader.uniforms.contactToWheel.value);
      expect(Math.hypot(wheelPoint.y, wheelPoint.z)).toBeCloseTo(0.35, 6);
      const roundTrip = wheelPoint.applyMatrix4(shader.uniforms.contactFromWheel.value);
      expect(roundTrip.distanceTo(position)).toBeLessThan(1e-12);
      expect(tread.userData.vertexDisplacementMargin).toBeGreaterThan(0.1);
    });
    expect(bound[0].tire.uniforms.contactShear).not.toBe(bound[1].tire.uniforms.contactShear);
  });

  it('bounds damaged presentation, fits reduced cylinders to inclined planes, and clears invalid modes', () => {
    const tire = new RecordedTire(0.335, 0.245);
    tire.update(
      1,
      0.1,
      1,
      contact({ radial: 0.3, planeDistance: 0.1, longitudinal: 0.5, lateral: -0.4 }),
    );
    expect(tire.uniforms.contactCompression.value.x).toBeCloseTo(0.252, 12);
    expect(tire.uniforms.contactCompression.value.z).toBeCloseTo(0.251, 12);
    expect(tire.uniforms.contactShear.value.toArray()).toEqual([0.04, -0.04]);
    const n = new T.Vector3(0.2, 1, 0).normalize(),
      measured = contact({ normalX: n.x, normalY: n.y });
    const radius = contactCylinderRadius(measured, 0.335, 0.245, 0.13);
    expect(radius * n.y + 0.13 * n.x).toBeCloseTo(measured.planeDistance, 12);
    expect(contactCylinderRadius(contact({ radial: 0 }), 0.335, 0.245, 0.13)).toBe(0.335);
    expect(() => tire.update(0, 0.335, 0, contact({ normalY: NaN }))).toThrow(
      'Invalid tire contact',
    );
    tire.update(0, 0.335, 0, wheelContactPose());
    expect(tire.uniforms.contactShape.value.w).toBe(0);
    expect(tire.uniforms.contactNormal.value.toArray()).toEqual([0, 1, 0]);
    expect(tire.uniforms.contactShear.value.toArray()).toEqual([0, 0]);
  });
});
