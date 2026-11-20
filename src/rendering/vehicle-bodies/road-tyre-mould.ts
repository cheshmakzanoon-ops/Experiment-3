import * as T from 'three';
import { drawWordmark, fitHeight } from '../studio/brand-atlas.ts';

export interface RoadTyreSize {
  radius: number;
  rim: number;
  width: number;
}

/** The sidewall description comes from the tyre cross-section in metres. */
export function tyreSizeMark({ radius, rim, width }: RoadTyreSize) {
  const section = Math.round((width * 1000) / 5) * 5;
  const profile = Math.round((((radius - rim) / width) * 100) / 5) * 5;
  const diameter = Math.round((rim * 2) / 0.0254);
  return `${section}/${profile} R${diameter}`;
}

const stamps = new Map<string, { texture: T.CanvasTexture; references: number }>();

/** Moulded rubber relief in polar coordinates. The same size/compound uses
 * one black-and-white mask across both axles, all cars and visible LODs. */
export function acquireTyreStamp(size: RoadTyreSize, pattern: string) {
  if (typeof document === 'undefined') return;
  const dimensions = tyreSizeMark(size);
  const key = dimensions + '-' + pattern;
  let stamp = stamps.get(key);
  if (!stamp) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#fff';
    const compound =
      pattern === 'block' ? 'ALL TERRAIN' : pattern === 'slick' ? 'SPORT' : 'TOURING';
    const style = { width: 1.12, weight: 0.15, tracking: 0.17 };
    for (const [i, label] of ['NORTHLINE', dimensions, compound, dimensions].entries()) {
      const height = fitHeight(label, 179, i % 2 ? 21 : 27, style);
      drawWordmark(ctx, label, (i + 0.5) * 256, 33, height, style);
    }
    const texture = new T.CanvasTexture(canvas);
    texture.name = 'Sidewall mould ' + key;
    texture.colorSpace = T.NoColorSpace;
    texture.wrapS = T.RepeatWrapping;
    texture.anisotropy = 4;
    stamps.set(key, (stamp = { texture, references: 0 }));
  }
  stamp.references++;
  let released = false;
  return {
    texture: stamp.texture,
    release() {
      if (released) return;
      released = true;
      if (--stamp.references === 0) {
        stamps.delete(key);
        stamp.texture.dispose();
      }
    },
  };
}

/** Unit-period slot coverage averaged across a pixel or centred shutter. */
export const periodicCutGLSL = `
  float cutPrefix(float x,float width){
    return floor(x)*(2.0*width)+clamp(fract(x)-(0.5-width),0.0,2.0*width);
  }
  float roadSipe(float phase,float width,float span){
    span=max(span,.001);
    return clamp((cutPrefix(phase+span*.5,width)-cutPrefix(phase-span*.5,width))/span,0.,1.);
  }`;

/** The axle rotates about +X while atan(z,-y) increases about -X.
 * Inverse rotation therefore ADDS recorded phase when reading the mould.
 * Interpolate the radial vector, then take its angle at the pixel: interpolating
 * the wrapped angle itself folds a whole revolution into one mesh segment. */
export const roadTyreFunctions = `
  varying vec2 tyreRadial;
  uniform vec2 tyreMould; // bead radius / outer radius, shutter turns
  ${periodicCutGLSL}
  vec2 aroundGradient(vec2 radial) {
    vec2 tangent=vec2(radial.y,-radial.x)/(max(dot(radial,radial),.000001)*6.2831853);
    return vec2(dot(tangent,dFdx(radial)),dot(tangent,dFdy(radial)));
  }`;
