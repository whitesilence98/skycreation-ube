'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { LoadedMesh, MaterialRole, MeshMaterialSpec } from '@/components/scene/useMeshGeometry';
import type { SkeletonRegistry } from '@/lib/character/skeleton';
import {
  applySkinGloss,
  attachSkinCavity,
  skinRoughnessFromGloss,
  updateSkinDetail,
  updateSkinGloss,
} from '@/components/scene/SkinShader';
import { useCharacter } from '@/lib/store';
import {
  autoRigMesh,
  disposeAutoRiggedMesh,
  type AutoRigResult,
} from '@/lib/character/autoRig';

/**
 * Renders one authored pack mesh, skinned to the character's shared skeleton.
 *
 * A pack NIF is several shapes with different shaders, so the worker keeps each
 * shape's draw range and material descriptor instead of flattening them under
 * one atlas. A slot with no authored albedo, or whose atlas fails to load,
 * draws a flat grey unlit material — a deliberate placeholder, never a white
 * "textured" look, so geometry whose DDS are still missing stays inspectable.
 *
 * `hiddenRoles` is the outfit toggle: it hides the garment shapes while the
 * embedded body (role `skin`) keeps rendering, so turning the garment off can
 * never uncover a hole where a second body would otherwise be stacked.
 *
 * The object is built imperatively rather than through JSX mesh elements: a
 * `SkinnedMesh` has to be constructed with its `Skeleton` already resolved
 * against shared bones, and rebuilding that per React render would re-bind the
 * mesh mid-pose and bake the pose in as its rest.
 */
export interface SkinnedPartProps {
  name?: string;
  mesh: LoadedMesh;
  registry: SkeletonRegistry;
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
  /**
   * Force the atlas of every `skin` slot, ahead of any authored texture.
   *
   * The body, hands and feet are one character over one selected body atlas.
   * A prebaked limb can carry its own authored material route, but letting it
   * win would paint two different skins on one body — so the selection the
   * user made governs all three, and this is the one prop that says so.
   */
  skinOverride?: { texture?: string; normalTexture?: string; roughnessTexture?: string };
  hiddenRoles?: MaterialRole[];
  /** Hair dye/gloss/alpha; only applied to `hair` materials. */
  hair?: { tone: string; gloss: number; alpha?: number };
  /** Skin tone color tint `#rrggbb` applied to `skin` materials. */
  skinColor?: string;
  /** Shared pore/relief tile owned by `HeadModel`, applied to `skin` slots. */
  skinDetailMap?: THREE.Texture | null;
  /** Detail strength [0..1]; slider-driven, never reloads the tile. */
  skinDetail?: number;
  /**
   * Body mesh whose skinning is transferred to a shape that cannot skin
   * itself. Only consulted while `autoRigUnskinned` is on; the body's
   * geometry is cloned per derived mesh and never mutated.
   */
  rigDonor?: LoadedMesh | null;
  /** Body weight [0..1] forwarded for bounds updates and reactivity. */
  weight?: number;
}

interface Slot {
  spec: MeshMaterialSpec;
  texture?: string;
  normalTexture?: string;
  roughnessTexture?: string;
}

const GREY = '#8a8a8a';

function slotsFor(part: SkinnedPartProps): Slot[] {
  const {
    mesh, defaultRole = 'hair', fallbackTexture, fallbackByRole, fallbackNormalByRole,
    fallbackRoughnessByRole, skinOverride,
  } = part;
  const specs = mesh.groups?.length && mesh.materials?.length
    ? mesh.materials
    : [{ name: 'default', role: defaultRole } as MeshMaterialSpec];
  return specs.map((spec) => {
    /* A `skin` slot belongs to the one selected body. The override is
       authoritative — it beats the authored route *and* an absent field means
       "no such map", not "borrow the asset's own". Falling back to the baked
       limb's atlas would paint a second skin over the torso's, and mixing a
       textured limb with a greyed body is just as wrong. */
    const override = spec.role === 'skin' ? skinOverride : undefined;
    const texture = override
      ? override.texture
      : spec.texture ??
        fallbackByRole?.[spec.role] ??
        (spec.role === 'hair' || spec.role === defaultRole ? fallbackTexture : undefined);
    const normalTexture = override
      ? override.normalTexture
      : spec.normalTexture ?? fallbackNormalByRole?.[spec.role];
    const roughnessTexture = override
      ? override.roughnessTexture
      : fallbackRoughnessByRole?.[spec.role];
    /* The outfit's embedded body is part of the supplied asset; a missing
       garment atlas must hide only the garment, never the body it covers. */
    return { spec, texture, normalTexture, roughnessTexture };
  });
}

