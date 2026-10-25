import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { type Figure, type Kit, type PoseName } from './player';

/**
 * Rigged, animated players built from a Mixamo-skeleton glTF (X Bot from the Babylon.js assets,
 * CC BY 4.0). Running, walking and standing come from the model's motion-captured clips; the GAA
 * moves (carrying, solo, kick, hand-pass, toe-pick, shoulder) bend joints on top of them.
 */

const BONE = 'mixamorig:';
type Side = 'Left' | 'Right';
type Joint = 'Spine' | 'Spine1' | `${Side}Arm` | `${Side}ForeArm` | `${Side}UpLeg` | `${Side}Leg`;
/** Parents before children, so each bend starts from its parent's final position. */
const JOINT_ORDER: Joint[] = ['Spine', 'Spine1', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'];

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

/** Kit colours by body region, chosen from each vertex's main bone and its height in the T-pose. */
function regionColour(bone: string, p: BABYLON.Vector3, kit: Kit, skin: string, hair: string): string {
  const b = bone.replace(BONE, '');
  const armOut = Math.abs(p.x);
  if (/Head|Eye/.test(b)) return p.y > 1.69 ? hair : skin;
  if (b === 'Neck') return skin;
  if (/Hand|Thumb|Index|Middle|Ring|Pinky/.test(b) || b.includes('ForeArm')) return skin;
  if (/Arm$/.test(b)) return armOut > 0.36 ? skin : kit.jersey; // short sleeves
  if (/Foot|Toe/.test(b)) return '#111111';
  if (/Leg$/.test(b) && !b.includes('Up')) return p.y > 0.47 ? skin : kit.socks;
  if (b.includes('UpLeg')) return p.y > 0.66 ? kit.shorts : skin;
  if (b === 'Hips') return p.y < 1.0 ? kit.shorts : kit.jersey;
  if (kit.band && p.y > 1.2 && p.y < 1.3) return kit.band;
  return kit.jersey;
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
    const res = await fetch(url);
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

  /** Colours every vertex for the kit: jersey, shorts, socks, boots, skin and hair. */
  private paint(mesh: BABYLON.Mesh, kit: Kit): void {
    const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind)!;
    const idx = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesIndicesKind)!;
    const wts = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesWeightsKind)!;
    const bones = mesh.skeleton!.bones;
    mesh.computeWorldMatrix(true);
    const world = mesh.getWorldMatrix();
    const colours = new Float32Array((pos.length / 3) * 4);
    const cache = new Map<string, BABYLON.Color3>();
    const p = new BABYLON.Vector3();
    for (let v = 0; v < pos.length / 3; v++) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (wts[v * 4 + k] > wts[v * 4 + best]) best = k;
      const bone = bones[idx[v * 4 + best]]?.name ?? '';
      BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], world, p);
      const hex = regionColour(bone, p, kit, '#d9a98a', '#3b2a1e');
      let c = cache.get(hex);
      if (!c) cache.set(hex, (c = BABYLON.Color3.FromHexString(hex).toLinearSpace()));
      colours.set([c.r, c.g, c.b, 1], v * 4);
    }
    mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, colours);
    mesh.useVertexColors = true;
  }

  /** Which way the model faces, from heel to toe. */
  private measureFacing(container: BABYLON.AssetContainer): number {
    const nodes = container.transformNodes;
    const foot = nodes.find((n) => n.name === `${BONE}LeftFoot`);
    const toe = nodes.find((n) => n.name === `${BONE}LeftToeBase`);
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
  private idle?: BABYLON.AnimationGroup;
  private walk?: BABYLON.AnimationGroup;
  private run?: BABYLON.AnimationGroup;
  private speed = 0;
  private bends: Bend[] = [];

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
    for (const n of inst.rootNodes) n.parent = turn;
    for (const n of turn.getDescendants(false)) {
      const base = n.name.split('#')[0].replace(BONE, '') as Joint;
      if (JOINT_ORDER.includes(base)) this.joints.set(base, n as BABYLON.TransformNode);
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
    this.walk = group('walk');
    this.run = group('run');
    for (const g of [this.idle, this.walk, this.run]) {
      if (!g) continue;
      g.start(true);
      g.weight = 0;
      // Players don't move in step with each other.
      g.goToFrame(g.from + ((seed * 7.3) % 1) * (g.to - g.from));
    }
    if (this.idle) this.idle.weight = 1;
    this.addNumber(scene, kit);
  }

  /** The number on the back of the jersey, riding on the upper spine. */
  private addNumber(scene: BABYLON.Scene, kit: Kit): void {
    const spine = this.root.getDescendants(false).find((n) => n.name.startsWith(`${BONE}Spine2`)) as BABYLON.TransformNode | undefined;
    if (!spine) return;
    this.root.computeWorldMatrix(true);
    for (const n of [...ancestors(spine), spine]) n.computeWorldMatrix(true);
    const plate = BABYLON.MeshBuilder.CreatePlane('number', { size: 0.2 }, scene);
    plate.material = numberDecal(scene, this.num, kit);
    plate.isPickable = false;
    const at = spine.getAbsolutePosition();
    // A plane faces -z, so unturned it reads correctly from behind the player.
    plate.position.set(at.x, at.y + 0.02, at.z - 0.125);
    plate.setParent(spine);
  }

  place(x: number, z: number, fx: number, fz: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = Math.atan2(fx - x, fz - z);
  }

  pose(name: PoseName, phase = 0, speed?: number): void {
    if (speed !== undefined) this.speed = speed;
    if (name === 'stand' || name === 'keeper') this.speed = 0;
    this.locomote();
    this.bends = bendsFor(name, phase);
    this.applyBends();
  }

  /** Blend standing, walking and running by ground speed, and match the stride to it. */
  private locomote(): void {
    const s = this.speed;
    const run = BABYLON.Scalar.Clamp((s - 2) / 2, 0, 1);
    const idle = BABYLON.Scalar.Clamp(1 - s / 1.2, 0, 1);
    const walk = Math.max(0, 1 - run - idle);
    if (this.idle) this.idle.weight = idle;
    if (this.walk) {
      this.walk.weight = walk;
      this.walk.speedRatio = BABYLON.Scalar.Clamp(s / 1.5, 0.6, 1.8);
    }
    if (this.run) {
      this.run.weight = run;
      this.run.speedRatio = BABYLON.Scalar.Clamp(s / 5, 0.75, 1.5);
    }
  }

  /**
   * Bends joints on top of this frame's animation. Each bend turns a joint about an axis in the
   * player's own space (forward, right, up), worked out in world space so it doesn't matter how the
   * model's bones happen to be oriented.
   */
  private applyBends(): void {
    if (this.bends.length === 0) return;
    const yaw = BABYLON.Matrix.RotationY(this.root.rotation.y);
    const world = new BABYLON.Matrix();
    const local = new BABYLON.Matrix();
    const inv = new BABYLON.Matrix();
    const scale = new BABYLON.Vector3();
    const rot = new BABYLON.Quaternion();
    const pos = new BABYLON.Vector3();
    let fresh = false;
    for (const joint of JOINT_ORDER) {
      const own = this.bends.filter((b) => b[0] === joint);
      if (own.length === 0) continue;
      const node = this.joints.get(joint);
      if (!node || !node.parent) continue;
      if (!fresh) {
        for (const n of ancestors(node)) n.computeWorldMatrix(true);
        fresh = true;
      }
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
function bendsFor(name: PoseName, phase: number): Bend[] {
  // Both hands in front of the chest holding the ball.
  const carryArms: Bend[] = [
    ['LeftArm', 'flex', 0.5], ['RightArm', 'flex', 0.5],
    ['LeftArm', 'outR', 0.3], ['RightArm', 'outL', 0.3],
    ['LeftForeArm', 'flex', 1.0], ['RightForeArm', 'flex', 1.0],
  ];
  switch (name) {
    case 'carry':
      return carryArms;
    case 'kick':
      return [['RightUpLeg', 'flex', 1.35], ['RightLeg', 'knee', 0.05], ['Spine', 'lean', -0.15], ['LeftArm', 'outL', 1.0], ['RightArm', 'outR', 0.6]];
    case 'handPass':
      return [['RightArm', 'flex', 1.5], ['RightForeArm', 'flex', 0.15], ['LeftArm', 'flex', 0.9], ['LeftForeArm', 'flex', 1.1], ['Spine1', 'twist', -0.3]];
    case 'solo': {
      // As in coaching footage: the ball drops from the hands, the thigh lifts and the lower leg flicks
      // the ball off the toe back up, arms ready to take it.
      const w = Math.sin(Math.PI * BABYLON.Scalar.Clamp((phase - 0.1) / 0.7, 0, 1));
      return [
        ['RightUpLeg', 'flex', 0.75 * w], ['RightLeg', 'knee', 1.1 - 0.85 * w],
        ['LeftArm', 'flex', 0.55], ['RightArm', 'flex', 0.55], ['LeftArm', 'outR', 0.2], ['RightArm', 'outL', 0.2],
        ['LeftForeArm', 'flex', 1.25 - 0.6 * w], ['RightForeArm', 'flex', 1.25 - 0.6 * w],
        ['Spine', 'lean', 0.12 * w],
      ];
    }
    case 'toePick':
      return [['Spine', 'lean', 0.45], ['RightUpLeg', 'flex', 0.55], ['RightLeg', 'knee', 0.25], ['LeftArm', 'flex', 0.55], ['RightArm', 'flex', 0.55]];
    case 'shoulder':
      return [['Spine', 'lean', 0.2], ['Spine1', 'side', -0.35], ['Spine1', 'twist', 0.45], ['LeftForeArm', 'flex', 1.6], ['RightForeArm', 'flex', 1.4], ['LeftArm', 'outL', 0.15]];
    case 'stumble':
      return [['Spine', 'lean', -0.35], ['LeftArm', 'outL', 1.2], ['RightArm', 'outR', 1.1], ['RightUpLeg', 'flex', -0.4]];
    case 'jump':
      return [['LeftArm', 'flex', 2.8], ['RightArm', 'flex', 2.8], ['LeftUpLeg', 'flex', 0.5], ['LeftLeg', 'knee', 1.0]];
    case 'keeper':
      return [
        ['LeftUpLeg', 'flex', 0.45], ['RightUpLeg', 'flex', 0.45], ['LeftLeg', 'knee', 0.8], ['RightLeg', 'knee', 0.8],
        ['Spine', 'lean', 0.35], ['LeftArm', 'flex', 0.7], ['RightArm', 'flex', 0.7], ['LeftArm', 'outL', 0.5], ['RightArm', 'outR', 0.5],
      ];
    default:
      return [];
  }
}
