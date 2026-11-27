'use client';

import { Suspense, useCallback, useEffect, type RefObject } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { HeadModel, type SceneHandles } from '@/components/scene/HeadModel';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { FLOOR_SLAB_TOP, useBuilderStore } from '@/lib/builderStore';
import { useCharacter } from '@/lib/store';

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

  const mode = useBuilderStore((s) => s.mode);
  const ghostCatalogId = useBuilderStore((s) => s.ghostCatalogId);
  const activeStation = useBuilderStore((s) => s.activeStation);
  const lightingIntensity = useCharacter((s) => s.lighting.intensity);

  // Sync transform directly on the Three.js Group via store subscription so
  // walking in TOUR mode (10 Hz minimap pose updates) never re-renders <HeadModel>.
  useEffect(() => {
    const applyPose = (pos: [number, number, number], yaw: number) => {
      if (!playerGroupRef.current) return;
      playerGroupRef.current.position.set(pos[0], 0, pos[2]);
      playerGroupRef.current.rotation.y = yaw;
    };

    const initial = useBuilderStore.getState();
    applyPose(initial.playerPos, initial.playerYaw);

    return useBuilderStore.subscribe((state, prev) => {
      if (state.playerPos === prev.playerPos && state.playerYaw === prev.playerYaw) return;
      // TourController owns the ref directly while walking in free tour mode
      if (state.mode === 'tour' && !state.activeStation) return;
      applyPose(state.playerPos, state.playerYaw);
    });
  }, [playerGroupRef]);

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
      <group position={[0, 1.476 + FLOOR_SLAB_TOP, 0]}>
        <Suspense fallback={null}>
          <HeadModel
            manifest={manifest}
            onReady={onReady}
            onDirty={onDirty}
          />
        </Suspense>
      </group>
      {/* Non-shadow studio face catchlight & nose/cheek fill (slightly boosted in Station close-ups) */}
      <pointLight
        position={[0.05, 1.52, 0.38]}
        intensity={(activeStation ? 0.42 : 0.24) * lightingIntensity}
        color="#ffffff"
        distance={2.2}
        decay={2}
      />
    </group>
  );
}
