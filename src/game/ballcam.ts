import * as BABYLON from '@babylonjs/core';
import type { Ball } from './ball';

/** Size of the picture-in-picture as a fraction of the screen; it starts in the top-right corner. */
const SIZE = 0.28;
/** How far behind and above the ball the drone flies, in metres: close in flight, further back (over the player's shoulder) while the ball is carried. */
const BEHIND = 1.1;
const ABOVE = 0.22;
const BEHIND_HELD = 3.2;
const ABOVE_HELD = 0.9;
/** Babylon's roll direction: with this sign a right-hand turn rolls the view right. */
const BANK_SIGN = -1;

/**
 * A picture-in-picture "FPV drone" that chases the ball: it flies just behind the ball along its line
 * of travel, banks into curling kicks, and hangs back behind the player while the ball is carried.
 */
export class BallCam {
  readonly camera: BABYLON.UniversalCamera;
  private frame: HTMLElement;
  private dir = new BABYLON.Vector3(0, 0, 1);
  private bank = 0;
  private behind = BEHIND_HELD;
  private above = ABOVE_HELD;
  private on = false;

  constructor(
    private scene: BABYLON.Scene,
    private main: BABYLON.Camera,
    private ball: Ball,
  ) {
    this.camera = new BABYLON.UniversalCamera('ballCam', new BABYLON.Vector3(0, 2, -3), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.05;
    this.camera.maxZ = 2000;
    this.camera.fov = 1.0;
    this.camera.viewport = new BABYLON.Viewport(1 - SIZE, 1 - SIZE, SIZE, SIZE);
    this.frame = document.getElementById('ballcam')!;
    this.place(1 - SIZE, 0);
    this.makeDraggable();
  }

  /** Puts the picture's top-left corner at (left, top), as fractions of the screen, kept on screen. */
  private place(left: number, top: number): void {
    left = BABYLON.Scalar.Clamp(left, 0, 1 - SIZE);
    top = BABYLON.Scalar.Clamp(top, 0, 1 - SIZE);
    // Babylon viewports are measured from the bottom-left; the HTML frame from the top-left.
    this.camera.viewport.x = left;
    this.camera.viewport.y = 1 - top - SIZE;
    Object.assign(this.frame.style, { left: `${left * 100}%`, top: `${top * 100}%`, width: `${SIZE * 100}%`, height: `${SIZE * 100}%` });
  }

  /** Drag the picture anywhere on screen with the mouse or a finger. */
  private makeDraggable(): void {
    let drag: { id: number; x: number; y: number; left: number; top: number } | null = null;
    this.frame.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: this.camera.viewport.x, top: 1 - this.camera.viewport.y - SIZE };
      try {
        this.frame.setPointerCapture(e.pointerId);
      } catch {
        // Dragging still works while the pointer stays over the picture.
      }
    });
    this.frame.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      this.place(drag.left + (e.clientX - drag.x) / innerWidth, drag.top + (e.clientY - drag.y) / innerHeight);
    });
    const end = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) drag = null;
    };
    this.frame.addEventListener('pointerup', end);
    this.frame.addEventListener('pointercancel', end);
  }

  get enabled(): boolean {
    return this.on;
  }

  toggle(): boolean {
    this.on = !this.on;
    this.frame.hidden = !this.on;
    this.scene.activeCameras = this.on ? [this.main, this.camera] : [this.main];
    if (this.on) this.snap();
    return this.on;
  }

  /** Off, and back to the main camera only (a new game). */
  off(): void {
    if (this.on) this.toggle();
  }

  /** `facing` is the carrier's forward direction, used while the ball has no flight of its own. */
  update(dt: number, facing: BABYLON.Vector3): void {
    if (!this.on) return;
    const v = this.ball.velocity();
    const flat = new BABYLON.Vector3(v.x, 0, v.z);
    const want = flat.length() > 1.5 ? flat.normalize() : facing.clone();
    // Turn towards the line of travel; the sideways swing becomes the drone's bank.
    const prev = this.dir.clone();
    this.dir = BABYLON.Vector3.Lerp(this.dir, want, Math.min(1, dt * 5)).normalize();
    const turn = BABYLON.Vector3.Cross(prev, this.dir).y / Math.max(dt, 1e-3);
    this.bank += (BABYLON.Scalar.Clamp(turn * 0.3, -0.3, 0.3) - this.bank) * Math.min(1, dt * 4);

    const b = this.ball.position;
    const climb = v.length() > 1.5 ? BABYLON.Scalar.Clamp(v.y / Math.max(1, v.length()), -0.6, 0.6) : 0;
    const free = this.ball.isFree;
    const k = Math.min(1, dt * 6);
    this.behind += ((free ? BEHIND : BEHIND_HELD) - this.behind) * k;
    this.above += ((free ? ABOVE : ABOVE_HELD) - this.above) * k;
    const goal = b.subtract(this.dir.scale(this.behind)).add(new BABYLON.Vector3(0, this.above - climb * this.behind * 0.5, 0));
    goal.y = Math.max(0.25, goal.y);
    // Locked to the ball (the direction is what's smoothed), so a 30 m/s kick doesn't leave the drone behind.
    this.camera.position.copyFrom(goal);
    // Look just past the ball so it sits a little below the centre of the picture.
    const ahead = b.add(this.dir.scale(2)).add(new BABYLON.Vector3(0, climb * 1.2 + 0.15, 0));
    this.camera.setTarget(ahead);
    // Roll into the turn like a drone banking after a curling ball.
    this.camera.rotation.z = BANK_SIGN * this.bank;
  }

  private snap(): void {
    const b = this.ball.position;
    this.camera.position = b.subtract(this.dir.scale(this.behind)).add(new BABYLON.Vector3(0, this.above, 0));
  }
}
