const fs = require('fs');
const path = require('path');
const THREE = require('three');

// Load canonical XP32 parenting dictionary
const XP32_CANONICAL_PARENTS = {
  // Spine & Pelvis chain
  'NPC COM [COM ]': 'NPC Root [Root]',
  'NPC Pelvis [Pelv]': 'NPC COM [COM ]',
  'NPC Spine [Spn0]': 'NPC COM [COM ]',
  'NPC Spine1 [Spn1]': 'NPC Spine [Spn0]',
  'NPC Spine2 [Spn2]': 'NPC Spine1 [Spn1]',
  'NPC Neck [Neck]': 'NPC Spine2 [Spn2]',
  'NPC Head [Head]': 'NPC Neck [Neck]',
  'NPCEyeBone': 'NPC Head [Head]',

  // Arms & Hands
  'NPC L Clavicle [LClv]': 'NPC Spine2 [Spn2]',
  'NPC L UpperArm [LUar]': 'NPC L Clavicle [LClv]',
  'NPC L Forearm [LLar]': 'NPC L UpperArm [LUar]',
  'NPC L Hand [LHnd]': 'NPC L Forearm [LLar]',
  'NPC L ForearmTwist1 [LLt1]': 'NPC L Forearm [LLar]',
  'NPC L ForearmTwist2 [LLt2]': 'NPC L Forearm [LLar]',
  'NPC L UpperarmTwist1 [LUt1]': 'NPC L UpperArm [LUar]',
  'NPC L UpperarmTwist2 [LUt2]': 'NPC L UpperarmTwist1 [LUt1]',

  'NPC R Clavicle [RClv]': 'NPC Spine2 [Spn2]',
  'NPC R UpperArm [RUar]': 'NPC R Clavicle [RClv]',
  'NPC R Forearm [RLar]': 'NPC R UpperArm [RUar]',
  'NPC R Hand [RHnd]': 'NPC R Forearm [RLar]',
  'NPC R ForearmTwist1 [RLt1]': 'NPC R Forearm [RLar]',
  'NPC R ForearmTwist2 [RLt2]': 'NPC R Forearm [RLar]',
  'NPC R UpperarmTwist1 [RUt1]': 'NPC R UpperArm [RUar]',
  'NPC R UpperarmTwist2 [RUt2]': 'NPC R UpperarmTwist1 [RUt1]',

  // Left Fingers
  'NPC L Finger00 [LF00]': 'NPC L Hand [LHnd]',
  'NPC L Finger01 [LF01]': 'NPC L Finger00 [LF00]',
  'NPC L Finger02 [LF02]': 'NPC L Finger01 [LF01]',
  'NPC L Finger10 [LF10]': 'NPC L Hand [LHnd]',
  'NPC L Finger11 [LF11]': 'NPC L Finger10 [LF10]',
  'NPC L Finger12 [LF12]': 'NPC L Finger11 [LF11]',
  'NPC L Finger20 [LF20]': 'NPC L Hand [LHnd]',
  'NPC L Finger21 [LF21]': 'NPC L Finger20 [LF20]',
  'NPC L Finger22 [LF22]': 'NPC L Finger21 [LF21]',
  'NPC L Finger30 [LF30]': 'NPC L Hand [LHnd]',
  'NPC L Finger31 [LF31]': 'NPC L Finger30 [LF30]',
  'NPC L Finger32 [LF32]': 'NPC L Finger31 [LF31]',
  'NPC L Finger40 [LF40]': 'NPC L Hand [LHnd]',
  'NPC L Finger41 [LF41]': 'NPC L Finger40 [LF40]',
  'NPC L Finger42 [LF42]': 'NPC L Finger41 [LF41]',

  // Right Fingers
  'NPC R Finger00 [RF00]': 'NPC R Hand [RHnd]',
  'NPC R Finger01 [RF01]': 'NPC R Finger00 [RF00]',
  'NPC R Finger02 [RF02]': 'NPC R Finger01 [RF01]',
  'NPC R Finger10 [RF10]': 'NPC R Hand [RHnd]',
  'NPC R Finger11 [RF11]': 'NPC R Finger10 [RF10]',
  'NPC R Finger12 [RF12]': 'NPC R Finger11 [RF11]',
  'NPC R Finger20 [RF20]': 'NPC R Hand [RHnd]',
  'NPC R Finger21 [RF21]': 'NPC R Finger20 [RF20]',
  'NPC R Finger22 [RF22]': 'NPC R Finger21 [RF21]',
  'NPC R Finger30 [RF30]': 'NPC R Hand [RHnd]',
  'NPC R Finger31 [RF31]': 'NPC R Finger30 [RF30]',
  'NPC R Finger32 [RF32]': 'NPC R Finger31 [RF31]',
  'NPC R Finger40 [RF40]': 'NPC R Hand [RHnd]',
  'NPC R Finger41 [RF41]': 'NPC R Finger40 [RF40]',
  'NPC R Finger42 [RF42]': 'NPC R Finger41 [RF41]',

  // Legs & Feet
  'NPC L Thigh [LThg]': 'NPC Pelvis [Pelv]',
  'NPC L Calf [LClf]': 'NPC L Thigh [LThg]',
  'NPC L Foot [Lft ]': 'NPC L Calf [LClf]',
  'NPC L Toe0 [LToe]': 'NPC L Foot [Lft ]',

  'NPC R Thigh [RThg]': 'NPC Pelvis [Pelv]',
  'NPC R Calf [RClf]': 'NPC R Thigh [RThg]',
  'NPC R Foot [Rft ]': 'NPC R Calf [RClf]',
  'NPC R Toe0 [RToe]': 'NPC R Foot [Rft ]',
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
    this.group.name = 'SkeletonRoot';
  }

  restOf(bone) {
    return bone.userData[REST];
  }

  register(meshBones) {
    let changed = false;
    for (const def of meshBones) {
      const canonical = XP32_CANONICAL_PARENTS[def.name];
      const resolvedParent = def.parent && def.parent !== 'Scene Root'
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
}

// 1. Load meshes from pack
const bodyMesh = JSON.parse(fs.readFileSync('public/assets/preset-pack/meshes/bodyMesh-780aaed8c4e146dd.json'));
const handsMesh = JSON.parse(fs.readFileSync('public/assets/preset-pack/meshes/handsMesh-2dc0ce9f772f7bf4.json'));
const feetMeshes = fs.readdirSync('public/assets/preset-pack/meshes').filter(f => f.startsWith('feetMesh') && f.endsWith('.json'));
const feetMesh = JSON.parse(fs.readFileSync(path.join('public/assets/preset-pack/meshes', feetMeshes[0])));

const reg = new SkeletonRegistry();
reg.register(bodyMesh.bones);
reg.register(handsMesh.bones);
reg.register(feetMesh.bones);

console.log('✓ Registered total bones across Body, Hands, Feet:', reg.byName.size);

// 2. Assert Foot & Calf parenting
const footL = reg.byName.get('NPC L Foot [Lft ]');
const footR = reg.byName.get('NPC R Foot [Rft ]');
const toeL = reg.byName.get('NPC L Toe0 [LToe]');
const toeR = reg.byName.get('NPC R Toe0 [RToe]');

if (!footL || footL.parent.name !== 'NPC L Calf [LClf]') throw new Error('NPC L Foot parent mismatch');
if (!footR || footR.parent.name !== 'NPC R Calf [RClf]') throw new Error('NPC R Foot parent mismatch');
if (!toeL || toeL.parent.name !== 'NPC L Foot [Lft ]') throw new Error('NPC L Toe parent mismatch');
if (!toeR || toeR.parent.name !== 'NPC R Foot [Rft ]') throw new Error('NPC R Toe parent mismatch');
console.log('✓ Feet & Toes correctly parented to Calves and Feet');

// 3. Assert Hand & Forearm parenting
const handL = reg.byName.get('NPC L Hand [LHnd]');
const handR = reg.byName.get('NPC R Hand [RHnd]');
if (!handL || handL.parent.name !== 'NPC L Forearm [LLar]') throw new Error('NPC L Hand parent mismatch');
if (!handR || handR.parent.name !== 'NPC R Forearm [RLar]') throw new Error('NPC R Hand parent mismatch');
console.log('✓ Hands correctly parented to Forearms');

// 4. Assert All 30 Finger bones
const fingerPrefixes = ['NPC L Finger', 'NPC R Finger'];
let verifiedFingers = 0;
for (const prefix of fingerPrefixes) {
  const side = prefix.includes(' L ') ? 'L' : 'R';
  const handName = `NPC ${side} Hand [${side}Hnd]`;
  for (let f = 0; f <= 4; f++) {
    const baseName = `${prefix}${f}0 [${side}F${f}0]`;
    const midName = `${prefix}${f}1 [${side}F${f}1]`;
    const tipName = `${prefix}${f}2 [${side}F${f}2]`;

    const baseBone = reg.byName.get(baseName);
    const midBone = reg.byName.get(midName);
    const tipBone = reg.byName.get(tipName);

    if (!baseBone || baseBone.parent.name !== handName) {
      throw new Error(`Finger base ${baseName} not parented to ${handName}`);
    }
    if (!midBone || midBone.parent.name !== baseName) {
      throw new Error(`Finger mid ${midName} not parented to ${baseName}`);
    }
    if (!tipBone || tipBone.parent.name !== midName) {
      throw new Error(`Finger tip ${tipName} not parented to ${midName}`);
    }
    verifiedFingers += 3;
  }
}
console.log(`✓ All ${verifiedFingers} finger bones correctly chained to hands and knuckles`);

// 5. Test Kinematic Chain under Poses
// Test Halo pose halos_cst1
const pose1 = JSON.parse(fs.readFileSync('public/assets/preset-pack/poses/halos/halos_cst1.json'));
const restFootPos = new THREE.Vector3();
footL.getWorldPosition(restFootPos);

for (const [boneName, transform] of Object.entries(pose1.bones)) {
  const b = reg.byName.get(boneName);
  if (!b) continue;
  if (transform.q) {
    b.quaternion.set(transform.q[0], transform.q[1], transform.q[2], transform.q[3]);
  }
}
reg.updateWorld();

const posedFootPos = new THREE.Vector3();
footL.getWorldPosition(posedFootPos);
const footDelta = restFootPos.distanceTo(posedFootPos);

const restHandPos = new THREE.Vector3();
handL.getWorldPosition(restHandPos);
console.log(`✓ Halos CST1: Foot world displacement = ${(footDelta * 100).toFixed(2)} cm`);
if (footDelta < 0.05) {
  throw new Error('Foot did not displace dynamically with calf rotation');
}

// Test GomaPero pose gomapero_1gom1
const pose2 = JSON.parse(fs.readFileSync('public/assets/preset-pack/poses/gomapero/gomapero_1gom1.json'));
for (const [boneName, transform] of Object.entries(pose2.bones)) {
  const b = reg.byName.get(boneName);
  if (!b) continue;
  if (transform.q) {
    b.quaternion.set(transform.q[0], transform.q[1], transform.q[2], transform.q[3]);
  }
}
reg.updateWorld();
const posedHandPos = new THREE.Vector3();
handL.getWorldPosition(posedHandPos);
const handDelta = restHandPos.distanceTo(posedHandPos);
console.log(`✓ GomaPero P01: Hand world displacement = ${(handDelta * 100).toFixed(2)} cm`);
if (handDelta < 0.01) {
  throw new Error('Hand did not displace dynamically with forearm rotation');
}

console.log('\n=========================================');
console.log(' ALL SKELETAL HIERARCHY TESTS PASSED!   ');
console.log('=========================================\n');
