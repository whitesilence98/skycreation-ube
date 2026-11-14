// Run: node scripts/check_animated_export.cjs
// Exports a synthetic skinned character through the same GLTFExporter the app
// uses and inspects the GLB: clips, changing keyframes, joints, rest bind, and
// that a failed export restores the live preview scene.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const THREE = require('three');

const root = path.resolve(__dirname, '..');

/* Browser surface `exportCharacterScene` touches for the download. Captured so
   the test can parse the Blob the app would have handed the browser. */
let lastBlob = null;
const urlStub = {
  createObjectURL: (blob) => {
    lastBlob = blob;
    return 'blob:check-animated-export';
  },
  revokeObjectURL: () => {},
};
const documentStub = {
  createElement: () => ({ href: '', download: '', click() {}, remove() {} }),
  body: { appendChild() {} },
};

const cache = new Map();
function load(name) {
  const file = path.join(root, name);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file + '.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    console,
    process,
    URLSearchParams,
    URL: urlStub,
    Blob,
    document: documentStub,
    TextDecoder,
    /* Host-realm typed arrays: GLTFExporter compares `array.constructor`
       against its own realm's constructors, so arrays created by code running
       in this sandbox must be host arrays or every attribute is rejected. */
    ArrayBuffer,
    DataView,
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    // The exporter schedules URL revocation only; a real timer would hold the
    // process open for five seconds after the checks finish.
    setTimeout: () => 0,
    clearTimeout: () => {},
    require: (id) => (id.startsWith('@/') ? load(id.slice(2)) : require(id)),
  });
  return module.exports;
}
const anim = load('lib/character/animation');
const { exportCharacterScene } = load('lib/exportGlb');
const { GLTFExporter } = require('three-stdlib');

/** Two-bone chain with a distinct rest and posed state. */
function buildCharacter() {
  const root = new THREE.Group();
  root.name = 'character';
  const skeletonGroup = new THREE.Group();
  skeletonGroup.name = 'SkeletonRoot';
  root.add(skeletonGroup);

  const hips = new THREE.Bone();
  hips.name = 'NPC COM [COM ]';
  const spine = new THREE.Bone();
  spine.name = 'NPC Spine2 [Spn2]';
  hips.add(spine);
  skeletonGroup.add(hips);

  const restSpineWorld = new THREE.Matrix4().makeTranslation(0, 1, 0);
  const restHipsWorld = new THREE.Matrix4();
  hips.userData.__boneRest = { world: restHipsWorld.clone() };
  spine.userData.__boneRest = { world: restSpineWorld.clone() };
  hips.position.set(0, 0, 0);
  spine.position.set(0, 1, 0);

  // A 3-vertex skinned mesh, fully weighted to the spine.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 1, 1, 0, 0, 2, 0]), 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  const inverses = anim.restInverses([hips, spine]);
  const skeleton = new THREE.Skeleton([hips, spine], inverses);
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  mesh.name = 'Body';
  mesh.bind(skeleton, new THREE.Matrix4());
  root.add(mesh);

  return { root, hips, spine, mesh };
}

/**
 * Full scene shape the app exporter walks: character root, SkeletonRoot with a
 * collision dummy, a body mesh, and a separate SkyrimHeadRoot with a facial
 * mesh. Returns the references the restore assertions compare against.
 */
function buildExportScene() {
  const scene = new THREE.Scene();
  const character = new THREE.Group();
  character.name = 'character';
  scene.add(character);

  const skeletonGroup = new THREE.Group();
  skeletonGroup.name = 'SkeletonRoot';
  character.add(skeletonGroup);

  const hips = new THREE.Bone();
  hips.name = 'NPC COM [COM ]';
  const spine = new THREE.Bone();
  spine.name = 'NPC Spine2 [Spn2]';
  const head = new THREE.Bone();
  head.name = 'NPC Head [Head]';
  const dummy = new THREE.Bone();
  dummy.name = 'CollisionCapsule';
  hips.add(spine);
  spine.add(head);
  hips.add(dummy);
  skeletonGroup.add(hips);

  hips.userData.__boneRest = { world: new THREE.Matrix4() };
  spine.userData.__boneRest = { world: new THREE.Matrix4().makeTranslation(0, 1, 0) };
  head.userData.__boneRest = { world: new THREE.Matrix4().makeTranslation(0, 2, 0) };
  spine.position.set(0, 1, 0);
  head.position.set(0, 1, 0);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 1, 1, 0, 0, 2, 0]), 3));
  // Index 1 is the spine; index 2 is the collision dummy.
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  const skeleton = new THREE.Skeleton([hips, spine, dummy], anim.restInverses([hips, spine, dummy]));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  mesh.name = 'Body';
  mesh.bind(skeleton, new THREE.Matrix4().makeTranslation(0.5, 0, 0));
  character.add(mesh);

  const headRoot = new THREE.Group();
  headRoot.name = 'SkyrimHeadRoot';
  character.add(headRoot);
  const faceGeo = new THREE.BufferGeometry();
  faceGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 2, 0, 1, 2, 0, 0, 3, 0]), 3));
  const face = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial());
  face.name = 'FemaleHead_hph';
  headRoot.add(face);

  /* A second facial mesh: the pre-parse failure test breaks this one so the
     `Head` mesh above has already been attached when the throw happens,
     exercising temp-mesh removal instead of only the pre-attach path. */
  const eyesGeo = new THREE.BufferGeometry();
  eyesGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 2, 0, 1, 2, 0, 0, 3, 0]), 3));
  const eyes = new THREE.Mesh(eyesGeo, new THREE.MeshStandardMaterial());
  eyes.name = 'FemaleEyes';
  headRoot.add(eyes);

  const gizmo = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
  gizmo.name = 'face-gizmo';
  character.add(gizmo);

  const skinIndexArray = mesh.geometry.getAttribute('skinIndex').array;

  return {
    scene,
    character,
    hips,
    spine,
    head,
    dummy,
    mesh,
    skeleton,
    skinIndexArray,
    headRoot,
    face,
    eyes,
    gizmo,
  };
}

