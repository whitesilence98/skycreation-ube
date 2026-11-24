// Rigger landmark state — the rules the placement UX depends on.
//
// Guards three regressions that made landmark placement feel broken:
//   • removing one marker used to wipe all eight
//   • `validateLandmarks` existed but was never called, so a swapped L/R pair
//     silently rigged a mangled character
//   • placement never advanced, forcing an 8× select-then-click loop
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
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (id) => (id.startsWith('@/') ? load(id.slice(2)) : require(id)),
    },
    { filename: file },
  );
  return module.exports;
}

const THREE = require('three');
const vrm = load('lib/rigger/vrmSkeleton');
const fit = load('lib/rigger/templateFitter');

const { LANDMARK_IDS, nextUnplacedLandmark } = vrm;
const { validateLandmarks } = fit;

// ── canonical order ────────────────────────────────────────────────────────
assert.equal(LANDMARK_IDS.length, 8, 'eight landmarks are required');
assert.equal(new Set(LANDMARK_IDS).size, 8, 'no duplicate ids');
assert.equal(fs.readFileSync(path.join(root, 'lib/rigger/vrmSkeleton.ts'), 'utf8').includes('The 8 anatomical'),
  true, 'the doc comment states the real count (it used to say 7)');

// ── next-unplaced advance walks forward, then wraps ─────────────────────────
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const partial = { headTop: v(0, 1.7, 0), neckBase: v(0, 1.5, 0) };
assert.equal(nextUnplacedLandmark('neckBase', partial), 'leftShoulder',
  'advances forward from the marker just placed');
assert.equal(nextUnplacedLandmark('headTop', partial), 'leftShoulder',
  'skips already-placed entries');
assert.equal(nextUnplacedLandmark(null, {}), 'headTop', 'starts at the crown');
assert.equal(nextUnplacedLandmark(null, partial), 'leftShoulder', 'skips filled entries from the top');

const full = Object.fromEntries(LANDMARK_IDS.map((id) => [id, v(0, 1, 0)]));
assert.equal(nextUnplacedLandmark('headTop', full), null, 'returns null when all are placed');

// ── validation catches a swapped L/R pair ─────────────────────────────────
const swapped = {
  headTop: v(0, 1.75, 0),
  neckBase: v(0, 1.55, 0),
  // Character-left is +X: these are backwards.
  leftShoulder: v(-0.2, 1.4, 0),
  rightShoulder: v(0.2, 1.4, 0),
  leftHip: v(-0.1, 1.0, 0),
  rightHip: v(0.1, 1.0, 0),
  leftAnkle: v(-0.1, 0.05, 0),
  rightAnkle: v(0.1, 0.05, 0),
};
const swappedWarnings = validateLandmarks(swapped);
assert.ok(swappedWarnings.some((w) => /swapped/i.test(w)),
  'a mirrored placement must be reported, not silently rigged');

// ── validation catches a head below the ankles ────────────────────────────
const inverted = { ...swapped, headTop: v(0, -1, 0), leftAnkle: v(-0.1, 0.05, 0), rightAnkle: v(0.1, 0.05, 0) };
assert.ok(validateLandmarks(inverted).some((w) => /above the ankle/i.test(w)),
  'head below the ankle is rejected');

// ── a correct layout produces no warnings ─────────────────────────────────
const good = {
  headTop: v(0, 1.75, 0),
  neckBase: v(0, 1.55, 0),
  leftShoulder: v(0.2, 1.4, 0),
  rightShoulder: v(-0.2, 1.4, 0),
  leftHip: v(0.1, 1.0, 0),
  rightHip: v(-0.1, 1.0, 0),
  leftAnkle: v(0.1, 0.05, 0),
  rightAnkle: v(-0.1, 0.05, 0),
};
// The array comes from another vm realm, so compare by length not deep-equality.
assert.equal(validateLandmarks(good).length, 0, 'a plausible humanoid passes cleanly');

// ── the store exposes a per-marker delete ─────────────────────────────────
const storeSource = fs.readFileSync(path.join(root, 'lib/rigger/store.ts'), 'utf8');
assert.ok(/deleteLandmark:\s*\(id\)/.test(storeSource),
  'store.deleteLandmark exists (clearLandmarks alone wipes all eight)');
assert.ok(storeSource.includes('nextUnplacedLandmark'),
  'placement advances automatically instead of returning to the sidebar');
assert.ok(!/stage:\s*e !== null \? 'error' : s\.stage/.test(storeSource),
  'clearing an error no longer strands the wizard in the error stage');

// ── the canvas no longer locks the camera during placement ────────────────
const canvasSource = fs.readFileSync(path.join(root, 'components/rigger/RiggerCanvas.tsx'), 'utf8');
assert.ok(/enabled=\{[^}]*!isDraggingLandmark[^}]*\}/.test(canvasSource)
  && !/enabled=\{!activeLandmark/.test(canvasSource),
  'OrbitControls stays live while a landmark is selected');
assert.ok(canvasSource.includes('onPointerMissed'),
  'a click that misses the mesh is surfaced to the user');

console.log('✓ rigger landmarks: per-marker delete, validated placement, auto-advance');
console.log('✓ rigger canvas: orbit while placing, miss feedback');
