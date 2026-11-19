// Run: node scripts/check_face_history.cjs (no assets, browser or server required).
// Proves the face-only history/compare/baseline contract of lib/store.ts:
// transaction batching, no-op writes, legacy + anatomy undo, hold-compare
// isolation, head-target rebasing, and that save/session always serialize the
// live edited face — never the baseline a hold temporarily put on screen.
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

const plain = (value) => JSON.parse(JSON.stringify(value));
const regions = load('lib/regions');
const { useCharacter } = load('lib/store');
const session = load('lib/session');
const get = useCharacter.getState;
const activeRegion = () => get().activeRegion;
const slider = () => get().sliders[activeRegion()];
const faceOf = (s) => plain({
  sliders: s.sliders, poses: s.poses, anatomy: s.anatomy,
  anatomyAsymmetry: s.anatomyAsymmetry, anatomyColors: s.anatomyColors, anatomyMode: s.anatomyMode,
});

/* `resetRegion`/`undoFace` must exist as real actions, not just types. */
for (const action of ['beginFaceEdit', 'endFaceEdit', 'undoFace', 'redoFace', 'resetFaceRegion',
  'beginFaceCompare', 'endFaceCompare', 'applyFaceBaseline']) {
  assert.equal(typeof get()[action], 'function', `${action} must be an action`);
}

/* ── 1. a slider drag is one history entry, not one per pointer move ────── */
get().setActiveRegion('nose');
const startValue = slider().width;
get().beginFaceEdit();
get().setSlider('width', startValue + 2);
get().setSlider('width', startValue + 4);
get().setSlider('width', startValue + 6);
get().endFaceEdit();
assert.equal(get().facePast.length, 1, 'one drag produces one face-history entry');
assert.equal(slider().width, startValue + 6);
get().undoFace();
assert.equal(slider().width, startValue, 'undoFace restores the pre-drag value');
assert.equal(get().faceFuture.length, 1);
get().redoFace();
assert.equal(slider().width, startValue + 6, 'redoFace re-applies the drag');

/* ── 2. writes that change nothing add no history ───────────────────────── */
{
  const before = get().facePast.length;
  get().setSlider('width', startValue + 6);
  get().setPose({ offset: [0, 0, 0] });
  get().beginFaceEdit(); get().endFaceEdit();
  assert.equal(get().facePast.length, before, 'no-op slider/pose/empty transaction adds nothing');
}

/* ── 3. legacy slider reset is history-aware ────────────────────────────── */
{
  const before = get().facePast.length;
  get().resetRegion();
  assert.equal(slider().width, regions.REGIONS_BY_ID.nose.defaults.width, 'resetRegion restores defaults');
  assert.equal(get().facePast.length, before + 1, 'region reset is one history entry');
  get().resetRegion();
  assert.equal(get().facePast.length, before + 1, 'resetting an already-default region is a no-op');
  get().undoFace();
  assert.equal(slider().width, startValue + 6, 'undo after reset returns the sculpted value');
}

/* ── 4. anatomy writes go to both histories and undo through either ────── */
get().setAnatomyMode('advanced'); // itself a face-history entry
const anatomyBefore = get().anatomy['nose.width'];
get().beginFaceEdit();
get().setAnatomy('nose.width', anatomyBefore + 7);
get().setAnatomy('nose.width', anatomyBefore + 12);
get().endFaceEdit();
assert.equal(get().anatomy['nose.width'], anatomyBefore + 12);
assert.equal(get().anatomyPast.length, 1, 'one anatomy transaction');
assert.equal(get().facePast.at(-1).anatomy['nose.width'], anatomyBefore, 'face entry holds the pre-edit anatomy');
get().undoFace();
assert.equal(get().anatomy['nose.width'], anatomyBefore, 'undoFace also rolls back anatomy edits');
assert.equal(get().anatomyPast.length, 0, 'anatomy history moved together with the face undo');
get().redoFace();
assert.equal(get().anatomy['nose.width'], anatomyBefore + 12);
get().undoAnatomy();
assert.equal(get().anatomy['nose.width'], anatomyBefore, 'the legacy anatomy undo still works');
/* The advanced panel opens `beginAnatomyEdit` itself; that drag is still one
   entry in both stacks, not one per slider event. */
{
  const facePast = get().facePast.length;
  const anatomyPast = get().anatomyPast.length;
  get().beginAnatomyEdit();
  get().setAnatomy('nose.width', anatomyBefore + 3);
  get().setAnatomy('nose.width', anatomyBefore + 5);
  get().endAnatomyEdit();
  assert.equal(get().anatomyPast.length, anatomyPast + 1, 'advanced panel drag is one anatomy entry');
  assert.equal(get().facePast.length, facePast + 1, 'advanced panel drag is one face entry too');
  get().undoFace();
  assert.equal(get().anatomy['nose.width'], anatomyBefore);
  assert.equal(get().anatomyPast.length, anatomyPast, 'undoFace keeps the advanced stack aligned');
}

