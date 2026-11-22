// Run: node scripts/check_smart_import.cjs (no Python / browser required).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const cache = new Map();
const stored = new Map();
function load(name) {
  const file = path.join(root, name + '.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, console, crypto: webcrypto, Float32Array, Uint16Array, window: {},
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    require: id => id.startsWith('@/') ? load(id.slice(2)) : require(id),
  }, { filename: file });
  return module.exports;
}
const { validateSculptPayload, validateFitMetrics, CANONICAL_HEAD_URL } = load('lib/head/sculptPayload');
const payload = () => ({ name: 'fixture', morphs: { custom: [], sculptDivisor: 10000,
  sculpt: [{ host: '!UBE\\Head\\femaleHeadCharGen.tri', vertices: 11498, data: [[100, 1, 2, 3]] }] } });
assert.equal(validateSculptPayload(payload()).ok, true);
for (const mutate of [
  p => { p.morphs.sculpt[0].host = 'Vanilla.tri'; },
  p => { p.morphs.sculpt[0].vertices = 996; },
  p => { p.morphs.sculptDivisor = 0; },
  p => { p.morphs.sculptDivisor = Infinity; },
  p => { p.morphs.sculpt[0].data[0][0] = 11498; },
  p => { p.morphs.sculpt[0].data[0][0] = -1; },
  p => { p.morphs.sculpt[0].data[0][1] = NaN; },
  p => { p.morphs.sculpt[0].data[0][1] = 0.5; },
  p => { p.morphs.sculpt[0].data[0][1] = 100000; },
  p => { p.morphs.sculpt[0].data.push([100, 0, 0, 0]); },
]) {
  const p = payload(); mutate(p);
  assert.equal(validateSculptPayload(p).ok, false);
}
const metrics = { approximate: true, alignment_rms_m: 0.002, fit_strength: 0.5,
  face_surface_rms_m: 0.001, face_coverage_15mm: 1, max_displacement_m: 0.003,
  quality: { collar_max_displacement_m: 0, protected_max_displacement_m: 0, likeness_approved: false } };
assert.equal(validateFitMetrics({ ...metrics, output: 'private/path' }).output, undefined);
assert.throws(() => validateFitMetrics({ ...metrics, face_coverage_15mm: 0.5 }));
assert.throws(() => validateFitMetrics({ ...metrics, quality: { ...metrics.quality, collar_max_displacement_m: 0.001 } }));

async function run() {
  const { SMART_ACCEPT, isObjFile, isImageFile, isUnsupportedMeshFile } = load('lib/smart/smartMode');
  assert.ok(SMART_ACCEPT.includes('.obj') && !SMART_ACCEPT.includes('.glb'));
  assert.equal(isObjFile('head.OBJ'), true);
  assert.equal(isObjFile('head.glb'), false);
  assert.equal(isUnsupportedMeshFile('head.gltf'), true);
  assert.equal(isImageFile('face.JPG'), true);
  const { frontEdges } = load('lib/smart/retarget');
  const edges = frontEdges(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), [0, 1, 2], 132);
  assert.ok(edges.length > 0 && edges.every(value => Number.isFinite(value) && value >= 0 && value <= 132));

  const base = JSON.parse(fs.readFileSync(path.join(root, 'public', CANONICAL_HEAD_URL), 'utf8'));
  const pristine = JSON.stringify(base);
  const sculpt = load('lib/head/dynamicSculpt');
  sculpt.registerBaseMesh(CANONICAL_HEAD_URL, base);
  const neutral = payload(); neutral.morphs.sculpt[0].data = [];
  const option = await sculpt.replaySculptPayload(neutral, 'neutral.jslot');
  assert.equal(option.origin, 'sculpt-replay');
  assert.equal(option.shapes.vertexCount, 11498);
  assert.equal(JSON.stringify(base), pristine, 'Replay must not mutate the base');
  assert.ok(sculpt.getDynamicSculptHeads().some(head => head.id === option.id));
  sculpt.addDynamicHeadOption({ ...option, id: 'unrelated-persisted-head' });
  assert.ok(!stored.get('lyra.dynamic-head-options').includes(option.id), 'Smart preview must not persist');
  sculpt.removeDynamicHeadOption(option.id);
  assert.ok(!sculpt.getDynamicSculptHeads().some(head => head.id === option.id));
  assert.equal(sculpt.getDynamicMesh(option.meshUrl), undefined);
  const { NECK_SEAM_HEAD_INDICES } = load('lib/head/neckDeltas');
  const moved = payload(); moved.morphs.sculpt[0].data = [[NECK_SEAM_HEAD_INDICES[0], 100, 0, 0]];
  await assert.rejects(sculpt.replaySculptPayload(moved, 'bad.jslot'), /protected neck/);
  const badBase = { ...base, indices: [...base.indices] };
  [badBase.indices[0], badBase.indices[1]] = [badBase.indices[1], badBase.indices[0]];
  sculpt.registerBaseMesh(CANONICAL_HEAD_URL, badBase);
  await assert.rejects(sculpt.replaySculptPayload(neutral, 'bad-base.jslot'), /topology/);
  console.log('Smart OBJ guards, metrics, strict replay, rollback cleanup and transient storage checks passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
