/** CPU-only integration of the REAL FormulaCar, loader and recorded frame path.
 * Intentionally no WebGLRenderer, fixture lighting, mocked car or model substitute.
 * A separate normal-application capture remains mandatory for visual acceptance. */
import * as T from 'three';
import { FormulaCar } from '../../src/rendering/car.ts';
import { DriverAsset } from '../../src/rendering/driver-asset.ts';
import { HeroShells } from '../../src/rendering/hero-shells.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../../src/simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../../src/simulation/vehicle.ts';
import { TextureBudget } from '../../src/rendering/texture-budget.ts';
import { DEFAULT_LIVERY } from '../../src/storage/livery.ts';
function assert(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const close = (a: number, b: number, message: string, tolerance = 1e-6) =>
  assert(Math.abs(a - b) < tolerance, `${message}: ${a} != ${b}`);
function release(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  root.traverse((o) => {
    if (o instanceof T.SkinnedMesh) o.skeleton.dispose();
    if (o instanceof T.Mesh) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    }
  });
  for (const m of materials)
    for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
  root.clear();
}
function visibleTriangles(root: T.Object3D) {
  let triangles = 0;
  root.traverseVisible((o) => {
    if (o instanceof T.Mesh)
      triangles +=
        ((o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3) *
        (o instanceof T.InstancedMesh ? o.count : 1);
  });
  return triangles;
}
export async function exercise(bytes: number[], driverBytes?: number[]) {
  const hero = await HeroShells.decode(new Uint8Array(bytes)),
    diagnostics = hero.diagnostics();
  const driver = driverBytes ? await DriverAsset.decode(new Uint8Array(driverBytes)) : undefined;
  const driverDiagnostics = driver?.diagnostics();
  const car = new FormulaCar(0, hero, driver);
  hero.dispose();
  driver?.dispose();
  const simulation = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 }),
    frame = simulation.makeFrame(),
    o = carBase(0);
  const draw = (cockpit = false) => {
    const copy = frame.slice();
    car.update(frame, frame, o, 1, 0, frame[H.TIME], cockpit);
    assert(
      frame.every((v, i) => Object.is(v, copy[i])),
      'Renderer mutated simulation frame',
    );
    car.root.updateMatrixWorld(true);
  };
  const matrices = car.root.getObjectByName('Shared articulated suspension');
  assert(matrices instanceof T.InstancedMesh, 'Missing physical suspension');
  const metrics: { level: number; visibleTriangles: number }[] = [],
    updateMs: number[] = [];
  try {
    const owned = new Set<T.BufferGeometry>();
    car.root.traverse((child) => {
      if (child instanceof T.Mesh) owned.add(child.geometry);
    });
    let geometryBytes = 0;
    for (const g of owned) {
      geometryBytes += g.index?.array.byteLength ?? 0;
      for (const a of Object.values(g.attributes)) geometryBytes += a.array.byteLength;
    }
    assert(geometryBytes < 24 * 1024 * 1024, 'Per-car geometry memory budget exceeded');
    for (const [distance, level] of [
      [0, 0],
      [90, 1],
      [250, 2],
      [0, 0],
    ]) {
      car.setLod(distance, 'high', false);
      assert(car.lodLevel === level, 'Unexpected LOD transition');
      for (let step = 0; step < 17; step++) {
        frame[H.TIME] = step * 0.033;
        frame[o + F.STEER] = -0.38 + (0.76 * step) / 16;
        frame[o + F.FRONT_HEALTH] = frame[o + F.REAR_HEALTH] = 1;
        for (let i = 0; i < 4; i++) {
          const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
          frame[w + W.LENGTH] = 0.19 + 0.09 * (step / 16);
          frame[w + W.STEER] = i < 2 ? -0.38 + (0.76 * step) / 16 : 0;
          frame[w + W.CAMBER] = (i % 2 ? 1 : -1) * 0.06;
          frame[w + W.ROTATION] = step * 0.47;
          frame[w + W.RADIUS] = 0.325;
          frame[w + W.LOAD] = 3000 + step * 150;
          frame[w + W.PRESSURE] = 155;
        }
        const start = performance.now();
        draw();
        updateMs.push(performance.now() - start);
        if (driverBytes) {
          assert(
            car.driver.diagnostics().every((a) => a.authoredSkin && a.reachable),
            'Authored skin lost physical steering contact',
          );
        }
        for (let j = 0; j < car.links.length; j++) {
          const link = car.links[j],
            w = o + WHEEL_BASE + link.wheel * WHEEL_STRIDE,
            matrix = new T.Matrix4();
          matrices.getMatrixAt(j, matrix);
          const start = new T.Vector3(0, -0.5, 0).applyMatrix4(matrix),
            end = new T.Vector3(0, 0.5, 0).applyMatrix4(matrix);
          const q = new T.Quaternion().setFromEuler(
            new T.Euler(0, frame[w + W.STEER], -frame[w + W.CAMBER]),
          );
          const p = WHEEL_POSITIONS[link.wheel],
            socket = new T.Vector3(link.dx, link.dy, 0)
              .applyQuaternion(q)
              .add(new T.Vector3(p[0], 0.05 - frame[w + W.LENGTH], p[2]));
          close(start.distanceTo(link.anchor), 0, 'Chassis joint detached', 2e-6);
          close(end.distanceTo(socket), 0, 'Upright joint detached', 2e-6);
          close(
            new T.Vector3(1, 0, 0)
              .transformDirection(matrix)
              .dot(new T.Vector3(0, 1, 0).transformDirection(matrix)),
            0,
            'Aerofoil basis lost orthogonality',
          );
        }
      }
      metrics.push({ level, visibleTriangles: visibleTriangles(car.root) });
    }
    assert(metrics[0].visibleTriangles < 250000, 'High-detail triangle budget exceeded');
    assert(
      metrics[1].visibleTriangles < metrics[0].visibleTriangles * 0.45,
      'Mid LOD does not reduce cost',
    );
    assert(
      metrics[2].visibleTriangles < metrics[1].visibleTriangles,
      'Far LOD does not reduce cost',
    );
    // Wheels leave during service; the ceramic disc and mounting bell do not.
    frame[o + F.PIT_PHASE] = 3;
    frame[o + F.PIT_CLOCK] = 2.1;
    for (let i = 0; i < 4; i++) frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.LOAD] = 0;
    draw();
    for (let i = 0; i < 4; i++) {
      close(Math.abs(car.wheelSpins[i].position.x), 0.48, 'Wheel did not detach');
      close(car.brakeRotors[i].position.x, 0, 'Rotor incorrectly left with wheel');
      assert(car.brakeRotors[i].children.length === 1, 'Rotor mounting bell missing');
      assert(car.brakeRotors[i].children[0].parent === car.brakeRotors[i], 'Bell not rotor-owned');
      close(car.brakeRotors[i].rotation.x, car.wheelSpins[i].rotation.x, 'Rotor phase mismatch');
    }
    frame[o + F.PIT_PHASE] = 0;
    frame[o + F.PIT_CLOCK] = 0;
    frame[o + F.FRONT_HEALTH] = 0.05;
    frame[o + F.REAR_HEALTH] = 0.04;
    for (let i = 0; i < 4; i++) frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.DISC_TEMP] = 950;
    draw();
    assert(
      !car.frontWing.visible && !car.rearWing.visible,
      'Damage leaves replacement wings visible',
    );
    car.discs.forEach((d) => close(d.emissiveIntensity, 1, 'Brake heat binding disconnected'));
    frame[o + F.FRONT_HEALTH] = frame[o + F.REAR_HEALTH] = 1;
    draw(true);
    assert(!car.helmet.visible, 'Cockpit camera ownership changed');
    draw(false);
    assert(car.helmet.visible, 'External helmet did not return');
    car.setLivery({ ...DEFAULT_LIVERY, primary: '#285c89', accent: '#e9ddbb' });
    assert(car.paint.color.getHexString() === '285c89', 'Paint binding disconnected');
    const flanks = car.reflectivePaint.filter(
      (m) => m.userData.liverySide === -1 || m.userData.liverySide === 1,
    );
    assert(
      flanks.length === 2 && flanks.every((m) => m.map instanceof T.CanvasTexture),
      'Missing original signed livery',
    );
    const textures = flanks.map((m) => m.map!);
    const textureBudget = new TextureBudget();
    try {
      textureBudget.register(car.root);
      for (const limit of [256, 1024, 512]) {
        textureBudget.configure(limit, 4);
        car.setLivery({
          ...DEFAULT_LIVERY,
          primary: '#285c89',
          accent: '#e9ddbb',
          sponsor: 'AUREL',
          pattern: 'split',
        });
        textures.forEach((texture) => textureBudget.refresh(texture));
        for (const distance of [0, 90, 250, 0]) {
          car.setLod(distance, 'high', false);
          draw();
          const seen = new Set<T.Material>();
          car.root.traverseVisible((node) => {
            if (
              node instanceof T.Mesh &&
              !Array.isArray(node.material) &&
              flanks.includes(node.material as T.MeshPhysicalMaterial)
            )
              seen.add(node.material);
          });
          assert(seen.size === 2, 'Reduced car lost a live signed livery');
          flanks.forEach((material, i) => {
            assert(material.map === textures[i], 'LOD allocated a replacement livery');
            const image = material.map!.image as HTMLCanvasElement;
            assert(
              image.width === limit && image.height === limit,
              'Livery ignored selected texture budget',
            );
            const context = image.getContext('2d');
            assert(Boolean(context), 'Missing livery canvas');
            const pixel = context!.getImageData(4, 4, 1, 1).data;
            assert(
              pixel[0] === 40 && pixel[1] === 92 && pixel[2] === 137,
              'Reduced livery restored stale paint',
            );
          });
        }
      }
    } finally {
      textureBudget.dispose();
    }

    assert(
      car.mirrors.length === 2 && car.mirrors.every((m) => Boolean(m.parent)),
      'Live mirrors lost',
    );
    // Rewinding a tyre pose reconstructs it, not the history of previous deformation.
    const checkpoint = frame.slice();
    draw();
    const rubber = car.carcasses[0].root.children[0] as T.Mesh;
    const position = rubber.geometry.getAttribute('position'),
      snapshot = Float32Array.from(position.array);
    frame[o + WHEEL_BASE + W.RADIUS] = 0.258;
    frame[o + WHEEL_BASE + W.PRESSURE] = 12;
    frame[o + WHEEL_BASE + W.ROTATION] = -5.4;
    draw();
    frame.set(checkpoint);
    draw();
    assert(
      position.array.every((v, i) => v === snapshot[i]),
      'Tyre replay is history-dependent',
    );
    const timings = updateMs.slice().sort((a, b) => a - b);
    return {
      kind: 'CPU component / no WebGL visual acceptance',
      parts: diagnostics.partCount,
      driver: driverDiagnostics,
      assetSHA256: diagnostics.sha256,
      poses: updateMs.length,
      suspensionEndpointsChecked: updateMs.length * car.links.length * 2,
      geometryBytes,
      lod: metrics,
      updateMs: {
        median: timings[Math.floor(timings.length * 0.5)],
        p95: timings[Math.floor(timings.length * 0.95)],
      },
      physicalStateUnchanged: true,
      steeringTravelCamber: true,
      pitOwnership: true,
      damage: true,
      brakeHeat: true,
      livePaintAndMirrors: true,
      signedLiveryAcrossAllLodsAndTextureBudgets: true,
      replay: true,
      finalArtApproved: false,
    };
  } finally {
    release(car.root);
  }
}