/** Preview state that an export must leave exactly as it found it. */
function assertPreviewIntact(refs, label) {
  const { character, spine, head, dummy, mesh, skeleton, skinIndexArray, headRoot, gizmo } = refs;
  assert.equal(dummy.visible, true, `${label}: dummy bone visible again`);
  assert.equal(headRoot.visible, true, `${label}: SkyrimHeadRoot visible again`);
  assert.equal(gizmo.visible, true, `${label}: helper visible again`);
  assert.equal(mesh.skeleton, skeleton, `${label}: original skeleton re-bound`);
  assert.equal(mesh.skeleton.bones.length, 3, `${label}: pruned skeleton discarded`);
  /* The skin-weight attribute must be the very array the preview had, proving
     the pruned remap was undone rather than replaced with an equal copy. */
  assert.equal(
    mesh.geometry.getAttribute('skinIndex').array,
    skinIndexArray,
    `${label}: skin indices restored in place`,
  );
  // A non-identity bind matrix here proves the original binding survives.
  assert.deepEqual(
    Array.from(mesh.bindMatrix.elements),
    Array.from(new THREE.Matrix4().makeTranslation(0.5, 0, 0).elements),
    `${label}: bind matrix restored`,
  );
  assert.equal(character.getObjectByName('Head'), undefined, `${label}: temp facial mesh removed`);
  assert.equal(head.parent, spine, `${label}: head still parented`);
}

async function parseGlb(buffer) {
  const view = new DataView(buffer);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'GLB magic');
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;
  return { json, bin: new Uint8Array(buffer, binStart) };
}

/** Read a float accessor's values from the embedded BIN chunk. */
function accessorValues(json, bin, index) {
  const acc = json.accessors[index];
  const bv = json.bufferViews[acc.bufferView];
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
  const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Float32Array(acc.count * comps);
  for (let i = 0; i < out.length; i++) {
    out[i] = new DataView(bin.buffer, bin.byteOffset + offset + i * 4, 4).getFloat32(0, true);
  }
  return out;
}

