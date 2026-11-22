'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Texture } from 'three';
import type { Mo2PartOption } from '@/lib/head/faceTexture';
import type { LoadedMesh, MaterialRole } from '@/components/scene/useMeshGeometry';
import { useCharacter } from '@/lib/store';
import { useWeightedMeshResource } from '@/components/scene/useMeshGeometry';
import { SkinnedPart } from '@/components/scene/SkinnedPart';
import { AuthoredPart } from '@/components/scene/AuthoredPart';
import type { SkeletonRegistry } from '@/lib/character/skeleton';
import { useBodySlideStore } from '@/lib/bodyslide/store';
import {
  loadGarmentOsd,
  resolveGarmentOsdUrl,
  loadGarmentMappings,
  applyBodySlideMorphs,
  computeMeshShapeOffsets,
} from '@/lib/bodyslide/morphLoader';
import type { OsdData, SliderOspMapping } from '@/lib/bodyslide/osdParser';

export interface EquippedGarmentProps {
  /** One resolved slot entry from `manifest.parts.equipment`. */
  part: Mo2PartOption & { slot?: string };
  registry: SkeletonRegistry;
  rigDonor?: LoadedMesh;
  /** Body weight, 0–1 — the same value the torso and limbs blend with. */
  weight: number;
  /** Shapes to skip, e.g. the garment's own embedded body when one is drawn. */
  hiddenRoles?: MaterialRole[];
  /** Hide this garment's own embedded `skin` shapes. */
  hideEmbeddedBody?: boolean;
  fallbackByRole?: Partial<Record<MaterialRole, string>>;
  fallbackNormalByRole?: Partial<Record<MaterialRole, string>>;
  fallbackRoughnessByRole?: Partial<Record<MaterialRole, string>>;
  skinOverride?: { texture?: string; normalTexture?: string; roughnessTexture?: string };
  skinColor?: string;
  skinDetailMap?: Texture | null;
  skinDetail?: number;
  renderOrder?: number;
}

/**
 * One worn garment, blended across its own `_0`/`_1` pair.
 *
 * A Skyrim armour NIF ships weight-0 and weight-100 halves over one atlas, and
 * the game lerps between them as the body-weight slider moves. The producer
 * joins those halves, so a garment behaves exactly like the torso, hands and
 * feet instead of staying rigid at whatever weight the artist exported.
 *
 * This is a component rather than a hook inside `HeadModel`'s render loop for
 * one reason: a hook cannot be called conditionally or in a loop, and the
 * number of worn garments changes at runtime. Mounting one component per slot
 * keeps the hook order stable when the user equips a third piece.
 */
