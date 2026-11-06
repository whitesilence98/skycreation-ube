'use client';

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { LoadedMesh, MaterialRole, MeshMaterialSpec } from '@/components/scene/useMeshGeometry';

/**
 * Renders one authored hair/outfit mesh with its per-shape materials.
 *
 * A NIF hairstyle or outfit is several shapes with different shaders; the
 * worker keeps each shape's draw range and material descriptor instead of
 * flattening them under one atlas.
 *
 * A slot with no authored albedo, or whose atlas fails to load, draws a flat
 * grey unlit material. That is a placeholder, never a white "textured" look,
 * and it means pack geometry whose DDS are still missing stays inspectable.
 *
 * `hiddenRoles` is the outfit toggle: it hides the garment shapes while the
 * embedded body (role `skin`) keeps rendering, so turning the garment off can
 * never uncover a hole where a second body would otherwise be stacked.
 */
export interface AuthoredPartProps {
  mesh: LoadedMesh;
  renderOrder?: number;
  /** Role used for a legacy single-material mesh with no authored groups. */
  defaultRole?: MaterialRole;
  /** Atlas used when an authored material names no albedo of its own. */
  fallbackTexture?: string;
  /** Per-role atlas fallback, e.g. the manifest body skin for the outfit's
   *  embedded body when the shape carries no shader texture. */
  fallbackByRole?: Partial<Record<MaterialRole, string>>;
  fallbackNormalByRole?: Partial<Record<MaterialRole, string>>;
  hiddenRoles?: MaterialRole[];
  /** Hair dye/gloss; only applied to `hair` materials. */
  hair?: { tone: string; gloss: number };
}

interface Slot {
  spec: MeshMaterialSpec;
  texture?: string;
  normalTexture?: string;
}

const GREY = '#8a8a8a';

function slotsFor(part: AuthoredPartProps): Slot[] {
  const { mesh, defaultRole = 'hair', fallbackTexture, fallbackByRole, fallbackNormalByRole } = part;
  const specs = mesh.groups?.length && mesh.materials?.length
    ? mesh.materials
    : [{ name: 'default', role: defaultRole } as MeshMaterialSpec];
  return specs.map((spec) => {
    const texture =
      spec.texture ??
      fallbackByRole?.[spec.role] ??
      (spec.role === defaultRole ? fallbackTexture : undefined);
    const normalTexture = spec.normalTexture ?? fallbackNormalByRole?.[spec.role];
    /* The outfit's embedded body is part of the supplied asset; a missing
       garment atlas must hide only the garment, never the body it covers. */
    return { spec, texture, normalTexture };
  });
}

