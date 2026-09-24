import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mesh, rod } from './geometry.ts';
import type { DistrictSite } from './venue-districts.ts';
import type { BroadcastSightlines } from './broadcast-sightlines.ts';
import type { VenueMaterials } from './venue-materials.ts';

/** Four original construction kits, authored in metres. Geometry stays inside
 * the site's shared 44 × 36 m footprint; no hidden cars, people or extra lights. */
export function buildDistrictArchitecture(
  root: T.Group,
  kind: DistrictSite['kind'],
  m: VenueMaterials,
  sightlines: BroadcastSightlines,
) {
  const b = (
    name: string,
    material: T.Material,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    solid = false,
    bevel = 0,
  ) => {
    if (![x, y, z, w, h, d, bevel].every(Number.isFinite) || Math.min(w, h, d) <= 0)
      throw new Error('Invalid authored venue part');
    const g =
      bevel > 0
        ? new RoundedBoxGeometry(w, h, d, 1, Math.min(bevel, w / 4, h / 4, d / 4))
        : new T.BoxGeometry(w, h, d);
    const part = mesh(root, g, material, x, y, z);
    part.name = name;
    if (solid) sightlines.add(part);
    return part;
  };
  const beam = (
    name: string,
    a: number[],
    end: number[],
    radius: number,
    material: T.Material = m.steel,
  ) => {
    const part = rod(root, material, new T.Vector3(...a), new T.Vector3(...end), radius);
    part.name = name;
    return part;
  };
  const bench = (x: number, y: number, z: number, width = 3) => {
    for (let slat = 0; slat < 4; slat++)
      b(
        'Bench / individual seat slat',
        m.timber,
        x,
        y + 0.48,
        z + slat * 0.13,
        width,
        0.07,
        0.105,
        false,
        0.014,
      );
    for (const end of [-1, 1]) {
      b(
        'Bench / anchored foot',
        m.steel,
        x + end * (width / 2 - 0.3),
        y + 0.24,
        z + 0.2,
        0.065,
        0.48,
        0.43,
      );
      b(
        'Bench / back support',
        m.steel,
        x + end * (width / 2 - 0.3),
        y + 0.67,
        z + 0.49,
        0.055,
        0.81,
        0.065,
      );
    }
    for (let slat = 0; slat < 3; slat++)
      b(
        'Bench / curved-edge back slat',
        m.timber,
        x,
        y + 0.7 + slat * 0.14,
        z + 0.48,
        width,
        0.105,
        0.065,
        false,
        0.012,
      );
  };
  const door = (x: number, z: number, width: number, top = 2.65) => {
    for (const side of [-1, 1]) {
      b('Entrance / jamb', m.steel, x + (side * width) / 2, top / 2, z, 0.065, top, 0.14);
      b(
        'Entrance / recessed glazed leaf',
        m.glass,
        x + (side * width) / 4,
        top / 2,
        z + 0.035,
        width / 2 - 0.08,
        top - 0.13,
        0.045,
      );
      beam(
        'Entrance / pull handle',
        [x + side * 0.12, 1.05, z - 0.1],
        [x + side * 0.12, 1.6, z - 0.1],
        0.018,
      );
    }
    b('Entrance / lintel', m.steel, x, top, z, width + 0.14, 0.09, 0.14);
    b('Entrance / threshold', m.steel, x, 0.025, z, width, 0.05, 0.2);
  };
  const fence = (x1: number, z1: number, x2: number, z2: number, y: number) => {
    const length = Math.hypot(x2 - x1, z2 - z1),
      spans = Math.ceil(length / 1.8);
    for (let i = 0; i <= spans; i++) {
      const t = i / spans,
        x = x1 + (x2 - x1) * t,
        z = z1 + (z2 - z1) * t;
      b('Terrace / guardrail baseplate', m.steel, x, y + 0.025, z, 0.16, 0.05, 0.16);
      beam('Terrace / guardrail post', [x, y, z], [x, y + 1.1, z], 0.027);
    }
    for (const h of [0.55, 1.1])
      beam('Terrace / continuous handrail', [x1, y + h, z1], [x2, y + h, z2], 0.029);
  };
  if (kind === 'club') {
    b('Club / stone foundation', m.stone, 0, 0.13, 4.7, 30, 0.26, 16.2, true, 0.035);
    for (const side of [-1, 1]) {
      b('Club / side masonry', m.stone, side * 14.65, 2.85, 4.7, 0.48, 5.45, 15.5, true, 0.025);
      for (let bay = 0; bay < 4; bay++) {
        const z = -0.9 + bay * 3.5;
        b('Club / side window reveal', m.interior, side * 14.91, 2.9, z, 0.055, 2.8, 2.8);
        b('Club / side glazing', m.glass, side * 14.96, 2.9, z, 0.035, 2.62, 2.6);
        b('Club / window drip ledge', m.stone, side * 15.02, 1.52, z, 0.28, 0.1, 2.96);
      }
    }
    b('Club / rear masonry', m.stone, 0, 2.85, 12.35, 29.4, 5.45, 0.48, true, 0.025);
    for (const side of [-1, 1]) {
      b('Club / upper side clerestory', m.glass, side * 14.65, 6.12, 4.7, 0.07, 1.13, 15.0);
      for (let z = -2.8; z <= 12.2; z += 2.5)
        b('Club / clerestory mullion', m.steel, side * 14.72, 6.12, z, 0.14, 1.17, 0.065);
    }
    const gable = new T.Shape();
    gable.moveTo(-14.65, 5.55);
    gable.lineTo(14.65, 5.55);
    gable.lineTo(14.65, 6.7);
    gable.lineTo(0, 5.76);
    gable.lineTo(-14.65, 6.7);
    gable.closePath();
    const infill = mesh(
      root,
      new T.ExtrudeGeometry(gable, { depth: 0.28, bevelEnabled: false }),
      m.timber,
      0,
      0,
      12.21,
    );
    infill.name = 'Club / folded-roof rear infill';
    b('Club / warm interior ceiling', m.timber, 0, 5.63, 4.6, 28.8, 0.12, 15.1);
    const frontInfill = infill.clone();
    frontInfill.geometry = infill.geometry.clone();
    frontInfill.position.z = -3.14;
    frontInfill.name = 'Club / folded-roof front infill';
    root.add(frontInfill);
    b('Club / continuous front spandrel', m.timber, 0, 5.3, -3.12, 29.35, 0.55, 0.25);
    // Recessed glazing and a real central entrance, not a front-facing dark box.
    for (const x of [-11.9, -7.9, -3.9, 3.9, 7.9, 11.9]) {
      b('Club / recessed facade glazing', m.glass, x, 2.78, -3.08, 3.67, 4.55, 0.07);
      for (const dx of [-1.92, 1.92])
        b('Club / facade mullion', m.steel, x + dx, 2.78, -3.22, 0.1, 4.85, 0.2);
      b('Club / horizontal transom', m.steel, x, 3.93, -3.22, 3.85, 0.075, 0.2);
      for (const dx of [-1.35, 1.35])
        b(
          'Club / projecting timber sun fin',
          m.timber,
          x + dx,
          2.87,
          -3.61,
          0.14,
          5.2,
          0.69,
          false,
          0.012,
        );
    }
    door(0, -3.28, 3.05, 4.8);
    b('Club / entrance shelter', m.steel, 0, 4.98, -4.05, 5.2, 0.16, 2.1, true);
    // Butterfly roof has a continuous valley, visible thickness and standing seams.
    const profile = new T.Shape();
    profile.moveTo(-15.6, 6.95);
    profile.lineTo(0, 5.95);
    profile.lineTo(15.6, 6.95);
    profile.lineTo(15.6, 6.76);
    profile.lineTo(0, 5.76);
    profile.lineTo(-15.6, 6.76);
    profile.closePath();
    const roof = mesh(
      root,
      new T.ExtrudeGeometry(profile, { depth: 18.1, bevelEnabled: false, steps: 1 }),
      m.roof,
      0,
      0,
      -4.4,
    );
    roof.name = 'Club / continuous folded standing-seam roof';
    sightlines.add(roof);
    for (let x = -15; x <= 15; x += 0.75) {
      const y = 5.95 + Math.abs(x) / 15.6;
      b('Club / raised standing seam', m.steel, x, y + 0.025, 4.65, 0.022, 0.05, 18.1);
    }
    for (const x of [-14, -7, 7, 14])
      for (const z of [-3.5, 12.8]) {
        const top = 5.76 + Math.abs(x) / 15.6;
        b('Club / exposed timber column', m.timber, x, top / 2, z, 0.19, top, 0.19, false, 0.012);
        beam(
          'Club / knee brace',
          [x, top - 1.15, z],
          [x + (x < 0 ? 1 : -1) * 1.25, top - 0.1, z],
          0.068,
          m.timber,
        );
        b('Club / post shoe', m.steel, x, 0.12, z, 0.25, 0.24, 0.25);
      }
    b('Club / valley gutter', m.steel, 0, 5.96, 4.75, 0.24, 0.065, 18.3);
    beam('Club / rear downpipe', [0, 5.91, 13.46], [0, 0.12, 13.46], 0.065);
    for (const x of [-9, 9]) {
      b('Club / lobby counter', m.timber, x, 0.69, 5.8, 4, 1.25, 1.3, false, 0.045);
      b('Club / stone counter cap', m.stone, x, 1.35, 5.8, 4.1, 0.09, 1.4, false, 0.025);
      bench(x, 0, -7.6, 4.3);
    }
  } else if (kind === 'terrace') {
    // Split tiers leave an actual central stair, not stairs intersecting a solid block.
    for (let tier = 0; tier < 4; tier++) {
      const z = -4.2 + tier * 3.5,
        height = 0.6 + tier * 0.65;
      for (const side of [-1, 1]) {
        b(
          'Terrace / split stone seating tier',
          m.stone,
          side * 8.62,
          height / 2,
          z,
          14.65,
          height,
          3.52,
          true,
          0.025,
        );
        for (const x of [4.1, 8.6, 13.1]) bench(side * x, height, z + 0.1, 3.6);
      }
      const previous = tier === 0 ? 0 : 0.6 + (tier - 1) * 0.65;
      for (let step = 0; step < 4; step++) {
        const h = previous + ((height - previous) * (step + 1)) / 4;
        b(
          'Terrace / unobstructed central stair',
          m.stone,
          0,
          h / 2,
          z - 1.75 + (step + 0.5) * 0.875,
          2.55,
          h,
          0.875,
        );
        b(
          'Terrace / stair nosing',
          m.roof,
          0,
          h + 0.006,
          z - 1.75 + step * 0.875 + 0.04,
          2.46,
          0.012,
          0.055,
        );
      }
      for (const side of [-1, 1]) {
        beam(
          'Terrace / central stair handrail',
          [side * 1.2, previous + 1.1, z - 1.75],
          [side * 1.2, height + 1.1, z + 1.75],
          0.026,
        );
        for (const t of [0.06, 0.94]) {
          const stairHeight = previous + ((height - previous) * Math.ceil(t * 4)) / 4;
          beam(
            'Terrace / stair-mounted handrail support',
            [side * 1.2, stairHeight, z - 1.75 + 3.5 * t],
            [side * 1.2, previous + (height - previous) * t + 1.1, z - 1.75 + 3.5 * t],
            0.023,
          );
        }
      }
    }
    for (let tier = 0; tier < 4; tier++)
      for (const side of [-1, 1])
        fence(
          side * 15.72,
          -5.91 + tier * 3.5,
          side * 15.72,
          -2.49 + tier * 3.5,
          0.6 + tier * 0.65,
        );
    fence(-15.72, 8.0, 15.72, 8.0, 2.55);
    // Double-curved tensile roof, independently triangulated front/back by the material.
    const positions: number[] = [],
      uv: number[] = [],
      indices: number[] = [];
    const roofHeight = (u: number, v: number) =>
      8.8 - 1.55 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) + 0.45 * (u - v);
    const nu = 24,
      nv = 12;
    for (let j = 0; j <= nv; j++)
      for (let i = 0; i <= nu; i++) {
        const u = i / nu,
          v = j / nv;
        positions.push((u - 0.5) * 36, roofHeight(u, v), -7 + v * 18);
        uv.push(u * 36, v * 18);
        if (i < nu && j < nv) {
          const a = j * (nu + 1) + i,
            b = a + nu + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    const sail = mesh(root, g, m.fabric);
    sail.name = 'Terrace / doubly curved tensile canopy';
    // A box enclosing the open sail is NOT registered as a solid occluder.
    for (const u of [0, 1])
      for (const v of [0, 1]) {
        const x = (u - 0.5) * 36,
          z = -7 + v * 18,
          top = roofHeight(u, v) + 0.5;
        b('Terrace / mast footing', m.stone, x, 0.15, z, 0.9, 0.3, 0.9, true, 0.04);
        beam('Terrace / tension mast', [x, 0, z], [x, top, z], 0.095);
        beam(
          'Terrace / canopy tie',
          [x, top, z],
          [x * 0.93, roofHeight(u, v), z + (v === 0 ? 0.5 : -0.5)],
          0.023,
        );
      }
    for (let i = 0; i < nu; i++)
      for (const v of [0, 1]) {
        const a = i / nu,
          b = (i + 1) / nu;
        beam(
          'Terrace / canopy edge cable',
          [(a - 0.5) * 36, roofHeight(a, v), -7 + v * 18],
          [(b - 0.5) * 36, roofHeight(b, v), -7 + v * 18],
          0.022,
        );
      }
  } else if (kind === 'works') {
    for (const side of [-1, 1]) {
      const x = side * 8.65;
      b('Works / shed foundation', m.stone, x, 0.14, 4.7, 15, 0.28, 17.3, true, 0.025);
      for (const edge of [-1, 1])
        b(
          'Works / brick side pier',
          m.accent,
          x + edge * 7.22,
          2.85,
          4.8,
          0.36,
          5.55,
          17,
          true,
          0.018,
        );
      b('Works / rear wall', m.accent, x, 2.85, 13.1, 14.5, 5.55, 0.35, true);
      // Sawtooth roof sections have a glazed clerestory face and closed return.
      for (let bay = 0; bay < 3; bay++) {
        const z0 = -3.85 + bay * 5.72,
          z1 = z0 + 5.72;
        const profile = new T.Shape();
        profile.moveTo(-z0, 5.85);
        profile.lineTo(-z1, 7.3);
        profile.lineTo(-z1, 7.12);
        profile.lineTo(-z0, 5.67);
        profile.closePath();
        const geometry = new T.ExtrudeGeometry(profile, {
          depth: 15.3,
          bevelEnabled: false,
          steps: 1,
        });
        geometry.translate(0, 0, -7.65).rotateY(Math.PI / 2);
        const panel = mesh(root, geometry, m.roof, x, 0, 0);
        panel.name = 'Works / sawtooth roof plane';
        sightlines.add(panel);
        for (const edge of [-1, 1]) {
          const end = new T.Shape();
          end.moveTo(-z0, 5.55);
          end.lineTo(-z1, 5.55);
          end.lineTo(-z1, 7.12);
          end.lineTo(-z0, 5.67);
          end.closePath();
          const cap = new T.ExtrudeGeometry(end, { depth: 0.28, bevelEnabled: false });
          cap.translate(0, 0, -0.14).rotateY(Math.PI / 2);
          const infill = mesh(root, cap, m.accent, x + edge * 7.22, 0, 0);
          infill.name = 'Works / sawtooth gable infill';
        }
        b('Works / north-light clerestory', m.glass, x, 6.47, z1, 14.5, 1.5, 0.045);
        for (let xx = -7; xx <= 7; xx += 1.4) {
          b('Works / clerestory mullion', m.steel, x + xx, 6.47, z1 - 0.04, 0.05, 1.52, 0.13);
          beam('Works / standing seam', [x + xx, 5.9, z0], [x + xx, 7.35, z1], 0.019);
        }
        for (const edge of [-1, 1])
          beam(
            'Works / roof bearing',
            [x + edge * 7.2, 5.65, z0],
            [x + edge * 7.2, 7.1, z1],
            0.065,
          );
      }
      // One raised roller door reveals the workbench; the other is closed.
      const opening = side < 0 ? 2.8 : 0.12;
      for (let y = opening + 0.12; y < 4.9; y += 0.19)
        b('Works / profiled roller-door slat', m.roof, x, y, -3.81, 8.8, 0.14, 0.1);
      for (const edge of [-1, 1])
        b('Works / door guide', m.steel, x + edge * 4.55, 2.55, -3.9, 0.16, 5.1, 0.24);
      b('Works / lintel', m.steel, x, 5.25, -3.8, 14.4, 0.38, 0.34, true);
      b('Works / shaded interior floor', m.interior, x, 0.295, 4.5, 14.2, 0.03, 16.4);
      b('Works / maintenance bench', m.steel, x, 1.0, 10.8, 8.5, 1.4, 1.1, false, 0.025);
      b('Works / worktop', m.timber, x, 1.73, 10.8, 8.65, 0.12, 1.2, false, 0.018);
      for (const edge of [-1, 1]) {
        b(
          'Works / door safety plinth',
          m.accent,
          x + edge * 4.85,
          0.52,
          -4.38,
          0.24,
          1.04,
          0.24,
          false,
          0.025,
        );
        b(
          'Works / bay-side glazing',
          m.glass,
          x + edge * 5.95,
          edge < 0 ? 3.2 : 3.73,
          -3.82,
          1.8,
          edge < 0 ? 1.2 : 1.02,
          0.06,
        );
      }
      // Construct the facade around the openings instead of floating windows
      // and door guides in an otherwise missing front wall.
      b('Works / left facade sill wall', m.accent, x - 5.95, 1.42, -3.72, 2.25, 2.56, 0.3, true);
      b('Works / left facade head wall', m.accent, x - 5.95, 4.57, -3.72, 2.25, 1.54, 0.3, true);
      b('Works / right facade door head', m.accent, x + 5.95, 2.93, -3.72, 2.25, 0.56, 0.3, true);
      b('Works / right facade window head', m.accent, x + 5.95, 4.84, -3.72, 2.25, 1.04, 0.3, true);
      for (const dx of [-7.02, -4.86, 4.86, 7.02])
        b('Works / facade reveal return', m.accent, x + dx, 2.76, -3.72, 0.2, 5.25, 0.3);
      b('Works / ventilation housing', m.steel, x, 5.75, 11.7, 3, 0.65, 1.6, false, 0.04);
      for (let i = 0; i < 10; i++)
        b('Works / ventilation louvre', m.roof, x - 1.38 + i * 0.3, 5.76, 10.87, 0.095, 0.48, 0.08);
      b('Works / service door recess', m.interior, x + 5.95, 1.38, -3.88, 1.7, 2.76, 0.04);
      door(x + 5.95, -3.99, 1.35, 2.65);
    }
    for (const x of [-6, 6]) {
      b('Works / loading-yard drain frame', m.steel, x, 0.018, -8.3, 4, 0.036, 0.28);
      for (let i = 0; i < 16; i++)
        b('Works / drain slot', m.interior, x - 1.86 + i * 0.245, 0.039, -8.3, 0.105, 0.008, 0.21);
    }
  } else if (kind === 'concourse') {
    for (const x of [-12, 0, 12]) {
      b('Concourse / kiosk plinth', m.stone, x, 0.14, 4.5, 9, 0.28, 8.3, true, 0.035);
      b('Concourse / enclosed rear wall', m.timber, x, 2.08, 8.45, 8.6, 3.9, 0.26, true, 0.025);
      for (const side of [-1, 1])
        b(
          'Concourse / side return',
          m.timber,
          x + side * 4.17,
          2.08,
          4.5,
          0.26,
          3.9,
          8.1,
          true,
          0.025,
        );
      b(
        'Concourse / recessed service counter',
        m.stone,
        x,
        1.03,
        0.64,
        7.95,
        1.5,
        1.1,
        false,
        0.03,
      );
      b('Concourse / counter surface', m.timber, x, 1.82, 0.43, 8.15, 0.09, 1.45, false, 0.025);
      b('Concourse / upper fascia', m.accent, x, 3.87, 0.52, 8.85, 0.55, 0.2);
      for (const side of [-1, 1])
        b('Concourse / front opening jamb', m.steel, x + side * 4.06, 2.6, 0.52, 0.09, 2.1, 0.15);
      b('Concourse / rear clerestory ribbon', m.glass, x, 4.26, 8.46, 8.55, 0.48, 0.06);
      for (const side of [-1, 1]) {
        const profile = new T.Shape();
        profile.moveTo(-0.45, 4.025);
        profile.lineTo(-8.55, 4.025);
        profile.lineTo(-8.55, 4.49);
        profile.lineTo(-0.45, 4.12);
        profile.closePath();
        const geometry = new T.ExtrudeGeometry(profile, { depth: 0.12, bevelEnabled: false });
        geometry.translate(0, 0, -0.06).rotateY(Math.PI / 2);
        const ribbon = mesh(root, geometry, m.glass, x + side * 4.17, 0, 0);
        ribbon.name = 'Concourse / sloping side clerestory ribbon';
      }
      b('Concourse / rear shelf', m.steel, x, 2.33, 7.56, 7.6, 0.09, 0.85);
      b('Concourse / back counter', m.interior, x, 1.08, 7.25, 7.7, 1.35, 1.2);
      const roof = b(
        'Concourse / deep shade canopy',
        m.roof,
        x,
        4.35,
        3.65,
        10.55,
        0.17,
        11.1,
        false,
        0.025,
      );
      roof.rotation.x = -0.045;
      sightlines.add(roof);
      for (const side of [-1, 1]) {
        b(
          'Concourse / independent canopy post',
          m.steel,
          x + side * 4.8,
          2.04,
          -1.5,
          0.13,
          4.08,
          0.13,
        );
        b(
          'Concourse / canopy post shoe',
          m.stone,
          x + side * 4.8,
          0.095,
          -1.5,
          0.38,
          0.19,
          0.38,
          false,
          0.018,
        );
        beam(
          'Concourse / canopy knee brace',
          [x + side * 4.8, 3.25, -1.5],
          [x + side * 3.75, 4.19, -1.5],
          0.035,
        );
      }
      for (let slat = 0; slat < 12; slat++)
        b('Concourse / front soffit slat', m.timber, x, 4.08, -1.8 + slat * 0.2, 9.8, 0.055, 0.1);
    }
    // Deliberate side pockets keep the three central kiosk approach routes open.
    for (const x of [-7, 7])
      for (const z of [-5.5, -10.5]) {
        b('Concourse / picnic table top', m.timber, x, 0.78, z, 3.35, 0.09, 1.03, false, 0.025);
        for (const end of [-1, 1])
          b(
            'Concourse / bench support crossbar',
            m.steel,
            x + end * 1.15,
            0.395,
            z,
            0.07,
            0.07,
            2.0,
          );
        for (const side of [-1, 1]) {
          b(
            'Concourse / picnic bench',
            m.timber,
            x,
            0.46,
            z + side * 0.87,
            3.35,
            0.08,
            0.36,
            false,
            0.025,
          );
          for (const end of [-1, 1])
            beam(
              'Concourse / table trestle',
              [x + end * 1.15, 0, z + side * 0.95],
              [x + end * 1.15, 0.73, z + side * 0.25],
              0.038,
            );
        }
      }
  } else {
    throw new Error(`Unknown Aurel district architecture: ${String(kind)}`);
  }
  root.userData.architecture = {
    revision: '27H.4-constructed-venue-v1',
    kind,
    finalArtApproved: false,
  };
}
