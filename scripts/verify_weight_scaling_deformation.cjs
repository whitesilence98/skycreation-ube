const fs = require('fs');
const THREE = require('three');

// Replicate SkeletonRegistry & applySkeletonWeight for headless execution
const XP32_CANONICAL_PARENTS = {
  'NPC COM [COM ]': 'NPC Root [Root]',
  'NPC Pelvis [Pelv]': 'NPC COM [COM ]',
  'NPC Spine [Spn0]': 'NPC COM [COM ]',
  'NPC Spine1 [Spn1]': 'NPC Spine [Spn0]',
  'NPC Spine2 [Spn2]': 'NPC Spine1 [Spn1]',
  'NPC Neck [Neck]': 'NPC Spine2 [Spn2]',
  'NPC Head [Head]': 'NPC Neck [Neck]',
  'NPCEyeBone': 'NPC Head [Head]',
  'NPC L Clavicle [LClv]': 'NPC Spine2 [Spn2]',
  'NPC L UpperArm [LUar]': 'NPC L Clavicle [LClv]',
  'NPC L Forearm [LLar]': 'NPC L UpperArm [LUar]',
  'NPC L Hand [LHnd]': 'NPC L Forearm [LLar]',
  'NPC R Clavicle [RClv]': 'NPC Spine2 [Spn2]',
  'NPC R UpperArm [RUar]': 'NPC R Clavicle [RClv]',
  'NPC R Forearm [RLar]': 'NPC R UpperArm [RUar]',
  'NPC R Hand [RHnd]': 'NPC R Forearm [RLar]',
  'NPC L Thigh [LThg]': 'NPC Pelvis [Pelv]',
  'NPC L Calf [LClf]': 'NPC L Thigh [LThg]',
  'NPC L Foot [Lft ]': 'NPC L Calf [LClf]',
  'NPC R Thigh [RThg]': 'NPC Pelvis [Pelv]',
  'NPC R Calf [RClf]': 'NPC R Thigh [RThg]',
  'NPC R Foot [Rft ]': 'NPC R Calf [RClf]',
};

const REST = '__boneRest';

function meshFrameMatrix(frame = 'head') {
  const conf = frame === 'ground'
    ? { scale: 0.01288, center_y: 0.0, center_z: 0.0 }
    : { scale: 0.01288, center_y: 1.0, center_z: 120.73 };
  const { scale: S, center_y: CY, center_z: CZ } = conf;
  return new THREE.Matrix4().set(
    S, 0, 0, 0,
    0, 0, S, -CZ * S,
    0, S, 0, -CY * S,
    0, 0, 0, 1,
  );
}

function boneWorldMatrix(bone, frame = 'head') {
  const w = bone.world;
  const nif = new THREE.Matrix4().set(
    w[0], w[1], w[2], w[3],
    w[4], w[5], w[6], w[7],
    w[8], w[9], w[10], w[11],
    0, 0, 0, 1,
  );
  return meshFrameMatrix(frame).multiply(nif);
}

class SkeletonRegistry {
  constructor(frame = 'head') {
    this.frame = frame;
    this.byName = new Map();
    this.group = new THREE.Group();
  }

  restOf(bone) {
    return bone.userData[REST];
  }

  register(meshBones) {
    let changed = false;
    for (const def of meshBones) {
      const canonical = XP32_CANONICAL_PARENTS[def.name];
      const resolvedParent =
        def.parent && def.parent !== 'Scene Root'
          ? def.parent
          : (canonical ?? def.parent);

      if (this.byName.has(def.name)) {
        const bone = this.byName.get(def.name);
        const rest = this.restOf(bone);
        if (
          rest &&
          (!rest.parentName || rest.parentName === 'Scene Root') &&
          resolvedParent &&
          resolvedParent !== 'Scene Root'
        ) {
          rest.parentName = resolvedParent;
          changed = true;
        }
        continue;
      }

      const bone = new THREE.Bone();
      bone.name = def.name;
      bone.userData[REST] = {
        world: boneWorldMatrix(def, this.frame),
        parentName: resolvedParent,
        pose: {
          position: new THREE.Vector3(),
          quaternion: new THREE.Quaternion(),
          scale: new THREE.Vector3(1, 1, 1),
        },
      };
      this.byName.set(def.name, bone);
      changed = true;
    }
    if (changed) this.rebuild();
    return {
      skeleton: new THREE.Skeleton(meshBones.map((b) => this.byName.get(b.name))),
    };
  }

