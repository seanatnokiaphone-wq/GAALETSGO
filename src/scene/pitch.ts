import * as BABYLON from '@babylonjs/core';
import { HALF_LENGTH as HL, HALF_WIDTH as HW, PITCH, type RuleSet } from '../rules';
import { seededRandom } from './rng';

// Grass extends past the pitch so the surrounds are green too.
const GX = 175;
const GZ = 118;
const TW = 4096;
const TH = Math.round((TW * GZ) / GX);
const PPM = TW / GX;
const X = (x: number) => (x + GX / 2) * PPM;
const Z = (z: number) => (z + GZ / 2) * PPM;

export interface Pitch {
  ground: BABYLON.Mesh;
  /** Redraws the markings, e.g. to show or hide the two-point arc when the rule set changes. */
  redraw(rules: RuleSet): void;
}

export function createPitch(scene: BABYLON.Scene, rules: RuleSet): Pitch {
  const tex = new BABYLON.DynamicTexture('grass', { width: TW, height: TH }, scene, true);
  tex.anisotropicFilteringLevel = 16;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;

  // The mown grass is drawn once and cached; only the markings change.
  drawGrass(ctx);
  const grass = ctx.getImageData(0, 0, TW, TH);

  const redraw = (r: RuleSet) => {
    ctx.putImageData(grass, 0, 0);
    drawMarkings(ctx, r);
    tex.update();
  };
  redraw(rules);

  const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: GX, height: GZ }, scene);
  const mat = new BABYLON.StandardMaterial('groundMat', scene);
  mat.diffuseTexture = tex;
  mat.specularColor = new BABYLON.Color3(0.04, 0.05, 0.03);
  ground.material = mat;
  ground.receiveShadows = true;

  return { ground, redraw };
}

function drawGrass(ctx: CanvasRenderingContext2D): void {
  const rnd = seededRandom(11);
  const stripe = 6;
  for (let x = -GX / 2; x < GX / 2; x += stripe) {
    const i = Math.floor((x + GX / 2) / stripe);
    ctx.fillStyle = i % 2 ? '#3f7a2c' : '#4c8a33';
    ctx.fillRect(X(x), 0, stripe * PPM + 1, TH);
  }
  ctx.globalAlpha = 0.035;
  for (let z = -GZ / 2; z < GZ / 2; z += stripe * 1.5) {
    const i = Math.floor((z + GZ / 2) / (stripe * 1.5));
    ctx.fillStyle = i % 2 ? '#ffffff' : '#000000';
    ctx.fillRect(0, Z(z), TW, stripe * 1.5 * PPM + 1);
  }
  ctx.globalAlpha = 1;

  const img = ctx.getImageData(0, 0, TW, TH);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 26;
    d[i] += n * 0.7;
    d[i + 1] += n;
    d[i + 2] += n * 0.5;
  }
  ctx.putImageData(img, 0, 0);

  const wear = (x: number, z: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), r * PPM);
    g.addColorStop(0, `rgba(120,110,60,${a})`);
    g.addColorStop(1, 'rgba(120,110,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(X(x), Z(z), r * PPM, 0, Math.PI * 2);
    ctx.fill();
  };
  wear(-HL + 3, 0, 5, 0.35);
  wear(HL - 3, 0, 5, 0.35);
  wear(0, 0, 6, 0.18);
}

function drawMarkings(ctx: CanvasRenderingContext2D, rules: RuleSet): void {
  const white = 'rgba(245,248,240,0.92)';
  ctx.strokeStyle = white;
  ctx.fillStyle = white;
  ctx.lineWidth = 0.12 * PPM;
  const line = (x1: number, z1: number, x2: number, z2: number) => {
    ctx.beginPath();
    ctx.moveTo(X(x1), Z(z1));
    ctx.lineTo(X(x2), Z(z2));
    ctx.stroke();
  };

  line(-HL, -HW, HL, -HW);
  line(-HL, HW, HL, HW);
  line(-HL, -HW, -HL, HW);
  line(HL, -HW, HL, HW);
  line(0, -5, 0, 5);

  for (const s of [-1, 1]) {
    const e = s * HL;
    for (const m of [13, 20, 45, 65]) line(e - s * m, -HW, e - s * m, HW);
    // Small rectangle 14 m x 4.5 m, large rectangle 19 m x 13 m.
    line(e, -7, e - s * 4.5, -7);
    line(e - s * 4.5, -7, e - s * 4.5, 7);
    line(e - s * 4.5, 7, e, 7);
    line(e, -9.5, e - s * 13, -9.5);
    line(e - s * 13, -9.5, e - s * 13, 9.5);
    line(e - s * 13, 9.5, e, 9.5);

    // 13 m arc on the 20 m line, bulging away from goal.
    const [a0, a1] = s > 0 ? [Math.PI / 2, Math.PI * 1.5] : [-Math.PI / 2, Math.PI / 2];
    ctx.beginPath();
    ctx.arc(X(e - s * 20), Z(0), 13 * PPM, a0, a1);
    ctx.stroke();

    if (rules.twoPointArcRadius !== null) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(X(-HL), Z(-HW), PITCH.length * PPM, PITCH.width * PPM);
      ctx.clip();
      ctx.beginPath();
      ctx.arc(X(e), Z(0), rules.twoPointArcRadius * PPM, a0, a1);
      ctx.stroke();
      ctx.restore();
    }

    // Penalty spot at 11 m.
    ctx.beginPath();
    ctx.arc(X(e - s * 11), Z(0), 0.15 * PPM, 0, Math.PI * 2);
    ctx.fill();
  }
}
