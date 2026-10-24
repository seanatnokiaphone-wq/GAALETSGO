import * as BABYLON from '@babylonjs/core';
import { HALF_LENGTH as HL, HALF_WIDTH as HW } from '../rules';
import { colour } from './materials';
import { seededRandom } from './rng';

interface Seat {
  root: BABYLON.TransformNode;
  x: number;
  y: number;
  z: number;
}

const SHIRTS = ['#2f8f3e', '#f2c12e', '#2f8f3e', '#f2c12e', '#7fb8e6', '#13294b', '#7fb8e6', '#13294b', '#d8d8d8', '#333333', '#8a2a2a', '#555a60', '#c9c3b5'];

export function createStadium(scene: BABYLON.Scene): void {
  const rnd = seededRandom(7);
  const seats: Seat[] = [];
  const concrete = colour(scene, '#8d8f8c');
  const seatMat = colour(scene, '#2a4d7a');
  const roofMat = colour(scene, '#d9dcdf', 0.3);
  roofMat.emissiveColor = new BABYLON.Color3(0.42, 0.43, 0.45);
  const dark = colour(scene, '#2b2e31');
  dark.emissiveColor = new BABYLON.Color3(0.12, 0.12, 0.13);
  const steel = colour(scene, '#c9ccd0', 0.4);

  // Each stand's local +z points away from the pitch.
  const stand = (cx: number, cz: number, len: number, rotY: number, tiers: number, depth: number, rise: number, roofH: number) => {
    const root = new BABYLON.TransformNode('stand', scene);
    root.position.set(cx, 0, cz);
    root.rotation.y = rotY;
    const rowDepth = depth / tiers;
    for (let t = 0; t < tiers; t++) {
      const b = BABYLON.MeshBuilder.CreateBox('tier', { width: len, height: rise, depth: rowDepth }, scene);
      b.parent = root;
      b.position.set(0, rise * t + rise / 2, rowDepth * t + rowDepth / 2);
      b.material = seatMat;
      for (let k = 0; k < len / 0.62; k++) {
        if (rnd() < 0.08) continue;
        seats.push({ root, x: -len / 2 + 0.31 + k * 0.62 + (rnd() - 0.5) * 0.1, y: rise * (t + 1) + 0.42, z: rowDepth * t + 0.55 });
      }
    }
    const backH = rise * tiers + 8;
    const back = BABYLON.MeshBuilder.CreateBox('standBack', { width: len, height: backH, depth: 1 }, scene);
    back.parent = root;
    back.position.set(0, backH / 2, depth + 0.5);
    back.material = concrete;
    const roof = BABYLON.MeshBuilder.CreateBox('roof', { width: len + 4, height: 0.8, depth: depth * 0.95 }, scene);
    roof.parent = root;
    roof.position.set(0, roofH, depth * 0.55);
    roof.rotation.x = -0.08;
    roof.material = roofMat;
    const fascia = BABYLON.MeshBuilder.CreateBox('fascia', { width: len + 4, height: 2.2, depth: 0.4 }, scene);
    fascia.parent = root;
    fascia.position.set(0, roofH - 0.6, depth * 0.08);
    fascia.material = dark;
  };

  const off = 9;
  stand(0, HW + off, 172, 0, 40, 34, 0.45, 30);
  stand(0, -HW - off, 172, Math.PI, 40, 34, 0.45, 30);
  stand(HL + off, 0, 112, Math.PI / 2, 30, 24, 0.45, 22);
  stand(-HL - off, 0, 112, -Math.PI / 2, 34, 28, 0.45, 25);

  // Crowd: one box per supporter, drawn as thin instances with per-instance colour.
  const person = BABYLON.MeshBuilder.CreateBox('crowd', { width: 0.44, height: 0.8, depth: 0.3 }, scene);
  const crowdMat = new BABYLON.StandardMaterial('crowdMat', scene);
  crowdMat.specularColor = BABYLON.Color3.Black();
  person.material = crowdMat;
  const matrices = new Float32Array(seats.length * 16);
  const colours = new Float32Array(seats.length * 4);
  seats.forEach((p, i) => {
    p.root.computeWorldMatrix(true);
    const wp = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(p.x, p.y, p.z), p.root.getWorldMatrix());
    const m = BABYLON.Matrix.Compose(
      new BABYLON.Vector3(1, 0.85 + rnd() * 0.3, 1),
      BABYLON.Quaternion.RotationYawPitchRoll(p.root.rotation.y, 0, 0),
      wp,
    );
    m.copyToArray(matrices, i * 16);
    const c = BABYLON.Color3.FromHexString(SHIRTS[Math.floor(rnd() * SHIRTS.length)]).scale(0.7 + rnd() * 0.4);
    colours.set([c.r, c.g, c.b, 1], i * 4);
  });
  person.thinInstanceSetBuffer('matrix', matrices, 16);
  person.thinInstanceSetBuffer('color', colours, 4);

  // Advertising boards facing the pitch.
  const ads = new BABYLON.DynamicTexture('ads', { width: 4096, height: 128 }, scene, true);
  const ac = ads.getContext() as unknown as CanvasRenderingContext2D;
  const words = ['ALL-IRELAND SFC', 'ARDMORE v KILCARRA', 'PEIL GHAELACH', 'LEAGUE DIVISION 1', 'FÁILTE', 'ALL-IRELAND SFC'];
  const w = 4096 / words.length;
  words.forEach((t, i) => {
    ac.fillStyle = i % 2 ? '#0c3b22' : '#f4f4f0';
    ac.fillRect(i * w, 0, w, 128);
    ac.fillStyle = i % 2 ? '#f2c12e' : '#0c3b22';
    ac.font = 'bold 64px sans-serif';
    ac.textAlign = 'center';
    ac.fillText(t, (i + 0.5) * w, 88);
  });
  ads.update();
  const adMat = new BABYLON.StandardMaterial('adMat', scene);
  adMat.diffuseTexture = ads;
  adMat.emissiveColor = new BABYLON.Color3(0.35, 0.35, 0.35);
  adMat.specularColor = BABYLON.Color3.Black();
  const boards: [number, number, number, number][] = [
    [0, HW + 4, 150, 0],
    [0, -HW - 4, 150, Math.PI],
    [HL + 5, 0, 92, Math.PI / 2],
    [-HL - 5, 0, 92, -Math.PI / 2],
  ];
  for (const [x, z, len, ry] of boards) {
    const b = BABYLON.MeshBuilder.CreatePlane('ad', { width: len, height: 0.9 }, scene);
    b.position.set(x, 0.45, z);
    b.rotation.y = ry;
    b.material = adMat;
    b.receiveShadows = true;
  }

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pylon = BABYLON.MeshBuilder.CreateCylinder('pylon', { height: 52, diameterTop: 0.8, diameterBottom: 1.6 }, scene);
      pylon.position.set(sx * (HL + 28), 26, sz * (HW + 30));
      pylon.material = steel;
      const head = BABYLON.MeshBuilder.CreateBox('lights', { width: 8, height: 5, depth: 1 }, scene);
      head.position.set(sx * (HL + 27), 52, sz * (HW + 29));
      head.lookAt(BABYLON.Vector3.Zero());
      head.material = dark;
    }
  }
}
