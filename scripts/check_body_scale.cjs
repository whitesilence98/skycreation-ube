// Run: node scripts/check_body_scale.cjs (no assets, browser or server required).
// Contract for lib/anatomy/bodyScale.ts and the applySkeletonWeight scale pass:
// neutral identity, height ratio, slider direction, real bone names and axes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(name) {
  const file = path.join(root, name + '.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, console, process, URLSearchParams,
    require: id => id.startsWith('@/') ? load(id.slice(2)) : id.startsWith('.')
      ? load(path.relative(root, path.resolve(path.dirname(file), id)).split(path.sep).join('/')) : require(id),
  }, { filename: file });
  return module.exports;
}

const scale = load('lib/anatomy/bodyScale');
const validate = load('lib/anatomy/validate');
const params = load('lib/anatomy/params');
const { XP32_CANONICAL_PARENTS, SKELETON_WEIGHT_SCALES, SkeletonRegistry, applySkeletonWeight } = load('lib/character/skeleton');

const neutral = validate.coerceAnatomy();
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const withAnatomy = patch => validate.coerceAnatomy({ ...neutral, ...patch });

// Exercise the real scale pass, including a lifted scene wrapper and repeated calls.
{
  const THREE = require('three');
  const registry = new SkeletonRegistry('ground');
  const def = (name, parent, z) => ({ name, parent, world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, z] });
  registry.register([
    def('NPC Root [Root]', null, 100),
    def('NPC Head [Head]', 'NPC Root [Root]', 160),
    def('NPC L Foot [Lft ]', 'NPC Root [Root]', 0),
  ]);
  const wrapper = new THREE.Group();
  wrapper.add(registry.group);
  wrapper.position.y = 0.3;
  wrapper.updateMatrixWorld(true);
  const tall = scale.bodyScaleFactors(withAnatomy({ 'body.heightCm': 200 }));
  const first = applySkeletonWeight(registry, 0, tall);
  assert.ok(close(first.height, 1.554 * 200 / 170));
  assert.ok(first.footDrop > 0);
  wrapper.position.y = first.footDrop;
  wrapper.updateMatrixWorld(true);
  const second = applySkeletonWeight(registry, 0, tall);
  assert.ok(close(first.footDrop, second.footDrop), 'wrapper lift must not accumulate');
  assert.ok(close(first.height, second.height), 'scale must not accumulate');
  const reset = applySkeletonWeight(registry, 0, scale.NEUTRAL_BODY_SCALE);
  assert.ok(close(reset.footDrop, 0));
  assert.ok(close(reset.height, 1.554));
}


// 1. Neutral anatomy is exactly identity — existing presets render unchanged.
const identity = scale.bodyScaleFactors(neutral);
assert.equal(identity.rootScale, 1, 'neutral rootScale must be exactly 1');
for (const [bone, f] of Object.entries(identity.bones)) {
  assert.ok(close(f.x, 1) && close(f.y, 1) && close(f.z, 1), `${bone} must be neutral`);
}
assert.deepEqual(JSON.parse(JSON.stringify(scale.NEUTRAL_BODY_SCALE)), { bones: {}, rootScale: 1 });

// 2. Height: 170 → 1, 150 → 150/170, 200 → 200/170 (≈ 1.176), uniform root only.
assert.equal(scale.bodyScaleFactors(withAnatomy({ 'body.heightCm': 170 })).rootScale, 1);
assert.ok(close(scale.bodyScaleFactors(withAnatomy({ 'body.heightCm': 150 })).rootScale, 150 / 170));
assert.ok(close(scale.bodyScaleFactors(withAnatomy({ 'body.heightCm': 200 })).rootScale, 200 / 170, 1e-12));
assert.equal(scale.BODY_SCALE_REFERENCE_HEIGHT_CM, 170);
assert.equal(scale.BODY_SCALE_BASELINE_HEIGHT, 1.554, 'camera baseline matches computeGroundOffset');
{
  const tall = scale.bodyScaleFactors(withAnatomy({ 'body.heightCm': 200 }));
  assert.ok(!Object.hasOwn(tall.bones, 'NPC Head [Head]'), 'height is a root scale, not a head entry');
}

// 3. Direction: every body-shape slider moves its own axes the right way.
const sliders = ['body.headScale', 'body.fat', 'body.shoulderWidth', 'body.chestSize',
  'body.waistSize', 'body.hipWidth', 'body.armLength', 'body.legLength',
  'body.buttSize', 'body.thighWidth', 'body.belly'];
for (const id of sliders) {
  const low = scale.bodyScaleFactors(withAnatomy({ [id]: 0 }));
  const high = scale.bodyScaleFactors(withAnatomy({ [id]: 100 }));
  /* Only the axes the slider touches move; untied axes stay exactly 1. */
  for (const [bone, f] of Object.entries(high.bones)) {
    for (const axis of ['x', 'y', 'z']) {
      if (f[axis] === 1) continue;
      assert.ok(f[axis] > 1 && f[axis] <= scale.BODY_SCALE_MAX_FACTOR, `${id} ${bone}.${axis} high`);
      assert.ok(low.bones[bone][axis] < 1 && low.bones[bone][axis] >= scale.BODY_SCALE_MIN_FACTOR,
        `${id} ${bone}.${axis} low`);
    }
  }
}

// 4. Head size alone: only the head bone, uniform, ±0.6 %/unit (×0.70…×1.30).
{
  const small = scale.bodyScaleFactors(withAnatomy({ 'body.headScale': 0 }));
  const large = scale.bodyScaleFactors(withAnatomy({ 'body.headScale': 100 }));
  assert.deepEqual([...Object.keys(small.bones)], ['NPC Head [Head]']);
  assert.ok(close(small.bones['NPC Head [Head]'].x, 0.7, 1e-12));
  assert.ok(close(large.bones['NPC Head [Head]'].x, 1.3, 1e-12));
  assert.equal(large.rootScale, 1);
}

