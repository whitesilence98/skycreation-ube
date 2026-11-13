'use client';

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { LoadedMesh, MaterialRole, MeshMaterialSpec } from '@/components/scene/useMeshGeometry';
import {
  applySkinGloss,
  skinRoughnessFromGloss,
  updateSkinGloss,
} from '@/components/scene/SkinShader';
import { useCharacter } from '@/lib/store';

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
  name?: string;
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
  /** Per-role roughness map, e.g. the body's `_n.dds` alpha as a gloss mask. */
  fallbackRoughnessByRole?: Partial<Record<MaterialRole, string>>;
  hiddenRoles?: MaterialRole[];
  /** Hair dye/gloss; only applied to `hair` materials. */
  hair?: { tone: string; gloss: number };
  /** Skin tone color tint `#rrggbb` applied to `skin` materials. */
  skinColor?: string;
}

interface Slot {
  spec: MeshMaterialSpec;
  texture?: string;
  normalTexture?: string;
  roughnessTexture?: string;
}

const GREY = '#8a8a8a';

function slotsFor(part: AuthoredPartProps): Slot[] {
  const {
    mesh, defaultRole = 'hair', fallbackTexture, fallbackByRole, fallbackNormalByRole,
    fallbackRoughnessByRole,
  } = part;
  const specs = mesh.groups?.length && mesh.materials?.length
    ? mesh.materials
    : [{ name: 'default', role: defaultRole } as MeshMaterialSpec];
  return specs.map((spec) => {
    const texture =
      spec.texture ??
      fallbackByRole?.[spec.role] ??
      (spec.role === 'hair' || spec.role === defaultRole ? fallbackTexture : undefined);
    const normalTexture = spec.normalTexture ?? fallbackNormalByRole?.[spec.role];
    const roughnessTexture = fallbackRoughnessByRole?.[spec.role];
    /* The outfit's embedded body is part of the supplied asset; a missing
       garment atlas must hide only the garment, never the body it covers. */
    return { spec, texture, normalTexture, roughnessTexture };
  });
}

