import * as T from 'three';

/** A small original woven normal/roughness field, shared by one driver's suit
 * and gloves. Data textures work without a DOM and contain no baked lighting. */
export function fabricPixels(size = 128) {
  if (!Number.isInteger(size) || size < 32 || size > 256 || size % 16 !== 0)
    throw new Error('Fabric size must be a multiple of 16 between 32 and 256');
  const height = new Float32Array(size * size);
  const normal = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(normal.length);
  // Never sample the weave at its Nyquist limit; eight texels resolve each yarn.
  const cell = size / Math.min(16, size / 8);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const warp = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const across = ((warp ? x : y) + 0.5) / cell;
      const along = ((warp ? y : x) + 0.5) / cell;
      height[y * size + x] =
        0.5 + 0.3 * Math.cos(across * Math.PI * 2) + 0.05 * Math.cos(along * Math.PI * 6);
    }
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.65;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.65;
      const length = Math.hypot(dx, dy, 1);
      normal[i] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      normal[i + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
      normal[i + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
      normal[i + 3] = roughness[i + 3] = 255;
      roughness[i] = roughness[i + 1] = roughness[i + 2] = Math.round(220 + at(x, y) * 30);
    }
  return { normal, roughness };
}
export function driverMaterials() {
  const size = 128,
    pixels = fabricPixels(size);
  const data = (bytes: Uint8Array, name: string) => {
    const texture = new T.DataTexture(bytes, size, size, T.RGBAFormat);
    texture.name = `Original woven ${name}`;
    texture.colorSpace = T.NoColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.repeat.set(3, 3);
    texture.generateMipmaps = true;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.magFilter = T.LinearFilter;
    texture.anisotropy = 4;
    texture.userData.surfaceDetail = true;
    texture.needsUpdate = true;
    return texture;
  };
  const normalMap = data(pixels.normal, 'normal'),
    roughnessMap = data(pixels.roughness, 'roughness');
  const fabric = (name: string, color: number) => {
    const material = new T.MeshStandardMaterial({
      color,
      normalMap,
      normalScale: new T.Vector2(0.3, 0.3),
      roughnessMap,
      roughness: 1,
      metalness: 0,
    });
    material.name = name;
    material.userData.weatherSurface = 'fabric';
    return material;
  };
  return {
    suit: fabric('Original teal woven driver suit', 0x283f46),
    glove: fabric('Original sage woven glove', 0x8eaaa8),
    panel: fabric('Original dark glove reinforcement', 0x394b4e),
    grip: new T.MeshStandardMaterial({
      name: 'Matte silicone glove grip',
      color: 0x1c2326,
      roughness: 0.94,
    }),
    stitch: new T.MeshStandardMaterial({ name: 'Glove stitching', color: 0xaaa895, roughness: 1 }),
  };
}
