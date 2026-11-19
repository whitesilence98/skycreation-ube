// Run: node scripts/check_outfit_sets.cjs — no browser, server, assets or extra dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const window = {};
const document = {};
const cache = new Map();
const timers = new Set();
function load(name) {
  if (cache.has(name)) return cache.get(name).exports;
  const file = path.join(root, name + '.ts');
  const module = { exports: {} };
  cache.set(name, module);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, console, process, window, document, Blob,
    URL, URLSearchParams, TextEncoder, queueMicrotask,
    setTimeout: (fn, ms) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer; },
    clearTimeout: (timer) => { timers.delete(timer); clearTimeout(timer); },
    require: (id) => id.startsWith('@/') ? load(id.slice(2)) : require(id),
  }, { filename: file });
  return module.exports;
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const records = load('lib/outfits/records');
const library = load('lib/outfits/library');
const bridge = load('lib/outfits/saveRequest');
const { EQUIP_SLOTS } = load('lib/equipment');
const make = (id, label = id, extra = {}) => records.makeOutfitRecord({
  id, label, equipment: { top: 'clothingMesh-top' }, now: new Date('2026-01-01T00:00:00Z'), ...extra,
});
const good = make('good', '  My\n outfit  ', { equipment: { outfit: 'equipped', feet: 'boots' }, clothingMesh: 'legacy' });
assert.equal(records.OUTFIT_SET_LIMIT, 50);
assert.equal(records.OUTFIT_SET_LABEL_MAX, 32);
assert.equal(good.label, 'My outfit');
assert.equal(make('label', '\u{1f600}'.repeat(40)).label.length, 64);
assert.equal(make('blank', '').label, 'Untitled');
assert.deepEqual(plain(records.normalizeOutfitRecord(good)), plain(good));
assert.equal(good.clothingMesh, 'legacy', 'legacy selection is independent of equipment.outfit');
assert.equal(records.normalizeOutfitRecord({ ...good, schema: 2 }), null);
for (const patch of [
  { id: '' }, { id: ' '.repeat(3) }, { id: 'x'.repeat(2000) }, { createdAt: 'bad' }, { updatedAt: 1 },
  { equipment: [] }, { equipment: { weapon: 'id' } }, { equipment: { top: '' } },
  { equipment: { top: ' ' } }, { equipment: { top: 2 } }, { equipment: { top: 'bad\0id' } },
  { equipment: { top: 'x'.repeat(records.OUTFIT_SET_ID_MAX_CHARS + 1) } },
  { clothingMesh: '' }, { clothingMesh: null }, { thumbnail: 'https://example.com/a.png' },
  { thumbnail: 'data:image/svg+xml;base64,AAAA' }, { thumbnail: 'data:text/html;base64,AAAA' },
  { thumbnail: 'data:image/png;base64,' + 'A'.repeat(160_000) },
  { extra: true }, { label: 'x'.repeat(200_000) },
]) assert.equal(records.normalizeOutfitRecord({ ...good, ...patch }), null, JSON.stringify(patch).slice(0, 160));
assert.ok(records.normalizeOutfitRecord({ ...good, thumbnail: 'data:image/webp;base64,AAAA' }));
assert.ok(records.normalizeOutfitRecord({ ...good, equipment: {}, clothingMesh: 'legacy' }));
assert.equal(records.normalizeOutfitRecord({ ...good, equipment: {}, clothingMesh: undefined }), null);
assert.throws(() => make('empty', 'Empty', { equipment: {} }), /valid/);
const alias = records.normalizeOutfitRecord({ ...good, equipment: { full: 'dress', chest: 'shirt', legs: 'pants' } });
assert.deepEqual(plain(alias.equipment), { outfit: 'dress', top: 'shirt', bottom: 'pants' });
assert.ok(records.normalizeOutfitRecord({ ...good, equipment: { chest: 'same', top: 'same' } }));
for (const equipment of [{ chest: 'a', top: 'b' }, { top: 'b', chest: 'a' }]) {
  assert.equal(records.normalizeOutfitRecord({ ...good, equipment }), null, 'alias conflicts reject in either order');
}
const source = fs.readFileSync(path.join(root, 'lib/outfits/records.ts'), 'utf8');
assert.ok(!/\b(?:window|document)\.|from\s+['"](?:three|react)['"]/.test(source));
const a = make('a', 'Aria');
const b = make('b', 'Bram');
assert.equal(records.findOutfitLabelCollision([a, b], '  ARIA ').id, 'a');
assert.equal(records.findOutfitLabelCollision([a], 'aria', 'a'), undefined);
const full = Array.from({ length: 50 }, (_, i) => make(`cap-${i}`));
assert.equal(records.isOutfitLibraryFull(full), true);
assert.equal(records.isOutfitLibraryFull(full, 'cap-0'), false);
assert.equal(records.isOutfitLibraryFull(full, 'missing'), true);
assert.equal(records.isOutfitLibraryFull(full.slice(1)), false);
const newest = make('new', 'Newest', { now: new Date('2026-02-01T00:00:00Z') });
const input = [a, newest, b];
const before = JSON.stringify(input);
assert.deepEqual(plain(records.sortOutfitRecords(input).map((r) => r.id)), ['new', 'a', 'b']);
assert.equal(JSON.stringify(input), before);
assert.equal(records.sortOutfitRecords([{ ...a, createdAt: '2025-01-01' }, b])[0].id, 'b');
assert.deepEqual(plain(records.upsertOutfitRecord([a], b).map((r) => r.id)), ['a', 'b']);
assert.equal(records.upsertOutfitRecord([a], { ...a, label: 'renamed' })[0].label, 'renamed');
assert.equal(a.label, 'Aria');
assert.equal(records.sameOutfit({ top: 't', feet: 'f' }, { feet: 'f', top: 't' }), true);
assert.equal(records.sameOutfit({ top: 't' }, { top: 'other' }), false);
assert.equal(records.sameOutfit({}, {}, 'legacy', undefined), false);
assert.equal(records.sameOutfit({}, {}, 'legacy', 'legacy'), true);
assert.equal(records.sameOutfit({ outfit: 'dress' }, {}, 'legacy', 'legacy'), false);
assert.equal(records.sameOutfit({ outfit: 'dress' }, { outfit: 'dress' }, 'legacy-a', 'legacy-b'), false);
for (const slot of EQUIP_SLOTS) {
  assert.equal(records.sameOutfit({ [slot]: 'worn' }, { [slot]: 'changed' }), false, slot);
}
const file = records.buildOutfitSetFile({ ...good, thumbnail: 'data:image/png;base64,AAAA' });
assert.deepEqual(Object.keys(file).sort(), ['clothingMesh', 'equipment', 'format', 'label', 'version']);
assert.deepEqual(plain(records.parseOutfitSetFile(file)), plain(file));
assert.deepEqual(plain(records.parseOutfitSetFile(JSON.stringify(file))), plain(file));
assert.equal(records.parseOutfitSetFile({ ...file, format: 'lyra-preset' }), null);
for (const patch of [
  { version: 2 }, { version: '1' }, { schema: 2 }, { equipment: {} , clothingMesh: undefined },
  { equipment: { unknown: 'id' } }, { equipment: { top: '' } }, { equipment: { top: null } },
  { equipment: { chest: 'a', top: 'b' } }, { clothingMesh: 9 }, { label: 9 },
  { thumbnail: 'data:image/svg+xml;base64,AAAA' }, { assets: { headMesh: 'foreign' } },
  { label: 'x'.repeat(records.OUTFIT_SET_JSON_MAX_CHARS) },
]) assert.equal(records.parseOutfitSetFile({ ...file, ...patch }), null);
assert.deepEqual(plain(records.parseOutfitSetFile({ ...file, equipment: { chest: 'top' } }).equipment), { top: 'top' });
assert.ok(records.parseOutfitSetFile({ ...file, equipment: {}, clothingMesh: 'legacy' }));
assert.equal(records.parseOutfitSetFile(' '.repeat(records.OUTFIT_SET_JSON_MAX_CHARS) + JSON.stringify(file)), null);
assert.equal(records.parseOutfitSetFile('{'), null);
const cyclic = {}; cyclic.self = cyclic;
assert.equal(records.parseOutfitSetFile(cyclic), null);
assert.equal(records.normalizeOutfitRecord(cyclic), null);
for (const key of ['__proto__', 'constructor', 'prototype']) {
  const badFile = JSON.parse(JSON.stringify(file).replace('{', `{\"${key}\":{},`));
  const badEquipment = JSON.parse(`{\"top\":\"shirt\",\"${key}\":\"foreign\"}`);
  assert.equal(records.parseOutfitSetFile(badFile), null, key);
  assert.equal(records.parseOutfitSetFile({ ...file, equipment: badEquipment }), null, key);
  assert.equal(records.normalizeOutfitRecord({ ...good, equipment: badEquipment }), null, key);
}
for (const raw of [Object.create(file), Object.assign(Object.create({ inherited: true }), file), new Date()]) {
  assert.equal(records.parseOutfitSetFile(raw), null, 'reject inherited/class payloads');
}
assert.equal(records.normalizeOutfitRecord(Object.create(good)), null);
assert.equal(records.parseOutfitSetFile({ ...file, equipment: Object.create({ top: 'inherited' }) }), null);
assert.equal(records.normalizeOutfitRecord({ ...good, equipment: Object.create({ top: 'inherited' }) }), null);
assert.ok(records.parseOutfitSetFile(Object.assign(Object.create(null), file)), 'null-prototype JSON maps remain valid');
assert.equal(records.parseOutfitSetFile({ ...file, [Symbol('hidden')]: true }), null);
assert.equal(records.normalizeOutfitRecord({ ...good, [Symbol('hidden')]: true }), null);
const accessorFile = { ...file };
Object.defineProperty(accessorFile, 'equipment', { enumerable: true, get() { throw new Error('accessor'); } });
assert.equal(records.parseOutfitSetFile(accessorFile), null);
assert.equal(records.normalizeOutfitRecord(Object.defineProperty({ ...good }, 'equipment', {
  enumerable: true, get() { throw new Error('accessor'); },
})), null);
assert.equal({}.polluted, undefined);

// setEquip merges; an all-nine-slot null patch is required for replacement.
const target = make('replacement', 'Replacement', { equipment: { feet: 'new-boots' }, clothingMesh: 'legacy-only' });
const patch = Object.fromEntries(EQUIP_SLOTS.map((slot) => [slot, target.equipment[slot] ?? null]));
assert.equal(Object.keys(patch).length, 9);
const worn = { outfit: 'old-dress', top: 'old-top', feet: 'old-boots' };
for (const [slot, id] of Object.entries(patch)) { if (id) worn[slot] = id; else delete worn[slot]; }
assert.deepEqual(worn, { feet: 'new-boots' });
assert.equal(target.clothingMesh ?? null, 'legacy-only', 'apply independent clothingMesh, never infer outfit');

assert.equal(bridge.requestOutfitSave(), false);
let requested = 0;
const handler = () => { requested++; };
bridge.registerOutfitSaveHandler(handler);
bridge.unregisterOutfitSaveHandler(() => {});
assert.equal(bridge.requestOutfitSave(), true);
assert.equal(requested, 1);
bridge.unregisterOutfitSaveHandler(handler);
assert.equal(bridge.requestOutfitSave(), false);
bridge.registerOutfitSaveHandler(() => { throw new Error('stale panel'); });
assert.equal(bridge.requestOutfitSave(), false);
let refreshed = 0;
const unsubscribeBad = bridge.subscribeOutfitsChanged(() => { throw new Error('stale'); });
const unsubscribe = bridge.subscribeOutfitsChanged(() => refreshed++);
bridge.notifyOutfitsChanged();
assert.equal(refreshed, 1);
unsubscribe(); unsubscribeBad(); bridge.notifyOutfitsChanged();
assert.equal(refreshed, 1);

// Downloads validate before creating any DOM or URL side effects.
const download = load('lib/outfits/download');
let created = 0, clicked = 0, removed = 0, revoked = 0, anchor;
const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
URL.createObjectURL = () => { created++; return 'blob:test'; };
URL.revokeObjectURL = () => { revoked++; };
document.createElement = () => (anchor = { click() { clicked++; }, remove() { removed++; } });
document.body = { appendChild() {} };
window.setTimeout = (fn) => fn();
assert.throws(() => download.downloadOutfitSetJson({ ...file, version: 2 }), /valid/);
assert.equal(created, 0);
download.downloadOutfitSetJson(file);
assert.equal(created, 1); assert.equal(clicked, 1); assert.equal(removed, 1); assert.equal(revoked, 1);
assert.match(anchor.download, /^lyra-outfit-[a-z0-9_-]+\.json$/i);
const createAnchor = document.createElement;
document.createElement = () => { throw new Error('DOM unavailable'); };
assert.throws(() => download.downloadOutfitSetJson(file), /DOM unavailable/);
assert.equal(created, 1, 'DOM failure cannot leak an object URL');
document.createElement = createAnchor;
document.body.appendChild = () => { throw new Error('append failed'); };
assert.throws(() => download.downloadOutfitSetJson(file), /append failed/);
assert.equal(removed, 2); assert.equal(revoked, 2, 'failed download releases its object URL');
URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
console.log('records, validation, equality, replacement, bridges, download: ok');

// Transactional fake: serializes transactions, stages mutations, commits atomically.
function fakeIndexedDB() {
  const rows = new Map();
  const state = { opens: 0, closes: 0, blocked: false, timeout: false, failOpen: false,
    quota: false, lateQuota: false, syncQuota: false, lateAbort: false, transactionQuota: false,
    error: { name: 'QuotaExceededError', code: 22, message: 'Quota' },
    aborted: 0, commits: 0, putSuccess: 0 };
  const pending = [];
  let active = false, upgraded = false;
  function startNext() {
    if (active || !pending.length) return;
    active = true;
    pending.shift()();
  }
  function transaction() {
    const tx = { error: null, oncomplete: null, onabort: null, onerror: null };
    let staged, started = false, ended = false, scheduled = false, queue = [];
    const release = () => { active = false; queueMicrotask(startNext); };
    tx.abort = () => {
      if (ended) return;
      ended = true; state.aborted++;
      queueMicrotask(() => { tx.onabort?.({ target: tx }); release(); });
    };
    const fail = (error, req) => {
      tx.error = error;
      if (req) { req.error = error; req.onerror?.({ target: req }); }
      tx.onerror?.({ target: req ?? tx });
      tx.abort();
    };
    function pump() {
      if (!started || ended || scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (ended) return;
        const job = queue.shift();
        if (job) {
          try {
            job.req.result = job.work();
            job.req.onsuccess?.({ target: job.req });
          } catch (e) { fail(e, job.req); return; }
          pump();
          return;
        }
        if (state.lateQuota) { fail(state.error); return; }
        if (state.lateAbort) { tx.abort(); return; }
        ended = true; rows.clear();
        for (const [id, row] of staged) rows.set(id, row);
        state.commits++;
        tx.oncomplete?.({ target: tx }); release();
      });
    }
    function request(work) {
      const req = { result: undefined, error: null, onsuccess: null, onerror: null };
      queue.push({ req, work }); pump(); return req;
    }
    tx.objectStore = () => ({
      getAll: () => request(() => [...staged.values()].map(plain)),
      put: (row) => {
        if (state.syncQuota) throw state.error;
        return request(() => {
          if (state.quota) throw state.error;
          staged.set(row.id, plain(row)); state.putSuccess++; return row.id;
        });
      },
      delete: (id) => request(() => { staged.delete(id); }),
    });
    pending.push(() => { started = true; staged = new Map([...rows].map(([id, row]) => [id, plain(row)])); pump(); });
    queueMicrotask(startNext);
    return tx;
  }
  const db = {
    objectStoreNames: { contains: () => upgraded },
    createObjectStore(name, options) { assert.equal(name, 'outfits'); assert.equal(options.keyPath, 'id'); upgraded = true; },
    close() { state.closes++; },
    transaction() { if (state.transactionQuota) throw state.error; return transaction(); },
  };
  return {
    state, rows,
    open(name, version) {
      state.opens++; assert.equal(name, 'lyra-outfit-library'); assert.equal(version, 1);
      const req = { result: db, error: null };
      if (state.timeout) return req;
      queueMicrotask(() => {
        if (state.blocked) { req.onblocked?.(); return; }
        if (state.failOpen) { req.onerror?.(); return; }
        if (!upgraded) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}
(async () => {
  window.indexedDB = undefined;
  for (const call of [() => library.listOutfitRecords(), () => library.saveOutfitRecord(good), () => library.deleteOutfitRecord('x')]) {
    assert.equal((await call()).reason, 'unavailable');
  }
  const fake = fakeIndexedDB(); window.indexedDB = fake;
  assert.equal((await library.saveOutfitRecord({ ...good, schema: 99 })).reason, 'error');
  assert.equal(fake.state.opens, 0, 'invalid saves have no storage side effects');
  for (const id of ['', '  ', 'bad\0id']) assert.equal((await library.deleteOutfitRecord(id)).reason, 'error');
  assert.equal((await library.saveOutfitRecord(good)).ok, true);
  assert.deepEqual(plain((await library.listOutfitRecords()).value), [plain(good)]);
  const updated = await library.saveOutfitRecord(make('good', 'Updated', { now: new Date('2026-03-01T00:00:00Z') }));
  assert.equal(updated.ok, true); assert.equal(updated.value.createdAt, good.createdAt);
  assert.equal(updated.value.updatedAt, '2026-03-01T00:00:00.000Z');
  assert.equal((await library.deleteOutfitRecord('good')).ok, true);
  assert.equal((await library.deleteOutfitRecord('missing')).ok, true);
  assert.equal((await library.listOutfitRecords()).value.length, 0);

  const results = await Promise.all([library.saveOutfitRecord(make('race-a', 'Same')), library.saveOutfitRecord(make('race-b', 'same'))]);
  assert.equal(results.filter((r) => r.ok).length, 1, 'concurrent duplicate labels cannot both commit');
  assert.equal(fake.rows.size, 1);
  assert.match(results.find((r) => !r.ok).message, /already exists/);
  fake.rows.clear();
  for (const row of full.slice(0, 49)) fake.rows.set(row.id, plain(row));
  const caps = await Promise.all([library.saveOutfitRecord(make('last-a')), library.saveOutfitRecord(make('last-b'))]);
  assert.equal(caps.filter((r) => r.ok).length, 1, 'concurrent new saves cannot exceed cap');
  assert.equal(fake.rows.size, 50);
  assert.match(caps.find((r) => !r.ok).message, /full/);
  assert.equal((await library.saveOutfitRecord(make('cap-0', 'Renamed'))).ok, true, 'updates allowed at capacity');
  fake.rows.clear();
  fake.rows.set('corrupt', { id: 'corrupt', schema: 99 });
  assert.equal((await library.listOutfitRecords()).value.length, 0);
  assert.equal((await library.saveOutfitRecord(make('legacy', 'Legacy', { equipment: {}, clothingMesh: 'whole' }))).ok, true);
  assert.equal((await library.listOutfitRecords()).value[0].clothingMesh, 'whole');
  for (const mode of ['quota', 'lateQuota', 'syncQuota', 'transactionQuota']) {
    fake.state[mode] = true;
    const successes = fake.state.putSuccess;
    const opens = fake.state.opens;
    const result = await library.saveOutfitRecord(make(`failure-${mode}`));
    assert.equal(fake.state.opens, opens + 1, 'data layer never retries quota writes');
    assert.equal(result.ok, false, mode); assert.equal(result.reason, 'quota', mode);
    assert.equal(fake.rows.has(`failure-${mode}`), false, 'aborts roll back mutations');
    if (mode === 'lateQuota') assert.ok(fake.state.putSuccess > successes, 'put success preceded quota abort');
    fake.state[mode] = false;
  }
  fake.state.lateAbort = true;
  const beforeAbort = JSON.stringify([...fake.rows]);
  const writesBeforeAbort = fake.state.putSuccess;
  assert.equal((await library.saveOutfitRecord(make('late-abort'))).reason, 'error');
  assert.equal(fake.state.putSuccess, writesBeforeAbort + 1, 'request success is not transaction success');
  assert.equal((await library.deleteOutfitRecord('legacy')).reason, 'error');
  assert.equal((await library.listOutfitRecords()).reason, 'error');
  assert.equal(JSON.stringify([...fake.rows]), beforeAbort, 'late abort rolls back every staged operation');
  fake.state.lateAbort = false;
  const originalError = fake.state.error;
  for (const error of [
    { name: 'NS_ERROR_DOM_QUOTA_REACHED' }, { code: 22 },
    { name: 'UnknownError', message: 'storage failure' },
  ]) {
    fake.state.error = error; fake.state.quota = true;
    assert.equal((await library.saveOutfitRecord(make('error-kind'))).reason,
      error.name === 'UnknownError' ? 'error' : 'quota');
  }
  fake.state.error = originalError; fake.state.quota = false;
  fake.state.lateQuota = true;
  assert.equal((await library.deleteOutfitRecord('legacy')).reason, 'quota');
  assert.ok(fake.rows.has('legacy'), 'delete abort preserves record');
  assert.equal((await library.listOutfitRecords()).reason, 'quota', 'list does not report success before complete');
  fake.state.lateQuota = false;
  for (const mode of ['blocked', 'failOpen', 'timeout']) {
    fake.state[mode] = true;
    assert.equal((await library.listOutfitRecords()).reason, 'unavailable', mode);
    fake.state[mode] = false;
  }
  const closesBefore = fake.state.closes;
  window.indexedDB = { open() {
    const req = { result: { close() { fake.state.closes++; } } };
    queueMicrotask(() => { req.onblocked(); queueMicrotask(() => req.onsuccess()); });
    return req;
  } };
  assert.equal((await library.listOutfitRecords()).reason, 'unavailable');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(fake.state.closes > closesBefore, 'late successful open closes connection');
  for (const outcome of ['blocked', 'timeout']) {
    const late = { closes: 0, aborts: 0, creates: 0 };
    let request;
    window.indexedDB = { open() {
      request = {
        result: {
          close() { late.closes++; },
          objectStoreNames: { contains: () => false },
          createObjectStore() { late.creates++; },
        },
        transaction: { abort() { late.aborts++; } },
      };
      if (outcome === 'blocked') queueMicrotask(() => request.onblocked());
      return request;
    } };
    assert.equal((await library.listOutfitRecords()).reason, 'unavailable', outcome);
    request.onupgradeneeded();
    assert.equal(late.aborts, 1, 'late upgrade aborted');
    assert.equal(late.creates, 0, 'timed-out/blocked open cannot create a store later');
    request.onsuccess();
    assert.equal(late.closes, 2, 'late upgrade and success close their connection');
    request.result.onversionchange();
    assert.equal(late.closes, 3, 'versionchange releases its connection');
  }
  assert.equal(timers.size, 0, 'open timers cleared');
  console.log('atomic save/list/delete, collisions, cap, creation date, quota aborts, blocked/timeout: ok');
  console.log('outfit sets: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
