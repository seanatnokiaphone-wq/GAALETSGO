import * as BABYLON from '@babylonjs/core';
import { HALF_LENGTH, PITCH } from '../rules';
import { colour } from './materials';

/** Builds both H-shaped goals and returns the posts and crossbars so physics can collide with them. */
export function createGoals(scene: BABYLON.Scene, shadows: BABYLON.ShadowGenerator): BABYLON.Mesh[] {
  const white = colour(scene, '#f6f6f2', 0.35);
  const netTex = new BABYLON.DynamicTexture('net', { width: 256, height: 256 }, scene, true);
  const n = netTex.getContext() as unknown as CanvasRenderingContext2D;
  n.clearRect(0, 0, 256, 256);
  n.strokeStyle = 'rgba(255,255,255,0.95)';
  n.lineWidth = 3;
  for (let i = 0; i <= 256; i += 16) {
    n.beginPath(); n.moveTo(i, 0); n.lineTo(i, 256); n.stroke();
    n.beginPath(); n.moveTo(0, i); n.lineTo(256, i); n.stroke();
  }
  netTex.hasAlpha = true;
  netTex.update();
  netTex.uScale = 10;
  netTex.vScale = 4;
  const netMat = new BABYLON.StandardMaterial('netMat', scene);
  netMat.diffuseTexture = netTex;
  netMat.useAlphaFromDiffuseTexture = true;
  netMat.backFaceCulling = false;
  netMat.specularColor = BABYLON.Color3.Black();
  netMat.emissiveColor = new BABYLON.Color3(0.25, 0.25, 0.25);

  const solid: BABYLON.Mesh[] = [];
  const { goalWidth: gw, crossbarHeight: ch, postHeight: ph } = PITCH;
  const r = 0.06;
  const depth = 2.2;
  for (const s of [-1, 1]) {
    const x = s * HALF_LENGTH;
    for (const z of [-gw / 2 - r, gw / 2 + r]) {
      const post = BABYLON.MeshBuilder.CreateCylinder('post', { height: ph, diameter: r * 2 }, scene);
      post.position.set(x, ph / 2, z);
      post.material = white;
      shadows.addShadowCaster(post);
      solid.push(post);
    }
    const bar = BABYLON.MeshBuilder.CreateCylinder('crossbar', { height: gw, diameter: r * 2.2 }, scene);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(x, ch + r, 0);
    bar.material = white;
    shadows.addShadowCaster(bar);
    solid.push(bar);

    const back = BABYLON.MeshBuilder.CreatePlane('netBack', { width: gw, height: ch }, scene);
    back.position.set(x + s * depth, ch / 2, 0);
    back.rotation.y = Math.PI / 2;
    back.material = netMat;
    const top = BABYLON.MeshBuilder.CreatePlane('netTop', { width: gw, height: depth }, scene);
    top.position.set(x + (s * depth) / 2, ch, 0);
    top.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    top.material = netMat;
    for (const z of [-gw / 2, gw / 2]) {
      const side = BABYLON.MeshBuilder.CreatePlane('netSide', { width: depth, height: ch }, scene);
      side.position.set(x + (s * depth) / 2, ch / 2, z);
      side.material = netMat;
    }
  }
  return solid;
}
