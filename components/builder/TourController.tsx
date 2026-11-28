'use client';

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBuilderStore } from '@/lib/builderStore';
import { INTERACT_LABELS } from '@/lib/builderCatalog';
import { buildColliders, resolvePlayerCollision } from '@/lib/builder/collider';
import { getSmartObjectDef, resolveSmartSlot } from '@/lib/builder/smartObjects';
import { useCharacter } from '@/lib/store';

interface TourControllerProps {
  playerGroupRef: RefObject<THREE.Group | null>;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

const _camTarget = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _prevPos = new THREE.Vector3();
const _nextPos = new THREE.Vector3();

/**
 * Third-person room exploration & object-interaction controller for `TOUR` mode.
 * - WASD / Arrows walk, Shift runs, pointer drag rotates camera orbit yaw
 * - Drives existing `AnimationDirector` (`walk` / `run` / `idle`) via store
 * - Checks AABB colliders built from placed walls & furniture
 * - Proximity `[E]` near Vanity / Mirror / Wardrobe / Dresser / Bed opens Studio tab
 */
export function TourController({ playerGroupRef }: TourControllerProps) {
  const { camera, gl } = useThree();
  const placedItems = useBuilderStore((s) => s.placedItems);
  const colliders = useMemo(() => buildColliders(placedItems), [placedItems]);

  const keysRef = useRef<Record<string, boolean>>({});
  const camYawRef = useRef<number>(useBuilderStore.getState().playerYaw + Math.PI);
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);
  const lastAnimRef = useRef<'idle-clip' | 'idle' | 'selfie' | 'rest'>('idle-clip');
  const lastNearbyIdRef = useRef<string | null>(null);
  const minimapSyncAccumRef = useRef(0);

