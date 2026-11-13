'use client';

import { useMemo } from 'react';
import type { Mo2PartOption } from '@/lib/head/faceTexture';
import type { MaterialRole } from '@/components/scene/useMeshGeometry';
import { useWeightedMeshResource } from '@/components/scene/useMeshGeometry';
import { SkinnedPart } from '@/components/scene/SkinnedPart';
import { AuthoredPart } from '@/components/scene/AuthoredPart';
import type { SkeletonRegistry } from '@/lib/character/skeleton';

export interface EquippedGarmentProps {
  /** One resolved slot entry from `manifest.parts.equipment`. */
  part: Mo2PartOption & { slot?: string };
  registry: SkeletonRegistry;
  /** Body weight, 0–1 — the same value the torso and limbs blend with. */
  weight: number;
  /** Shapes to skip, e.g. the garment's own embedded body when one is drawn. */
  hiddenRoles?: MaterialRole[];
  /** Hide this garment's own embedded `skin` shapes. */
  hideEmbeddedBody?: boolean;
  fallbackByRole?: Partial<Record<MaterialRole, string>>;
  fallbackNormalByRole?: Partial<Record<MaterialRole, string>>;
  skinColor?: string;
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
  weight,
  hiddenRoles,
  hideEmbeddedBody = false,
  fallbackByRole,
  fallbackNormalByRole,
  skinColor,
  renderOrder = 0,
}: EquippedGarmentProps) {
  const resource = useWeightedMeshResource(
    part.weightVariants,
    part.meshUrl,
    `equipment ${part.slot ?? 'garment'}`,
    weight,
  );
  const mesh = resource.mesh;

  /* Stable identities: both part components key their texture effect on these,
     and an inline object would reload every map on every parent render. */
  const roleFallback = useMemo(() => fallbackByRole ?? {}, [fallbackByRole]);
  const normalFallback = useMemo(() => fallbackNormalByRole ?? {}, [fallbackNormalByRole]);

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

  return mesh.bones?.length ? (
    <SkinnedPart
      name={part.label || part.slot || 'Garment'}
      mesh={mesh}
      registry={registry}
      defaultRole="clothing"
      fallbackByRole={roleFallback}
      fallbackNormalByRole={normalFallback}
      hiddenRoles={hidden}
      skinColor={skinColor}
      renderOrder={renderOrder}
    />
  ) : (
    <AuthoredPart
      name={part.label || part.slot || 'Garment'}
      mesh={mesh}
      defaultRole="clothing"
      fallbackByRole={roleFallback}
      fallbackNormalByRole={normalFallback}
      skinColor={skinColor}
      hiddenRoles={hidden}
      renderOrder={renderOrder}
    />
  );
}
