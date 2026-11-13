'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCharacter } from '@/lib/store';
import type { SkeletonRegistry } from '@/lib/character/skeleton';

interface BodyPhysicsProps {
  registry: SkeletonRegistry;
}

interface SoftNodeDef {
  name: string;
  fallbackName?: string;
  type: 'breast' | 'butt' | 'belly';
  radius: number;
  mass: number;
  maxDisp: number;
  stiffnessMult: number;
  dampingMult: number;
}

interface SoftNodeRuntime {
  bone: THREE.Bone;
  def: SoftNodeDef;
  simPos: THREE.Vector3;
  velocity: THREE.Vector3;
  targetWorldPos: THREE.Vector3;
  baseLocalPos: THREE.Vector3;
  initialized: boolean;
}

interface ColliderDef {
  boneName: string;
  radius: number;
  offset: THREE.Vector3;
}

const SOFT_NODES_DEF: readonly SoftNodeDef[] = [
  // Primary Breasts (UBE uses L/R Breast01, legacy/CBBE uses NPC L/R Breast)
  {
    name: 'L Breast01',
    fallbackName: 'NPC L Breast',
    type: 'breast',
    radius: 0.065,
    mass: 1.0,
    maxDisp: 0.026,
    stiffnessMult: 1.0,
    dampingMult: 1.0,
  },
  {
    name: 'R Breast01',
    fallbackName: 'NPC R Breast',
    type: 'breast',
    radius: 0.065,
    mass: 1.0,
    maxDisp: 0.026,
    stiffnessMult: 1.0,
    dampingMult: 1.0,
  },
  // Secondary Breast Tip / Outer Mass (subtle secondary wobble)
  {
    name: 'L Breast02',
    type: 'breast',
    radius: 0.045,
    mass: 0.6,
    maxDisp: 0.015,
    stiffnessMult: 1.4,
    dampingMult: 1.2,
  },
  {
    name: 'R Breast02',
    type: 'breast',
    radius: 0.045,
    mass: 0.6,
    maxDisp: 0.015,
    stiffnessMult: 1.4,
    dampingMult: 1.2,
  },
  // Gluteal / Butt
  {
    name: 'NPC L Butt',
    type: 'butt',
    radius: 0.075,
    mass: 1.2,
    maxDisp: 0.020,
    stiffnessMult: 1.15,
    dampingMult: 1.05,
  },
  {
    name: 'NPC R Butt',
    type: 'butt',
    radius: 0.075,
    mass: 1.2,
    maxDisp: 0.020,
    stiffnessMult: 1.15,
    dampingMult: 1.05,
  },
  // Abdominal / Belly
  {
    name: 'NPC Belly',
    type: 'belly',
    radius: 0.065,
    mass: 0.9,
    maxDisp: 0.016,
    stiffnessMult: 1.25,
    dampingMult: 1.1,
  },
];

const COLLIDERS_DEF: readonly ColliderDef[] = [
  { boneName: 'NPC L Hand [LHnd]', radius: 0.048, offset: new THREE.Vector3(0, 0, 0) },
  { boneName: 'NPC R Hand [RHnd]', radius: 0.048, offset: new THREE.Vector3(0, 0, 0) },
  { boneName: 'NPC L Forearm [LLar]', radius: 0.042, offset: new THREE.Vector3(0, 0.05, 0) },
  { boneName: 'NPC R Forearm [RLar]', radius: 0.042, offset: new THREE.Vector3(0, 0.05, 0) },
  { boneName: 'NPC Head [Head]', radius: 0.075, offset: new THREE.Vector3(0, -0.04, 0.03) },
];

