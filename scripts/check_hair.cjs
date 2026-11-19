// Run: node scripts/check_hair.cjs
//
// The HAIR section renders premade MO2 meshes; nothing builds procedural hair
// any more. So this checks the live contract — tone/gloss coercion, the preset
// round-trip, and the asset selection the controller writes — rather than the
// retired procedural builder, whose assertions would pass while the real
// render path broke.
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
const settings = load('lib/hair/settings');
const { DEFAULT_HAIR, HAIR_TABS, HAIR_TONES, coerceHair } = settings;
const { useCharacter } = load('lib/store');
const { parsePreset } = load('lib/presetIO');

// ── the controller's own surface ───────────────────────────────────────────
assert.deepEqual(Array.from(HAIR_TABS), ['STYLE', 'COLOR', 'GLOSS']);
assert.equal(HAIR_TONES.length, 8, 'the tint row offers eight tones');
assert.equal(DEFAULT_HAIR.tone, '#ffffff', 'default is the authored atlas, untinted');
assert.ok(DEFAULT_HAIR.gloss >= 0 && DEFAULT_HAIR.gloss <= 1);

// ── coercion rejects what the UI can never send ─────────────────────────────
const invalid = coerceHair({ tone: 'red', gloss: Infinity, style: 42 });
assert.equal(invalid.tone, DEFAULT_HAIR.tone);
assert.equal(invalid.gloss, DEFAULT_HAIR.gloss);
assert.equal(typeof invalid.style, 'string');

// ── the store keeps the atlas tint while a mesh changes ─────────────────────
const store = useCharacter.getState();
store.setAssets({ hairMesh: 'hairMesh-test', hair: 'hair-test-atlas' });
assert.equal(useCharacter.getState().assetSelection.hairMesh, 'hairMesh-test');
assert.equal(useCharacter.getState().assetSelection.hair, 'hair-test-atlas');

store.setHair({ tone: '#abcdef' });
assert.equal(useCharacter.getState().hair.tone, '#abcdef');
assert.equal(useCharacter.getState().browColor, '#abcdef',
  'browColor must synchronize with hair tone by default when linked');
assert.equal(useCharacter.getState().assetSelection.hair, 'hair-test-atlas',
  'recolouring must not drop the chosen atlas');
assert.equal(useCharacter.getState().assetSelection.hairMesh, 'hairMesh-test',
  'recolouring must not drop the chosen mesh');

// ── brow and hair color link / unlink / relink behavior ─────────────────────
assert.equal(useCharacter.getState().linkBrowToHair, true, 'linkBrowToHair is true by default');
// Manually changing brow color to a custom tint unlinks it
store.setBrowColor('#998877');
assert.equal(useCharacter.getState().browColor, '#998877');
assert.equal(useCharacter.getState().linkBrowToHair, false, 'manual brow color unlinks from hair');
// Changing hair tone while unlinked does not touch custom brow color
store.setHair({ tone: '#334455' });
assert.equal(useCharacter.getState().hair.tone, '#334455');
assert.equal(useCharacter.getState().browColor, '#998877', 'custom brow color preserved while unlinked');
// Relinking snaps brow color back to current hair tone
store.setLinkBrowToHair(true);
assert.equal(useCharacter.getState().linkBrowToHair, true);
assert.equal(useCharacter.getState().browColor, '#334455', 'relinking snaps brow color to hair tone');

// ── preset round-trip ───────────────────────────────────────────────────────
const exported = useCharacter.getState().snapshotPreset();
const payload = parsePreset(JSON.stringify(exported));
assert.equal(exported.version, 3);
assert.deepEqual(JSON.parse(JSON.stringify(payload.hair)), JSON.parse(JSON.stringify(exported.hair)));

// A v1 file has no hair block; loading it must leave the current hair alone.
const old = { ...exported, version: 1 };
delete old.hair;
store.setHair({ tone: '#112233' });
store.loadPreset(parsePreset(JSON.stringify(old)));
assert.equal(useCharacter.getState().hair.tone, '#112233', 'v1 import keeps current hair');

// A v2 file restores what it carries.
store.loadPreset(payload);
assert.equal(useCharacter.getState().hair.tone, exported.hair.tone);

// ── garbage in a preset must not reach the renderer ─────────────────────────
const hostile = JSON.parse(JSON.stringify(payload));
hostile.hair = { ...hostile.hair, tone: 'not-a-colour', gloss: 1e9, style: null };
store.loadPreset(parsePreset(JSON.stringify(hostile)));
const after = useCharacter.getState().hair;
assert.ok(after.gloss >= 0 && after.gloss <= 1, 'an out-of-range gloss never reaches the material');
assert.ok(/^#[0-9a-f]{6}$/i.test(after.tone), 'the tone stays a colour the material can parse');
// The coercion itself is what guarantees the above.
assert.equal(coerceHair({ gloss: 1e9 }).gloss, 1, 'a finite 1e9 gloss clamps to 1');
assert.equal(coerceHair({ gloss: Infinity }).gloss, DEFAULT_HAIR.gloss,
  'a non-finite gloss falls back to the default');
assert.equal(coerceHair({ tone: 'x' }).tone, DEFAULT_HAIR.tone, 'bad tone falls back');
assert.equal(coerceHair({ lengthCm: 999 }).lengthCm, 55, 'length clamps to the 55 cm cap');

// ── hair height (hairOffset) — default, clamp, NaN, metre mapping ───────────
assert.equal(settings.HAIR_OFFSET_METRES, 0.0015, 'one slider unit is 1.5 mm');
assert.equal(DEFAULT_HAIR.hairOffset, 0, 'hair height defaults to neutral');
assert.equal(coerceHair({}).hairOffset, 0, 'absent hairOffset coerces to neutral');
assert.equal(coerceHair({ hairOffset: 10 }).hairOffset, 10, 'the +10 cap is kept');
assert.equal(coerceHair({ hairOffset: -10 }).hairOffset, -10, 'the -10 cap is kept');
assert.equal(coerceHair({ hairOffset: 99 }).hairOffset, 10, 'hairOffset clamps at +10');
assert.equal(coerceHair({ hairOffset: -99 }).hairOffset, -10, 'hairOffset clamps at -10');
assert.equal(coerceHair({ hairOffset: NaN }).hairOffset, 0, 'NaN falls back to neutral');
assert.equal(coerceHair({ hairOffset: Infinity }).hairOffset, 0, 'Infinity falls back to neutral');
assert.equal(coerceHair({ hairOffset: '5' }).hairOffset, 0, 'a string is not a slider value');
assert.equal(settings.hairOffsetMetres(10), 0.015, '+10 maps to +15 mm');
assert.equal(settings.hairOffsetMetres(-10), -0.015, '-10 maps to -15 mm');
assert.equal(settings.hairOffsetMetres(0), 0, 'neutral maps to zero metres');
// The selection survives a preset load; the mesh is an asset choice, not hair data.
assert.equal(useCharacter.getState().assetSelection.hair, 'hair-test-atlas');

console.log('hair settings, tones, store and preset round-trip: ok');
