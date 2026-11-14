// Run: node scripts/check_animation.cjs
// Pure checks for lib/character/animation.ts (no React, no browser).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const THREE = require('three');

const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name).exports;
  const module = { exports: {} };
  cache.set(name, module);
  const source = ts.transpileModule(fs.readFileSync(name + '.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    console,
    process,
    URLSearchParams,
    require: (id) => (id.startsWith('@/') ? load(id.slice(2)) : require(id)),
  });
  return module.exports;
}
const anim = load('lib/character/animation');

const close = (a, b, eps, label) => {
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= eps, `${label}[${i}] ${a[i]} != ${b[i]}`);
};

/** A minimal bone-shaped object for the pure builders. */
function fakeBone(name, angle = 0) {
  return {
    name,
    uuid: `uuid:${name}`,
    quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
    position: new THREE.Vector3(1, 2, 3),
    scale: new THREE.Vector3(1, 1, 1),
    userData: {},
  };
}

const bones = [
  fakeBone('NPC Spine1 [Spn1]', 0.1),
  fakeBone('NPC Spine2 [Spn2]', 0.2),
  fakeBone('NPC Neck [Neck]', 0.3),
  fakeBone('NPC Head [Head]', 0.4),
  fakeBone('NPC L UpperArm [LUar]', 0.5),
  fakeBone('NPC R UpperArm [RUar]', 0.6),
  fakeBone('NPC COM [COM ]', 0.0),
  // Not swayed by the idle; proves the idle still carries it as a held track.
  fakeBone('NPC Pelvis [Pelv]', 0.7),
];

// ── idle clip: deterministic, finite, monotonic, seamless loop ───────────
const idleA = anim.buildIdleClip(bones, 8, 30);
const idleB = anim.buildIdleClip(bones, 8, 30);
assert.equal(idleA.name, 'Idle');
assert.equal(idleA.tracks.length, 6, 'one track per idle bone present');
assert.equal(idleA.duration, 8);

for (let t = 0; t < idleA.tracks.length; t++) {
  const track = idleA.tracks[t];
  assert.ok(track.name.endsWith('.quaternion'), 'uuid quaternion track');
  assert.ok(bones.some((b) => track.name === `${b.uuid}.quaternion`), 'track targets a real bone uuid');
  close(track.values, idleB.tracks[t].values, 0, 'idle determinism');
  assert.ok(track.values.every(Number.isFinite), 'idle values finite');
  assert.ok(track.times.every(Number.isFinite), 'idle times finite');
  for (let i = 1; i < track.times.length; i++) assert.ok(track.times[i] > track.times[i - 1], 'times monotonic');
  const n = track.values.length;
  close(
    [track.values[n - 4], track.values[n - 3], track.values[n - 2], track.values[n - 1]],
    [track.values[0], track.values[1], track.values[2], track.values[3]],
    1e-6,
    'loop seam',
  );
  // Real motion: some keyframe must differ from frame 0 on any component.
  let moved = 0;
  for (let i = 4; i < n; i += 4) {
    for (let k = 0; k < 4; k++) moved = Math.max(moved, Math.abs(track.values[i + k] - track.values[k]));
  }
  assert.ok(moved > 1e-5, 'idle track has distinct frames (not a static snapshot)');
}

// ── additive idle: identity at frame 0, additive blend mode ──────────────
const add = anim.toAdditiveClip(anim.buildIdleClip(bones, 8, 30));
assert.equal(add.blendMode, THREE.AdditiveAnimationBlendMode, 'additive blend mode');
for (const track of add.tracks) {
  close([track.values[0], track.values[1], track.values[2], track.values[3]], [0, 0, 0, 1], 1e-6, 'additive identity');
}

// ── pose clip: static hold, root translation only on the whitelist ───────
const pose = anim.buildPoseClip(bones, 'Pose_rest');
assert.equal(pose.tracks.length, bones.length + 1, 'quaternion per bone + COM position');
const posTracks = pose.tracks.filter((tr) => tr.name.endsWith('.position'));
assert.equal(posTracks.length, 1, 'only the COM bone emits translation');
assert.ok(posTracks[0].name.startsWith('uuid:NPC COM [COM ]'), 'position track is the root bone');
for (const track of pose.tracks) {
  const n = track.values.length;
  close(track.values.slice(0, n / 2), track.values.slice(n / 2), 0, 'pose holds');
  assert.ok(track.values.every(Number.isFinite));
}

// ── authored-pose baseline overrides live (animated) rotations ───────────
const baseline = new Map();
const override = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.234);
baseline.set('uuid:NPC Head [Head]', override);
const posed = anim.buildPoseClip(bones, 'Pose_rest', undefined, baseline);
const headTrack = posed.tracks.find((tr) => tr.name === 'uuid:NPC Head [Head].quaternion');
close([headTrack.values[0], headTrack.values[1], headTrack.values[2], headTrack.values[3]], override.toArray(), 1e-6, 'authored baseline used');

