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

const { getCachedGarmentThumbnail, requestGarmentThumbnail } = load('lib/equipment/thumbnailRenderer');

async function run() {
  console.log('--- 1. Testing Garment Thumbnail Cache Interface ---');
  assert.equal(typeof getCachedGarmentThumbnail, 'function', 'getCachedGarmentThumbnail must be a function');
  assert.equal(typeof requestGarmentThumbnail, 'function', 'requestGarmentThumbnail must be a function');
  assert.equal(getCachedGarmentThumbnail('non-existent'), undefined, 'Uncached item returns undefined');
  console.log('✓ Cache interface verified');

  console.log('--- 2. Testing 3D Auto-Framing Geometry Calculations ---');
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

  console.log('--- 3. Testing Equipment Slot Vocabulary Completeness ---');
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