  rebuild() {
    const parentInverse = new THREE.Matrix4();
    for (const bone of this.byName.values()) {
      const rest = this.restOf(bone);
      let parentName = rest.parentName;
      if (!parentName || parentName === 'Scene Root' || !this.byName.has(parentName)) {
        const canonical = XP32_CANONICAL_PARENTS[bone.name];
        if (canonical && this.byName.has(canonical)) {
          parentName = canonical;
          rest.parentName = canonical;
        }
      }
      const parent = parentName ? this.byName.get(parentName) : undefined;
      const parentObject = parent ?? this.group;
      if (bone.parent !== parentObject) {
        parentObject.add(bone);
      }
      if (parent) {
        parentInverse.copy(this.restOf(parent).world).invert().multiply(rest.world);
      } else {
        parentInverse.copy(rest.world);
      }
      parentInverse.decompose(rest.pose.position, rest.pose.quaternion, rest.pose.scale);
      bone.position.copy(rest.pose.position);
      bone.quaternion.copy(rest.pose.quaternion);
      bone.scale.copy(rest.pose.scale);
    }
    this.updateWorld();
  }

  updateWorld() {
    this.group.updateMatrixWorld(true);
  }

  reset() {
    for (const bone of this.byName.values()) {
      const rest = this.restOf(bone);
      bone.position.copy(rest.pose.position);
      bone.quaternion.copy(rest.pose.quaternion);
      bone.scale.copy(rest.pose.scale);
    }
    this.updateWorld();
  }
}

const SKELETON_WEIGHT_SCALES = {
  'NPC Spine [Spn0]': { x: 0.035, y: 0.035, z: 0.035 },
  'NPC Spine1 [Spn1]': { x: 0.035, y: 0.035, z: 0.035 },
  'NPC Spine2 [Spn2]': { x: 0.025, y: 0.025, z: 0.025 },
  'NPC Belly': { x: 0.04, y: 0.05, z: 0.05 },
  'Belly': { x: 0.04, y: 0.05, z: 0.05 },
  'NPC Pelvis [Pelv]': { x: 0.09, y: 0.08, z: 0.08 },
  'NPC L Butt': { x: 0.045, y: 0.045, z: 0.045 },
  'NPC R Butt': { x: 0.045, y: 0.045, z: 0.045 },
  'Butt': { x: 0.045, y: 0.045, z: 0.045 },
  'L Breast01': { x: 0.038, y: 0.038, z: 0.038 },
  'R Breast01': { x: 0.038, y: 0.038, z: 0.038 },
  'L Breast02': { x: 0.025, y: 0.025, z: 0.025 },
  'R Breast02': { x: 0.025, y: 0.025, z: 0.025 },
  'NPC L Breast': { x: 0.038, y: 0.038, z: 0.038 },
  'NPC R Breast': { x: 0.038, y: 0.038, z: 0.038 },
  'NPC L Thigh [LThg]': { x: -0.01, y: -0.01, z: -0.01 },
  'NPC R Thigh [RThg]': { x: -0.01, y: -0.01, z: -0.01 },
  'NPC L Calf [LClf]': { x: -0.035, y: -0.035, z: -0.035 },
  'NPC R Calf [RClf]': { x: -0.035, y: -0.035, z: -0.035 },
  'NPC L UpperArm [LUar]': { x: 0.06, y: 0.06, z: 0.06 },
  'NPC R UpperArm [RUar]': { x: 0.06, y: 0.06, z: 0.06 },
};

const ANCHOR_BONES = [
  'NPC Neck [Neck]',
  'NPC L Foot [Lft ]',
  'NPC R Foot [Rft ]',
  'NPC L Hand [LHnd]',
  'NPC R Hand [RHnd]',
];

