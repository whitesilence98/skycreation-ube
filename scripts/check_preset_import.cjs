// Run: node scripts/check_preset_import.cjs
//
// Regression for the three defects that made a preset import look like a no-op:
//
//   1. `payloadFromMorphs` added the region default back on top of the morph
//      quotient, so `import(export(x)) !== x`.
//   2. `lips` and `jaw` shared one bone, so the jaw bank always overwrote the
//      lip bank and every imported lip morph vanished.
//   3. Nothing selected the `headMesh` whose sculpt was baked from the imported
//      `.jslot`, which is where a real RaceMenu face actually lives.
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
  const module = { exports: {} };
  cache.set(file, module);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    {
      module,
      exports: module.exports,
      console,
      process,
      URLSearchParams,
      require: (id) => (id.startsWith('@/') ? load(id.slice(2)) : require(id)),
    },
    { filename: file },
  );
  return module.exports;
}

const io = load('lib/presetIO');
const regions = load('lib/regions');
const sel = load('lib/manifestSelect');

// ── 1. morph <-> slider round trip ─────────────────────────────────
const bank = Object.fromEntries(
  regions.REGIONS.map((r) => [
    r.id,
    {
      // In-range values that are NOT the region default, so a stray `+ default`
      // or a wrong unit factor shows up in the assertion below.
      sliders: Object.fromEntries(
        regions.SLIDER_DEFS.map((d, i) => [d.id, Math.round((d.min + (d.max - d.min) * (0.3 + 0.1 * (i % 5))) / d.step) * d.step]),
      ),
      pose: { offset: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] },
    },
  ]),
);
const morphs = io.toRaceMenuMorphs(bank);
assert.ok(morphs.length > 0, 'export must produce morphs');
const back = io.payloadFromMorphs(morphs);
for (const r of regions.REGIONS) {
  for (const d of regions.SLIDER_DEFS) {
    const want = bank[r.id].sliders[d.id];
    const got = back.regions[r.id].sliders[d.id];
    assert.ok(
      Math.abs(want - got) <= d.step / 2 + 1e-9,
      `round trip ${r.id}.${d.id}: exported ${want}, imported ${got}`,
    );
  }
}
console.log('morph round trip: ok');

// A preset authored at 0 must import at 0, not at the region default.
const zero = io.payloadFromMorphs([{ name: 'BF_Nose_TipHeight', value: 0 }]);
assert.equal(zero.regions.nose.sliders.length, 0, 'morph 0 must mean slider 0');

// ── 2. lips and jaw are separate bones ─────────────────────────────
const rigMod = load('lib/head/rig');
assert.equal(regions.REGIONS_BY_ID.lips.bone, 'Lips');
assert.equal(regions.REGIONS_BY_ID.jaw.bone, 'Jaw');
assert.notDeepEqual(
  rigMod.regionPivot('lips'),
  rigMod.regionPivot('jaw'),
  'lips and jaw must not share a pivot',
);

// Build a real rig and prove both regions move the mesh independently.
const geometry = new (require('three').BufferGeometry)();
// Minimal triangle strip is enough: createRig only needs a position attribute.
const geoCheck = load('lib/head/geometry');
const built = geoCheck.buildHeadGeometry();
const rig = rigMod.createRig(built.geometry);
/* `verifyRigWiring` returns an array built inside the vm realm, so compare its
   contents rather than its prototype. */
const wiring = rigMod.verifyRigWiring(rig);
assert.equal(Array.from(wiring).length, 0, `rig wiring must be clean: ${wiring.join('; ')}`);
assert.equal(rig.regionBoneKeys.lips.join(), 'Lips');
assert.equal(rig.regionBoneKeys.jaw.join(), 'Jaw');
assert.ok(rig.bones.Lips && rig.bones.Jaw && rig.bones.Lips !== rig.bones.Jaw);

const pose = (regionId, values) => {
  for (const key of rig.regionBoneKeys[regionId]) {
    rigMod.poseRegionBone(rig, key, regionId, regions.SLIDER_DEFS, values, {
      offset: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0],
    });
  }
  rig.root.updateMatrixWorld(true);
};
const neutral = Object.fromEntries(regions.SLIDER_DEFS.map((d) => [d.id, 0]));
const maxLip = Object.fromEntries(regions.SLIDER_DEFS.map((d) => [d.id, d.max]));

const sample = () => {
  let m = 0;
  for (let i = 0; i < built.basePositions.length / 3; i += 7) {
    const p = new (require('three').Vector3)();
    rigMod.skinPoint(rig, i, p);
    const dx = p.x - built.basePositions[i * 3];
    const dy = p.y - built.basePositions[i * 3 + 1];
    const dz = p.z - built.basePositions[i * 3 + 2];
    m = Math.max(m, Math.hypot(dx, dy, dz));
  }
  return m * 1000; // mm
};

pose('lips', neutral);
pose('jaw', neutral);
const rest = sample();
assert.ok(rest < 0.05, `neutral pose must not displace the mesh (${rest.toFixed(3)} mm)`);

pose('lips', maxLip);
const lipsMm = sample();
// The defect being guarded: with one shared bone, jaw was posed after lips and
// every lip slider was overwritten, so this measured exactly 0.0000 mm.
assert.ok(lipsMm > 0.5, `lips sliders must deform the mesh (${lipsMm.toFixed(2)} mm)`);

