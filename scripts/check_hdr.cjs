// Run: node scripts/check_hdr.cjs (no server, browser, GPU or external HDR assets).
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
  }).outputText, { module, exports: module.exports, console, process, URLSearchParams, TextDecoder,
    require: id => id.startsWith('@/') ? load(id.slice(2)) : require(id),
  }, { filename: file });
  return module.exports;
}
const hdr = load('lib/hdr');
const arrayBuffer = bytes => Uint8Array.from(bytes).buffer;
const radiance = (w, h) => arrayBuffer(Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`));
assert.equal(hdr.hdrFormat('STUDIO.HDR', 100), 'hdr');
assert.equal(hdr.hdrFormat('studio.exr', 100), 'exr');
for (const [name, size] of [['x.jpg', 100], ['x.hdr', 0], ['x.exr', 33 * 1024 * 1024], ['x.hdr', NaN]]) {
  assert.throws(() => hdr.hdrFormat(name, size));
}
assert.equal(hdr.inspectHdrHeader(radiance(4096, 2048), 'hdr').width, 4096);
assert.throws(() => hdr.inspectHdrHeader(radiance(8192, 4096), 'hdr'));
assert.throws(() => hdr.inspectHdrHeader(arrayBuffer(Buffer.from('not an HDR')), 'hdr'));
assert.throws(() => hdr.inspectHdrHeader(radiance(0, 12), 'hdr'));
function exr(width, height, flags = 2) {
  const header = Buffer.alloc(8); header.writeUInt32LE(20000630); header.writeUInt32LE(flags, 4);
  const window = Buffer.alloc(16); window.writeInt32LE(width - 1, 8); window.writeInt32LE(height - 1, 12);
  const size = Buffer.alloc(4); size.writeUInt32LE(16);
  return arrayBuffer(Buffer.concat([header, Buffer.from('dataWindow\0box2i\0'), size, window, Buffer.from([0])]));
}
assert.equal(hdr.inspectHdrHeader(exr(1024, 512), 'exr').height, 512);
assert.throws(() => hdr.inspectHdrHeader(exr(9000, 512), 'exr'));
assert.throws(() => hdr.inspectHdrHeader(exr(1024, 512, 2 | 0x1000), 'exr'));
assert.throws(() => hdr.inspectHdrHeader(exr(1024, 512).slice(0, 20), 'exr'));
const { useCharacter } = load('lib/store');
const session = load('lib/session');
const state = useCharacter.getState;
assert.equal(state().exposure, 1);
state().setExposure(50); assert.equal(state().exposure, 4);
state().setExposure(-1); assert.equal(state().exposure, 0.1);
state().setExposure(1.25); state().setExposure(NaN); assert.equal(state().exposure, 1.25);
state().setEnvRotation(-20); assert.equal(state().envRotation, 340);
state().setEnvIntensity(99); assert.equal(state().envIntensity, 2);
const saved = session.pickSession(state());
assert.equal(session.coerceSession(saved, saved).exposure, 1.25);
const old = { ...saved }; delete old.exposure;
assert.equal(session.coerceSession(old, { ...saved, exposure: 1 }).exposure, 1);
const { useHdr } = load('lib/hdrState');
useHdr.getState().setSource({ name: 'test.hdr', format: 'hdr', buffer: radiance(2, 1) });
assert.equal(useHdr.getState().status, 'loading');
assert.ok(!JSON.stringify(session.pickSession(state())).includes('test.hdr'), 'raw HDR data must not enter session');
useHdr.getState().setSource(null);
assert.equal(useHdr.getState().status, 'studio');
assert.equal(useHdr.getState().source, null);

(async () => {
  // Exercise the installed real Radiance decoder with a tiny RGBE panorama.
  const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
  const bytes = Buffer.concat([Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n'), Buffer.from([128, 128, 128, 129, 64, 64, 64, 129])]);
  const texture = new HDRLoader().createDataTexture(arrayBuffer(bytes));
  assert.equal(texture.image.width, 2); assert.equal(texture.image.height, 1);
  assert.ok(texture.image.data.length > 0); texture.dispose();
  console.log('PASS: HDR/EXR header limits, invalid files, real HDR decode, exposure bounds, settings round-trip, transient source');
  console.log('NOT ASSESSED: EXR pixel decoding, GPU PMREM/disposal, reflected appearance, composer exposure output, browser panel layout');
})().catch(error => { console.error(error); process.exitCode = 1; });
