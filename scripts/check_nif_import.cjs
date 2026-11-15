// Run: node scripts/check_nif_import.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const THREE = require('three');

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
      THREE,
      Float32Array,
      require: (id) => {
        if (id === 'three') return THREE;
        if (id.startsWith('@/')) return load(id.slice(2));
        if (id.startsWith('.')) {
          const rel = path.relative(root, path.resolve(path.dirname(file), id)).split(path.sep).join('/');
          return load(rel);
        }
        return require(id);
      },
    },
    { filename: file },
  );
  return module.exports;
}

const { registerDynamicMesh, getDynamicSculptHeads } = load('lib/head/dynamicSculpt');
const { resolveManifest, sculptHeadFor, assetOptions } = load('lib/manifestSelect');
const { meshDataToGeometry } = load('components/scene/useMeshGeometry');
const { parsePreset, payloadFromMorphs } = load('lib/presetIO');

async function run() {
  console.log('--- 1. Testing RaceMenu SSE NIF Python Decoder ---');
  const sampleNif = 'D:/Games/Skyrim/MO2_Archive/mods/All My UBE Preset/SKSE/Plugins/CharGen/Frau.nif';
  
  if (fs.existsSync(sampleNif)) {
    const tmpOut = path.join(root, 'node_modules/.tmp_test_nif.json');
    try {
      execFileSync('python', ['scripts/decode_nif.py', sampleNif, tmpOut], { cwd: root });
      const decoded = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
      assert.equal(decoded.ok, true, 'Decoder should report ok: true');
      assert.ok(decoded.head, 'Decoder should find head mesh');
      assert.ok(decoded.mouth, 'Decoder should find mouth mesh');
      assert.ok(decoded.eyes, 'Decoder should find eyes mesh');
      assert.ok(decoded.lashes, 'Decoder should find lashes mesh');
      assert.ok(decoded.brows, 'Decoder should find brows mesh');

      // Verify Three.js geometry construction from decoded buffers
      const headGeom = meshDataToGeometry(decoded.head);
      assert.equal(headGeom.positions.length / 3, 11498, 'Head should have 11,498 vertices');
      assert.ok(headGeom.geometry.getAttribute('position'));
      assert.ok(headGeom.geometry.getAttribute('normal'));
      assert.ok(headGeom.geometry.getAttribute('uv'));

      const mouthGeom = meshDataToGeometry(decoded.mouth);
      assert.ok(mouthGeom.positions.length > 0);

      const eyesGeom = meshDataToGeometry(decoded.eyes);
      assert.ok(eyesGeom.positions.length > 0);

      console.log('✓ Decoded Frau.nif with head (11498 verts), mouth, eyes, lashes, and brows');
    } finally {
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    }
  } else {
    console.log('ℹ MO2 Frau.nif not present at expected path, skipping raw NIF decode test');
  }

  console.log('--- 2. Testing Remiel .jslot Preset Color & Weight Extraction ---');
  const remielPath = 'C:/Users/kenko/Downloads/our beloved remiel/SKSE/Plugins/CharGen/Presets/UBE Our beloved Remiel.jslot';
  if (fs.existsSync(remielPath)) {
    const raw = fs.readFileSync(remielPath, 'utf8');
    const parsed = parsePreset(raw, 'UBE Our beloved Remiel.jslot');
    assert.equal(parsed.source, 'racemenu');
    assert.equal(parsed.weight, 1.0, 'Remiel weight should be 1.0');
    assert.equal(parsed.hair?.tone, '#4d3422', 'Remiel hair color should be warm brunette (#4d3422)');
    console.log(`✓ Remiel preset parsed: weight=${parsed.weight}, hairColor=${parsed.hair?.tone}`);
  }

  console.log('--- 3. Testing Dynamic NIF Option Registration & Manifest Resolution ---');
  const testOption = {
    id: 'dynamic-nif-test_head',
    mod: 'RaceMenu',
    rel: 'RaceMenu/Test.nif',
    file: 'Test.nif',
    label: 'Test (Imported NIF)',
    meshUrl: 'dynamic://meshes/dynamic-nif-test_head.json',
    isRealMesh: true,
    sculptSource: 'Test.nif',
    origin: 'racemenu-export',
    bytes: 12345,
    version: 'BSDynamicTriShape',
    nodes: [],
    shapes: { vertexCount: 11498, triangleCount: 22044 },
    eyeMeshUrl: 'dynamic://meshes/dynamic-nif-test_head-eyes.json',
    lashesMeshUrl: 'dynamic://meshes/dynamic-nif-test_head-lashes.json',
    browsMeshUrl: 'dynamic://meshes/dynamic-nif-test_head-brows.json',
    mouthMeshUrl: 'dynamic://meshes/dynamic-nif-test_head-mouth.json',
  };

  getDynamicSculptHeads().unshift(testOption);

  const manifest = {
    available: true,
    source: 'preset-pack',
    sourceLayout: 'pack',
    assets: {
      headMesh: [
        {
          id: 'baked-default-head',
          mod: 'pack',
          file: 'Default.jslot',
          label: 'Default Head',
          meshUrl: '/assets/preset-pack/meshes/headMesh-96612a53f30f4e56.json',
          isRealMesh: true,
          sculptSource: 'Default.jslot'
        }
      ]
    }
  };

  const resolved = resolveManifest(manifest, { headMesh: testOption.id });
  assert.equal(resolved.headMesh.meshUrl, 'dynamic://meshes/dynamic-nif-test_head.json');
  assert.equal(resolved.headMesh.eyeMeshUrl, 'dynamic://meshes/dynamic-nif-test_head-eyes.json');
  assert.equal(resolved.headMesh.lashesMeshUrl, 'dynamic://meshes/dynamic-nif-test_head-lashes.json');
  assert.equal(resolved.headMesh.browsMeshUrl, 'dynamic://meshes/dynamic-nif-test_head-brows.json');
  assert.equal(resolved.headMesh.mouthMeshUrl, 'dynamic://meshes/dynamic-nif-test_head-mouth.json');
  console.log('✓ Dynamic NIF head and companions resolved properly by resolveManifest');

  console.log('--- 4. Testing sculptHeadFor Stem Matching Across (.jslot / .nif) ---');
  const matched = sculptHeadFor(manifest, 'Test.jslot');
  assert.ok(matched, 'Should match Test.jslot to Test.nif via stem');
  assert.equal(matched.id, testOption.id);
  console.log(`✓ sculptHeadFor matched Test.jslot to ${matched.file}`);

  console.log('====================================');
  console.log(' ALL NIF & PRESET IMPORT CHECKS PASS! ');
  console.log('====================================');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
