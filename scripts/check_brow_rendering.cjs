// Run: node scripts/check_brow_rendering.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const THREE = require('three');
const root = path.resolve(__dirname, '..'), cache = new Map();
let canvasPixels;
function load(name) {
  const file = path.join(root, name + '.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, console, process, URLSearchParams,
    document: { createElement: () => ({ getContext: () => ({
      drawImage() {}, getImageData: () => ({ data: canvasPixels }), putImageData() {},
    }) }) },
    require: id => id.startsWith('@/') ? load(id.slice(2)) : require(id),
  }, { filename: file });
  return module.exports;
}
const { createRig, applyFacialWeights, poseRegionBone } = load('lib/head/rig');
const { createBrowMesh, prepareBrowTexture } = load('lib/head/brows');
const { REGIONS, SLIDER_DEFS } = load('lib/regions');
function geometry(data) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  if (data.indices) g.setIndex(data.indices);
  return g;
}
const restPose = { offset: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] };
function pose(rig, bank) {
  for (const region of REGIONS) for (const key of rig.regionBoneKeys[region.id]) {
    poseRegionBone(rig, key, region.id, SLIDER_DEFS, bank(region), restPose);
  }
  rig.root.updateMatrixWorld(true); rig.skeleton.update();
}
const sample = geometry({ positions: [-0.02, 0.037, 0.075, 0.02, 0.037, 0.075], normals: [0, 0, 1, 0, 0, 1] });
const rig = createRig(sample.clone());
const weights = sample.clone(); applyFacialWeights(weights, rig.skeleton.bones);
for (const field of ['skinIndex', 'skinWeight']) {
  assert.deepEqual([...weights.getAttribute(field).array], [...rig.mesh.geometry.getAttribute(field).array]);
}
pose(rig, region => ({ ...region.defaults, height: 1, protrusion: 1 }));
rig.root.position.set(0.13, -0.09, 0.04); rig.root.rotation.set(0.2, -0.3, 0.1);
rig.root.updateMatrixWorld(true);
const inverses = rig.skeleton.boneInverses.map(m => m.elements.slice());
const before = [...sample.getAttribute('position').array];
const brows = createBrowMesh(sample, rig); rig.root.add(brows); rig.root.updateMatrixWorld(true);
assert.equal(brows.skeleton, rig.skeleton);
assert.deepEqual(rig.skeleton.boneInverses.map(m => m.elements), inverses, 'late binding must not change head rest inverses');
assert.deepEqual([...sample.getAttribute('position').array], before, 'source geometry unchanged');
const second = createBrowMesh(sample, rig);
assert.deepEqual([...brows.geometry.getAttribute('position').array], [...second.geometry.getAttribute('position').array], 'clearance never accumulates');
for (let i = 0; i < 2; i++) {
  const rest = new THREE.Vector3().fromBufferAttribute(sample.getAttribute('position'), i);
  const actual = new THREE.Vector3().fromBufferAttribute(brows.geometry.getAttribute('position'), i);
  assert.ok(Math.abs(actual.distanceTo(rest) - 0.0008) < 1e-7);
  // A zero-clearance overlay must deform exactly like the matching head vertex.
  const shifted = actual.clone().sub(new THREE.Vector3(0, 0, 0.0008));
  const headPoint = rig.mesh.applyBoneTransform(i, rest.clone()).applyMatrix4(rig.mesh.matrixWorld);
  const browPoint = brows.applyBoneTransform(i, shifted).applyMatrix4(brows.matrixWorld);
  assert.ok(headPoint.distanceTo(browPoint) < 1e-7, 'shared pose and root transform applied exactly once');
}
canvasPixels = new Uint8ClampedArray([57, 48, 33, 140, 0, 0, 0, 0, 99, 70, 40, 255]);
const texture = new THREE.Texture({ width: 3, height: 1 });
texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
prepareBrowTexture(texture);
assert.deepEqual([...canvasPixels], [255, 255, 255, 140, 255, 255, 255, 0, 255, 255, 255, 255]);
assert.equal(texture.wrapS, THREE.RepeatWrapping);
assert.equal(texture.image.width, 3);
assert.ok(texture.version > 0);
console.log('PASS weights, late binding, shared root, immutable source, fixed clearance, tint alpha');

const exportFile = path.join(root, 'lib/exportGlb.ts');
const exportSource = ts.createSourceFile(exportFile, fs.readFileSync(exportFile, 'utf8'), ts.ScriptTarget.Latest, true);
const exportFunction = exportSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createHeadSkinnedMesh');
const exportModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(exportFunction.getText(exportSource), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: exportModule, exports: exportModule.exports, THREE });
const rootBone = new THREE.Bone(), headBone = new THREE.Bone(); rootBone.add(headBone);
rootBone.updateMatrixWorld(true);
const exported = exportModule.exports.createHeadSkinnedMesh(brows, 'Brows', rootBone, headBone, headBone.matrixWorld.clone());
const exportedPosition = exported.geometry.getAttribute('position');
for (let i = 0; i < 2; i++) {
  const expected = brows.getVertexPosition(i, new THREE.Vector3());
  assert.ok(expected.distanceTo(new THREE.Vector3().fromBufferAttribute(exportedPosition, i)) < 1e-7,
    'GLB must bake facial pose before replacing weights with the unified head bone');
}
assert.deepEqual([...sample.getAttribute('position').array], before, 'export never mutates source positions');
console.log('PASS export preserves posed brow geometry under animated root');

