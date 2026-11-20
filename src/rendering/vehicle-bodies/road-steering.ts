import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CabinLayout } from './cabin.ts';
import { roundedBox } from './loft.ts';

/** All original wheel components turn in one draw. The surface attribute
 * keeps leather, cast alloy and switch plastic physically distinct. */
const wheelMaterial = new T.MeshStandardMaterial({
  name: 'Festival steering leather, alloy and switches',
  vertexColors: true,
});
wheelMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nattribute vec2 wheelFinish; varying vec2 vWheelFinish;',
    )
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWheelFinish=wheelFinish;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vWheelFinish;')
    .replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor=vWheelFinish.x;',
    )
    .replace(
      '#include <metalnessmap_fragment>',
      '#include <metalnessmap_fragment>\nmetalnessFactor=vWheelFinish.y;',
    );
};
wheelMaterial.customProgramCacheKey = () => 'festival-driving-wheel-v1';

interface Finish {
  color: number;
  roughness: number;
  metalness: number;
}
const rubber = { color: 0x24282b, roughness: 0.72, metalness: 0 };
const leather = { color: 0x353432, roughness: 0.55, metalness: 0 };
const wood = { color: 0x805231, roughness: 0.33, metalness: 0 };
const metal = { color: 0x9da4a6, roughness: 0.31, metalness: 0.82 };
const satin = { color: 0x676d70, roughness: 0.41, metalness: 0.61 };
const key = { color: 0x474b4d, roughness: 0.56, metalness: 0 };
const marking = { color: 0xb8c1bb, roughness: 0.48, metalness: 0.04 };

function plate(shape: T.Shape, depth: number, bevel: number) {
  return new T.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelThickness: bevel,
    bevelSize: bevel,
    curveSegments: 8,
  });
}

function spoke(radius: number, classic: boolean, lower: boolean) {
  const shape = new T.Shape(),
    w = classic ? 0.012 : lower ? 0.016 : 0.021;
  shape.moveTo(0.025, -w);
  shape.quadraticCurveTo(radius * 0.61, -w * 0.87, radius * 0.92, -w * 0.67);
  shape.quadraticCurveTo(radius * 1.02, 0, radius * 0.92, w * 0.8);
  shape.quadraticCurveTo(radius * 0.65, w * 0.75, 0.031, w * 1.25);
  shape.lineTo(0.025, -w);
  if (classic) {
    for (const [fraction, size] of [
      [0.47, 0.005],
      [0.64, 0.0045],
      [0.8, 0.0038],
    ]) {
      const hole = new T.Path();
      hole.absellipse(fraction * radius, 0, size * 1.55, size, 0, Math.PI * 2, true, 0);
      shape.holes.push(hole);
    }
  } else if (lower) {
    const hole = new T.Path();
    hole.absellipse(radius * 0.63, 0, radius * 0.16, 0.005, 0, Math.PI * 2, true, 0);
    shape.holes.push(hole);
  }
  return plate(shape, classic ? 0.003 : 0.006, classic ? 0.0006 : 0.0014);
}

function airbag(radius: number, wide: boolean) {
  const s = new T.Shape(),
    hw = radius * (wide ? 0.52 : 0.43),
    hh = radius * 0.36;
  s.moveTo(-hw * 0.73, hh);
  s.quadraticCurveTo(0, hh * 1.13, hw * 0.73, hh);
  s.quadraticCurveTo(hw * 1.15, hh * 0.94, hw * 0.94, hh * 0.15);
  s.lineTo(hw * 0.53, -hh * 0.8);
  s.quadraticCurveTo(hw * 0.45, -hh, 0, -hh);
  s.quadraticCurveTo(-hw * 0.45, -hh, -hw * 0.53, -hh * 0.8);
  s.lineTo(-hw * 0.94, hh * 0.15);
  s.quadraticCurveTo(-hw * 1.15, hh * 0.94, -hw * 0.73, hh);
  return s;
}

