// Run: node scripts/check_lighting.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), cache = new Map();
function load(name) {
  const file = path.join(root, name + '.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, console, process, URLSearchParams,
    require: id => id.startsWith('@/') ? load(id.slice(2)) : id.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(file), id)).split(path.sep).join('/')) : require(id),
  }, { filename: file });
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const { LIGHTING_DEFAULTS: defaults, LIGHT_RIGS, rigDirections } = load('lib/lighting');
const base = rigDirections(defaults);
assert.deepEqual(plain(base), { key: [0.55, 0.75, 1], fill: [-0.85, 0.25, 0.7], rim: [-0.35, 0.65, -0.95], bounce: [0.1, -0.65, 0.85] });
for (const [name, v] of Object.entries(rigDirections({ azimuth: 180, elevation: 0 }))) {
  assert.ok(Math.abs(v[0] + base[name][0]) < 1e-9);
  assert.ok(Math.abs(v[2] + base[name][2]) < 1e-9);
}
assert.ok(rigDirections({ azimuth: 0, elevation: 45 }).key[1] > base.key[1]);
for (const [name, v] of Object.entries(rigDirections({ azimuth: 115, elevation: -37 }))) assert.ok(Math.abs(Math.hypot(...v) - Math.hypot(...base[name])) < 1e-9);
assert.equal(new Set(LIGHT_RIGS.map(r => r.id)).size, LIGHT_RIGS.length);
const { cameraSpherical, YAW_PRESETS, PITCH_PRESETS } = load('lib/camera');
for (const { yaw } of YAW_PRESETS) for (const { pitch } of PITCH_PRESETS) {
  const r = 1.23, t = { x: 0, y: -0.15, z: 0 };
  const p = { x: r * Math.cos(pitch) * Math.sin(yaw), y: t.y - r * Math.sin(pitch), z: r * Math.cos(pitch) * Math.cos(yaw) };
  const view = cameraSpherical(p, t);
  assert.ok(Math.abs(view.yawDeg - yaw * 180 / Math.PI) < 1e-9);
  assert.ok(Math.abs(view.pitchDeg - pitch * 180 / Math.PI) < 1e-9);
  assert.ok(Math.abs(view.distance - r) < 1e-9);
}
const store = load('lib/store').useCharacter;
store.getState().setLighting({ intensity: 20, fill: -2, rim: 8, azimuth: 370, elevation: 90, keyColor: 'red', invented: true });
assert.deepEqual(plain(store.getState().lighting), { intensity: 2, fill: 0, rim: 2, azimuth: 10, elevation: 45, keyColor: '#fff6ed' });
const before = plain(store.getState().lighting);
store.getState().setLighting({ intensity: NaN, fill: Infinity, azimuth: -Infinity, elevation: NaN, keyColor: '#aBc123' });
assert.deepEqual(plain(store.getState().lighting), { ...before, keyColor: '#aBc123' });
store.getState().setEnvIntensity(8); assert.equal(store.getState().envIntensity, 2);
store.getState().setEnvIntensity(NaN); assert.equal(store.getState().envIntensity, 2);
store.getState().setCameraRotateSpeed(-2); assert.equal(store.getState().cameraRotateSpeed, 0.15);
store.getState().setCameraRotateSpeed(Infinity); assert.equal(store.getState().cameraRotateSpeed, 0.15);
store.getState().setEnvRotation(-10); assert.equal(store.getState().envRotation, 350);
const { pickSession, coerceSession } = load('lib/session');
const live = store.getState(), saved = plain(pickSession(live));
assert.deepEqual(saved.lighting, plain(live.lighting));
assert.equal(saved.cameraRotateSpeed, 0.15);
assert.equal(saved.envIntensity, 2);
assert.equal(saved.cameraPoseRequest, undefined);
assert.deepEqual(plain(coerceSession(saved, live).lighting), saved.lighting);
const legacy = { ...saved }; delete legacy.lighting; delete legacy.envIntensity; delete legacy.cameraRotateSpeed;
const restored = coerceSession(legacy, { ...live, lighting: defaults, envIntensity: 1, cameraRotateSpeed: 0.42 });
assert.deepEqual(plain(restored.lighting), plain(defaults));
assert.equal(restored.envIntensity, 1); assert.equal(restored.cameraRotateSpeed, 0.42);
assert.equal(live.snapshotPreset().lighting, undefined);
console.log('lighting directions, camera round-trip, setters and session compatibility: ok');
