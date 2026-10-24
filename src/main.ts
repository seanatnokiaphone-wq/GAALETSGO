import * as BABYLON from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { HALF_LENGTH as HL, HALF_WIDTH as HW, RULE_SETS, type RuleSet } from './rules';
import { createEnvironment, createPostProcessing } from './scene/environment';
import { createGoals } from './scene/goals';
import { createPitch } from './scene/pitch';
import { KITS, PlayerFigure } from './scene/player';
import { createStadium } from './scene/stadium';
import { Ball } from './game/ball';
import { Hud } from './game/hud';
import { Input } from './game/input';
import { Match } from './game/match';
import { createTouchControls } from './game/touch';
import './style.css';

// Standard line-up for a team attacking +x: keeper, full-backs, half-backs, midfield, half-forwards, full-forwards.
const LINE_UP: [number, number][] = [
  [-70, 0], [-56, -16], [-58, 0], [-56, 16], [-40, -22], [-42, 0], [-40, 22],
  [-8, -8], [-6, 8], [22, -22], [20, 0], [22, 22], [48, -16], [52, 0], [48, 16],
];

const PAD_HELP = `<b>Left stick</b> move · <b>RB</b> sprint · <b>Right stick</b> camera<br />
  <b>A</b> hand-pass · <b>B</b> solo · <b>LT</b> bounce · <b>X</b> toe-pick<br />
  <b>Y</b> hold for a lofted kick · <b>RT</b> hold for a low kick<br />
  <b>View</b> camera · <b>LB</b> reset view · <b>R3</b> rules · <b>Menu</b> new game`;

async function start(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const engine = new BABYLON.Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true });
  const scene = new BABYLON.Scene(engine);

  const havok = await HavokPhysics();
  scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), new BABYLON.HavokPlugin(true, havok));

  const params = new URLSearchParams(location.search);
  let rules: RuleSet = params.get('rules') === '2025' ? RULE_SETS.enhanced2025 : RULE_SETS.classic;

  const camera = new BABYLON.UniversalCamera('camera', new BABYLON.Vector3(25, 3, -10), scene);
  camera.minZ = 0.1;
  camera.maxZ = 2000;
  camera.inputs.clear();

  // Phones and tablets get on-screen controls and lighter shadows and anti-aliasing.
  const touch = matchMedia('(pointer: coarse)').matches;
  const { shadows } = createEnvironment(scene, touch ? 2048 : 4096);
  const pitch = createPitch(scene, rules);
  createStadium(scene);
  const goalFrames = createGoals(scene, shadows);

  // Colliders: a thick box under the grass, and the posts and crossbars.
  const floor = BABYLON.MeshBuilder.CreateBox('floor', { width: 400, height: 2, depth: 300 }, scene);
  floor.position.y = -1;
  floor.isVisible = false;
  new BABYLON.PhysicsAggregate(floor, BABYLON.PhysicsShapeType.BOX, { mass: 0, restitution: 0.6, friction: 0.8 }, scene);
  for (const m of goalFrames) {
    new BABYLON.PhysicsAggregate(m, BABYLON.PhysicsShapeType.CYLINDER, { mass: 0, restitution: 0.5, friction: 0.3 }, scene);
  }

  // Everyone else stands in formation for now; team AI arrives in a later milestone.
  LINE_UP.forEach(([x, z], i) => {
    const num = i + 1;
    if (num !== 14) {
      const a = new PlayerFigure(scene, i === 0 ? KITS.ardmoreKeeper : KITS.ardmore, num, shadows, i);
      a.place(x * 0.8, z, HL, z);
      a.pose(i === 0 ? 'keeper' : 'stand');
    }
    const b = new PlayerFigure(scene, i === 0 ? KITS.kilcarraKeeper : KITS.kilcarra, num, shadows, i + 15);
    const bx = i === 0 ? HL - 1.2 : -x * 0.75 + 4;
    b.place(bx, -z * 0.9, -HL, -z);
    b.pose(i === 0 ? 'keeper' : 'stand');
  });

  const me = new PlayerFigure(scene, KITS.ardmore, 14, shadows, 3);
  const ball = new Ball(scene, shadows);
  createPostProcessing(scene, camera, touch ? 1 : 4);

  const toggleRules = () => {
    rules = rules.id === 'classic' ? RULE_SETS.enhanced2025 : RULE_SETS.classic;
    pitch.redraw(rules);
    return rules;
  };
  const hud = new Hud();
  const input = new Input();
  input.attachLook(canvas);
  const help = document.querySelector<HTMLElement>('.help');
  const keyboardHelp = help?.innerHTML ?? '';
  input.onGamepadChange = (connected) => {
    if (help) help.innerHTML = connected ? PAD_HELP : keyboardHelp;
    hud.banner(connected ? 'CONTROLLER CONNECTED' : 'CONTROLLER REMOVED', connected ? 'Xbox layout' : 'Keyboard and mouse', 1.8);
  };
  if (touch) {
    document.body.classList.add('touch-mode');
    createTouchControls(input, document.getElementById('hud')!);
  }
  const match = new Match(scene, camera, me, ball, input, hud, rules, toggleRules);

  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 1 / 20);
    match.update(dt);
  });
  // Exposed for automated screenshots and debugging in the console.
  Object.assign(window, { gaa: { scene, engine, match, HW } });

  document.getElementById('loading')?.remove();
  const startScreen = document.getElementById('start');
  if (startScreen) {
    startScreen.hidden = false;
    startScreen.addEventListener('pointerdown', () => {
      startScreen.remove();
      canvas.focus();
    });
  }
  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
}

start().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Couldn’t start the game: ${err instanceof Error ? err.message : String(err)}`;
});
