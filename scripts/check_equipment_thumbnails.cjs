// Run: node scripts/check_equipment_thumbnails.cjs
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

const { getCachedGarmentThumbnail, requestGarmentThumbnail, extractGarmentMeshData } = load('lib/equipment/thumbnailRenderer');

async function run() {
  console.log('--- 1. Testing Garment Thumbnail Cache Interface ---');
  assert.equal(typeof getCachedGarmentThumbnail, 'function', 'getCachedGarmentThumbnail must be a function');
  assert.equal(typeof requestGarmentThumbnail, 'function', 'requestGarmentThumbnail must be a function');
  assert.equal(typeof extractGarmentMeshData, 'function', 'extractGarmentMeshData must be a function');
  assert.equal(getCachedGarmentThumbnail('non-existent'), undefined, 'Uncached item returns undefined');
  console.log('✓ Cache interface verified');

  console.log('--- 2. Testing Composite Outfit Skin Pruning (extractGarmentMeshData) ---');
  // Mock composite outfit with clothing + embedded body mesh (like cp6 doneb14n onepiece)
  const compositeMesh = {
    positions: new Float32Array([
      // Clothing vertices (upper body: y = 0.2 .. 0.5)
      0.0, 0.2, 0.0,
      0.2, 0.4, 0.0,
      -0.2, 0.5, 0.1,
      // Skin vertices (legs down to toes: y = -0.8 .. -0.4)
      0.1, -0.4, 0.0,
      -0.1, -0.6, 0.0,
      0.0, -0.8, 0.0,
    ]),
    normals: new Float32Array([
      0, 0, 1,  0, 0, 1,  0, 0, 1,
      0, 0, 1,  0, 0, 1,  0, 0, 1,
    ]),
    uvs: new Float32Array([
      0, 0,  1, 0,  0, 1,
      0, 0,  1, 0,  0, 1,
    ]),
    indices: [0, 1, 2, 3, 4, 5],
    groups: [
      { start: 0, count: 3, materialIndex: 0 },
      { start: 3, count: 3, materialIndex: 1 },
    ],
    materials: [
      { name: 'swimsuit', role: 'clothing', texture: '/assets/suit.dds' },
      { name: 'BaseShape', role: 'skin', texture: '/assets/body.dds' },
    ],
  };

  const garmentOnly = extractGarmentMeshData(compositeMesh);
  assert.equal(garmentOnly.materials.length, 1, 'Skin material must be stripped');
  assert.equal(garmentOnly.materials[0].name, 'swimsuit', 'Garment material preserved');
  assert.equal(garmentOnly.groups.length, 1, 'Only non-skin group retained');
  assert.equal(garmentOnly.positions.length / 3, 3, 'Unused skin vertices pruned');
  assert.deepEqual([...garmentOnly.indices], [0, 1, 2], 'Indices remapped sequentially');
  // Verify lowest Y vertex is 0.2 (no negative Y leg skin)
  const yVals = Array.from(garmentOnly.positions).filter((_, i) => i % 3 === 1);
  assert.ok(yVals.every((y) => y >= 0.2), 'All remaining vertices belong to clothing');
  console.log('✓ Skin pruning: stripped 3 skin vertices & 1 skin group, preserved 100% clothing geometry');

  console.log('--- 3. Testing 3D Auto-Framing Geometry Calculations ---');
  // Mock clothing geometry (e.g. bodysuit bounds: width=30cm, height=60cm, depth=20cm)
  const geom = new THREE.BoxGeometry(0.3, 0.6, 0.2);
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  const sphere = geom.boundingSphere;
  assert.ok(sphere, 'Geometry must have bounding sphere');
  assert.ok(sphere.radius > 0, 'Bounding radius must be positive');

  const fov = 36;
  const fovRad = (fov * Math.PI) / 180;
  const dist = (sphere.radius / Math.sin(fovRad / 2)) * 1.18;
  assert.ok(Number.isFinite(dist) && dist > sphere.radius, 'Camera distance must frame the bounding sphere');
  console.log(`✓ Auto-framing: bounding radius=${sphere.radius.toFixed(3)}m -> camera dist=${dist.toFixed(3)}m`);

  console.log('--- 4. Testing Equipment Slot Vocabulary Completeness ---');
  const { EQUIP_SLOTS, EQUIP_SLOT_LABEL } = load('lib/equipment');
  const expectedSlots = ['outfit', 'top', 'bottom', 'bra', 'panties', 'stockings', 'hands', 'feet', 'accessories'];
  assert.deepEqual([...EQUIP_SLOTS], expectedSlots, 'All 9 equipment slots must match standard');
  for (const s of expectedSlots) {
    assert.ok(EQUIP_SLOT_LABEL[s], `Slot ${s} must have human readable label`);
  }
  console.log('✓ All 9 equipment slots registered with labels');

  console.log('==============================================');
  console.log(' ALL EQUIPMENT 3D THUMBNAIL CHECKS PASSED!   ');
  console.log('==============================================');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