// ── authored ROOT position beats the live (physics-drifted) value ────────
const positionBaseline = new Map();
positionBaseline.set('uuid:NPC COM [COM ]', new THREE.Vector3(0.25, 1.5, -0.75));
const posedPos = anim.buildPoseClip(bones, 'Pose_rest', undefined, undefined, positionBaseline);
const comTrack = posedPos.tracks.find((tr) => tr.name === 'uuid:NPC COM [COM ].position');
close([comTrack.values[0], comTrack.values[1], comTrack.values[2]], [0.25, 1.5, -0.75], 1e-6, 'authored COM position used');
assert.deepEqual(
  anim.positionBaselines(posedPos).get('uuid:NPC COM [COM ]').toArray(),
  [0.25, 1.5, -0.75],
  'position snapshots round trip',
);

// ── idle is standalone: it covers every Pose target/property ─────────────
const standalone = anim.buildIdleClipOverPose(pose, bones);
const poseKeys = pose.tracks.map((tr) => tr.name).sort().join(',');
const idleKeys = standalone.tracks.map((tr) => tr.name).sort().join(',');
assert.equal(idleKeys, poseKeys, 'idle covers the pose target/property set');
assert.ok(
  standalone.tracks.some((tr) => tr.name === 'uuid:NPC Pelvis [Pelv].quaternion'),
  'idle keys bones the sway does not touch',
);
assert.ok(
  standalone.tracks.some((tr) => tr.name === 'uuid:NPC COM [COM ].position'),
  'idle keys the root translation',
);
for (const track of standalone.tracks) {
  const n = track.values.length;
  const held = !track.name.startsWith('uuid:NPC Spine') &&
    !track.name.startsWith('uuid:NPC Neck') &&
    !track.name.startsWith('uuid:NPC Head') &&
    !track.name.startsWith('uuid:NPC L UpperArm') &&
    !track.name.startsWith('uuid:NPC R UpperArm');
  if (held) close(track.values.slice(0, n / 2), track.values.slice(n / 2), 0, `idle holds ${track.name}`);
  else {
    let moved = 0;
    for (let i = 4; i < n; i += 4) {
      for (let k = 0; k < 4; k++) moved = Math.max(moved, Math.abs(track.values[i + k] - track.values[k]));
    }
    assert.ok(moved > 1e-5, `idle sways ${track.name}`);
  }
}
// The held value equals the pose's own first keyframe, not the live bone.
const pelvisPose = pose.tracks.find((tr) => tr.name === 'uuid:NPC Pelvis [Pelv].quaternion');
const pelvisIdle = standalone.tracks.find((tr) => tr.name === 'uuid:NPC Pelvis [Pelv].quaternion');
close(
  [pelvisIdle.values[0], pelvisIdle.values[1], pelvisIdle.values[2], pelvisIdle.values[3]],
  [pelvisPose.values[0], pelvisPose.values[1], pelvisPose.values[2], pelvisPose.values[3]],
  0,
  'held idle value is the authored pose',
);

// ── export clips: filtered, pose + idle, no pruned tracks ────────────────
const keep = new Set(['uuid:NPC Spine2 [Spn2]', 'uuid:NPC Head [Head]']);
const clips = anim.buildExportClips(bones, keep);
assert.equal(clips.length, 2, 'pose + idle');
assert.equal(clips.map((c) => c.name).sort().join(','), 'Idle,Pose');
for (const clip of clips) {
  for (const track of clip.tracks) {
    const uuid = track.name.slice(0, track.name.lastIndexOf('.'));
    assert.ok(keep.has(uuid), `export clip dropped pruned bone ${uuid}`);
  }
}

// ── rest inverses come from recorded rest, never the live pose ───────────
const restWorld = new THREE.Matrix4().makeTranslation(4, 5, 6);
const b = fakeBone('NPC Head [Head]');
b.userData.__boneRest = { world: restWorld.clone() };
b.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2.0); // "posed"
const [inv] = anim.restInverses([b]);
const expected = restWorld.clone().invert();
for (let i = 0; i < 16; i++) assert.ok(Math.abs(inv.elements[i] - expected.elements[i]) < 1e-9, 'rest inverse');

// ── stepMixer: speed scales advance; pause zeroes it; bones actually move ─
const realBone = new THREE.Bone();
realBone.name = 'NPC Spine2 [Spn2]';
const mixer = new THREE.AnimationMixer(realBone);
const turn = new THREE.AnimationClip('Turn', 4, [
  new THREE.QuaternionKeyframeTrack(
    `${realBone.uuid}.quaternion`,
    [0, 4],
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0).toArray()
      .concat(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI).toArray()),
  ),
]);
mixer.clipAction(turn).play();

anim.stepMixer(mixer, 0.5, true, 1);
const atOne = mixer.time;
anim.stepMixer(mixer, 0.5, true, 2);
assert.ok(Math.abs(mixer.time - (atOne + 1.0)) < 1e-9, 'speed 2 doubles the advance');

const pausedAt = mixer.time;
const pausedQuat = realBone.quaternion.clone();
anim.stepMixer(mixer, 0.5, false, 2);
assert.ok(Math.abs(mixer.time - pausedAt) < 1e-12, 'pause freezes mixer time');
close(realBone.quaternion.toArray(), pausedQuat.toArray(), 0, 'pause freezes bone rotation');
assert.equal(mixer.timeScale, 0, 'paused timeScale is zero');

anim.stepMixer(mixer, 0.25, true, 0.5);
assert.ok(Math.abs(mixer.time - (pausedAt + 0.125)) < 1e-9, 'speed 0.5 halves the advance');

console.log('animation clips, additive idle, export filtering, rest inverses, speed/pause: ok');
