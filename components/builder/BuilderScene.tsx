'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { useCharacter } from '@/lib/store';
import { KENNEY_UNIT_SCALE, useBuilderStore } from '@/lib/builderStore';
import { BUILDER_CATALOG_BY_ID } from '@/lib/builderCatalog';
import { hydrateBuilderSession, saveBuilderSession } from '@/lib/builderSession';
import { buildWallChain, snapToGrid, type GridPoint } from '@/lib/builder/wallPlacer';
import { BuilderCamera } from '@/components/builder/BuilderCamera';
import { RoomGrid } from '@/components/builder/RoomGrid';
import { PlacedItemMesh } from '@/components/builder/PlacedItemMesh';
import { GhostItem, WallGhostChain } from '@/components/builder/GhostItem';
import { BuilderCharacter } from '@/components/builder/BuilderCharacter';
import { TourController } from '@/components/builder/TourController';
import { RoomLifeController, TimeOfDayLighting } from '@/components/builder/RoomLifeController';

interface BuilderSceneProps {
  manifest: Mo2Manifest | null;
}

export function BuilderScene({ manifest }: BuilderSceneProps) {
  const mode = useBuilderStore((s) => s.mode);
  const grid = useBuilderStore((s) => s.grid);
  const placedItems = useBuilderStore((s) => s.placedItems);
  const selectedItemId = useBuilderStore((s) => s.selectedItemId);
  const ghostCatalogId = useBuilderStore((s) => s.ghostCatalogId);
  const ghostRotation = useBuilderStore((s) => s.ghostRotation);
  const nearbyInteract = useBuilderStore((s) => s.nearbyInteract);
  const roomWidth = useBuilderStore((s) => s.roomWidth);
  const roomDepth = useBuilderStore((s) => s.roomDepth);
  const hydrated = useBuilderStore((s) => s.hydrated);

  const playerGroupRef = useRef<THREE.Group | null>(null);
  const [orbitEnabled, setOrbitEnabled] = useState(true);
  const [hoverPoint, setHoverPoint] = useState<GridPoint>({ x: 0, z: 0 });
  const [wallStart, setWallStart] = useState<GridPoint | null>(null);

  // Hydrate saved room layout once on mount
  useEffect(() => {
    hydrateBuilderSession();
  }, []);

  // Debounced session persistence when placed items change
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      saveBuilderSession(placedItems, roomWidth, roomDepth);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [placedItems, roomWidth, roomDepth, hydrated]);

  // Clear in-progress wall draw when switching out of build mode
  useEffect(() => {
    if (mode !== 'build') {
      setWallStart(null);
    }
  }, [mode]);

  // Determine which wall asset is active during BUILD WALLS mode
  const activeWallCatalogId = useMemo(() => {
    if (!ghostCatalogId) return 'structure/wall';
    const entry = BUILDER_CATALOG_BY_ID[ghostCatalogId];
    return entry?.type === 'wall' ? entry.id : 'structure/wall';
  }, [ghostCatalogId]);

  const wallPreviewSegments = useMemo(() => {
    if (mode !== 'build' || !wallStart) return [];
    return buildWallChain(wallStart, hoverPoint, activeWallCatalogId);
  }, [mode, wallStart, hoverPoint, activeWallCatalogId]);

  const wallPreviewLength = useMemo(() => {
    if (!wallStart) return 0;
    return Math.abs(hoverPoint.x - wallStart.x) + Math.abs(hoverPoint.z - wallStart.z);
  }, [wallStart, hoverPoint]);

  const handlePointerMoveFloor = useCallback(
    (pt: THREE.Vector3) => {
      if (mode === 'tour') return;
      const snapped = snapToGrid(pt.x, pt.z, grid);
      setHoverPoint((prev) =>
        prev.x === snapped.x && prev.z === snapped.z ? prev : snapped,
      );
    },
    [mode, grid],
  );

  const handleClickFloor = useCallback(
    (pt: THREE.Vector3, e: ThreeEvent<MouseEvent>) => {
      if (mode === 'tour') return;
      // Only treat clean clicks (not orbit drags) as placements
      if (e.delta > 6) return;
      const snapped = snapToGrid(pt.x, pt.z, grid);
      const store = useBuilderStore.getState();

      if (mode === 'build') {
        if (!wallStart) {
          setWallStart(snapped);
        } else {
          const chain = buildWallChain(wallStart, snapped, activeWallCatalogId);
          if (chain.length > 0) {
            store.placeBatch(chain);
          }
          setWallStart(null);
        }
        return;
      }

      // Decorate mode
      if (ghostCatalogId) {
        const entry = BUILDER_CATALOG_BY_ID[ghostCatalogId];
        if (!entry) return;
        store.placeItem({
          catalogId: entry.id,
          assetPath: entry.path,
          category: entry.category,
          type: entry.type,
          position: [snapped.x, 0, snapped.z],
          rotation: ghostRotation,
          scale: [KENNEY_UNIT_SCALE, KENNEY_UNIT_SCALE, KENNEY_UNIT_SCALE],
          interactTag: entry.interactTag,
          noCollide: entry.noCollide,
        });
      } else {
        store.selectItem(null);
      }
    },
    [mode, grid, wallStart, activeWallCatalogId, ghostCatalogId, ghostRotation],
  );

  const handleContextMenuFloor = useCallback(() => {
    if (wallStart) {
      setWallStart(null);
      return;
    }
    const store = useBuilderStore.getState();
    if (store.ghostCatalogId) {
      store.setGhost(null);
    } else if (store.selectedItemId) {
      store.selectItem(null);
    }
  }, [wallStart]);

  // Global hotkeys for build & decorate modes ([R] rotate, [DEL] remove, [ESC] cancel/back)
  useEffect(() => {
    if (mode === 'tour') return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest('input, textarea, select')) return;

      const key = e.key.toLowerCase();
      const store = useBuilderStore.getState();

      if (key === 'r' && !e.repeat) {
        e.preventDefault();
        if (store.ghostCatalogId) {
          store.rotateGhost();
        } else if (store.selectedItemId) {
          store.rotateItem(store.selectedItemId);
        }
      } else if ((key === 'delete' || key === 'backspace') && !e.repeat) {
        if (store.selectedItemId) {
          e.preventDefault();
          store.removeItem(store.selectedItemId);
        }
      } else if (key === 'escape') {
        e.preventDefault();
        if (wallStart) {
          setWallStart(null);
        } else if (store.ghostCatalogId) {
          store.setGhost(null);
        } else if (store.selectedItemId) {
          store.selectItem(null);
        } else if (store.activeSubCategory) {
          store.setSubCategory(null);
        } else {
          useCharacter.getState().setAppMode('studio');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, wallStart]);

  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ fov: 44, near: 0.1, far: 50, position: [5.4, 5.2, 6.4] }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.setClearColor('#23262d', 1);
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <BuilderCamera mode={mode} orbitEnabled={orbitEnabled} />

      {/* Time-of-day interior lighting driven by in-game clock */}
      <TimeOfDayLighting />

      <RoomGrid
        gridSize={grid}
        visible={mode !== 'tour'}
        onPointerMoveFloor={handlePointerMoveFloor}
        onClickFloor={handleClickFloor}
        onContextMenuFloor={handleContextMenuFloor}
      />

      {/* Placed structural walls, floors & furniture */}
      {placedItems.map((item) => (
        <PlacedItemMesh
          key={item.id}
          item={item}
          selected={item.id === selectedItemId}
          mode={mode}
          grid={grid}
          isNearbyInteract={nearbyInteract?.itemId === item.id}
          onDraggingChange={(dragging) => setOrbitEnabled(!dragging)}
        />
      ))}

      {/* Active ghost preview: wall chain in BUILD WALLS, or single prop in DECORATE */}
      {mode === 'build' && wallStart && (
        <WallGhostChain
          segments={wallPreviewSegments}
          endPoint={[hoverPoint.x, 0, hoverPoint.z]}
          lengthMeters={wallPreviewLength}
        />
      )}
      {mode === 'build' && !wallStart && (
        <GhostItem
          catalogId={activeWallCatalogId}
          position={[hoverPoint.x, 0, hoverPoint.z]}
          rotation={ghostRotation}
          promptLabel="START WALL [L-CLICK]"
        />
      )}
      {mode === 'decorate' && ghostCatalogId && (
        <GhostItem
          catalogId={ghostCatalogId}
          position={[hoverPoint.x, 0, hoverPoint.z]}
          rotation={ghostRotation}
          promptLabel="PLACE [L-CLICK]"
        />
      )}

      {/* User's live customized character */}
      <BuilderCharacter manifest={manifest} playerGroupRef={playerGroupRef} />

      {/* Autonomous clock + Room Life AI when building/decorating */}
      <RoomLifeController playerGroupRef={playerGroupRef} />

      {/* Third-person exploration controller in TOUR mode */}
      {mode === 'tour' && <TourController playerGroupRef={playerGroupRef} />}
    </Canvas>
  );
}
