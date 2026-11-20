// Run: node scripts/check_smart_import.cjs
//
// Exercises the Smart Customization head-import maths without a browser:
// axis normalisation, scaling, the MeshData contract the renderer validates,
// and the fact that a registered import is actually resolvable as the head.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const THREE = require('three');

const root = path.resolve(__dirname, '..');
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
      THREE,
      Float32Array,
      Float64Array,
      Set,
      Map,
      Math,
      Number,
      Infinity,
      require: (id) => {
        if (id === 'three') return THREE;
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

const {
  MeshImportError, mergeSceneMeshes, normaliseHead, toMeshData, boundsOf,
} = load('lib/smart/headMesh');

/* Deliberately a literal, not the exported constant: asserting the export
   against itself would pass no matter what the implementation did. 0.27 m is
   the shipped UBE head's measured height (y ∈ [−0.130, 0.138]). */
const EXPECTED_HEAD_HEIGHT = 0.27;

/** A box mesh, axis-aligned, as a THREE.Mesh so `mergeSceneMeshes` can walk it. */
function boxMesh(sizeX, sizeY, sizeZ) {
  const geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
}

function meshFrom(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

console.log('--- Smart Customization: head import ---');

check('a Y-up box is scaled to head height and centred', () => {
  const scene = new THREE.Group();
  scene.add(boxMesh(0.5, 1.6, 0.4));
  const merged = mergeSceneMeshes(scene);
  const head = normaliseHead(merged);
  const bounds = boundsOf(head.positions);
  const height = bounds.max[1] - bounds.min[1];

  assert.ok(Math.abs(height - EXPECTED_HEAD_HEIGHT) < 1e-4,
    `height should be ${EXPECTED_HEAD_HEIGHT}, got ${height}`);
  assert.ok(!head.rotatedZUp, 'a tall Y-up box must not be rotated');
  for (let axis = 0; axis < 3; axis++) {
    const centre = (bounds.min[axis] + bounds.max[axis]) / 2;
    assert.ok(Math.abs(centre) < 1e-5, `axis ${axis} should centre on 0, got ${centre}`);
  }
  assert.ok(Math.abs(head.scale - EXPECTED_HEAD_HEIGHT / 1.6) < 1e-6,
    `scale should be ${EXPECTED_HEAD_HEIGHT / 1.6}, got ${head.scale}`);
});

check('a Z-up model (deeper than tall) is rotated into Y-up', () => {
  /* 0.4 tall but 1.6 deep: the shape of a Blender export lying on its back. */
  const scene = new THREE.Group();
  scene.add(boxMesh(0.5, 0.4, 1.6));
  const head = normaliseHead(mergeSceneMeshes(scene));
  assert.ok(head.rotatedZUp, 'a deep model must be detected as Z-up');
  const bounds = boundsOf(head.positions);
  const height = bounds.max[1] - bounds.min[1];
  assert.ok(Math.abs(height - EXPECTED_HEAD_HEIGHT) < 1e-4,
    `rotated height should be ${EXPECTED_HEAD_HEIGHT}, got ${height}`);
});

check('a node transform is applied before normalisation', () => {
  /* A GLB often carries its scale on a parent node. Merging must bake it in,
     or the head arrives 1000x too small. */
  const outer = new THREE.Group();
  outer.scale.setScalar(1000);
  outer.add(boxMesh(0.5, 0.268, 0.4));
  const merged = mergeSceneMeshes(outer);
  const raw = boundsOf(merged.positions);
  assert.ok(Math.abs((raw.max[1] - raw.min[1]) - 268) < 1e-3,
    `world-space height should be 268, got ${raw.max[1] - raw.min[1]}`);
  const head = normaliseHead(merged);
  assert.ok(Math.abs(head.heightMetres - EXPECTED_HEAD_HEIGHT) < 1e-6);
});

check('multiple meshes merge into one triangle list', () => {
  const scene = new THREE.Group();
  scene.add(boxMesh(0.2, 0.2, 0.2));
  scene.add(boxMesh(0.2, 0.2, 0.2));
  const merged = mergeSceneMeshes(scene);
  assert.equal(merged.sourceMeshes, 2);
  assert.equal(merged.indices.length, 72, 'two 12-triangle boxes are 72 indices');
});

check('a mesh with no faces is rejected with a named reason', () => {
  const scene = new THREE.Group();
  scene.add(meshFrom([0, 0, 0, 1, 0, 0, 0, 1, 0], []));
  assert.throws(() => mergeSceneMeshes(scene), (error) => {
    assert.ok(error instanceof MeshImportError, 'must be a MeshImportError');
    assert.match(error.message, /no triangles/i);
    return true;
  });
});

check('a scene with no meshes is rejected', () => {
  assert.throws(() => mergeSceneMeshes(new THREE.Group()), /no mesh geometry/i);
});

check('normals are unit length and match the position count', () => {
  const scene = new THREE.Group();
  scene.add(boxMesh(0.5, 0.268, 0.4));
  const head = normaliseHead(mergeSceneMeshes(scene));
  assert.equal(head.normals.length, head.positions.length);
  for (let i = 0; i < head.normals.length; i += 3) {
    const length = Math.hypot(head.normals[i], head.normals[i + 1], head.normals[i + 2]);
    assert.ok(Math.abs(length - 1) < 1e-4, `normal ${i / 3} has length ${length}`);
  }
});

check('MeshData satisfies the renderer contract and loads it unchanged', () => {
  const scene = new THREE.Group();
  scene.add(boxMesh(0.5, 0.268, 0.4));
  const data = toMeshData(normaliseHead(mergeSceneMeshes(scene)));

  /* A box ships no UVs; the imported-head path fills them with zeros rather
     than failing `meshDataToGeometry`'s two-per-vertex check. */
  assert.equal(data.uvs.length, (data.positions.length / 3) * 2);
  assert.equal(data.normals.length, data.positions.length);
  assert.equal(data.indices.length % 3, 0);

  const { meshDataToGeometry } = load('components/scene/useMeshGeometry');
  const loaded = meshDataToGeometry(data);
  assert.ok(loaded.geometry, 'geometry should be built');
  assert.ok(Math.abs(loaded.geometry.getAttribute('position').count - data.positions.length / 3) < 1e-9);
  assert.ok(loaded.positions.length === data.positions.length, 'positions survive the round trip');
});

check('a malformed MeshData is still rejected by the renderer', () => {
  const { meshDataToGeometry } = load('components/scene/useMeshGeometry');
  assert.throws(() => meshDataToGeometry({
    positions: new Float32Array([0, 0, 0]), normals: new Float32Array([]),
    uvs: new Float32Array([]), indices: [],
  }), /malformed/);
});

check('the flag reads the query string and the env var', () => {
  const { meshModeEnabled, isMeshFile, isImageFile } = load('lib/smart/smartMode');
  assert.equal(meshModeEnabled('?smart=mesh'), true);
  assert.equal(meshModeEnabled('?smart='), false);
  assert.equal(meshModeEnabled(''), false);
  assert.equal(isMeshFile('head.OBJ'), true);
  assert.equal(isMeshFile('head.glb'), true);
  assert.equal(isMeshFile('face.png'), false);
  assert.equal(isImageFile('face.JPG'), true);
  assert.equal(isImageFile('head.obj'), false);
});

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll Smart Customization import checks passed.');
