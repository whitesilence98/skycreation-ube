const fs = require('fs');
const assert = require('assert');
const path = require('path');
const { performance } = require('perf_hooks');
const ts = require('typescript');
const THREE = require('three');

const moduleCache = {};
function loadTs(filePath) {
  const absPath = path.resolve(filePath);
  if (moduleCache[absPath]) return moduleCache[absPath].exports;

  const code = fs.readFileSync(absPath, 'utf8');
  const result = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const m = { exports: {} };
  moduleCache[absPath] = m;

  const customRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      if (specifier.endsWith('.json')) {
        const targetPath = path.resolve(path.dirname(absPath), specifier);
        const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        return { default: parsed, ...parsed, __esModule: true };
      }
      const targetPath = path.resolve(path.dirname(absPath), specifier.endsWith('.ts') ? specifier : specifier + '.ts');
      return loadTs(targetPath);
    }
    return require(specifier);
  };

  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', result.outputText);
  fn(customRequire, m, m.exports, absPath, path.dirname(absPath));
  return m.exports;
}

console.log('[Test 1] Loading osdParser, morphLoader, and applyMorphs...');
const osdParser = loadTs('lib/bodyslide/osdParser.ts');
const morphLoader = loadTs('lib/bodyslide/morphLoader.ts');
const applyMorphs = loadTs('lib/bodyslide/applyMorphs.ts');

const osdBuf = fs.readFileSync('public/assets/bodyslide/UBE SE 2.0 - Necoco Body.osd');
const osdData = osdParser.parseOsd(osdBuf);
console.log('  -> OSD blockCount:', osdData.blockCount);

const ospXml = fs.readFileSync('public/assets/bodyslide/UBE SE 2.0 - Necoco Body.osp', 'utf8');
const mappings = osdParser.parseOspXml(ospXml);
console.log('  -> OSP mappings count:', Object.keys(mappings).length);

const cache = JSON.parse(fs.readFileSync('public/assets/bodyslide/neco_morphs_cache.json', 'utf8'));
const cacheKeys = Object.keys(cache);
console.log('  -> Cache keys count:', cacheKeys.length);

const vertCount = 32512;
const basePositions = new Float32Array(vertCount * 3);
for (let i = 0; i < basePositions.length; i++) {
  basePositions[i] = (Math.random() - 0.5) * 100;
}
const targetPositions = new Float32Array(vertCount * 3);

console.log('[Test 2] Verifying all 236 cache morphs with applyBodySlideMorphs...');
let successCount = 0;
let failedMorphs = [];

for (const key of cacheKeys) {
  const singleSlider = { [key]: 50.0 };
  const applied = morphLoader.applyBodySlideMorphs(
    targetPositions,
    basePositions,
    singleSlider,
    mappings,
    osdData
  );

  if (applied) {
    successCount++;
  } else {
    failedMorphs.push(key);
  }
}

console.log(`  -> Successfully applied: ${successCount} / ${cacheKeys.length}`);
if (failedMorphs.length > 0) {
  console.error('  -> Failed morphs:', failedMorphs);
  process.exit(1);
}
assert.strictEqual(successCount, cacheKeys.length, 'Every cache morph must apply successfully');

console.log('[Test 3] Verifying clean names without BaseShape prefix...');
let cleanSuccess = 0;
for (const key of cacheKeys) {
  const cleanKey = key.replace(/^BaseShape/, '');
  const singleSlider = { [cleanKey]: 75.0 };
  const applied = morphLoader.applyBodySlideMorphs(
    targetPositions,
    basePositions,
    singleSlider,
    mappings,
    osdData
  );
  if (applied) cleanSuccess++;
}
console.log(`  -> Successfully applied clean names: ${cleanSuccess} / ${cacheKeys.length}`);
assert.strictEqual(cleanSuccess, cacheKeys.length, 'Every clean slider name must apply successfully');

console.log('[Test 4] Benchmarking CPU morph accumulation speed for real-time 60 FPS...');
// Test with 15 concurrent active sliders (typical heavy user customization)
const typicalNames = [
  'BreastsBigger', 'GluteSize p|n', 'BreastUnderCurve', 'PubicAreaSize p|n',
  'CalfUpperSize p|n', 'Amazon_abs', 'AnkleThickness p|n', 'SaggingBreastsZone',
  'Abs_creases', 'Thicc_calves', 'Belly_button_shape', 'AreolaeSizeBig',
  'BackValley', 'ChestUpperSize n|p', 'NippleInverted_PuffyAreola'
];
const testSliders = {};
for (const n of typicalNames) {
  testSliders[n] = 75.0;
}

// Warmup
for (let i = 0; i < 20; i++) {
  morphLoader.applyBodySlideMorphs(targetPositions, basePositions, testSliders, mappings, osdData);
}

const iterations = 100;
const start = performance.now();
for (let i = 0; i < iterations; i++) {
  morphLoader.applyBodySlideMorphs(targetPositions, basePositions, testSliders, mappings, osdData);
}
const totalMs = performance.now() - start;
const avgMs = totalMs / iterations;
console.log(`  -> 15 active morphs average frame time: ${avgMs.toFixed(3)} ms`);
assert.ok(avgMs < 1.0, `Frame time must be < 1.0ms, got ${avgMs.toFixed(3)}ms`);

console.log('[Test 5] Verifying normal recomputation with updateGeometryWithBodySlide...');
const geom = new THREE.BufferGeometry();
geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(basePositions), 3));
// Mock simple mesh triangle indices
const mockIndices = new Uint32Array([0, 1, 2, 2, 3, 0]);
geom.setIndex(new THREE.BufferAttribute(mockIndices, 1));

morphLoader.updateGeometryWithBodySlide(
  geom,
  basePositions,
  { BreastsBigger: 80.0 },
  mappings,
  osdData
);

const normalAttr = geom.getAttribute('normal');
assert.ok(normalAttr, 'Geometry normal attribute must exist after updateGeometryWithBodySlide');
assert.strictEqual(normalAttr.count, vertCount, 'Normal count must match vertex count');
console.log('  -> Vertex normal recomputation verified successfully.');

console.log('[Test 6] Verifying categories exposure in loadAllBodySlideData...');
const activeCategories = morphLoader.getActiveBodyCategories();
console.log(`  -> Active categories count: ${activeCategories.length}`);
assert.ok(activeCategories.length >= 22, `Expected at least 22 UBE categories, got ${activeCategories.length}`);

let totalSliders = 0;
for (const cat of activeCategories) {
  totalSliders += cat.sliders.length;
}
console.log(`  -> Total sliders in exposed categories: ${totalSliders}`);
assert.ok(totalSliders >= 220, `Expected at least 220 sliders, got ${totalSliders}`);

console.log('\n>>> ALL VERIFICATION TESTS PASSED (100% SUCCESS)! <<<');
