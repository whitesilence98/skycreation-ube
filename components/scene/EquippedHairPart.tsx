'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { createPortal } from '@react-three/fiber';
import type { Mo2PartOption } from '@/lib/head/faceTexture';
import type { LoadedMesh, MaterialRole } from '@/components/scene/useMeshGeometry';
import { useMeshResource } from '@/components/scene/useMeshGeometry';
import { SkinnedPart } from '@/components/scene/SkinnedPart';
import { AuthoredPart } from '@/components/scene/AuthoredPart';
import type { SkeletonRegistry } from '@/lib/character/skeleton';
import { hairOffsetMetres } from '@/lib/hair/settings';

export interface EquippedHairPartProps {
  /** One resolved companion hair part from `manifest.parts.hairParts` */
  part: Mo2PartOption;
  registry: SkeletonRegistry;
  rigDonor?: LoadedMesh;
  /** Root object of the head mesh (rig.root) for mounting unskinned hair parts */
  rigRoot?: THREE.Object3D | null;
  defaultRole?: MaterialRole;
  fallbackTexture?: string;
  fallbackNormalByRole?: Partial<Record<MaterialRole, string>>;
  hair?: { tone: string; gloss: number; alpha?: number; hairOffset?: number };
  renderOrder?: number;
}

/**
 * One constituent part of a multi-part Skyrim hairstyle.
 *
 * Skyrim hairstyles often split across companion NIF files (e.g. `HairStyleA.nif`
 * + `HairStyleA2.nif` + `HairStyleA3.nif`). Each part is mounted simultaneously:
 *  - If it contains bones, it skins to `skeletonRegistry` via `<SkinnedPart>`.
 *  - If it is rigid/unskinned, it mounts directly under `rig.root` via `<AuthoredPart>`.
 *
 * All parts in the hairstyle share the same hair color tone, glossiness, and alpha.
 */
export function EquippedHairPart({
  part,
  registry,
  rigDonor,
  rigRoot,
  defaultRole = 'hair',
  fallbackTexture,
  fallbackNormalByRole,
  hair,
  renderOrder = 6,
}: EquippedHairPartProps) {
  const resource = useMeshResource(part.meshUrl, `hair part ${part.label || part.id || ''}`);
  const mesh = resource.mesh;

  const normalFallback = useMemo(() => fallbackNormalByRole ?? {}, [fallbackNormalByRole]);
  /* One vertical placement for the whole hairstyle (all parts share it). */
  const offset = hairOffsetMetres(hair?.hairOffset ?? 0);

  if (!mesh) return null;

  if (mesh.bones?.length) {
    return (
      <SkinnedPart
        name={part.label || 'Hair'}
        mesh={mesh}
        registry={registry}
        rigDonor={rigDonor}
        defaultRole={defaultRole}
        fallbackTexture={part.texture ?? fallbackTexture}
        fallbackNormalByRole={normalFallback}
        hair={hair}
        renderOrder={renderOrder}
        /* A bound `SkinnedMesh` cancels its own transform, so the offset has to
           move vertices; `SkinnedPart` does that on a private geometry clone. */
        verticalOffset={offset}
      />
    );
  }

  /* A rigid part has no bind matrix to cancel an object transform, so its
     offset rides a wrapper group — mounted under `rig.root` through the same
     portal as the part itself. */
  const authored = (
    <group name={`${part.label || 'Hair'} offset`} position={[0, offset, 0]}>
      <AuthoredPart
        name={part.label || 'Hair'}
        mesh={mesh}
        defaultRole={defaultRole}
        fallbackTexture={part.texture ?? fallbackTexture}
        fallbackNormalByRole={normalFallback}
        hair={hair}
        renderOrder={renderOrder}
      />
    </group>
  );

  return rigRoot ? createPortal(authored, rigRoot) : authored;
}