function applySkeletonWeight(registry, weight) {
  const w = Math.max(0, Math.min(1, weight));

  for (const bone of registry.byName.values()) {
    const rest = (bone.userData[REST])?.pose;
    if (rest) bone.scale.copy(rest.scale);
    else bone.scale.set(1, 1, 1);
  }

  for (const [boneName, factors] of Object.entries(SKELETON_WEIGHT_SCALES)) {
    const bone = registry.byName.get(boneName);
    if (!bone) continue;
    bone.scale.set(
      bone.scale.x * (1.0 + factors.x * w),
      bone.scale.y * (1.0 + factors.y * w),
      bone.scale.z * (1.0 + factors.z * w),
    );
  }

  registry.updateWorld();

  // 4. Counter-scale anchor bones (Neck, Feet, Hands) so their world scale stays identical to rest
  const restWorldScale = new THREE.Vector3();
  const parentWorldScale = new THREE.Vector3();
  for (const anchorName of ANCHOR_BONES) {
    const bone = registry.byName.get(anchorName);
    const rest = bone ? bone.userData[REST] : undefined;
    if (!bone || !bone.parent || !rest) continue;
    rest.world.decompose(new THREE.Vector3(), new THREE.Quaternion(), restWorldScale);
    bone.parent.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), parentWorldScale);
    if (Math.abs(parentWorldScale.x) > 1e-5 && Math.abs(parentWorldScale.y) > 1e-5 && Math.abs(parentWorldScale.z) > 1e-5) {
      bone.scale.set(
        Math.abs(restWorldScale.x / parentWorldScale.x),
        Math.abs(restWorldScale.y / parentWorldScale.y),
        Math.abs(restWorldScale.z / parentWorldScale.z),
      );
    }
  }

  registry.updateWorld();
}

// ── Run Verification Suite ───────────────────────────────────────────────────
console.log('--- Step 1: Registering Body & Clothing Meshes into XP32 Skeleton ---');
const reg = new SkeletonRegistry('head');

const bodyData = JSON.parse(fs.readFileSync('public/assets/preset-pack/meshes/bodyMesh-867086350c21ace8.json'));
const clothData = JSON.parse(fs.readFileSync('public/assets/preset-pack/cache/clothingMesh/clothingMesh-e1239a2427486ece-mesh.json'));
const leggingData = JSON.parse(fs.readFileSync('public/assets/preset-pack/cache/clothingMesh/clothingMesh-0f776b6abe46a4b0-mesh.json'));

reg.register(bodyData.bones);
reg.register(clothData.bones);
reg.register(leggingData.bones);

console.log(`Registered ${reg.byName.size} bones across Body, Bodysuit, and Leggings.`);

console.log('\n--- Step 2: Testing Bone World Scales Across Weight Range (0%, 50%, 100%) ---');
const testWeights = [0.0, 0.5, 1.0];
for (const w of testWeights) {
  applySkeletonWeight(reg, w);
  console.log(`\nWeight = ${(w * 100).toFixed(0)}%:`);
  const checkBones = ['NPC Spine1 [Spn1]', 'NPC Spine2 [Spn2]', 'L Breast01', 'NPC Pelvis [Pelv]', 'NPC L Butt', 'NPC L Thigh [LThg]', 'NPC Neck [Neck]', 'NPC Head [Head]'];
  for (const name of checkBones) {
    const b = reg.byName.get(name);
    const ws = new THREE.Vector3();
    b.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), ws);
    console.log(`  ${name.padEnd(20)} World Scale = [X: ${ws.x.toFixed(3)}, Y: ${ws.y.toFixed(3)}, Z: ${ws.z.toFixed(3)}]`);
  }
}

// Ensure Head & Neck remain identity ratio to rest
applySkeletonWeight(reg, 1.0);
const neckBone = reg.byName.get('NPC Neck [Neck]');
const headBone = reg.byName.get('NPC Head [Head]');
const neckScale = new THREE.Vector3();
const headScale = new THREE.Vector3();
const neckRestScale = new THREE.Vector3();
const headRestScale = new THREE.Vector3();
neckBone.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), neckScale);
headBone.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), headScale);
neckBone.userData[REST].world.decompose(new THREE.Vector3(), new THREE.Quaternion(), neckRestScale);
headBone.userData[REST].world.decompose(new THREE.Vector3(), new THREE.Quaternion(), headRestScale);

