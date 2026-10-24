import * as BABYLON from '@babylonjs/core';

export const BALL_RADIUS = 0.11;
const BALL_MASS = 0.48;
// 0.5 * air density * drag coefficient * cross-section area.
/** Per-second slowing of a ball on the grass. */
const GRASS_RESISTANCE = 1.6;
const DRAG_K = 0.5 * 1.2 * 0.25 * Math.PI * BALL_RADIUS * BALL_RADIUS;

/**
 * The football. While a player holds it (or is soloing or bouncing it) the body is animated and
 * follows a scripted position. Once kicked or hand-passed it becomes a dynamic Havok body.
 */
export class Ball {
  readonly mesh: BABYLON.Mesh;
  readonly body: BABYLON.PhysicsBody;
  private free = false;

  constructor(scene: BABYLON.Scene, shadows: BABYLON.ShadowGenerator) {
    this.mesh = BABYLON.MeshBuilder.CreateSphere('ball', { diameter: BALL_RADIUS * 2, segments: 24 }, scene);
    this.mesh.material = ballMaterial(scene);
    shadows.addShadowCaster(this.mesh);
    const agg = new BABYLON.PhysicsAggregate(
      this.mesh,
      BABYLON.PhysicsShapeType.SPHERE,
      { mass: BALL_MASS, restitution: 0.6, friction: 0.6 },
      scene,
    );
    this.body = agg.body;
    this.body.setLinearDamping(0.02);
    this.body.setAngularDamping(0.6);
    scene.onBeforePhysicsObservable.add(() => this.applyDrag());
    // Start held: animated bodies follow the mesh, which is what hold() moves.
    this.body.setMotionType(BABYLON.PhysicsMotionType.ANIMATED);
    this.body.disablePreStep = false;
  }

  get isFree(): boolean {
    return this.free;
  }

  get position(): BABYLON.Vector3 {
    return this.mesh.position;
  }

  velocity(): BABYLON.Vector3 {
    return this.free ? this.body.getLinearVelocity() : BABYLON.Vector3.Zero();
  }

  /** Pins the ball to a scripted position (in hands, mid-solo, mid-bounce). */
  hold(at: BABYLON.Vector3): void {
    if (this.free) {
      this.body.setMotionType(BABYLON.PhysicsMotionType.ANIMATED);
      this.body.disablePreStep = false;
      this.free = false;
    }
    this.mesh.position.copyFrom(at);
    this.body.setLinearVelocity(BABYLON.Vector3.Zero());
    this.body.setAngularVelocity(BABYLON.Vector3.Zero());
  }

  /** Releases the ball into free flight. */
  launch(velocity: BABYLON.Vector3, spin = BABYLON.Vector3.Zero()): void {
    this.body.setMotionType(BABYLON.PhysicsMotionType.DYNAMIC);
    // Let the next physics step pick up the mesh position (the release point), then hand control to Havok.
    this.body.disablePreStep = false;
    this.mesh.getScene().onAfterPhysicsObservable.addOnce(() => {
      if (this.free) this.body.disablePreStep = true;
    });
    this.free = true;
    this.body.setLinearVelocity(velocity);
    this.body.setAngularVelocity(spin);
  }

  private applyDrag(): void {
    if (!this.free) return;
    const v = this.body.getLinearVelocity();
    const speed = v.length();
    if (speed > 0.5) this.body.applyForce(v.scale(-DRAG_K * speed), this.mesh.position);
    // Grass slows a rolling or skidding ball, so it stops within a few metres instead of rolling on.
    if (this.mesh.position.y < BALL_RADIUS + 0.05) {
      this.body.applyForce(new BABYLON.Vector3(-v.x, 0, -v.z).scale(BALL_MASS * GRASS_RESISTANCE), this.mesh.position);
      this.body.setAngularVelocity(this.body.getAngularVelocity().scale(0.94));
    }
  }
}

function ballMaterial(scene: BABYLON.Scene): BABYLON.StandardMaterial {
  const t = new BABYLON.DynamicTexture('ballTex', { width: 512, height: 256 }, scene, true);
  const c = t.getContext() as unknown as CanvasRenderingContext2D;
  c.fillStyle = '#f3f1ea';
  c.fillRect(0, 0, 512, 256);
  c.strokeStyle = '#b9b4a6';
  c.lineWidth = 4;
  for (let i = 0; i < 512; i += 64) {
    c.beginPath();
    c.moveTo(i, 0);
    c.lineTo(i + 32, 256);
    c.stroke();
  }
  c.fillStyle = '#1f6b35';
  c.fillRect(0, 110, 512, 36);
  t.update();
  const m = new BABYLON.StandardMaterial('ballMat', scene);
  m.diffuseTexture = t;
  m.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
  return m;
}
