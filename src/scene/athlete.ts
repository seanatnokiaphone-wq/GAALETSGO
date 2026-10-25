import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { type Figure, type Kit, type PoseName } from './player';

/**
 * Rigged, animated players from Sean's own player model (public/models/player.glb, cut from his
 * solo1.fbx). Standing, the run with the ball, the solo and the kick are his animations; the other
 * GAA moves (hand-pass, toe-pick, shoulder, keeper) and the arm swing off the ball bend joints on
 * top of them.
 */

type Side = 'L' | 'R';
type Joint = 'spine' | 'chest' | `upper_arm.${Side}` | `forearm.${Side}` | `thigh.${Side}` | `shin.${Side}`;
/** Parents before children, so each bend starts from its parent's final position. */
const JOINT_ORDER: Joint[] = ['spine', 'chest', 'upper_arm.L', 'upper_arm.R', 'forearm.L', 'forearm.R', 'thigh.L', 'thigh.R', 'shin.L', 'shin.R'];
/** One-off moves played from the model's own clips, scrubbed by the move's progress. */
type Clip = 'solo' | 'kick';
/** Ground speed (m/s) the run clip was animated at. */
const RUN_CLIP_SPEED = 2.8;
/** Where the number sits from the chest bone: up, and back to the jersey's surface. */
const NUMBER_RISE = -0.1;
const NUMBER_BACK = 0.165;

// Directions in the player's own space: x to their right, y up, z forward.
const UP = new BABYLON.Vector3(0, 1, 0);
const DOWN = new BABYLON.Vector3(0, -1, 0);
const FWD = new BABYLON.Vector3(0, 0, 1);
const BACK = new BABYLON.Vector3(0, 0, -1);
const RIGHT = new BABYLON.Vector3(1, 0, 0);
const LEFT = new BABYLON.Vector3(-1, 0, 0);

/** A rotation axis (player space) that swings a limb pointing `from` towards `to` for a positive angle. */
function swingAxis(from: BABYLON.Vector3, to: BABYLON.Vector3): BABYLON.Vector3 {
  const axis = BABYLON.Vector3.Cross(from, to).normalize();
  const moved = BABYLON.Vector3.TransformNormal(from, BABYLON.Matrix.RotationAxis(axis, 0.3));
  return BABYLON.Vector3.Dot(moved, to) > 0 ? axis : axis.negate();
}
const AXES = {
  flex: swingAxis(DOWN, FWD), // hip or shoulder forward, elbow bend
  knee: swingAxis(DOWN, BACK),
  outL: swingAxis(DOWN, LEFT), // left limb out to the side
  outR: swingAxis(DOWN, RIGHT),
  lean: swingAxis(UP, FWD), // trunk forward
  side: swingAxis(UP, RIGHT), // trunk tilts to the right
  twist: swingAxis(FWD, RIGHT), // trunk turns to the right
};
type Bend = [Joint, keyof typeof AXES, number];

/**
 * Kit colours for the model's materials: the green and red of the original kit become the jersey
 * and its hoop, split from the socks and their stripe by height. Skin and boots keep their colour.
 */
function regionColour(material: string, y: number, kit: Kit, original: BABYLON.Color3): string | BABYLON.Color3 {
  const legs = y < 0.6;
  if (material === 'MayoGreen') return legs ? kit.socks : kit.jersey;
  if (material === 'MayoRed') return kit.band ?? (legs ? kit.shorts : kit.jersey);
  if (material === 'Shorts') return kit.shorts;
  return original;
}

interface KitTemplate {
  container: BABYLON.AssetContainer;
}

/** Loads the model once per kit (each kit needs its own vertex colours) and makes players from it. */
export class AthleteLibrary {
  private templates = new Map<Kit, KitTemplate>();
  /** Turn that makes the model face +z, the game's forward. */
  private faceFix = 0;
  private count = 0;

  private constructor(
    private scene: BABYLON.Scene,
    private shadows: BABYLON.ShadowGenerator,
    private data: Uint8Array,
  ) {}

  static async load(scene: BABYLON.Scene, shadows: BABYLON.ShadowGenerator, url: string, kits: Kit[]): Promise<AthleteLibrary> {
    let res = await fetch(url);
    // Hosts that won't serve binary files get the model as a base64 data: URL in a .txt file.
    if (res.ok && url.endsWith('.txt')) res = await fetch((await res.text()).trim());
    if (!res.ok) throw new Error(`Couldn't load ${url}: ${res.status}`);
    const lib = new AthleteLibrary(scene, shadows, new Uint8Array(await res.arrayBuffer()));
    for (const kit of kits) await lib.template(kit);
    return lib;
  }

