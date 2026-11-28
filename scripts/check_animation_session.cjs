// Run: node scripts/check_animation_session.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const cache = new Map();
function load(name) {
  const normalized = name.replace(/\\/g, '/').replace(/\.ts$/, '');
  if (normalized.endsWith('.json')) {
    return JSON.parse(fs.readFileSync(normalized, 'utf8'));
  }
  if (cache.has(normalized)) return cache.get(normalized).exports;
  const module = { exports: {} }; cache.set(normalized, module);
  const source = ts.transpileModule(fs.readFileSync(normalized + '.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const currentDir = path.dirname(normalized);
  vm.runInNewContext(source, { module, exports: module.exports, console, process, URLSearchParams,
    require: id => {
      if (id.endsWith('.json')) {
        const jsonPath = id.startsWith('@/') ? id.slice(2) : path.join(currentDir, id);
        const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        return { default: parsed, ...parsed };
      }
      if (id.startsWith('@/')) return load(id.slice(2));
      if (id.startsWith('./') || id.startsWith('../')) return load(path.join(currentDir, id));
      return require(id);
    } });
  return module.exports;
}
const store = load('lib/store').useCharacter;
const { pickSession, coerceSession } = load('lib/session');
assert.equal(store.getState().animationId, 'idle');
assert.equal(store.getState().animationPlaying, true);
assert.equal(store.getState().autoRigUnskinned, true);
store.getState().setAnimationId('invalid');
assert.equal(store.getState().animationId, 'idle');
for (const value of [NaN, Infinity, -Infinity]) store.getState().setAnimationSpeed(value);
assert.equal(store.getState().animationSpeed, 1);
store.getState().setAnimationSpeed(-1);
assert.equal(store.getState().animationSpeed, 0.2);
store.getState().setAnimationSpeed(5);
assert.equal(store.getState().animationSpeed, 2);
store.getState().setAnimationId('selfie');
assert.equal(store.getState().animationId, 'selfie');
store.getState().setAnimationId('idle-clip');
assert.equal(store.getState().animationId, 'idle-clip');
store.getState().setAnimationId('rest');
store.getState().setAnimationPlaying(false);
store.getState().setAutoRigUnskinned(false);
const saved = JSON.parse(JSON.stringify(pickSession(store.getState())));
assert.equal(coerceSession({ ...saved, animationId: 'walk' }, store.getState()).animationId, 'idle-clip');
assert.equal(coerceSession({ ...saved, animationId: 'run' }, store.getState()).animationId, 'idle-clip');
assert.equal(coerceSession({ ...saved, animationId: 'selfie' }, store.getState()).animationId, 'selfie');
const restored = coerceSession(saved, store.getState());
for (const key of ['animationId', 'animationPlaying', 'animationSpeed', 'autoRigUnskinned']) {
  assert.equal(restored[key], saved[key], key + ' round trip');
}
const repaired = coerceSession({ ...saved, animationId: 'bogus', animationPlaying: 'yes', animationSpeed: null, autoRigUnskinned: 1 }, store.getState());
assert.equal(repaired.animationId, 'rest');
assert.equal(repaired.animationPlaying, false);
assert.equal(repaired.animationSpeed, 2);
assert.equal(repaired.autoRigUnskinned, false);
assert.equal(coerceSession({ ...saved, animationSpeed: -10 }, store.getState()).animationSpeed, 0.2);
assert.equal(coerceSession({ ...saved, animationSpeed: 10 }, store.getState()).animationSpeed, 2);
const legacy = { ...saved };
for (const key of ['animationId', 'animationPlaying', 'animationSpeed', 'autoRigUnskinned']) delete legacy[key];
assert.equal(coerceSession(legacy, store.getState()).animationId, 'rest');
console.log('animation controls, bounds and session round trip: ok');
