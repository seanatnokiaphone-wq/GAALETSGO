import * as BABYLON from '@babylonjs/core';
import { colour } from './materials';

export interface Kit {
  jersey: string;
  shorts: string;
  socks: string;
  /** Hoop across the chest, or null for a plain jersey. */
  band: string | null;
  numberColour: string;
}

export const KITS = {
  ardmore: { jersey: '#1f7a3a', shorts: '#f4f4f0', socks: '#1f7a3a', band: '#f2c12e', numberColour: '#ffffff' },
  kilcarra: { jersey: '#79b4e3', shorts: '#13294b', socks: '#13294b', band: null, numberColour: '#13294b' },
  ardmoreKeeper: { jersey: '#d8462b', shorts: '#111111', socks: '#d8462b', band: null, numberColour: '#111111' },
  kilcarraKeeper: { jersey: '#f2d43a', shorts: '#111111', socks: '#111111', band: null, numberColour: '#111111' },
} satisfies Record<string, Kit>;

export type PoseName = 'stand' | 'run' | 'carry' | 'kick' | 'handPass' | 'jump' | 'keeper' | 'toePick' | 'solo' | 'shoulder' | 'stumble';

/** What the game needs from a player's body, whichever model draws it. */
export interface Figure {
  readonly root: BABYLON.TransformNode;
  readonly num: number;
  place(x: number, z: number, fx: number, fz: number): void;
  /** `phase` is the run-cycle angle (or a move's progress 0 to 1); `speed` is ground speed in m/s. */
  pose(name: PoseName, phase?: number, speed?: number): void;
}

/** Greybox player: a jointed capsule figure. Stands in until rigged glTF characters arrive. */
export class PlayerFigure implements Figure {
  readonly root: BABYLON.TransformNode;
  private hips: BABYLON.TransformNode;
  private joints: Record<'lThigh' | 'rThigh' | 'lShin' | 'rShin' | 'lArm' | 'rArm' | 'lFore' | 'rFore', BABYLON.TransformNode>;
  /** Point between the hands where a carried ball sits, in the root's local space. */
  static readonly CARRY_OFFSET = new BABYLON.Vector3(0, 1.22, 0.32);