function rim(radius: number, classic: boolean, sport: boolean) {
  const points: number[] = [],
    index: number[] = [],
    segments = 80,
    section = 12;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2,
      x = Math.cos(a),
      y = Math.sin(a);
    const rest = Math.exp(-((y - 0.27) ** 2) / 0.03) * Math.abs(x) ** 4;
    for (let j = 0; j <= section; j++) {
      const b = (j / section) * Math.PI * 2,
        outward = Math.cos(b),
        depth = Math.sin(b);
      const grip = classic ? 0.013 : 0.0165;
      const radial = radius + outward * (grip + (outward < 0 ? rest * 0.008 : rest * 0.001));
      points.push(
        radial * x,
        radial * y + (sport ? 0.0045 * Math.max(0, (-y - 0.7) / 0.3) ** 2 : 0),
        depth * (grip * 1.13 + rest * 0.002),
      );
    }
  }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < section; j++) {
      const a = i * (section + 1) + j,
        b = a + section + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // Weld lighting across both duplicated parameter seams.
  const n = g.getAttribute('normal'),
    v = new T.Vector3(),
    w = new T.Vector3();
  const weld = (a: number, b: number) => {
    v.fromBufferAttribute(n, a).add(w.fromBufferAttribute(n, b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z);
    n.setXYZ(b, v.x, v.y, v.z);
  };
  for (let i = 0; i <= segments; i++) weld(i * (section + 1), i * (section + 1) + section);
  for (let j = 0; j <= section; j++) weld(j, segments * (section + 1) + j);
  return g;
}

export function roadSteeringWheel(layout: CabinLayout) {
  const r = layout.wheel.radius;
  const classic = layout.id === 'rg63' || layout.id === 'rd2',
    sport = layout.style === 'supercar' || layout.style === 'prototype';
  const pieces: T.BufferGeometry[] = [];
  const add = (geometry: T.BufferGeometry, finish: Finish) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    for (const name of Object.keys(g.attributes))
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const count = g.getAttribute('position').count,
      colors = new Float32Array(count * 3),
      surface = new Float32Array(count * 2);
    const c = new T.Color(finish.color);
    for (let i = 0; i < count; i++) {
      c.toArray(colors, i * 3);
      surface[i * 2] = finish.roughness;
      surface[i * 2 + 1] = finish.metalness;
    }
    g.setAttribute('color', new T.BufferAttribute(colors, 3));
    g.setAttribute('wheelFinish', new T.BufferAttribute(surface, 2));
    pieces.push(g);
  };
  add(rim(r, classic, sport), classic && layout.id === 'rg63' ? wood : leather);
  for (const angle of [0.06, Math.PI - 0.06, -Math.PI / 2]) {
    add(
      spoke(r, classic, angle < 0)
        .rotateZ(angle)
        .translate(0, 0, classic ? 0.004 : 0.006),
      classic ? metal : satin,
    );
  }
  if (classic) {
    add(new T.CylinderGeometry(0.04, 0.037, 0.025, 32).rotateX(Math.PI / 2), satin);
    add(
      new T.CylinderGeometry(0.027, 0.029, 0.012, 32).rotateX(Math.PI / 2).translate(0, 0, -0.014),
      rubber,
    );
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      add(
        new T.CylinderGeometry(0.0025, 0.0025, 0.002, 6)
          .rotateX(Math.PI / 2)
          .translate(0.033 * Math.cos(a), 0.033 * Math.sin(a), -0.013),
        metal,
      );
    }
  } else {
    const shape = airbag(r, layout.style === 'truck' || layout.style === 'saloon');
    add(plate(shape, 0.025, 0.006).translate(0, 0, -0.024), rubber);
    add(plate(shape, 0.006, 0.003).scale(0.95, 0.93, 1).translate(0, 0, -0.032), leather);
    for (const side of [-1, 1]) {
      add(
        roundedBox(0.044, 0.031, 0.014, 0.006, 2)
          .rotateZ(side * 0.09)
          .translate(side * r * 0.65, 0.005, -0.001),
        rubber,
      );
      for (let i = 0; i < 3; i++) {
        const x = side * (r * 0.65 + (i - 1) * 0.011);
        add(roundedBox(0.009, 0.016, 0.006, 0.002, 1).translate(x, 0.005, -0.01), key);
        add(new T.BoxGeometry(0.004, 0.0013, 0.0008).translate(x, 0.008, -0.0131), marking);
      }
      if (sport)
        add(
          roundedBox(0.026, 0.064, 0.006, 0.006, 2)
            .rotateZ(-side * 0.2)
            .translate(side * r * 0.73, 0.035, 0.032),
          satin,
        );
    }
  }
  const geometry = mergeGeometries(pieces)!;
  for (const piece of pieces) piece.dispose();
  const mesh = new T.Mesh(geometry, wheelMaterial);
  mesh.name = classic ? 'Drilled three-spoke road wheel' : 'Padded multifunction road wheel';
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
