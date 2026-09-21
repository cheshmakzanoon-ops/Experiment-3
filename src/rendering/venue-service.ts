import type { BroadcastSightlines } from './broadcast-sightlines.ts';
import * as T from 'three';
import { box, mesh, mergeStatic, rod } from './geometry.ts';
import { sculptedLoft } from './bodywork.ts';
import type { ServiceSite } from './venue-service-plan.ts';

function roundedBox(w: number, h: number, d: number, radius = 0.06, bevelSegments = 2) {
  const shape = new T.Shape();
  shape.moveTo(-w / 2 + radius, -h / 2);
  shape.lineTo(w / 2 - radius, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + radius);
  shape.lineTo(w / 2, h / 2 - radius);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - radius, h / 2);
  shape.lineTo(-w / 2 + radius, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - radius);
  shape.lineTo(-w / 2, -h / 2 + radius);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + radius, -h / 2);
  const bevel = Math.min(radius, d * 0.2);
  const g = new T.ExtrudeGeometry(shape, {
    depth: d - bevel * 2,
    steps: 1,
    curveSegments: bevelSegments === 1 ? 2 : 3,
    bevelEnabled: true,
    bevelSize: Math.min(radius * 0.3, bevel),
    bevelThickness: bevel,
    bevelSegments,
  });
  return g.translate(0, 0, -d / 2 + bevel);
}

/** The access strip is already footprint/grade-checked by the site planner.
 * Convert its shared world points to the site's local batching coordinates. */
