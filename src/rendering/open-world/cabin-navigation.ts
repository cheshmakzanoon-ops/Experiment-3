import * as T from 'three';
import type { FestivalStatus } from '../../simulation/open-world/session.ts';

const WIDTH = 384, HEIGHT = 216, HEADER = 40;

/** The heading-up map, highlighted route and player arrow are precisely the
 * same raster displayed by the Festival HUD. Crop ahead of the car to fit
 * the wider in-dash glass, and print the actual road and posted speed. */
export function paintCabinNavigation(
  ctx: CanvasRenderingContext2D,
  map: HTMLCanvasElement,
  road: FestivalStatus['road'],
) {
  const visible = map.width * 0.70;
  const tall = visible * (HEIGHT - HEADER) / WIDTH;
  ctx.fillStyle = '#101a1c';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.drawImage(map, (map.width - visible) / 2, map.height / 2 - tall * 0.67,
    visible, tall, 0, HEADER, WIDTH, HEIGHT - HEADER);
  ctx.fillStyle = '#76c4b3';
  ctx.fillRect(0, HEADER - 2, WIDTH, 2);
  ctx.fillStyle = '#edf1e8';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '600 19px Arial, sans-serif';
  ctx.fillText(road.name, 13, HEADER / 2 + 1, WIDTH - 74);
  if (road.onRoad && road.limitKmh > 0) {
    ctx.beginPath();
    ctx.arc(WIDTH - 28, HEADER / 2, 16, 0, 2 * Math.PI);
    ctx.fillStyle = '#f2eee6';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#c54b3e';
    ctx.stroke();
    ctx.fillStyle = '#14181a';
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px Arial, sans-serif';
    ctx.fillText(String(road.limitKmh), WIDTH - 28, HEADER / 2 + 1, 25);
  }
}

/** One texture shared across a session's garage changes. Redraw at 8 Hz in
 * simulation time. Pausing a held frame never uploads an unchanged map. */
export class CabinNavigation {
  private pane: T.Mesh | null = null;
  private normal: T.Material | T.Material[] | null = null;
  private material: T.MeshBasicMaterial | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private texture: T.CanvasTexture | null = null;
  private lastTime = -Infinity;
  private lastRoad: FestivalStatus['road'] | null = null;
  private lastRoute = '';
  private lastDiscovered = -1;
  private lastX = Infinity;
  private lastZ = Infinity;
  private lastHeading = Infinity;
  uploads = 0;

  update(pane: T.Mesh | null, map: HTMLCanvasElement, road: FestivalStatus['road'],
    time: number, x: number, z: number, heading: number, route: string, discovered: number, night: number) {
    if (pane !== this.pane) {
      this.detach();
      if (pane && !this.material) {
        const canvas = document.createElement('canvas');
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        this.context = canvas.getContext('2d');
        if (!this.context) return;
        this.texture = new T.CanvasTexture(canvas);
        this.texture.colorSpace = T.SRGBColorSpace;
        this.texture.minFilter = T.LinearFilter;
        this.texture.generateMipmaps = false;
        this.texture.name = 'Solvane in-dash navigator';
        this.material = new T.MeshBasicMaterial({ map: this.texture, toneMapped: false });
      }
      this.pane = pane;
      if (pane && this.material) {
        this.normal = pane.material;
        pane.material = this.material;
        pane.visible = true;
      }
    }
    if (!pane || !this.context || !this.material || !this.texture) return;
    this.material.color.setScalar(1.04 - 0.50 * T.MathUtils.clamp(night, 0, 1));
    const elapsed = time - this.lastTime;
    const sameMap = this.lastRoad?.name === road.name && this.lastRoad.onRoad === road.onRoad &&
      this.lastRoad.limitKmh === road.limitKmh && this.lastRoute === route && this.lastDiscovered === discovered;
    if (sameMap && elapsed >= 0 && (
      elapsed < 0.125 || (Math.abs(x - this.lastX) < 0.25 && Math.abs(z - this.lastZ) < 0.25 &&
        Math.abs(heading - this.lastHeading) < 0.004))) return;
    paintCabinNavigation(this.context, map, road);
    this.texture.needsUpdate = true;
    this.lastRoad = road;
    this.lastRoute = route;
    this.lastDiscovered = discovered;
    this.lastTime = time;
    this.lastX = x;
    this.lastZ = z;
    this.lastHeading = heading;
    this.uploads++;
  }

  detach() {
    if (this.pane && this.normal) {
      this.pane.material = this.normal;
      this.pane.visible = false;
    }
    this.pane = null;
    this.normal = null;
    this.lastTime = -Infinity;
    this.lastX = this.lastZ = this.lastHeading = Infinity;
  }

  dispose() {
    this.detach();
    this.texture?.dispose();
    this.material?.dispose();
    this.texture = null;
    this.material = null;
    this.context = null;
  }
}
