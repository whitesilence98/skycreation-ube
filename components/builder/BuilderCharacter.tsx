'use client';

import { Suspense, useCallback, useEffect, type RefObject } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
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
 * Room Builder scene. Clicking the character in `build`/`decorate` zooms into
 * 3rd-person `tour` mode.
 */
export function BuilderCharacter({ manifest, playerGroupRef }: BuilderCharacterProps) {
  const onReady = useCallback((_h: SceneHandles) => {}, []);
  const onDirty = useCallback(() => {}, []);

  // Initialize transform from store when mounted or reset (TourController mutates ref at 60 FPS)
  const playerPos = useBuilderStore((s) => s.playerPos);
  const playerYaw = useBuilderStore((s) => s.playerYaw);
  const mode = useBuilderStore((s) => s.mode);
  const ghostCatalogId = useBuilderStore((s) => s.ghostCatalogId);

  useEffect(() => {
    if (!playerGroupRef.current) return;
    playerGroupRef.current.position.set(playerPos[0], 0, playerPos[2]);
    playerGroupRef.current.rotation.y = playerYaw;
  }, [playerGroupRef, playerPos, playerYaw]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, []);

  const canClickToTour = mode !== 'tour' && !ghostCatalogId;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!canClickToTour || e.delta > 6) return;
    e.stopPropagation();
    document.body.style.cursor = 'auto';
    if (playerGroupRef.current) {
      useBuilderStore
        .getState()
        .setPlayerPose(
          [playerGroupRef.current.position.x, 0, playerGroupRef.current.position.z],
          playerGroupRef.current.rotation.y,
        );
    }
    useBuilderStore.getState().setMode('tour');
  };

  return (
    <group
      ref={playerGroupRef}
      name="builder-player-root"
      onClick={handleClick}
      onPointerOver={(e) => {
        if (!canClickToTour) return;
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        if (document.body.style.cursor === 'pointer') {
          document.body.style.cursor = 'auto';
        }
      }}
    >
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
