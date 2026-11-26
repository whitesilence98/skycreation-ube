'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  buildHeadGeometry,
  buildNeckGeometry,
  buildTorsoGeometry,
  applyNeckDelta,
  type HeadBuild,
} from '@/lib/head/geometry';
import { detectHeadBaseWeight } from '@/lib/head/neckDeltas';
import { createBrowMesh, prepareBrowTexture } from '@/lib/head/brows';
import { createRig, poseRegionBone, applyCreationEngineWeight, verifyRigWiring, type Rig } from '@/lib/head/rig';
import {
  buildDetailTexture,
  buildFaceTexture,
  buildProjectedNormal,
  buildSkinDetailNormal,
  type FaceTextureResult,
  type Mo2Manifest,
} from '@/lib/head/faceTexture';
import { convertUrl } from '@/lib/mo2/client';
import { loadMask, compositeHeadAtlas, type OverlayInput } from '@/lib/head/overlayLayers';
import { SLIDER_DEFS, REGIONS_BY_ID, type RegionId } from '@/lib/regions';
import { anatomySliderBank } from '@/lib/anatomy/bind';
import { bodyScaleFactors } from '@/lib/anatomy/bodyScale';
import { useCharacter } from '@/lib/store';
import { MeshOverlay } from '@/components/scene/MeshOverlay';
import { FaceGizmo } from '@/components/scene/FaceGizmo';
import { AuthoredPart } from '@/components/scene/AuthoredPart';
import { SkinnedPart } from '@/components/scene/SkinnedPart';
import { EquippedGarment } from '@/components/scene/EquippedGarment';
import { EquippedHairPart } from '@/components/scene/EquippedHairPart';
import { GlbHairPart } from '@/components/scene/GlbHairPart';
import { HairlineUnderlay } from '@/components/scene/HairlineUnderlay';
import { SkeletonRegistry, applySkeletonWeight } from '@/lib/character/skeleton';
import { useBodySlideStore } from '@/lib/bodyslide/store';
import {
  loadAllBodySlideData,
  applyBodySlideMorphs,
  computeMeshShapeOffsets,
  loadGarmentOsd,
  resolveGarmentOsdUrl,
  loadGarmentMappings,
  loadHandOsd,
  loadFeetOsd,
  type BodySlideDataBundle,
} from '@/lib/bodyslide/morphLoader';
import type { OsdData, SliderOspMapping } from '@/lib/bodyslide/osdParser';
import { useFaceMorphStore } from '@/lib/morphs/faceMorphStore';
import {
  loadFaceTriBundle,
  applyPartFaceMorphs,
  type FaceTriBundle,
} from '@/lib/morphs/faceMorphLoader';
import {
  attachBlinkMorphTargets,
  getCachedUbeEyeBlinkData,
  hasUbeEyeBlinkSettled,
  loadUbeEyeBlinkData,
  type UbeEyeBlinkBundle,
} from '@/lib/morphs/eyeBlinkMorphs';
import {
  attachExpressionMorphTargets,
  getCachedUbeExpressionData,
  hasUbeExpressionSettled,
  loadUbeExpressionData,
  type UbeExpressionBundle,
} from '@/lib/morphs/facialExpressionMorphs';
import { BodyPhysics } from '@/components/scene/BodyPhysics';
import { SecondaryPhysics } from '@/components/scene/SecondaryPhysics';
import { AnimationDirector } from '@/components/scene/AnimationDirector';
import { applyBodyPose, bodyPose, applyPoseTrack, fetchPoseTrack, BODY_POSES } from '@/lib/character/poses';
import { buildPoseClip, setAuthoredPose } from '@/lib/character/animation';
import {
  useMaterialTexture,
  useMeshGeometry,
  useMeshResource,
  useWeightedMeshResource,
  type MaterialRole,
  type TextureState,
} from '@/components/scene/useMeshGeometry';
import {
  applySkinGloss,
  attachSkinCavity,
  skinRoughnessFromGloss,
  updateSkinDetail,
  updateSkinGloss,
} from '@/components/scene/SkinShader';

export interface SceneHandles {
  rig: Rig;
  headBuild: HeadBuild;
}

interface HeadModelProps {
  manifest: Mo2Manifest | null;
  onReady: (handles: SceneHandles) => void;
  onDirty: () => void;
  /** Fires when the character is safe to show: mesh resolved and albedo on. */
  onAssetsReady?: (ready: boolean) => void;
  /** Pack mode: why the pack cannot draw the head, or null once it can. */
  onIssue?: (issue: string | null) => void;
}

