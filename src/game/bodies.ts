import * as BABYLON from '@babylonjs/core';
import type { PlayerFigure } from '../scene/player';

export type Team = 'ARD' | 'KIL';

/** Shoulder width of a player's body for collisions, in metres. */
const RADIUS = 0.38;
/** Knock-back fades by this factor per second. */
const KNOCK_DECAY = 4;
/** How close (centre to centre) a shoulder charge reaches. */
export const SHOULDER_REACH = 1.6;
/** Opponents within this distance of the ball carrier close them down. */
const PRESS_RANGE = 10;
const PRESS_SPEED = 3.6;
const HOME_SPEED = 2.4;
/** Seconds between one opponent's shoulder charges. */
const AI_CHARGE_COOLDOWN = 2.5;

export interface Body {
  fig: PlayerFigure;
  team: Team;
  keeper: boolean;
  home: BABYLON.Vector3;
  homeYaw: number;
  /** Velocity from being bumped or shouldered; fades away. */
  knock: BABYLON.Vector3;
  /** Seconds left knocked off balance; a stumbling player can't move or charge. */
  stun: number;
  /** Seconds left in a shoulder-charge pose. */
  charging: number;
  cooldown: number;
  phase: number;
}

/** What the crowd needs to know about the player the user controls. */
export interface Controlled {
  fig: PlayerFigure;
  team: Team;
  speed: number;
  hasBall: boolean;
}

/** Something that happened between bodies this frame, for the match to react to (sounds, banners, speed). */
export type Contact = { kind: 'bump' | 'shoulderedBy'; by: Body; push: BABYLON.Vector3 };

/**
 * Everyone on the pitch other than the controlled player, as round bodies that can't pass through each
 * other. Opponents close down the ball carrier and give a shoulder when they get to them; any body can
 * be bumped or shouldered off balance.
 */
export class Crowd {
  readonly bodies: Body[] = [];

  add(fig: PlayerFigure, team: Team, keeper: boolean): void {
    const p = fig.root.position;
    this.bodies.push({
      fig,
      team,
      keeper,
      home: new BABYLON.Vector3(p.x, 0, p.z),
      homeYaw: fig.root.rotation.y,
      knock: BABYLON.Vector3.Zero(),
      stun: 0,
      charging: 0,
      cooldown: AI_CHARGE_COOLDOWN * Math.random(),
      phase: 0,
    });
  }

  /** Everyone back to their starting spot (a new game). */
  reset(): void {
    for (const b of this.bodies) {
      b.fig.root.position.copyFrom(b.home);
      b.fig.root.rotation.y = b.homeYaw;
      b.knock.setAll(0);
      b.stun = 0;
      b.charging = 0;
      b.fig.pose(b.keeper ? 'keeper' : 'stand');
    }
  }

  /**
   * The user takes control of `body`'s player: `outgoing` (the player they were controlling, with their
   * own starting spot) joins the crowd in its place. Returns the player taken over and their spot.
   */
  swapIn(body: Body, outgoing: PlayerFigure, outHome: BABYLON.Vector3, outYaw: number): { fig: PlayerFigure; home: BABYLON.Vector3; homeYaw: number } {
    const taken = { fig: body.fig, home: body.home, homeYaw: body.homeYaw };
    body.fig = outgoing;
    body.home = outHome.clone();
    body.homeYaw = outYaw;
    body.knock.setAll(0);
    body.stun = 0;
    body.charging = 0;
    return taken;
  }

