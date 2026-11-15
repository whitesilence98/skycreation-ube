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
  hair?: { tone: string; gloss: number; alpha?: number };
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
      />
    );
  }

  const authored = (
    <AuthoredPart
      name={part.label || 'Hair'}
      mesh={mesh}
      defaultRole={defaultRole}
      fallbackTexture={part.texture ?? fallbackTexture}
      fallbackNormalByRole={normalFallback}
      hair={hair}
      renderOrder={renderOrder}
    />
  );

  return rigRoot ? createPortal(authored, rigRoot) : authored;
}
