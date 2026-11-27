'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Html, TransformControls, useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import {
  useBuilderStore,
  type BuilderMode,
  type PlacedItem,
} from '@/lib/builderStore';
import { useCharacter } from '@/lib/store';
import { INTERACT_LABELS } from '@/lib/builderCatalog';
import { registerCatalogExtent } from '@/lib/builder/footprintRegistry';
import { validatePlacement } from '@/lib/builder/placementValidator';

interface PlacedItemMeshProps {
  item: PlacedItem;
  selected: boolean;
  mode: BuilderMode;
  grid: 0.5 | 1.0;
  isNearbyInteract: boolean;
  onDraggingChange?: (dragging: boolean) => void;
}

function LoadedAsset({
  item,
  selected,
  dragInvalid,
  dragReason,
  onSelect,
  showPrompt,
}: {
  item: PlacedItem;
  selected: boolean;
  dragInvalid: boolean;
  dragReason: string | null;
  onSelect: (e: ThreeEvent<MouseEvent>) => void;
  showPrompt: boolean;
}) {
  const gltf = useGLTF(item.assetPath);

  const { clonedScene, localOffset, boxSize, boxCenter } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = item.type !== 'floor';
        child.receiveShadow = true;
      }
    });

    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    let ox = 0;
    let oy = -box.min.y;
    let oz = 0;

    if (item.type === 'floor') {
      oy = -box.max.y;
    } else if (item.type === 'prop') {
      ox = -center.x;
      oz = -center.z;
    }

    return {
      clonedScene: clone,
      localOffset: [ox, oy, oz] as [number, number, number],
      boxSize: size,
      boxCenter:
        item.type === 'prop'
          ? new THREE.Vector3(0, size.y * 0.5, 0)
          : new THREE.Vector3(center.x + ox, size.y * 0.5, center.z + oz),
    };
  }, [gltf.scene, item.type]);

  // Share measured unscaled GLTF bounds with placementValidator
  useEffect(() => {
    registerCatalogExtent(item.catalogId, [boxSize.x, boxSize.y, boxSize.z]);
  }, [item.catalogId, boxSize]);

  const interactMeta = item.interactTag ? INTERACT_LABELS[item.interactTag] : null;

  return (
    <group onClick={onSelect}>
      <group scale={item.scale}>
        <primitive object={clonedScene} position={localOffset} />
        {(selected || dragInvalid) && (
          <mesh position={boxCenter}>
            <boxGeometry args={[boxSize.x + 0.03, boxSize.y + 0.03, boxSize.z + 0.03]} />
            <meshBasicMaterial
              color={dragInvalid ? '#ff3b3b' : '#eac87f'}
              wireframe
              transparent
              opacity={dragInvalid ? 0.95 : 0.75}
            />
          </mesh>
        )}
      </group>

      {dragInvalid && (
        <Html position={[0, boxSize.y * item.scale[1] + 0.35, 0]} center zIndexRange={[30, 0]}>
          <div className="pointer-events-none whitespace-nowrap rounded-[2px] border border-[#ff5a5a]/85 bg-[#2a0d0d]/95 px-2.5 py-1 text-[10px] font-mono tracking-wider text-[#ffd2d2] uppercase shadow-lg">
            {dragReason ? `${dragReason} — Release to revert` : 'Overlap — Release to revert'}
          </div>
        </Html>
      )}

      {!dragInvalid && showPrompt && interactMeta && (
        <Html
          position={[0, boxSize.y * item.scale[1] + 0.35, 0]}
          center
          distanceFactor={6}
          zIndexRange={[30, 0]}
        >
          <div className="pointer-events-none flex items-center gap-2 whitespace-nowrap rounded-[2px] border border-[#dfba73]/80 bg-[#121318]/92 px-2.5 py-1 text-[11px] font-mono tracking-wider text-[#f5ecd8] shadow-[0_4px_16px_rgba(0,0,0,0.65)] backdrop-blur-md">
            <span className="flex h-5 w-5 items-center justify-center rounded-[2px] border border-[#dfba73] bg-[#dfba73]/25 font-bold text-[#eac87f]">
              E
            </span>
            <span className="uppercase">{interactMeta.label}</span>
          </div>
        </Html>
      )}
    </group>
  );
}

export function PlacedItemMesh({
  item,
  selected,
  mode,
  grid,
  isNearbyInteract,
  onDraggingChange,
}: PlacedItemMeshProps) {
  const selectItem = useBuilderStore((s) => s.selectItem);
  const moveItem = useBuilderStore((s) => s.moveItem);
  const ghostCatalogId = useBuilderStore((s) => s.ghostCatalogId);
  const activeStation = useBuilderStore((s) => s.activeStation);
  const groupRef = useRef<THREE.Group | null>(null);
  const [dragState, setDragState] = useState<{ invalid: boolean; reason: string | null }>({
    invalid: false,
    reason: null,
  });

  const canSelect = mode === 'decorate' && !ghostCatalogId && !activeStation;
  const showGizmo = selected && mode === 'decorate' && !ghostCatalogId && !activeStation;

  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.position.set(item.position[0], item.position[1], item.position[2]);
    setDragState({ invalid: false, reason: null });
  }, [item.position]);

  const validateCurrentTransform = (): {
    snapped: [number, number, number];
    valid: boolean;
    reason: string | null;
    replaceIds?: string[];
  } => {
    const p = groupRef.current?.position;
    const snapped: [number, number, number] = p
      ? [Math.round(p.x / grid) * grid, item.position[1], Math.round(p.z / grid) * grid]
      : item.position;
    const state = useBuilderStore.getState();
    const res = validatePlacement(
      { ...item, position: snapped },
      state.placedItems,
      { excludeId: item.id, roomBounds: state.roomBounds },
    );
    return { snapped, valid: res.valid, reason: res.reason, replaceIds: res.replaceIds };
  };

  const handleSelect = (e: ThreeEvent<MouseEvent>) => {
    if (!canSelect) return;
    e.stopPropagation();
    selectItem(item.id);
  };

  return (
    <>
      <group
        ref={groupRef}
        position={item.position}
        rotation={[0, THREE.MathUtils.degToRad(item.rotation), 0]}
      >
        <Suspense fallback={null}>
          <LoadedAsset
            item={item}
            selected={selected && mode !== 'tour'}
            dragInvalid={dragState.invalid}
            dragReason={dragState.reason}
            onSelect={handleSelect}
            showPrompt={mode === 'tour' && isNearbyInteract}
          />
        </Suspense>
      </group>
      {showGizmo && groupRef.current && (
        <TransformControls
          object={groupRef.current}
          mode="translate"
          showY={false}
          translationSnap={grid}
          size={0.65}
          onMouseDown={() => onDraggingChange?.(true)}
          onObjectChange={() => {
            const check = validateCurrentTransform();
            setDragState((prev) =>
              prev.invalid === !check.valid && prev.reason === check.reason
                ? prev
                : { invalid: !check.valid, reason: check.reason },
            );
          }}
          onMouseUp={() => {
            onDraggingChange?.(false);
            if (!groupRef.current) return;
            const check = validateCurrentTransform();
            setDragState({ invalid: false, reason: null });
            if (!check.valid) {
              groupRef.current.position.set(item.position[0], item.position[1], item.position[2]);
              useCharacter
                .getState()
                .showToast(`Blocked${check.reason ? `: ${check.reason}` : ''}`);
              return;
            }
            if (check.replaceIds?.length) {
              const store = useBuilderStore.getState();
              for (const rid of check.replaceIds) store.removeItem(rid);
            }
            moveItem(item.id, check.snapped);
          }}
        />
      )}
    </>
  );
}
