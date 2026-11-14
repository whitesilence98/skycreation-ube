// Run: node scripts/check_auto_rig.cjs
//
// Exercises `lib/character/autoRig.ts` headlessly against the real `three`
// runtime. The module imports only `three` and `@/lib/character/skeleton`, so
// both are transpiled from source and loaded into a CommonJS sandbox — the
// test never re-implements the transfer math it is checking.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const THREE = require('three');

const ROOT = path.join(__dirname, '..');

function loadTs(relativePath, resolve) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relativePath,
  }).outputText;
  const moduleObject = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: moduleObject.exports,
    module: moduleObject,
    require: resolve,
    console,
    performance,
    TextDecoder,
  }, { filename: relativePath });
  return moduleObject.exports;
}

const skeleton = loadTs('lib/character/skeleton.ts', (id) => {
  if (id === 'three') return THREE;
  throw new Error(`skeleton.ts unexpected require ${id}`);
});

const autoRig = loadTs('lib/character/autoRig.ts', (id) => {
  if (id === 'three') return THREE;
  if (id === '@/lib/character/skeleton') return skeleton;
  throw new Error(`autoRig.ts unexpected require ${id}`);
});

const {
  autoRigMesh,
  disposeAutoRiggedMesh,
  isAutoRigEligible,
} = autoRig;
const { SkeletonRegistry } = skeleton;

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

/* ── helpers ─────────────────────────────────────────────────────────── */

/** Identity-rotation NIF bone at a translation, in row-major 3×4 form. */
function boneAt(name, parent, tx, ty, tz) {
  return {
    name,
    parent,
    world: [1, 0, 0, tx, 0, 1, 0, ty, 0, 0, 1, tz],
  };
}