/* ── 5. hold-compare shows the baseline, ignores edits, restores on release ─ */
{
  get().applyFaceBaseline();
  const edited = faceOf(get());
  const baselineValue = slider().width;
  get().setSlider('width', baselineValue + 3);       // an edit after the baseline
  const afterEdit = faceOf(get());
  get().beginFaceCompare();
  assert.notEqual(get().faceCompareStart, null, 'hold compare is active');
  assert.equal(slider().width, baselineValue, 'compare swaps the live face for the baseline');
  assert.deepEqual(faceOf(get().faceCompareStart), afterEdit, 'the edited face is banked');
  // edits while held are ignored, and add no history
  const pastWhileHeld = get().facePast.length;
  get().setSlider('width', baselineValue - 9);
  get().setAnatomy('nose.width', 99);
  get().beginFaceEdit(); get().endFaceEdit();
  get().undoFace(); get().redoFace(); get().resetFaceRegion(); get().undoAnatomy();
  assert.equal(slider().width, baselineValue, 'edits during compare are ignored');
  assert.equal(get().anatomy['nose.width'], afterEdit.anatomy['nose.width'], 'anatomy edits are ignored');
  assert.equal(get().facePast.length, pastWhileHeld, 'edits/undo/reset during compare add no history');
  // a repeated pointerdown while held must not overwrite the banked edit
  get().beginFaceCompare();
  assert.deepEqual(faceOf(get().faceCompareStart), afterEdit, 're-entering compare keeps the banked edit');
  // saving/exports during the hold must write the *edited* face
  assert.deepEqual(plain(get().snapshotPreset().regions.nose.sliders), plain(afterEdit.sliders.nose),
    'snapshotPreset exports the edited face, not the compared baseline');
  /* The persist middleware's own slice function is what writes localStorage;
     it must serialize the edited face, not the compared baseline. */
  const stored = useCharacter.persist.getOptions().partialize(get());
  assert.deepEqual(plain(stored.sliders), plain(afterEdit.sliders),
    'the persisted session carries the edited face during a hold');
  assert.deepEqual(plain(stored.anatomy), plain(afterEdit.anatomy),
    'the persisted anatomy is the edited one during a hold');
  assert.ok(!Object.hasOwn(stored, 'facePast') && !Object.hasOwn(stored, 'faceCompareStart')
    && !Object.hasOwn(stored, 'faceBaseline') && !Object.hasOwn(stored, 'faceEditStart'),
    'history and compare state are transient');
  get().endFaceCompare();
  assert.equal(get().faceCompareStart, null);
  assert.deepEqual(faceOf(get()), afterEdit, 'release restores exactly the edited face');
}

/* ── 6. applyFaceBaseline re-anchors without changing appearance ────────── */
{
  get().setSlider('width', slider().width + 5);
  const before = faceOf(get());
  get().applyFaceBaseline();
  assert.deepEqual(faceOf(get()), before, 're-baselining does not move the face');
  assert.deepEqual(faceOf(get().faceBaseline), before, 'the new baseline is the current face');
  get().beginFaceCompare();
  assert.deepEqual(faceOf(get()), before, 'comparing against a just-applied baseline is a no-op visually');
  get().endFaceCompare();
  assert.deepEqual(faceOf(get()), before);
}

/* ── 7. hair / equipment / lighting are outside the face history ────────── */
{
  const hair = plain(get().hair);
  const equipment = plain(get().equipment);
  const lighting = plain(get().lighting);
  get().setSlider('width', slider().width + 4);
  get().setHair({ tone: '#123456' });
  get().setEquip({ top: 'some-garment' });
  get().setLighting({ intensity: 2 });
  const hairAfter = plain(get().hair);
  get().undoFace();
  assert.deepEqual(plain(get().hair), hairAfter, 'undoing a face edit leaves hair alone');
  assert.equal(plain(get().equipment).top, 'some-garment', 'equipment is untouched by face undo');
  assert.notDeepEqual(plain(get().lighting), lighting, 'lighting kept the change');
  assert.notEqual(hair.tone, hairAfter.tone);
}

