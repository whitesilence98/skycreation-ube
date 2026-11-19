// Run: node scripts/check_face_panels.cjs
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
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, console, process,
    require: (id) => id.startsWith('@/') ? load(id.slice(2)) : require(id),
  }, { filename: file });
  return module.exports;
}
const preset = load('lib/presetIO');
const layer = (kind, id = kind) => ({ kind, id, color: '#1a1412', opacity: 1 });
const layers = [layer('makeup'), layer('wrinkle'), layer('tattoo')];
assert.equal(preset.isOverlayLayers(layers), false, 'strict validator rejects removed kinds');
assert.equal(JSON.stringify(preset.sanitizeOverlayLayers(layers)), JSON.stringify([layers[0], layers[2]]));
assert.equal(JSON.stringify(preset.sanitizeAssetSelection({ lashesMesh: 'lashes', wrinkle: 'old', mouth: 'mouth', skin: 7 })), JSON.stringify({ lashesMesh: 'lashes', mouth: 'mouth' }));
for (const invalid of [null, 3, 'bad', {}]) assert.equal(preset.sanitizeOverlayLayers(invalid), undefined);
for (const invalid of [null, 3, 'bad', []]) assert.equal(preset.sanitizeAssetSelection(invalid), undefined);
assert.equal(preset.sanitizeOverlayLayers([layer('tattoo'), { ...layer('makeup'), opacity: NaN }]).length, 1);
assert.equal(preset.sanitizeOverlayLayers(Array.from({ length: 20 }, () => layer('tattoo'))).length, 16);

const { useCharacter } = load('lib/store');
const { coerceSession, pickSession } = load('lib/session');
const state = useCharacter.getState();
state.setLashesColor('#123456');
state.setLashesOpacity(0.4);
assert.equal(useCharacter.getState().lashesColor, '#123456');
assert.equal(useCharacter.getState().lashesOpacity, 0.4);
state.setLashesOpacity(NaN);
assert.equal(useCharacter.getState().lashesOpacity, 0.4);
state.setLashesOpacity(2);
assert.equal(useCharacter.getState().lashesOpacity, 1);
state.setLashesOpacity(-1);
assert.equal(useCharacter.getState().lashesOpacity, 0);
state.setLashesColor('invalid');
assert.equal(useCharacter.getState().lashesColor, '#123456');
state.setLashesOpacity(0.4);
const snapshot = useCharacter.getState().snapshotPreset();
assert.equal(snapshot.lashesColor, '#123456');
assert.equal(snapshot.lashesOpacity, 0.4);
const parsed = preset.parsePreset(JSON.stringify(snapshot));
assert.equal(parsed.lashesColor, '#123456');
assert.equal(parsed.lashesOpacity, 0.4);
assert.equal(JSON.stringify(preset.parsePreset(JSON.stringify({ ...snapshot, overlays: [layer('wrinkle')] })).overlays), '[]', 'removed-only legacy stacks clear rather than preserve live paint');
const invalidTint = preset.parsePreset(JSON.stringify({ ...snapshot, lashesColor: 'invalid', lashesOpacity: 9 }));
assert.equal(invalidTint.lashesColor, undefined);
assert.equal(invalidTint.lashesOpacity, 1);
const defaults = pickSession(useCharacter.getState());
const restored = coerceSession({ ...defaults, subTab: 'WRINKLE', activeCategory: 'wrinkle', overlayLayers: layers,
  assetSelection: { wrinkle: 'old', mouth: 'mouth' }, lashesColor: '#abcdef', lashesOpacity: 0.7 }, defaults);
assert.equal(restored.lashesColor, '#abcdef');
assert.equal(restored.lashesOpacity, 0.7);
assert.equal(restored.subTab, 'SKIN');
assert.equal(restored.activeCategory, 'skin');
assert.equal(restored.overlayLayers.length, 2);
assert.equal(JSON.stringify(restored.assetSelection), JSON.stringify({ mouth: 'mouth' }));

const base = path.join(root, 'public/assets/preset-pack');
const read = (kind) => JSON.parse(fs.readFileSync(path.join(base, 'catalogue', kind + '.json'), 'utf8'));
const albedo = (rows) => rows.filter((r) => (r.mapRole ?? 'albedo') === 'albedo');
const lashes = read('lashesMesh');
assert.equal(lashes.length, 20);
assert.equal(lashes.filter((r) => r.decodable === true).length, 19);
const paired = lashes.filter((r) => r.pairedTextureId);
assert.equal(paired.length, 18);
assert.equal(new Set(paired.map((r) => r.label.toLowerCase())).size, 18);
const atlases = albedo(read('lashes'));
assert.equal(atlases.length, 18);
for (const row of paired) assert.ok(atlases.some((r) => r.id === row.pairedTextureId), row.file + ' pair exists');
const mouths = read('mouthMesh').filter((r) => r.decodable === true);
assert.equal(mouths.length, 2);
for (const row of mouths) assert.equal(row.pairedTextureId, 'mouth-fcaa27b87cdf20eb');
const mouthAtlas = albedo(read('mouth'));
assert.equal(mouthAtlas.length, 1);
assert.equal(mouthAtlas[0].id, mouths[0].pairedTextureId);
assert.equal(albedo(read('tattoo')).length, 92);
assert.equal(fs.existsSync(path.join(base, 'catalogue/wrinkle.json')), false);
assert.equal(JSON.parse(fs.readFileSync(path.join(base, 'catalogue.json'), 'utf8')).kinds.wrinkle, undefined);
console.log('face panels: pairing, legacy cleanup, lashes preset/session round-trip OK');
