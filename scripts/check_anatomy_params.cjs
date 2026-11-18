// Run: node scripts/check_anatomy_params.cjs (no assets, browser or server required).
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
  const module = { exports: {} }; cache.set(file, module);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, console, process, URLSearchParams,
    require: id => id.startsWith('@/') ? load(id.slice(2)) : id.startsWith('.')
      ? load(path.relative(root, path.resolve(path.dirname(file), id)).split(path.sep).join('/')) : require(id),
  }, { filename: file });
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const params = load('lib/anatomy/params');
const validate = load('lib/anatomy/validate');
const { ANATOMY_PRESETS, IRIS_COLORS, LIP_COLORS } = load('lib/anatomy/presets');
const { useCharacter } = load('lib/store');
const io = load('lib/presetIO');
const session = load('lib/session');
const get = useCharacter.getState;
const defaults = validate.coerceAnatomy();
assert.equal(new Set(params.ANATOMY_PARAMS.map(p => p.id)).size, params.ANATOMY_PARAMS.length);
for (const p of params.ANATOMY_PARAMS) {
  assert.ok(Number.isFinite(p.min) && p.min <= p.default && p.default <= p.max && p.min < p.max && p.step > 0);
  assert.equal(p.status, load('lib/anatomy/bind').hasAnatomyBinding(p.id) ? 'wired' : 'stored-only');
}
assert.equal(validate.coerceAnatomy({ 'nose.width': 900 })['nose.width'], 100);
assert.equal(validate.coerceAnatomy({ 'body.heightCm': -5 })['body.heightCm'], 150);
assert.equal(validate.coerceAnatomy({ 'nose.width': NaN })['nose.width'], defaults['nose.width']);
assert.equal(validate.coerceAnatomy({ 'nose.width': Infinity })['nose.width'], defaults['nose.width']);
assert.ok(!Object.hasOwn(validate.coerceAnatomy({ intruder: 1 }), 'intruder'));
assert.deepEqual(plain(validate.coerceAnatomy(defaults)), plain(defaults));
assert.equal(validate.coerceAsymmetry({ 'eye.size': -900 })['eye.size'], -100);
assert.ok(!Object.hasOwn(validate.coerceAsymmetry({ 'nose.length': 3 }), 'nose.length'));
assert.equal(validate.coerceAnatomyColors({ 'iris.color': '#ABCDEF' })['iris.color'], '#abcdef');
assert.equal(validate.coerceAnatomyColors({ 'iris.color': 'red' })['iris.color'], '#80634a');
for (const [group, count] of Object.entries({ eyes: 12, brows: 15, nose: 8, mouth: 10, ears: 5, body: 4 })) {
  assert.equal(ANATOMY_PRESETS.filter(p => p.group === group).length, count);
}
assert.equal(IRIS_COLORS.length, 20); assert.equal(LIP_COLORS.length, 15);
for (const preset of ANATOMY_PRESETS) {
  assert.equal(preset.draft, true);
  for (const id of Object.keys(preset.values)) assert.equal(params.ANATOMY_BY_ID[id].group, preset.group);
}
const scoped = validate.applyPresetValues(defaults, 'nose', { 'nose.width': 68, 'eye.size': 9 });
assert.equal(scoped['nose.width'], 68); assert.equal(scoped['eye.size'], defaults['eye.size']);

