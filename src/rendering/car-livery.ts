import * as T from 'three';
import { canvasTexture } from './geometry.ts';

/** Original APEX identity on a UV-conforming skin, not floating logo planes or
 * marks extracted from the reference screenshots. Both flanks read outwards. */
export function flankLivery(paint: T.MeshPhysicalMaterial, side: number, id: number) {
  const size = 1024,
    material = paint.clone();
  material.color.set(0xffffff);
  material.map = canvasTexture(size, size, (context) => {
    context.fillStyle = paint.color.getStyle();
    context.fillRect(0, 0, size, size);
    // Tapered graphite rear section with a restrained warm-white coach line.
    context.fillStyle = '#10191d';
    context.beginPath();
    context.moveTo(0, 1024);
    context.lineTo(0, 860);
    context.lineTo(1024, 715);
    context.lineTo(1024, 1024);
    context.closePath();
    context.fill();
    context.strokeStyle = '#e3ddc9';
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(0, 846);
    context.lineTo(1024, 701);
    context.stroke();
    const centre = side > 0 ? 0.25 : 0.75;
    context.save();
    context.translate(centre * size, 440);
    context.rotate(side > 0 ? Math.PI / 2 : -Math.PI / 2);
    context.fillStyle = '#f6f1e3';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = 'italic 800 87px Arial';
    context.fillText('APEX', 0, 0, 430);
    context.font = '600 21px Arial';
    context.fillText('FORMULA  /  AUREL', 0, 65, 420);
    context.restore();
    context.save();
    context.translate(centre * size, 690);
    context.rotate(side > 0 ? Math.PI / 2 : -Math.PI / 2);
    context.fillStyle = '#f6f1e3';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '800 49px Arial';
    context.fillText(String(id + 7).padStart(2, '0'), 0, 0);
    context.restore();
  });
  material.map.name = `Original APEX car ${id + 7} ${side > 0 ? 'left' : 'right'} skin`;
  material.name = 'Clear-coated UV-conforming original livery';
  return material;
}
