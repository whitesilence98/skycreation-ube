// Run: node scripts/check_preset_library.cjs (no browser, assets or server).
//
// Contract for the named preset library, storage layer only:
//
//   • records.ts — label rules, collision, capacity, ordering and the
//     validation boundary around an untrusted record.
//   • library.ts — IndexedDB save/list/delete with the uniqueness and
//     50-record rules enforced inside the transaction, quota classification,
//     and resolve-on-commit (not resolve-on-request).
//   • capture.ts (owned by the parent) — square crop geometry and the
//     register/capture/unregister seam.
//
// The IndexedDB test double below is test-only: production reads the real
// `window.indexedDB`, and this check swaps it in through a VM `window`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

/* Mutable VM globals. The modules read `window`/`document` at call time, so a
   test can replace one property without reloading the module. */
const vmWindow = {};
const vmDocument = {};
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
      setTimeout,
      clearTimeout,
      queueMicrotask,
      window: vmWindow,
      document: vmDocument,
      require: (id) => {
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

const rec = load('lib/presets/records');
const lib = load('lib/presets/library');
const io = load('lib/presetIO');
const regions = load('lib/regions');
const capture = load('lib/presets/capture');

const plain = (v) => JSON.parse(JSON.stringify(v ?? null));

// ── exported API ───────────────────────────────────────────────────
for (const name of [
  'PRESET_LIBRARY_SCHEMA', 'PRESET_LIBRARY_LIMIT', 'PRESET_LABEL_MAX', 'THUMBNAIL_MAX_CHARS',
  'newRecordId', 'normalizeLabel', 'makeRecord', 'findLabelCollision', 'isAtCapacity',
  'sortRecords', 'upsertRecord', 'normalizeRecord', 'formatRelativeDate',
]) {
  assert.ok(name in rec, `records must export ${name}`);
}
assert.equal(rec.PRESET_LIBRARY_LIMIT, 50);
assert.equal(rec.PRESET_LABEL_MAX, 32);
for (const name of ['listPresetRecords', 'savePresetRecord', 'deletePresetRecord']) {
  assert.equal(typeof lib[name], 'function', `library must export ${name}`);
}
console.log('exported API: ok');

// ── a real snapshot round-trips through the record boundary ─────────
const sliders = Object.fromEntries(regions.SLIDER_DEFS.map((d, i) => [d.id, Math.round((d.min + (d.max - d.min) * (0.25 + 0.05 * (i % 7))) / d.step) * d.step]));
const built = io.buildPresetFile({
  name: 'Round Trip',
  preset: regions.PRESETS[0].id,
  activeRegion: 'nose',
  transformMode: 'rotate',
  bisymmetry: true,
  regions: Object.fromEntries(regions.REGIONS.map((r) => [r.id, {
    sliders: r.id === 'nose' ? sliders : { ...r.defaults },
    pose: { offset: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] },
  }])),
  assets: { headMesh: 'dynamic://0.4242', eyes: 'eyes-1' },
  equipment: { top: 'clothingMesh-a', feet: 'clothingMesh-b' },
  weight: 0.42,
  overlays: [{ kind: 'makeup', id: 'mk-1', color: '#aabbcc', opacity: 0.5 }],
});
const record = rec.makeRecord({ label: 'My Hero', preset: built, now: new Date('2026-01-02T03:04:05Z') });
assert.equal(record.schema, 1);
assert.equal(record.label, 'My Hero');
assert.equal(record.createdAt, '2026-01-02T03:04:05.000Z');
const back = io.parsePreset(JSON.stringify(record.preset));
assert.equal(back.source, 'lyra');
assert.equal(back.regions.nose.sliders.length, sliders.length, 'slider bank round-trips');
assert.equal(plain(back.assets).headMesh, 'dynamic://0.4242', 'a dynamic head id is stored verbatim');
assert.equal(JSON.stringify(plain(back.equipment)), JSON.stringify({ top: 'clothingMesh-a', feet: 'clothingMesh-b' }));
assert.equal(back.weight, 0.42);
assert.equal(back.overlays.length, 1);
assert.equal(back.anatomyMode, 'legacy');
console.log('record -> preset round trip: ok');