export function HeadModel({ manifest, onReady, onDirty, onAssetsReady, onIssue }: HeadModelProps) {
  /* Every part below is URL-driven: the mesh and the texture are read from
     `parts.*` independently, so a texture override never requires re-picking
     the mesh and vice versa. The loader clears the previous resource the
     moment its URL stops being selected — a part can never paint a stale mesh
     with a mismatched atlas. */
  const parts = manifest?.parts;
  /* Pack layout: every asset is the generated pack namespace. Legacy
     `/assets/mo2` URLs and the procedural fallbacks below are removed in this
     mode, so a missing part settles as unavailable instead of silently
     rendering an old mesh. */
  const packMode = manifest?.sourceLayout === 'pack';

  const weight = useCharacter((s) => s.weight);
  /* `linkFaceToWeight` is not read in the render body any more: the facial
     pose pass below reads it from `getState()` when it runs. A render-level
     subscription would re-render the whole character tree for a value only
     that pass consumes. */

  const headMeshUrl = manifest?.headMesh?.meshUrl;
  /* A head imported through Smart Customization was authored elsewhere: it has
     neither the 11,498-vertex UBE topology the neck seam deltas are indexed
     against, nor the UBE rig the overlay/gizmo draw on. Both are switched off
     for it rather than writing collar deltas onto arbitrary vertices. */
  const importedHead = (manifest?.headMesh as { origin?: string })?.origin === 'mesh-import';
  const headWeightVariants = (manifest?.headMesh as { weightVariants?: { w0: string; w1: string } })?.weightVariants;
  const headResource = useWeightedMeshResource(
    headWeightVariants,
    headMeshUrl,
    'head mesh',
    weight,
  );
  const realMesh = headResource.mesh;

  const fallbackHeadBuild = useMemo(() => buildHeadGeometry(), []);
  const headBuild = useMemo<HeadBuild>(() => {
    if (realMesh) {
      const basePositions = new Float32Array(realMesh.positions);
      const baseWeight = detectHeadBaseWeight(basePositions);

      const normAttr = realMesh.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
      const baseNormals = normAttr ? new Float32Array(normAttr.array) : undefined;

      const posAttr = realMesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (posAttr) {
        if (posAttr.array === realMesh.positions) {
          posAttr.array = new Float32Array(basePositions);
        } else {
          posAttr.array.set(basePositions);
          posAttr.needsUpdate = true;
        }
      }
      if (normAttr && baseNormals) {
        if (normAttr.array === baseNormals) {
          normAttr.array = new Float32Array(baseNormals);
        } else {
          normAttr.array.set(baseNormals);
          normAttr.needsUpdate = true;
        }
      }

      return {
        geometry: realMesh.geometry,
        basePositions,
        baseNormals,
        baseWeight,
        ringCount: 64,
        segmentCount: 64,
      };
    }
    // The procedural sculpt is a legacy offline stand-in; pack mode must not
    // pretend a head exists when the pack did not supply one.
    return fallbackHeadBuild;
  }, [realMesh, fallbackHeadBuild]);



  // ── real eye and eyelash meshes from MO2 ──────────────────────────
  const eyeMeshUrl =
    manifest?.eye?.meshUrl ??
    (manifest?.assets?.eyeMesh?.[0] as { meshUrl?: string })?.meshUrl ??
    '/assets/preset-pack/meshes/eyeMesh-3ae8c50ea0f8caad.json';
  const lashesMeshUrl =
    parts?.lashes?.meshUrl ??
    manifest?.eye?.lashesMeshUrl ??
    (manifest?.assets?.lashesMesh?.[0] as { meshUrl?: string })?.meshUrl ??
    (packMode ? '/assets/preset-pack/meshes/lashesMesh-1cb18e62265020cc.json' : '/assets/mo2/eyes/ube-lashes.json');
  const eyeGeo = useMeshGeometry(eyeMeshUrl, 'eye')?.geometry ?? null;
  const companionEyeUrl = manifest?.headMesh?.eyeMeshUrl;
  const companionEyeGeo = useMeshGeometry(
    companionEyeUrl && companionEyeUrl !== eyeMeshUrl ? companionEyeUrl : undefined,
    'companion eye socket ref',
  )?.geometry ?? null;

  // Automatically align un-sculpted eye meshes to the active profile's sculpted eye socket center.
  const eyeAlignOffset = useMemo(() => {
    if (!companionEyeGeo || !eyeGeo) {
      return [0, 0, 0] as [number, number, number];
    }
    if (!companionEyeGeo.boundingBox) companionEyeGeo.computeBoundingBox();
    if (!eyeGeo.boundingBox) eyeGeo.computeBoundingBox();
    const socketCenter = new THREE.Vector3();
    const activeCenter = new THREE.Vector3();
    companionEyeGeo.boundingBox?.getCenter(socketCenter);
    eyeGeo.boundingBox?.getCenter(activeCenter);
    return [
      socketCenter.x - activeCenter.x,
      socketCenter.y - activeCenter.y,
      socketCenter.z - activeCenter.z,
    ] as [number, number, number];
  }, [companionEyeGeo, eyeGeo]);

  const lashesGeo = useMeshGeometry(lashesMeshUrl, 'lashes')?.geometry ?? null;

  // ── real mouth, brows and body meshes from MO2 ────────────────────
  const mouthMeshUrl =
    parts?.mouth?.meshUrl ??
    (manifest?.headMesh as { mouthMeshUrl?: string } | undefined)?.mouthMeshUrl ??
    (manifest?.assets?.mouthMesh?.[0] as { meshUrl?: string })?.meshUrl ??
    (packMode ? '/assets/preset-pack/meshes/mouthMesh-479b956af5879125.json' : '/assets/mo2/mouth/ube-mouth.json');
  const browsMeshUrl =
    parts?.brows?.meshUrl ??
    (manifest?.headMesh as { browsMeshUrl?: string } | undefined)?.browsMeshUrl ??
    (manifest?.assets?.browsMesh?.[0] as { meshUrl?: string })?.meshUrl ??
    (packMode ? '/assets/preset-pack/meshes/browsMesh-81d3235798cd7065.json' : '/assets/mo2/brows/ube-brows.json');
  const bodyMeshUrl =
    parts?.body?.meshUrl ?? manifest?.body?.meshUrl ?? (packMode ? undefined : '/assets/mo2/body/ube-body.json');
  const mouthGeo = useMeshGeometry(mouthMeshUrl, 'mouth')?.geometry ?? null;
  const browsGeo = useMeshGeometry(browsMeshUrl, 'brows')?.geometry ?? null;

  /* ── FaceGen / UBE CharGen .tri Face Morphs ──────────────────────────
     Reactively applies 3D vertex morph offsets from CharGen .tri files
     to head, brows, and mouth geometries. */
  const faceSliders = useFaceMorphStore((s) => s.faceSliders);
  const [faceTriBundle, setFaceTriBundle] = useState<FaceTriBundle | null>(null);
  const browsBasePositionsRef = useRef<Float32Array | null>(null);
  const mouthBasePositionsRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadFaceTriBundle()
      .then((bundle) => {
        if (!cancelled) setFaceTriBundle(bundle);
      })
      .catch((err) => {
        console.warn('[HeadModel] Could not load FaceGen TRI morph bundle:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Snapshot brows and mouth base positions
  useEffect(() => {
    if (!browsGeo) {
      browsBasePositionsRef.current = null;
      return;
    }
    const pos = browsGeo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (pos) browsBasePositionsRef.current = new Float32Array(pos.array);
  }, [browsGeo]);

  useEffect(() => {
    if (!mouthGeo) {
      mouthBasePositionsRef.current = null;
      return;
    }
    const pos = mouthGeo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (pos) mouthBasePositionsRef.current = new Float32Array(pos.array);
  }, [mouthGeo]);

  // Apply face morphs whenever faceSliders or faceTriBundle changes
  useEffect(() => {
    if (!faceTriBundle) return;

    if (headBuild.geometry && headBuild.basePositions && faceTriBundle.head) {
      applyPartFaceMorphs(
        headBuild.geometry,
        headBuild.basePositions,
        faceSliders,
        faceTriBundle.head,
      );
    }

    if (browsGeo && browsBasePositionsRef.current && faceTriBundle.brows) {
      applyPartFaceMorphs(
        browsGeo,
        browsBasePositionsRef.current,
        faceSliders,
        faceTriBundle.brows,
      );
    }

    if (mouthGeo && mouthBasePositionsRef.current && faceTriBundle.mouth) {
      applyPartFaceMorphs(
        mouthGeo,
        mouthBasePositionsRef.current,
        faceSliders,
        faceTriBundle.mouth,
      );
    }

    onDirty();
  }, [faceTriBundle, faceSliders, headBuild, browsGeo, mouthGeo, onDirty]);

  /* ── body weight ──────────────────────────────────────────────────
     A `_0`/`_1` pair is two meshes over one atlas, exactly as in Skyrim. When
     the producer measured a pair the resolved part carries both URLs; both are
     fetched and the rendered position attribute is lerped as the slider moves.
     A part with no pair keeps the single mesh and the slider does nothing.

     The torso, hands and feet are three parts over the *same* body atlas and
     the *same* weight; they share one hook so they can never disagree about
     the current slider value. `useWeightedMeshResource` also holds a pair
     invisible until both halves arrive, and skips the redundant single fetch
     when a pair exists (`_1` is the part). */

  const bodyResource = useWeightedMeshResource(
    parts?.body?.weightVariants,
    bodyMeshUrl,
    'body',
    weight,
  );
  const bodyMesh = bodyResource.mesh;
  const bodyGeo = bodyMesh?.geometry ?? null;

  /* ── BodySlide 0Necoco morph deformation ───────────────────────────
     Deforms the loaded UBE body mesh dynamically based on active
     BodySlide sliders (0NecocoSliders / UBE Necoco). Operates directly
     on the geometry vertex position buffer with zero lag (60 FPS). */
  const bodySlideSliders = useBodySlideStore((s) => s.sliders);
  const nudeSliders = useBodySlideStore((s) => s.nudeSliders);
  const [bodySlideData, setBodySlideData] = useState<BodySlideDataBundle | null>(null);
  const bodyBasePositionsRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadAllBodySlideData()
      .then((bundle) => {
        if (!cancelled) setBodySlideData(bundle);
      })
      .catch((err) => {
        console.warn('[HeadModel] Could not load BodySlide morphs:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cache clean base positions when body mesh or weight changes
  useEffect(() => {
    if (!bodyMesh?.geometry) {
      bodyBasePositionsRef.current = null;
      return;
    }
    const posAttr = bodyMesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!posAttr) return;
    bodyBasePositionsRef.current = new Float32Array(posAttr.array);
  }, [bodyMesh, weight]);

  // Apply BodySlide morphs whenever sliders or data update
  useEffect(() => {
    if (!bodyMesh?.geometry || !bodySlideData || !bodyBasePositionsRef.current) return;
    const posAttr = bodyMesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!posAttr) return;

    const base = bodyBasePositionsRef.current;
    const target = posAttr.array as Float32Array;
    if (target.length !== base.length) return;

    applyBodySlideMorphs(
      target,
      base,
      nudeSliders,
      bodySlideData.mappings,
      bodySlideData.osdData,
    );

    posAttr.needsUpdate = true;
    bodyMesh.geometry.computeVertexNormals();
    onDirty();
  }, [bodyMesh, nudeSliders, bodySlideData, onDirty]);

  /* Hands and feet are authored as their own static prebaked pair assets over
     the same body atlas. Unlike the torso they have **no synthetic fallback**:
     a pack that does not supply them simply draws nothing there, and a pair
     that half-loads is not drawn at all. Their textures fall back to the body
     atlas so a limb never paints an unrelated shader's map. */
  const handsResource = useWeightedMeshResource(
    parts?.hands?.weightVariants,
    parts?.hands?.meshUrl,
    'hands',
    weight,
  );
  const feetResource = useWeightedMeshResource(
    parts?.feet?.weightVariants,
    parts?.feet?.meshUrl,
    'feet',
    weight,
  );
  const handsMesh = handsResource.mesh;
  const feetMesh = feetResource.mesh;

  /* ── Hands & Feet BodySlide morph deformation ─────────────────────
     Applies real-time BodySlide morphs (nails, claws, fingers, toes,
     soles, etc.) to UBE handsMesh and feetMesh at 60 FPS. */
  const [handData, setHandData] = useState<{ osdData: OsdData; mappings: Record<string, SliderOspMapping> } | null>(null);
  const [feetData, setFeetData] = useState<{ osdData: OsdData; mappings: Record<string, SliderOspMapping> } | null>(null);
  const handsBasePositionsRef = useRef<Float32Array | null>(null);
  const feetBasePositionsRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadHandOsd()
      .then((data) => {
        if (!cancelled) setHandData(data);
      })
      .catch((err) => {
        console.warn('[HeadModel] Could not load Hand BodySlide morphs:', err);
      });
    loadFeetOsd()
      .then((data) => {
        if (!cancelled) setFeetData(data);
      })
      .catch((err) => {
        console.warn('[HeadModel] Could not load Feet BodySlide morphs:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cache clean base positions when hands mesh or weight changes
  useEffect(() => {
    if (!handsMesh?.geometry) {
      handsBasePositionsRef.current = null;
      return;
    }
    const posAttr = handsMesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!posAttr) return;
    handsBasePositionsRef.current = new Float32Array(posAttr.array);
  }, [handsMesh, weight]);

  // Cache clean base positions when feet mesh or weight changes
  useEffect(() => {
    if (!feetMesh?.geometry) {
      feetBasePositionsRef.current = null;
      return;
    }
    const posAttr = feetMesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!posAttr) return;
    feetBasePositionsRef.current = new Float32Array(posAttr.array);
  }, [feetMesh, weight]);

  // Apply BodySlide morphs to hands
  useEffect(() => {
    if (!handsMesh?.geometry || !handData || !handsBasePositionsRef.current) return;
    const posAttr = handsMesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!posAttr) return;

    const base = handsBasePositionsRef.current;
    const target = posAttr.array as Float32Array;
    if (target.length !== base.length) return;

    applyBodySlideMorphs(
      target,
      base,
      nudeSliders,
      handData.mappings,
      handData.osdData,
    );

    posAttr.needsUpdate = true;
    handsMesh.geometry.computeVertexNormals();
    onDirty();
  }, [handsMesh, nudeSliders, handData, onDirty]);

  // Apply BodySlide morphs to feet
  useEffect(() => {
    if (!feetMesh?.geometry || !feetData || !feetBasePositionsRef.current) return;
    const posAttr = feetMesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!posAttr) return;

    const base = feetBasePositionsRef.current;
    const target = posAttr.array as Float32Array;
    if (target.length !== base.length) return;

    applyBodySlideMorphs(
      target,
      base,
      nudeSliders,
      feetData.mappings,
      feetData.osdData,
    );

    posAttr.needsUpdate = true;
    feetMesh.geometry.computeVertexNormals();
    onDirty();
  }, [feetMesh, nudeSliders, feetData, onDirty]);

  // Authored hair/outfit: multi-part hair and clothing resources.
  const hairParts = useMemo(
    () => parts?.hairParts ?? (parts?.hair?.meshUrl ? [parts.hair] : []),
    [parts?.hairParts, parts?.hair],
  );
  const clothingMeshSelection = useCharacter((s) => s.assetSelection.clothingMesh);
  const clothingMeshUrl = clothingMeshSelection ? parts?.clothing?.meshUrl : undefined;
  const clothingResource = useWeightedMeshResource(
    clothingMeshSelection ? parts?.clothing?.weightVariants : undefined,
    clothingMeshUrl,
    'clothing mesh',
    weight,
  );
  const clothingMesh = clothingResource.mesh;
  const clothingBasePositionsRef = useRef<Float32Array | null>(null);
  const [legacyClothingOsd, setLegacyClothingOsd] = useState<OsdData | null>(null);
  const [legacyClothingMappings, setLegacyClothingMappings] = useState<Record<string, SliderOspMapping> | null>(null);

  // Load matching legacy outfit OSD if available
  useEffect(() => {
    let cancelled = false;
    const clothingPart = parts?.clothing;
    const osdUrl = resolveGarmentOsdUrl(clothingPart);
    if (!osdUrl) {
      setLegacyClothingOsd(null);
      setLegacyClothingMappings(null);
      return;
    }
    Promise.all([
      loadGarmentOsd(osdUrl),
      loadGarmentMappings(clothingPart),
    ])
      .then(([data, mappings]) => {
        if (!cancelled) {
          setLegacyClothingOsd(data);
          setLegacyClothingMappings(mappings);
        }
      })
      .catch((err) => {
        console.warn(`[HeadModel] Could not load legacy outfit OSD for ${clothingPart?.label || clothingMeshUrl}:`, err);
      });
    return () => {
      cancelled = true;
    };
  }, [clothingMeshUrl, parts?.clothing?.id, parts?.clothing?.file, parts?.clothing?.label]);

  // Snapshot clean base positions when legacy outfit mesh or weight changes
  useEffect(() => {
    if (!clothingMesh?.geometry) {
      clothingBasePositionsRef.current = null;
      return;
    }
    const posAttr = clothingMesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!posAttr) return;
    clothingBasePositionsRef.current = new Float32Array(posAttr.array);
  }, [clothingMesh, weight]);

  const legacyClothingOffsets = useMemo(
    () => computeMeshShapeOffsets(clothingMesh),
    [clothingMesh],
  );

  // Apply real-time BodySlide morphs to legacy outfit
  useEffect(() => {
    if (!clothingMesh?.geometry || !legacyClothingOsd || !bodySlideData || !clothingBasePositionsRef.current) return;
    const posAttr = clothingMesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!posAttr) return;

    const base = clothingBasePositionsRef.current;
    const target = posAttr.array as Float32Array;
    if (target.length !== base.length) return;

    const hasActiveMorphs = Object.values(bodySlideSliders).some((v) => Math.abs(v) > 0.0001);
    if (!hasActiveMorphs) {
      target.set(base);
      posAttr.needsUpdate = true;
      clothingMesh.geometry.computeVertexNormals();
      return;
    }

    applyBodySlideMorphs(
      target,
      base,
      bodySlideSliders,
      legacyClothingMappings || bodySlideData.mappings,
      legacyClothingOsd,
      undefined,
      legacyClothingOffsets,
    );

    posAttr.needsUpdate = true;
    clothingMesh.geometry.computeVertexNormals();
    onDirty();
  }, [clothingMesh, bodySlideSliders, legacyClothingOsd, legacyClothingMappings, bodySlideData, legacyClothingOffsets, onDirty]);
  /* Worn garments from the paper-doll. Each is its own NIF over its own
     authored atlases, so unlike the whole outfit they have no shared texture
     override — only the embedded-body fallback below applies. */
  const equipped = useMemo(
    () => (parts?.equipment ?? []).filter((p) => Boolean(p.meshUrl)),
    [parts?.equipment],
  );

  // Modular Limb Culling: boots/shoes hide bare feet; gloves/gauntlets hide bare hands.
  const hasFootwear = useMemo(
    () =>
      equipped.some(
        (g) =>
          g.slot === 'feet' ||
          (g as { equipSlot?: string }).equipSlot === 'feet' ||
          /boot|shoe|heel|sandals/i.test(g.label || g.rel || ''),
      ),
    [equipped],
  );

  const hasHandwear = useMemo(
    () =>
      equipped.some(
        (g) =>
          g.slot === 'hands' ||
          (g as { equipSlot?: string }).equipSlot === 'hands' ||
          /glove|gauntlet|mitt|bracer/i.test(g.label || g.rel || ''),
      ),
    [equipped],
  );

  const garmentVisible = useCharacter((s) => s.garmentVisible);

  // Modular Body Culling: equipping a body outfit/suit hides the standalone nude body,
  // allowing the outfit's own integrated BaseShape to render without clipping.
  // When garments are toggled off (garmentVisible === false), the standalone nude body
  // must always render so the user sees their complete unclipped anatomy.
  const hasBodywear = useMemo(
    () =>
      garmentVisible !== false &&
      equipped.some(
        (g) =>
          g.slot === 'outfit' ||
          g.slot === 'body' ||
          g.slot === 'top' ||
          (g as { equipSlot?: string }).equipSlot === 'outfit' ||
          (g as { equipSlot?: string }).equipSlot === 'body' ||
          (g as { equipSlot?: string }).equipSlot === 'top' ||
          /bodysuit|onepiece|dress|outfit|robe|suit|sweater/i.test(g.label || g.rel || ''),
      ),
    [equipped, garmentVisible],
  );
  /* Stable identities: `AuthoredPart` keys its texture effect on these, and an
     inline object would reload every map on every parent render.

     The outfit's embedded body uses the *body* atlas only. The head skin is
     painted for the head's planar UV rect, so projecting it onto a body shape
     would smear the face across the torso — worse than an untextured shape,
     which the renderer hides. Garment/accessory slots are deliberately left
     without a fallback: the authored per-shape URL is the authority, and one
     garment atlas must not be painted over an accessory shape. */
  const clothingBodyTexture = parts?.body?.texture ?? manifest?.body?.texture;
  const clothingBodyNormal = parts?.body?.normalTexture ?? manifest?.body?.normalTexture;
  /* The deliberate garment override (a picked clothing atlas) may fill a shape
     whose shader named no texture; an accessory shape never borrows it. */
  const clothingOverrideTexture = parts?.clothing?.texture;
  const clothingOverrideNormal = parts?.clothing?.normalTexture;
  const clothingFallback = useMemo(
    () => ({ skin: clothingBodyTexture, clothing: clothingOverrideTexture }),
    [clothingBodyTexture, clothingOverrideTexture],
  );
  const clothingNormalFallback = useMemo(
    () => ({ skin: clothingBodyNormal, clothing: clothingOverrideNormal }),
    [clothingBodyNormal, clothingOverrideNormal],
  );
  const hairNormalSrc = parts?.hair?.normalTexture;
  const hairNormalFallback = useMemo(
    () => ({ hair: hairNormalSrc }),
    [hairNormalSrc],
  );
  /* The pack can supply BOTH an extracted body mesh and an outfit that carries
     its own embedded body. Draw exactly one: when the standalone body is
     available it wins, and the outfit contributes garment shapes only.
     Turning the garment off must still leave a body on screen. */
  const clothingHasEmbeddedBody = Boolean(
    clothingResource.mesh?.materials?.some((m) => m.role === 'skin'),
  );
  const clothingHiddenRoles = useMemo(() => {
    const hidden: MaterialRole[] = [];
    if (garmentVisible === false) hidden.push('clothing', 'accessory');
    if (bodyGeo && clothingHasEmbeddedBody) hidden.push('skin');
    return hidden;
  }, [garmentVisible, bodyGeo, clothingHasEmbeddedBody]);
  /* One array for every worn garment: the slot set cannot change without the
     store changing, and a fresh array per render would re-key every part. */
  const equipmentHiddenRoles = useMemo<MaterialRole[]>(
    () => (garmentVisible === false ? ['clothing', 'accessory'] : []),
    [garmentVisible],
  );
  const neckGeo = useMemo(() => buildNeckGeometry(), []);
  const torsoGeo = useMemo(() => buildTorsoGeometry(), []);

  /* The skin shader reads per-vertex `skinCavity`; the head rig attaches it to
     the head itself. The raw meshes this component draws (procedural neck, real
     mouth, unskinned fallback body) need it here; `SkinnedPart`/`AuthoredPart`
     cover their own geometries. Idempotent, so a double attach is a no-op. */
  useEffect(() => {
    attachSkinCavity(neckGeo);
    if (mouthGeo) attachSkinCavity(mouthGeo);
    if (bodyGeo) attachSkinCavity(bodyGeo);
  }, [neckGeo, mouthGeo, bodyGeo]);

  const rig = useMemo(() => createRig(headBuild.geometry), [headBuild.geometry]);
  const browsMesh = useMemo(() => browsGeo ? createBrowMesh(browsGeo, rig) : null, [browsGeo, rig]);
  useEffect(() => () => { browsMesh?.geometry.dispose(); }, [browsMesh]);

  const [ubeBlinkData, setUbeBlinkData] = useState<UbeEyeBlinkBundle | null>(() =>
    getCachedUbeEyeBlinkData(),
  );
  const [ubeBlinkSettled, setUbeBlinkSettled] = useState<boolean>(() =>
    Boolean(getCachedUbeEyeBlinkData()) || hasUbeEyeBlinkSettled(),
  );
  useEffect(() => {
    if (ubeBlinkSettled && ubeBlinkData) return;
    let cancelled = false;
    void loadUbeEyeBlinkData().then((data) => {
      if (cancelled) return;
      if (data) setUbeBlinkData(data);
      setUbeBlinkSettled(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ubeBlinkData, ubeBlinkSettled]);

  const [ubeExprData, setUbeExprData] = useState<UbeExpressionBundle | null>(() =>
    getCachedUbeExpressionData(),
  );
  const [ubeExprSettled, setUbeExprSettled] = useState<boolean>(() =>
    Boolean(getCachedUbeExpressionData()) || hasUbeExpressionSettled(),
  );
  useEffect(() => {
    if (ubeExprSettled && ubeExprData) return;
    let cancelled = false;
    void loadUbeExpressionData().then((data) => {
      if (cancelled) return;
      if (data) setUbeExprData(data);
      setUbeExprSettled(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ubeExprData, ubeExprSettled]);

  /* Attach standard ARKit/MetaHuman-compatible blink (`eyeBlinkLeft` / `eyeBlinkRight`)
     and facial expression + speech viseme relative morph targets & smooth morph normals
     onto Head, Lashes, and Mouth geometries, syncing dictionaries & shaders. */
  useEffect(() => {
    if (importedHead) return;
    const blinkAttached = attachBlinkMorphTargets(headBuild.geometry, lashesGeo, eyeGeo, {
      force: true,
      ubeData: ubeBlinkData,
    });
    const exprAttached = attachExpressionMorphTargets(headBuild.geometry, mouthGeo, {
      force: true,
      ubeData: ubeExprData,
    });
    if (!blinkAttached && !exprAttached) return;
    rig.root.traverse((obj) => {
      if (
        obj instanceof THREE.Mesh &&
        (obj.geometry === headBuild.geometry || obj.geometry === lashesGeo || obj.geometry === mouthGeo)
      ) {
        obj.updateMorphTargets();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (mat) mat.needsUpdate = true;
        }
      }
    });
    onDirty();
  }, [
    rig,
    headBuild.geometry,
    lashesGeo,
    eyeGeo,
    mouthGeo,
    faceTriBundle,
    faceSliders,
    ubeBlinkData,
    ubeBlinkSettled,
    ubeExprData,
    ubeExprSettled,
    importedHead,
    onDirty,
  ]);

  /* ── the pack skeleton ────────────────────────────────────────────
     One registry for the whole character. Every skinned part registers its own
     bone names against it, so the outfit, the embedded body and the hairstyle
     all resolve their weights to the same `THREE.Bone` objects — a pose must
     move them together, and separate bone sets would drift apart. */
  const skeletonRegistry = useMemo(() => new SkeletonRegistry('head'), []);
  const characterRef = useRef<THREE.Group>(null);
  const applyBodyScale = useCallback(() => {
    const result = applySkeletonWeight(skeletonRegistry, weight, bodyScaleFactors(useCharacter.getState().anatomy));
    if (characterRef.current) {
      characterRef.current.position.y = result.footDrop;
      characterRef.current.updateMatrixWorld(true);
    }
    if (useCharacter.getState().characterHeight !== result.height) {
      useCharacter.setState({ characterHeight: result.height });
    }
  }, [skeletonRegistry, weight]);
  const bodyPoseId = useCharacter((s) => s.bodyPoseId);
  const poseIntensity = useCharacter((s) => s.poseIntensity);
  /* Unweighted parts are routed through `SkinnedPart` (which auto-rigs them)
     only while this toggle is on; otherwise they keep their authored bind. */
  const autoRigUnskinned = useCharacter((s) => s.autoRigUnskinned);
  /** Snapshot of the applied pose, handed to `AnimationDirector` as its base
   *  clip. Built here (right after the pose writes the bones) so the director
   *  never has to race the mixer to capture it. */
  const [poseClip, setPoseClip] = useState<THREE.AnimationClip | null>(null);
  const [skeletonGen, setSkeletonGen] = useState(0);

  useEffect(() => {
    let disposed = false;
    const unsub = skeletonRegistry.subscribe(() => {
      /* `register()` runs inside child `useMemo` during render; defer to a
         microtask so React never receives a state update mid-render. */
      queueMicrotask(() => {
        if (!disposed) setSkeletonGen((g) => g + 1);
      });
    });
    return () => {
      disposed = true;
      unsub();
    };
  }, [skeletonRegistry]);

  /* Applied over the rest pose on every change: presets are absolute, so
     switching from one to another must not inherit the previous rotations.

     The facial rig is authored in the same head-centred space as the pack
     vertices, so it also has to ride the pack's head bone: at rest the head
     bone's rest pose cancels the offset exactly, and once a preset turns the
     neck or head the face follows.

     The rig is *not* re-parented under the bone. R3F places every `<primitive>`
     under the node that encloses it in JSX, so a bone-parented object would be
     moved back to the character group on the next reconciliation — silently
     undoing the attachment. Instead the root keeps its place in the tree and
     its matrix is driven from the bone's world matrix.

     All of it lives in one effect, and it has to: parts register their bones
     while *they* render, which is after this component's render body, so a
     `useMemo` here would read an empty registry on the very render that
     delivered the mesh and never recompute. Effects run after children, which
     is exactly when the registry is complete. */
  /**
   * Read the animated head/spine world matrices and express the facial rig and
   * neck seam against them.
   *
   * Split from the pose effect because it must run *every* frame: once
   * `AnimationDirector` drives the bones, the head-follow transform is a
   * per-frame function of the mixer output, not a one-shot pose result. It
   * only reads bone matrices and rewrites the neck vertices — no texture bake,
   * no full-geometry rebuild — so per-frame cost stays small.
   */
  const syncFollow = useCallback((): {
    relTransform: THREE.Matrix4 | null;
    followHead: THREE.Matrix4 | null;
  } => {
    const restHead = skeletonRegistry.restWorld('NPC Head [Head]');
    const boneHead = skeletonRegistry.byName.get('NPC Head [Head]');
    const restSpine2 = skeletonRegistry.restWorld('NPC Spine2 [Spn2]');
    const boneSpine2 = skeletonRegistry.byName.get('NPC Spine2 [Spn2]');

    if (restHead && boneHead) {
      /* boneHead.matrixWorld is in scene space; the rig hangs off the character
         group, so the skeleton group's own world matrix is removed first. Both
         are identity in practice, but doing it properly keeps the rig correct
         if the character is ever placed under a transformed node. */
      const followHead = skeletonRegistry.group.matrixWorld.clone().invert();
      followHead.multiply(boneHead.matrixWorld).multiply(restHead.clone().invert());
      rig.root.matrixAutoUpdate = false;
      rig.root.matrix.copy(followHead);
      rig.root.updateMatrixWorld(true);

      let relTransform: THREE.Matrix4 | null = null;
      if (restSpine2 && boneSpine2) {
        const followSpine2 = skeletonRegistry.group.matrixWorld.clone().invert();
        followSpine2.multiply(boneSpine2.matrixWorld).multiply(restSpine2.clone().invert());
        relTransform = followHead.clone().invert().multiply(followSpine2);
      }
      return { relTransform, followHead };
    }
    rig.root.matrixAutoUpdate = true;
    rig.root.matrix.identity();
    rig.root.updateMatrixWorld(true);
    return { relTransform: null, followHead: null };
  }, [skeletonRegistry, rig]);

  const applyFollow = useCallback(
    (relTransform: THREE.Matrix4 | null, followHead: THREE.Matrix4 | null) => {
      applyNeckDelta(
        headBuild.geometry,
        headBuild.basePositions,
        weight,
        relTransform,
        headBuild.baseNormals,
        !importedHead,
        headBuild.baseWeight ?? 1.0,
        bodyMesh && followHead && skeletonRegistry.byName.size > 0
          ? {
              bodyGeometry: bodyMesh.geometry,
              bones: bodyMesh.bones ?? [],
              skeletonRegistry,
              followHead,
            }
          : null,
      );
      onDirty();
    },
    [headBuild, weight, bodyMesh, skeletonRegistry, onDirty, importedHead],
  );

  /* Last head+spine world matrices the follow was computed from. Paused and
     rest frames leave them identical, so the seam/facial-follow work is skipped
     instead of rewriting 400+ neck vertices every frame for no change. */
  const lastFollowRef = useRef<Float32Array | null>(null);
  const followScratchRef = useRef(new Float32Array(32));
  /** `AnimationDirector`'s post-mixer hook: follow whatever the mixer wrote. */
  const followAnimatedFrame = useCallback(() => {
    if (skeletonRegistry.byName.size === 0) return;
    const head = skeletonRegistry.byName.get('NPC Head [Head]')?.matrixWorld.elements;
    const spine2 = skeletonRegistry.byName.get('NPC Spine2 [Spn2]')?.matrixWorld.elements;
    const next = followScratchRef.current;
    if (head) next.set(head.slice(0, 16), 0);
    if (spine2) next.set(spine2.slice(0, 16), 16);

    const prev = lastFollowRef.current;
    let changed = !prev;
    if (prev) {
      for (let i = 0; i < 32; i++) {
        if (Math.abs(prev[i] - next[i]) > 1e-6) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;
    /* Snapshot into a stable buffer so the next frame compares against this
       frame's matrices rather than the shared scratch being overwritten. */
    lastFollowRef.current = next.slice();
    const { relTransform, followHead } = syncFollow();
    applyFollow(relTransform, followHead);
  }, [skeletonRegistry, syncFollow, applyFollow]);

  /* The pose effect now applies the pose ONCE, snapshots it into `poseClip`,
     and hands it to the director; the director takes over from there.
     Re-running on mesh registration is what keeps the snapshot complete: a
     newly mounted part adds bones (and re-applies the pose) so the next
     snapshot includes them. */
  useEffect(() => {
    if (bodyMesh?.bones?.length) {
      skeletonRegistry.register(bodyMesh.bones);
    }

    if (skeletonRegistry.byName.size === 0) {
      applyFollow(null, null);
      return;
    }

    const finish = () => {
      /* Pose the facial rig / neck seam once for this commit; from the next
         frame the director's `followAnimatedFrame` keeps them current. */
      const { relTransform, followHead } = syncFollow();
      applyFollow(relTransform, followHead);
      /* Snapshot the authored pose now, while the bones are exactly at it, and
         hand the clip to the director. `buildPoseClip` includes only bones this
         registry knows, so a part that mounts later is picked up on the next
         run of this effect (registration already re-triggers it). The same
         snapshot is the export's honest pose (the live bones may be mid-breath
         by the time an export runs). */
      const clip = buildPoseClip(skeletonRegistry.byName.values(), `Pose_${bodyPoseId}`);
      setAuthoredPose(bodyPoseId, clip);
      setPoseClip(clip);
    };

    // Built-in poses apply synchronously: no microtask delay, no unblended intermediate frames
    const builtin = BODY_POSES.find((p) => p.id === bodyPoseId);
    if (builtin) {
      applyBodyPose(skeletonRegistry, builtin, poseIntensity);
      applyBodyScale();
      finish();
      return;
    }

    // External Skyrim HKX pose tracks load asynchronously
    let cancelled = false;
    void fetchPoseTrack(bodyPoseId).then((track) => {
      if (cancelled) return;
      if (track) applyPoseTrack(skeletonRegistry, track, poseIntensity);
      else applyBodyPose(skeletonRegistry, BODY_POSES[0], poseIntensity);
      applyBodyScale();
      finish();
    });

    return () => {
      cancelled = true;
    };
  }, [skeletonRegistry, skeletonGen, bodyPoseId, poseIntensity, rig, weight, headBuild, bodyMesh, handsMesh, feetMesh, clothingResource.mesh, hairParts, onDirty, syncFollow, applyFollow, applyBodyScale]);

  useEffect(() => {
    const apply = () => {
      if (!skeletonRegistry.byName.size) return;
      applyBodyScale();
      const { relTransform, followHead } = syncFollow();
      applyFollow(relTransform, followHead);
    };
    apply();
    let frame = 0;
    const unsubscribe = useCharacter.subscribe((state, prev) => {
      if (state.anatomy === prev.anatomy || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        apply();
      });
    });
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [applyBodyScale, skeletonRegistry, syncFollow, applyFollow]);

  /* Dev-only: the paired-bone naming bug left every eyebrow and cheek bone
     unresolvable for the entire life of this app and nothing logged. Cheap
     enough (six regions) to re-check whenever the rig is rebuilt. */
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const problems = verifyRigWiring(rig);
    if (problems.length) console.warn('[rig] wiring problems:\n  ' + problems.join('\n  '));
  }, [rig]);

  const [faceTex, setFaceTex] = useState<FaceTextureResult | null>(null);
  /** The selected skin's own `femalehead_n.dds`, projected; null when absent. */
  const [skinNormal, setSkinNormal] = useState<THREE.CanvasTexture | null>(null);

  const overlayLayers = useCharacter((s) => s.overlayLayers);
  /** The pack a converted tintmask URL belongs to; a switch invalidates the
   *  cached mask promises below. */
  const assetSourceId = useCharacter((s) => s.assetSourceId);

  /* Each tintmask is a catalogue id; the route serves it as a greyscale mask.
     Loading them here rather than inside the bake keeps `buildFaceTexture`
     a pure decode → composite → project step with no network in the middle.
     Every property the compositor reads is in the key, not just the ones that
     change the mask URL: a blend or coverage edit has no new image to fetch,
     but it must still rebuild `overlayImages` so the bake re-runs. */
  const overlayKey = useMemo(
    () =>
      overlayLayers
        .map(
          (l) =>
            `${l.kind}:${l.id}:${l.color}:${l.opacity}:${l.blend ?? 'normal'}:${l.coverage ?? 1}`,
        )
        .join('|'),
    [overlayLayers],
  );
  const [overlayImages, setOverlayImages] = useState<OverlayInput[]>([]);
  /* Decoded tintmasks, keyed by their source URL. A colour, opacity, blend or
     coverage change rebuilds the layer objects (so the baked composite picks
     up the new parameters) but must never refetch the same image. The cache
     is scoped to this component and cleared when the asset source changes:
     a picked id is only meaningful inside the pack that served it. */
  const maskCacheRef = useRef(new Map<string, Promise<HTMLImageElement | null>>());
  useEffect(() => {
    maskCacheRef.current = new Map();
  }, [assetSourceId]);
  useEffect(() => {
    if (!overlayLayers.length) {
      setOverlayImages([]);
      return;
    }
    let cancelled = false;
    const cache = maskCacheRef.current;
    Promise.all(
      overlayLayers.map(async (layer) => {
        const src = convertUrl({ kind: layer.kind, id: layer.id, mode: 'alpha' });
        let mask = cache.get(src);
        if (!mask) {
          mask = loadMask(src);
          cache.set(src, mask);
        }
        const resolved = await mask;
        /* A miss stays retryable: keeping `null` cached would make a transient
           fetch failure permanent for as long as the source lives. */
        if (!resolved) cache.delete(src);
        return { layer, mask: resolved };
      }),
    ).then((loaded) => {
      if (!cancelled) setOverlayImages(loaded);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the
    // serialised stack; the array identity changes on every store write.
  }, [overlayKey, assetSourceId]);

  const skinSrc = manifest?.textures?.skin;
  const skinNormalSrc = manifest?.textures?.normal;
  /* Skyrim's `_n.dds` alpha as a roughness map. The pack ships this for its
     own head; a catalogue skin pick converts on demand and has none, in which
     case the material keeps its scalar roughness. */
  const skinRoughnessSrc =
    manifest?.textures?.skinRoughness ??
    '/assets/preset-pack/textures/skin/head_rough.webp';
  const eyeSrc =
    manifest?.textures?.eye ??
    manifest?.eye?.texture ??
    (manifest?.assets?.eyes?.[0] as { texture?: string })?.texture ??
    '/assets/preset-pack/textures/eyes/eyes.webp';
  const atlasCx = manifest?.eye?.atlas?.cx;
  const atlasCy = manifest?.eye?.atlas?.cy;
  const atlasR = manifest?.eye?.atlas?.r;
  const irisHex = manifest?.eye?.iris;
  const hairSrc = parts?.hair?.texture ?? manifest?.textures?.hair;

  /* Two effects, not one keyed on the manifest object. The face bake is a
     1536² per-pixel projection plus several full-canvas passes; re-running it
     because the user picked a different *hair* texture would stall the
     viewport for a second for no reason. Keying on the source URLs means only
     a skin or eye change pays for it, and `setFaceTex` only fires once the new
     bake resolves, so the previous face stays on screen rather than flashing
     to the bare material. */
  useEffect(() => {
    let cancelled = false;
    buildFaceTexture(manifest, overlayImages).then((res) => {
      if (!cancelled) setFaceTex(res);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the
    // numbers the bake actually reads; `manifest` identity churns on select.
  }, [skinSrc, eyeSrc, atlasCx, atlasCy, atlasR, irisHex, overlayImages]);

  /* The skin mod's own tangent-space normal, projected into the same face rect
     as the albedo. Keyed on its URL alone — a normal map change does not
     invalidate the albedo bake, and re-running that bake for it would stall
     the viewport for nothing. */
  useEffect(() => {
    let cancelled = false;
    buildProjectedNormal(manifest).then((tex) => {
      if (!cancelled) setSkinNormal(tex);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the URL
    // the bake reads; `manifest` identity churns on every asset select.
  }, [skinNormalSrc]);

  /* Sobel of the albedo — the fallback, computed only when the skin has no
     real normal map, because it is both expensive and inferior. */
  const detailTex = useMemo(
    () => (faceTex && !skinNormal ? buildDetailTexture(faceTex.canvas) : null),
    [faceTex, skinNormal],
  );

  /* One tiled pore/relief tile generated ONCE per skin URL from the base head
     albedo. Deliberately not from the composited overlay or the body/mouth
     atlas: the generator is a cheek crop, and those atlases carry fabric and
     skin features that would tile as artefacts. Every skin material reuses
     this one tile — slider changes only re-push strength, never rebuild it. */
  const [skinDetailTex, setSkinDetailTex] = useState<THREE.CanvasTexture | null>(null);
  const skinDetailRef = useRef<THREE.CanvasTexture | null>(null);
  useEffect(() => () => {
    skinDetailRef.current?.dispose();
    skinDetailRef.current = null;
  }, []);
  const detailFit = manifest?.atlasFit;
  useEffect(() => {
    let cancelled = false;
    const clearDetail = () => {
      skinDetailRef.current?.dispose();
      skinDetailRef.current = null;
      setSkinDetailTex(null);
    };
    if (!skinSrc) {
      clearDetail();
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        const tex = buildSkinDetailNormal(img, detailFit);
        skinDetailRef.current?.dispose();
        skinDetailRef.current = tex;
        setSkinDetailTex(tex);
      } catch (err) {
        clearDetail();
        console.error('[HeadModel] failed to build skin detail normal:', err);
      }
    };
    img.onerror = (err) => {
      if (cancelled) return;
      clearDetail();
      console.error(`[HeadModel] failed to load skin detail source ${skinSrc}:`, err);
    };
    img.src = skinSrc;
    return () => {
      cancelled = true;
    };
  }, [skinSrc, detailFit?.cx, detailFit?.cy, detailFit?.kx, detailFit?.ky]);
  const hairSettings = useCharacter((s) => s.hair);
  const hair = hairSettings;
  const showScalp = useCharacter((s) => s.showScalp);
  const skinGloss = useCharacter((s) => s.skinGloss);
  const skinSss = useCharacter((s) => s.skinSss);
  const skinDetail = useCharacter((s) => s.skinDetail);
  const skinSheen = useCharacter((s) => s.skinSheen);
  const skinNormalStrength = useCharacter((s) => s.skinNormalStrength ?? 1.0);
  const skinColor = useCharacter((s) => s.skinColor);
  const lashesColor = useCharacter((s) => s.lashesColor);
  const lashesOpacity = useCharacter((s) => s.lashesOpacity);
  const browColor = useCharacter((s) => s.browColor);
  const browOpacity = useCharacter((s) => s.browOpacity);
  const browGloss = useCharacter((s) => s.browGloss);
  const browGlossy = useCharacter((s) => s.browGlossy);
  const skinRoughness = skinRoughnessFromGloss(skinGloss);

  /* Authored hair and outfit are rendered by `AuthoredPart`, which keeps each
     shape's own material. `alphaTest` cuts hair strands without blending them
     against one another; the outfit's body/garment split is the producer's
     authored grouping, not a colour heuristic here. */

  const isReal = Boolean(realMesh && manifest?.headMesh?.isRealMesh);

  /* The direct atlas is loaded through the shared hook rather than an
     imperative loader inside `useMemo`: a memo factory must stay pure, and
     under StrictMode its double invocation plus the reset effect left the
     state stuck at `pending` even after the image arrived, which hid the
     whole character. The hook owns cleanup and stale-callback checks. */
  /* The rig's own material, captured once per rig. Reading `rig.mesh.material`
     during render would see the flat-grey stand-in on the render after the
     swap effect ran, and the head-material effects below would then try to
     drive `normalScale` on a `MeshBasicMaterial` that has none. */
  const headMaterial = useMemo(
    () => rig.mesh.material as THREE.MeshStandardMaterial,
    [rig],
  );

  const neckMaterial = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: skinColor, roughness: skinRoughness, metalness: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Apply ENB-calibrated skin shader once per material instance. Head is the
  // rig's own material (owned by the head rig); neck is ours and must be
  // physical so the sheen/clearcoat half of `updateSkinGloss` applies.
  useEffect(() => {
    applySkinGloss(headMaterial, skinGloss, skinSss, skinSheen);
    applySkinGloss(neckMaterial, skinGloss, skinSss, skinSheen);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- creation-time
    // only: the live effect further down pushes GLOSS/SSS without recompiling.
  }, [headMaterial, neckMaterial]);
  const headMapState = useMaterialTexture(
    headMaterial,
    'map',
    isReal ? skinSrc : undefined,
    { colorSpace: THREE.SRGBColorSpace },
  );
  const headNormalState = useMaterialTexture(
    headMaterial,
    'normalMap',
    isReal ? skinNormalSrc : undefined,
    {},
  );
  /* The gloss mask is the reason a whole face no longer shares one scalar
     roughness. The neck borrows the head's atlas and therefore its UVs, so it
     takes the same map in the effect below. */
  useMaterialTexture(headMaterial, 'roughnessMap', isReal ? skinRoughnessSrc : undefined, {});

  // Remember base atlas texture so clearing overlays reverts cleanly
  const baseAtlasRef = useMemo(() => ({ current: null as THREE.Texture | null }), []);
  useEffect(() => {
    if (headMapState === 'loaded' && headMaterial.map && !headMaterial.map.userData?.__isCompositedOverlay) {
      baseAtlasRef.current = headMaterial.map;
    }
  }, [headMapState, headMaterial.map, baseAtlasRef]);

  /* In real mesh mode, tintmasks / makeup are composited directly onto the
     underlying head diffuse in atlas space, giving live RaceMenu parity.
     When no overlays are present, the raw atlas from useMaterialTexture is used. */
  const [realOverlayTex, setRealOverlayTex] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (!isReal || !skinSrc || overlayImages.length === 0) {
      setRealOverlayTex((prev) => {
        prev?.dispose();
        return null;
      });
      return;
    }
    let cancelled = false;
    const baseImg = new Image();
    baseImg.crossOrigin = 'anonymous';
    baseImg.onload = () => {
      if (cancelled) return;
      const canvas = compositeHeadAtlas(baseImg, overlayImages);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = true;
      tex.userData = { __isCompositedOverlay: true };
      tex.needsUpdate = true;
      setRealOverlayTex((prev) => {
        prev?.dispose();
        return tex;
      });
    };
    baseImg.src = skinSrc;
    return () => {
      cancelled = true;
    };
  }, [isReal, skinSrc, overlayImages]);

  useEffect(() => {
    if (isReal) {
      if (realOverlayTex) {
        headMaterial.map = realOverlayTex;
      } else if (baseAtlasRef.current) {
        headMaterial.map = baseAtlasRef.current;
      }
      headMaterial.color.set(skinColor);
      headMaterial.roughness = skinRoughness;
      headMaterial.metalness = 0.0;
      headMaterial.normalScale.set(skinNormalStrength, skinNormalStrength);
      headMaterial.needsUpdate = true;
      return;
    }
    if (!faceTex) return;
    headMaterial.map = faceTex.texture;
    headMaterial.color.set(skinColor);
    headMaterial.roughness = skinRoughness;
    headMaterial.metalness = 0.0;
    const normal = skinNormal ?? detailTex;
    headMaterial.normalMap = normal ?? null;
    const ns = (skinNormal ? 1.0 : 0.34) * skinNormalStrength;
    headMaterial.normalScale.set(ns, ns);
    headMaterial.needsUpdate = true;
  }, [faceTex, detailTex, skinNormal, headMaterial, isReal, skinRoughness, realOverlayTex, baseAtlasRef, skinColor, skinNormalStrength]);

  useEffect(() => {
    neckMaterial.roughness = skinRoughness;
    if (isReal) {
      /* The neck borrows the head atlas the hook loaded; it is the same skin
         and the same draw, so it must never keep a stale legacy face bake.
         It also borrows the gloss mask, which is authored for the same UVs. */
      /* The head effect runs first, so this reads the atlas/overlay it just
         committed. Both the overlay identity and the normal's load state are
         in the key, or a later normal arrival would never reach the neck. */
      neckMaterial.map = headMapState === 'loaded' ? headMaterial.map : null;
      neckMaterial.roughnessMap = skinRoughnessSrc ? headMaterial.roughnessMap : null;
      neckMaterial.normalMap = headNormalState === 'loaded' ? headMaterial.normalMap : null;
      neckMaterial.normalScale.set(skinNormalStrength, skinNormalStrength);
      neckMaterial.color.set(skinColor);
      neckMaterial.needsUpdate = true;
      return;
    }
    if (!faceTex) return;
    neckMaterial.map = faceTex.texture;
    neckMaterial.roughnessMap = null;
    neckMaterial.normalMap = null;
    neckMaterial.color.set(skinColor);
    neckMaterial.needsUpdate = true;
  }, [faceTex, neckMaterial, isReal, headMapState, headNormalState, headMaterial, realOverlayTex, skinRoughness, skinRoughnessSrc, skinColor, skinNormalStrength]);

  // Live-update normal scale across skin materials without texture reloads
  useEffect(() => {
    headMaterial.normalScale.set(skinNormalStrength, skinNormalStrength);
    neckMaterial.normalScale.set(skinNormalStrength, skinNormalStrength);
    headMaterial.needsUpdate = true;
    neckMaterial.needsUpdate = true;
  }, [skinNormalStrength, headMaterial, neckMaterial]);

  // Live-update SSS/sheen uniforms when GLOSS, SSS or SHEEN changes (no recompile needed)
  useEffect(() => {
    updateSkinGloss(headMaterial, skinGloss, skinSss, skinSheen);
    updateSkinGloss(neckMaterial, skinGloss, skinSss, skinSheen);
  }, [skinGloss, skinSss, skinSheen, headMaterial, neckMaterial]);

  const torsoMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#3f473c',
        roughness: 0.94,
        metalness: 0.02,
      }),
    [],
  );

  const eyeMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#ffffff',
        roughness: 0.04,
        metalness: 0.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.02,
        ior: 1.376,
        /* Koralina's atlases leave transparent-white texels around the sclera
           (COR's are alpha-255 everywhere, so this is a no-op for them).
           Without the cut they render as white patches on the eyeball. */
        alphaTest: 0.5,
      }),
    [],
  );

  const eyeFallbackMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#f0ece1',
        roughness: 0.25,
      }),
    [],
  );

  const lashesMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a1412',
        roughness: 0.85,
        metalness: 0.0,
        transparent: true,
        alphaTest: 0.2,
        alphaToCoverage: true,
        depthWrite: true,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const eyeTexState = useMaterialTexture(eyeMaterial, 'map', eyeSrc, {
    colorSpace: THREE.SRGBColorSpace,
    wrap: true,
  });
  /* The pack bakes a tangent-space normal beside every facial albedo; without
     it the iris flattens into a decal on the eyeball. The eye's route is the
     `eyes` texture row (`manifest.eye`), not a `parts` entry. */
  useMaterialTexture(eyeMaterial, 'normalMap', manifest?.eye?.normalTexture, {});
  const eyeRoughSrc = (manifest?.eye as { roughnessTexture?: string } | undefined)?.roughnessTexture;
  const eyeEmissiveSrc = (manifest?.eye as { emissiveTexture?: string } | undefined)?.emissiveTexture;
  const eyeRoughState = useMaterialTexture(eyeMaterial, 'roughnessMap', eyeRoughSrc, {});
  const eyeEmissiveState = useMaterialTexture(eyeMaterial, 'emissiveMap', eyeEmissiveSrc, {
    colorSpace: THREE.SRGBColorSpace,
    wrap: true,
  });

  useEffect(() => {
    eyeMaterial.roughness = eyeRoughState === 'loaded' ? 1.0 : 0.04;
    if (eyeEmissiveState === 'loaded') {
      eyeMaterial.emissive.set('#ffffff');
      eyeMaterial.emissiveIntensity = 1.35;
    } else {
      eyeMaterial.emissive.set('#000000');
      eyeMaterial.emissiveIntensity = 0;
    }
    eyeMaterial.needsUpdate = true;
  }, [eyeMaterial, eyeRoughState, eyeEmissiveState]);

  const lashesTexSrc =
    parts?.lashes?.texture ??
    manifest?.eye?.lashesTexture ??
    (packMode ? '/assets/preset-pack/textures/lashes/lashes.webp' : '/assets/mo2/eyes/eyelashes.webp');
  const lashesTexState = useMaterialTexture(lashesMaterial, 'map', lashesTexSrc, {
    colorSpace: THREE.SRGBColorSpace,
    wrap: true,
  });
  useMaterialTexture(lashesMaterial, 'normalMap', parts?.lashes?.normalTexture, {});

  /* The mouth is skin, not a decal: it is the same surface as the face around
     it and moves with the same jaw. Without the patch the lips stay matte
     while the cheek beside them scatters, and the seam reads as a mask edge. */
  const mouthMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: skinColor,
        roughness: skinRoughness,
        metalness: 0.0,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    applySkinGloss(mouthMaterial, skinGloss, skinSss, skinSheen);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- creation-time
    // only: the live effect below keeps the uniforms current.
  }, [mouthMaterial]);

  useEffect(() => {
    updateSkinGloss(mouthMaterial, skinGloss, skinSss, skinSheen);
  }, [mouthMaterial, skinGloss, skinSss, skinSheen]);

  /* UBE's mouth UVs run u ≈ 4.0–5.0 and the brows span u ≈ −0.1–1.07, so both
     tile — with a clamp every out-of-range sample collapses to the atlas edge
     and the part paints a smeared band. */
  const mouthTexState = useMaterialTexture(
    mouthMaterial,
    'map',
    parts?.mouth?.texture ?? (packMode ? undefined : '/assets/mo2/mouth/mouthmap.webp'),
    { colorSpace: THREE.SRGBColorSpace, wrap: true },
  );
  useMaterialTexture(mouthMaterial, 'normalMap', parts?.mouth?.normalTexture, { wrap: true });

  const browsMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a1412',
        roughness: 0.9,
        metalness: 0.0,
        transparent: true,
        alphaTest: 0,
        alphaToCoverage: false,
        depthWrite: false,
        forceSinglePass: true,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const browsTexState = useMaterialTexture(
    browsMaterial,
    'map',
    parts?.brows?.texture ?? (packMode ? undefined : '/assets/mo2/brows/femalebrow.webp'),
    { colorSpace: THREE.SRGBColorSpace, wrap: true },
  );

  useEffect(() => {
    if (browsTexState !== 'loaded' || !browsMaterial.map) return;
    try {
      prepareBrowTexture(browsMaterial.map);
      onDirty();
    } catch (error) {
      // Keep the loaded atlas if canvas processing is unavailable.
      console.error('[HeadModel] Failed to prepare brow tint:', error);
    }
  }, [browsMaterial, browsTexState, onDirty]);

  useEffect(() => {
    lashesMaterial.color.set(lashesColor);
    lashesMaterial.opacity = lashesOpacity;
    onDirty();
  }, [lashesMaterial, lashesColor, lashesOpacity, onDirty]);

  useEffect(() => {
    browsMaterial.color.set(browColor || '#1a1412');
    browsMaterial.opacity = browOpacity;
    const totalGloss = Math.min(1, browGloss * 0.7 + browGlossy * 0.3);
    browsMaterial.roughness = Math.max(0.08, 0.95 - totalGloss * 0.75);
    browsMaterial.needsUpdate = true;
  }, [browsMaterial, browsTexState, browColor, browOpacity, browGloss, browGlossy]);
  useMaterialTexture(browsMaterial, 'normalMap', parts?.brows?.normalTexture, { wrap: true });

  const bodyMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: skinColor,
        roughness: skinRoughness,
        metalness: 0.0,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* The unskinned fallback body is the same skin as the face above it, so it
     takes the same patch. Created here and kept current alongside the head and
     neck in the live effect below — patching it here but updating it nowhere
     else would leave the chest on the first frame's gloss. */
  useEffect(() => {
    applySkinGloss(bodyMaterial, skinGloss, skinSss, skinSheen);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- creation-time
    // only: the live effect below keeps the uniforms current.
  }, [bodyMaterial]);

  useEffect(() => {
    updateSkinGloss(bodyMaterial, skinGloss, skinSss, skinSheen);
  }, [bodyMaterial, skinGloss, skinSss, skinSheen]);

  /* One shared pore tile, pushed into every skin material. Slider moves only
     rewrite strength/scale uniforms; the tile is keyed on the skin URL, so it
     is generated once and disposed with that URL. The neck shares the head's
     atlas, so it takes the tile full strength; mouth and body sit away from
     the cheek crop and take it attenuated. */
  useEffect(() => {
    // ponytail: atlas-density estimates; use authored texel density for exact pore size.
    updateSkinDetail(headMaterial, skinDetailTex, skinDetail, 8);
    updateSkinDetail(neckMaterial, skinDetailTex, skinDetail, 32);
    updateSkinDetail(mouthMaterial, skinDetailTex, skinDetail * 0.5, 8);
    updateSkinDetail(bodyMaterial, skinDetailTex, skinDetail * 0.5, 32);
  }, [skinDetailTex, skinDetail, headMaterial, neckMaterial, mouthMaterial, bodyMaterial]);

  useEffect(() => {
    headMaterial.color.set(skinColor);
    neckMaterial.color.set(skinColor);
    bodyMaterial.color.set(skinColor);
    mouthMaterial.color.set(skinColor);
    headMaterial.needsUpdate = true;
    neckMaterial.needsUpdate = true;
    bodyMaterial.needsUpdate = true;
    mouthMaterial.needsUpdate = true;
  }, [skinColor, headMaterial, neckMaterial, bodyMaterial, mouthMaterial]);

  useEffect(() => {
    bodyMaterial.normalScale.set(skinNormalStrength, skinNormalStrength);
    bodyMaterial.needsUpdate = true;
  }, [skinNormalStrength, bodyMaterial]);

  const bodyTexUrl =
    parts?.body?.texture ??
    manifest?.body?.texture ??
    (packMode
      ? (manifest?.textures?.body ?? '/assets/preset-pack/textures/body/diamond_body.webp')
      : '/assets/mo2/body/femalebody.webp');
  const bodyNormalUrl =
    parts?.body?.normalTexture ??
    manifest?.body?.normalTexture ??
    (packMode
      ? (manifest?.textures?.bodyNormal ?? '/assets/preset-pack/textures/body/diamond_body_n.png')
      : '/assets/mo2/body/femalebody_n.webp');
  const bodyRoughUrl =
    parts?.body?.roughnessTexture ??
    manifest?.body?.roughnessTexture ??
    manifest?.textures?.bodyRoughness ??
    '/assets/preset-pack/textures/body/diamond_body_rough.webp';
  const bodyTexState = useMaterialTexture(bodyMaterial, 'map', bodyTexUrl, {
    colorSpace: THREE.SRGBColorSpace,
    wrap: true,
  });
  useMaterialTexture(bodyMaterial, 'normalMap', bodyNormalUrl, { wrap: true });
  useMaterialTexture(bodyMaterial, 'roughnessMap', bodyRoughUrl, { wrap: true });
  /* The body, hands and feet are one character over one selected atlas. This
     override is why a prebaked limb cannot paint its own baked-in material:
     every `skin` slot on the three takes the body selection, and a missing
     normal map falls back to the same stable, already-validated body normal
     rather than to nothing. The gloss mask rides the same override so a limb
     cannot end up with the torso's roughness. */
  const bodySkinOverride = useMemo(
    () => ({ texture: bodyTexUrl, normalTexture: bodyNormalUrl, roughnessTexture: bodyRoughUrl }),
    [bodyTexUrl, bodyNormalUrl, bodyRoughUrl],
  );
  /* Stable identity for the same reason as `clothingFallback`: `SkinnedPart`
     keys its texture/material effect on these objects, and an inline literal
     would reload every map on every parent render. */
  const bodyNormalFallback = useMemo(() => ({ skin: bodyNormalUrl }), [bodyNormalUrl]);
  const bodyRoughnessFallback = useMemo(() => ({ skin: bodyRoughUrl }), [bodyRoughUrl]);

  /* One shared flat-grey material for every part whose atlas the pack did not
     supply: unlit, so a texture-less shape reads as a deliberate placeholder
     rather than a white or black silhouette. Translucent and blending, because
     hair is card geometry with no alpha test available — an opaque stand-in
     would be a solid slab that hides the head behind it. Disposed once. */
  const flatGrey = useMemo(
    () => new THREE.MeshBasicMaterial({
      color: '#8a8a8a',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
    [],
  );
  useEffect(() => () => flatGrey.dispose(), [flatGrey]);

  /* The head is the one part that must never be see-through: `flatGrey` is
     translucent so a texture-less hair card does not become an opaque slab,
     but painting it on the head turned a head whose atlas is absent (the
     `FemaleHeadNord` export, whose UVs do not fit the UBE atlas) into a ghost
     you could read the neck through. A dedicated stand-in gives that face a
     solid surface while still reading as untextured — lit rather than unlit,
     because an unlit grey silhouette hides the very sculpt the preset is
     there to show. */
  const flatGreyOpaque = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: '#9a9a9a', roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
    }),
    [],
  );
  useEffect(() => () => flatGreyOpaque.dispose(), [flatGreyOpaque]);

  useEffect(() => {
    onReady({ rig, headBuild });
  }, [rig, headBuild, onReady]);

  /* ── "show it yet?" ───────────────────────────────────────────────
     Three independent waits, all of which used to be visible as a bare or
     procedural head while they resolved:

       manifest  — the mesh URL is not even known until it arrives
       geometry  — `useMeshGeometry` returns null the instant a URL changes,
                   so every head swap would flash the procedural fallback
       albedo    — the direct atlas load and the projected bake are both
                   asynchronous

     Only the *first* load waits on the albedo. Once a face is on screen a
     skin change swaps it in place (`faceTex` keeps the old one until the new
     bake resolves), so re-veiling there would be a pointless black flash. */
  /* Two different questions:

       settled — is the wait over? A failed or absent atlas ends the spinner;
                 otherwise a broken pack URL would hold the veil until the
                 20 s failsafe for no reason.
       painted — is there an actual atlas on the head? Legacy tolerates an
                 unstyled head; pack mode draws the untextured head in flat
                 grey, so a missing atlas no longer hides the character. */
  const [albedoShown, setAlbedoShown] = useState(false);
  const headPainted = isReal ? headMapState === 'loaded' : Boolean(faceTex);
  useEffect(() => {
    if (headPainted) setAlbedoShown(true);
    /* A real mesh the pack gave no skin for, or whose atlas failed, has no
       callback left to fire: settle on the known failure instead of spinning. */
    else if (isReal && (!skinSrc || headMapState === 'failed')) setAlbedoShown(true);
  }, [headPainted, isReal, skinSrc, headMapState]);

  /* A failed mesh fetch settles too: otherwise the veil would wait for the
     failsafe on a resource that will never arrive.

     The limbs take part in the same wait: a pair that has only half arrived is
     not drawable, so revealing before it settles would show a body with its
     hands and feet missing. A pack that does not author them reports settled
     immediately (there is no URL to wait for). */
  const geometryReady =
    (!manifest?.headMesh?.meshUrl || Boolean(realMesh) || headResource.settled) &&
    bodyResource.settled &&
    handsResource.settled &&
    feetResource.settled;
  /* Deliberately not gated on `Boolean(manifest)`: with no archive the head is
     procedural and the bake is too, and both settle through the same two
     waits above. Requiring the manifest would make an unavailable install
     unable to ever be ready, so the veil could only end on the failsafe. */
  const settled = geometryReady && albedoShown;
  /* Pack mode draws the packed head as soon as its geometry is there. An
     absent or failed skin atlas no longer hides the whole character: the head
     swaps to the flat-grey stand-in below, so the user still sees the mesh
     they selected. */
  const visible = packMode ? Boolean(realMesh) : settled;

  /* The head keeps its standard material for a textured skin; while pack mode
     has no atlas on it, the whole head mesh draws with the opaque stand-in.
     Restoring the original material on cleanup means a later texture load
     simply swaps back without leaving the rig's mesh pointing at a disposed
     stand-in. Only switch to stand-in if there is genuinely no skin or it failed,
     never while a newly picked skin texture is loading in the background. */
  const headUntextured = packMode && isReal && (!skinSrc || headMapState === 'failed');
  useEffect(() => {
    if (!headUntextured) return;
    const original = rig.mesh.material;
    rig.mesh.material = flatGreyOpaque;
    return () => {
      rig.mesh.material = original;
    };
  }, [rig, headUntextured, flatGreyOpaque]);

  /* Surface why the pack cannot draw a head, so the parent can say so rather
     than leave a silent empty viewport. A missing atlas is not an issue any
     more — it renders grey — so only geometry failures are reported.

     A limb whose pair failed earns the same treatment: the renderer draws
     nothing for it, and the user needs to know that is a pack problem rather
     than their eyes. An absent limb (no URL at all) is not an issue. */
  const limbIssue = handsResource.error ?? feetResource.error;
  const packIssue =
    !packMode
      ? null
      : headResource.error
        ? headResource.error
        : headResource.settled && !realMesh
          ? 'head mesh is missing from the preset pack'
          : limbIssue;
  useEffect(() => {
    onIssue?.(packIssue);
  }, [packIssue, onIssue]);

  useEffect(() => {
    onAssetsReady?.(settled);
  }, [settled, onAssetsReady]);

  /* ── pose the facial rig + weight coupling ─────────────────────────
     The facial bones are a function of (sliders, gizmo poses, advanced
     anatomy), weight and the link toggle. Subscribing to those in the render
     body re-rendered the whole character tree on every pointer move; instead
     the write path is an imperative store subscription that coalesces any
     number of writes into exactly one pose application per animation frame.
     The body skeleton itself is *not* re-posed here: that is the pose effect
     above and `AnimationDirector`'s mixer.

     `applyRigPose` is the full pass, not just the active region: every region
     and the weight coupling are rewritten from scratch, so an undo, a head
     swap (new rig) or a preset apply restores all of them rather than leaving
     whatever the previous rig held. */
  const applyRigPose = useCallback(() => {
    const s = useCharacter.getState();
    for (const rid of Object.keys(REGIONS_BY_ID) as RegionId[]) {
      const values = s.anatomyMode === 'advanced'
        ? anatomySliderBank(rid, s.anatomy, s.sliders[rid])
        : s.sliders[rid];
      for (const key of rig.regionBoneKeys[rid]) {
        poseRegionBone(rig, key, rid, SLIDER_DEFS, values, s.poses[rid]);
      }
    }
    applyCreationEngineWeight(rig, s.weight, s.linkFaceToWeight);
    rig.root.updateMatrixWorld(true);
    onDirty();
  }, [rig, onDirty]);

  useEffect(() => {
    applyRigPose();
    let pending = false;
    let frame = 0;
    const schedule = () => {
      if (pending) return;
      pending = true;
      frame = requestAnimationFrame(() => {
        pending = false;
        frame = 0;
        applyRigPose();
      });
    };
    /* One subscription, one coalesced frame per burst of writes. The rig
       identity is in this effect's key, so a head swap tears the listener
       down and applies the full banks to the new rig immediately. */
    const unsubscribe = useCharacter.subscribe((state, prev) => {
      if (
        state.sliders !== prev.sliders
        || state.poses !== prev.poses
        || state.anatomy !== prev.anatomy
        || state.anatomyMode !== prev.anatomyMode
        || state.weight !== prev.weight
        || state.linkFaceToWeight !== prev.linkFaceToWeight
      ) schedule();
    });
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [applyRigPose]);

  /* A remounted rig (new head mesh) has fresh bones at their bind pivots; the
     effect above runs for it because `applyRigPose` is keyed on `rig`. */

  /* A part with geometry is never withheld: pack mode draws its own material
     once its atlas is on the GPU, and the flat grey stand-in until then (or
     for good, when the pack supplied none). Legacy keeps its old behaviour and
     simply draws the material without a map. */
  const partMaterial = (state: TextureState, material: THREE.Material) =>
    packMode && state !== 'loaded' ? flatGrey : material;

  return (
    <group ref={characterRef} name="character" visible={visible}>
      {/* The skeleton is a scene graph, not a drawn object: bones are visible
          only as `SkinnedMesh` inputs.

          `rig.root` is driven from the head bone's world matrix (see the pose
          effect), and the facial part meshes are rendered *inside* it: the
          eyes, lashes, brows and mouth are authored in the same head-centred
          frame as the head, so they have to ride the same head transform. At
          rest that transform is the identity, so nesting changes nothing. */}
      <primitive object={skeletonRegistry.group} />
      {/* Must precede BodyPhysics: the director writes the pose (priority -1),
          then BodyPhysics settles soft-body bones on top of it (priority 0). */}
      <AnimationDirector
        registry={skeletonRegistry}
        rigRoot={rig.root}
        poseClip={poseClip}
        poseId={bodyPoseId}
        onAfterFrame={followAnimatedFrame}
      />
      <BodyPhysics registry={skeletonRegistry} />
      <SecondaryPhysics registry={skeletonRegistry} />
      {/* Facial companions are authored against the UBE head's exact vertex
          layout: the eyes sit in sockets that exist only on that face, and the
          lashes/brows/mouth follow its contours. On an imported head they would
          float at the old coordinates, so they are withheld rather than shown
          in the wrong place — the imported mesh is whole on its own. */}
      <primitive object={rig.root}>
        {!importedHead && mouthGeo && (
          <mesh name="Mouth" geometry={mouthGeo} material={partMaterial(mouthTexState, mouthMaterial)} renderOrder={1} />
        )}
        {!importedHead && eyeGeo && (
          <mesh
            name="Eyes"
            geometry={eyeGeo}
            position={eyeAlignOffset}
            material={eyeTexState === 'loaded' ? eyeMaterial : eyeFallbackMaterial}
            renderOrder={2}
          />
        )}
        {!importedHead && lashesGeo && (
          <mesh name="Lashes" geometry={lashesGeo} material={partMaterial(lashesTexState, lashesMaterial)} renderOrder={3} />
        )}
        {!importedHead && browsMesh && (
          <primitive object={browsMesh} material={partMaterial(browsTexState, browsMaterial)} dispose={null} />
        )}
      </primitive>
      {bodyGeo && bodyMesh ? (
        bodyMesh.bones?.length || autoRigUnskinned ? (
          <SkinnedPart
            key="body"
            name="Body"
            mesh={bodyMesh}
            registry={skeletonRegistry}
            rigDonor={bodyMesh}
            /* The baked body JSON carries no material groups — it is one skin
               shape over the body atlas — so without an explicit role it would
               inherit `SkinnedPart`'s hair default and draw translucent with a
               0.35 alpha test. */
            defaultRole="skin"
            fallbackTexture={bodyTexUrl}
            fallbackNormalByRole={bodyNormalFallback}
            fallbackRoughnessByRole={bodyRoughnessFallback}
            skinOverride={bodySkinOverride}
            skinColor={skinColor}
            skinDetailMap={skinDetailTex}
            skinDetail={skinDetail}
            renderOrder={0}
            weight={weight}
          />
        ) : (
          <mesh name="Body" geometry={bodyGeo} material={partMaterial(bodyTexState, bodyMaterial)} renderOrder={0} />
        )
      ) : packMode || hasBodywear ? null : (
        <>
          {/* Procedural fallback only. This branch never draws alongside a body
              mesh — the arms above are exclusive — so the neck cannot double up
              with `bodyGeo`. It does sit inside the collar here (the collar
              tops out at y = −0.205, the neck bottoms at −0.5), which is
              intended: the collar is a garment the neck belongs inside, and the
              neck's lower half is hidden by it rather than poking through. */}
          <mesh geometry={neckGeo} material={neckMaterial} />
          <mesh geometry={torsoGeo} material={torsoMaterial} />
        </>
      )}
      {/* Hands and feet: their own static prebaked `_0`/`_1` pairs over the same
          body atlas, skinned to the same shared skeleton as the torso. They
          have no synthetic stand-in — an un-authored or half-loaded pair draws
          nothing rather than a proxy shape — and their `skin` slots take the
          body selection even if the baked asset named its own material. */}
      {handsMesh && !hasHandwear && (
        <SkinnedPart
          key="hands"
          name="Hands"
          mesh={handsMesh}
          registry={skeletonRegistry}
          rigDonor={bodyMesh ?? undefined}
          defaultRole="skin"
          fallbackTexture={bodyTexUrl}
          fallbackNormalByRole={bodyNormalFallback}
          fallbackRoughnessByRole={bodyRoughnessFallback}
          skinOverride={bodySkinOverride}
          skinColor={skinColor}
          skinDetailMap={skinDetailTex}
          skinDetail={skinDetail}
          renderOrder={0}
          weight={weight}
        />
      )}
      {feetMesh && !hasFootwear && (
        <SkinnedPart
          key="feet"
          name="Feet"
          mesh={feetMesh}
          registry={skeletonRegistry}
          rigDonor={bodyMesh ?? undefined}
          defaultRole="skin"
          fallbackTexture={bodyTexUrl}
          fallbackNormalByRole={bodyNormalFallback}
          fallbackRoughnessByRole={bodyRoughnessFallback}
          skinOverride={bodySkinOverride}
          skinColor={skinColor}
          skinDetailMap={skinDetailTex}
          skinDetail={skinDetail}
          renderOrder={0}
          weight={weight}
        />
      )}
      {/* The outfit's embedded body is always drawn; only the garment shapes
          follow the toggle. Missing garment atlases hide just those shapes. */}
      {clothingMeshSelection && clothingResource.mesh && parts?.clothing && !equipped.some((g) => g.slot === 'outfit' || g.slot === 'top' || g.slot === 'chest' || g.slot === 'bottom') && (
        clothingResource.mesh.bones?.length || autoRigUnskinned ? (
          <SkinnedPart
            key="clothing"
            name="Clothing"
            mesh={clothingResource.mesh}
            registry={skeletonRegistry}
            rigDonor={bodyMesh ?? undefined}
            defaultRole="clothing"
            fallbackByRole={clothingFallback}
            fallbackNormalByRole={clothingNormalFallback}
            hiddenRoles={clothingHiddenRoles}
            skinColor={skinColor}
            skinDetailMap={skinDetailTex}
            skinDetail={skinDetail}
            renderOrder={0}
            weight={weight}
          />
        ) : (
          <AuthoredPart
            key="clothing"
            name="Clothing"
            mesh={clothingResource.mesh}
            defaultRole="clothing"
            fallbackByRole={clothingFallback}
            fallbackNormalByRole={clothingNormalFallback}
            skinColor={skinColor}
            skinDetailMap={skinDetailTex}
            skinDetail={skinDetail}
            hiddenRoles={clothingHiddenRoles}
            renderOrder={0}
          />
        )
      )}
      {/* One garment per worn equipment slot. Each piece is its own NIF over
          its own atlases and its own `_0`/`_1` pair, so it blends with the
          body weight exactly like the torso and limbs. Its embedded body shape
          is hidden whenever the standalone body is drawn: several armour sets
          repeat that shape in every piece, and drawing them all would stack
          three bodies inside one another. */}
      {equipped.map((garment) => (
        <EquippedGarment
          key={`equip:${garment.slot || garment.label || garment.rel}`}
          part={garment}
          registry={skeletonRegistry}
          rigDonor={bodyMesh ?? undefined}
          weight={weight}
          hiddenRoles={equipmentHiddenRoles}
          hideEmbeddedBody={true}
          fallbackByRole={clothingFallback}
          fallbackNormalByRole={clothingNormalFallback}
          fallbackRoughnessByRole={bodyRoughnessFallback}
          skinOverride={bodySkinOverride}
          skinColor={skinColor}
          skinDetailMap={skinDetailTex}
          skinDetail={skinDetail}
          renderOrder={0}
        />
      ))}
      {showScalp && <HairlineUnderlay rigRoot={rig?.root} hair={hair} renderOrder={5} />}
      {hairParts.map((part, index) => {
        if (part.meshUrl?.endsWith('.glb')) {
          return (
            <GlbHairPart
              key={`hair:glb:${part.id || part.meshUrl || index}`}
              url={part.meshUrl}
              rigRoot={rig?.root}
              hair={hairSettings}
              showScalp={showScalp}
              renderOrder={6 + index}
            />
          );
        }
        return (
          <EquippedHairPart
            key={`hair:${part.id || part.meshUrl || index}`}
            part={part}
            registry={skeletonRegistry}
            rigDonor={bodyMesh ?? undefined}
            rigRoot={rig?.root}
            defaultRole="hair"
            fallbackTexture={hairSrc}
            fallbackNormalByRole={hairNormalFallback}
            hair={hairSettings}
            renderOrder={6 + index}
          />
        );
      })}
      {!importedHead && <MeshOverlay rig={rig} headBuild={headBuild} />}
      {!importedHead && <FaceGizmo rig={rig} />}
    </group>
  );
}
