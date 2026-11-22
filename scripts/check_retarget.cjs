// Run: node scripts/check_retarget.cjs (requires Python + numpy and generated UBE pack)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const basePath = path.join(root, 'public/assets/preset-pack/meshes/headMesh-96612a53f30f4e56.json');
assert.ok(fs.existsSync(basePath), 'Generate the UBE preset pack before check:retarget');
const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ube-retarget-'));
const python = (args, timeout = 180000) => execFileSync('python', ['-I', ...args], {
  cwd: root, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', PYTHONDONTWRITEBYTECODE: '1' },
});const storage = new Map();
const cache = new Map();
function load(name) {
  const file = path.join(root, name + '.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, console, Float32Array,
    window: {},
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    require: (id) => id.startsWith('@/') ? load(id.slice(2)) : require(id),
  }, { filename: file });
  return module.exports;
}

async function run() {
  // Exact encoder tests must not depend on approximate geometric correspondence.
  python(['-c', `
import sys, tempfile
from pathlib import Path
import numpy as np
sys.path.insert(0, 'scripts')
from retarget_head import encode, SCALE, load_obj, closest_on_triangles
base = np.zeros((3, 3))
fitted = np.array([[0.001, -0.002, 0.003], [-0.004, 0.005, -0.006], [0, 0, 0]])
sculpt = encode(base, fitted, 'test')
replayed = base.copy()
for i, x, z, y in sculpt['morphs']['sculpt'][0]['data']:
    replayed[i] += np.array([x, y, z]) * SCALE
assert np.max(np.abs(replayed-fitted)) <= SCALE/2 + 1e-12
tri = np.array([[[[0.,0,0],[1,0,0],[0,1,0]]]])
for point, expected in [([.2,.3,1],[.2,.3,0]), ([2,0,0],[1,0,0]), ([-1,-1,0],[0,0,0])]:
    got = closest_on_triangles(np.array([[point]],dtype=float), tri)
    assert np.allclose(got[0,0], expected), got
with tempfile.TemporaryDirectory() as directory:
    p = Path(directory)/'test.obj'
    p.write_text('v 0 0 0\\nv 1 0 0\\nv 1 1 0\\nv 0 1 0\\nf -4/-1 -3/-1 -2/-1 -1/-1\\n')
    vertices, faces = load_obj(p)
    assert vertices.shape == (4,3) and faces.shape == (2,3)
    p.write_text('v 0 0 0 1 0 0\\nv 2 0 0 2\\nv 0 2 0 2 0 1 0\\nf 1 2 3\\n')
    vertices, faces = load_obj(p)
    assert np.array_equal(vertices, [[0,0,0], [1,0,0], [0,1,0]])
    for text in ['v nan 0 0\\nf 1 1 1', 'v 0 0 0\\nf 0 1 1', 'v 0 0 0\\nf 1 2 3', 'v 0 0 0 0\\nf 1 1 1']:
        p.write_text(text)
        try:
            load_obj(p)
        except ValueError:
            pass
        else:
            raise AssertionError('malformed OBJ accepted')
print('encoder / triangle projection / OBJ validation passed')
`]);

  const objPath = path.join(directory, 'neutral.obj');
  const outPath = path.join(directory, 'neutral.jslot');
  const lines = [];
  const count = base.positions.length / 3;
  const angle = 137 * Math.PI / 180;
  // Reverse every vertex ID, change units, yaw, translation. No UBE input-order shortcut.
  for (let i = count - 1; i >= 0; i--) {
    const [x, y, z] = base.positions.slice(i * 3, i * 3 + 3);
    lines.push(`v ${(x * Math.cos(angle) + z * Math.sin(angle)) * 37 + 1.4} ${y * 37 - 3.2} ${(-x * Math.sin(angle) + z * Math.cos(angle)) * 37 + 0.7}`);
  }
  for (let i = 0; i < base.indices.length; i += 3) {
    lines.push('f ' + base.indices.slice(i, i + 3).map((v) => count - v).join(' '));
  }
  fs.writeFileSync(objPath, lines.join('\n'));
  const metrics = JSON.parse(python(['scripts/retarget_head.py', '--mesh', objPath, '--out', outPath]));
  console.log(metrics);
  const deformedPath = path.join(directory, 'deformed.obj');
  const deformedOut = path.join(directory, 'deformed.jslot');
  python(['-c', `
import json, sys, numpy as np
from pathlib import Path
base = json.loads(Path(sys.argv[1]).read_text())
p = np.array(base['positions']).reshape(-1,3)
f = np.array(base['indices']).reshape(-1,3)
# Smooth nose/cheek perturbation, then voxel-weld: source topology no longer matches UBE.
p[:,2] += .004 * np.exp(-((p[:,0]/.025)**2 + ((p[:,1]+.002)/.035)**2)) * (p[:,2] > .04)
_, representative, mapping = np.unique(np.floor(p/.003).astype(int), axis=0, return_index=True, return_inverse=True)
p = p[representative]
f = mapping[f]
f = f[(f[:,0]!=f[:,1]) & (f[:,0]!=f[:,2]) & (f[:,1]!=f[:,2])]
with Path(sys.argv[2]).open('w') as out:
    for x,y,z in p: out.write(f'v {x} {y} {z}\\n')
    for a,b,c in f: out.write(f'f {a+1} {b+1} {c+1}\\n')
assert len(p) != 11498
`, basePath, deformedPath]);
  const deformed = JSON.parse(python(['scripts/retarget_head.py', '--mesh', deformedPath, '--out', deformedOut, '--yaw', '0']));
  assert.ok(deformed.face_surface_rms_m < 0.003, 'Retopologized face surface fit should remain within 3mm RMS');
  assert.ok(deformed.max_displacement_m > 0.001, 'Fit must transfer shape, not return the neutral head');
  console.log('Retopologized synthetic face:', deformed);
  python(['-c', `
import json, sys, numpy as np
from pathlib import Path
sys.path.insert(0, 'scripts')
from retarget_head import SCALE, facial_mask
mesh = json.loads(Path(sys.argv[1]).read_text())
p = np.array(mesh['positions']).reshape(-1,3)
f = np.array(mesh['indices']).reshape(-1,3)
mask = facial_mask(p, f)
assert np.count_nonzero(mask) < 7192, 'Accessory shells and open boundaries must be pinned'
rest = np.cross(p[f[:,1]]-p[f[:,0]], p[f[:,2]]-p[f[:,0]])
for filename in sys.argv[2:]:
    delta = np.zeros_like(p)
    for i,x,z,y in json.loads(Path(filename).read_text())['morphs']['sculpt'][0]['data']:
        delta[i] = np.array([x,y,z]) * SCALE
    assert not delta[mask == 0].any(), 'Accessory shells / open boundaries moved'
    fitted = p + delta
    normals = np.cross(fitted[f[:,1]]-fitted[f[:,0]], fitted[f[:,2]]-fitted[f[:,0]])
    assert np.all((rest*normals).sum(1)[np.linalg.norm(rest,axis=1)>1e-12] > 0), 'Encoded sculpt inverted a triangle'
    if filename == sys.argv[3]:
        nose = (np.abs(p[:,0]) < .02) & (np.abs(p[:,1]+.002) < .02) & (p[:,2] > .09)
        assert delta[nose,2].max() > .001, 'Synthetic nose bulge did not transfer'
`, basePath, outPath, deformedOut]);

  const text = fs.readFileSync(outPath, 'utf8');
  const output = JSON.parse(text);
  const block = output.morphs.sculpt[0];
  assert.match(block.host, /ube/i);
  assert.equal(block.vertices, count);
  assert.deepEqual(output.morphs.custom, []);
  assert.ok(metrics.face_surface_rms_m < 0.003, 'Neutral surface fit should remain within 3mm RMS');
  assert.ok(metrics.face_coverage_15mm > 0.95);

  const dynamic = load('lib/head/dynamicSculpt');
  const meshUrl = '/assets/preset-pack/meshes/headMesh-96612a53f30f4e56.json';
  dynamic.registerBaseMesh(meshUrl, base);
  // Encoder's zero-delta case still needs one point to exercise dynamic registration.
  if (!block.data.length) block.data.push([0, 0, 0, 0]);
  const head = await dynamic.resolveOrBuildSculptHead({ sourceLayout: 'pack', assets: { headMesh: [] } }, JSON.stringify(output), 'neutral.jslot');
  assert.equal(head.origin, 'sculpt-replay');
  const mesh = dynamic.getDynamicMesh(head.meshUrl);
  assert.equal(mesh.positions.length, base.positions.length);
  assert.deepEqual(Array.from(mesh.indices), base.indices);
  assert.deepEqual(Array.from(mesh.uvs), base.uvs);
  const expected = Float64Array.from(base.positions);
  for (const [i, x, z, y] of block.data) {
    expected[i * 3] += x * 0.01288 / 10000;
    expected[i * 3 + 1] += y * 0.01288 / 10000;
    expected[i * 3 + 2] += z * 0.01288 / 10000;
  }
  for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(mesh.positions[i] - expected[i]) < 1e-7);
  const neckText = fs.readFileSync(path.join(root, 'lib/head/neckDeltas.ts'), 'utf8');
  const seam = neckText.match(/NECK_SEAM_HEAD_INDICES = new Uint16Array\(\[([\d,\s]+)\]\)/)[1].split(',').map(Number);
  for (const i of seam) {
    for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(mesh.positions[i * 3 + axis] - base.positions[i * 3 + axis]) < 1e-7, 'Collar must remain unchanged');
  }
  const saved = JSON.parse(storage.get('lyra.dynamic-head-options'));
  assert.equal(saved[0].id, head.id, 'Sculpt head option must survive reload');
  cache.clear();
  assert.equal(load('lib/head/dynamicSculpt').getDynamicSculptHeads()[0].id, head.id);
  const deformedPayload = JSON.parse(fs.readFileSync(deformedOut, 'utf8'));
  const deformedHead = await dynamic.resolveOrBuildSculptHead(
    { sourceLayout: 'pack', assets: { headMesh: [] } }, JSON.stringify(deformedPayload), 'deformed.jslot',
  );
  const deformedMesh = dynamic.getDynamicMesh(deformedHead.meshUrl);
  const deformedExpected = Float64Array.from(base.positions);
  for (const [i, x, z, y] of deformedPayload.morphs.sculpt[0].data) {
    deformedExpected[i * 3] += x * 0.01288 / 10000;
    deformedExpected[i * 3 + 1] += y * 0.01288 / 10000;
    deformedExpected[i * 3 + 2] += z * 0.01288 / 10000;
  }
  assert.deepEqual(Array.from(deformedMesh.indices), base.indices);
  assert.deepEqual(Array.from(deformedMesh.uvs), base.uvs);
  for (let i = 0; i < deformedExpected.length; i++) {
    assert.ok(Math.abs(deformedMesh.positions[i] - deformedExpected[i]) < 1e-7, 'Deformed JS replay drift');
  }
  console.log('Retarget encoding, replay, topology, collar, option persistence passed');
  // The regional quality suite is deliberately NOT run here. It performs
  // several full surface fits (~4 minutes), which would make this routine
  // check unusable. Run it on demand: npm run check:retarget:quality
}
run().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(directory, { recursive: true, force: true }));