// ── labels ─────────────────────────────────────────────────────────
const ctrl = 'a' + String.fromCharCode(1) + 'b';
assert.equal(rec.normalizeLabel(ctrl), 'a b', 'control characters become one space');
assert.equal(rec.normalizeLabel('  spaced   out  '), 'spaced out', 'whitespace is collapsed and trimmed');
assert.equal(rec.normalizeLabel(''), 'Untitled');
assert.equal(rec.normalizeLabel(null), 'Untitled');
assert.equal(rec.normalizeLabel('   '), 'Untitled');
assert.equal(rec.normalizeLabel(null, 'Fallback'), 'Fallback');
assert.equal(rec.normalizeLabel('x'.repeat(40)), 'x'.repeat(32), 'truncates to 32 characters');
assert.equal(Array.from(rec.normalizeLabel('\u{1F600}'.repeat(40))).length, 32, 'truncates by code point');
console.log('label normalization: ok');

// ── collision and capacity ─────────────────────────────────────────
const r1 = rec.makeRecord({ label: 'Aria', preset: built, now: new Date('2026-01-01T00:00:00Z'), id: 'r1' });
const r2 = rec.makeRecord({ label: 'Bram', preset: built, now: new Date('2026-01-01T00:00:00Z'), id: 'r2' });
assert.equal(rec.findLabelCollision([r1, r2], 'aria').id, 'r1', 'collision is case-insensitive');
assert.equal(rec.findLabelCollision([r1, r2], '  ARIA ').id, 'r1', 'collision compares normalized labels');
assert.equal(rec.findLabelCollision([r1, r2], 'aria', 'r1'), undefined, 'excludeId exempts the record itself');
assert.equal(rec.findLabelCollision([r1, r2], 'Nova'), undefined);

const many = Array.from({ length: 50 }, (_, i) =>
  rec.makeRecord({ label: `P${i}`, preset: built, id: `r${i}` }));
assert.equal(rec.isAtCapacity(many), true, '50 records is capacity');
assert.equal(rec.isAtCapacity(many.slice(0, 49)), false);
assert.equal(rec.isAtCapacity(many, 'r0'), false, 'an existing id can still overwrite at capacity');
assert.equal(rec.isAtCapacity(many, 'absent'), true, 'a new id is blocked at capacity');
console.log('collision and capacity: ok');

// ── sort and upsert never mutate input ─────────────────────────────
const older = rec.makeRecord({ label: 'Zed', preset: built, id: 'z', now: new Date('2026-01-01T00:00:00Z') });
const newer = rec.makeRecord({ label: 'Amy', preset: built, id: 'a', now: new Date('2026-01-03T00:00:00Z') });
const mid = rec.makeRecord({ label: 'Bea', preset: built, id: 'b', now: new Date('2026-01-02T00:00:00Z') });
const input = [older, newer, mid];
const before = JSON.stringify(input);
const sorted = rec.sortRecords(input);
assert.equal(JSON.stringify(input), before, 'sortRecords leaves the input order intact');
assert.equal(JSON.stringify(sorted.map((r) => r.id)), JSON.stringify(['a', 'b', 'z']), 'updatedAt desc');
const sameTime1 = rec.makeRecord({ label: 'Beta', preset: built, id: 'x', now: new Date('2026-01-05T00:00:00Z') });
const sameTime2 = rec.makeRecord({ label: 'Alpha', preset: built, id: 'y', now: new Date('2026-01-05T00:00:00Z') });
assert.equal(JSON.stringify(rec.sortRecords([sameTime1, sameTime2]).map((r) => r.id)), JSON.stringify(['y', 'x']), 'label asc breaks ties');

