import * as BABYLON from '@babylonjs/core';
import { SkyMaterial } from '@babylonjs/materials';

export interface Environment {
  sun: BABYLON.DirectionalLight;
  shadows: BABYLON.ShadowGenerator;
}

export function createEnvironment(scene: BABYLON.Scene): Environment {
  scene.clearColor = new BABYLON.Color4(0.55, 0.68, 0.85, 1);
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0016;
  scene.fogColor = new BABYLON.Color3(0.7, 0.76, 0.82);

  const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.55;
  hemi.groundColor = new BABYLON.Color3(0.25, 0.3, 0.22);

  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -0.75, 0.45), scene);
  sun.intensity = 2.4;
  sun.diffuse = new BABYLON.Color3(1, 0.95, 0.86);
  sun.autoCalcShadowZBounds = true;

  const shadows = new BABYLON.ShadowGenerator(4096, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = BABYLON.ShadowGenerator.QUALITY_HIGH;
  shadows.bias = 0.0006;
  shadows.normalBias = 0.01;
  shadows.darkness = 0.25;

  const skyMat = new SkyMaterial('sky', scene);
  skyMat.backFaceCulling = false;
  skyMat.turbidity = 6;
  skyMat.luminance = 1;
  skyMat.rayleigh = 1.6;
  skyMat.inclination = 0.16;
  skyMat.azimuth = 0.32;
  skyMat.mieDirectionalG = 0.8;
  skyMat.fogEnabled = false;
  const sky = BABYLON.MeshBuilder.CreateBox('sky', { size: 1800 }, scene);
  sky.material = skyMat;
  sky.infiniteDistance = true;

  return { sun, shadows };
}

export function createPostProcessing(scene: BABYLON.Scene, camera: BABYLON.Camera): void {
  const pipe = new BABYLON.DefaultRenderingPipeline('post', true, scene, [camera]);
  pipe.fxaaEnabled = true;
  pipe.samples = 4;
  pipe.imageProcessingEnabled = true;
  pipe.imageProcessing.toneMappingEnabled = true;
  pipe.imageProcessing.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipe.imageProcessing.exposure = 1.05;
  pipe.imageProcessing.contrast = 1.12;
  pipe.imageProcessing.vignetteEnabled = true;
  pipe.imageProcessing.vignetteWeight = 1.6;
  pipe.bloomEnabled = true;
  pipe.bloomThreshold = 0.85;
  pipe.bloomWeight = 0.25;
  pipe.sharpenEnabled = true;
  pipe.sharpen.edgeAmount = 0.25;
}
