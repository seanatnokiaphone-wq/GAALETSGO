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
const MOVE_DURATION = { bounce: 0.42, solo: 0.45, toePick: 0.4 } as const;

const L_HANDS = PlayerFigure.CARRY_OFFSET;
const L_FOOT = new BABYLON.Vector3(0.1, 0.32, 0.55);
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
  private charge: { key: 'KeyK' | 'KeyL'; power: number } | null = null;
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
    // Movement is relative to the camera's view across the ground.
    const camF = this.camera.getForwardRay().direction;
    const f = new BABYLON.Vector3(camF.x, 0, camF.z).normalize();
    const r = new BABYLON.Vector3(f.z, 0, -f.x);
    const want = BABYLON.Vector3.Zero();
    if (inp.isDown('KeyW')) want.addInPlace(f);
    if (inp.isDown('KeyS')) want.subtractInPlace(f);
    if (inp.isDown('KeyD')) want.addInPlace(r);
    if (inp.isDown('KeyA')) want.subtractInPlace(r);

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
    }
    root.position.addInPlace(this.forward().scale(this.speed * dt));
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
    } else if (this.speed > 0.3) {
      this.player.pose(this.carry.kind === 'hand' ? 'carry' : 'run', this.phase);
    } else {
      this.player.pose('stand');
    }
  }

  private handleBall(dt: number): void {
    const inp = this.input;
    const c = this.carry;

    if (c.kind === 'hand') {
      if (inp.wasPressed('KeyB')) {
        const res = this.tracker.bounce();
        if (!res.ok) return this.foul('Double bounce', 'You can’t bounce twice in a row. Solo in between.');
        this.carry = { kind: 'bounce', t: 0, from: this.ball.position.clone() };
      } else if (inp.wasPressed('KeyO')) {
        this.tracker.solo();
        this.carry = { kind: 'solo', t: 0, from: this.ball.position.clone() };
      } else if (inp.wasPressed('KeyJ')) {
        this.release('handPass', 13, 0.22);
      } else if (inp.wasPressed('KeyK') || inp.wasPressed('KeyL')) {
        this.charge = { key: inp.wasPressed('KeyK') ? 'KeyK' : 'KeyL', power: 0 };
      }
      if (this.charge) {
        this.charge.power = Math.min(1, this.charge.power + dt * 1.1);
        if (inp.wasReleased(this.charge.key)) {
          const lofted = this.charge.key === 'KeyK';
          this.release('kick', 14 + 20 * this.charge.power, lofted ? 0.5 : 0.12);
          this.charge = null;
        }
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
      if (onGround && flat < 1.4 && speed < 7) {
        this.hud.setPrompt('E  toe-pick   ·   G  pick up with hands (foul)');
        if (inp.wasPressed('KeyE')) {
          this.carry = { kind: 'toePick', t: 0, from: p.clone() };
          this.hud.setPrompt('');
        } else if (inp.wasPressed('KeyG')) {
          this.foul('Free out', 'The ball can’t be picked off the ground with the hands. Use a toe-pick.');
        }
      } else {
        this.hud.setPrompt('');
      }
    }
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
    this.deadTime = 2.5;
    this.speed = 0;
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
      const foot = this.toWorld(L_FOOT);
      pos = u < 0.4 ? BABYLON.Vector3.Lerp(c.from, foot, u / 0.4) : BABYLON.Vector3.Lerp(foot, hands, (u - 0.4) / 0.6);
    }
    this.ball.hold(pos);
    if (u >= 1) {
      if (c.kind === 'toePick') this.tracker.start('pickup');
      this.carry = { kind: 'hand' };
    }
  }

  private updateCamera(dt: number): void {
    const me = this.player.root.position;
    const k = Math.min(1, dt * 4);
    if (this.broadcastCam) {
      const want = new BABYLON.Vector3(me.x * 0.85, 16, -HW - 18);
      this.camera.position = BABYLON.Vector3.Lerp(this.camera.position, want, k);
      this.camera.setTarget(new BABYLON.Vector3(me.x, 0, me.z * 0.6));
      this.camera.fov = 0.5;
    } else {
      const f = this.forward();
      const want = me.subtract(f.scale(6.5)).add(new BABYLON.Vector3(0, 2.6, 0));
      this.camera.position = BABYLON.Vector3.Lerp(this.camera.position, want, k);
      this.camera.setTarget(me.add(f.scale(8)).add(new BABYLON.Vector3(0, 1.2, 0)));
      this.camera.fov = 0.9;
    }
  }
}