// 5. Limb chains compose √ gain per bone; the product lands near the slider gain.
{
  const high = scale.bodyScaleFactors(withAnatomy({ 'body.armLength': 100 }));
  const perBone = 1 + 50 * 0.0035;
  assert.ok(close(high.bones['NPC L UpperArm [LUar]'].z, Math.sqrt(perBone), 1e-12));
  assert.ok(close(high.bones['NPC L Forearm [LLar]'].z, Math.sqrt(perBone), 1e-12));
  const product = high.bones['NPC L UpperArm [LUar]'].z * high.bones['NPC L Forearm [LLar]'].z;
  assert.ok(close(product, perBone, 1e-12), 'two-bone product equals the slider gain');
}

// 6. Composition: waist (Spine1) + fat (Spine1) multiply instead of overwrite.
{
  const both = scale.bodyScaleFactors(withAnatomy({ 'body.waistSize': 100, 'body.fat': 100 }));
  const waist = scale.bodyScaleFactors(withAnatomy({ 'body.waistSize': 100 }));
  const fat = scale.bodyScaleFactors(withAnatomy({ 'body.fat': 100 }));
  const expected = waist.bones['NPC Spine1 [Spn1]'].x * fat.bones['NPC Spine1 [Spn1]'].x;
  assert.ok(close(both.bones['NPC Spine1 [Spn1]'].x, expected, 1e-12));
}

// 7. Every bone name this module writes must exist in the skeleton tables that
//    applySkeletonWeight resolves against, or the scale is a silent no-op.
const known = new Set([
  ...Object.keys(XP32_CANONICAL_PARENTS),
  ...Object.keys(SKELETON_WEIGHT_SCALES),
  ...scale.BODY_SCALE_BONES,
]);
for (const bone of scale.BODY_SCALE_BONES) {
  assert.ok(known.has(bone), `${bone} is not in XP32_CANONICAL_PARENTS / SKELETON_WEIGHT_SCALES`);
}

// 8. The wired body ids flip to `wired`; the material stub does not leak.
for (const id of ['body.heightCm', 'body.headScale', 'body.fat', 'body.shoulderWidth',
  'body.chestSize', 'body.waistSize', 'body.hipWidth', 'body.armLength', 'body.legLength',
  'body.buttSize', 'body.thighWidth', 'body.belly']) {
  assert.equal(scale.hasBodyScale(id), true, id);
  assert.equal(params.ANATOMY_BY_ID[id].status, 'wired', id);
  assert.equal(params.ANATOMY_BY_ID[id].group, 'body', id);
}
assert.equal(scale.hasBodyScale('body.muscleDefinition'), false);
assert.equal(params.ANATOMY_BY_ID['body.muscleDefinition'].status, 'stored-only');
assert.equal(params.ANATOMY_BY_ID['body.headScale'].default, 50);
assert.equal(params.ANATOMY_BY_ID['body.heightCm'].default, 170);
assert.ok(validate.coerceAnatomy({ 'body.headScale': 999 })['body.headScale'] === 100);

// 9. Actual baked axes, when the pack is present: chain length is local +Z, so
//    the limb rules must target Z and never Y. Skipped without the asset.
/* Generated assets are gitignored, so an isolated worktree checkout may not
   have them; fall back to the main checkout three levels up
   (worktree → .claude/worktrees/x → .claude → repo). */
const meshRel = 'public/assets/preset-pack/meshes/bodyMesh-780aaed8c4e146dd.json';
const meshPath = [root, path.resolve(root, '..', '..', '..')]
  .map(base => path.join(base, meshRel))
  .find(candidate => fs.existsSync(candidate));
if (meshPath) {
  const THREE = require('three');
  const mesh = JSON.parse(fs.readFileSync(meshPath, 'utf8'));
  const byName = new Map(mesh.bones.map(b => [b.name, b]));
  const world = (name) => {
    const w = byName.get(name).world;
    return new THREE.Matrix4().set(w[0], w[1], w[2], w[3], w[4], w[5], w[6], w[7], w[8], w[9], w[10], w[11], 0, 0, 0, 1);
  };
  for (const [parent, child] of [
    ['NPC L UpperArm [LUar]', 'NPC L Forearm [LLar]'],
    ['NPC L Thigh [LThg]', 'NPC L Calf [LClf]'],
    ['NPC L Clavicle [LClv]', 'NPC L UpperArm [LUar]'],
  ]) {
    const local = world(parent).clone().invert().multiply(world(child));
    const offset = new THREE.Vector3().setFromMatrixPosition(local);
    assert.ok(Math.abs(offset.z) > 1 && Math.abs(offset.y) < 1e-3 && Math.abs(offset.x) < 1e-3,
      `${parent}→${child} length must be local +Z (got ${offset.toArray().map(v => v.toFixed(3))})`);
  }
  const limbRules = scale.BODY_SCALE_RULES.filter(r => r.param === 'body.armLength' || r.param === 'body.legLength');
  for (const rule of limbRules) assert.deepEqual([...rule.axes], ['z'], `${rule.bone} must scale Z`);
  console.log('✓ Baked axes: limb chains run along local +Z; length rules target Z');
} else {
  console.log('· Baked-axis check skipped (preset pack assets not generated in this checkout)');
}

console.log('PASS: neutral identity, height ratio, slider direction/clamps, composition, bone-name coverage, wired status');
console.log('NOT ASSESSED: rendered proportions, GPU skinning appearance, in-scene foot planting');