  private async template(kit: Kit): Promise<KitTemplate> {
    let t = this.templates.get(kit);
    if (t) return t;
    const container = await BABYLON.LoadAssetContainerAsync(this.data, this.scene, { pluginExtension: '.glb' });
    const mat = new BABYLON.PBRMaterial(`kit${kit.jersey}`, this.scene);
    mat.albedoColor = BABYLON.Color3.White();
    mat.metallic = 0;
    mat.roughness = 0.82;
    for (const mesh of container.meshes) {
      if (!(mesh instanceof BABYLON.Mesh) || !mesh.skeleton) continue;
      this.paint(mesh, kit);
      mesh.material = mat;
    }
    t = { container };
    this.templates.set(kit, t);
    if (this.templates.size === 1) this.faceFix = this.measureFacing(container);
    return t;
  }

  /** Colours every vertex for the kit from the material it had and how high it sits. */
  private paint(mesh: BABYLON.Mesh, kit: Kit): void {
    const material = mesh.material as BABYLON.PBRMaterial | null;
    const original = material?.albedoColor ?? BABYLON.Color3.Gray();
    const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind)!;
    mesh.computeWorldMatrix(true);
    const world = mesh.getWorldMatrix();
    const colours = new Float32Array((pos.length / 3) * 4);
    const p = new BABYLON.Vector3();
    for (let v = 0; v < pos.length / 3; v++) {
      BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], world, p);
      const c = regionColour(material?.name ?? '', p.y, kit, original);
      // The model's colours are already linear; kit colours are written in sRGB.
      const lin = typeof c === 'string' ? BABYLON.Color3.FromHexString(c).toLinearSpace() : c;
      colours.set([lin.r, lin.g, lin.b, 1], v * 4);
    }
    mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, colours);
    mesh.useVertexColors = true;
  }

  /** Which way the model faces, from heel to toe. */
  private measureFacing(container: BABYLON.AssetContainer): number {
    const nodes = container.transformNodes;
    const foot = nodes.find((n) => n.name === 'foot.L');
    const toe = nodes.find((n) => n.name === 'foot.L_end');
    if (!foot || !toe) return 0;
    const chain = (n: BABYLON.Node | null): void => {
      if (!n) return;
      chain(n.parent);
      (n as BABYLON.TransformNode).computeWorldMatrix?.(true);
    };
    chain(toe);
    const d = toe.getAbsolutePosition().subtract(foot.getAbsolutePosition());
    return -Math.atan2(d.x, d.z);
  }

  create(kit: Kit, num: number, seed = 0): Athlete {
    const t = this.templates.get(kit);
    if (!t) throw new Error('Kit not loaded');
    const id = this.count++;
    const inst = t.container.instantiateModelsToScene((n) => `${n}#${id}`, false, { doNotInstantiate: true });
    return new Athlete(this.scene, this.shadows, inst, this.faceFix, kit, num, seed);
  }
}

/** One player on a rigged model. */
export class Athlete implements Figure {
  readonly root: BABYLON.TransformNode;
  private joints = new Map<Joint, BABYLON.TransformNode>();
  private hips?: BABYLON.TransformNode;
  private idle?: BABYLON.AnimationGroup;
  /** Standing with the ball held in both hands. */
  private hold?: BABYLON.AnimationGroup;
  private run?: BABYLON.AnimationGroup;
  private clips = new Map<Clip, BABYLON.AnimationGroup>();
  private speed = 0;
  private bends: Bend[] = [];
  /** Off the ball the arms swing with the legs instead of holding the ball as in the run clip. */
  private swingArms = false;

  constructor(
    scene: BABYLON.Scene,
    shadows: BABYLON.ShadowGenerator,
    inst: BABYLON.InstantiatedEntries,
    faceFix: number,
    kit: Kit,
    readonly num: number,
    seed: number,
  ) {
    this.root = new BABYLON.TransformNode(`athlete${num}`, scene);
    const turn = new BABYLON.TransformNode('athleteTurn', scene);
    turn.parent = this.root;
    turn.rotation.y = faceFix;
    // The model comes out of the FBX conversion mirrored (its .R leg is on the left); flip it back so
    // the right-footed solo and kick are right-footed in the game.
    turn.scaling.x = -1;
    for (const n of inst.rootNodes) n.parent = turn;
    for (const n of turn.getDescendants(false)) {
      const base = n.name.split('#')[0];
      if (JOINT_ORDER.includes(base as Joint)) this.joints.set(base as Joint, n as BABYLON.TransformNode);
      if (base === 'hips') this.hips = n as BABYLON.TransformNode;
      if (n instanceof BABYLON.Mesh) {
        shadows.addShadowCaster(n);
        n.receiveShadows = true;
        // The bind-pose bounds don't follow the animation, so culling would make players vanish.
        n.alwaysSelectAsActiveMesh = true;
      }
    }
    const group = (name: string) => inst.animationGroups.find((g) => g.name.split('#')[0].toLowerCase() === name);
    for (const g of inst.animationGroups) g.stop();
    this.idle = group('idle');
    this.hold = group('hold');
    this.run = group('run');
    for (const g of [this.idle, this.hold, this.run]) {
      if (!g) continue;
      g.start(true);
      g.weight = 0;
      // Players don't move in step with each other.
      g.goToFrame(g.from + ((seed * 7.3) % 1) * (g.to - g.from));
    }
    if (this.idle) this.idle.weight = 1;
    for (const name of ['solo', 'kick'] as const) {
      const g = group(name);
      if (!g) continue;
      // Held still and scrubbed to the move's progress each frame.
      g.start(true, 0);
      g.weight = 0;
      this.clips.set(name, g);
    }
    this.addNumber(scene, kit);
  }

