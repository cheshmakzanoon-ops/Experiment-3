import * as T from 'three';
import type { FormulaCar } from './car.ts';
import { WHEEL_GUN } from './wheel-gun.ts';
export interface WheelGunFit {
  axial: number;
  radius: number;
  socketScale: number;
  source: 'supplied-player' | 'authored-rival' | 'legacy-prototype';
}
/** Measure the actual retained centre-lock surfaces once, before racing. Values
 * are in the spin/carrier frame, not the source mesh's differently oriented axes.
 * Rear and front offsets are independent. No car geometry is modified. */
export function measureWheelGunFits(car: FormulaCar): WheelGunFit[] {
  const fits: WheelGunFit[] = [];
  car.root.updateMatrixWorld(true);
  for (let wheel = 0; wheel < 4; wheel++) {
    const side = wheel % 2 ? 1 : -1;
    const spin = car.suppliedPlayer?.spins[wheel] ?? car.wheelSpins[wheel];
    const inverse = spin.matrixWorld.clone().invert(),
      transform = new T.Matrix4(),
      point = new T.Vector3();
    const samples: number[][] = [];
    spin.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      const authored = !car.suppliedPlayer && !!car.root.userData.authoredBodywork;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      transform.multiplyMatrices(inverse, object.matrixWorld);
      const geometry = object.geometry,
        positions = geometry.getAttribute('position');
      const groups = geometry.groups.length
        ? geometry.groups
        : [{ start: 0, count: geometry.index?.count ?? positions.count, materialIndex: 0 }];
      for (const group of groups) {
        if (
          !(
            authored &&
            (materials[group.materialIndex ?? 0] as T.MeshStandardMaterial)?.metalness > 0.7
          ) &&
          !materials[group.materialIndex ?? 0]?.name.startsWith('Anodised hub')
        )
          continue;
        for (let j = group.start; j < group.start + group.count; j++) {
          point
            .fromBufferAttribute(positions, geometry.index?.getX(j) ?? j)
            .applyMatrix4(transform);
          const radial = Math.hypot(point.y, point.z);
          if (radial < 0.058 && side * point.x > 0) samples.push([side * point.x, radial]);
        }
      }
    });
    if (!samples.length) {
      if (car.suppliedPlayer || car.root.userData.authoredBodywork)
        throw new Error(`A31 cannot locate authored wheel nut ${wheel}`);
      // Only direct constructor fixtures use the legacy fallback car. Normal
      // production creation requires the imported car and authored rivals.
      fits.push({
        axial: (wheel < 2 ? 0.155 : 0.19) + 0.039,
        radius: 0.031,
        socketScale: 1,
        source: 'legacy-prototype',
      });
      continue;
    }
    const axial = samples.reduce((n, s) => Math.max(n, s[0]), 0);
    const radius = samples
      .filter((s) => s[0] >= axial - 0.015)
      .reduce((n, s) => Math.max(n, s[1]), 0);
    const apothem = WHEEL_GUN.socketInnerCircumradius * Math.cos(Math.PI / 6);
    if (axial < 0.1 || axial > 0.3 || radius < 0.02 || radius > 0.055)
      throw new Error('A31 measured hub outside fit envelope');
    fits.push({
      axial,
      radius,
      socketScale: Math.max(1, (radius + 0.001) / apothem),
      source: car.suppliedPlayer ? 'supplied-player' : 'authored-rival',
    });
  }
  return fits;
}