const neckRatio = Math.abs(neckScale.y / neckRestScale.y);
const headRatio = Math.abs(headScale.y / headRestScale.y);
console.log(`\nNeck World Scale Ratio to Rest: ${neckRatio.toFixed(4)}`);
console.log(`Head World Scale Ratio to Rest: ${headRatio.toFixed(4)}`);

if (Math.abs(neckRatio - 1.0) > 1e-3 || Math.abs(headRatio - 1.0) > 1e-3) {
  console.error('FATAL: Neck or Head scale deviated from rest!');
  process.exit(1);
}
console.log('✓ Anchor preservation verified: Head & Neck world scale matches rest perfectly.');

// ── Step 3: Verify GPU Skinned Vertex Expansion on Leggings (0 cm NIF delta) ──
console.log('\n--- Step 3: Deforming Leggings (Authored NIF delta = 0.00 cm) ---');
// Leggings mesh has 0 cm delta between _0 and _1, so expansion relies 100% on bone scaling.
const leggingMesh = new THREE.SkinnedMesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial()
);
const leggingPos = new Float32Array(leggingData.positions);
leggingMesh.geometry.setAttribute('position', new THREE.BufferAttribute(leggingPos, 3));
leggingMesh.geometry.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(leggingData.skinIndex), 4));
leggingMesh.geometry.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(leggingData.skinWeight), 4));

const leggingSkeleton = reg.register(leggingData.bones).skeleton;
leggingMesh.bind(leggingSkeleton, new THREE.Matrix4());

function computeDeformedVertex(mesh, vertexIdx) {
  const p = new THREE.Vector3(
    mesh.geometry.attributes.position.getX(vertexIdx),
    mesh.geometry.attributes.position.getY(vertexIdx),
    mesh.geometry.attributes.position.getZ(vertexIdx)
  );
  const skinIndices = [
    mesh.geometry.attributes.skinIndex.getX(vertexIdx),
    mesh.geometry.attributes.skinIndex.getY(vertexIdx),
    mesh.geometry.attributes.skinIndex.getZ(vertexIdx),
    mesh.geometry.attributes.skinIndex.getW(vertexIdx),
  ];
  const skinWeights = [
    mesh.geometry.attributes.skinWeight.getX(vertexIdx),
    mesh.geometry.attributes.skinWeight.getY(vertexIdx),
    mesh.geometry.attributes.skinWeight.getZ(vertexIdx),
    mesh.geometry.attributes.skinWeight.getW(vertexIdx),
  ];

  const skinned = new THREE.Vector3(0, 0, 0);
  const temp = new THREE.Vector3();
  const boneMatrix = new THREE.Matrix4();

  for (let i = 0; i < 4; i++) {
    const weight = skinWeights[i];
    if (weight <= 0) continue;
    const boneIdx = skinIndices[i];
    const bone = mesh.skeleton.bones[boneIdx];
    const boneInv = mesh.skeleton.boneInverses[boneIdx];
    boneMatrix.multiplyMatrices(bone.matrixWorld, boneInv);
    temp.copy(p).applyMatrix4(boneMatrix);
    skinned.addScaledVector(temp, weight);
  }
  return skinned;
}

// Sample thigh/hip vertices on leggings
applySkeletonWeight(reg, 0.0);
leggingMesh.skeleton.update();
const v0 = computeDeformedVertex(leggingMesh, 100);

applySkeletonWeight(reg, 1.0);
leggingMesh.skeleton.update();
const v1 = computeDeformedVertex(leggingMesh, 100);

const dist = v1.distanceTo(v0);
console.log(`Legging Vertex #100 Rest Pos (w=0.0): [${v0.x.toFixed(4)}, ${v0.y.toFixed(4)}, ${v0.z.toFixed(4)}]`);
console.log(`Legging Vertex #100 Posed Pos (w=1.0): [${v1.x.toFixed(4)}, ${v1.y.toFixed(4)}, ${v1.z.toFixed(4)}]`);
console.log(`Displacement from bone scaling: ${(dist * 100).toFixed(2)} cm`);

if (dist < 0.005) {
  console.error('FATAL: Legging vertex did not expand with bone scaling!');
  process.exit(1);
}

console.log('\n======================================================');
console.log(' ALL CREATION ENGINE SKELETON SCALING CHECKS PASSED!  ');
console.log('======================================================\n');