  constructor(scene: BABYLON.Scene, kit: Kit, readonly num: number, shadows: BABYLON.ShadowGenerator, seed = 0) {
    const skins = ['#e8c2a4', '#d9a98a', '#f0cdb2', '#c98f6c', '#e3b597'];
    const hairs = ['#3b2a1e', '#1c1611', '#6b4a2e', '#a0703a', '#2a2420'];
    const skin = colour(scene, skins[seed % skins.length]);
    const hair = colour(scene, hairs[(seed * 3) % hairs.length]);
    const jersey = colour(scene, kit.jersey, 0.12);
    const shorts = colour(scene, kit.shorts);
    const socks = colour(scene, kit.socks);
    const boot = colour(scene, '#111111', 0.3);

    const capsule = (name: string, h: number, r: number, m: BABYLON.Material, parent: BABYLON.Node) => {
      const c = BABYLON.MeshBuilder.CreateCapsule(name, { height: h, radius: r, tessellation: 12, subdivisions: 2 }, scene);
      c.material = m;
      c.parent = parent;
      c.receiveShadows = true;
      shadows.addShadowCaster(c);
      return c;
    };
    const limb = (parent: BABYLON.Node, name: string, len: number, r: number, m: BABYLON.Material, px: number, py: number) => {
      const pivot = new BABYLON.TransformNode(name, scene);
      pivot.parent = parent;
      pivot.position.set(px, py, 0);
      capsule(`${name}Mesh`, len, r, m, pivot).position.y = -len / 2 + r * 0.6;
      return pivot;
    };

    this.root = new BABYLON.TransformNode('player', scene);
    const hips = (this.hips = new BABYLON.TransformNode('hips', scene));
    hips.parent = this.root;
    hips.position.y = 0.96;

    const torso = capsule('torso', 0.62, 0.17, jersey, hips);
    torso.position.y = 0.27;
    torso.scaling.set(1.15, 1, 0.72);
    if (kit.band) {
      const band = capsule('band', 0.2, 0.172, colour(scene, kit.band, 0.12), hips);
      band.position.y = 0.3;
      band.scaling.set(1.16, 1, 0.73);
    }
    const shortsMesh = capsule('shorts', 0.32, 0.165, shorts, hips);
    shortsMesh.position.y = -0.04;
    shortsMesh.scaling.set(1.12, 1, 0.78);
    capsule('neck', 0.14, 0.05, skin, hips).position.y = 0.62;
    const head = BABYLON.MeshBuilder.CreateSphere('head', { diameter: 0.22, segments: 16 }, scene);
    head.parent = hips;
    head.position.y = 0.74;
    head.scaling.set(0.9, 1.08, 1);
    head.material = skin;
    shadows.addShadowCaster(head);
    const cap = BABYLON.MeshBuilder.CreateSphere('hair', { diameter: 0.232, segments: 16, slice: 0.55 }, scene);
    cap.parent = head;
    cap.position.set(0, 0.012, -0.008);
    cap.material = hair;

    const numberPlate = BABYLON.MeshBuilder.CreatePlane('number', { size: 0.2 }, scene);
    numberPlate.parent = hips;
    numberPlate.position.set(0, 0.32, -0.14);
    numberPlate.rotation.y = Math.PI;
    numberPlate.material = numberMaterial(scene, num, kit);

    const lThigh = limb(hips, 'lThigh', 0.44, 0.075, shorts, -0.1, -0.06);
    const rThigh = limb(hips, 'rThigh', 0.44, 0.075, shorts, 0.1, -0.06);
    for (const t of [lThigh, rThigh]) capsule('knee', 0.22, 0.068, skin, t).position.y = -0.32;
    const lShin = limb(lThigh, 'lShin', 0.44, 0.062, socks, 0, -0.42);
    const rShin = limb(rThigh, 'rShin', 0.44, 0.062, socks, 0, -0.42);
    for (const s of [lShin, rShin]) {
      const b = BABYLON.MeshBuilder.CreateBox('boot', { width: 0.1, height: 0.08, depth: 0.26 }, scene);
      b.parent = s;
      b.position.set(0, -0.44, 0.06);
      b.material = boot;
      shadows.addShadowCaster(b);
    }
    const lArm = limb(hips, 'lArm', 0.3, 0.055, jersey, -0.25, 0.52);
    const rArm = limb(hips, 'rArm', 0.3, 0.055, jersey, 0.25, 0.52);
    const lFore = limb(lArm, 'lFore', 0.3, 0.045, skin, 0, -0.29);
    const rFore = limb(rArm, 'rFore', 0.3, 0.045, skin, 0, -0.29);
    this.joints = { lThigh, rThigh, lShin, rShin, lArm, rArm, lFore, rFore };
  }

  /** Places the player at (x, z) facing the point (fx, fz). */
  place(x: number, z: number, fx: number, fz: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = Math.atan2(fx - x, fz - z);
  }

