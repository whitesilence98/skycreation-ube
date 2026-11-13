const THREE = require('three');
const fs = require('fs');
const path = require('path');

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
  'NPC L ForearmTwist1 [LLt1]': 'NPC L Forearm [LLar]',
  'NPC L ForearmTwist2 [LLt2]': 'NPC L Forearm [LLar]',

  'NPC R Clavicle [RClv]': 'NPC Spine2 [Spn2]',
  'NPC R UpperArm [RUar]': 'NPC R Clavicle [RClv]',
  'NPC R Forearm [RLar]': 'NPC R UpperArm [RUar]',
  'NPC R Hand [RHnd]': 'NPC R Forearm [RLar]',
  'NPC R ForearmTwist1 [RLt1]': 'NPC R Forearm [RLar]',
  'NPC R ForearmTwist2 [RLt2]': 'NPC R Forearm [RLar]',

  'NPC L Finger00 [LF00]': 'NPC L Hand [LHnd]',
  'NPC L Finger01 [LF01]': 'NPC L Finger00 [LF00]',
  'NPC L Finger10 [LF10]': 'NPC L Hand [LHnd]',
  'NPC R Finger00 [RF00]': 'NPC R Hand [RHnd]',
  'NPC R Finger10 [RF10]': 'NPC R Hand [RHnd]',

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

class TestSkeletonRegistry {
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
        if (rest && (!rest.parentName || rest.parentName === 'Scene Root') && resolvedParent && resolvedParent !== 'Scene Root') {
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

// Load meshes
const bodyMesh = JSON.parse(fs.readFileSync('public/assets/preset-pack/meshes/bodyMesh-780aaed8c4e146dd.json'));
const handsMesh = JSON.parse(fs.readFileSync('public/assets/preset-pack/meshes/handsMesh-2dc0ce9f772f7bf4.json'));
const feetMeshes = fs.readdirSync('public/assets/preset-pack/meshes')
  .filter(f => f.startsWith('feetMesh') && f.endsWith('.json'));
const feetMesh = JSON.parse(fs.readFileSync(path.join('public/assets/preset-pack/meshes', feetMeshes[0])));

const reg = new TestSkeletonRegistry();
reg.register(bodyMesh.bones);
reg.register(handsMesh.bones);
reg.register(feetMesh.bones);

console.log('Total bones registered:', reg.byName.size);

// Check parents
const footL = reg.byName.get('NPC L Foot [Lft ]');
const footR = reg.byName.get('NPC R Foot [Rft ]');
const handL = reg.byName.get('NPC L Hand [LHnd]');
const handR = reg.byName.get('NPC R Hand [RHnd]');
const fingerL0 = reg.byName.get('NPC L Finger00 [LF00]');

console.log('NPC L Foot parent:', footL ? footL.parent.name : 'MISSING');
console.log('NPC R Foot parent:', footR ? footR.parent.name : 'MISSING');
console.log('NPC L Hand parent:', handL ? handL.parent.name : 'MISSING');
console.log('NPC R Hand parent:', handR ? handR.parent.name : 'MISSING');
console.log('NPC L Finger00 parent:', fingerL0 ? fingerL0.parent.name : 'MISSING');

if (footL.parent.name !== 'NPC L Calf [LClf]') throw new Error('FootL parent mismatch');
if (footR.parent.name !== 'NPC R Calf [RClf]') throw new Error('FootR parent mismatch');
if (handL.parent.name !== 'NPC L Forearm [LLar]') throw new Error('HandL parent mismatch');
if (handR.parent.name !== 'NPC R Forearm [RLar]') throw new Error('HandR parent mismatch');
if (fingerL0.parent.name !== 'NPC L Hand [LHnd]') throw new Error('FingerL0 parent mismatch');

// Now test posing: measure foot position before and after pose halos_cst1
const restPosFoot = new THREE.Vector3();
footL.getWorldPosition(restPosFoot);
console.log('Rest foot world pos:', restPosFoot.toArray());

const pose = JSON.parse(fs.readFileSync('public/assets/preset-pack/poses/halos/halos_cst1.json'));
for (const [boneName, transform] of Object.entries(pose.bones)) {
  const b = reg.byName.get(boneName);
  if (!b) continue;
  if (transform.q) {
    b.quaternion.set(transform.q[0], transform.q[1], transform.q[2], transform.q[3]);
  }
}
reg.updateWorld();

const posedPosFoot = new THREE.Vector3();
footL.getWorldPosition(posedPosFoot);
console.log('Posed foot world pos:', posedPosFoot.toArray());

const delta = restPosFoot.distanceTo(posedPosFoot);
console.log(`Foot moved by: ${(delta * 100).toFixed(2)} cm (inherited calf rotation!)`);

if (delta < 0.001) {
  throw new Error('Foot did not move with pose!');
}

console.log('SUCCESS: Feet, hands, and fingers correctly inherit parent limb kinematics!');
