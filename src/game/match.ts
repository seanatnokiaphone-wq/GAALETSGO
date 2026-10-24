import * as BABYLON from '@babylonjs/core';
import {
  CarryTracker,
  HALF_LENGTH as HL,
  HALF_WIDTH as HW,
  addScore,
  classifyCrossing,
  distanceFromGoal,
  emptyScore,
  type RuleSet,
  type ShotMethod,
  type TeamScore,
} from '../rules';
import { PlayerFigure, type PoseName } from '../scene/player';
import { BALL_RADIUS, Ball } from './ball';
import { Hud } from './hud';
import { Input } from './input';

type Carry =
  | { kind: 'none' }
  | { kind: 'hand' }
  | { kind: 'bounce' | 'solo' | 'toePick'; t: number; from: BABYLON.Vector3 };

const STRIDE = 1.5; // metres per foot plant
const JOG = 5.5;
const SPRINT = 8;
const MOVE_DURATION = { bounce: 0.42, solo: 0.45, toePick: 0.55 } as const;
/** How close a ball on the ground has to be for E to toe-pick it, in metres. */
const TOE_PICK_REACH = 2.2;

const L_HANDS = PlayerFigure.CARRY_OFFSET;
const L_FOOT = new BABYLON.Vector3(0.1, 0.32, 0.55);
const L_TOE_LIFT = new BABYLON.Vector3(0.08, 0.6, 0.45);
const L_BOUNCE = new BABYLON.Vector3(0, BALL_RADIUS, 0.95);

/**
 * The first playable slice: one controlled Ardmore player who can run, carry, bounce, solo,
 * toe-pick, kick and hand-pass, with the referee enforcing the carry and scoring rules.
 */
export class Match {
  private carry: Carry = { kind: 'hand' };
  private tracker: CarryTracker;
  private home: TeamScore = emptyScore();
  private away: TeamScore = emptyScore();
  private clock = 0;
  private phase = 0;
  private speed = 0;
  /** A kick being powered up. `fire` is set if the key was let go mid-solo or mid-bounce. */
  private charge: { key: 'KeyK' | 'KeyL'; power: number; fire: boolean } | null = null;
  /** A hand-pass asked for mid-solo or mid-bounce, played as soon as the ball is back in hand. */
  private pendingHandPass = false;
  /** Direction the behind-the-player camera looks. Movement keys are relative to it. */
  private camYaw = 0;
  /** E pressed a moment before reaching the ball still counts, so the pick-up isn't missed at a run. */
  private toePickBuffer = 0;
  /** Where the player steps to stand over the ball during a toe-pick. */
  private pickSpot: BABYLON.Vector3 | null = null;
  /** Camera angle above the horizontal and distance from the player, set by dragging and the wheel. */
  private camPitch = 0.33;
  private camDist = 6.5;
  /** Seconds since the player last moved the camera by hand; the camera won't swing round for a moment after. */
  private sinceLook = 99;
  /** Broadcast camera: slide along the sideline, height and zoom. */
  private bcPan = 0;
  private bcHeight = 16;
  private bcFov = 0.5;
  private actionPose: { pose: PoseName; t: number } | null = null;
  private deadTime = 0;
  private sinceRelease = 0;
  private lastStrike: { method: ShotMethod; fromX: number; fromZ: number } = { method: 'kick', fromX: 0, fromZ: 0 };
  private prevBall = new BABYLON.Vector3();
  private broadcastCam = false;
  private marker: BABYLON.Mesh;

  constructor(
    scene: BABYLON.Scene,
    private camera: BABYLON.UniversalCamera,
    private player: PlayerFigure,
    private ball: Ball,
    private input: Input,
    private hud: Hud,
    private rules: RuleSet,
    private onRulesToggle: () => RuleSet,
  ) {
    this.tracker = new CarryTracker(rules);
    this.tracker.start('catch');
    this.player.place(35, -4, HL, 0);
    this.camYaw = this.player.root.rotation.y;
    this.marker = BABYLON.MeshBuilder.CreateDisc('marker', { radius: 0.55, tessellation: 32 }, scene);
    this.marker.rotation.x = Math.PI / 2;
    const mm = new BABYLON.StandardMaterial('markerMat', scene);
    mm.emissiveColor = new BABYLON.Color3(0.95, 0.76, 0.18);
    mm.disableLighting = true;
    mm.alpha = 0.55;
    this.marker.material = mm;
    hud.setRules(rules);
    hud.setScore(this.home, this.away);
  }