  /** The nearest opponent of `team` within `reach` of `at`, if any. */
  nearestOpponent(at: BABYLON.Vector3, team: Team, reach: number): Body | null {
    let best: Body | null = null;
    let bestD = reach;
    for (const b of this.bodies) {
      if (b.team === team) continue;
      const d = flatDist(b.fig.root.position, at);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** The controlled player shoulders `b`: it is knocked away along `dir` and staggers. */
  shoulder(b: Body, dir: BABYLON.Vector3, strength: number): void {
    b.knock.addInPlace(dir.scale(strength));
    b.stun = Math.max(b.stun, 0.9);
  }

  /**
   * Moves the opponents, then pushes apart any two bodies (the controlled player included) that overlap.
   * Returns the contacts involving the controlled player; `meKnock` collects the push they get.
   */
  update(dt: number, me: Controlled, meKnock: BABYLON.Vector3): Contact[] {
    const contacts: Contact[] = [];
    const mePos = me.fig.root.position;
    for (const b of this.bodies) {
      const root = b.fig.root;
      b.cooldown = Math.max(0, b.cooldown - dt);
      b.charging = Math.max(0, b.charging - dt);
      b.stun = Math.max(0, b.stun - dt);
      root.position.addInPlace(b.knock.scale(dt));
      b.knock.scaleInPlace(Math.exp(-KNOCK_DECAY * dt));

      let moved = 0;
      if (b.stun <= 0 && !b.keeper) {
        // Opponents of the ball carrier close them down; everyone else drifts back to their spot.
        const toMe = mePos.subtract(root.position);
        toMe.y = 0;
        const dMe = toMe.length();
        const press = me.hasBall && b.team !== me.team && dMe < PRESS_RANGE;
        const target = press ? mePos : b.home;
        const to = target.subtract(root.position);
        to.y = 0;
        const d = to.length();
        const stopAt = press ? RADIUS * 2.1 : 0.15;
        if (d > stopAt) {
          const step = Math.min(d - stopAt, (press ? PRESS_SPEED : HOME_SPEED) * dt);
          root.position.addInPlace(to.scale(step / d));
          moved = step / dt;
          turnTo(root, Math.atan2(to.x, to.z), dt * 8);
        } else if (press) {
          turnTo(root, Math.atan2(toMe.x, toMe.z), dt * 8);
        } else {
          turnTo(root, b.homeYaw, dt * 3);
        }
        // Close enough: give the ball carrier a shoulder.
        if (press && dMe < SHOULDER_REACH * 0.85 && b.cooldown <= 0) {
          b.charging = 0.35;
          b.cooldown = AI_CHARGE_COOLDOWN;
          const push = toMe.scale(1 / Math.max(dMe, 1e-3)).scale(2.6);
          meKnock.addInPlace(push);
          contacts.push({ kind: 'shoulderedBy', by: b, push });
        }
      }
      b.phase += ((moved * dt) / 1.5) * Math.PI;
      if (b.stun > 0) b.fig.pose('stumble');
      else if (b.charging > 0) b.fig.pose('shoulder');
      else if (moved > 0.3) b.fig.pose('run', b.phase);
      else b.fig.pose(b.keeper ? 'keeper' : 'stand');
    }

    // Separate overlapping bodies. The controlled player is moved by the match, so they are pushed
    // back by `meKnock`; running into an opponent at speed knocks them back.
    for (let i = 0; i < this.bodies.length; i++) {
      const a = this.bodies[i];
      for (let j = i + 1; j < this.bodies.length; j++) separate(a.fig.root.position, this.bodies[j].fig.root.position, 0.5);
      const pa = a.fig.root.position;
      const dx = pa.x - mePos.x;
      const dz = pa.z - mePos.z;
      const d = Math.hypot(dx, dz);
      if (d < RADIUS * 2 && d > 1e-4) {
        const overlap = RADIUS * 2 - d;
        const n = new BABYLON.Vector3(dx / d, 0, dz / d);
        // The faster body wins the collision.
        const share = me.speed > 4 ? 0.85 : 0.5;
        pa.addInPlace(n.scale(overlap * share));
        mePos.subtractInPlace(n.scale(overlap * (1 - share)));
        if (me.speed > 4 && a.stun <= 0 && a.team !== me.team) {
          a.knock.addInPlace(n.scale(me.speed * 0.45));
          a.stun = 0.5;
          contacts.push({ kind: 'bump', by: a, push: n });
        }
      }
    }
    return contacts;
  }
}

function flatDist(a: BABYLON.Vector3, b: BABYLON.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function turnTo(root: BABYLON.TransformNode, yaw: number, k: number): void {
  let d = yaw - root.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  root.rotation.y += d * Math.min(1, k);
}

/** Pushes two bodies apart if they overlap; `share` is how much of the push `a` takes. */
function separate(a: BABYLON.Vector3, b: BABYLON.Vector3, share: number): void {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const d = Math.hypot(dx, dz);
  if (d >= RADIUS * 2 || d < 1e-4) return;
  const o = RADIUS * 2 - d;
  a.x += (dx / d) * o * share;
  a.z += (dz / d) * o * share;
  b.x -= (dx / d) * o * (1 - share);
  b.z -= (dz / d) * o * (1 - share);
}
