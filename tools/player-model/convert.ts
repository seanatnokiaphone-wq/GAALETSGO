/**
 * Builds public/models/player.glb from Sean's solo1.fbx: just the player and its rig, with the clips
 * the game uses cut from the SoloRun take and the root motion taken out.
 *
 *   npx fbx2gltf --binary -i tools/player-model/solo1.fbx -o tools/player-model/solo1
 *   npm run dev, open /tools/player-model/convert.html, and save window.b64 (base64) as the .glb.
 */
import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { GLTF2Export } from '@babylonjs/serializers/glTF';
const engine = new BABYLON.NullEngine();
const scene = new BABYLON.Scene(engine);
const W = window as any;

// Clips cut from Sean's SoloRun take (60 fps frames): name, from, to.
const CLIPS: [string, number, number][] = [['idle', 360, 362.5], ['run', 0, 40], ['solo', 86, 122], ['kick', 300, 345]];
(async () => {
  try {
    await BABYLON.AppendSceneAsync('/tools/player-model/solo1.glb', scene);
    const rig = scene.getTransformNodeByName('PlayerRig')!;
    const keepMeshes = new Set(['Body', 'Jersey', 'Shorts']);
    const keep = (n: BABYLON.Node): boolean => {
      for (let p: BABYLON.Node | null = n; p; p = p.parent) {
        if (p === rig) return true;
        if (keepMeshes.has(p.name)) return true;
      }
      for (let p: BABYLON.Node | null = rig; p; p = p.parent) if (p === n) return true;
      return false;
    };
    const src = scene.getAnimationGroupByName('PlayerRig|SoloRun')!;
    const made: BABYLON.AnimationGroup[] = [];
    for (const [name, from, to] of CLIPS) {
      const g = new BABYLON.AnimationGroup(name, scene);
      for (const ta of src.targetedAnimations) {
        if (ta.target.name === 'root') continue; // drop root motion: the game moves the player
        const a = ta.animation;
        const out = new BABYLON.Animation(`${ta.target.name}_${name}`, a.targetProperty, a.framePerSecond, a.dataType);
        const keys: BABYLON.IAnimationKey[] = [];
        for (let f = from; f <= to + 1e-6; f += 2.5) keys.push({ frame: f - from, value: a.evaluate(f).clone() });
        out.setKeys(keys);
        g.addTargetedAnimation(out, ta.target);
      }
      made.push(g);
    }
    // Standing still with the ball: the standing legs with the run's ball-carrying arms.
    const hold = new BABYLON.AnimationGroup('hold', scene);
    for (const ta of src.targetedAnimations) {
      if (ta.target.name === 'root') continue;
      const a = ta.animation;
      const f = /arm/.test(ta.target.name) ? 0 : 360;
      const out = new BABYLON.Animation(`${ta.target.name}_hold`, a.targetProperty, a.framePerSecond, a.dataType);
      out.setKeys([{ frame: 0, value: a.evaluate(f).clone() }, { frame: 2.5, value: a.evaluate(f).clone() }]);
      hold.addTargetedAnimation(out, ta.target);
    }
    made.push(hold);
    for (const g of [...scene.animationGroups]) if (!made.includes(g)) g.dispose();
    const root = scene.getTransformNodeByName('root')!;
    root.position.set(0, 0, 0);
    for (const m of [...scene.meshes]) if (!keep(m)) m.dispose();
    for (const n of [...scene.transformNodes]) if (!keep(n) && !n.isDisposed()) n.dispose();
    for (const c of [...scene.cameras]) c.dispose();
    for (const l of [...scene.lights]) l.dispose();
    W.info = { meshes: scene.meshes.map((m) => m.name), nodes: scene.transformNodes.length, groups: made.map((g) => `${g.name} ${g.to} ${g.targetedAnimations.length}`) };
    const glb = await GLTF2Export.GLBAsync(scene, 'player', { shouldExportNode: (n) => keep(n) });
    const blob = Object.values(glb.files)[0] as Blob;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    W.b64 = btoa(s);
    W.ok = true;
  } catch (e) {
    W.err = String(e) + (e as Error).stack;
  }
})();
