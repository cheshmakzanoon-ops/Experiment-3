import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { helmetShell, helmetPatch } from './helmet-shell.ts';

/** Closed tailored limb and chest shapes with identical topology. Instanced
 * morph weights select a real shoulder/waist silhouette for torsos, without
 * turning every forearm into a torso or adding a draw call for every person. */
export function tailoredCrewGeometry() {
  const profile = [new T.Vector2(0, -0.5)];
  for (let row = 0; row <= 12; row++) {
    const t = row / 12,
      round = Math.sqrt(Math.max(0, 1 - ((t - 0.5) / 0.58) ** 2));
    profile.push(new T.Vector2((0.7 + 0.25 * Math.sin(Math.PI * t)) * round, t - 0.5));
  }
  profile.push(new T.Vector2(0, 0.5));
  const g = new T.LatheGeometry(profile, 12),
    torso = g.clone();
  const p = torso.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i),
      t = y + 0.5;
    // Hips, waist, ribcage, clavicles and a tapered neck seat.
    const shoulder = 1.0 + 0.52 * Math.exp(-(((t - 0.79) / 0.15) ** 2)),
      waist = 1 - 0.16 * Math.exp(-(((t - 0.32) / 0.16) ** 2));
    p.setX(i, p.getX(i) * shoulder * waist);
    p.setZ(i, p.getZ(i) * 0.76 * (1 + 0.13 * Math.sin(Math.PI * t)));
  }
  torso.computeVertexNormals();
  g.morphAttributes.position = [torso.getAttribute('position').clone()];
  g.morphAttributes.normal = [torso.getAttribute('normal').clone()];
  torso.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Solid shell and physically raised visor share a single vertex-colour batch.
 * Unit dimensions allow the existing actor placements to preserve body height. */
export function crewHelmetGeometry() {
  const shell = helmetShell(),
    visor = helmetPatch(-0.033, 0.043, 0.095, Math.PI - 0.095, 0.003, 5, 24);
  for (const [g, color] of [
    [shell, 0xe1ded0],
    [visor, 0x162a32],
  ] as const) {
    const p = g.getAttribute('position'),
      c = new T.Color(color),
      colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new T.BufferAttribute(colors, 3));
  }
  const g = mergeGeometries([shell, visor], false)!;
  shell.dispose();
  visor.dispose();
  g.scale(1 / 0.148, 1 / 0.15, 1 / 0.16);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** A closed glove with four individual curved digits and an opposed thumb.
 * Kept in one small shared buffer instead of dozens of meshes per mechanic. */
export function crewGloveGeometry() {
  const parts: T.BufferGeometry[] = [new T.SphereGeometry(1, 12, 8).scale(0.68, 0.66, 0.48)];
  for (let f = 0; f < 4; f++) {
    const x = (f - 1.5) * 0.31,
      length = f === 0 || f === 3 ? 0.65 : 0.82;
    const curve = new T.CatmullRomCurve3([
      new T.Vector3(x, 0.36, 0),
      new T.Vector3(x, 0.73, 0.12),
      new T.Vector3(x, length, 0.45),
      new T.Vector3(x, 0.52, 0.59),
    ]);
    const finger = new T.TubeGeometry(curve, 8, 0.14, 6, false);
    parts.push(finger, new T.SphereGeometry(0.14, 6, 4).translate(x, 0.52, 0.59));
  }
  const thumb = new T.CapsuleGeometry(0.2, 0.46, 3, 8);
  thumb.rotateZ(-0.7);
  thumb.translate(-0.68, 0.1, 0.23);
  parts.push(thumb);
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Shared low-cost garment finish: filtered warp detail and shoulder stitching,
 * not painted illumination. Colour is selected per actual actor, not per frame. */
export function installCrewFabric(material: T.MeshStandardMaterial) {
  material.userData.weatherSurface = 'fabric';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCrewLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrewLocal=position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCrewLocal;')
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
      float weavePhase=vCrewLocal.y*200.;float resolved=1.-smoothstep(.5,2.,fwidth(weavePhase));
      roughnessFactor=clamp(roughnessFactor+sin(weavePhase)*resolved*.035,.8,1.);`,
      );
  };
  material.customProgramCacheKey = () => 'aurel-tailored-crew-v1';
  return material;
}