/** Export actual posed runtime geometry for a separately labelled CPU inspection. */
export async function exportGeometry(bytes: number[], driverBytes?: number[], pose = 0) {
  const hero = await HeroShells.decode(new Uint8Array(bytes));
  const driver = driverBytes ? await DriverAsset.decode(new Uint8Array(driverBytes)) : undefined;
  const car = new FormulaCar(0, hero, driver);
  hero.dispose();
  driver?.dispose();
  const simulation = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 });
  const state = simulation.makeFrame();
  const o = carBase(0);
  state[o + F.X] = state[o + F.Z] = state[o + F.QX] = state[o + F.QY] = state[o + F.QZ] = 0;
  state[o + F.QW] = 1;
  state[o + F.Y] = 0.518;
  state[o + F.STEER] = pose;
  car.update(state, state, o, 1, 0, 0, false);
  const output: unknown[] = [];
  car.root.updateMatrixWorld(true);
  car.root.traverseVisible((child) => {
    if (!(child instanceof T.Mesh)) return;
    const base = child.geometry;
    const add = (world: T.Matrix4, instanceColor?: T.Color) => {
      const g = base.clone();
      if (child instanceof T.SkinnedMesh) {
        child.skeleton.update();
        const position = g.getAttribute('position'),
          normal = g.getAttribute('normal'),
          joints = base.getAttribute('skinIndex'),
          weights = base.getAttribute('skinWeight');
        const v = new T.Vector3(),
          matrix = new T.Matrix4(),
          weighted = new T.Matrix4(),
          normalMatrix = new T.Matrix3();
        for (let i = 0; i < position.count; i++) {
          v.fromBufferAttribute(position, i);
          child.applyBoneTransform(i, v);
          position.setXYZ(i, v.x, v.y, v.z);
          weighted.elements.fill(0);
          for (let j = 0; j < 4; j++) {
            const b = joints.getComponent(i, j),
              weight = weights.getComponent(i, j);
            matrix.multiplyMatrices(
              child.skeleton.bones[b].matrixWorld,
              child.skeleton.boneInverses[b],
            );
            for (let k = 0; k < 16; k++) weighted.elements[k] += matrix.elements[k] * weight;
          }
          matrix.copy(child.bindMatrixInverse).multiply(weighted).multiply(child.bindMatrix);
          normalMatrix.setFromMatrix4(matrix);
          v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
          normal.setXYZ(i, v.x, v.y, v.z);
        }
      }
      g.applyMatrix4(world);
      const p = g.getAttribute('position'),
        n = g.getAttribute('normal'),
        uv = g.getAttribute('uv');
      const mat = child.material as T.MeshStandardMaterial;
      let texture: string | undefined;
      const image = mat.map?.image;
      if (image instanceof HTMLCanvasElement) texture = image.toDataURL();
      output.push({
        name: child.name,
        position: [...p.array],
        normal: [...n.array],
        uv: uv ? [...uv.array] : undefined,
        vertexColors:
          mat.vertexColors && g.getAttribute('color')
            ? Array.from({ length: g.getAttribute('color').count }, (_, i) => {
                const c = g.getAttribute('color');
                return [c.getX(i), c.getY(i), c.getZ(i)];
              }).flat()
            : undefined,
        colorSize: 3,
        index: g.index ? [...g.index.array] : Array.from({ length: p.count }, (_, i) => i),
        material: {
          color: (instanceColor ?? mat.color)?.toArray() ?? [0.05, 0.05, 0.05],
          metalness: mat.metalness ?? 0,
          roughness: mat.roughness ?? 0.5,
          emissive: mat.emissive?.toArray(),
          intensity: mat.emissiveIntensity,
          texture,
          transparent: mat.transparent,
          opacity: mat.opacity,
        },
      });
      g.dispose();
    };
    if (child instanceof T.InstancedMesh) {
      for (let i = 0; i < child.count; i++) {
        const matrix = new T.Matrix4();
        child.getMatrixAt(i, matrix);
        matrix.premultiply(child.matrixWorld);
        let color: T.Color | undefined;
        if (child.instanceColor) {
          color = new T.Color();
          child.getColorAt(i, color);
        }
        add(matrix, color);
      }
    } else add(child.matrixWorld);
  });
  release(car.root);
  return output;
}
