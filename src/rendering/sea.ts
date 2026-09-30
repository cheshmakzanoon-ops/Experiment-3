import * as T from 'three';
import { canvasTexture } from './geometry.ts';

/** Tileable original wave normals: sums of periodic sines, encoded tangent
 * space. Static (no wall-clock animation), so held and replayed frames match. */
function waveNormals(size = 256) {
  const texture = canvasTexture(size, size, (context) => {
    const image = context.createImageData(size, size);
    const height = (x: number, y: number) => {
      const u = (x / size) * Math.PI * 2,
        v = (y / size) * Math.PI * 2;
      return (
        Math.sin(u * 3 + v * 2) * 0.5 +
        Math.sin(u * 5 - v * 7 + 1.3) * 0.25 +
        Math.sin(u * 11 + v * 9 + 0.4) * 0.12 +
        Math.sin(-u * 17 + v * 13 + 2.2) * 0.06
      );
    };
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const dx = height(x + 1, y) - height(x - 1, y),
          dy = height(x, y + 1) - height(x, y - 1);
        const n = new T.Vector3(-dx * 2.2, -dy * 2.2, 1).normalize();
        const i = (y * size + x) * 4;
        image.data[i] = (n.x * 0.5 + 0.5) * 255;
        image.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
        image.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
        image.data[i + 3] = 255;
      }
    context.putImageData(image, 0, 0);
  });
  texture.colorSpace = T.NoColorSpace;
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(160, 160);
  texture.name = 'Original sea wave normals';
  return texture;
}

/** A single sea surface at the venue's sea level. Land terrain above it
 * occludes it by depth; it receives the sky environment and local probe, so
 * the water reflects the actual sky, weather and night lighting. */
export function buildSea(level: number) {
  const material = new T.MeshPhysicalMaterial({
    color: 0x0d3a4a,
    roughness: 0.12,
    metalness: 0,
    normalMap: waveNormals(),
    normalScale: new T.Vector2(0.35, 0.35),
    clearcoat: 0.6,
    clearcoatRoughness: 0.05,
  });
  material.name = 'Vellamar sea surface';
  const geometry = new T.PlaneGeometry(5500, 5500, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const sea = new T.Mesh(geometry, material);
  sea.name = 'Sea';
  sea.position.y = level;
  sea.receiveShadow = false;
  sea.castShadow = false;
  return sea;
}

/** Coastal band on the land terrain: wet shingle at the waterline, then a
 * sand/pebble beach that breaks up with noise before the turf, except on steep
 * faces where the landform rock shading stays exposed. The geometry's `shore`
 * attribute (1 on the seaward strip, 0 inland) keeps low ground beside the
 * paddock grassed. It runs after the terrain finish, so Aurel's inland terrain
 * shader and cache key are unchanged. */
export function installShoreline(material: T.MeshStandardMaterial, seaLevel: number) {
  const previous = material.onBeforeCompile;
  const baseKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float shore;\nvarying float vShore;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShore=shore;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShore;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      float shoreHeight=vFinishWorld.y-${seaLevel.toFixed(3)};
      float shoreNoise=finishFilteredNoise(vFinishWorld.xz*.045);
      float shoreSlope=1.0-clamp(normalize(vFinishNormal).y,0.0,1.0);
      float beach=(1.0-smoothstep(.7,2.4,shoreHeight+(shoreNoise-.5)*1.6))*
        (1.0-smoothstep(.3,.5,shoreSlope))*vShore;
      vec3 shingle=mix(vec3(.30,.27,.21),vec3(.46,.41,.31),finishFilteredNoise(vFinishWorld.xz*.55));
      diffuseColor.rgb=mix(diffuseColor.rgb,shingle,beach);
      diffuseColor.rgb*=mix(1.0,.5,(1.0-smoothstep(-.05,.45,shoreHeight))*vShore);`,
      );
  };
  material.customProgramCacheKey = () => `${baseKey}:shoreline-v1:${seaLevel}`;
}

/** Seaward-strip weight for a terrain vertex: 1 within 60 m inland of the
 * coastline (and offshore), 0 beyond 140 m inland. */
export function shoreWeight(z: number, coastZ: number) {
  const inland = z - coastZ;
  const t = Math.min(1, Math.max(0, (inland - 60) / 80));
  return 1 - t * t * (3 - 2 * t);
}
