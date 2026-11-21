import { expect, it, vi } from 'vitest';
import * as T from 'three';
import { VehicleBodies } from '../src/rendering/vehicle-bodies/index.ts';
import { carBase, CAR_STRIDE, F, H, HEADER, R, RACE_BASE } from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';

it('keeps the ten road cars’ clear optics in the housing at each LOD and selects reverse on the discrete gear tick', () => {
  const library = new VehicleBodies(),
    host = new T.Group(),
    hosts = [{ root: host, lodLevel: 0 }];
  const o = carBase(0),
    day = new Float32Array(HEADER + CAR_STRIDE);
  day[H.CARS] = 1;
  day[o + F.QW] = 1;
  day[o + F.FRONT_HEALTH] = day[o + F.REAR_HEALTH] = 1;
  let released: ReturnType<typeof vi.fn> | undefined;
  try {
    for (const id of ['eh3', 'rh3', 'sc7', 'rs5', 'rm8', 'rg63', 'rp6', 'rr4', 'lx12', 'rd2']) {
      day[o + RACE_BASE + R.VEHICLE] = vehicleIndex(id);
      day[o + F.GEAR] = 1;
      day[o + F.BRAKE] = 1;
      // A car can roll backwards downhill while the forward gear and brake are engaged.
      day[o + F.VZ] = -2;
      const reverse = day.slice();
      reverse[o + F.GEAR] = -1;
      reverse[o + F.BRAKE] = 0;
      library.update(day, reverse, 0.99, hosts, true);
      if (released) expect(released).toHaveBeenCalledOnce();
      const chambers: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>[] = [];
      library.root.traverse((n) => {
        if (n instanceof T.Mesh && n.material.name === 'Clear reversing optic') chambers.push(n);
      });
      expect(chambers, id).toHaveLength(3);
      const material = chambers[0].material;
      expect(material.emissiveIntensity).toBe(0);
      for (const chamber of chambers) {
        expect(chamber.material).toBe(material);
        chamber.geometry.computeBoundingBox();
        const b = chamber.geometry.boundingBox!;
        expect(b.max.z, id).toBeLessThan(-1);
        expect(b.min.x, id).toBeLessThan(-0.13);
        expect(b.max.x, id).toBeGreaterThan(0.13);
        const normals = chamber.geometry.getAttribute('normal');
        let rear = 0;
        for (let i = 0; i < normals.count; i++) if (normals.getZ(i) < -0.65) rear++;
        expect(rear, id).toBeGreaterThan(normals.count * 0.1);
      }
      library.update(day, reverse, 1, hosts, false);
      expect(material.emissiveIntensity).toBeGreaterThan(3);
      library.update(reverse, day, 0.5, hosts, false);
      expect(material.emissiveIntensity).toBeGreaterThan(3);
      library.update(reverse, day, 1, hosts, true);
      expect(material.emissiveIntensity).toBe(0);
      released = vi.fn();
      material.addEventListener('dispose', released);
    }
  } finally {
    library.clear();
  }
  expect(released).toHaveBeenCalledOnce();
}, 120000);