/**
 * The three.js object for one part: a `SkinnedMesh` when the producer decoded
 * skinning data, a plain `Mesh` otherwise.
 *
 * Bind inverses come from the bones' rest pose inside the registry, so binding
 * does not depend on which pose is currently applied. A mesh bound while posed
 * would bake that pose into its rest and never return to it.
 */
function buildPart(
  mesh: LoadedMesh,
  registry: SkeletonRegistry,
  renderOrder: number,
  name?: string,
  defaultRole?: string,
): THREE.Mesh {
  const skinned = Boolean(mesh.bones?.length && mesh.geometry.getAttribute('skinWeight'));
  const partName = name || mesh.materials?.[0]?.name || defaultRole || 'SkinnedPart';
  /* `castShadow` on the object, but the shadow pass skips any group whose
     material is `visible: false` (WebGLShadowMap) and alpha-tests through
     `material.map` (getDepthMaterial copies `map` + `alphaTest`), so a hair
     card still casts its strand silhouette and not the whole quad, while a
     slot that has not loaded yet casts nothing. `receiveShadow` lets the
     head's shadow fall on the chest and the hair's onto the face. */
  if (!skinned || !mesh.bones) {
    const plain = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ visible: false }));
    plain.name = partName;
    plain.renderOrder = renderOrder;
    plain.frustumCulled = false;
    plain.castShadow = true;
    plain.receiveShadow = true;
    return plain;
  }
  const registered = registry.register(mesh.bones);
  const object = new THREE.SkinnedMesh(
    mesh.geometry,
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  object.name = partName;
  object.renderOrder = renderOrder;
  object.frustumCulled = false;
  object.castShadow = true;
  object.receiveShadow = true;
  /* Positions are local to the character group and already in the render
     frame, so the bind matrix is the identity: the registered inverses carry
     the transform instead. `bind()` would re-derive them from the current
     pose, baking whatever pose is active into the mesh's rest.

     Keep three's default attached bind mode. It re-derives
     `bindMatrixInverse` from the mesh's world matrix each frame, which is
     exactly what makes the shader's `bindMatrixInverse · boneMatrix` a pure
     character-space deformation; a detached identity inverse would compose the
     mesh's own world transform into the result. */
  object.bind(registered.skeleton, new THREE.Matrix4());
  object.updateMatrixWorld(true);
  return object;
}