/* The structural half of the same defect. Before the split, `lips` and `jaw`
   resolved to one THREE.Bone, so posing the jaw literally rewrote the lip
   matrix. Assert the two poses are now independent, rather than inferring it
   from a global displacement maximum that a saturated vertex can mask. */
pose('lips', neutral);
pose('jaw', neutral);
rig.root.updateMatrixWorld(true);
const lipsAtRest = rig.bones.Lips.matrixWorld.clone();

pose('lips', maxLip);
rig.root.updateMatrixWorld(true);
const lipsPosed = rig.bones.Lips.matrixWorld.clone();
assert.ok(!lipsAtRest.equals(lipsPosed), 'the lips bone must actually pose');

pose('jaw', maxLip);
rig.root.updateMatrixWorld(true);
assert.ok(
  rig.bones.Lips.matrixWorld.equals(lipsPosed),
  'posing the jaw must leave the lips bone untouched',
);

const jawMm = sample();
assert.ok(jawMm > 0.5, `jaw sliders must deform the mesh (${jawMm.toFixed(2)} mm)`);
console.log(`lips ${lipsMm.toFixed(2)} mm, jaw ${jawMm.toFixed(2)} mm, separate bones: ok`);

// ── 3. a preset resolves to its baked head ─────────────────────────
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/mo2/manifest.json'), 'utf8'));
for (const p of manifest.assets.preset) {
  const head = sel.sculptHeadFor(manifest, p.file);
  if (p.sculpt && p.sculpt.vertexCount === 11498 && p.morphs.length) {
    assert.ok(head, `${p.file} should resolve to a baked head`);
    assert.equal(head.sculptSource, p.file);
  }
}
const frau = sel.sculptHeadFor(manifest, 'Frau.jslot');
assert.ok(frau && frau.meshUrl, 'Frau.jslot must resolve');
assert.equal(sel.sculptHeadFor(manifest, 'Nope.jslot'), undefined, 'unknown preset resolves to nothing');
assert.equal(sel.sculptHeadFor(manifest, undefined), undefined, 'no filename resolves to nothing');
// Stem match for a LYRA export that records only the preset name.
assert.ok(sel.sculptHeadFor(manifest, 'Frau'), 'stem match must work for exports');
console.log('preset -> baked head: ok');

// ── 4. loadPreset selects that head, and only when asked ───────────
const { useCharacter } = load('lib/store');
const store = () => useCharacter.getState();
store().setAssets({ headMesh: 'user-picked' });
store().loadPreset(io.payloadFromMorphs([{ name: 'BF_Nose_TipHeight', value: 1.5 }]), frau.id);
assert.equal(store().assetSelection.headMesh, frau.id, 'import must select the baked head');
assert.equal(store().sliders.nose.length, 1.5 / 0.3, 'slider must follow the morph exactly');

store().setAssets({ headMesh: 'user-picked' });
store().loadPreset(io.payloadFromMorphs([{ name: 'BF_Nose_TipHeight', value: 1.5 }]), undefined);
assert.equal(store().assetSelection.headMesh, 'user-picked', 'no baked head leaves the head alone');

const withAssets = io.parsePreset(JSON.stringify({
  format: io.PRESET_FORMAT, version: 2, name: 'x',
  regions: Object.fromEntries(regions.REGIONS.map((r) => [r.id, {
    sliders: r.defaults, pose: { offset: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] },
  }])),
  assets: { headMesh: 'from-file' },
}));
store().loadPreset(withAssets, frau.id);
assert.equal(store().assetSelection.headMesh, 'from-file', 'an explicit selection in the file wins');
console.log('loadPreset head selection: ok');

// ── 5. a .jslot basename reaches the payload ────────────────────────
const jslot = JSON.stringify({ name: 'ignored', morphs: { custom: [{ name: 'BF_Nose_TipHeight', value: 0.9 }], sculpt: [], sculptDivisor: 10000 } });
assert.equal(io.parsePreset(jslot, 'Frau.jslot').sourceFile, 'Frau.jslot');
console.log('jslot filename captured: ok');
for (const weight of [0, 1, 25, 100]) {
  assert.equal(io.payloadFromMorphs([], { actorWeight: weight }).weight, weight / 100);
  assert.equal(io.parsePreset(JSON.stringify({ morphs: { custom: [] }, actor: { weight } })).weight, weight / 100);
}
assert.equal(io.payloadFromMorphs([], { actorWeight: 101 }).weight, undefined);
console.log('RaceMenu actor weight: ok');

// An exported face already contains its morphs: every synthetic bone starts neutral.
const exact = io.payloadFromMorphs([], { baked: true });
for (const region of Object.values(exact.regions)) {
  assert.ok(Object.values(region.sliders).every((v) => v === 0), 'exported face must not be deformed twice');
}
const packManifest = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/preset-pack/manifest.json'), 'utf8'));
if (packManifest.assets.preset.some((p) => p.file)) {
  for (const preset of packManifest.assets.preset) {
    if (!['racemenu-export', 'sculpt-replay'].includes(preset.geometrySource)) continue;
    const head = sel.sculptHeadFor(packManifest, preset.file);
    assert.ok(head?.meshUrl, `${preset.file} must select a pack head`);
    const resolved = sel.resolveManifest(packManifest, { headMesh: head.id });
    assert.equal(resolved.headMesh.meshUrl, head.meshUrl);
    if (head.headTextureMissing) assert.equal(resolved.textures.skin, undefined);
  }
  console.log('pack preset selection and missing atlas: ok');
}
console.log('preset import: ok');