  update(dt: number): void {
    const inp = this.input;
    if (inp.wasPressed('KeyR')) {
      this.rules = this.onRulesToggle();
      this.tracker.setRules(this.rules);
      this.hud.setRules(this.rules);
      this.hud.banner(this.rules.name.toUpperCase(), this.rules.twoPointArcRadius ? 'Two-point arc, kick-outs past the 40 m arc, 3 up and 4 back' : 'Goals 3, points 1, no arc', 2);
    }
    if (inp.wasPressed('KeyC')) this.broadcastCam = !this.broadcastCam;
    if (inp.wasPressed('KeyV')) this.resetView();
    this.applyLook(dt);

    if (this.deadTime > 0) {
      this.deadTime -= dt;
      if (this.deadTime <= 0) this.restart();
    } else {
      this.clock += dt;
      this.movePlayer(dt);
      this.handleBall(dt);
    }

    this.poseBallInHand(dt);
    this.updateCamera(dt);
    this.marker.position.set(this.player.root.position.x, 0.03, this.player.root.position.z);
    this.hud.setClock(this.clock);
    const inHand = this.carry.kind === 'hand' || this.carry.kind === 'bounce' || this.carry.kind === 'solo';
    this.hud.setSteps(inHand ? this.tracker.steps : null, this.rules.maxSteps, this.tracker.canBounce());
    this.hud.setPower(this.charge ? this.charge.power : null);
    this.hud.update(dt);
    this.prevBall.copyFrom(this.ball.position);
  }

  private forward(): BABYLON.Vector3 {
    const r = this.player.root.rotation.y;
    return new BABYLON.Vector3(Math.sin(r), 0, Math.cos(r));
  }

  private toWorld(local: BABYLON.Vector3): BABYLON.Vector3 {
    return BABYLON.Vector3.TransformCoordinates(local, this.player.root.computeWorldMatrix(true));
  }

  private movePlayer(dt: number): void {
    const inp = this.input;
    // Movement is relative to the camera. The broadcast camera always looks across the pitch (+z).
    // Using a steady camera direction, not the player's facing, stops left/right from spinning the player.
    const yaw = this.broadcastCam ? 0 : this.camYaw;
    const f = new BABYLON.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const r = new BABYLON.Vector3(f.z, 0, -f.x);
    const want = BABYLON.Vector3.Zero();
    const key = (a: string, b: string) => inp.isDown(a) || inp.isDown(b);
    if (key('KeyW', 'ArrowUp')) want.addInPlace(f);
    if (key('KeyS', 'ArrowDown')) want.subtractInPlace(f);
    if (key('KeyD', 'ArrowRight')) want.addInPlace(r);
    if (key('KeyA', 'ArrowLeft')) want.subtractInPlace(r);

    const stickLen = Math.hypot(inp.stick.x, inp.stick.y);
    if (stickLen > 0.15) want.addInPlace(f.scale(inp.stick.y)).addInPlace(r.scale(inp.stick.x));

    const moving = want.lengthSquared() > 0;
    const sprint = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight') || stickLen > 0.92;
    const target = moving ? (sprint ? SPRINT : stickLen > 0.15 ? Math.max(2, JOG * Math.min(1, stickLen * 1.3)) : JOG) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 6);
    const root = this.player.root;
    if (moving) {
      want.normalize();
      const goal = Math.atan2(want.x, want.z);
      let diff = goal - root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      root.rotation.y += diff * Math.min(1, dt * 10);
      // The camera swings round behind the player only while they run away from it.
      const away = Math.max(0, BABYLON.Vector3.Dot(want, f));
      let camDiff = root.rotation.y - this.camYaw;
      camDiff = Math.atan2(Math.sin(camDiff), Math.cos(camDiff));
      if (this.sinceLook > 1.5) this.camYaw += camDiff * Math.min(1, dt * 1.6 * away);
    }
    if (this.carry.kind === 'toePick' && this.pickSpot) {
      // Step in over the ball rather than running past it.
      this.speed *= Math.max(0, 1 - dt * 8);
      root.position = BABYLON.Vector3.Lerp(root.position, this.pickSpot, Math.min(1, dt * 12));
    } else {
      root.position.addInPlace(this.forward().scale(this.speed * dt));
    }
    root.position.x = BABYLON.Scalar.Clamp(root.position.x, -HL - 3, HL + 3);
    root.position.z = BABYLON.Scalar.Clamp(root.position.z, -HW - 3, HW + 3);