export function SkinnedPart({
  name,
  mesh,
  registry,
  renderOrder = 0,
  defaultRole = 'hair',
  fallbackTexture,
  fallbackByRole,
  fallbackNormalByRole,
  fallbackRoughnessByRole,
  skinOverride,
  hiddenRoles = [],
  hair,
  skinColor,
  skinDetailMap,
  skinDetail,
  rigDonor,
  weight,
}: SkinnedPartProps) {
  /* Opt-in auto-rig for a shape that cannot skin itself. The helper returns a
     geometry clone plus a bone table; the loader's cached mesh is untouched,
     and the clone is disposed by the effect below when this input changes or
     the component unmounts. `null` means "draw the authored mesh as-is". */
  const autoRigEnabled = useCharacter((s) => s.autoRigUnskinned);
  const registeredBoneCount = registry.byName.size;
  const derived = useMemo<AutoRigResult | null>(() => {
    if (!autoRigEnabled) return null;
    const donor = rigDonor && rigDonor !== mesh ? rigDonor : null;
    return autoRigMesh(mesh, { donor, registry, defaultRole });
  }, [autoRigEnabled, mesh, rigDonor, registry, registeredBoneCount, defaultRole]);
  useEffect(() => () => disposeAutoRiggedMesh(derived), [derived]);

  /* A weight-variant garment is blended *in place* on the loader's geometry
     (`useWeightedMeshResource`), so the mesh identity never changes while the
     slider moves. The derived clone owns its own buffers, so mirror the
     source's current rest vertices into it — otherwise the rigged shape would
     freeze at the body weight it was first derived at. Skin indices stay
     valid: a `_0`/`_1` pair shares topology and bone set. */
  const syncedVersion = useRef(-1);
  useEffect(() => {
    if (!derived) {
      syncedVersion.current = -1;
      return;
    }
    const source = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const target = derived.mesh.geometry.getAttribute('position');
    if (!source || !target || source.array.length !== target.array.length) return;
    /* `version` is bumped by `applyWeightedPositions` whenever it blends; it is
       only typed on the concrete `BufferAttribute`, which is what the loader
       always creates. */
    if (syncedVersion.current === source.version) return;
    syncedVersion.current = source.version;
    (target.array as Float32Array).set(source.array as ArrayLike<number>);
    target.needsUpdate = true;
    const sourceNormal = mesh.geometry.getAttribute('normal');
    const targetNormal = derived.mesh.geometry.getAttribute('normal');
    if (sourceNormal && targetNormal && sourceNormal.array.length === targetNormal.array.length) {
      (targetNormal.array as Float32Array).set(sourceNormal.array as ArrayLike<number>);
      targetNormal.needsUpdate = true;
    }
    derived.mesh.geometry.computeBoundingSphere();
    derived.mesh.geometry.computeBoundingBox();
  });

  /* Everything downstream reads the effective mesh so materials, draw ranges
     and the bound object all describe the same geometry. The derived mesh
     keeps `groups`/`materials` by reference and owns only its geometry, so
     neither set of descriptors is ever mutated. */
  const effectiveMesh = derived?.mesh ?? mesh;

  /* Keep geometry bounding volumes accurate when body weight changes */
  useEffect(() => {
    if (weight === undefined) return;
    effectiveMesh.geometry.computeBoundingSphere();
    effectiveMesh.geometry.computeBoundingBox();
  }, [weight, effectiveMesh]);

  const slots = useMemo(
    () => slotsFor({
      mesh, registry, defaultRole, fallbackTexture, fallbackByRole, fallbackNormalByRole,
      fallbackRoughnessByRole, skinOverride,
    }),
    [mesh, registry, defaultRole, fallbackTexture, fallbackByRole, fallbackNormalByRole,
      fallbackRoughnessByRole, skinOverride],
  );

  const hiddenKey = hiddenRoles.join('|');
  const hidden = useMemo(() => new Set(hiddenRoles), [hiddenKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* A `skin` slot is part of the same character as the head, so it takes the
     head's ENB-calibrated SSS and specular patch and the same gloss-derived
     roughness. Without this the torso kept a plain MeshStandardMaterial while
     the face under it had subsurface scattering, and the two met at the neck in
     a hard line: warm glowing face, flat matte chest. */
  const skinGloss = useCharacter((s) => s.skinGloss);
  const skinSss = useCharacter((s) => s.skinSss);
  const skinSheen = useCharacter((s) => s.skinSheen);

  /* Two parallel material sets: the textured standard material each slot uses
     once its atlas lands, and the grey stand-in the same geometry draws with
     while it has none. Group/material indices stay aligned with `slots`. */
  const { standardMaterials, greyMaterials } = useMemo(() => {
    const standard = slots.map(({ spec }) => {
      const skin = spec.role === 'skin';
      const isHair = spec.role === 'hair';
      const hairAlpha = isHair && hair?.alpha !== undefined ? hair.alpha : 1.0;
      const Material = skin ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
      const material = new Material({
        color: skin && skinColor ? skinColor : (isHair && hair ? hair.tone : '#ffffff'),
        roughness: skin
          ? skinRoughnessFromGloss(skinGloss)
          : isHair && hair ? Math.max(0.12, 0.62 - hair.gloss * 0.46) : 0.55,
        metalness: isHair ? 0.05 : 0.0,
        opacity: isHair ? hairAlpha : 1.0,
        transparent: isHair,
        /* The producer decodes the shader's authored cutout/2-sided flags;
           only fall back to the role defaults when it did not. */
        alphaTest: spec.alphaTest ?? (isHair ? (hairAlpha < 0.95 ? 0.08 : 0.35) : 0),
        alphaToCoverage: isHair && hairAlpha >= 0.99,
        depthWrite: isHair ? (hairAlpha > 0.85) : true,
        side: (spec.doubleSided ?? spec.role === 'hair') ? THREE.DoubleSide : THREE.FrontSide,
        visible: true,
      });
      material.name = spec.name;
      if (skin) applySkinGloss(material, skinGloss, skinSss, skinSheen);
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

  /* The same live update `HeadModel` applies to the face and neck. It has to be
     its own effect rather than a dependency of the memo above: rebuilding the
     material set would re-run the texture loads and flash the body grey. */
  useEffect(() => {
    slots.forEach((slot, i) => {
      if (slot.spec.role !== 'skin') return;
      const material = standardMaterials[i];
      if (material) updateSkinGloss(material, skinGloss, skinSss, skinSheen);
    });
  }, [slots, standardMaterials, skinGloss, skinSss, skinSheen]);

  /* The shared pore tile from the head; a limb skin is the same character, so
     it takes the same map (attenuated, since the tile is a cheek crop). The
     tile is owned and disposed by `HeadModel`; this only points at it. */
  useEffect(() => {
    slots.forEach((slot, i) => {
      if (slot.spec.role !== 'skin') return;
      const material = standardMaterials[i];
      if (material) updateSkinDetail(material, skinDetailMap ?? null, (skinDetail ?? 0.45) * 0.5, 32);
    });
  }, [slots, standardMaterials, skinDetailMap, skinDetail]);

  /* Live skinColor tint for skin slots (head/neck/body sync), without reloading textures. */
  useEffect(() => {
    if (!skinColor) return;
    slots.forEach((slot, i) => {
      if (slot.spec.role !== 'skin') return;
      const material = standardMaterials[i];
      if (material) {
        material.color.set(skinColor);
        material.needsUpdate = true;
      }
    });
  }, [slots, standardMaterials, skinColor]);

  /* Live hair tone/gloss/alpha updates for hair slots, without reloading textures. */
  useEffect(() => {
    if (!hair) return;
    slots.forEach((slot, i) => {
      if (slot.spec.role !== 'hair') return;
      const material = standardMaterials[i];
      if (material) {
        material.color.set(hair.tone);
        material.roughness = Math.max(0.12, 0.62 - hair.gloss * 0.46);
        const alpha = hair.alpha !== undefined ? hair.alpha : 1.0;
        material.opacity = alpha;
        material.depthWrite = alpha > 0.85;
        material.alphaTest = alpha < 0.95 ? 0.08 : (slot.spec.alphaTest ?? 0.35);
        material.alphaToCoverage = alpha >= 0.99;
        material.needsUpdate = true;
      }
    });
  }, [slots, standardMaterials, hair?.tone, hair?.gloss, hair?.alpha]);

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

      /* The `_n.dds` alpha as a gloss mask. `colorSpace` stays linear: this is
         a multiplier, and three reads its green channel. The material's own
         scalar roughness remains the overall level the GLOSS slider drives. */
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

      if (slot.spec.role === 'skin' && skinColor) {
        material.color.set(skinColor);
      }
      if (slot.spec.role === 'hair' && hair) {
        material.color.set(hair.tone);
        material.roughness = Math.max(0.12, 0.62 - hair.gloss * 0.46);
        const alpha = hair.alpha !== undefined ? hair.alpha : 1.0;
        material.opacity = alpha;
        material.depthWrite = alpha > 0.85;
        material.alphaTest = alpha < 0.95 ? 0.08 : (slot.spec.alphaTest ?? 0.35);
        material.alphaToCoverage = alpha >= 0.99;
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
  }, [standardMaterials, slots, hiddenKey, hair?.tone, hair?.gloss, hair?.alpha]);

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

  /* One-ring cavity for the skin shader. Attached to the whole geometry even
     when only some slots are skin; non-skin materials never sample it. */
  useEffect(() => {
    attachSkinCavity(effectiveMesh.geometry);
  }, [effectiveMesh.geometry]);

  const object = useMemo(
    () => buildPart(effectiveMesh, registry, renderOrder, name, defaultRole),
    // The registry is stable for the scene's lifetime. Materials are swapped
    // in below rather than passed here: rebuilding the object on every texture
    // load would re-register the bones and re-bind mid-pose. `effectiveMesh`
    // is a dependency because toggling auto-rig swaps the rendered geometry
    // (and may change a plain Mesh into a SkinnedMesh); the loader's own mesh
    // object is never rebound in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveMesh, renderOrder, name, defaultRole],
  );

  useEffect(() => {
    const isSingle = renderMaterials.length === 1 && (!effectiveMesh.groups?.length || !effectiveMesh.materials?.length);
    object.material = isSingle ? renderMaterials[0] : renderMaterials;
    object.renderOrder = renderOrder;
    /* A grey stand-in has no `map` for the shadow pass to alpha-test, so an
       unloaded hair card would cast a solid quad. Cast only when every slot
       that will draw is a real textured material. */
    object.castShadow = slots.every(
      (slot, i) => hidden.has(slot.spec.role) || !slot.texture || loaded.has(i),
    );
    object.receiveShadow = true;
  }, [object, renderMaterials, renderOrder, slots, hidden, loaded]);

  /* The throwaway material `buildPart` needs before the real slots exist. */
  useEffect(() => {
    const initial = object.material;
    return () => {
      if (!Array.isArray(initial)) initial.dispose();
    };
  }, [object]);

  return <primitive object={object} />;
}