// Real fitted default pair: ray-test a grid across every brow triangle against the deformed face.
const read = file => JSON.parse(fs.readFileSync(path.join(root, 'public/assets/preset-pack/meshes', file), 'utf8'));
const headData = read('headMesh-52e201357614eaf7-face.json');
const browData = read('headMesh-52e201357614eaf7-face-brows.json');
const realRig = createRig(geometry(headData));
const realBrows = createBrowMesh(geometry(browData), realRig); realRig.root.add(realBrows);
function deformed(mesh) {
  const pos = mesh.geometry.getAttribute('position');
  return Array.from({ length: pos.count }, (_, i) => mesh.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(pos, i)));
}
function headZ(points, x, y) {
  let z = -Infinity;
  for (let t = 0; t < headData.indices.length; t += 3) {
    const a = points[headData.indices[t]], b = points[headData.indices[t + 1]], c = points[headData.indices[t + 2]];
    const bx = b.x - a.x, by = b.y - a.y, cx = c.x - a.x, cy = c.y - a.y;
    const den = bx * cy - cx * by;
    if (Math.abs(den) < 1e-14) continue;
    const u = ((x - a.x) * cy - (y - a.y) * cx) / den;
    const v = ((y - a.y) * bx - (x - a.x) * by) / den;
    if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
    z = Math.max(z, a.z + u * (b.z - a.z) + v * (c.z - a.z));
  }
  return z;
}
const zeros = Object.fromEntries(SLIDER_DEFS.map(d => [d.id, 0]));
// Inspect visible strands, not the fully transparent margins of the brow cards.
const alpha = JSON.parse(require('node:child_process').execFileSync('python', ['-I', '-c',
  "from PIL import Image; import json; im=Image.open('public/assets/preset-pack/textures/brows/brows.webp').convert('RGBA'); print(json.dumps({'w':im.width,'h':im.height,'a':list(im.getchannel('A').tobytes())}))",
], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
const cases = [
  ['rest', () => zeros], ['defaults', r => r.defaults],
  ['brow minimum', r => r.id === 'eyebrows' ? Object.fromEntries(SLIDER_DEFS.map(d => [d.id, d.min])) : zeros],
];
for (const def of SLIDER_DEFS) for (const endpoint of [def.min, def.max]) {
  cases.push([`${def.id} ${endpoint}`, r => ({ ...zeros, ...(r.id === 'eyebrows' ? { [def.id]: endpoint } : {}) })]);
}
// Combined maxima can fold the underlying face itself; report, never claim collision-free coverage.
cases.push(['combined maxima (diagnostic)', r => r.id === 'eyebrows' ? Object.fromEntries(SLIDER_DEFS.map(d => [d.id, d.max])) : zeros]);
for (const [label, bank] of cases) {
  pose(realRig, bank);
  const hp = deformed(realRig.mesh), bp = deformed(realBrows);
  let worst = Infinity, buried = 0, total = 0, missed = 0;
  for (let t = 0; t < browData.indices.length; t += 3) {
    const a = bp[browData.indices[t]], b = bp[browData.indices[t + 1]], c = bp[browData.indices[t + 2]];
    for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2 - i; j++) {
      const p = a.clone().multiplyScalar(1 - i / 2 - j / 2).addScaledVector(b, i / 2).addScaledVector(c, j / 2);
      const ids = browData.indices.slice(t, t + 3), mix = [1 - i / 2 - j / 2, i / 2, j / 2];
      let u = 0, v = 0;
      for (let k = 0; k < 3; k++) { u += browData.uvs[ids[k] * 2] * mix[k]; v += browData.uvs[ids[k] * 2 + 1] * mix[k]; }
      u = ((u % 1) + 1) % 1; v = ((v % 1) + 1) % 1;
      const px = Math.min(alpha.w - 1, Math.floor(u * alpha.w)), py = Math.min(alpha.h - 1, Math.floor((1 - v) * alpha.h));
      if (alpha.a[py * alpha.w + px] < 32) continue;
      const z = headZ(hp, p.x, p.y);
      if (!Number.isFinite(z)) { missed++; continue; }
      const clearance = p.z - z; worst = Math.min(worst, clearance); total++;
      if (clearance < -0.00001) buried++;
    }
  }
  console.log(`${label}: ${buried}/${total} buried; worst ${(worst * 1000).toFixed(3)} mm; ${missed} ray misses`);
  assert.ok(total > 500, 'visible strand coverage');
  assert.equal(missed, 0, 'all visible samples hit the face');
  if (!label.includes('diagnostic')) assert.equal(buried, 0, `${label}: visible brow intersects face`);
}
const component = fs.readFileSync(path.join(root, 'components/scene/HeadModel.tsx'), 'utf8');
assert.match(component, /<primitive object=\{browsMesh\}[^>]*dispose=\{null\}/);
assert.match(component, /prepareBrowTexture\(browsMaterial\.map\)/);
console.log('PASS fitted brow visibility; browser appearance still requires visual inspection');
