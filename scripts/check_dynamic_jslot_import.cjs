// Run: node scripts/check_dynamic_jslot_import.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

const { resolveOrBuildSculptHead, getDynamicMesh, registerBaseMesh } = load('lib/head/dynamicSculpt');
const { resolveManifest, assetOptions } = load('lib/manifestSelect');
const { meshDataToGeometry } = load('components/scene/useMeshGeometry');

// Load real UBE base head from public directory
const baseHeadJsonPath = path.join(root, 'public/assets/preset-pack/meshes/headMesh-96612a53f30f4e56.json');
const baseHead = JSON.parse(fs.readFileSync(baseHeadJsonPath, 'utf8'));

// Register base mesh into cache so resolveOrBuildSculptHead can find it without network
registerBaseMesh('/assets/preset-pack/meshes/headMesh-96612a53f30f4e56.json', baseHead);

// Mock external .jslot with sculpt deltas
const mockJslot = {
  name: "MyExternalCharacter",
  morphs: {
    sculptDivisor: 10000,
    sculpt: [
      {
        host: "femaleheadchargen.tri",
        vertices: 11498,
        data: [
          [100, 1500, 2000, 1200],
          [200, -800, 400, 950],
          [500, 0, -1200, 600]
        ]
      }
    ],
    custom: [
      { name: "NoseLength", value: 0.5 }
    ]
  }
};

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

async function runTest() {
  console.log('Testing dynamic .jslot sculpt generation...');
  const headOption = await resolveOrBuildSculptHead(manifest, JSON.stringify(mockJslot), 'MyExternalCharacter.jslot');
  
  assert.ok(headOption, 'Should generate a dynamic head option');
  assert.equal(headOption.sculptSource, 'MyExternalCharacter.jslot');
  assert.equal(headOption.origin, 'sculpt-replay');
  assert.ok(headOption.meshUrl.startsWith('dynamic://meshes/'));
  assert.equal(headOption.shapes.vertexCount, 11498);

  // Verify dynamic mesh is stored in cache
  const dynamicMesh = getDynamicMesh(headOption.meshUrl);
  assert.ok(dynamicMesh, 'Dynamic mesh must be retrievable from dynamic cache');
  assert.equal(dynamicMesh.positions.length, baseHead.positions.length);

  // Verify vertex delta displacement
  const scale = 0.01288 / 10000;
  // Vertex 100: [100, 1500, 2000, 1200] -> X: +1500, Y: +1200, Z: +2000
  const origX = baseHead.positions[100 * 3 + 0];
  const origY = baseHead.positions[100 * 3 + 1];
  const origZ = baseHead.positions[100 * 3 + 2];
  const newX = dynamicMesh.positions[100 * 3 + 0];
  const newY = dynamicMesh.positions[100 * 3 + 1];
  const newZ = dynamicMesh.positions[100 * 3 + 2];

  assert.ok(Math.abs(newX - (origX + 1500 * scale)) < 1e-4, 'X displaced correctly');
  assert.ok(Math.abs(newY - (origY + 1200 * scale)) < 1e-4, 'Y displaced correctly');
  assert.ok(Math.abs(newZ - (origZ + 2000 * scale)) < 1e-4, 'Z displaced correctly');

  // Verify assetOptions prepends dynamic heads
  const options = assetOptions(manifest, 'headMesh');
  assert.equal(options[0].id, headOption.id, 'Dynamic head must be prepended to headMesh options');

  // Verify resolveManifest resolves the dynamic head
  const resolved = resolveManifest(manifest, { headMesh: headOption.id });
  assert.equal(resolved.headMesh.meshUrl, headOption.meshUrl);

  // Verify meshDataToGeometry decodes the dynamic mesh into THREE.BufferGeometry
  const loaded = meshDataToGeometry(dynamicMesh);
  assert.ok(loaded.geometry instanceof THREE.BufferGeometry);
  assert.equal(loaded.geometry.getAttribute('position').count, 11498);
  assert.equal(loaded.geometry.getAttribute('normal').count, 11498);

  console.log('✓ All dynamic .jslot import tests passed successfully!');
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
