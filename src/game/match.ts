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
  type RuleSetId,
  type ShotMethod,
  type TeamScore,
} from '../rules';
import { PlayerFigure, type PoseName } from '../scene/player';
import { BALL_RADIUS, Ball, predictFlight } from './ball';
import { Hud } from './hud';
import { Input } from './input';

type QueuedAction = { kind: 'solo' } | { kind: 'bounce' } | { kind: 'handPass' } | { kind: 'kick'; lofted: boolean; power: number; curl: number };
const MAX_QUEUED = 3;
/** How far (radians) full curl pushes the kick off the line the player faces. */
const CURL_AIM = 0.12;
/** Sidespin (rad/s) at full curl; with the Magnus force it bends a long kick about 5 m. */
const CURL_SPIN = 30;
/** Points in the flight preview line (a fixed count so the line can be updated in place). */
const AIM_POINTS = 240;

type Carry =
  | { kind: 'none' }
  | { kind: 'hand' }
  | { kind: 'bounce' | 'solo' | 'toePick'; t: number; from: BABYLON.Vector3 };

const STRIDE = 1.5; // metres per foot plant
/**
 * Distance run with the ball in hand that counts as one step. Longer than the animation's stride so a
 * player has time (about 1.8 s at a jog, 1.25 s sprinting) before the fourth step.
 */
const STEP_LENGTH = 2.5;
/** Seconds of running before the camera swings round behind the player. */
const MOVE_CAM_DELAY = 3;
const JOG = 5.5;
const SPRINT = 8;
const MOVE_DURATION = { bounce: 0.42, solo: 0.55, toePick: 0.55 } as const;
/** How close a ball on the ground has to be for E to toe-pick it, in metres. */
const TOE_PICK_REACH = 2.2;