// Real store actions: atomic values, scoped presets/reset, edit transactions and history.
const legacy = plain({ sliders: get().sliders, poses: get().poses, hair: get().hair, equipment: get().equipment });
get().setAnatomyMode('advanced');
get().beginAnatomyEdit();
get().setAnatomy('nose.width', 60); get().setAnatomy('nose.width', 72);
get().endAnatomyEdit();
assert.equal(get().anatomyPast.length, 1, 'one continuous edit produces one history entry');
get().undoAnatomy(); assert.equal(get().anatomy['nose.width'], 50);
get().redoAnatomy(); assert.equal(get().anatomy['nose.width'], 72);
get().setAnatomyAsymmetry('eye.size', 25);
get().setAnatomyColor('iris.color', '#ABCDEF');
const count = get().anatomyPast.length;
get().setAnatomy('nose.width', NaN);
get().setAnatomy('unknown', 10);
get().setAnatomyAsymmetry('nose.length', 20);
get().setAnatomyColor('iris.color', '#bad');
assert.equal(get().anatomyPast.length, count, 'invalid changes do not mutate history');
const noseBefore = get().anatomy['nose.width'];
get().applyAnatomyPreset('eyes.draft-2');
assert.equal(get().anatomy['nose.width'], noseBefore);
get().resetAnatomyGroup('eyes');
assert.equal(get().anatomy['eye.size'], defaults['eye.size']);
assert.equal(get().anatomyAsymmetry['eye.size'], 0);
assert.equal(get().anatomy['nose.width'], noseBefore);
assert.deepEqual(plain({ sliders: get().sliders, poses: get().poses, hair: get().hair, equipment: get().equipment }), legacy);

get().setAnatomyAsymmetry('eye.size', -12);
get().setAnatomyColor('iris.color', '#345678');
const exported = get().snapshotPreset();
assert.equal(exported.version, 3);
const payload = io.parsePreset(JSON.stringify(exported));
assert.deepEqual(plain(payload.anatomy), plain(get().anatomy));
assert.deepEqual(plain(payload.anatomyAsymmetry), plain(get().anatomyAsymmetry));
assert.deepEqual(plain(payload.anatomyColors), plain(get().anatomyColors));
get().resetAnatomyGroup('nose');
assert.equal(payload.anatomyMode, 'advanced');
get().setAnatomyMode('legacy');
get().loadPreset(payload);
assert.equal(get().anatomyMode, 'advanced', 'preset restores effective deformation mode');
const { anatomySliderBank } = load('lib/anatomy/bind');
assert.deepEqual(plain(anatomySliderBank('nose', get().anatomy, get().sliders.nose)),
  plain(anatomySliderBank('nose', payload.anatomy, payload.regions.nose.sliders)), 'restored effective nose matches export');
assert.equal(get().anatomy['nose.width'], noseBefore);
assert.equal(get().anatomyPast.length, 0, 'loading a character clears stale history');
assert.deepEqual(plain(get().anatomyColors), plain(payload.anatomyColors));
const v2 = { ...exported, version: 2 };
delete v2.anatomy; delete v2.anatomyAsymmetry; delete v2.anatomyColors; delete v2.anatomyMode;
const old = io.parsePreset(JSON.stringify(v2));
assert.deepEqual(plain(old.anatomy), plain(defaults));
assert.throws(() => io.parsePreset(JSON.stringify({ ...exported, version: 999 })), /Unsupported/);
const saved = session.pickSession(get());
const restored = session.coerceSession(saved, saved);
assert.deepEqual(plain(restored.anatomy), plain(get().anatomy));
assert.equal(restored.anatomyMode, 'advanced');
assert.ok(!Object.hasOwn(saved, 'anatomyPast'), 'history is transient');
saved.anatomy['nose.width'] = 3;
assert.equal(get().anatomy['nose.width'], noseBefore, 'saved snapshots do not alias the store');
const oldSession = { ...saved }; delete oldSession.anatomy; delete oldSession.anatomyAsymmetry; delete oldSession.anatomyColors;
assert.deepEqual(plain(session.coerceSession(oldSession, saved).anatomy), plain(defaults));
get().loadPreset(old);
assert.deepEqual(plain(get().anatomy), plain(defaults));
console.log('PASS: definitions, validation, drafts, scoped actions, undo/redo, v3/v2 presets, session compatibility');
console.log('NOT ASSESSED: visual HUD layout, GPU skinning appearance, shape quality; see check:deform for CPU geometry checks');