/* ── 8. changing the head mesh rebases; other asset picks do not ───────── */
{
  get().setSlider('width', slider().width + 2);
  assert.ok(get().facePast.length > 0);
  get().setAssets({ headMesh: 'headMesh-face-a' });
  assert.equal(get().facePast.length, 0, 'a head-target change clears face history');
  assert.equal(get().faceFuture.length, 0);
  assert.equal(get().faceBaseline, null);
  get().setSlider('width', slider().width + 2);
  const kept = get().facePast.length;
  assert.ok(kept > 0);
  get().setAssets({ hairMesh: 'hair-a' });
  get().setAssets({ eyes: 'eye-a' });
  assert.equal(get().facePast.length, kept, 'hair/eye picks do not rebase the face history');
}

/* ── 9. applying or loading a preset clears and rebases ─────────────────── */
{
  get().setSlider('width', slider().width + 3);
  get().applyPreset(regions.PRESETS[0].id);
  assert.equal(get().facePast.length, 0, 'applyPreset clears face history');
  assert.equal(get().faceFuture.length, 0);
  assert.equal(get().faceBaseline, null);
  get().setSlider('width', slider().width + 3);
  const exported = get().snapshotPreset();
  get().loadPreset(load('lib/presetIO').parsePreset(JSON.stringify(exported)));
  assert.equal(get().facePast.length, 0, 'loadPreset clears face history');
  assert.equal(get().faceBaseline, null);
}

/* ── 10. no-op detection is structural, not serialized ─────────────────────
   The compare on every pointer move used to clone both faces and run two
   `JSON.stringify`s. It must now decide from the patch alone, keep the same
   no-op rules, and still notice a one-ulp change. */
{
  const snapshot = () => get().facePast.length;
  // Every slider field, one at a time: only the changed one makes an entry.
  let before = snapshot();
  for (const id of Object.keys(regions.SLIDERS_BY_ID)) {
    get().beginFaceEdit();
    get().setSlider(id, get().sliders[get().activeRegion][id]);
    get().endFaceEdit();
    assert.equal(snapshot(), before, `same-value write to "${id}" adds no history`);
  }
  // A no-op pose written as a fresh array must still be recognised as equal.
  before = snapshot();
  get().beginFaceEdit();
  const pose = get().poses[get().activeRegion];
  get().setPose({ offset: [...pose.offset], rotation: [...pose.rotation], scale: [...pose.scale] });
  get().endFaceEdit();
  assert.equal(snapshot(), before, 'a structurally identical gizmo pose is a no-op');
  // A real one-ulp move is not.
  get().setPose({ offset: [pose.offset[0] + Number.EPSILON, pose.offset[1], pose.offset[2]] });
  assert.equal(snapshot(), before + 1, 'a sub-millimetre gizmo move is recorded');
  get().undoFace();
  assert.equal(snapshot(), before, 'and undone in one step');

  // Anatomy: writing the value already stored is a no-op in both stacks.
  get().setAnatomyMode('advanced');
  const anatomyBefore = get().anatomy['nose.width'];
  const faceBefore = get().facePast.length;
  const anatomyPastBefore = get().anatomyPast.length;
  get().beginAnatomyEdit();
  get().setAnatomy('nose.width', anatomyBefore);
  get().endAnatomyEdit();
  assert.equal(get().facePast.length, faceBefore, 'same-value anatomy write adds no face entry');
  assert.equal(get().anatomyPast.length, anatomyPastBefore, 'same-value anatomy write adds no anatomy entry');
}

/* ── 11. an open transaction never re-anchors the hold-compare baseline ────
   `beginFaceEdit` snapshots the pre-drag face; the first in-drag write used to
   clone and compare the whole face again. It must take no snapshot and must
   not move a baseline the user already has. */
{
  get().applyFaceBaseline();
  const baseline = plain(get().faceBaseline);
  get().beginFaceEdit();
  get().setSlider('width', slider().width + 1);
  get().setSlider('width', slider().width + 1);
  get().endFaceEdit();
  assert.deepEqual(plain(get().faceBaseline), baseline, 'a drag keeps the compare baseline');
  assert.equal(get().facePast.at(-1).sliders.nose.width, baseline.sliders.nose.width,
    'the single entry holds the pre-drag face');
  get().undoFace();
  assert.deepEqual(plain(get().faceBaseline), baseline);
}

console.log('PASS: face history transactions, no-ops, legacy/anatomy undo, reset, hold-compare, '
  + 'baseline re-anchor, head rebase, live-face persistence, structural no-op parity');
console.log('NOT ASSESSED: on-screen HUD wiring, visual compare framing; see check:anatomy for the advanced bank');