const appended = rec.upsertRecord([r1], r2);
assert.equal(appended.length, 2);
assert.equal(rec.upsertRecord([r1], r2)[0].id, 'r1', 'upsert leaves the original array unchanged');
const replaced = rec.upsertRecord([r1], { ...r1, label: 'Renamed' });
assert.equal(replaced.length, 1);
assert.equal(replaced[0].label, 'Renamed');
console.log('sort and upsert: ok');

// ── normalizeRecord rejection matrix ───────────────────────────────
const good = { ...record, preset: plain(built) };
assert.ok(rec.normalizeRecord(good), 'a well-formed record is accepted');
assert.ok(rec.normalizeRecord({ ...good, thumbnail: undefined }), 'a missing thumbnail is valid');
assert.ok(rec.normalizeRecord({ ...good, thumbnail: 'data:image/webp;base64,AAAA' }), 'an image data URL is valid');
assert.equal(rec.normalizeRecord({ ...good, schema: 2 }), null, 'wrong schema is refused');
assert.equal(rec.normalizeRecord({ ...good, id: '' }), null, 'a missing id is refused');
assert.equal(rec.normalizeRecord({ ...good, createdAt: 'not a date' }), null, 'bad createdAt is refused');
assert.equal(rec.normalizeRecord({ ...good, updatedAt: 42 }), null, 'a non-string updatedAt is refused');
assert.equal(rec.normalizeRecord({ ...good, preset: { morphs: { custom: [] } } }), null, 'a bare .jslot is refused');
assert.equal(rec.normalizeRecord({ ...good, preset: { format: 'other' } }), null, 'a foreign format is refused');
assert.equal(rec.normalizeRecord({ ...good, thumbnail: 'data:text/html;base64,AAAA' }), null, 'a non-image thumbnail is refused');
assert.equal(
  rec.normalizeRecord({ ...good, thumbnail: 'data:image/png;base64,' + 'A'.repeat(rec.THUMBNAIL_MAX_CHARS) }),
  null,
  'an oversized thumbnail is refused',
);
assert.equal(rec.normalizeRecord(null), null);
assert.equal(rec.normalizeRecord('nope'), null);
assert.equal(rec.normalizeLabel(rec.normalizeRecord({ ...good, label: 9 }).label), 'Untitled', 'a bad label normalizes');
console.log('normalizeRecord matrix: ok');

// ── formatRelativeDate with a fixed clock ──────────────────────────
const clock = new Date('2026-06-01T12:00:00Z');
const ago = (ms) => new Date(clock.getTime() - ms).toISOString();
assert.equal(rec.formatRelativeDate(ago(5_000), clock), 'just now');
assert.equal(rec.formatRelativeDate(ago(5 * 60_000), clock), '5 min ago');
assert.equal(rec.formatRelativeDate(ago(3 * 3_600_000), clock), '3 h ago');
assert.equal(rec.formatRelativeDate(ago(2 * 86_400_000), clock), '2 d ago');
assert.equal(rec.formatRelativeDate(ago(30 * 86_400_000), clock), '2026-05-02');
assert.equal(rec.formatRelativeDate('bogus', clock), '');
console.log('formatRelativeDate: ok');

