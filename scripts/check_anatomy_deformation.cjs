// Run: node scripts/check_anatomy_deformation.cjs [optional pack-head JSON path]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const THREE = require('three');
const root = path.resolve(__dirname, '..'), cache = new Map();
function load(name) {
  const file = path.join(root, name + '.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, console, process, URLSearchParams,
    require: id => id.startsWith('@/') ? load(id.slice(2)) : require(id),
  }, { filename: file });
  return module.exports;
}
const { ANATOMY_BINDINGS, anatomySliderBank } = load('lib/anatomy/bind');
const { coerceAnatomy } = load('lib/anatomy/validate');
const { REGIONS, SLIDER_DEFS, SLIDERS_BY_ID } = load('lib/regions');
const { createRig, poseRegionBone, skinPoint, REGION_BONES, verifyRigWiring } = load('lib/head/rig');
const { NECK_SEAM_HEAD_INDICES } = load('lib/head/neckDeltas');
const plain = v => JSON.parse(JSON.stringify(v));
const neutral = coerceAnatomy();
assert.equal(Object.keys(ANATOMY_BINDINGS).length, 7);
assert.equal(new Set(Object.values(ANATOMY_BINDINGS).map(b => `${b.region}:${b.slider}`)).size, 7, 'bindings must not overwrite the same channel');
const pose = { offset: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] };
function evaluate(rig, values) {
  for (const region of REGIONS) {
    const bank = anatomySliderBank(region.id, values, region.defaults);
    for (const key of rig.regionBoneKeys[region.id]) poseRegionBone(rig, key, region.id, SLIDER_DEFS, bank, pose);
  }
  rig.root.updateMatrixWorld(true);
  rig.skeleton.update();
  return Array.from({ length: rig.bindData.basePosition.length / 3 }, (_, i) => skinPoint(rig, i, new THREE.Vector3()));
}
for (const region of REGIONS) {
  assert.deepEqual(plain(anatomySliderBank(region.id, neutral, region.defaults)), plain(region.defaults), 'neutral preserves existing face');
}
for (const [id, binding] of Object.entries(ANATOMY_BINDINGS)) {
  for (const value of [-900, 0, 25, 50, 75, 100, 900, NaN]) {
    const region = REGIONS.find(r => r.id === binding.region);
    const original = plain(region.defaults);
    const bank = anatomySliderBank(region.id, { ...neutral, [id]: value }, region.defaults);
    assert.deepEqual(plain(region.defaults), original, 'binding must not mutate legacy bank');
    for (const d of SLIDER_DEFS) {
      assert.ok(Number.isFinite(bank[d.id]) && bank[d.id] >= d.min && bank[d.id] <= d.max);
      if (d.id !== binding.slider) assert.equal(bank[d.id], original[d.id], 'unrelated channel unchanged');
    }
  }
}
function checkGeometry(geometry, seam, label) {
  const rig = createRig(geometry);
  assert.equal(verifyRigWiring(rig).length, 0);
  const baseline = evaluate(rig, neutral);
  const positions = geometry.getAttribute('position');
  for (const [id, binding] of Object.entries(ANATOMY_BINDINGS)) {
    let probe = -1, weight = 0;
    const boneIndices = rig.regionBoneKeys[binding.region].map(key => rig.skeleton.bones.indexOf(rig.bones[key]));
    for (let i = 0; i < positions.count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) if (boneIndices.includes(rig.bindData.skinIndex[i * 4 + k])) sum += rig.bindData.skinWeight[i * 4 + k];
      const lever = binding.slider === 'width' ? positions.getX(i) :
        binding.slider === 'length' ? positions.getY(i) - REGION_BONES.find(r => r.region === binding.region).pivot[1] : 1;
      if (sum * Math.abs(lever) > weight) { weight = sum * Math.abs(lever); probe = i; }
    }
    assert.ok(probe >= 0 && weight > 0, `${label}: ${id} has influenced vertices`);
    const axis = binding.slider === 'width' ? 'x' : 'y';
    const samples = [];
    let maximum = 0;
    for (const value of [0, 25, 50, 75, 100]) {
      const points = evaluate(rig, { ...neutral, [id]: value });
      for (let i = 0; i < points.length; i++) {
        assert.ok(points[i].toArray().every(Number.isFinite), `${id}: finite positions`);
        maximum = Math.max(maximum, points[i].distanceTo(baseline[i]));
        // Vertices rigid on the head must never be moved by a facial parameter.
        if (rig.bindData.skinIndex[i * 4] === 0 && rig.bindData.skinWeight[i * 4] === 1) {
          assert.ok(points[i].distanceTo(baseline[i]) < 1e-7, `${id}: rigid vertex moved`);
        }
      }
      for (const i of seam) assert.ok(points[i].distanceTo(baseline[i]) < 0.00002, `${id}: canonical neck seam moved`);
      const cpu = rig.mesh.applyBoneTransform(probe, new THREE.Vector3().fromBufferAttribute(positions, probe));
      assert.ok(cpu.distanceTo(points[probe]) < 1e-6, `${id}: CPU skin mirror disagrees with Three.js`);
      samples.push(points[probe][axis]);
    }
    assert.ok(maximum > 1e-6, `${id}: no geometry movement`);
    const sign = Math.sign(samples.at(-1) - samples[0]);
    assert.notEqual(sign, 0, `${id}: no primary-axis movement`);
    for (let i = 1; i < samples.length; i++) assert.ok(sign * (samples[i] - samples[i - 1]) >= -1e-8, `${id}: non-monotonic response`);
    assert.ok(maximum < 0.02, `${id}: unexpected displacement above 20mm`);
    console.log(`PASS ${label}: ${id}, max ${(maximum * 1000).toFixed(3)}mm; seam/finite/monotonic/CPU mirror`);
  }
  // Synthetic geometry includes explicit mirrored pairs with identical rest height/depth.
  if (label === 'synthetic') {
    const values = { ...neutral };
    for (const id of Object.keys(ANATOMY_BINDINGS)) values[id] = 100;
    const points = evaluate(rig, values);
    for (let i = 0; i < points.length - 2; i += 2) {
      const left = points[i].clone().sub(baseline[i]), right = points[i + 1].clone().sub(baseline[i + 1]);
      assert.ok(Math.abs(left.x + right.x) < 1e-6 && Math.abs(left.y - right.y) < 1e-6 && Math.abs(left.z - right.z) < 1e-6, 'mirrored response');
    }
  }
  rig.dispose();
}
const synthetic = [];
for (const field of REGION_BONES) {
  const [x, y, z] = field.influence;
  for (const [dx, dy] of [[0.008, 0], [0.015, 0.008], [0.02, -0.008]]) {
    const px = Math.abs(x) + dx;
    synthetic.push(px, y + dy, z, -px, y + dy, z);
  }
}
synthetic.push(0.02, -0.13, 0, -0.02, -0.13, 0);
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(synthetic, 3));
geometry.computeVertexNormals();
checkGeometry(geometry, [synthetic.length / 3 - 2, synthetic.length / 3 - 1], 'synthetic');
const fixture = path.resolve(root, process.argv[2] || 'public/assets/preset-pack/meshes/headMesh-96612a53f30f4e56.json');
if (fs.existsSync(fixture)) {
  const data = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  assert.equal(data.positions.length / 3, 11761, 'canonical seam fixture must be the UBE base head');
  const pack = new THREE.BufferGeometry();
  pack.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  pack.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  pack.setIndex(data.indices);
  checkGeometry(pack, Array.from(NECK_SEAM_HEAD_INDICES), 'pack head');
} else {
  console.log('NOT ASSESSED: real pack head fixture missing; synthetic geometry only');
}
console.log('NOT ASSESSED: rendered appearance, GPU shader agreement, facial-part intersections, panel layout, aesthetic endpoint quality');
