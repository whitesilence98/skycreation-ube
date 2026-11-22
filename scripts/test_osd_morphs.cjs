const fs = require('fs');
const assert = require('assert');
const THREE = require('three');

// Load compiled TS via ts-node or transpiled modules
// We can use tsx or compile check via TypeScript compiler / node
const ts = require('typescript');

const path = require('path');

const moduleCache = {};
function loadTs(filePath) {
  const absPath = path.resolve(filePath);
  if (moduleCache[absPath]) return moduleCache[absPath].exports;

  const code = fs.readFileSync(absPath, 'utf8');
  const result = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const m = { exports: {} };
  moduleCache[absPath] = m;

  const customRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      const targetPath = path.resolve(path.dirname(absPath), specifier + '.ts');
      return loadTs(targetPath);
    }
    return require(specifier);
  };

  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', result.outputText);
  fn(customRequire, m, m.exports, absPath, path.dirname(absPath));
  return m.exports;
}

console.log('Loading osdParser and applyMorphs...');
const osdParser = loadTs('lib/bodyslide/osdParser.ts');
const applyMorphs = loadTs('lib/bodyslide/applyMorphs.ts');

console.log('[1] Testing parseOsd on public/assets/bodyslide/UBE SE 2.0 - Necoco Body.osd');
const osdPath = 'public/assets/bodyslide/UBE SE 2.0 - Necoco Body.osd';
const buffer = fs.readFileSync(osdPath);
const osd = osdParser.parseOsd(buffer);

assert.strictEqual(osd.version, 1, 'Version should be 1');
assert.strictEqual(osd.blockCount, 236, 'Block count should be 236');
assert.strictEqual(osd.blockList.length, 236, 'Block list length should be 236');
console.log('  -> Version: 1, BlockCount: 236 verified.');

console.log('[2] Testing block lookup and name normalization');
const blockRaw = osd.getBlock('BaseShapeBreastsBigger');
const blockClean = osd.getBlock('BreastsBigger');
assert.ok(blockRaw, 'Should find BaseShapeBreastsBigger');
assert.ok(blockClean, 'Should find BreastsBigger');
assert.strictEqual(blockRaw, blockClean, 'Raw and clean lookup must point to identical block');
assert.strictEqual(blockClean.name, 'BreastsBigger');
assert.strictEqual(blockClean.rawName, 'BaseShapeBreastsBigger');
console.log('  -> Name aliasing verified for', blockClean.name, 'diffCount =', blockClean.diffCount);

console.log('[3] Testing parseOsdToMap');
const map = osdParser.parseOsdToMap(buffer);
assert.ok(map.has('BreastsBigger'), 'Map should contain clean name');
assert.ok(map.has('BaseShapeBreastsBigger'), 'Map should contain raw name');
const entry = map.get('BreastsBigger');
assert.ok(entry.indices instanceof Uint16Array);
assert.ok(entry.deltas instanceof Float32Array);
assert.strictEqual(entry.indices.length * 3, entry.deltas.length);
console.log('  -> parseOsdToMap verified.');

console.log('[4] Testing getDenseDeltas');
const dense = osd.getDenseDeltas('BreastsBigger', 32512, 'render');
assert.ok(dense instanceof Float32Array);
assert.strictEqual(dense.length, 32512 * 3);
// Check vertex 29074 known displacement from earlier inspect
const v29074Idx = 29074 * 3;
const rx = dense[v29074Idx];
const ry = dense[v29074Idx + 1];
const rz = dense[v29074Idx + 2];
console.log('  -> Dense deltas at v29074:', { rx, ry, rz });
assert.ok(Math.abs(rx - 0.009287) < 0.0001, 'rx should match convert_worker S scaling');
assert.ok(Math.abs(ry - 0.004163) < 0.0001, 'ry should match convert_worker S scaling');
assert.ok(Math.abs(rz - 0.015352) < 0.0001, 'rz should match convert_worker S scaling');
console.log('  -> Three.js coordinate transformation verified.');

console.log('[5] Testing setupMorphTargets on THREE.SkinnedMesh');
const geo = new THREE.BufferGeometry();
const dummyPositions = new Float32Array(32512 * 3);
geo.setAttribute('position', new THREE.BufferAttribute(dummyPositions, 3));
const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());

const setupResult = applyMorphs.setupMorphTargets(mesh, osd, {
  sliderNames: ['BreastsBigger', 'Amazon', 'Necoco_Boob_Base'],
});

assert.strictEqual(setupResult.attributeCount, 3);
assert.strictEqual(geo.morphAttributes.position.length, 3);
assert.strictEqual(geo.morphTargetsRelative, true);
assert.ok(mesh.morphTargetDictionary['BreastsBigger'] !== undefined);
assert.ok(mesh.morphTargetDictionary['BaseShapeBreastsBigger'] !== undefined);
assert.strictEqual(mesh.morphTargetInfluences.length, 3);
console.log('  -> setupMorphTargets verified on SkinnedMesh.');

console.log('[6] Testing updateMorphInfluences');
applyMorphs.updateMorphInfluences(mesh, {
  'BreastsBigger': 0.75,
  'Amazon': 50, // 50% should normalize to 0.5
});
const idxBigger = mesh.morphTargetDictionary['BreastsBigger'];
const idxAmazon = mesh.morphTargetDictionary['Amazon'];
assert.strictEqual(mesh.morphTargetInfluences[idxBigger], 0.75);
assert.strictEqual(mesh.morphTargetInfluences[idxAmazon], 0.5);
console.log('  -> updateMorphInfluences with auto-normalization verified.');

console.log('[7] Testing CPU applyMorphsToGeometry');
const basePos = new Float32Array(32512 * 3);
// set base position at vertex 29074
basePos[29074 * 3] = 0.1215;
basePos[29074 * 3 + 1] = -0.30026;
basePos[29074 * 3 + 2] = 0.13642;
geo.setAttribute('position', new THREE.BufferAttribute(basePos.slice(), 3));

applyMorphs.applyMorphsToGeometry(geo, basePos, osd, {
  'BreastsBigger': 1.0,
}, { recomputeNormals: false });

const deformedPos = geo.getAttribute('position').array;
assert.ok(Math.abs(deformedPos[29074 * 3] - (0.1215 + rx)) < 1e-6);
assert.ok(Math.abs(deformedPos[29074 * 3 + 1] - (-0.30026 + ry)) < 1e-6);
assert.ok(Math.abs(deformedPos[29074 * 3 + 2] - (0.13642 + rz)) < 1e-6);
console.log('  -> CPU applyMorphsToGeometry verified.');

console.log('\n>>> ALL OSD AND APPLYMORPHS TESTS PASSED! <<<');
