'use client';

import { Suspense, useCallback, useEffect, type RefObject } from 'react';
import * as THREE from 'three';
import { HeadModel, type SceneHandles } from '@/components/scene/HeadModel';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { useBuilderStore } from '@/lib/builderStore';

interface BuilderCharacterProps {
  manifest: Mo2Manifest | null;
  playerGroupRef: RefObject<THREE.Group | null>;
}

/**
 * Renders the user's live customized character standing on `y = 0` inside the
 * Room Builder scene. Feet align cleanly via the +1.476m vertical offset
 * matching `BackgroundStage.FLOOR_Y`.
 */
export function BuilderCharacter({ manifest, playerGroupRef }: BuilderCharacterProps) {
  const onReady = useCallback((_h: SceneHandles) => {}, []);
  const onDirty = useCallback(() => {}, []);

  // Initialize transform from store when mounted or reset (TourController mutates ref at 60 FPS)
  const playerPos = useBuilderStore((s) => s.playerPos);
  const playerYaw = useBuilderStore((s) => s.playerYaw);

  useEffect(() => {
    if (!playerGroupRef.current) return;
    playerGroupRef.current.position.set(playerPos[0], 0, playerPos[2]);
    playerGroupRef.current.rotation.y = playerYaw;
  }, [playerGroupRef, playerPos, playerYaw]);

  return (
    <group ref={playerGroupRef} name="builder-player-root">
      <group position={[0, 1.476, 0]}>
        <Suspense fallback={null}>
          <HeadModel
            manifest={manifest}
            onReady={onReady}
            onDirty={onDirty}
          />
        </Suspense>
      </group>
    </group>
  );
}