export function AuthoredPart({
  name,
  mesh,
  renderOrder = 0,
  defaultRole = 'hair',
  fallbackTexture,
  fallbackByRole,
  fallbackNormalByRole,
  fallbackRoughnessByRole,
  hiddenRoles = [],
  hair,
  skinColor,
}: AuthoredPartProps) {
  const slots = useMemo(
    () => slotsFor({
      mesh, defaultRole, fallbackTexture, fallbackByRole, fallbackNormalByRole,
      fallbackRoughnessByRole,
    }),
    [mesh, defaultRole, fallbackTexture, fallbackByRole, fallbackNormalByRole,
      fallbackRoughnessByRole],
  );

  const hiddenKey = hiddenRoles.join('|');
  const hidden = useMemo(() => new Set(hiddenRoles), [hiddenKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The outfit's embedded body can reach this component too — an unskinned
     mesh carrying a `skin` slot. It is the same character as the face above it,
     so it takes the same SSS/specular patch and gloss-derived roughness. */
  const skinGloss = useCharacter((s) => s.skinGloss);
  const skinSss = useCharacter((s) => s.skinSss);

  /* Two parallel material sets: the textured standard material each slot uses
     once its atlas lands, and the grey stand-in the same geometry draws with
     while it has none. Group/material indices stay aligned with `slots`. */
  const { standardMaterials, greyMaterials } = useMemo(() => {
    const standard = slots.map(({ spec }) => {
      const skin = spec.role === 'skin';
      const isHair = spec.role === 'hair';
      const material = new THREE.MeshStandardMaterial({
        color: skin && skinColor ? skinColor : (isHair && hair ? hair.tone : '#ffffff'),
        roughness: skin
          ? skinRoughnessFromGloss(skinGloss)
          : isHair && hair ? Math.max(0.12, 0.62 - hair.gloss * 0.46) : 0.55,
        metalness: isHair ? 0.05 : 0.0,
        transparent: isHair,
        /* The producer decodes the shader's authored cutout/2-sided flags;
           only fall back to the role defaults when it did not. */
        alphaTest: spec.alphaTest ?? (isHair ? 0.35 : 0),
        alphaToCoverage: isHair,
        depthWrite: true,
        side: (spec.doubleSided ?? isHair) ? THREE.DoubleSide : THREE.FrontSide,
        visible: true,
      });
      material.name = spec.name;
      if (skin) applySkinGloss(material, skinGloss, skinSss);
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
    // Materials are rebuilt only when the mesh's authored slots change; the
    // gloss is pushed live by the effect below instead of rebuilding them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh]);

  /* Live GLOSS/SSS for the embedded body, matching `SkinnedPart` and the head. */
  useEffect(() => {
    slots.forEach((slot, i) => {
      const material = standardMaterials[i];
      if (material && slot.spec.role === 'skin') {
        updateSkinGloss(material, skinGloss, skinSss);
        if (skinColor) {
          material.color.set(skinColor);
          material.needsUpdate = true;
        }
      }
    });
  }, [slots, standardMaterials, skinGloss, skinSss, skinColor]);

  useEffect(() => {
    if (!hair) return;
    slots.forEach((slot, i) => {
      if (slot.spec.role !== 'hair') return;
      const material = standardMaterials[i];
      if (material) {
        material.color.set(hair.tone);
        material.roughness = Math.max(0.12, 0.62 - hair.gloss * 0.46);
        material.needsUpdate = true;
      }
    });
  }, [slots, standardMaterials, hair?.tone, hair?.gloss]);

  /** Slots whose atlas has actually loaded or failed this mount. */
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set());
  const [failed, setFailed] = useState<ReadonlySet<number>>(() => new Set());
  useEffect(() => {
    setLoaded(new Set());
    setFailed(new Set());
  }, [standardMaterials]);

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    let cancelled = false;

    /** Release whatever this run attached to a slot. */
    const clearSlot = (i: number) => {
      const material = standardMaterials[i];
      if (!material) return;
      for (const slotName of ['map', 'normalMap', 'roughnessMap'] as const) {
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
    setFailed(new Set());
    slots.forEach((slot, i) => {
      const material = standardMaterials[i];
      if (!material) return;

      if (hidden.has(slot.spec.role)) {
        material.visible = false;
        return;
      }
      if (!slot.texture) {
        material.visible = false;
        return;
      }
      material.visible = true;

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
          if (!cancelled) {
            clearSlot(i);
            setFailed((prev) => {
              if (prev.has(i)) return prev;
              const next = new Set(prev);
              next.add(i);
              return next;
            });
          }
        },
      );
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = true;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
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
        normal.anisotropy = 8;
        material.normalMap = normal;
      }

      /* Skyrim's `_n.dds` alpha as a gloss mask: a linear multiplier, so no
         colour space. Only the skin role receives one. */
      if (slot.roughnessTexture) {
        const rough = loader.load(slot.roughnessTexture, undefined, undefined, () => {
          if (cancelled || material.roughnessMap !== rough) return;
          material.roughnessMap = null;
          rough.dispose();
          material.needsUpdate = true;
        });
        rough.flipY = true;
        rough.wrapS = THREE.RepeatWrapping;
        rough.wrapT = THREE.RepeatWrapping;
        rough.anisotropy = 8;
        material.roughnessMap = rough;
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
     get grey). Everything else draws: the standard material if authored and not failed,
     the flat grey stand-in when the pack supplied no atlas or failed to load. */
  const renderMaterials = useMemo(
    () => slots.map((slot, i) => {
      if (hidden.has(slot.spec.role)) return standardMaterials[i];
      if (!slot.texture || failed.has(i)) return greyMaterials[i];
      return standardMaterials[i];
    }),
    [slots, hidden, standardMaterials, greyMaterials, failed],
  );

  /* A grey stand-in has no `map` for the shadow pass to alpha-test, so a hair
     card would cast a solid quad across the face. Cast only once every slot
     that will draw is a real textured material; `hidden` slots draw nothing
     and are exempt. */
  const canCast = useMemo(
    () => slots.every((slot, i) => hidden.has(slot.spec.role) || !slot.texture || loaded.has(i)),
    [slots, hidden, loaded],
  );

  const partName = name || mesh.materials?.[0]?.name || defaultRole || 'AuthoredPart';

  if (!mesh.groups?.length || !mesh.materials?.length) {
    return (
      <mesh
        name={partName}
        geometry={mesh.geometry}
        material={renderMaterials[0]}
        renderOrder={renderOrder}
        castShadow={canCast}
        receiveShadow
      />
    );
  }
  return (
    <mesh
      name={partName}
      geometry={mesh.geometry}
      material={renderMaterials}
      renderOrder={renderOrder}
      castShadow={canCast}
      receiveShadow
    />
  );
}