  /** The number on the back of the jersey, riding on the chest bone. */
  private addNumber(scene: BABYLON.Scene, kit: Kit): void {
    const chest = this.joints.get('chest');
    if (!chest) return;
    this.root.computeWorldMatrix(true);
    for (const n of [...ancestors(chest), chest]) n.computeWorldMatrix(true);
    const plate = BABYLON.MeshBuilder.CreatePlane('number', { size: 0.22 }, scene);
    plate.material = numberDecal(scene, this.num, kit);
    plate.isPickable = false;
    const at = chest.getAbsolutePosition();
    // A plane faces -z, so unturned it reads correctly from behind the player.
    plate.position.set(at.x, at.y + NUMBER_RISE, at.z - NUMBER_BACK);
    plate.setParent(chest);
  }

  place(x: number, z: number, fx: number, fz: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = Math.atan2(fx - x, fz - z);
  }

  pose(name: PoseName, phase = 0, speed?: number): void {
    if (speed !== undefined) this.speed = speed;
    if (name === 'stand' || name === 'keeper') this.speed = 0;
    const clip: Clip | null = name === 'solo' || name === 'kick' ? name : null;
    this.locomote(clip ? 0 : 1, name === 'carry');
    for (const [n, g] of this.clips) {
      g.weight = n === clip ? 1 : 0;
      if (n === clip) g.goToFrame(g.from + BABYLON.Scalar.Clamp(phase, 0, 1) * (g.to - g.from));
    }
    this.swingArms = !clip && name !== 'carry';
    this.bends = clip ? [] : bendsFor(name);
    this.applyBends();
  }

  /** Blend standing and running by ground speed, and match the stride to it. */
  private locomote(share: number, holding: boolean): void {
    const s = this.speed;
    const run = BABYLON.Scalar.Clamp(s / 2, 0, 1);
    const still = holding && this.hold ? this.hold : this.idle;
    for (const g of [this.idle, this.hold]) if (g) g.weight = g === still ? (1 - run) * share : 0;
    if (this.run) {
      this.run.weight = run * share;
      this.run.speedRatio = BABYLON.Scalar.Clamp(s / RUN_CLIP_SPEED, 0.5, 2.3);
    }
  }