  /**
   * Procedural pose. `phase` is the run-cycle angle in radians (for 'solo', the move's progress 0 to 1). Negative x rotation swings a limb forward. */
  pose(name: PoseName, phase = 0, _speed = 0): void {
    const j = this.joints;
    const set = (k: keyof typeof j, x: number, z = 0) => {
      j[k].rotation.x = x;
      j[k].rotation.z = z;
    };
    const s = Math.sin(phase);
    this.hips.rotation.set(0, 0, 0);
    this.hips.position.y = 0.96;

    switch (name) {
      case 'stand':
        set('lThigh', 0.02); set('rThigh', -0.02); set('lShin', 0.04); set('rShin', 0.04);
        set('lArm', 0.05, -0.12); set('rArm', 0.05, 0.12); set('lFore', -0.25); set('rFore', -0.25);
        break;
      case 'run':
      case 'carry':
        this.hips.rotation.x = 0.16;
        this.hips.position.y = 0.92 + Math.abs(Math.cos(phase)) * 0.04;
        set('lThigh', -0.75 * s); set('rThigh', 0.75 * s);
        set('lShin', 0.35 + 0.55 * Math.max(0, s)); set('rShin', 0.35 + 0.55 * Math.max(0, -s));
        if (name === 'carry') {
          set('lArm', -0.5, -0.25); set('rArm', -0.5, 0.25); set('lFore', -1.25, 0.5); set('rFore', -1.25, -0.5);
        } else {
          set('lArm', 0.6 * s, -0.12); set('rArm', -0.6 * s, 0.12); set('lFore', -1.3); set('rFore', -1.3);
        }
        break;
      case 'kick':
        this.hips.rotation.x = -0.12;
        set('rThigh', -1.45); set('rShin', 0.15); set('lThigh', 0.2); set('lShin', 0.3);
        set('lArm', -0.3, -1.0); set('rArm', 0.5, 0.6); set('lFore', -0.4); set('rFore', -0.6);
        break;
      case 'toePick':
        // Lean over the ball, toe under it, hands down ready to take it.
        this.hips.rotation.x = 0.45;
        this.hips.position.y = 0.9;
        set('rThigh', -0.75); set('rShin', 0.25); set('lThigh', 0.15); set('lShin', 0.45);
        set('lArm', -0.9, -0.15); set('rArm', -0.9, 0.15); set('lFore', -0.3); set('rFore', -0.3);
        break;
      case 'solo': {
        // Drop the ball, swing the right leg up to meet it on the toe, and take it back in the hands.
        const w = Math.sin(Math.PI * BABYLON.Scalar.Clamp((phase - 0.1) / 0.7, 0, 1));
        this.hips.rotation.x = 0.1 - 0.12 * w;
        set('rThigh', -0.95 * w); set('rShin', 0.2 + 0.4 * w); set('lThigh', 0.15 * w); set('lShin', 0.2 + 0.15 * w);
        set('lArm', -0.5 - 0.3 * w, -0.25); set('rArm', -0.5 - 0.3 * w, 0.25);
        set('lFore', -1.25 + 0.6 * w, 0.5); set('rFore', -1.25 + 0.6 * w, -0.5);
        break;
      }
      case 'shoulder':
        // Side-on, low and braced, leading with the left shoulder, arms tucked in.
        this.hips.rotation.set(0.25, 0, -0.32);
        this.hips.position.y = 0.88;
        set('lThigh', -0.35, -0.15); set('rThigh', 0.3, 0.1); set('lShin', 0.5); set('rShin', 0.35);
        set('lArm', -0.2, 0.05); set('rArm', -0.6, 0.3); set('lFore', -1.6); set('rFore', -1.4);
        break;
      case 'stumble':
        // Knocked off balance: leaning back, arms out, one leg stepping back to catch the fall.
        this.hips.rotation.set(-0.3, 0, 0.12);
        this.hips.position.y = 0.9;
        set('lThigh', -0.45); set('rThigh', 0.5); set('lShin', 0.3); set('rShin', 0.6);
        set('lArm', -1.2, -0.9); set('rArm', -1.0, 0.9); set('lFore', -0.3); set('rFore', -0.3);
        break;
      case 'handPass':
        this.hips.rotation.x = 0.1;
        set('lThigh', -0.5); set('rThigh', 0.35); set('lShin', 0.4); set('rShin', 0.5);
        set('lArm', -1.1, -0.2); set('lFore', -0.5); set('rArm', -1.4, 0.1); set('rFore', -0.1);
        break;
      case 'jump':
        this.hips.position.y = 1.5;
        set('lThigh', -0.6); set('lShin', 1.2); set('rThigh', -0.15); set('rShin', 0.6);
        set('lArm', -2.9, -0.15); set('rArm', -2.9, 0.15); set('lFore', -0.15); set('rFore', -0.15);
        break;
      case 'keeper':
        this.hips.rotation.x = 0.3;
        this.hips.position.y = 0.86;
        set('lThigh', -0.35, -0.25); set('rThigh', -0.35, 0.25); set('lShin', 0.6); set('rShin', 0.6);
        set('lArm', -0.7, -0.5); set('rArm', -0.7, 0.5); set('lFore', -0.6); set('rFore', -0.6);
        break;
    }
  }
}

const numberMats = new Map<string, BABYLON.StandardMaterial>();
export function numberMaterial(scene: BABYLON.Scene, num: number, kit: Kit): BABYLON.StandardMaterial {
  const key = `${num}${kit.numberColour}${kit.jersey}`;
  let m = numberMats.get(key);
  if (!m) {
    const t = new BABYLON.DynamicTexture(`num${key}`, { width: 128, height: 128 }, scene, true);
    const c = t.getContext() as unknown as CanvasRenderingContext2D;
    c.fillStyle = kit.jersey;
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = kit.numberColour;
    c.font = 'bold 84px sans-serif';
    c.textAlign = 'center';
    c.fillText(String(num), 64, 98);
    t.update();
    m = new BABYLON.StandardMaterial(`numMat${key}`, scene);
    m.diffuseTexture = t;
    m.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    numberMats.set(key, m);
  }
  return m;
}