    // Each half run cycle is one foot plant.
    const before = Math.floor(this.phase / Math.PI);
    this.phase += ((this.speed * dt) / STRIDE) * Math.PI;
    const plants = Math.floor(this.phase / Math.PI) - before;
    if (this.carry.kind === 'hand') {
      for (let i = 0; i < plants; i++) {
        const res = this.tracker.step();
        if (!res.ok) return this.foul('Overcarrying', `${this.tracker.steps} steps without a bounce or solo`);
      }
    }

    if (this.actionPose) {
      this.actionPose.t -= dt;
      this.player.pose(this.actionPose.pose);
      if (this.actionPose.t <= 0) this.actionPose = null;
    } else if (this.carry.kind === 'toePick') {
      this.player.pose('toePick');
    } else if (this.speed > 0.3) {
      this.player.pose(this.carry.kind === 'hand' ? 'carry' : 'run', this.phase);
    } else {
      this.player.pose('stand');
    }
  }

  private handleBall(dt: number): void {
    const inp = this.input;
    const c = this.carry;

    const holding = c.kind === 'hand' || c.kind === 'bounce' || c.kind === 'solo' || c.kind === 'toePick';
    if (holding) {
      // Kicks and hand-passes asked for mid-solo or mid-bounce are kept and played once the ball is back in hand.
      if (!this.charge && (inp.wasPressed('KeyK') || inp.wasPressed('KeyL'))) {
        this.charge = { key: inp.wasPressed('KeyK') ? 'KeyK' : 'KeyL', power: 0, fire: false };
      }
      if (this.charge) {
        this.charge.power = Math.min(1, this.charge.power + dt * 1.1);
        if (inp.wasReleased(this.charge.key)) this.charge.fire = true;
      }
      if (c.kind !== 'hand' && inp.wasPressed('KeyJ')) this.pendingHandPass = true;
    }

    if (c.kind === 'hand') {
      if (this.charge?.fire) {
        const lofted = this.charge.key === 'KeyK';
        // A tap is a short chip; a full hold reaches about 60 m.
        this.release('kick', 8 + 24 * this.charge.power, lofted ? 0.5 : 0.12);
        this.charge = null;
      } else if (this.pendingHandPass || inp.wasPressed('KeyJ')) {
        this.pendingHandPass = false;
        this.release('handPass', 13, 0.22);
      } else if (inp.wasPressed('KeyB')) {
        const res = this.tracker.bounce();
        if (!res.ok) return this.foul('Double bounce', 'You can’t bounce twice in a row. Solo in between.');
        this.carry = { kind: 'bounce', t: 0, from: this.ball.position.clone() };
      } else if (inp.wasPressed('KeyO')) {
        this.tracker.solo();
        this.carry = { kind: 'solo', t: 0, from: this.ball.position.clone() };
      }
      this.hud.setPrompt('');
      return;
    }

    if (c.kind === 'none' && this.ball.isFree) {
      this.sinceRelease += dt;
      if (this.checkLines()) return;
      const p = this.ball.position;
      const me = this.player.root.position;
      const flat = Math.hypot(p.x - me.x, p.z - me.z);
      const speed = this.ball.velocity().length();
      const ownHandPass = this.lastStrike.method === 'handPass' && this.sinceRelease < 1.2;

      if (this.sinceRelease > 0.5 && !ownHandPass && flat < 1.0 && p.y > 0.8 && p.y < 2.6) {
        this.tracker.start('catch');
        this.carry = { kind: 'hand' };
        this.hud.setPrompt('');
        return;
      }
      const onGround = p.y < 0.35;
      this.toePickBuffer = inp.wasPressed('KeyE') ? 0.5 : Math.max(0, this.toePickBuffer - dt);
      if (onGround && flat < TOE_PICK_REACH && speed < 9 && this.toePickBuffer > 0) {
        this.startToePick(p);
        return;
      }
      if (onGround && flat < TOE_PICK_REACH && inp.wasPressed('KeyG')) {
        this.foul('Free out', 'The ball can’t be picked off the ground with the hands. Use a toe-pick.');
        return;
      }
      this.hud.setPrompt(onGround && flat < 6 ? 'E  toe-pick the ball into your hands' : '');
    }
  }

  /** Turn to the ball, step over it and flick it up off the toe into the hands. */
  private startToePick(ballPos: BABYLON.Vector3): void {
    const root = this.player.root;
    const dir = new BABYLON.Vector3(ballPos.x - root.position.x, 0, ballPos.z - root.position.z);
    if (dir.lengthSquared() > 1e-4) {
      dir.normalize();
      root.rotation.y = Math.atan2(dir.x, dir.z);
    } else {
      dir.copyFrom(this.forward());
    }
    this.pickSpot = new BABYLON.Vector3(ballPos.x - dir.x * 0.5, 0, ballPos.z - dir.z * 0.5);
    this.carry = { kind: 'toePick', t: 0, from: new BABYLON.Vector3(ballPos.x, BALL_RADIUS, ballPos.z) };
    this.toePickBuffer = 0;
    this.hud.setPrompt('');
  }

  /** Kick or hand-pass the ball. `loft` is the launch angle in radians. */
  private release(method: ShotMethod, speed: number, loft: number): void {
    const f = this.forward();
    const from = method === 'kick' ? this.toWorld(new BABYLON.Vector3(0, 0.45, 0.6)) : this.toWorld(L_HANDS);
    const v = f.scale(speed * Math.cos(loft)).add(new BABYLON.Vector3(0, speed * Math.sin(loft), 0)).add(f.scale(this.speed * 0.4));
    // Backspin on a kick, about the axis across the ball's flight.
    const spin = BABYLON.Vector3.Cross(f, BABYLON.Vector3.Up()).scale(method === 'kick' ? 6 : 1);
    this.ball.hold(from);
    this.ball.launch(v, spin);
    this.carry = { kind: 'none' };
    this.tracker.release();
    this.sinceRelease = 0;
    const me = this.player.root.position;
    this.lastStrike = { method, fromX: me.x, fromZ: me.z };
    this.actionPose = { pose: method === 'kick' ? 'kick' : 'handPass', t: 0.3 };
  }

  /** Detects scores, wides and the ball going over the sideline. Returns true if play stopped. */
  private checkLines(): boolean {
    const a = this.prevBall;
    const b = this.ball.position;
    for (const end of [1, -1] as const) {
      const line = end * HL;
      if ((a.x - line) * end < 0 && (b.x - line) * end >= 0) {
        const t = (line - a.x) / (b.x - a.x);
        const y = a.y + (b.y - a.y) * t;
        const z = a.z + (b.z - a.z) * t;
        const result = classifyCrossing({ y, z, end, method: this.lastStrike.method, fromX: this.lastStrike.fromX, fromZ: this.lastStrike.fromZ }, this.rules);
        const dist = Math.round(distanceFromGoal(this.lastStrike.fromX, this.lastStrike.fromZ, end));
        const how = this.lastStrike.method === 'kick' ? 'kick' : 'hand-pass';
        switch (result.kind) {
          case 'goal':
          case 'point':
          case 'twoPoint':
            this.home = addScore(this.home, result.kind);
            this.hud.setScore(this.home, this.away);
            this.hud.banner(result.kind === 'goal' ? 'GOAL' : result.kind === 'twoPoint' ? '2 POINTS' : 'POINT', `${dist} m ${how} · ${result.kind === 'goal' ? 'green' : 'white'} flag`, 2.5);
            break;
          case 'wide':
            this.hud.banner('WIDE', 'Kick-out to Kilcarra', 2.5);
            break;
          case 'disallowed':
            this.hud.banner('NO GOAL', 'A goal can’t be scored with a hand-pass', 2.5);
            break;
        }
        this.deadTime = 2.5;
        return true;
      }
    }
    if (Math.abs(b.z) > HW + BALL_RADIUS) {
      this.hud.banner('SIDELINE', 'Sideline kick', 2);
      this.deadTime = 2;
      return true;
    }
    return false;
  }

  private foul(title: string, detail: string): void {
    this.hud.banner(title.toUpperCase(), detail, 2.5);
    this.hud.setPrompt('');
    this.charge = null;
    this.pendingHandPass = false;
    this.deadTime = 2.5;
    this.speed = 0;
    this.player.pose('stand');
  }

  /** Placeholder restart until frees and kick-outs are built: the player gets the ball back in hand. */
  private restart(): void {
    const root = this.player.root;
    root.position.x = BABYLON.Scalar.Clamp(root.position.x, -HL + 5, HL - 5);
    root.position.z = BABYLON.Scalar.Clamp(root.position.z, -HW + 3, HW - 3);
    this.carry = { kind: 'hand' };
    this.tracker.start('catch');
    this.ball.hold(this.toWorld(L_HANDS));
  }

  private poseBallInHand(dt: number): void {
    const c = this.carry;
    if (c.kind === 'hand') {
      this.ball.hold(this.toWorld(L_HANDS));
      return;
    }
    if (c.kind === 'none') return;
    c.t += dt;
    const dur = MOVE_DURATION[c.kind];
    const u = Math.min(1, c.t / dur);
    const hands = this.toWorld(L_HANDS);
    let pos: BABYLON.Vector3;
    if (c.kind === 'bounce') {
      const ground = this.toWorld(L_BOUNCE);
      pos = u < 0.45 ? BABYLON.Vector3.Lerp(hands, ground, (u / 0.45) ** 2) : BABYLON.Vector3.Lerp(ground, hands, Math.sqrt((u - 0.45) / 0.55));
    } else if (c.kind === 'solo') {
      const foot = this.toWorld(L_FOOT);
      pos = u < 0.45 ? BABYLON.Vector3.Lerp(hands, foot, (u / 0.45) ** 2) : BABYLON.Vector3.Lerp(foot, hands, Math.sqrt((u - 0.45) / 0.55));
    } else {
      // Toe-pick: the ball waits on the grass while the player steps in, pops up off the toe, then into the hands.
      const lift = this.toWorld(L_TOE_LIFT);
      if (u < 0.35) pos = c.from;
      else if (u < 0.65) pos = BABYLON.Vector3.Lerp(c.from, lift, Math.sqrt((u - 0.35) / 0.3));
      else pos = BABYLON.Vector3.Lerp(lift, hands, (u - 0.65) / 0.35);
    }
    this.ball.hold(pos);
    if (u >= 1) {
      if (c.kind === 'toePick') {
        this.tracker.start('pickup');
        this.pickSpot = null;
      }
      this.carry = { kind: 'hand' };
    }
  }

  private applyLook(dt: number): void {
    const { dx, dy, zoom } = this.input.look;
    this.sinceLook += dt;
    if (dx === 0 && dy === 0 && zoom === 0) return;
    this.sinceLook = 0;
    if (this.broadcastCam) {
      this.bcPan = BABYLON.Scalar.Clamp(this.bcPan - dx * 0.08, -70, 70);
      this.bcHeight = BABYLON.Scalar.Clamp(this.bcHeight + dy * 0.05, 4, 45);
      this.bcFov = BABYLON.Scalar.Clamp(this.bcFov + zoom * 0.04, 0.25, 1.0);
    } else {
      this.camYaw += dx * 0.006;
      this.camPitch = BABYLON.Scalar.Clamp(this.camPitch + dy * 0.004, 0.05, 1.3);
      this.camDist = BABYLON.Scalar.Clamp(this.camDist + zoom * 0.8, 3, 18);
    }
  }

  private resetView(): void {
    this.camYaw = this.player.root.rotation.y;
    this.camPitch = 0.33;
    this.camDist = 6.5;
    this.bcPan = 0;
    this.bcHeight = 16;
    this.bcFov = 0.5;
  }

  private updateCamera(dt: number): void {
    const me = this.player.root.position;
    // Follow smoothly, but keep up closely while the camera is being dragged.
    const k = Math.min(1, dt * (this.sinceLook < 0.3 ? 14 : 4));
    if (this.broadcastCam) {
      this.camYaw = this.player.root.rotation.y;
      const want = new BABYLON.Vector3(me.x * 0.85 + this.bcPan, this.bcHeight, -HW - 18);
      this.camera.position = BABYLON.Vector3.Lerp(this.camera.position, want, k);
      this.camera.setTarget(new BABYLON.Vector3(me.x, 0, me.z * 0.6));
      this.camera.fov = this.bcFov;
    } else {
      const f = new BABYLON.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
      const back = this.camDist * Math.cos(this.camPitch);
      const up = 0.6 + this.camDist * Math.sin(this.camPitch);
      const want = me.subtract(f.scale(back)).add(new BABYLON.Vector3(0, Math.max(0.4, up), 0));
      this.camera.position = BABYLON.Vector3.Lerp(this.camera.position, want, k);
      this.camera.setTarget(me.add(f.scale(8)).add(new BABYLON.Vector3(0, 1.2, 0)));
      this.camera.fov = 0.9;
    }
  }

}