export function serviceAccessGeometry(site: ServiceSite) {
  const path = site.access ?? [];
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const cos = Math.cos(site.yaw),
    sin = Math.sin(site.yaw);
  const direction =
    path.length > 1 ? Math.sign((path[1].x - path[0].x) * sin + (path[1].z - path[0].z) * cos) : 1;
  for (let i = 0; i < path.length; i++) {
    const p = path[i],
      dx = p.x - site.x,
      dz = p.z - site.z;
    for (const side of [-1, 1]) {
      positions.push(dx * cos - dz * sin + side * 1.7, p.y - site.y, dx * sin + dz * cos);
      uv.push(side < 0 ? 0 : 1, i / 3.4);
    }
    if (i + 1 < path.length) {
      const a = i * 2;
      if (direction > 0) indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Parked original maintenance/recovery equipment. The vehicles are scene
 * assets, not a safety-car system or operational recovery simulation. */
export function buildServiceAreas(
  parent: T.Group,
  sites: readonly ServiceSite[],
  sightlines?: BroadcastSightlines,
) {
  const asphalt = new T.MeshStandardMaterial({ color: 0x414747, roughness: 0.96 });
  const concrete = new T.MeshStandardMaterial({ color: 0x8b8c82, roughness: 0.92 });
  const paint = new T.MeshStandardMaterial({ color: 0xe4ddd0, roughness: 0.42, metalness: 0.16 });
  const dark = new T.MeshStandardMaterial({ color: 0x182024, roughness: 0.83 });
  const metal = new T.MeshStandardMaterial({ color: 0x718084, roughness: 0.43, metalness: 0.7 });
  const glass = new T.MeshPhysicalMaterial({
    color: 0x243941,
    roughness: 0.16,
    metalness: 0.25,
    clearcoat: 1,
  });
  const orange = new T.MeshStandardMaterial({ color: 0xcb6527, roughness: 0.62 });
  const line = new T.MeshStandardMaterial({ color: 0xddcc8a, roughness: 0.88 });
  const result: T.Group[] = [];
  for (const site of sites) {
    const root = new T.Group();
    const solids: T.Mesh[] = [];
    root.name = `Aurel ${site.kind} service area ${site.s}m`;
    root.position.set(site.x, site.y, site.z);
    root.rotation.y = site.yaw;
    const foundation = site.y - site.baseY;
    box(root, concrete, 0, -foundation / 2, 0, site.width, foundation, site.length);
    box(root, asphalt, 0, 0.012, 0, site.width - 0.15, 0.024, site.length - 0.15);
    if (site.access?.length) {
      mesh(root, serviceAccessGeometry(site), asphalt);
      // A closed maintenance gate explicitly terminates the non-racing spur.
      // Its barrier is scenery, never advertised as a new drivable shortcut.
      const end = site.access.at(-1)!,
        dx = end.x - site.x,
        dz = end.z - site.z;
      const u = dx * Math.cos(site.yaw) - dz * Math.sin(site.yaw);
      const v = dx * Math.sin(site.yaw) + dz * Math.cos(site.yaw),
        y = end.y - site.y;
      for (const side of [-1, 1]) box(root, metal, u + side * 1.63, y + 0.68, v, 0.09, 1.36, 0.09);
      for (const h of [0.35, 0.95]) box(root, paint, u, y + h, v, 3.15, 0.06, 0.055);
      rod(
        root,
        orange,
        new T.Vector3(u - 1.52, y + 0.35, v),
        new T.Vector3(u + 1.52, y + 0.95, v),
        0.026,
      );
    }
    // White-line parking bays face a clear internal manoeuvring lane.
    for (const x of [-4.0, -0.8]) box(root, line, x, 0.027, 0, 0.07, 0.012, 7.4);
    box(root, line, -2.4, 0.027, 3.7, 3.2, 0.012, 0.07);
    const truck = new T.Group();
    truck.position.set(-2.45, 0.035, 0);
    box(truck, dark, 0, 0.59, 0, 1.96, 0.2, 5.9);
    solids.push(mesh(truck, roundedBox(2.12, 1.48, 1.75, 0.11), paint, 0, 1.49, 1.77));
    const windscreen = mesh(truck, roundedBox(1.74, 0.64, 0.025, 0.045), glass, 0, 1.79, 2.676);
    windscreen.rotation.x = -0.05;
    for (const side of [-1, 1]) {
      const window = mesh(truck, new T.PlaneGeometry(1.22, 0.58), glass, side * 1.086, 1.79, 1.78);
      window.rotation.y = (side * Math.PI) / 2;
      rod(
        truck,
        metal,
        new T.Vector3(side * 1.02, 1.68, 2.45),
        new T.Vector3(side * 1.27, 1.67, 2.49),
        0.019,
      );
      mesh(truck, roundedBox(0.085, 0.23, 0.15, 0.018), dark, side * 1.28, 1.68, 2.49);
      for (const z of [-1.88, 1.78]) {
        const tyre = mesh(
          truck,
          new T.CylinderGeometry(0.38, 0.38, 0.23, 16),
          dark,
          side * 1.035,
          0.38,
          z,
        );
        tyre.rotation.z = Math.PI / 2;
        const hub = mesh(
          truck,
          new T.CylinderGeometry(0.21, 0.21, 0.24, 12),
          metal,
          side * 1.055,
          0.38,
          z,
        );
        hub.rotation.z = Math.PI / 2;
      }
      mesh(truck, roundedBox(0.44, 0.14, 0.025, 0.025), line, side * 0.72, 1.09, 2.685);
    }
    box(truck, metal, 0, 0.91, 2.735, 2.14, 0.12, 0.12);
    box(truck, dark, 0, 1.29, 2.687, 0.91, 0.15, 0.028);
    box(truck, orange, 0, 2.285, 1.65, 0.74, 0.11, 0.18);
    if (site.kind === 'recovery') {
      box(truck, metal, 0, 0.85, -0.95, 2.25, 0.14, 3.7);
      for (const side of [-1, 1]) {
        box(truck, orange, side * 1.1, 0.99, -0.95, 0.07, 0.16, 3.7);
        const ramp = box(truck, metal, side * 0.65, 0.76, -2.55, 0.48, 0.09, 1.1);
        ramp.rotation.x = -0.13;
      }
      mesh(
        truck,
        sculptedLoft([
          [-0.15, 1.01, 0.19, 0.1],
          [0.25, 1.1, 0.16, 0.16],
          [0.65, 1.02, 0.11, 0.1],
        ]),
        orange,
      );
      const winch = mesh(truck, new T.CylinderGeometry(0.13, 0.13, 0.45, 12), dark, 0, 1.21, 0.18);
      winch.rotation.z = Math.PI / 2;
    } else solids.push(mesh(truck, roundedBox(2.13, 1.65, 3.35, 0.08), paint, 0, 1.64, -0.91));
    root.add(truck);
    // Equipment shelter: open frontage, visible rack depth and practical storage.
    box(root, concrete, 2.4, 0.08, -3.8, 3.9, 0.16, 4.4);
    for (const x of [0.7, 4.1])
      for (const z of [-5.7, -1.9]) box(root, metal, x, 1.42, z, 0.09, 2.7, 0.09);
    const roof = box(root, paint, 2.4, 2.86, -3.8, 3.85, 0.12, 4.3);
    roof.rotation.x = 0.045;
    solids.push(roof);
    // Roof drainage leads to a grated channel, beside a raised pedestrian route.
    box(root, metal, 2.4, 2.79, -1.64, 3.9, 0.07, 0.09);
    rod(root, metal, new T.Vector3(4.19, 2.79, -1.64), new T.Vector3(4.19, 0.15, -1.64), 0.032);
    box(root, concrete, 4.53, 0.08, 0, 0.64, 0.16, 15.6);
    box(root, dark, 4.06, 0.035, 0, 0.13, 0.03, 14.5);
    for (let j = 0; j < 50; j++)
      box(root, metal, 4.06, 0.053, -7.1 + j * 0.285, 0.135, 0.008, 0.024);
    for (const z of [-7.3, -0.7, 7.3]) {
      box(root, concrete, 4.52, 0.24, z, 0.26, 0.18, 0.26);
      box(root, orange, 4.52, 0.69, z, 0.12, 0.76, 0.12);
    }
    // Workshop facade and service cabinet belong to the shelter, not scattered
    // independently over the terrain. Existing material batches are reused.
    solids.push(box(root, paint, 4.16, 1.41, -3.9, 0.065, 2.62, 3.55));
    for (let j = 0; j < 10; j++)
      box(root, metal, 4.205, 1.41, -5.43 + j * 0.34, 0.024, 2.61, 0.035);
    box(root, metal, 1.1, 0.62, -6.47, 0.88, 1.16, 0.47);
    box(root, dark, 1.1, 0.65, -6.215, 0.66, 0.66, 0.012);
    rod(root, metal, new T.Vector3(1.1, 1.14, -6.5), new T.Vector3(1.1, 1.14, -5.77), 0.027);
    solids.push(box(root, metal, 2.4, 1.4, -5.7, 3.4, 2.6, 0.07));
    for (const y of [0.46, 1.16, 1.86]) {
      box(root, metal, 2.55, y, -4.97, 2.7, 0.06, 0.9);
      for (let i = 0; i < 3; i++)
        mesh(
          root,
          roundedBox(0.68, 0.44, 0.62, 0.025, 1),
          i % 2 ? dark : orange,
          1.63 + i * 0.89,
          y + 0.25,
          -4.97,
        );
    }
    for (let i = 0; i < 4; i++) {
      box(root, dark, 1.1 + i * 0.9, 0.055, 4.2, 0.4, 0.06, 0.4);
      mesh(root, new T.ConeGeometry(0.16, 0.52, 8), orange, 1.1 + i * 0.9, 0.34, 4.2);
    }
    parent.add(root);
    solids.forEach((solid) => sightlines?.add(solid));
    mergeStatic(root);
    root.userData.service = {
      kind: site.kind,
      s: site.s,
      clearance: site.clearance,
      accessLength: Math.max(0, (site.access?.length ?? 1) - 1),
      operationalRecovery: false,
    };
    parent.add(root);
    result.push(root);
  }
  return result;
}