(async () => {
  const { root, hips, spine, mesh } = buildCharacter();

  // Pose the bones AND advance an additive idle, mimicking the live preview.
  spine.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.7);
  hips.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.2);
  root.updateMatrixWorld(true);

  const bones = [hips, spine];
  const keep = new Set(bones.flatMap((b) => [b.uuid, b.name]));
  const clips = anim.buildExportClips(bones, keep);
  assert.equal(clips.length, 2, 'animated export ships pose + idle');

  // ── static export has no clips and still binds from rest ──────────────
  await (async () => {
    const exporter = new GLTFExporter();
    const glb = await exporter.parseAsync(root, {
      binary: true,
      trs: true,
      onlyVisible: true,
      animations: [],
    });
    const { json, bin } = await parseGlb(glb);
    assert.equal((json.animations || []).length, 0, 'static export has no animation');
    assert.ok(json.skins.length > 0, 'static export keeps a skin');
    const ibm = accessorValues(json, bin, json.skins[0].inverseBindMatrices);
    // Joint 1 is the spine; its inverse bind must be the inverse of its REST
    // world (translation y=-1), not of the posed matrix.
    const restInverse = new THREE.Matrix4().makeTranslation(0, -1, 0);
    for (let i = 0; i < 16; i++) {
      assert.ok(Math.abs(ibm[16 + i] - restInverse.elements[i]) < 1e-5, `rest bind inverse[${i}]`);
    }
  })();

  // ── animated export: two clips, real changing keyframes, embedded ─────
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(root, {
    binary: true,
    trs: true,
    onlyVisible: true,
    animations: clips,
  });
  const { json, bin } = await parseGlb(glb);

  const animations = json.animations || [];
  assert.equal(animations.length, 2, 'animated export has 2 clips');
  assert.equal(animations.map((a) => a.name).sort().join(','), 'Idle,Pose');
  assert.ok((json.buffers || []).every((b) => !b.uri), 'buffers embedded');

  // Every channel points at a joint that exists; every sampler has output.
  const jointNodes = new Set(json.skins.flatMap((s) => s.joints));
  let changed = false;
  for (const animation of animations) {
    assert.ok(animation.channels.length > 0, `${animation.name} has channels`);
    for (const channel of animation.channels) {
      assert.ok(jointNodes.has(channel.target.node), 'channel targets a skeleton joint');
      const sampler = animation.samplers[channel.sampler];
      assert.ok(sampler.input !== undefined && sampler.output !== undefined, 'sampler has in/out');
      const out = accessorValues(json, bin, sampler.output);
      assert.ok(out.every(Number.isFinite), 'keyframe values finite');
      for (let i = 4; i < out.length; i++) {
        if (Math.abs(out[i] - out[i % 4]) > 1e-4) changed = true;
      }
    }
  }
  assert.ok(changed, 'at least one clip has changing keyframes (not a snapshot)');

  /* Idle must be standalone: its target/property set covers Pose's, so
     playing it after Pose (or any other clip) restores the authored stance
     instead of inheriting unkeyed stale bone values. */
  const coverage = (animation) =>
    animation.channels
      .map((c) => `${c.target.node}.${c.target.path}`)
      .sort()
      .join(',');
  const byName = Object.fromEntries(animations.map((a) => [a.name, a]));
  const poseSet = new Set(coverage(byName.Pose).split(','));
  for (const target of coverage(byName.Idle).split(',')) {
    assert.ok(poseSet.has(target), `Idle covers Pose channel ${target}`);
  }
  assert.equal(coverage(byName.Pose), coverage(byName.Idle), 'Idle and Pose channel sets match');

  console.log(`animated GLB: ${animations.length} clips, ${json.skins.length} skin, joints=${jointNodes.size}, embedded=ok, rest-bind=ok, motion=ok, idle-standalone=ok`);

  // ── export through the real scene walker: success leaves preview intact ─
  const success = buildExportScene();
  lastBlob = null;
  await exportCharacterScene(success.scene, 'Check', { animated: true });
  assert.ok(lastBlob, 'export produced a Blob');
  assert.equal(success.headRoot.visible, true, 'originally-visible rig root stays visible');
  {
    const buffer = await lastBlob.arrayBuffer();
    const { json: out } = await parseGlb(buffer);
    assert.equal((out.animations || []).length > 0, true, 'scene export ships animation');
  }
  assertPreviewIntact(success, 'after success');

  /* ── failure BEFORE parseAsync must also restore the preview ────────────
     A facial mesh whose geometry has no position attribute throws inside
     `createHeadSkinnedMesh` — i.e. after the dummy bones are hidden and the
     body skeleton is re-bound, but well before `parseAsync`. The scene must
     still come back exactly as it was. */
  const failure = buildExportScene();
  failure.eyes.geometry.deleteAttribute('position');
  let threw = false;
  try {
    await exportCharacterScene(failure.scene, 'Check', { animated: true });
  } catch {
    threw = true;
  }
  assert.ok(threw, 'malformed facial mesh fails the export');
  assertPreviewIntact(failure, 'after pre-parse failure');

  /* ── a rig root that was ALREADY hidden must stay hidden ────────────────
     The old cleanup forced `rigRoot.visible = true`, flipping a
     hidden-before-export state into a visible one. */
  const originallyHidden = buildExportScene();
  originallyHidden.headRoot.visible = false;
  await exportCharacterScene(originallyHidden.scene, 'Hidden', { animated: false });
  assert.equal(originallyHidden.headRoot.visible, false, 'pre-hidden rig root remains hidden');

  /* ── overlap guard: a second export while one is in flight is refused ──
     Hold the first export on a scene whose exporter never resolves, then
     confirm the second call rejects before it touches anything. */
  const overlap = buildExportScene();
  const first = exportCharacterScene(overlap.scene, 'First', { animated: true });
  let overlapError = null;
  try {
    await exportCharacterScene(overlap.scene, 'Second', { animated: true });
  } catch (error) {
    overlapError = error;
  }
  assert.ok(overlapError, 'concurrent export rejected');
  assert.match(overlapError.message, /already in progress/i);
  await first;
  assertPreviewIntact(overlap, 'after overlap');

  console.log(`scene export: success/pre-parse-failure/overlap restore preview (pre-parse threw=${threw})`);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