  // Keyboard & pointer-drag yaw listeners
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest('input, textarea, select')) return;

      const k = e.key.toLowerCase();
      keysRef.current[k] = true;

      if (k === 'e' && !e.repeat) {
        const builder = useBuilderStore.getState();
        if (builder.activeStation) return;
        const nearby = builder.nearbyInteract;
        if (nearby) {
          e.preventDefault();
          const item = builder.placedItems.find((i) => i.id === nearby.itemId);
          const def = item ? getSmartObjectDef(item.catalogId) : null;
          if (item && def) {
            const slot = resolveSmartSlot(item, def);
            const nextYaw = slot.facingYaw + Math.PI;
            builder.setPlayerPose([slot.standXZ[0], 0, slot.standXZ[1]], nextYaw);
            if (playerGroupRef.current) {
              playerGroupRef.current.position.set(slot.standXZ[0], 0, slot.standXZ[1]);
              playerGroupRef.current.rotation.y = nextYaw;
            }
          } else if (playerGroupRef.current) {
            builder.setPlayerPose(
              [playerGroupRef.current.position.x, 0, playerGroupRef.current.position.z],
              playerGroupRef.current.rotation.y,
            );
          }
          const meta = INTERACT_LABELS[nearby.tag];
          useCharacter.getState().setAnimationId('idle');
          builder.openStation(nearby.itemId, nearby.tag);
          useCharacter.getState().showToast(meta.label);
        }
      } else if (k === 'escape') {
        if (useBuilderStore.getState().activeStation) return;
        e.preventDefault();
        useCharacter.getState().setAnimationId('idle-clip');
        useBuilderStore.getState().setMode('decorate');
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };

    const dom = gl.domElement;
    const onPointerDown = (e: PointerEvent) => {
      if (useBuilderStore.getState().activeStation) return;
      draggingRef.current = true;
      lastXRef.current = e.clientX;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current || useBuilderStore.getState().activeStation) return;
      const dx = e.clientX - lastXRef.current;
      lastXRef.current = e.clientX;
      camYawRef.current -= dx * 0.0065;
    };
    const onPointerUp = () => {
      draggingRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      useCharacter.getState().setAnimationId(
        useCharacter.getState().appMode === 'builder' ? 'idle-clip' : 'idle',
      );
      useBuilderStore.getState().setNearbyInteract(null);
    };
  }, [gl]);

  useFrame((_, rawDelta) => {
    if (useBuilderStore.getState().activeStation) return;
    const player = playerGroupRef.current;
    if (!player) return;

    const dt = Math.min(rawDelta, 0.05);
    const keys = keysRef.current;

    const forwardInput = (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0);
    const strafeInput = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
    const running = Boolean(keys['shift']);

    const hasInput = forwardInput !== 0 || strafeInput !== 0;
    const nextAnim: 'idle-clip' = 'idle-clip';

    if (nextAnim !== lastAnimRef.current) {
      lastAnimRef.current = nextAnim;
      useCharacter.getState().setAnimationId(nextAnim);
    }

    if (hasInput) {
      const yaw = camYawRef.current;
      // Camera forward on XZ plane is (-sin(yaw), -cos(yaw)); right is (cos(yaw), -sin(yaw))
      const moveX = -Math.sin(yaw) * forwardInput + Math.cos(yaw) * strafeInput;
      const moveZ = -Math.cos(yaw) * forwardInput - Math.sin(yaw) * strafeInput;
      const len = Math.hypot(moveX, moveZ) || 1;
      const speed = running ? 3.2 : 1.55;

      _prevPos.copy(player.position);
      _nextPos.set(
        player.position.x + (moveX / len) * speed * dt,
        0,
        player.position.z + (moveZ / len) * speed * dt,
      );

      // Keep inside generous outer studio bounds [-10..10]
      _nextPos.x = Math.max(-10, Math.min(10, _nextPos.x));
      _nextPos.z = Math.max(-10, Math.min(10, _nextPos.z));

      const resolved = resolvePlayerCollision(_prevPos, _nextPos, colliders, 0.24);
      player.position.copy(resolved);

      const moveDx = resolved.x - _prevPos.x;
      const moveDz = resolved.z - _prevPos.z;
      if (moveDx * moveDx + moveDz * moveDz > 1e-6) {
        const targetYaw = Math.atan2(moveDx, moveDz);
        player.rotation.y = lerpAngle(player.rotation.y, targetYaw, Math.min(1, dt * 12));
      } else {
        const intentYaw = Math.atan2(moveX, moveZ);
        player.rotation.y = lerpAngle(player.rotation.y, intentYaw, Math.min(1, dt * 10));
      }
    }

    // Smooth third-person follow camera behind player along camYawRef
    const dist = 2.65;
    const height = 1.85;
    _camTarget.set(
      player.position.x + Math.sin(camYawRef.current) * dist,
      height,
      player.position.z + Math.cos(camYawRef.current) * dist,
    );
    camera.position.lerp(_camTarget, Math.min(1, dt * 7.5));
    _lookTarget.set(player.position.x, 1.15, player.position.z);
    camera.lookAt(_lookTarget);

    // Proximity scan for interactive furniture
    let bestId: string | null = null;
    let bestTag: NonNullable<(typeof placedItems)[number]['interactTag']> | null = null;
    let bestDistSq = 1.85 * 1.85;

    for (const item of placedItems) {
      if (!item.interactTag) continue;
      const dx = item.position[0] - player.position.x;
      const dz = item.position[2] - player.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestId = item.id;
        bestTag = item.interactTag;
      }
    }

    if (bestId !== lastNearbyIdRef.current) {
      lastNearbyIdRef.current = bestId;
      useBuilderStore.getState().setNearbyInteract(
        bestId && bestTag
          ? { itemId: bestId, tag: bestTag, label: INTERACT_LABELS[bestTag].label }
          : null,
      );
    }

    // Throttle minimap pose sync (~10Hz) to avoid Zustand churn every frame
    minimapSyncAccumRef.current += dt;
    if (minimapSyncAccumRef.current >= 0.1) {
      minimapSyncAccumRef.current = 0;
      useBuilderStore
        .getState()
        .setPlayerPose([player.position.x, 0, player.position.z], player.rotation.y);
    }
  });

  return null;
}