  /** Arms swing against the legs: each arm goes back as the knee on its side comes forward. */
  private armSwing(): Bend[] {
    const hips = this.hips;
    if (!hips) return [];
    const fwd = new BABYLON.Vector3(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
    const reach = (side: Side) => {
      const knee = this.joints.get(`shin.${side}`);
      return knee ? BABYLON.Vector3.Dot(knee.getAbsolutePosition().subtract(hips.getAbsolutePosition()), fwd) : 0;
    };
    const run = this.run?.weight ?? 0;
    const still = this.idle?.weight ?? 0;
    const bends: Bend[] = [];
    for (const side of ['L', 'R'] as const) {
      // Undo the run clip's ball-carrying arms, then swing; standing, bring the arms in to the sides.
      bends.push([`upper_arm.${side}`, 'flex', -0.55 * run - 2.2 * reach(side)]);
      bends.push([`upper_arm.${side}`, side === 'L' ? 'outL' : 'outR', -0.35 * still]);
      bends.push([`forearm.${side}`, 'flex', -0.35 * run]);
    }
    return bends;
  }

  /**
   * Bends joints on top of this frame's animation. Each bend turns a joint about an axis in the
   * player's own space (forward, right, up), worked out in world space so it doesn't matter how the
   * model's bones happen to be oriented.
   */
  private applyBends(): void {
    if (this.bends.length === 0 && !this.swingArms) return;
    const yaw = BABYLON.Matrix.RotationY(this.root.rotation.y);
    const world = new BABYLON.Matrix();
    const local = new BABYLON.Matrix();
    const inv = new BABYLON.Matrix();
    const scale = new BABYLON.Vector3();
    const rot = new BABYLON.Quaternion();
    const pos = new BABYLON.Vector3();
    const anyJoint = this.joints.get('spine');
    if (anyJoint) for (const n of [...ancestors(anyJoint), anyJoint]) n.computeWorldMatrix(true);
    for (const j of JOINT_ORDER) this.joints.get(j)?.computeWorldMatrix(true);
    const bends = this.swingArms ? [...this.bends, ...this.armSwing()] : this.bends;
    for (const joint of JOINT_ORDER) {
      const own = bends.filter((b) => b[0] === joint);
      if (own.length === 0) continue;
      const node = this.joints.get(joint);
      if (!node || !node.parent) continue;
      const parent = node.parent as BABYLON.TransformNode;
      parent.computeWorldMatrix(true);
      node.computeWorldMatrix(true);
      world.copyFrom(node.getWorldMatrix());
      const pivot = world.getTranslation();
      for (const [, axisName, angle] of own) {
        const axis = BABYLON.Vector3.TransformNormal(AXES[axisName], yaw);
        const r = BABYLON.Matrix.Translation(-pivot.x, -pivot.y, -pivot.z)
          .multiply(BABYLON.Matrix.RotationAxis(axis, angle))
          .multiply(BABYLON.Matrix.Translation(pivot.x, pivot.y, pivot.z));
        world.copyFrom(world.multiply(r));
      }
      parent.getWorldMatrix().invertToRef(inv);
      world.multiplyToRef(inv, local);
      local.decompose(scale, rot, pos);
      node.rotationQuaternion = rot.clone();
      node.computeWorldMatrix(true);
    }
    // Children of bent joints pick up the change when the skeleton is drawn.
  }
}

/** Just the digits, on a see-through background, so the jersey shows around them. */
const decals = new Map<string, BABYLON.StandardMaterial>();
function numberDecal(scene: BABYLON.Scene, num: number, kit: Kit): BABYLON.StandardMaterial {
  const key = `${num}${kit.numberColour}`;
  let m = decals.get(key);
  if (!m) {
    const t = new BABYLON.DynamicTexture(`decal${key}`, { width: 128, height: 128 }, scene, true);
    t.hasAlpha = true;
    const c = t.getContext() as unknown as CanvasRenderingContext2D;
    c.clearRect(0, 0, 128, 128);
    c.fillStyle = kit.numberColour;
    c.font = 'bold 92px sans-serif';
    c.textAlign = 'center';
    c.fillText(String(num), 64, 100);
    t.update();
    m = new BABYLON.StandardMaterial(`decalMat${key}`, scene);
    m.diffuseTexture = t;
    m.useAlphaFromDiffuseTexture = true;
    m.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    decals.set(key, m);
  }
  return m;
}

function ancestors(n: BABYLON.Node): BABYLON.TransformNode[] {
  const out: BABYLON.TransformNode[] = [];
  for (let p = n.parent; p; p = p.parent) out.unshift(p as BABYLON.TransformNode);
  return out;
}

/** Joint bends for each move, on top of the stand/walk/run animation. */
function bendsFor(name: PoseName): Bend[] {
  switch (name) {
    case 'handPass':
      return [['upper_arm.R', 'flex', 1.5], ['forearm.R', 'flex', 0.15], ['upper_arm.L', 'flex', 0.9], ['forearm.L', 'flex', 1.1], ['chest', 'twist', -0.3]];
    case 'toePick':
      return [['spine', 'lean', 0.45], ['thigh.R', 'flex', 0.55], ['shin.R', 'knee', 0.25], ['upper_arm.L', 'flex', 0.55], ['upper_arm.R', 'flex', 0.55]];
    case 'shoulder':
      return [['spine', 'lean', 0.2], ['chest', 'side', -0.35], ['chest', 'twist', 0.45], ['forearm.L', 'flex', 1.6], ['forearm.R', 'flex', 1.4], ['upper_arm.L', 'outL', 0.15]];
    case 'stumble':
      return [['spine', 'lean', -0.35], ['upper_arm.L', 'outL', 1.2], ['upper_arm.R', 'outR', 1.1], ['thigh.R', 'flex', -0.4]];
    case 'jump':
      return [['upper_arm.L', 'flex', 2.8], ['upper_arm.R', 'flex', 2.8], ['thigh.L', 'flex', 0.5], ['shin.L', 'knee', 1.0]];
    case 'keeper':
      return [
        ['thigh.L', 'flex', 0.45], ['thigh.R', 'flex', 0.45], ['shin.L', 'knee', 0.8], ['shin.R', 'knee', 0.8],
        ['spine', 'lean', 0.35], ['upper_arm.L', 'flex', 0.7], ['upper_arm.R', 'flex', 0.7], ['upper_arm.L', 'outL', 0.5], ['upper_arm.R', 'outR', 0.5],
      ];
    default:
      return [];
  }
}
