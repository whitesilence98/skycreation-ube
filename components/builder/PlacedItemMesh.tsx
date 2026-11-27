'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Html, TransformControls, useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import {
  useBuilderStore,
  type BuilderMode,
  type PlacedItem,
} from '@/lib/builderStore';
import { INTERACT_LABELS } from '@/lib/builderCatalog';

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
  onSelect,
  showPrompt,
}: {
  item: PlacedItem;
  selected: boolean;
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
      // Top surface of floor tiles sits cleanly at y = 0
      oy = -box.max.y;
    } else if (item.type === 'prop') {
      // Center furniture/decor around XZ origin so [R] rotates in place
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

  const interactMeta = item.interactTag ? INTERACT_LABELS[item.interactTag] : null;

  return (
    <group onClick={onSelect}>
      <group scale={item.scale}>
        <primitive object={clonedScene} position={localOffset} />
        {selected && (
          <mesh position={boxCenter}>
            <boxGeometry args={[boxSize.x + 0.03, boxSize.y + 0.03, boxSize.z + 0.03]} />
            <meshBasicMaterial
              color="#eac87f"
              wireframe
              transparent
              opacity={0.75}
            />
          </mesh>
        )}
      </group>

      {showPrompt && interactMeta && (
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
  const groupRef = useRef<THREE.Group | null>(null);

  const canSelect =
    mode === 'decorate' &&
    !ghostCatalogId;
  const showGizmo = selected && mode === 'decorate' && !ghostCatalogId;

  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.position.set(item.position[0], item.position[1], item.position[2]);
  }, [item.position]);

  const handleSelect = (e: ThreeEvent<MouseEvent>) => {
    // Let BUILD WALLS clicks and active DECORATE brush placements fall straight through to floor grid!
    if (!canSelect) return;
    if (mode === 'decorate' && item.type === 'floor' && !selected) {
      // Floor tiles still selectable on deliberate click when no brush active,
      // unless user drags/places. Keeping stopPropagation only on valid selection.
    }
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
          onMouseUp={() => {
            onDraggingChange?.(false);
            if (groupRef.current) {
              const p = groupRef.current.position;
              moveItem(item.id, [
                Math.round(p.x / grid) * grid,
                item.position[1],
                Math.round(p.z / grid) * grid,
              ]);
            }
          }}
        />
      )}
    </>
  );
}
