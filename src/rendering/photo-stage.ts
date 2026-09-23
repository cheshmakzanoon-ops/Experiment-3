import * as T from 'three';

/** Visible to environment probes, never an opaque wall in an inspection view. */
export const STUDIO_REFLECTION_LAYER = 1;

/** Original neutral studio, not a screenshot backdrop. A world-space stage
 * follows the frozen subject; all visibility/lighting changes are restored by
 * the renderer after each studio render. It never moves the simulated car. */
export class PhotoStage {
  readonly root = new T.Group();
  readonly background = new T.Color(0x080d15);
  private orientation = new T.Euler();
  constructor() {
    this.root.name = 'Original dark livery showroom · references 005 026 031';
    const floor = new T.Mesh(
      new T.CircleGeometry(65, 96),
      new T.MeshStandardMaterial({ color: 0x131b29, metalness: 0.3, roughness: 0.48 }),
    );
    floor.rotation.x = -Math.PI / 2;
    // The podium top is y=0. Keep the surrounding floor below its base;
    // coplanar surfaces here caused full-screen radial depth fighting.
    floor.position.y = -0.102;
    floor.receiveShadow = true;
    const podium = new T.Mesh(
      new T.CylinderGeometry(4.8, 4.9, 0.1, 96),
      new T.MeshStandardMaterial({ color: 0x293141, metalness: 0.5, roughness: 0.32 }),
    );
    podium.position.y = -0.05;
    podium.receiveShadow = true;
    const rim = new T.Mesh(
      new T.TorusGeometry(4.83, 0.022, 6, 96),
      new T.MeshBasicMaterial({ color: 0x76c8db }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.025;
    this.root.add(floor, podium, rim);
    // Softbox silhouettes are real emissive geometry. Broad non-shadow lights
    // supplement the existing shadowed key without adding shadow-map passes.
    for (const side of [-1, 1]) {
      const strip = new T.Mesh(
        new T.BoxGeometry(0.08, 3.5, 4.8),
        new T.MeshBasicMaterial({ color: side < 0 ? 0xb6dcff : 0xffecd0 }),
      );
      strip.name = 'Reflection-only studio softbox';
      strip.layers.set(STUDIO_REFLECTION_LAYER);
      strip.position.set(side * 7, 2.8, -0.6);
      strip.rotation.z = side * -0.16;
      const fill = new T.PointLight(side < 0 ? 0xb6dcff : 0xffecd0, 55, 24, 2);
      fill.position.set(side * 4.2, 3.8, 1.5);
      this.root.add(strip, fill);
    }
    this.root.visible = false;
  }
  position(subject: T.Object3D, floorY: number) {
    this.root.position.set(subject.position.x, floorY, subject.position.z);
    this.root.quaternion.copy(subject.quaternion);
    // Level floor; do not inherit bank/suspension body roll into the stage.
    this.root.rotation.set(0, this.orientation.setFromQuaternion(subject.quaternion, 'YXZ').y, 0);
    this.root.updateMatrixWorld(true);
  }
}

/** Reversible, testable scene-only state. Restores originally hidden objects,
 * fog identity and colour even when a render throws; never toggles them on blindly. */
export class ScenePresentationScope {
  private active = false;
  private background: T.Scene['background'] = null;
  private fog: T.Scene['fog'] = null;
  private fogColor = new T.Color();
  private objects: T.Object3D[] = [];
  private visibility: boolean[] = [];
  constructor(private scene: T.Scene) {}
  begin(background: T.Color, noFog: boolean, fogColor?: T.Color) {
    if (this.active) throw new Error('Scene presentation scope is already active');
    this.active = true;
    this.background = this.scene.background;
    this.fog = this.scene.fog;
    if (this.fog) this.fogColor.copy(this.fog.color);
    this.scene.background = background;
    if (noFog) this.scene.fog = null;
    else if (this.fog && fogColor) this.fog.color.copy(fogColor);
  }
  visibilityFor(object: T.Object3D, visible: boolean) {
    if (!this.active) throw new Error('Scene presentation scope must be active');
    if (!this.objects.includes(object)) {
      this.objects.push(object);
      this.visibility.push(object.visible);
    }
    object.visible = visible;
  }
  restore() {
    if (!this.active) return;
    this.scene.background = this.background;
    this.scene.fog = this.fog;
    if (this.fog) this.fog.color.copy(this.fogColor);
    for (let i = 0; i < this.objects.length; i++) this.objects[i].visible = this.visibility[i];
    this.objects.length = this.visibility.length = 0;
    this.active = false;
  }
}