// ── records.ts stays DOM-free ──────────────────────────────────────
const recSource = fs.readFileSync(path.join(root, 'lib/presets/records.ts'), 'utf8');
for (const forbidden of [/from\s+['"]three['"]/, /from\s+['"]react['"]/, /dynamicStorage/, /\bwindow\./, /\bdocument\./, /\bindexedDB\b/]) {
  assert.ok(!forbidden.test(recSource), `records.ts must not reference ${forbidden}`);
}
const captureSource = fs.readFileSync(path.join(root, 'lib/presets/capture.ts'), 'utf8');
for (const forbidden of ["from 'three'", "from 'react'", 'indexedDB']) {
  assert.ok(!captureSource.includes(forbidden), `capture.ts must not reference ${forbidden}`);
}
console.log('module purity: ok');

// ── capture.ts: square crop geometry and bridge seam ───────────────
function installedCanvas({ width = 256, height = 256, dataUrl, context = true } = {}) {
  const calls = { drawImage: null, toDataURL: [] };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => (context ? { drawImage: (...args) => { calls.drawImage = args; } } : null),
    toDataURL: (...args) => {
      calls.toDataURL.push(args);
      if (dataUrl instanceof Error) throw dataUrl;
      return dataUrl ?? 'data:image/webp;base64,AAAA';
    },
  };
  vmDocument.createElement = () => canvas;
  return { canvas, calls };
}
{
  const { canvas, calls } = installedCanvas({ dataUrl: 'data:image/webp;base64,AAAA' });
  const source = { width: 800, height: 600 };
  const url = capture.toSquareThumbnail(source);
  assert.equal(url, 'data:image/webp;base64,AAAA');
  assert.equal(canvas.width, 256);
  assert.equal(canvas.height, 256);
  // Center crop of 800×600: side 600, x offset (800−600)/2 = 100, y 0.
  assert.equal(JSON.stringify(calls.drawImage), JSON.stringify([source, 100, 0, 600, 600, 0, 0, 256, 256]));
  assert.equal(calls.toDataURL[0][0], 'image/webp');

  // A null 2D context is a clean null, never a throw.
  installedCanvas({ context: false });
  assert.equal(capture.toSquareThumbnail({ width: 800, height: 600 }), null);
  // A tainted/refusing toDataURL is also a clean null.
  installedCanvas({ dataUrl: new Error('tainted') });
  assert.equal(capture.toSquareThumbnail({ width: 800, height: 600 }), null);
  // A zero-sized source cannot be cropped.
  assert.equal(capture.toSquareThumbnail({ width: 0, height: 0 }), null);
}
(async () => {
  // register → capture → unregister, including the throwing-handler guard.
  const handler = async () => 'data:image/webp;base64,FROMBRIDGE';
  capture.registerViewportCapture(handler);
  assert.equal(await capture.captureViewport(), 'data:image/webp;base64,FROMBRIDGE');
  capture.unregisterViewportCapture(async () => 'other');
  assert.equal(await capture.captureViewport(), 'data:image/webp;base64,FROMBRIDGE', 'a foreign handler cannot unregister another');
  capture.unregisterViewportCapture(handler);
  assert.equal(await capture.captureViewport(), null, 'unregistered bridge resolves null');
  const throwing = async () => { throw new Error('bridge failed'); };
  capture.registerViewportCapture(throwing);
  assert.equal(await capture.captureViewport(), null, 'a throwing bridge resolves null');
  capture.unregisterViewportCapture(throwing);
  console.log('capture geometry and bridge: ok');

  await runLibraryTests();
  console.log('preset library: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ── IndexedDB double (test-only) ───────────────────────────────────
function makeFakeIndexedDB(options = {}) {
  const databases = new Map();
  const state = { failPut: options.failPut || false, failOpen: false, blocked: false, closed: 0 };

  function request() {
    return { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
  }

  function makeDb(entry) {
    return {
      objectStoreNames: { contains: (name) => entry.stores.has(name) },
      createObjectStore(name) {
        if (!entry.stores.has(name)) entry.stores.set(name, new Map());
        return {};
      },
      close() { state.closed += 1; },
      transaction(name) {
        const store = entry.stores.get(name);
        if (!store) throw new Error(`no store ${name}`);
        return makeTx(store);
      },
    };
  }

  function makeTx(store) {
    const tx = { oncomplete: null, onabort: null, onerror: null, error: null, aborted: false, _pending: 0, _finished: false };
    const schedule = (work, req) => {
      tx._pending += 1;
      queueMicrotask(() => {
        if (tx.aborted) { tx._pending -= 1; return; }
        try {
          const result = work();
          if (req) {
            req.result = result;
            req.onsuccess && req.onsuccess();
          }
        } catch (err) {
          tx.error = err;
          if (req) { req.error = err; req.onerror && req.onerror(); }
          tx.abort();
        }
        tx._pending -= 1;
        maybeComplete();
      });
      return req;
    };
    const maybeComplete = () => {
      if (tx._finished || tx.aborted || tx._pending > 0) return;
      tx._finished = true;
      queueMicrotask(() => { if (!tx.aborted) tx.oncomplete && tx.oncomplete(); });
    };
    tx.objectStore = () => ({
      getAll() {
        const req = request();
        return schedule(() => [...store.values()].map((v) => JSON.parse(JSON.stringify(v))), req);
      },
      put(value) {
        const req = request();
        return schedule(() => {
          if (state.failPut) {
            const err = { name: 'QuotaExceededError', message: 'Quota exceeded', code: 22 };
            throw err;
          }
          store.set(value.id, JSON.parse(JSON.stringify(value)));
          return value.id;
        }, req);
      },
      delete(key) {
        const req = request();
        return schedule(() => { store.delete(key); return undefined; }, req);
      },
    });
    tx.abort = () => {
      if (tx.aborted) return;
      tx.aborted = true;
      queueMicrotask(() => { tx.onabort && tx.onabort(); });
    };
    // Kick an empty transaction toward completion on the next microtask.
    queueMicrotask(maybeComplete);
    return tx;
  }

  const factory = {
    __state: state,
    __seed(name, records) {
      let entry = databases.get(name);
      if (!entry) { entry = { version: 1, stores: new Map() }; databases.set(name, entry); }
      const store = entry.stores.get('presets');
      const target = store || new Map();
      for (const r of records) target.set(r.id, JSON.parse(JSON.stringify(r)));
      if (!store) entry.stores.set('presets', target);
      return target;
    },
    __reset() { databases.clear(); },
    open(name, version) {
      const req = request();
      queueMicrotask(() => {
        if (state.blocked) { req.onblocked && req.onblocked(); return; }
        if (state.failOpen) { req.error = new Error('open failed'); req.onerror && req.onerror(); return; }
        let entry = databases.get(name);
        if (!entry) { entry = { version: 0, stores: new Map() }; databases.set(name, entry); }
        req.result = makeDb(entry);
        if (entry.version < version) {
          entry.version = version;
          req.onupgradeneeded && req.onupgradeneeded();
        }
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
  return factory;
}

function useIndexedDb(fake) {
  vmWindow.indexedDB = fake;
}

async function runLibraryTests() {
  // Unavailable when the browser has no IndexedDB at all.
  vmWindow.indexedDB = undefined;
  assert.equal((await lib.listPresetRecords()).reason, 'unavailable');
  assert.equal((await lib.savePresetRecord(record)).reason, 'unavailable');
  assert.equal((await lib.deletePresetRecord(record.id)).reason, 'unavailable');
  assert.equal((await lib.savePresetRecord({ ...record, preset: { format: 'other' } })).reason, 'error',
    'an invalid record is refused before opening the database');

  const fake = makeFakeIndexedDB();
  useIndexedDb(fake);

  // Round trip: save → list → delete.
  const hero = rec.makeRecord({ label: 'Hero', preset: built, id: 'hero-1', now: new Date('2026-02-01T00:00:00Z') });
  const saved = await lib.savePresetRecord(hero);
  assert.equal(saved.ok, true);
  assert.equal(saved.value.id, 'hero-1');
  assert.equal(rec.findLabelCollision((await lib.listPresetRecords()).value, 'hero').id, 'hero-1');
  await lib.savePresetRecord(rec.makeRecord({ label: 'Second', preset: built, id: 'hero-2', now: new Date('2026-02-02T00:00:00Z') }));
  let listed = await lib.listPresetRecords();
  assert.equal(listed.ok, true);
  assert.equal(listed.value.length, 2);
  assert.equal(listed.value[0].id, 'hero-2', 'list is sorted newest-first');
  assert.equal((await lib.deletePresetRecord('hero-1')).ok, true);
  listed = await lib.listPresetRecords();
  assert.equal(listed.value.length, 1);
  assert.equal((await lib.deletePresetRecord('missing')).ok, true, 'deleting a missing id succeeds');
  console.log('  save/list/delete: ok');

  // Collision with a different id is refused inside the transaction.
  await lib.savePresetRecord(rec.makeRecord({ label: 'Aria', preset: built, id: 'c1', now: new Date('2026-03-01T00:00:00Z') }));
  const clash = await lib.savePresetRecord(rec.makeRecord({ label: 'aria', preset: built, id: 'c2', now: new Date('2026-03-02T00:00:00Z') }));
  assert.equal(clash.ok, false, 'a duplicate label under a new id is refused');
  assert.equal(clash.reason, 'error');
  assert.equal((await lib.listPresetRecords()).value.some((r) => r.id === 'c2'), false, 'the refused record is not written');
  console.log('  collision: ok');

  // Overwrite keeps id + createdAt, updates updatedAt.
  const overwrite = await lib.savePresetRecord(rec.makeRecord({ label: 'Aria', preset: built, id: 'c1', now: new Date('2026-04-01T00:00:00Z') }));
  assert.equal(overwrite.ok, true);
  assert.equal(overwrite.value.createdAt, '2026-03-01T00:00:00.000Z', 'overwrite preserves createdAt');
  assert.equal(overwrite.value.updatedAt, '2026-04-01T00:00:00.000Z');
  assert.equal((await lib.listPresetRecords()).value.filter((r) => r.label.toLowerCase() === 'aria').length, 1);
  console.log('  overwrite keeps createdAt: ok');

  // Capacity: a new save at 50 is refused; an overwrite of an existing id is allowed.
  fake.__reset();
  const filled = Array.from({ length: 50 }, (_, i) =>
    rec.makeRecord({ label: `P${i}`, preset: built, id: `cap-${i}`, now: new Date('2026-01-01T00:00:00Z') }));
  fake.__seed(lib.PRESET_LIBRARY_DB, filled);
  const full = await lib.savePresetRecord(rec.makeRecord({ label: 'One Too Many', preset: built, id: 'cap-new' }));
  assert.equal(full.ok, false, 'a new save at 50 is refused');
  assert.match(String(full.message), /full/i);
  const refill = await lib.savePresetRecord(rec.makeRecord({ label: 'P0 Renamed', preset: built, id: 'cap-0', now: new Date('2026-05-01T00:00:00Z') }));
  assert.equal(refill.ok, true, 'overwriting an existing record is allowed at capacity');
  assert.equal(refill.value.createdAt, '2026-01-01T00:00:00.000Z');
  console.log('  capacity: ok');

  // Quota: a failing put aborts the transaction and is classified as quota.
  fake.__reset();
  fake.__state.failPut = true;
  const quota = await lib.savePresetRecord(rec.makeRecord({ label: 'Big', preset: built, id: 'q1' }));
  assert.equal(quota.ok, false, 'a quota failure does not resolve as success');
  assert.equal(quota.reason, 'quota');
  fake.__state.failPut = false;

  // A blocked upgrade resolves unavailable instead of hanging.
  fake.__state.blocked = true;
  assert.equal((await lib.listPresetRecords()).reason, 'unavailable', 'a blocked open resolves unavailable');
  fake.__state.blocked = false;
  assert.ok(fake.__state.closed > 0, 'connections are closed after each operation');
  console.log('  quota and blocked open: ok');
}