export function EquippedGarment({
  part,
  registry,
  rigDonor,
  weight,
  hiddenRoles,
  hideEmbeddedBody = false,
  fallbackByRole,
  fallbackNormalByRole,
  fallbackRoughnessByRole,
  skinOverride,
  skinColor,
  skinDetailMap,
  skinDetail,
  renderOrder = 0,
}: EquippedGarmentProps) {
  const resource = useWeightedMeshResource(
    part.weightVariants,
    part.meshUrl,
    `equipment ${part.slot ?? 'garment'}`,
    weight,
  );
  const mesh = resource.mesh;

  /* ── Real-time BodySlide Garment Morph Deformation ───────────────
     Deforms the equipped garment geometry using its matching .osd
     from Clothes Pack 6 UBE whenever BodySlide sliders change. */
  const clothedSliders = useBodySlideStore((s) => s.clothedSliders);
  const basePositionsRef = useRef<Float32Array | null>(null);
  const [garmentOsd, setGarmentOsd] = useState<OsdData | null>(null);
  const [garmentMappings, setGarmentMappings] = useState<Record<string, SliderOspMapping> | null>(null);

  // Load matching garment OSD when mesh or garment selection changes
  useEffect(() => {
    let cancelled = false;
    const osdUrl = resolveGarmentOsdUrl(part);
    if (!osdUrl) {
      setGarmentOsd(null);
      setGarmentMappings(null);
      return;
    }

    Promise.all([
      loadGarmentOsd(osdUrl),
      loadGarmentMappings(part),
    ])
      .then(([osdData, mappings]) => {
        if (!cancelled) {
          setGarmentOsd(osdData);
          setGarmentMappings(mappings);
        }
      })
      .catch((err) => {
        console.warn(`[EquippedGarment] Could not load OSD for ${part.label || part.id}:`, err);
      });

    return () => {
      cancelled = true;
    };
  }, [part.id, part.meshUrl, part.label, part.file, (part as { weightKey?: string }).weightKey]);

  // Snapshot clean base positions when mesh or weight changes
  useEffect(() => {
    if (!mesh?.geometry) {
      basePositionsRef.current = null;
      return;
    }
    const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!posAttr) return;
    basePositionsRef.current = new Float32Array(posAttr.array);
  }, [mesh, weight]);

  const shapeOffsets = useMemo(() => computeMeshShapeOffsets(mesh), [mesh]);

  // Apply real-time morph deformation
  useEffect(() => {
    if (!mesh?.geometry || !garmentOsd || !garmentMappings || !basePositionsRef.current) return;
    const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!posAttr) return;

    const base = basePositionsRef.current;
    const target = posAttr.array as Float32Array;
    if (target.length !== base.length) return;

    applyBodySlideMorphs(
      target,
      base,
      clothedSliders,
      garmentMappings,
      garmentOsd,
      undefined,
      shapeOffsets,
    );

    posAttr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }, [mesh, clothedSliders, garmentOsd, garmentMappings, shapeOffsets]);

  const autoRigUnskinned = useCharacter((s) => s.autoRigUnskinned);

  /* Stable identities: both part components key their texture effect on these,
     and an inline object would reload every map on every parent render. */
  const roleFallback = useMemo(() => fallbackByRole ?? {}, [fallbackByRole]);
  const normalFallback = useMemo(() => fallbackNormalByRole ?? {}, [fallbackNormalByRole]);
  const roughnessFallback = useMemo(() => fallbackRoughnessByRole ?? {}, [fallbackRoughnessByRole]);

  /* Several armour sets (the Gladiator one included) embed a copy of the body
     shape in every piece. Drawing them all would stack three bodies inside
     each other, so the standalone body wins and each piece contributes only
     its garment shapes — the same rule the whole-outfit node already uses. */
  const hasEmbeddedBody = Boolean(mesh?.materials?.some((m) => m.role === 'skin'));
  const hiddenKey = hiddenRoles?.join('|') ?? '';
  const hidden = useMemo(() => {
    const out = [...(hiddenRoles ?? [])];
    if (hideEmbeddedBody && hasEmbeddedBody) out.push('skin');
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenKey, hideEmbeddedBody, hasEmbeddedBody]);

  if (!mesh) return null;

  return mesh.bones?.length || autoRigUnskinned ? (
    <SkinnedPart
      name={part.label || part.slot || 'Garment'}
      mesh={mesh}
      registry={registry}
      rigDonor={rigDonor}
      defaultRole="clothing"
      fallbackByRole={roleFallback}
      fallbackNormalByRole={normalFallback}
      fallbackRoughnessByRole={roughnessFallback}
      skinOverride={skinOverride}
      hiddenRoles={hidden}
      skinColor={skinColor}
      skinDetailMap={skinDetailMap}
      skinDetail={skinDetail}
      renderOrder={renderOrder}
      weight={weight}
    />
  ) : (
    <AuthoredPart
      name={part.label || part.slot || 'Garment'}
      mesh={mesh}
      defaultRole="clothing"
      fallbackByRole={roleFallback}
      fallbackNormalByRole={normalFallback}
      skinColor={skinColor}
      skinDetailMap={skinDetailMap}
      skinDetail={skinDetail}
      hiddenRoles={hidden}
      renderOrder={renderOrder}
    />
  );
}