export function BodyPhysics({ registry }: BodyPhysicsProps) {
  const enabled = useCharacter((s) => s.bodyPhysicsEnabled);
  const bounciness = useCharacter((s) => s.bodyPhysicsBounciness);
  const collisionsEnabled = useCharacter((s) => s.bodyCollisionsEnabled);
  const impulseNonce = useCharacter((s) => s.physicsImpulseNonce);
  const bodyPoseId = useCharacter((s) => s.bodyPoseId);
  const weight = useCharacter((s) => s.weight);

  const runtimeNodesRef = useRef<SoftNodeRuntime[]>([]);
  const lastNonceRef = useRef(impulseNonce);
  const lastPoseRef = useRef(bodyPoseId);
  const lastWeightRef = useRef(weight);
  const lastCamPosRef = useRef(new THREE.Vector3());
  const camInitializedRef = useRef(false);

  // Scratch objects preallocated to eliminate GC churn inside useFrame
  const scratch = useRef({
    invParent: new THREE.Matrix4(),
    delta: new THREE.Vector3(),
    disp: new THREE.Vector3(),
    acc: new THREE.Vector3(),
    springForce: new THREE.Vector3(),
    dampForce: new THREE.Vector3(),
    colPos: new THREE.Vector3(),
    colDiff: new THREE.Vector3(),
    colNormal: new THREE.Vector3(),
    localSimPos: new THREE.Vector3(),
    externalImpulse: new THREE.Vector3(),
    camVelocity: new THREE.Vector3(),
  }).current;

  // Resolve active bones from registry
  useEffect(() => {
    const list: SoftNodeRuntime[] = [];
    for (const def of SOFT_NODES_DEF) {
      let bone = registry.byName.get(def.name);
      if (!bone && def.fallbackName) {
        bone = registry.byName.get(def.fallbackName);
      }
      if (!bone || !bone.parent) continue;

      const rest = registry.restPose(bone.name);
      const basePos = rest ? rest.position.clone() : bone.position.clone();

      list.push({
        bone,
        def,
        simPos: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        targetWorldPos: new THREE.Vector3(),
        baseLocalPos: basePos,
        initialized: false,
      });
    }
    runtimeNodesRef.current = list;
  }, [registry, bodyPoseId, weight]);

  // Clean reset when physics is disabled
  useEffect(() => {
    if (!enabled) {
      for (const node of runtimeNodesRef.current) {
        node.bone.position.copy(node.baseLocalPos);
        node.bone.updateMatrix();
        node.bone.updateMatrixWorld(true);
        node.velocity.set(0, 0, 0);
        node.initialized = false;
      }
    }
  }, [enabled]);

  useFrame(({ camera }, delta) => {
    if (!enabled || runtimeNodesRef.current.length === 0) return;

    // Guard time-step against background tabs or extreme frame spikes
    const dt = Math.min(delta, 0.033);
    const subSteps = 2;
    const subDt = dt / subSteps;

    // ── 1. Camera Orbit Inertia ──────────────────────────────────────
    scratch.externalImpulse.set(0, 0, 0);
    if (!camInitializedRef.current) {
      lastCamPosRef.current.copy(camera.position);
      camInitializedRef.current = true;
    } else {
      scratch.camVelocity.copy(camera.position).sub(lastCamPosRef.current).divideScalar(Math.max(dt, 0.001));
      lastCamPosRef.current.copy(camera.position);

      // Inertial push opposite to camera orbit movement
      const camSpeed = scratch.camVelocity.length();
      if (camSpeed > 0.02 && camSpeed < 8.0) {
        scratch.externalImpulse.x -= scratch.camVelocity.x * 0.045 * (0.4 + bounciness * 0.6);
        scratch.externalImpulse.z -= scratch.camVelocity.z * 0.035 * (0.4 + bounciness * 0.6);
      }
    }

    // ── 2. Test Impulse & Pose Transitions ───────────────────────────
    let hasTestImpulse = false;
    if (impulseNonce !== lastNonceRef.current) {
      lastNonceRef.current = impulseNonce;
      hasTestImpulse = true;
    }

    let hasPoseTransition = false;
    if (bodyPoseId !== lastPoseRef.current || Math.abs(weight - lastWeightRef.current) > 0.02) {
      lastPoseRef.current = bodyPoseId;
      lastWeightRef.current = weight;
      hasPoseTransition = true;
    }

    // Physics parameters mapped smoothly from bounciness [0..1]
    // 0 = firm/tight (high stiffness, high damping)
    // 1 = soft/bouncy (lower stiffness, organic low damping)
    const baseStiffness = THREE.MathUtils.lerp(230, 95, bounciness);
    const baseDamping = THREE.MathUtils.lerp(22, 9.5, bounciness);
    const gravityY = -THREE.MathUtils.lerp(1.2, 2.4, bounciness);

    // ── 3. Sub-stepped Spring-Damper & Collision Simulation ──────────
    for (let step = 0; step < subSteps; step++) {
      for (const node of runtimeNodesRef.current) {
        const { bone, def } = node;
        const parent = bone.parent;
        if (!parent) continue;

        // Desired world position from current skeletal pose
        node.targetWorldPos.copy(node.baseLocalPos).applyMatrix4(parent.matrixWorld);

        // First frame or snap recovery: align directly with target
        if (!node.initialized || node.simPos.distanceTo(node.targetWorldPos) > 0.3) {
          node.simPos.copy(node.targetWorldPos);
          node.velocity.set(0, 0, 0);
          node.initialized = true;
          continue;
        }

        // Apply dynamic impulses
        if (step === 0) {
          if (hasTestImpulse) {
            const factor = 0.5 + bounciness * 0.5;
            if (def.type === 'breast') {
              node.velocity.y += 0.24 * factor;
              node.velocity.z += 0.14 * factor;
            } else if (def.type === 'butt') {
              node.velocity.y += 0.20 * factor;
              node.velocity.z -= 0.10 * factor;
            } else if (def.type === 'belly') {
              node.velocity.y += 0.16 * factor;
              node.velocity.z += 0.08 * factor;
            }
          }
          if (hasPoseTransition) {
            // Subtle transition kick
            node.velocity.y += (Math.random() - 0.5) * 0.05;
          }
        }

        const k = baseStiffness * def.stiffnessMult;
        const c = baseDamping * def.dampingMult;

        // Hooke's Law: F_spring = -k * (simPos - targetPos)
        scratch.disp.copy(node.targetWorldPos).sub(node.simPos);
        scratch.springForce.copy(scratch.disp).multiplyScalar(k);

        // Damping: F_damping = -c * velocity
        scratch.dampForce.copy(node.velocity).multiplyScalar(-c);

        // Sum forces
        scratch.acc.set(0, 0, 0);
        scratch.acc.add(scratch.springForce);
        scratch.acc.add(scratch.dampForce);
        scratch.acc.y += gravityY;
        scratch.acc.add(scratch.externalImpulse);
        scratch.acc.divideScalar(def.mass);

        // Integrate
        node.velocity.addScaledVector(scratch.acc, subDt);
        node.simPos.addScaledVector(node.velocity, subDt);

        // Clamp maximum displacement to maintain anatomical integrity
        scratch.delta.copy(node.simPos).sub(node.targetWorldPos);
        const dist = scratch.delta.length();
        if (dist > def.maxDisp && dist > 1e-5) {
          node.simPos.copy(node.targetWorldPos).addScaledVector(scratch.delta, def.maxDisp / dist);
          // Absorb excess velocity hitting boundary
          node.velocity.multiplyScalar(0.75);
        }

        // ── 4. CBPC Analytical Sphere Collisions ─────────────────────
        if (collisionsEnabled) {
          for (const col of COLLIDERS_DEF) {
            const colBone = registry.byName.get(col.boneName);
            if (!colBone) continue;

            colBone.getWorldPosition(scratch.colPos);
            if (col.offset.lengthSq() > 0) {
              scratch.colPos.add(col.offset);
            }

            scratch.colDiff.copy(node.simPos).sub(scratch.colPos);
            const collDist = scratch.colDiff.length();
            const minDist = col.radius + def.radius;

            if (collDist < minDist && collDist > 1e-4) {
              scratch.colNormal.copy(scratch.colDiff).divideScalar(collDist);
              const penetration = minDist - collDist;

              // Push soft bone outward along collision normal
              node.simPos.addScaledVector(scratch.colNormal, penetration);

              // Cancel penetration velocity and add gentle elastic deflection
              const vDotN = node.velocity.dot(scratch.colNormal);
              if (vDotN < 0) {
                node.velocity.addScaledVector(scratch.colNormal, -vDotN * 1.15);
              }
            }
          }
        }

        // ── 5. Project Back to Bone Local Space ──────────────────────
        scratch.invParent.copy(parent.matrixWorld).invert();
        scratch.localSimPos.copy(node.simPos).applyMatrix4(scratch.invParent);

        bone.position.copy(scratch.localSimPos);
        bone.updateMatrix();
        bone.updateMatrixWorld(true);
      }
    }
  });

  return null;
}
