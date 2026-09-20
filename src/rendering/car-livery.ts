import * as T from 'three';
import { canvasTexture } from './geometry.ts';
import type { Livery } from '../storage/livery.ts';
const sourceCanvases = new WeakMap<T.Texture, HTMLCanvasElement>();

/** Paint into the original UV canvas so quality changes never restore a stale livery. */
function drawFlank(
  context: CanvasRenderingContext2D,
  primary: string,
  side: number,
  id: number,
  livery?: Livery,
) {
  const size = 1024;
  context.clearRect(0, 0, size, size);
  context.fillStyle = livery?.primary ?? primary;
  context.fillRect(0, 0, size, size);
  const pattern = livery?.pattern ?? 'sweep';
  context.fillStyle = '#10191d';
  context.beginPath();
  context.moveTo(0, 1024);
  context.lineTo(0, pattern === 'split' ? 590 : 860);
  context.lineTo(1024, pattern === 'split' ? 590 : pattern === 'minimal' ? 860 : 715);
  context.lineTo(1024, 1024);
  context.closePath();
  context.fill();
  context.strokeStyle = livery?.accent ?? '#e3ddc9';
  context.lineWidth = pattern === 'split' ? 24 : 8;
  context.beginPath();
  context.moveTo(0, pattern === 'split' ? 578 : 846);
  context.lineTo(1024, pattern === 'split' ? 578 : pattern === 'minimal' ? 846 : 701);
  context.stroke();
  const centre = side > 0 ? 0.25 : 0.75;
  context.save();
  context.translate(centre * size, 440);
  context.rotate(side > 0 ? Math.PI / 2 : -Math.PI / 2);
  context.fillStyle = '#f6f1e3';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = 'italic 800 87px Arial';
  context.fillText(livery?.sponsor ?? 'APEX', 0, 0, 430);
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
  context.fillText(String(livery?.number ?? id + 7).padStart(2, '0'), 0, 0);
  context.restore();
}
/** Original marks on a UV-conforming skin, never extracted reference artwork. */
export function flankLivery(paint: T.MeshPhysicalMaterial, side: number, id: number) {
  const material = paint.clone();
  material.color.set(0xffffff);
  material.map = canvasTexture(1024, 1024, (context) =>
    drawFlank(context, paint.color.getStyle(), side, id),
  );
  sourceCanvases.set(material.map, material.map.image as HTMLCanvasElement);
  material.userData.liverySide = side;
  material.map.name = `Original APEX car ${id + 7} ${side > 0 ? 'left' : 'right'} skin`;
  material.name = 'Clear-coated UV-conforming original livery';
  return material;
}
export function repaintFlank(material: T.MeshPhysicalMaterial, id: number, livery: Livery) {
  if (!material.map) return;
  const canvas = sourceCanvases.get(material.map);
  const context = canvas?.getContext('2d');
  if (!context) return;
  drawFlank(context, livery.primary, material.userData.liverySide as number, id, livery);
  material.map.needsUpdate = true;
}
