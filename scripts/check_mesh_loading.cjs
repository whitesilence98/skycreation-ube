// Run: node scripts/check_mesh_loading.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const THREE = require('three');
const source = path.resolve(__dirname, '../components/scene/useMeshGeometry.ts');
const data = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  uvs: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2],
};
const effects = [];
const writes = [];
const images = [];
let requests = 0;
let resolveFetch;
const moduleUnderTest = { exports: {} };
const react = {
  useEffect: fn => effects.push(fn),
  useRef: value => ({ current: value }),
  useState: initial => {
    let value = typeof initial === 'function' ? initial() : initial;
    return [value, next => {
      value = typeof next === 'function' ? next(value) : next;
      writes.push(value);
    }];
  },
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  module: moduleUnderTest, exports: moduleUnderTest.exports, Float32Array,
  console: { ...console, error() {} },
  fetch: () => { requests++; return new Promise(resolve => { resolveFetch = resolve; }); },
  Image: class { constructor() { images.push(this); } },
  require: id => id === 'react' ? react : id === 'three' ? THREE
    : id.endsWith('/dynamicSculpt') ? { getDynamicMesh() {}, registerDynamicMesh() {} }
    : id.endsWith('/dynamicStorage') ? { retrieveDynamicMesh: async () => undefined }
    : require(id),
}, { filename: source });
const { meshDataToGeometry, useMeshResource, preloadTextureAsync } = moduleUnderTest.exports;
const tick = () => new Promise(resolve => setImmediate(resolve));
async function main() {
  const mesh = meshDataToGeometry(data);
  assert.equal(mesh.geometry.getAttribute('position').array, mesh.positions,
    'geometry must not copy the freshly allocated positions again');
  assert.throws(() => meshDataToGeometry({ ...data, normals: new Float32Array([NaN, ...data.normals.slice(1)]) }));
  const sparse = [...data.positions]; delete sparse[1];
  assert.throws(() => meshDataToGeometry({ ...data, positions: sparse }));
  assert.throws(() => meshDataToGeometry({ ...data, indices: [0, 1, 99] }));
  mesh.geometry.dispose();

  const first = preloadTextureAsync('/assets/a.webp');
  assert.equal(first, preloadTextureAsync('/assets/a.webp'), 'concurrent image preloads share completion');
  images[0].onload(); await first;
  const failed = preloadTextureAsync('/assets/retry.webp');
  images[1].onerror(); await failed;
  const retry = preloadTextureAsync('/assets/retry.webp');
  assert.notEqual(retry, failed, 'failed preload can retry');
  images[2].onload(); await retry;

  useMeshResource('/assets/shared.json', 'head');
  useMeshResource('/assets/shared.json', 'head');
  const cleanups = effects.splice(0).map(effect => effect());
  assert.equal(requests, 1, 'StrictMode/concurrent mounts share fetch and JSON parse');
  cleanups[0](); // First mount disappears before response.
  resolveFetch({ ok: true, json: async () => data });
  await tick();
  const loaded = writes.filter(value => value?.mesh);
  assert.equal(loaded.length, 1, 'cancelled mount must not publish geometry');
  assert.equal(writes.at(-1).settled, true);
  cleanups[3]();

  useMeshResource('/assets/shared.json', 'cached head');
  const cachedCleanups = effects.splice(0).map(effect => effect());
  cachedCleanups[0](); // Even cache hits must provide a cancellation cleanup.
  assert.equal(typeof cachedCleanups[0], 'function');
  cachedCleanups[1]();

  useMeshResource('/assets/broken.json', 'broken');
  effects.splice(0).forEach(effect => effect());
  resolveFetch({ ok: true, json: async () => ({ ...data, positions: [NaN] }) });
  await tick();
  assert.match(writes.at(-1).error, /malformed mesh data/);
  assert.equal(writes.at(-1).settled, true, 'async decode errors settle instead of leaving loader stuck');
  console.log('mesh loading: ok (validation, shared requests, cancellation, preload retry, async errors)');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
