// Run: node scripts/check_skin_rendering.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const THREE = require('three');
const moduleCache = new Map();
function load(name) {
  if (moduleCache.has(name)) return moduleCache.get(name).exports;
  const module = { exports: {} }; moduleCache.set(name, module);
  const source = ts.transpileModule(fs.readFileSync(name + '.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, console, process, URLSearchParams,
    require: id => id.startsWith('@/') ? load(id.slice(2)) : require(id) });
  return module.exports;
}
const skin = load('components/scene/SkinShader');
const mat = new THREE.MeshPhysicalMaterial();
skin.applySkinGloss(mat, 0.52, 1);
assert.ok(Math.abs(mat.roughness - 0.532) < 1e-6);
assert.equal(mat.sheen, 0.2);
assert.equal(mat.ior, 1.4);
const standard = new THREE.MeshStandardMaterial();
skin.applySkinGloss(standard, 0.52, 1, 0.2);
assert.equal(standard.sheen, undefined);
assert.equal(standard.clearcoat, undefined);
const detail = new THREE.Texture();
skin.updateSkinDetail(mat, detail, 0.45, 8);
skin.updateSkinGloss(mat, 0.7, 0.5, 0.4);
const compile = () => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  mat.onBeforeCompile(shader, {});
  assert.ok(shader.fragmentShader.includes('tbn * normalize(baseN)'));
  assert.ok(shader.fragmentShader.includes('#elif !defined(USE_NORMALMAP)'));
  assert.ok(shader.fragmentShader.includes('dFdx(vSkinUv)'));
  assert.ok(shader.fragmentShader.includes('reflectedLight.indirectDiffuse *= cavity'));
  assert.ok(!shader.fragmentShader.includes('directSpecular +='));
  return shader;
};
let shader = compile();
assert.equal(shader.uniforms.uSkinDetailMap.value, detail);
assert.equal(shader.uniforms.uSkinDetailStrength.value, 0.45);
skin.updateSkinDetail(mat, detail, 0.2, 4);
assert.equal(shader.uniforms.uSkinDetailScale.value, 4);
skin.updateSkinGloss(mat, 0.3, 0, 0);
assert.equal(shader.uniforms.uSSSAmount.value, 0);
assert.equal(mat.sheen, 0);
shader = compile();
assert.equal(shader.uniforms.uSSSAmount.value, 0);
assert.equal(shader.uniforms.uSkinDetailStrength.value, 0.2);
skin.updateSkinDetail(mat, null, 1);
assert.equal(shader.uniforms.uSkinDetailStrength.value, 0);
const plane = new THREE.PlaneGeometry(1, 1, 2, 2);
skin.attachSkinCavity(plane);
assert.ok([...plane.getAttribute('skinCavity').array].every(v => v === 0));
const sphere = new THREE.SphereGeometry(1, 12, 12);
skin.attachSkinCavity(sphere);
assert.ok([...sphere.getAttribute('skinCavity').array].every(v => v >= 0 && v <= 1));
const store = load('lib/store').useCharacter;
assert.equal(store.getState().toneMapping, 'neutral');
assert.equal(store.getState().envMode, 'studio');
store.getState().setSkinDetail(NaN);
assert.equal(store.getState().skinDetail, 0.45);
store.getState().setSkinDetail(3);
assert.equal(store.getState().skinDetail, 1);
store.getState().setSkinSheen(-1);
assert.equal(store.getState().skinSheen, 0);
store.getState().setToneMapping('invalid');
assert.equal(store.getState().toneMapping, 'neutral');
const session = load('lib/session');
assert.equal(session.SESSION_VERSION, 2);
const saved = JSON.parse(JSON.stringify(session.pickSession(store.getState())));
assert.equal(session.coerceSession(saved, store.getState()).skinDetail, 1);
assert.equal(session.coerceSession({ ...saved, toneMapping: 'bad' }, store.getState()).toneMapping, 'neutral');
console.log('skin materials, shader recompilation, cavity and persisted controls: ok');
