import * as T from 'three';

/** Soft hollow jump marker, with a ground collar, moulded returns and a
 * visible bore. The marked shoulder and lip catch the arena light. Both
 * sizes share the same indexed surface and material. */
export function mxJumpMarkerGeometry() {
  // Radius, height and diffuse colour on each side of the formed profile.
  const profiles: readonly [number, number, number][] = [
    [0.046, -0.07, 0x494138],
    [0.072, -0.005, 0x4c463b],
    [0.071, 0.046, 0x504c40],
    [0.055, 0.056, 0xb7b1a2],
    [0.054, 0.099, 0xfff7e7],
    [0.048, 0.151, 0xffffff],
    [0.041, 0.957, 0xfffaf2],
    [0.044, 0.963, 0x615e59],
    [0.044, 0.989, 0x666460],
    [0.041, 0.995, 0xfffaf2],
    [0.038, 1.125, 0xfff7eb],
    [0.04, 1.13, 0x71706a],
    [0.04, 1.151, 0x777771],
    [0.037, 1.157, 0xffffff],
    [0.033, 1.278, 0xfff8ec],
    [0.032, 1.296, 0xddcfc0],
    [0.025, 1.296, 0xb9ab9c],
    [0.024, 1.236, 0x60574f],
    [0.001, 1.229, 0x51473f],
  ];
  const geometry = new T.LatheGeometry(
    profiles.map(([r, y]) => new T.Vector2(r, y)),
    10,
  );
  const positions = geometry.getAttribute('position'),
    colours: number[] = [],
    colour = new T.Color();
  for (let i = 0; i < positions.count; i++) {
    const profile = profiles[i % profiles.length],
      h = Math.max(0, profile[1] / 1.296);
    positions.setX(i, positions.getX(i) + 0.026 * h * h);
    positions.setZ(i, positions.getZ(i) + 0.011 * h * h);
    colour.setHex(profile[2]);
    colours.push(colour.r, colour.g, colour.b);
  }
  geometry.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = 'Moulded hollow motocross jump marker';
  return geometry;
}
