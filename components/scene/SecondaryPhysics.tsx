'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCharacter } from '@/lib/store';
import type { SkeletonRegistry } from '@/lib/character/skeleton';
import {
  buildSecondaryChains,
  type DynamicParticle,
  type SecondaryChainSet,
} from '@/lib/character/secondaryBones';

interface SecondaryPhysicsProps {
  registry: SkeletonRegistry;
}

interface SecondaryCollider {
  boneName: string;
  fallbackName?: string;
  radius: number;
  offset: THREE.Vector3;
}

/** Analytical body colliders to prevent dynamic hair and garments from cutting into anatomy. */
const SECONDARY_COLLIDERS: readonly SecondaryCollider[] = [
  // Head sphere - deflects bangs and front hair strands away from face and skull
  {
    boneName: 'NPC Head [Head]',
    radius: 0.088,
    offset: new THREE.Vector3(0, -0.015, 0.02),
  },
  // Neck / Throat sphere
  {
    boneName: 'NPC Neck [Neck]',
    radius: 0.075,
    offset: new THREE.Vector3(0, 0, 0.01),
  },
  // Upper Chest / Clavicle area - deflects long hair and capes from sinking into shoulders
  {
    boneName: 'NPC Spine2 [Spn2]',
    radius: 0.11,
    offset: new THREE.Vector3(0, 0, 0.01),
  },
  // Pelvis / Hips sphere - deflects upper skirts, robes, and belts
  {
    boneName: 'NPC Pelvis [Pelv]',
    radius: 0.12,
    offset: new THREE.Vector3(0, 0, 0),
  },
  // Left Upper Thigh capsule/sphere - deflects skirts and robes from sinking into thighs
  {
    boneName: 'NPC L Thigh [LThg]',
    radius: 0.082,
    offset: new THREE.Vector3(0, 0.08, 0),
  },
  // Right Upper Thigh capsule/sphere
  {
    boneName: 'NPC R Thigh [RThg]',
    radius: 0.082,
    offset: new THREE.Vector3(0, 0.08, 0),
  },
];