function geometryFrom(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(
    new Array(positions.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(
    new Array((positions.length / 3) * 2).fill(0), 2));
  geometry.setIndex(indices);
  return geometry;
}

function meshOf(geometry, extra = {}) {
  return {
    geometry,
    positions: geometry.getAttribute('position').array,
    ...extra,
  };
}

/** A donor body with two bones along the render Y axis. Registering it first
 *  lets the test place vertices at the registry's own rest positions, which is
 *  the coordinate frame the transfer is specified in. */
function makeDonor(frames) {
  const registry = new SkeletonRegistry('head');
  const bones = [
    boneAt('Root', null, 0, 0, 0),
    boneAt('Child', 'Root', 0, 0, 10),
  ];
  registry.register(bones);
  const root = registry.restWorld('Root');
  const child = registry.restWorld('Child');
  assert.ok(root && child, 'registry exposes both rests');
  const p0 = new THREE.Vector3().setFromMatrixPosition(root);
  const p1 = new THREE.Vector3().setFromMatrixPosition(child);
  const mid = p0.clone().lerp(p1, 0.5);
  /* A vertex offset from the Child bone's own origin, so a rotation of Child
     actually displaces it — the pose test would be vacuous at the joint. */
  const arm = p1.clone().add(new THREE.Vector3(0, 0.2, 0));

  /* Donor vertices: Root, Child, a blend at the joint, and the limb tip. */
  const geometry = geometryFrom(
    [p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, mid.x, mid.y, mid.z, arm.x, arm.y, arm.z],
    [0, 1, 2, 3],
  );
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(
    [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(
    [1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0], 4));
  const donor = meshOf(geometry, { bones });
  return { donor, registry, bones, p0, p1, mid, arm };
}

/* ── eligibility ─────────────────────────────────────────────────────── */

check('role gate: hair/eyes/brows/mouth are not auto-rigged', () => {
  const role = (r) => meshOf(geometryFrom([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]), {
    materials: [{ name: 'm', role: r }],
  });
  assert.equal(isAutoRigEligible(role('hair'), 'hair'), false);
  assert.equal(isAutoRigEligible(role('accessory'), 'accessory'), false);
  assert.equal(isAutoRigEligible(role('skin'), 'hair'), true);
  assert.equal(isAutoRigEligible(role('clothing'), 'clothing'), true);
  /* Legacy mesh with no authored slots: the caller's default decides. */
  const legacy = meshOf(geometryFrom([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]));
  assert.equal(isAutoRigEligible(legacy, 'hair'), false);
  assert.equal(isAutoRigEligible(legacy, 'clothing'), true);
  assert.equal(isAutoRigEligible(legacy), false);
  /* Mixed clothing + skin is one eligible outfit. */
  const mixed = meshOf(geometryFrom([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]), {
    materials: [{ name: 'body', role: 'skin' }, { name: 'shirt', role: 'clothing' }],
  });
  assert.equal(isAutoRigEligible(mixed, 'clothing'), true);
  /* One ineligible slot poisons the whole shape. */
  const tainted = meshOf(geometryFrom([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]), {
    materials: [{ name: 'shirt', role: 'clothing' }, { name: 'trim', role: 'hair' }],
  });
  assert.equal(isAutoRigEligible(tainted, 'clothing'), false);
});

/* ── donor transfer ──────────────────────────────────────────────────── */

check('donor transfer: nearest donor vertex wins and weights normalize', () => {
  const { donor, registry, bones, p0, p1 } = makeDonor();
  const target = meshOf(geometryFrom(
    [p0.x, p0.y, p0.z, p1.x, p1.y, p1.z],
    [0, 1, 0],
  ));
  const result = autoRigMesh(target, { donor, registry, defaultRole: 'clothing' });
  assert.ok(result, 'an eligible unskinned shape is rigged');
  assert.equal(result.source, 'donor');
  assert.equal(result.ownsGeometry, true);

  const idx = result.mesh.geometry.getAttribute('skinIndex');
  const w = result.mesh.geometry.getAttribute('skinWeight');
  /* Vertex 0 sits on the Root donor vertex, vertex 1 on Child. */
  assert.equal(result.mesh.bones[idx.getX(0)].name, bones[0].name);
  assert.equal(result.mesh.bones[idx.getX(1)].name, bones[1].name);
  for (let v = 0; v < 2; v += 1) {
    const sum = w.getX(v) + w.getY(v) + w.getZ(v) + w.getW(v);
    assert.ok(Math.abs(sum - 1) < 1e-6, `vertex ${v} weights sum to 1`);
  }
});

check('donor transfer: far-away target still resolves (no radius miss)', () => {
  const { donor, registry, bones } = makeDonor();
  /* 40 m away in every axis — far outside any plausible search radius. */
  const target = meshOf(geometryFrom([40, 40, 40, -40, -40, -40], [0, 1, 0]));
  const result = autoRigMesh(target, { donor, registry, defaultRole: 'clothing' });
  assert.ok(result, 'transfer never refuses for lack of a nearby donor');
  const idx = result.mesh.geometry.getAttribute('skinIndex');
  for (let v = 0; v < 2; v += 1) {
    assert.ok(idx.getX(v) < result.mesh.bones.length);
    assert.ok(result.mesh.bones[idx.getX(v)]);
  }
  void bones;
});

check('nearest is exact: grid agrees with a brute-force scan', () => {
  /* A scattered cloud makes cell selection matter. Each donor vertex is
     rigidly bound to its own bone, so the emitted bone names the exact donor
     vertex that won the search — a full exactness check, not just a distance. */
  const count = 200;
  const bones = Array.from({ length: count }, (_, i) => boneAt(`Donor${i}`, null, 0, 0, 0));
  const positions = [];
  const skinIndex = [];
  const skinWeight = [];
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < count; i += 1) {
    positions.push(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    skinIndex.push(i, 0, 0, 0);
    skinWeight.push(1, 0, 0, 0);
  }
  const donorGeometry = geometryFrom(positions, [0, 1, 2]);
  donorGeometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  donorGeometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  const donor = meshOf(donorGeometry, { bones });

  const queries = [];
  for (let i = 0; i < 40; i += 1) {
    queries.push(rand() * 4 - 2, rand() * 4 - 2, rand() * 4 - 2);
  }
  const target = meshOf(geometryFrom(queries, [0, 1, 2]));
  /* No registry: the donor alone must suffice. */
  const result = autoRigMesh(target, { donor, defaultRole: 'clothing' });
  assert.ok(result);
  assert.equal(result.source, 'donor');

  const targetPosition = target.geometry.getAttribute('position');
  const index = result.mesh.geometry.getAttribute('skinIndex');
  for (let v = 0; v < targetPosition.count; v += 1) {
    const x = targetPosition.getX(v);
    const y = targetPosition.getY(v);
    const z = targetPosition.getZ(v);
    let best = -1;
    let bestSq = Infinity;
    for (let d = 0; d < count; d += 1) {
      const dx = x - positions[d * 3];
      const dy = y - positions[d * 3 + 1];
      const dz = z - positions[d * 3 + 2];
      const sq = dx * dx + dy * dy + dz * dz;
      /* Strict `<` over ascending d keeps the lowest index on a tie — the
         same rule the grid uses. Verified: this query set has no ties. */
      if (sq < bestSq) { bestSq = sq; best = d; }
    }
    assert.equal(
      result.mesh.bones[index.getX(v)].name,
      `Donor${best}`,
      `vertex ${v}: the transferred bone must be a brute-force nearest donor`,
    );
  }

  /* A second run must be byte-identical: deterministic ties and ordering. */
  const again = autoRigMesh(target, { donor, defaultRole: 'clothing' });
  assert.deepEqual(
    Array.from(result.mesh.geometry.getAttribute('skinIndex').array),
    Array.from(again.mesh.geometry.getAttribute('skinIndex').array),
    'repeated transfers are deterministic',
  );
  disposeAutoRiggedMesh(result);
  disposeAutoRiggedMesh(again);
});

/* ── pose following ─────────────────────────────────────────────────── */

check('skinned clone follows a synthetic pose; root-weighted vertex stays put', () => {
  const { donor, registry, p0, arm } = makeDonor();
  /* Two vertices: one on the root bone, one on the child limb tip. */
  const target = meshOf(geometryFrom(
    [p0.x, p0.y, p0.z, arm.x, arm.y, arm.z],
    [0, 1, 0],
  ));
  const result = autoRigMesh(target, { donor, registry, defaultRole: 'clothing' });
  assert.ok(result);

  const registered = registry.register(result.mesh.bones);
  const skinned = new THREE.SkinnedMesh(
    result.mesh.geometry,
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  skinned.bind(registered.skeleton, new THREE.Matrix4());
  skinned.updateMatrixWorld(true);

  const atRest0 = new THREE.Vector3(p0.x, p0.y, p0.z);
  const atRest1 = new THREE.Vector3(arm.x, arm.y, arm.z);
  const got0 = skinned.applyBoneTransform(0, atRest0.clone());
  const got1 = skinned.applyBoneTransform(1, atRest1.clone());
  assert.ok(got0.distanceTo(atRest0) < 1e-5, 'root vertex is undeformed at rest');
  assert.ok(got1.distanceTo(atRest1) < 1e-5, 'limb vertex is undeformed at rest');

  /* Rotate the Child bone 90° about X; the limb tip swings off its rest spot,
     the root-weighted vertex does not follow. */
  const child = registry.byName.get('Child');
  child.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  registry.updateWorld();
  const posed0 = skinned.applyBoneTransform(0, atRest0.clone());
  const posed1 = skinned.applyBoneTransform(1, atRest1.clone());
  assert.ok(posed0.distanceTo(atRest0) < 1e-5, 'root vertex does not follow Child');
  assert.ok(posed1.distanceTo(atRest1) > 1e-3, 'limb vertex follows the pose');
  disposeAutoRiggedMesh(result);
});

/* ── safety: degenerate and malformed inputs ────────────────────────── */

check('authored weights are a no-op', () => {
  const { donor, registry, p0, p1 } = makeDonor();
  const geometry = geometryFrom([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z], [0, 1, 0]);
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(
    [0, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(
    [1, 0, 0, 0, 1, 0, 0, 0], 4));
  const target = meshOf(geometry, { bones: donor.bones });
  assert.equal(autoRigMesh(target, { donor, registry, defaultRole: 'clothing' }), null);
});

check('partially weighted source keeps authored rows and fills the rest', () => {
  const { donor, registry, bones, p0, p1 } = makeDonor();
  const geometry = geometryFrom([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z], [0, 1, 0]);
  /* Vertex 0 authored to Root; vertex 1 has an all-zero row. */
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(
    [0, 0, 0, 0, 0, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(
    [1, 0, 0, 0, 0, 0, 0, 0], 4));
  const target = meshOf(geometry, { bones });
  const result = autoRigMesh(target, { donor, registry, defaultRole: 'clothing' });
  assert.ok(result);
  const idx = result.mesh.geometry.getAttribute('skinIndex');
  const weight = result.mesh.geometry.getAttribute('skinWeight');
  assert.equal(result.mesh.bones[idx.getX(0)].name, 'Root');
  assert.equal(weight.getX(0), 1);
  assert.equal(result.mesh.bones[idx.getX(1)].name, 'Child');
  assert.ok(Math.abs(weight.getX(1) - 1) < 1e-6);
});

check('NIF padding: garbage index on a zero-weight slot is not disqualifying', () => {
  const { donor, registry, bones, p0, arm } = makeDonor();
  const geometry = geometryFrom([p0.x, p0.y, p0.z, arm.x, arm.y, arm.z], [0, 1, 0]);
  /* Vertex 0 is properly authored (bone 0 at weight 1) but its unused slots
     carry 0xFFFF padding — exactly what the exporter writes. Vertex 1 is a
     zero row, so it must be derived. */
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(
    [0, 65535, 65535, 65535, 0, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(
    [1, 0, 0, 0, 0, 0, 0, 0], 4));
  const target = meshOf(geometry, { bones });
  const result = autoRigMesh(target, { donor, registry, defaultRole: 'clothing' });
  assert.ok(result);
  const idx = result.mesh.geometry.getAttribute('skinIndex');
  const weight = result.mesh.geometry.getAttribute('skinWeight');
  /* Authored row kept; padding rewritten to index 0, weights preserved. */
  assert.equal(result.mesh.bones[idx.getX(0)].name, 'Root');
  assert.equal(weight.getX(0), 1);
  for (let k = 1; k < 4; k += 1) {
    assert.ok(idx.getComponent(0, k) < result.mesh.bones.length, 'padding never escapes');
    assert.equal(weight.getComponent(0, k), 0);
  }
  /* Derived row is fully formed. */
  const sum = [0, 1, 2, 3].reduce((s, k) => s + weight.getComponent(1, k), 0);
  assert.ok(Math.abs(sum - 1) < 1e-6);
});

check('malformed target (non-finite position) fails safely', () => {
  const { donor, registry } = makeDonor();
  const target = meshOf(geometryFrom([NaN, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]));
  assert.equal(autoRigMesh(target, { donor, registry, defaultRole: 'clothing' }), null);
});

check('invalid source indices/weights are treated as missing, not trusted', () => {
  const { donor, registry, bones, p0, p1 } = makeDonor();
  const geometry = geometryFrom([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z], [0, 1, 0]);
  /* Out-of-range index + negative weight: both rows are invalid. */
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(
    [99, 0, 0, 0, 0, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(
    [1, 0, 0, 0, -1, 2, 0, 0], 4));
  const target = meshOf(geometry, { bones });
  const result = autoRigMesh(target, { donor, registry, defaultRole: 'clothing' });
  assert.ok(result, 'the shape is re-rigged rather than trusting bad rows');
  const idx = result.mesh.geometry.getAttribute('skinIndex');
  for (let v = 0; v < 2; v += 1) {
    assert.ok(idx.getX(v) < result.mesh.bones.length, 'every emitted index is in range');
  }
});

check('degenerate donor (zero weights) is ignored, never poisons the mesh', () => {
  const { donor, p0, p1 } = makeDonor();
  const degenerate = meshOf(donor.geometry.clone(), { bones: donor.bones });
  degenerate.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(
    new Array(16).fill(0), 4));
  const target = meshOf(geometryFrom([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z], [0, 1, 0]));
  /* With only the degenerate donor and no anatomical bones there is nothing
     safe to bind: refuse rather than emit NaN weights. */
  assert.equal(autoRigMesh(target, { donor: degenerate, registry: null, defaultRole: 'clothing' }), null);

  /* With canonical bones in play the fallback takes over. Place the target on
     the pelvis so a segment exists nearby. */
  const canonical = new SkeletonRegistry('head');
  canonical.register([
    boneAt('NPC Pelvis [Pelv]', null, 0, 0, 0),
    boneAt('NPC Spine [Spn0]', 'NPC Pelvis [Pelv]', 0, 0, 10),
  ]);
  const fallback = autoRigMesh(target, { donor: degenerate, registry: canonical, defaultRole: 'clothing' });
  assert.ok(fallback);
  assert.equal(fallback.source, 'canonical');
});

check('donor whose indices all point out of range degrades to canonical fallback', () => {
  const { donor } = makeDonor();
  const canonical = new SkeletonRegistry('head');
  canonical.register([
    boneAt('NPC Pelvis [Pelv]', null, 0, 0, 0),
    boneAt('NPC Spine [Spn0]', 'NPC Pelvis [Pelv]', 0, 0, 10),
  ]);
  const pelvis = new THREE.Vector3().setFromMatrixPosition(canonical.restWorld('NPC Pelvis [Pelv]'));
  const broken = meshOf(donor.geometry.clone(), { bones: donor.bones });
  /* Every slot's index is outside the donor's bone table; the weights are
     valid, so the *only* reason to reject a row is the index. */
  broken.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(
    new Array(16).fill(99), 4));
  broken.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(
    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const target = meshOf(geometryFrom(
    [pelvis.x, pelvis.y, pelvis.z, pelvis.x, pelvis.y, pelvis.z, pelvis.x, pelvis.y, pelvis.z],
    [0, 1, 2],
  ));
  const result = autoRigMesh(target, { donor: broken, registry: canonical, defaultRole: 'clothing' });
  assert.ok(result);
  assert.equal(result.source, 'canonical', 'no valid donor vertex, so canonical fallback runs');
  const idx = result.mesh.geometry.getAttribute('skinIndex');
  assert.ok(idx.getX(0) < result.mesh.bones.length);
});

check('donor partial row: only the valid sliver is used, not the bad slots', () => {
  /* A donor vertex whose first slot has an out-of-range index but whose second
     slot is a valid `bone 0` at 0.5 must transfer only that valid influence
     (normalized to 1), never the invalid index. */
  const { donor, registry, p0 } = makeDonor();
  const partial = meshOf(donor.geometry.clone(), { bones: donor.bones });
  partial.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(
    [99, 0, 0, 0, 99, 0, 0, 0, 99, 0, 0, 0, 99, 0, 0, 0], 4));
  partial.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(
    [1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0], 4));
  const target = meshOf(geometryFrom([p0.x, p0.y, p0.z], [0]));
  const result = autoRigMesh(target, { donor: partial, registry, defaultRole: 'clothing' });
  assert.ok(result);
  assert.equal(result.source, 'donor');
  const idx = result.mesh.geometry.getAttribute('skinIndex');
  const weight = result.mesh.geometry.getAttribute('skinWeight');
  assert.equal(result.mesh.bones[idx.getX(0)].name, 'Root');
  assert.ok(Math.abs(weight.getX(0) - 1) < 1e-6, 'valid sliver normalizes to full weight');
});

check('no donor and no registry bones: returns null, never half-rigs', () => {
  const target = meshOf(geometryFrom([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]));
  assert.equal(autoRigMesh(target, { defaultRole: 'clothing' }), null);
  assert.equal(autoRigMesh(target, { donor: null, registry: null, defaultRole: 'clothing' }), null);
});

/* ── canonical fallback ─────────────────────────────────────────────── */

check('canonical fallback binds to the nearest anatomical segment', () => {
  const registry = new SkeletonRegistry('head');
  const bones = [
    boneAt('NPC Pelvis [Pelv]', null, 0, 0, 0),
    boneAt('NPC Spine [Spn0]', 'NPC Pelvis [Pelv]', 0, 0, 10),
    boneAt('NPC Spine1 [Spn1]', 'NPC Spine [Spn0]', 0, 0, 20),
    boneAt('NPC L Clavicle [LClv]', 'NPC Spine1 [Spn1]', 10, 0, 20),
    boneAt('NPC L UpperArm [LUar]', 'NPC L Clavicle [LClv]', 30, 0, 25),
    boneAt('NPC L Forearm [LLar]', 'NPC L UpperArm [LUar]', 45, 0, 25),
  ];
  registry.register(bones);
  const upper = registry.restWorld('NPC L UpperArm [LUar]');
  const fore = registry.restWorld('NPC L Forearm [LLar]');
  const a = new THREE.Vector3().setFromMatrixPosition(upper);
  const b = new THREE.Vector3().setFromMatrixPosition(fore);
  const middle = a.clone().lerp(b, 0.5);
  const target = meshOf(geometryFrom([middle.x, middle.y, middle.z], [0]));
  const result = autoRigMesh(target, { registry, defaultRole: 'clothing' });
  assert.ok(result);
  assert.equal(result.source, 'canonical');
  const idx = result.mesh.geometry.getAttribute('skinIndex');
  const weight = result.mesh.geometry.getAttribute('skinWeight');
  assert.equal(result.mesh.bones[idx.getX(0)].name, 'NPC L UpperArm [LUar]');
  assert.equal(weight.getX(0), 1);
  /* The emitted definition must resolve in the same registry. */
  const registered = registry.register(result.mesh.bones);
  assert.equal(registered.bones[idx.getX(0)].name, 'NPC L UpperArm [LUar]');
});

check('canonical fallback sends each limb region to its own bone', () => {
  const registry = new SkeletonRegistry('head');
  registry.register([
    boneAt('NPC Pelvis [Pelv]', null, 0, 0, 0),
    boneAt('NPC L Thigh [LThg]', 'NPC Pelvis [Pelv]', 10, 0, 0),
    boneAt('NPC L Calf [LClf]', 'NPC L Thigh [LThg]', 10, 0, 10),
    boneAt('NPC L Foot [Lft ]', 'NPC L Calf [LClf]', 10, 0, 20),
    boneAt('NPC R Thigh [RThg]', 'NPC Pelvis [Pelv]', -10, 0, 0),
    boneAt('NPC R Calf [RClf]', 'NPC R Thigh [RThg]', -10, 0, 10),
  ]);
  /* Convert each anatomical point through the registry so the test is written
     in render space, not NIF space. `mid(a, b, t)` sits on the a→b segment. */
  const rest = (name) => new THREE.Vector3().setFromMatrixPosition(registry.restWorld(name));
  const mid = (a, b, t) => rest(a).lerp(rest(b), t);
  const lCalf = mid('NPC L Thigh [LThg]', 'NPC L Calf [LClf]', 0.5);
  const lFoot = mid('NPC L Calf [LClf]', 'NPC L Foot [Lft ]', 0.5);
  const rThigh = mid('NPC Pelvis [Pelv]', 'NPC R Thigh [RThg]', 0.6);
  const target = meshOf(geometryFrom(
    [lCalf.x, lCalf.y, lCalf.z, lFoot.x, lFoot.y, lFoot.z, rThigh.x, rThigh.y, rThigh.z],
    [0, 1, 2],
  ));
  const result = autoRigMesh(target, { registry, defaultRole: 'clothing' });
  assert.ok(result);
  const idx = result.mesh.geometry.getAttribute('skinIndex');
  const names = [0, 1, 2].map((v) => result.mesh.bones[idx.getX(v)].name);
  /* A segment is named for its proximal bone: mid Thigh→Calf is the thigh,
     mid Calf→Foot is the calf, and a point partway from the pelvis to the
     right thigh is nearest the right thigh's own joint. */
  assert.deepEqual(names, [
    'NPC L Thigh [LThg]',
    'NPC L Calf [LClf]',
    'NPC R Thigh [RThg]',
  ]);
});

/* ── ownership ─────────────────────────────────────────────────────── */

check('canonical fallback always emits normalized, in-range, 4-wide rows', () => {
  const registry = new SkeletonRegistry('head');
  registry.register([
    boneAt('NPC Pelvis [Pelv]', null, 0, 0, 0),
    boneAt('NPC Spine [Spn0]', 'NPC Pelvis [Pelv]', 0, 0, 10),
    boneAt('NPC Spine1 [Spn1]', 'NPC Spine [Spn0]', 0, 0, 20),
    boneAt('NPC L UpperArm [LUar]', 'NPC Spine1 [Spn1]', 10, 0, 25),
    boneAt('NPC L Forearm [LLar]', 'NPC L UpperArm [LUar]', 30, 0, 25),
    boneAt('NPC L Hand [LHnd]', 'NPC L Forearm [LLar]', 45, 0, 25),
  ]);
  const rests = [
    registry.restWorld('NPC Pelvis [Pelv]'),
    registry.restWorld('NPC L UpperArm [LUar]'),
    registry.restWorld('NPC L Forearm [LLar]'),
    registry.restWorld('NPC L Hand [LHnd]'),
  ].map((m) => new THREE.Vector3().setFromMatrixPosition(m));
  const points = [];
  /* Sample along each segment and at the joints. */
  for (let s = 0; s < rests.length - 1; s += 1) {
    for (let t = 0; t <= 1; t += 0.25) {
      const p = rests[s].clone().lerp(rests[s + 1], t);
      points.push(p.x, p.y, p.z);
    }
  }
  const target = meshOf(geometryFrom(points, [0, 1, 2, 3]));
  const result = autoRigMesh(target, { registry, defaultRole: 'clothing' });
  assert.ok(result);
  const idx = result.mesh.geometry.getAttribute('skinIndex');
  const weight = result.mesh.geometry.getAttribute('skinWeight');
  const vertexCount = target.geometry.getAttribute('position').count;
  for (let v = 0; v < vertexCount; v += 1) {
    let sum = 0;
    let nonzero = 0;
    for (let k = 0; k < 4; k += 1) {
      const w = weight.getComponent(v, k);
      assert.ok(w >= 0 && Number.isFinite(w), `vertex ${v} weight ${k} in range`);
      if (w > 0) {
        nonzero += 1;
        assert.ok(idx.getComponent(v, k) < result.mesh.bones.length, 'index in range');
      }
      sum += w;
    }
    assert.ok(Math.abs(sum - 1) < 1e-6, `vertex ${v} weights sum to 1`);
    assert.ok(nonzero >= 1 && nonzero <= 4, `vertex ${v} has 1..4 influences`);
  }
});

check('derived mesh owns a clone; the source and donor are untouched', () => {
  const { donor, registry, p0, p1 } = makeDonor();
  const target = meshOf(geometryFrom([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z], [0, 1, 0]));
  const donorPositionsBefore = Array.from(donor.geometry.getAttribute('position').array);
  const donorIndexBefore = Array.from(donor.geometry.getAttribute('skinIndex').array);
  let donorDisposed = 0;
  donor.geometry.dispose = () => { donorDisposed += 1; };

  const result = autoRigMesh(target, { donor, registry, defaultRole: 'clothing' });
  assert.ok(result);
  assert.notEqual(result.mesh.geometry, target.geometry, 'geometry is cloned');
  assert.equal(
    target.geometry.getAttribute('skinWeight'),
    undefined,
    'source geometry is not given skinning attributes',
  );
  assert.deepEqual(
    Array.from(donor.geometry.getAttribute('position').array),
    donorPositionsBefore,
    'donor positions are not mutated',
  );
  assert.deepEqual(
    Array.from(donor.geometry.getAttribute('skinIndex').array),
    donorIndexBefore,
    'donor weights are not mutated',
  );

  let derivedDisposed = 0;
  result.mesh.geometry.dispose = () => { derivedDisposed += 1; };
  disposeAutoRiggedMesh(result);
  assert.equal(derivedDisposed, 1, 'derived geometry is disposed');
  assert.equal(donorDisposed, 0, 'donor geometry is never disposed');
  assert.equal(disposeAutoRiggedMesh(null), undefined);
});

check('groups and materials survive the clone by reference', () => {
  const { donor, registry, p0 } = makeDonor();
  const geometry = geometryFrom([p0.x, p0.y, p0.z, p0.x, p0.y, p0.z, p0.x, p0.y, p0.z], [0, 1, 2]);
  const materials = [{ name: 'fabric', role: 'clothing' }];
  geometry.addGroup(0, 3, 0);
  const target = meshOf(geometry, { materials, groups: [{ start: 0, count: 3, materialIndex: 0 }] });
  const result = autoRigMesh(target, { donor, registry, defaultRole: 'clothing' });
  assert.ok(result);
  assert.equal(result.mesh.materials, materials);
  assert.equal(result.mesh.groups, target.groups);
  assert.equal(result.mesh.geometry.groups.length, 1, 'draw ranges are cloned');
});

console.log(`\n✓ auto-rig: ${passed} checks passed\n`);
