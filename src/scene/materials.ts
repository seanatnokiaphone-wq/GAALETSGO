import * as BABYLON from '@babylonjs/core';

const cache = new Map<string, BABYLON.StandardMaterial>();

/** Plain coloured material, shared by colour and shininess. */
export function colour(scene: BABYLON.Scene, hex: string, spec = 0.08): BABYLON.StandardMaterial {
  const key = `${hex}:${spec}`;
  let m = cache.get(key);
  if (!m) {
    m = new BABYLON.StandardMaterial(`c${key}`, scene);
    m.diffuseColor = BABYLON.Color3.FromHexString(hex);
    m.specularColor = new BABYLON.Color3(spec, spec, spec);
    cache.set(key, m);
  }
  return m;
}