export function AuthoredPart({
  mesh,
  renderOrder = 0,
  defaultRole = 'hair',
  fallbackTexture,
  fallbackByRole,
  fallbackNormalByRole,
  hiddenRoles = [],
  hair,
}: AuthoredPartProps) {
  const slots = useMemo(
    () => slotsFor({ mesh, defaultRole, fallbackTexture, fallbackByRole, fallbackNormalByRole }),
    [mesh, defaultRole, fallbackTexture, fallbackByRole, fallbackNormalByRole],
  );

  const hiddenKey = hiddenRoles.join('|');
  const hidden = useMemo(() => new Set(hiddenRoles), [hiddenKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Two parallel material sets: the textured standard material each slot uses
     once its atlas lands, and the grey stand-in the same geometry draws with
     while it has none. Group/material indices stay aligned with `slots`. */
  const { standardMaterials, greyMaterials } = useMemo(() => {
    const standard = slots.map(({ spec }) => {
      const material = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: spec.role === 'hair' ? 0.62 : 0.55,
        metalness: 0.0,
        transparent: false,
        /* The producer decodes the shader's authored cutout/2-sided flags;
           only fall back to the role defaults when it did not. */
        alphaTest: spec.alphaTest ?? (spec.role === 'hair' ? 0.35 : 0),
        depthWrite: true,
        side: (spec.doubleSided ?? spec.role === 'hair') ? THREE.DoubleSide : THREE.FrontSide,
        visible: false,
      });
      material.name = spec.name;
      return material;
    });
    const grey = slots.map(({ spec }) => new THREE.MeshBasicMaterial({
      color: GREY,
      side: (spec.doubleSided ?? spec.role === 'hair') ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: true,
      /* Hair is card geometry: without its alpha atlas every card is a solid
         quad, and a stack of them is an opaque slab over the face. Translucent
         grey keeps the silhouette readable while the head stays visible; a
         garment shape has real surface area, so it stays opaque. */
      ...(spec.role === 'hair'
        ? { transparent: true, opacity: 0.55, depthWrite: false }
        : {}),
    }));
    return { standardMaterials: standard, greyMaterials: grey };
    // Materials are rebuilt only when the mesh's authored slots change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh]);

  /** Slots whose atlas has actually loaded this mount; everything else greys. */
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set());
  useEffect(() => {
    setLoaded(new Set());
  }, [standardMaterials]);

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    let cancelled = false;

    /** Release whatever this run attached to a slot. */
    const clearSlot = (i: number) => {
      const material = standardMaterials[i];
      if (!material) return;
      for (const slotName of ['map', 'normalMap'] as const) {
        const tex = material[slotName];
        if (tex) {
          tex.dispose();
          material[slotName] = null;
        }
      }
      material.visible = false;
      material.needsUpdate = true;
    };

    setLoaded(new Set());
    slots.forEach((slot, i) => {
      const material = standardMaterials[i];
      if (!material) return;

      material.visible = false;
      if (hidden.has(slot.spec.role)) return;
      if (!slot.texture) return;

      const tex = loader.load(
        slot.texture,
        () => {
          if (cancelled || material.map !== tex) return;
          material.visible = true;
          material.needsUpdate = true;
          setLoaded((prev) => {
            if (prev.has(i)) return prev;
            const next = new Set(prev);
            next.add(i);
            return next;
          });
        },
        undefined,
        // The producer promised this URL; a failure means the pack is
        // incomplete. That slot greys rather than painting white.
        () => {
          if (!cancelled) clearSlot(i);
        },
      );
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = true;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      material.map = tex;

      if (slot.normalTexture) {
        const normal = loader.load(slot.normalTexture, undefined, undefined, () => {
          if (cancelled || material.normalMap !== normal) return;
          material.normalMap = null;
          normal.dispose();
          material.needsUpdate = true;
        });
        normal.flipY = true;
        normal.wrapS = THREE.RepeatWrapping;
        normal.wrapT = THREE.RepeatWrapping;
        material.normalMap = normal;
      }

      if (slot.spec.role === 'hair' && hair) {
        material.color.set(hair.tone);
        material.roughness = Math.max(0.12, 0.62 - hair.gloss * 0.46);
      }
      material.needsUpdate = true;
    });

    return () => {
      /* Invalidate late loader callbacks before releasing their textures, so a
         slow map cannot re-show a material whose slot has already been torn
         down and whose texture the renderer would no longer own. */
      cancelled = true;
      for (let i = 0; i < slots.length; i++) clearSlot(i);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standardMaterials, slots, hiddenKey, hair?.tone, hair?.gloss]);

  useEffect(
    () => () => {
      for (const material of standardMaterials) material.dispose();
      for (const material of greyMaterials) material.dispose();
    },
    [standardMaterials, greyMaterials],
  );

  /* Hidden roles vanish (their standard material is invisible and they never
     get grey). Everything else draws: the standard material once its atlas is
     on the GPU, the flat grey stand-in until then or for good when the pack
     supplied no atlas. */
  const renderMaterials = useMemo(
    () => slots.map((slot, i) =>
      hidden.has(slot.spec.role)
        ? standardMaterials[i]
        : loaded.has(i) ? standardMaterials[i] : greyMaterials[i]),
    [slots, hidden, loaded, standardMaterials, greyMaterials],
  );

  if (!mesh.groups?.length || !mesh.materials?.length) {
    return <mesh geometry={mesh.geometry} material={renderMaterials[0]} renderOrder={renderOrder} />;
  }
  return <mesh geometry={mesh.geometry} material={renderMaterials} renderOrder={renderOrder} />;
}