export function SecondaryPhysics({ registry }: SecondaryPhysicsProps) {
  const globalEnabled = useCharacter((s) => s.secondaryPhysicsEnabled);
  const hairEnabled = useCharacter((s) => s.hairPhysicsEnabled);
  const clothEnabled = useCharacter((s) => s.clothPhysicsEnabled);
  const stiffness = useCharacter((s) => s.secondaryStiffness);
  const damping = useCharacter((s) => s.secondaryDamping);
  const windIntensity = useCharacter((s) => s.secondaryWindIntensity);
  const impulseNonce = useCharacter((s) => s.secondaryImpulseNonce);
  const bodyPoseId = useCharacter((s) => s.bodyPoseId);
  const weight = useCharacter((s) => s.weight);

  const chainSetRef = useRef<SecondaryChainSet>({
    particles: [],
    hairCount: 0,
    clothCount: 0,
    accessoryCount: 0,
  });

  const lastNonceRef = useRef(impulseNonce);
  const lastCamPosRef = useRef(new THREE.Vector3());
  const camInitializedRef = useRef(false);

  // Scratch objects preallocated to eliminate GC churn inside useFrame
  const scratch = useRef({
    invParent: new THREE.Matrix4(),
    disp: new THREE.Vector3(),
    springForce: new THREE.Vector3(),
    dampForce: new THREE.Vector3(),
    acc: new THREE.Vector3(),
    delta: new THREE.Vector3(),
    camVelocity: new THREE.Vector3(),
    externalImpulse: new THREE.Vector3(),
    windForce: new THREE.Vector3(),
    parentWorldPos: new THREE.Vector3(),
    localSimPos: new THREE.Vector3(),
    currLocalDir: new THREE.Vector3(),
    rotDelta: new THREE.Quaternion(),
    colPos: new THREE.Vector3(),
    colDiff: new THREE.Vector3(),
    colNormal: new THREE.Vector3(),
    identityQuat: new THREE.Quaternion(),
    boneWorldPos: new THREE.Vector3(),
    grandparentQuat: new THREE.Quaternion(),
    invGrandparentQuat: new THREE.Quaternion(),
    restDirGrandparent: new THREE.Vector3(),
    simDirGrandparent: new THREE.Vector3(),
  }).current;

  // Build secondary chains whenever skeleton or pose changes
  useEffect(() => {
    const chains = buildSecondaryChains(registry);
    chainSetRef.current = chains;
  }, [registry, bodyPoseId, weight]);

  // Clean reset when physics is disabled
  useEffect(() => {
    if (!globalEnabled) {
      for (const p of chainSetRef.current.particles) {
        if (!p.isVirtualTip) {
          p.bone.position.copy(p.restLocalPos);
          p.bone.quaternion.copy(p.restLocalQuat);
          p.bone.updateMatrix();
          p.bone.updateMatrixWorld(true);
        }
        p.velocity.set(0, 0, 0);
        p.initialized = false;
      }
    }
  }, [globalEnabled]);

  useFrame(({ camera, clock }, delta) => {
    if (!globalEnabled) return;
    const { particles } = chainSetRef.current;
    if (particles.length === 0) return;

    // Guard time-step against background tabs or extreme frame spikes
    const dt = Math.min(delta, 0.033);
    const subSteps = 2;
    const subDt = dt / subSteps;

    // ── 1. Camera Orbit Momentum / Angular Inertia ───────────────────
    scratch.externalImpulse.set(0, 0, 0);
    if (!camInitializedRef.current) {
      lastCamPosRef.current.copy(camera.position);
      camInitializedRef.current = true;
    } else {
      scratch.camVelocity
        .copy(camera.position)
        .sub(lastCamPosRef.current)
        .divideScalar(Math.max(dt, 0.001));
      lastCamPosRef.current.copy(camera.position);

      const camSpeed = scratch.camVelocity.length();
      if (camSpeed > 0.02 && camSpeed < 10.0) {
        // Inertia factor responds smoothly to stiffness
        const inertiaScale = 0.045 * (1.15 - stiffness * 0.45);
        scratch.externalImpulse.x -= scratch.camVelocity.x * inertiaScale;
        scratch.externalImpulse.z -= scratch.camVelocity.z * inertiaScale;
      }
    }

    // ── 2. Wind Breeze Vector ────────────────────────────────────────
    if (windIntensity > 0.001) {
      const t = clock.getElapsedTime() * 2.2;
      scratch.windForce
        .set(
          Math.sin(t * 1.3) * 0.12 + Math.cos(t * 0.7) * 0.08,
          Math.sin(t * 0.8) * 0.03,
          Math.sin(t * 1.7) * 0.12 + Math.cos(t * 1.1) * 0.06
        )
        .multiplyScalar(windIntensity * 0.7);
    } else {
      scratch.windForce.set(0, 0, 0);
    }

    // ── 3. Test Impulse Kick ─────────────────────────────────────────
    let hasTestImpulse = false;
    if (impulseNonce !== lastNonceRef.current) {
      lastNonceRef.current = impulseNonce;
      hasTestImpulse = true;
    }

    // Dynamic physics parameters mapped smoothly from stiffness & damping
    const baseStiffness = THREE.MathUtils.lerp(75, 260, stiffness);
    const baseDamping = THREE.MathUtils.lerp(9, 26, damping);
    const gravityY = -1.8;

    // ── 4. Sub-stepped Spring-Particle Integration ───────────────────
    for (let step = 0; step < subSteps; step++) {
      for (const p of particles) {
        // Category filters
        if (p.category === 'hair' && !hairEnabled) continue;
        if ((p.category === 'cloth' || p.category === 'accessory') && !clothEnabled) continue;

        const parent = p.parent;
        if (!parent) continue;

        // Desired world position from rigid skeletal transform
        p.targetWorldPos.copy(p.restLocalPos).applyMatrix4(parent.matrixWorld);

        // Snap recovery on first frame or large teleports
        if (!p.initialized || p.simPos.distanceTo(p.targetWorldPos) > 0.4) {
          p.simPos.copy(p.targetWorldPos);
          p.velocity.set(0, 0, 0);
          p.initialized = true;
          continue;
        }

        // Apply dynamic test impulses
        if (step === 0 && hasTestImpulse) {
          const factor = 1.2 - stiffness * 0.4;
          if (p.category === 'hair') {
            p.velocity.y += 0.22 * factor;
            p.velocity.x += (Math.random() - 0.5) * 0.18 * factor;
            p.velocity.z += (Math.random() - 0.5) * 0.18 * factor;
          } else {
            p.velocity.y += 0.18 * factor;
            p.velocity.z -= 0.15 * factor;
          }
        }

        // Hooke's Law Spring Force
        scratch.disp.copy(p.targetWorldPos).sub(p.simPos);
        scratch.springForce.copy(scratch.disp).multiplyScalar(baseStiffness);

        // Damping Force
        scratch.dampForce.copy(p.velocity).multiplyScalar(-baseDamping);

        // Sum forces
        scratch.acc.set(0, 0, 0);
        scratch.acc.add(scratch.springForce);
        scratch.acc.add(scratch.dampForce);
        scratch.acc.y += gravityY;
        scratch.acc.add(scratch.externalImpulse);
        scratch.acc.add(scratch.windForce);

        // Integrate
        p.velocity.addScaledVector(scratch.acc, subDt);
        p.simPos.addScaledVector(p.velocity, subDt);

        // ── 5. Inelastic Distance Constraint (Preserve Bone Length) ──
        // Secondary bones (hair strands, cloth segments) must never stretch like rubber!
        parent.getWorldPosition(scratch.parentWorldPos);
        scratch.delta.copy(p.simPos).sub(scratch.parentWorldPos);
        const currDist = scratch.delta.length();
        if (currDist > 1e-4) {
          p.simPos
            .copy(scratch.parentWorldPos)
            .addScaledVector(scratch.delta, p.restLength / currDist);
        }

        // ── 6. Analytical Sphere Collisions ──────────────────────────
        for (const col of SECONDARY_COLLIDERS) {
          const colBone = registry.byName.get(col.boneName);
          if (!colBone) continue;

          colBone.getWorldPosition(scratch.colPos);
          if (col.offset.lengthSq() > 0) {
            scratch.colPos.add(col.offset);
          }

          scratch.colDiff.copy(p.simPos).sub(scratch.colPos);
          const dist = scratch.colDiff.length();
          const minDist = col.radius + p.radius;

          if (dist < minDist && dist > 1e-4) {
            scratch.colNormal.copy(scratch.colDiff).divideScalar(dist);
            const penetration = minDist - dist;

            // Push particle outward along collision normal
            p.simPos.addScaledVector(scratch.colNormal, penetration);

            // Deflect velocity away from collision surface
            const vDotN = p.velocity.dot(scratch.colNormal);
            if (vDotN < 0) {
              p.velocity.addScaledVector(scratch.colNormal, -vDotN * 1.1);
            }
          }
        }

        // ── 7. Update Bone Orientation ───────────────────────────────
        // Only dynamically rotate secondary bones; never rotate kinematic skeleton bones (Pelvis, Head, etc.)
        if (p.targetBone) {
          p.targetBone.getWorldPosition(scratch.boneWorldPos);
          scratch.delta.copy(p.simPos).sub(scratch.boneWorldPos);

          if (scratch.delta.lengthSq() > 1e-6) {
            scratch.currLocalDir.copy(scratch.delta).normalize();

            // Transform dynamic direction into grandparent's reference space
            const grandparent = p.targetBone.parent;
            if (grandparent) {
              grandparent.getWorldQuaternion(scratch.grandparentQuat);
              scratch.invGrandparentQuat.copy(scratch.grandparentQuat).invert();
              scratch.simDirGrandparent.copy(scratch.currLocalDir).applyQuaternion(scratch.invGrandparentQuat);
            } else {
              scratch.simDirGrandparent.copy(scratch.currLocalDir);
            }

            // Direction at rest in grandparent space = targetRestQuat * restLocalDir
            scratch.restDirGrandparent.copy(p.restLocalDir).applyQuaternion(p.targetRestQuat).normalize();

            // Compute rotation delta from rest direction to current simulated direction
            scratch.rotDelta.setFromUnitVectors(scratch.restDirGrandparent, scratch.simDirGrandparent);

            // Clamp maximum deflection angle to 55 deg (0.96 rad) to prevent flipping
            const maxAngle = (55 * Math.PI) / 180;
            const angle = 2 * Math.acos(Math.min(1, Math.max(-1, scratch.rotDelta.w)));
            if (angle > maxAngle && angle > 1e-4) {
              scratch.rotDelta.slerp(scratch.identityQuat, 1 - maxAngle / angle);
            }

            p.targetBone.quaternion.copy(scratch.rotDelta).multiply(p.targetRestQuat);
            p.targetBone.updateMatrix();
            p.targetBone.updateMatrixWorld(true);
          }
        }
      }
    }
  });

  return null;
}