const L_HANDS = PlayerFigure.CARRY_OFFSET;
const L_FOOT = new BABYLON.Vector3(0.1, 0.36, 0.56);
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
  /** Metres run in hand towards the next counted step. */
  private stepDist = 0;
  /**
   * A kick being powered up. With the controller's X (`PadX`) the left stick sets `curl` from -1
   * (bend left) to 1 (bend right) instead of moving the player.
   */
  private charge: { key: 'KeyK' | 'KeyL' | 'PadX'; power: number; curl: number } | null = null;
  /** Where an X kick will fly at the current power and curl, and where it will land. */
  private aimLine: BABYLON.Mesh | null = null;
  private aimLanding: BABYLON.Mesh;
  /**
   * Actions pressed while another is still playing (a solo, a bounce, a toe-pick). Each press is one
   * action, and they play one after another in the order pressed, never two at once.
   */
  private queue: QueuedAction[] = [];
  /** Direction the behind-the-player camera looks. Movement keys are relative to it. */
  private camYaw = 0;
  /** Camera direction captured when the player starts steering; movement stays relative to it. */
  private moveYaw: number | null = null;
  /** The rule set the page started with; a new game goes back to it. */
  private startRules: RuleSetId;
  /** E pressed a moment before reaching the ball still counts, so the pick-up isn't missed at a run. */
  private toePickBuffer = 0;
  /** Where the player steps to stand over the ball during a toe-pick. */
  private pickSpot: BABYLON.Vector3 | null = null;
  /** Camera angle above the horizontal and distance from the player, set by dragging and the wheel. */
  private camPitch = 0.33;
  private camDist = 6.5;
  /** Seconds since the player last moved the camera by hand; the camera won't swing round for a moment after. */
  private sinceLook = 99;
  /** Set by a right-stick pan: once the stick is let go the camera eases back behind the player. */
  private camReturn = false;
  /** Seconds the player has been on the move; after MOVE_CAM_DELAY the camera swings round behind them. */
  private moveTime = 0;
  /** Broadcast camera: slide along the sideline, height and zoom. */
  private bcPan = 0;
  private bcHeight = 16;
  private bcFov = 0.5;
  /** Direction the player is turning to face after a click on the pitch. */
  private faceYaw: number | null = null;
  private clickMarker: BABYLON.Mesh;
  private clickMarkerLife = 0;
  private actionPose: { pose: PoseName; t: number } | null = null;
  private deadTime = 0;
  private sinceRelease = 0;
  private lastStrike: { method: ShotMethod; fromX: number; fromZ: number } = { method: 'kick', fromX: 0, fromZ: 0 };
  private prevBall = new BABYLON.Vector3();
  private broadcastCam = false;
  private marker: BABYLON.Mesh;

  constructor(
    private scene: BABYLON.Scene,
    private camera: BABYLON.UniversalCamera,
    private player: PlayerFigure,
    private ball: Ball,
    private input: Input,
    private hud: Hud,
    private rules: RuleSet,
    private onRulesToggle: () => RuleSet,
  ) {
    this.startRules = rules.id;
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
    this.clickMarker = BABYLON.MeshBuilder.CreateTorus('clickMarker', { diameter: 1.2, thickness: 0.12, tessellation: 32 }, scene);
    const cm = new BABYLON.StandardMaterial('clickMarkerMat', scene);
    cm.emissiveColor = new BABYLON.Color3(1, 1, 1);
    cm.disableLighting = true;
    this.clickMarker.material = cm;
    this.clickMarker.isPickable = false;
    this.clickMarker.setEnabled(false);
    this.aimLanding = BABYLON.MeshBuilder.CreateTorus('aimLanding', { diameter: 1.6, thickness: 0.1, tessellation: 32 }, scene);
    const am = new BABYLON.StandardMaterial('aimLandingMat', scene);
    am.emissiveColor = new BABYLON.Color3(0.95, 0.76, 0.18);
    am.disableLighting = true;
    this.aimLanding.material = am;
    this.aimLanding.isPickable = false;
    this.aimLanding.setEnabled(false);
    hud.setRules(rules);
    hud.setScore(this.home, this.away);
  }

  update(dt: number): void {
    const inp = this.input;
    inp.pollGamepad(dt);
    if (inp.wasPressed('KeyR')) this.switchRules();
    if (inp.wasPressed('F12')) this.newGame();
    if (inp.wasPressed('KeyC')) this.broadcastCam = !this.broadcastCam;
    if (inp.wasPressed('KeyV')) this.resetView();
    this.applyClick();
    this.applyLook(dt);

    if (this.deadTime > 0) {
      this.deadTime -= dt;
      if (this.deadTime <= 0) this.restart();
    } else {
      this.clock += dt;
      this.movePlayer(dt);
      this.handleBall(dt);
      this.updateAim();
    }

    this.poseBallInHand(dt);
    this.updateCamera(dt);
    this.marker.position.set(this.player.root.position.x, 0.03, this.player.root.position.z);
    if (this.clickMarkerLife > 0) {
      this.clickMarkerLife -= dt;
      this.clickMarker.scaling.setAll(1 + (1 - this.clickMarkerLife) * 0.6);
      (this.clickMarker.material as BABYLON.StandardMaterial).alpha = Math.max(0, this.clickMarkerLife);
      if (this.clickMarkerLife <= 0) this.clickMarker.setEnabled(false);
    }
    this.hud.setClock(this.clock);
    const inHand = this.carry.kind === 'hand' || this.carry.kind === 'bounce' || this.carry.kind === 'solo';
    this.hud.setSteps(inHand ? this.tracker.steps : null, this.rules.maxSteps, this.tracker.canBounce());
    this.hud.setPower(this.charge ? this.charge.power : null, this.charge?.key === 'PadX' ? this.charge.curl : null);
    this.updateBallMarker();
    this.hud.update(dt);
    this.prevBall.copyFrom(this.ball.position);
    // Clear this frame's presses, releases, clicks and camera drags so each one acts exactly once.
    inp.endFrame();
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
    // The direction is fixed when the stick or keys are first pushed and held until they're let go, so
    // panning the camera (right stick, mouse) or the camera swinging round never bends the player's run:
    // the player always faces where the left stick points.
    const key = (a: string, b: string) => inp.isDown(a) || inp.isDown(b);
    if (this.charge?.key === 'PadX') return this.aimKick(dt);
    const stickLen = Math.hypot(inp.stick.x, inp.stick.y);
    const steering = stickLen > 0.15 || key('KeyW', 'ArrowUp') || key('KeyS', 'ArrowDown') || key('KeyA', 'ArrowLeft') || key('KeyD', 'ArrowRight');
    if (!steering) this.moveYaw = null;
    else if (this.moveYaw === null) this.moveYaw = this.broadcastCam ? 0 : this.camYaw;
    const yaw = this.moveYaw ?? (this.broadcastCam ? 0 : this.camYaw);
    const f = new BABYLON.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const r = new BABYLON.Vector3(f.z, 0, -f.x);
    const want = BABYLON.Vector3.Zero();
    if (key('KeyW', 'ArrowUp')) want.addInPlace(f);
    if (key('KeyS', 'ArrowDown')) want.subtractInPlace(f);
    if (key('KeyD', 'ArrowRight')) want.addInPlace(r);
    if (key('KeyA', 'ArrowLeft')) want.subtractInPlace(r);

    if (stickLen > 0.15) want.addInPlace(f.scale(inp.stick.y)).addInPlace(r.scale(inp.stick.x));

    const moving = want.lengthSquared() > 0;
    const sprint = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight') || (inp.stickSprints && stickLen > 0.92);
    const target = moving ? (sprint ? SPRINT : stickLen > 0.15 ? Math.max(2, JOG * Math.min(1, stickLen * 1.3)) : JOG) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 6);
    const root = this.player.root;
    if (moving) this.faceYaw = null;
    if (this.faceYaw !== null) {
      let d = this.faceYaw - root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      root.rotation.y += d * Math.min(1, dt * 12);
      let c = this.faceYaw - this.camYaw;
      c = Math.atan2(Math.sin(c), Math.cos(c));
      this.camYaw += c * Math.min(1, dt * 6);
      if (Math.abs(d) < 0.01 && Math.abs(c) < 0.01) this.faceYaw = null;
    }
    if (moving) {
      want.normalize();
      const goal = Math.atan2(want.x, want.z);
      let diff = goal - root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      root.rotation.y += diff * Math.min(1, dt * 14);
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

    this.stepAndPose(dt);
  }

  /**
   * While X is held for a kick the player keeps running the way they face (the stick pushed any way
   * keeps them going, RB sprints) without turning, and the stick's left/right sets the curl.
   */
  private aimKick(dt: number): void {
    const inp = this.input;
    const c = this.charge!;
    this.moveYaw = null;
    this.faceYaw = null;
    const want = Math.abs(inp.stick.x) > 0.15 ? BABYLON.Scalar.Clamp(inp.stick.x, -1, 1) : 0;
    c.curl += (want - c.curl) * Math.min(1, dt * 8);
    const stickLen = Math.hypot(inp.stick.x, inp.stick.y);
    const keys = ['KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight'].some((k) => inp.isDown(k));
    const sprint = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');
    const target = stickLen > 0.15 || keys ? (sprint ? SPRINT : stickLen > 0.15 ? Math.max(2, JOG * Math.min(1, stickLen * 1.3)) : JOG) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 6);
    const root = this.player.root;
    root.position.addInPlace(this.forward().scale(this.speed * dt));
    root.position.x = BABYLON.Scalar.Clamp(root.position.x, -HL - 3, HL + 3);
    root.position.z = BABYLON.Scalar.Clamp(root.position.z, -HW - 3, HW + 3);
    this.stepAndPose(dt);
  }

  private stepAndPose(dt: number): void {
    // Keep running for a few seconds and the camera settles back behind the player (not while it's being moved by hand).
    this.moveTime = this.speed > 0.5 ? this.moveTime + dt : 0;
    if (this.moveTime > MOVE_CAM_DELAY && !this.broadcastCam && !this.input.rightStickHeld && this.sinceLook > 0.5) this.camReturn = true;
    // The run cycle animates the legs; steps are counted by distance below.
    this.phase += ((this.speed * dt) / STRIDE) * Math.PI;
    if (this.carry.kind === 'hand') {
      this.stepDist += this.speed * dt;
      while (this.stepDist >= STEP_LENGTH) {
        this.stepDist -= STEP_LENGTH;
        const res = this.tracker.step();
        if (!res.ok) return this.foul('Overcarrying', `${this.tracker.steps} steps without a bounce or solo`);
      }
    } else {
      this.stepDist = 0;
    }

    if (this.actionPose) {
      this.actionPose.t -= dt;
      this.player.pose(this.actionPose.pose);
      if (this.actionPose.t <= 0) this.actionPose = null;
    } else if (this.carry.kind === 'toePick') {
      this.player.pose('toePick');
    } else if (this.carry.kind === 'solo') {
      // The ball drops onto the right toe and is kicked back up to the hands.
      this.player.pose('solo', Math.min(1, this.carry.t / MOVE_DURATION.solo));
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
    // A kick still charging when the ball goes (a queued hand-pass) is dropped.
    if (!holding) this.charge = null;
    if (holding) {
      const add = (a: QueuedAction) => {
        if (this.queue.length < MAX_QUEUED) this.queue.push(a);
      };
      if (inp.wasPressed('KeyO')) add({ kind: 'solo' });
      if (inp.wasPressed('KeyB')) add({ kind: 'bounce' });
      if (inp.wasPressed('KeyJ')) add({ kind: 'handPass' });
      // Kicks power up while the key is held and join the queue when it is let go.
      // The controller's X kicks when the ball is in hand (and toe-picks when it's on the ground).
      if (!this.charge) {
        const key = (['KeyK', 'KeyL', 'PadX'] as const).find((k) => inp.wasPressed(k));
        if (key) this.charge = { key, power: 0, curl: 0 };
      }
      if (this.charge) {
        this.charge.power = Math.min(1, this.charge.power + dt * 1.1);
        if (inp.wasReleased(this.charge.key)) {
          add({ kind: 'kick', lofted: this.charge.key !== 'KeyL', power: this.charge.power, curl: this.charge.curl });
          this.charge = null;
        }
      }
    }

    if (c.kind === 'hand') {
      // One action per frame, and only once the previous move has finished.
      const next = this.queue.shift();
      if (next?.kind === 'kick') {
        // A tap is a short chip; a full hold reaches about 60 m.
        this.release('kick', 8 + 24 * next.power, next.lofted ? 0.5 : 0.12, next.curl);
      } else if (next?.kind === 'handPass') {
        this.release('handPass', 13, 0.22);
      } else if (next?.kind === 'bounce') {
        const res = this.tracker.bounce();
        if (!res.ok) return this.foul('Double bounce', 'You can’t bounce twice in a row. Solo in between.');
        this.carry = { kind: 'bounce', t: 0, from: this.ball.position.clone() };
      } else if (next?.kind === 'solo') {
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
      this.toePickBuffer = inp.wasPressed('KeyE') || inp.wasPressed('PadX') ? 0.5 : Math.max(0, this.toePickBuffer - dt);
      if (onGround && flat < TOE_PICK_REACH && speed < 9 && this.toePickBuffer > 0) {
        this.startToePick(p);
        return;
      }
      if (onGround && flat < TOE_PICK_REACH && inp.wasPressed('KeyG')) {
        this.foul('Free out', 'The ball can’t be picked off the ground with the hands. Use a toe-pick.');
        return;
      }
      this.hud.setPrompt(onGround && flat < 6 ? `${inp.usingPad ? 'X' : 'E'}  toe-pick the ball into your hands` : '');
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

  /**
   * Where the ball leaves the player and how. `loft` is the launch angle in radians; `curl` from -1 to 1
   * starts the ball a little to that side and spins it so it keeps bending that way.
   */
  private launchState(method: ShotMethod, speed: number, loft: number, curl = 0) {
    const f = this.forward();
    const yaw = this.player.root.rotation.y + curl * CURL_AIM;
    const aim = new BABYLON.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const from = method === 'kick' ? this.toWorld(new BABYLON.Vector3(0, 0.45, 0.6)) : this.toWorld(L_HANDS);
    const v = aim.scale(speed * Math.cos(loft)).add(new BABYLON.Vector3(0, speed * Math.sin(loft), 0)).add(f.scale(this.speed * 0.4));
    // Backspin on a kick, about the axis across the ball's flight, plus sidespin for curl
    // (spin about +y bends the ball to the right).
    const spin = BABYLON.Vector3.Cross(aim, BABYLON.Vector3.Up()).scale(method === 'kick' ? 6 : 1);
    spin.y += curl * CURL_SPIN;
    return { from, v, spin };
  }

  /** Kick or hand-pass the ball. */
  private release(method: ShotMethod, speed: number, loft: number, curl = 0): void {
    const { from, v, spin } = this.launchState(method, speed, loft, curl);
    this.ball.hold(from);
    this.ball.launch(v, spin);
    this.carry = { kind: 'none' };
    // The ball has gone: anything still queued no longer applies.
    this.queue = [];
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

  /**
   * Points out the ball whenever it isn't in the player's hands: a marker over it on screen, or an
   * arrow at the screen edge pointing towards it, with the distance.
   */
  private updateBallMarker(): void {
    const c = this.carry.kind;
    if (c === 'hand' || c === 'solo' || c === 'bounce') return this.hud.setBallMarker(null);
    const canvas = this.scene.getEngine().getRenderingCanvas()!;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pos = this.ball.position;
    const p = BABYLON.Vector3.Project(pos, BABYLON.Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(w, h));
    const view = BABYLON.Vector3.TransformCoordinates(pos, this.camera.getViewMatrix());
    const me = this.player.root.position;
    const dist = Math.hypot(pos.x - me.x, pos.z - me.z);
    const pad = 36;
    if (view.z > 0 && p.x > pad && p.x < w - pad && p.y > pad && p.y < h - pad) {
      return this.hud.setBallMarker({ x: p.x, y: p.y, edge: false, angle: 0, dist });
    }
    // Off screen: point from the screen centre the way the ball lies from the camera (right, left, up,
    // or down for behind), and pin the arrow where that line meets the screen edge.
    const cx = w / 2;
    const cy = h / 2;
    let dx = view.x;
    let dy = -view.y;
    if (Math.hypot(dx, dy) < 1e-3) dy = 1;
    // Leave room under a bottom-edge arrow for its distance label.
    const room = dy > 0 ? cy - pad - 20 : cy - pad;
    const scale = Math.min((cx - pad) / Math.max(1e-3, Math.abs(dx)), room / Math.max(1e-3, Math.abs(dy)));
    dx *= scale;
    dy *= scale;
    this.hud.setBallMarker({ x: cx + dx, y: cy + dy, edge: true, angle: Math.atan2(dy, dx), dist });
  }

  /** Draws the flight of an X kick at its current power and curl while it charges. */
  private updateAim(): void {
    const c = this.charge;
    if (!c || c.key !== 'PadX' || this.deadTime > 0) {
      this.aimLine?.setEnabled(false);
      this.aimLanding.setEnabled(false);
      return;
    }
    const { from, v, spin } = this.launchState('kick', 8 + 24 * c.power, 0.5, c.curl);
    const path = predictFlight(from, v, spin, AIM_POINTS / 60);
    const landing = path[path.length - 1];
    const points = Array.from({ length: AIM_POINTS }, (_, i) => path[Math.min(i, path.length - 1)]);
    // A thin tube rather than a line, so it stays visible at a distance and on high-DPI screens.
    if (!this.aimLine) {
      this.aimLine = BABYLON.MeshBuilder.CreateTube('aimLine', { path: points, radius: 0.05, tessellation: 6, updatable: true }, this.scene);
      const m = new BABYLON.StandardMaterial('aimLineMat', this.scene);
      m.emissiveColor = new BABYLON.Color3(0.95, 0.76, 0.18);
      m.disableLighting = true;
      m.alpha = 0.75;
      this.aimLine.material = m;
      this.aimLine.isPickable = false;
    } else {
      BABYLON.MeshBuilder.CreateTube('aimLine', { path: points, radius: 0.05, instance: this.aimLine });
    }
    this.aimLine.setEnabled(true);
    this.aimLanding.position.set(landing.x, 0.04, landing.z);
    this.aimLanding.setEnabled(true);
  }

  private foul(title: string, detail: string): void {
    this.hud.banner(title.toUpperCase(), detail, 2.5);
    this.hud.setPrompt('');
    this.charge = null;
    this.queue = [];
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

  private switchRules(): void {
    this.rules = this.onRulesToggle();
    this.tracker.setRules(this.rules);
    this.hud.setRules(this.rules);
    this.hud.banner(this.rules.name.toUpperCase(), this.rules.twoPointArcRadius ? 'Two-point arc, kick-outs past the 40 m arc, 3 up and 4 back' : 'Goals 3, points 1, no arc', 2);
  }

  /** Back to kick-off: scores and clock to zero, player at the start spot with the ball. Keeps the rule set. */
  /** Back to kick-off as the page first loaded: scores, clock, rules, cameras, player and ball. */
  private newGame(): void {
    if (this.rules.id !== this.startRules) this.switchRules();
    this.home = emptyScore();
    this.away = emptyScore();
    this.clock = 0;
    this.deadTime = 0;
    this.speed = 0;
    this.phase = 0;
    this.stepDist = 0;
    this.charge = null;
    this.queue = [];
    this.toePickBuffer = 0;
    this.pickSpot = null;
    this.actionPose = null;
    this.faceYaw = null;
    this.sinceRelease = 0;
    this.sinceLook = 99;
    this.camReturn = false;
    this.moveTime = 0;
    this.broadcastCam = false;
    this.moveYaw = null;
    this.lastStrike = { method: 'kick', fromX: 0, fromZ: 0 };
    this.clickMarkerLife = 0;
    this.clickMarker.setEnabled(false);
    this.hud.setPrompt('');
    this.player.place(35, -4, HL, 0);
    this.player.pose('stand');
    this.restart();
    this.resetView();
    this.camera.position.copyFrom(this.player.root.position.add(new BABYLON.Vector3(-6.2, 2.7, 0)));
    this.prevBall.copyFrom(this.ball.position);
    this.hud.setScore(this.home, this.away);
    this.hud.banner('NEW GAME', 'Scores reset', 1.5);
  }

  /** A click or tap on the pitch turns the player to face that spot, and the camera swings round behind. */
  private applyClick(): void {
    const click = this.input.click;
    if (!click) return;
    const hit = this.scene.pick(click.x, click.y, (m) => m.name === 'ground');
    if (!hit?.hit || !hit.pickedPoint) return;
    const me = this.player.root.position;
    const dx = hit.pickedPoint.x - me.x;
    const dz = hit.pickedPoint.z - me.z;
    if (dx * dx + dz * dz < 0.25) return;
    this.faceYaw = Math.atan2(dx, dz);
    this.clickMarker.position.set(hit.pickedPoint.x, 0.06, hit.pickedPoint.z);
    this.clickMarker.setEnabled(true);
    this.clickMarkerLife = 1;
  }

  private applyLook(dt: number): void {
    const { dx, dy, zoom } = this.input.look;
    this.sinceLook += dt;
    if (this.input.rightStickHeld) this.camReturn = !this.broadcastCam;
    else if (this.camReturn) this.returnCamera(dt);
    if (dx === 0 && dy === 0 && zoom === 0) return;
    this.sinceLook = 0;
    // A mouse or touch drag stays where it's put.
    if (!this.input.rightStickHeld) this.camReturn = false;
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

  /** Swing the camera back to its usual spot behind the player (after a right-stick pan, or a few seconds of running). */
  private returnCamera(dt: number): void {
    let d = this.player.root.rotation.y - this.camYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const k = Math.min(1, dt * 5);
    this.camYaw += d * k;
    this.camPitch += (0.33 - this.camPitch) * k;
    if (Math.abs(d) < 0.01 && Math.abs(this.camPitch - 0.33) < 0.01) this.camReturn = false;
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
