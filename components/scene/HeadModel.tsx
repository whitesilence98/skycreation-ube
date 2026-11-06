'use client';

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import {
  buildHeadGeometry,
  buildNeckGeometry,
  buildTorsoGeometry,
  type HeadBuild,
} from '@/lib/head/geometry';
import { createRig, poseRegionBone, verifyRigWiring, type Rig } from '@/lib/head/rig';
import {
  buildDetailTexture,
  buildFaceTexture,
  buildProjectedNormal,
  type FaceTextureResult,
  type Mo2Manifest,
} from '@/lib/head/faceTexture';
import { convertUrl } from '@/lib/mo2/client';
import { loadMask, type OverlayInput } from '@/lib/head/overlayLayers';
import { SLIDER_DEFS, REGIONS_BY_ID } from '@/lib/regions';
import { useCharacter } from '@/lib/store';
import { MeshOverlay } from '@/components/scene/MeshOverlay';
import { FaceGizmo } from '@/components/scene/FaceGizmo';
import { AuthoredPart } from '@/components/scene/AuthoredPart';
import { SkinnedPart } from '@/components/scene/SkinnedPart';
import { SkeletonRegistry } from '@/lib/character/skeleton';
import { applyBodyPose, bodyPose } from '@/lib/character/poses';
import { lerpPositions, useMaterialTexture, useMeshGeometry, useMeshResource, type MaterialRole, type TextureState } from '@/components/scene/useMeshGeometry';
import { applySkinShader, updateSkinUniforms, skinParamsFromGloss } from '@/components/scene/SkinShader';

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

  const headMeshUrl = manifest?.headMesh?.meshUrl;
  const headResource = useMeshResource(headMeshUrl, 'head mesh');
  const realMesh = headResource.mesh;

  const fallbackHeadBuild = useMemo(() => buildHeadGeometry(), []);
  const headBuild = useMemo<HeadBuild>(() => {
    if (realMesh) {
      return {
        geometry: realMesh.geometry,
        basePositions: realMesh.positions,
        ringCount: 64,
        segmentCount: 64,
      };
    }
    // The procedural sculpt is a legacy offline stand-in; pack mode must not
    // pretend a head exists when the pack did not supply one.
    return fallbackHeadBuild;
  }, [realMesh, fallbackHeadBuild]);

  // ── real eye and eyelash meshes from MO2 ──────────────────────────
  const eyeMeshUrl = manifest?.eye?.meshUrl ?? (packMode ? undefined : '/assets/mo2/eyes/ube-eyesfemale.json');
  const lashesMeshUrl =
    parts?.lashes?.meshUrl ?? manifest?.eye?.lashesMeshUrl ?? (packMode ? undefined : '/assets/mo2/eyes/ube-lashes.json');
  const eyeGeo = useMeshGeometry(eyeMeshUrl, 'eye')?.geometry ?? null;
  const lashesGeo = useMeshGeometry(lashesMeshUrl, 'lashes')?.geometry ?? null;

  // ── real mouth, brows and body meshes from MO2 ────────────────────
  const mouthMeshUrl = parts?.mouth?.meshUrl ?? (packMode ? undefined : '/assets/mo2/mouth/ube-mouth.json');
  const browsMeshUrl = parts?.brows?.meshUrl ?? (packMode ? undefined : '/assets/mo2/brows/ube-brows.json');
  const bodyMeshUrl =
    parts?.body?.meshUrl ?? manifest?.body?.meshUrl ?? (packMode ? undefined : '/assets/mo2/body/ube-body.json');
  const mouthGeo = useMeshGeometry(mouthMeshUrl, 'mouth')?.geometry ?? null;
  const browsGeo = useMeshGeometry(browsMeshUrl, 'brows')?.geometry ?? null;

  /* ── body weight ──────────────────────────────────────────────────
     A `_0`/`_1` pair is two meshes over one atlas, exactly as in Skyrim. When
     the producer measured a pair the resolved body carries both URLs; both are
     fetched and the rendered position attribute is lerped as the slider moves.
     A body with no pair keeps the single mesh and no slider.

     When a pair exists, `_1` (the manifest's `meshUrl`) *is* the body: the pair
     fetch below already holds it, so the single-body fetch is skipped rather
     than downloading and decoding the same 20k-vertex mesh twice. */
  const weightVariants = parts?.body?.weightVariants;
  const weight0 = useMeshResource(weightVariants?.w0, 'body weight 0');
  const weight1 = useMeshResource(weightVariants?.w1, 'body weight 1');
  const bodyResource = useMeshResource(weightVariants ? undefined : bodyMeshUrl, 'body');
  const bodyMesh = weightVariants ? weight1.mesh : bodyResource.mesh;
  const bodyGeo = bodyMesh?.geometry ?? null;
  const weight = useCharacter((s) => s.weight);
  useEffect(() => {
    if (!bodyGeo || !weight0.mesh || !weight1.mesh) return;
    const attr = bodyGeo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const blended = lerpPositions(
      weight0.mesh.positions,
      weight1.mesh.positions,
      weight,
      attr.array as Float32Array,
    );
    if (blended !== attr.array) attr.array = blended;
    attr.needsUpdate = true;
    // Endpoints and every intermediate point move, so the bounds must follow.
    bodyGeo.computeBoundingSphere();
    bodyGeo.computeBoundingBox();
  }, [bodyGeo, weight0.mesh, weight1.mesh, weight]);

  // Authored hair/outfit: their own shapes and material arrays.
  const hairMeshUrl = parts?.hair?.meshUrl;
  const hairResource = useMeshResource(hairMeshUrl, 'hair mesh');
  const hairAuthored = hairResource.mesh;
  const clothingMeshUrl = parts?.clothing?.meshUrl;
  const clothingResource = useMeshResource(clothingMeshUrl, 'clothing mesh');
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
  const garmentVisible = useCharacter((s) => s.garmentVisible);
  const clothingHiddenRoles = useMemo(() => {
    const hidden: MaterialRole[] = [];
    if (garmentVisible === false) hidden.push('clothing', 'accessory');
    if (bodyGeo && clothingHasEmbeddedBody) hidden.push('skin');
    return hidden;
  }, [garmentVisible, bodyGeo, clothingHasEmbeddedBody]);
  const neckGeo = useMemo(() => buildNeckGeometry(), []);
  const torsoGeo = useMemo(() => buildTorsoGeometry(), []);

  const rig = useMemo(() => createRig(headBuild.geometry), [headBuild.geometry]);

  /* ── the pack skeleton ────────────────────────────────────────────
     One registry for the whole character. Every skinned part registers its own
     bone names against it, so the outfit, the embedded body and the hairstyle
     all resolve their weights to the same `THREE.Bone` objects — a pose must
     move them together, and separate bone sets would drift apart. */
  const skeletonRegistry = useMemo(() => new SkeletonRegistry('head'), []);
  const bodyPoseId = useCharacter((s) => s.bodyPoseId);

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
  useEffect(() => {
    if (skeletonRegistry.byName.size === 0) return;
    applyBodyPose(skeletonRegistry, bodyPose(bodyPoseId));

    const rest = skeletonRegistry.restWorld('NPC Head [Head]');
    const bone = skeletonRegistry.byName.get('NPC Head [Head]');
    if (rest && bone) {
      /* `bone.matrixWorld` is in scene space; the rig hangs off the character
         group, so the skeleton group's own world matrix is removed first. Both
         are identity in practice, but doing it properly keeps the rig correct
         if the character is ever placed under a transformed node. */
      const follow = skeletonRegistry.group.matrixWorld.clone().invert();
      follow.multiply(bone.matrixWorld).multiply(rest.invert());
      rig.root.matrixAutoUpdate = false;
      rig.root.matrix.copy(follow);
      rig.root.updateMatrixWorld(true);
    } else {
      rig.root.matrixAutoUpdate = true;
      rig.root.matrix.identity();
      rig.root.updateMatrixWorld(true);
    }
    onDirty();
  }, [skeletonRegistry, bodyPoseId, rig, bodyMesh, clothingResource.mesh, hairResource.mesh, onDirty]);

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

  const activeRegion = useCharacter((s) => s.activeRegion);
  const sliders = useCharacter((s) => s.sliders);
  const poses = useCharacter((s) => s.poses);
  const overlayLayers = useCharacter((s) => s.overlayLayers);

  /* Each tintmask is a catalogue id; the route serves it as a greyscale mask.
     Loading them here rather than inside the bake keeps `buildFaceTexture`
     a pure decode → composite → project step with no network in the middle. */
  const overlayKey = useMemo(
    () => overlayLayers.map((l) => `${l.kind}:${l.id}:${l.color}:${l.opacity}`).join('|'),
    [overlayLayers],
  );
  const [overlayImages, setOverlayImages] = useState<OverlayInput[]>([]);
  useEffect(() => {
    if (!overlayLayers.length) {
      setOverlayImages([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      overlayLayers.map(async (layer) => ({
        layer,
        mask: await loadMask(convertUrl({ kind: layer.kind, id: layer.id, mode: 'alpha' })),
      })),
    ).then((loaded) => {
      if (!cancelled) setOverlayImages(loaded);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the
    // serialised stack; the array identity changes on every store write.
  }, [overlayKey]);

  const skinSrc = manifest?.textures?.skin;
  const skinNormalSrc = manifest?.textures?.normal;
  const eyeSrc = manifest?.textures?.eye;
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
  const hairSettings = useCharacter((s) => s.hair);
  const skinGloss = useCharacter((s) => s.skinGloss);
  const skinRoughness = Math.max(0.14, 0.65 - skinGloss * 0.46);

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

  // Apply ENB-calibrated skin shader once per material instance
  useEffect(() => {
    applySkinShader(headMaterial, skinParamsFromGloss(skinGloss));
    applySkinShader(neckMaterial, skinParamsFromGloss(skinGloss));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headMaterial, neckMaterial]);
  const headMapState = useMaterialTexture(
    headMaterial,
    'map',
    isReal ? skinSrc : undefined,
    { colorSpace: THREE.SRGBColorSpace },
  );
  useMaterialTexture(headMaterial, 'normalMap', isReal ? skinNormalSrc : undefined, {});

  useEffect(() => {
    if (isReal) {
      headMaterial.color.set('#ffffff');
      headMaterial.roughness = skinRoughness;
      headMaterial.metalness = 0.0;
      headMaterial.normalScale.set(1.0, 1.0);
      headMaterial.needsUpdate = true;
      return;
    }
    if (!faceTex) return;
    headMaterial.map = faceTex.texture;
    headMaterial.color.set('#ffffff');
    headMaterial.roughness = skinRoughness;
    headMaterial.metalness = 0.0;
    const normal = skinNormal ?? detailTex;
    headMaterial.normalMap = normal ?? null;
    const ns = skinNormal ? 1.0 : 0.34;
    headMaterial.normalScale.set(ns, ns);
    headMaterial.needsUpdate = true;
  }, [faceTex, detailTex, skinNormal, headMaterial, isReal, skinRoughness]);

  const neckMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#cbb19d', roughness: skinRoughness, metalness: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    neckMaterial.roughness = skinRoughness;
    if (isReal) {
      /* The neck borrows the head atlas the hook loaded; it is the same skin
         and the same draw, so it must never keep a stale legacy face bake. */
      neckMaterial.map = headMapState === 'loaded' ? headMaterial.map : null;
      neckMaterial.color.set('#ffffff');
      neckMaterial.needsUpdate = true;
      return;
    }
    if (!faceTex) return;
    neckMaterial.map = faceTex.texture;
    neckMaterial.color.set('#cfc6bf');
    neckMaterial.needsUpdate = true;
  }, [faceTex, neckMaterial, isReal, headMapState, headMaterial, skinRoughness]);

  // Live-update SSS uniforms when GLOSS slider changes (no recompile needed)
  useEffect(() => {
    updateSkinUniforms(headMaterial, skinParamsFromGloss(skinGloss));
    updateSkinUniforms(neckMaterial, skinParamsFromGloss(skinGloss));
  }, [skinGloss, headMaterial, neckMaterial]);

  const torsoMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#2c3329',
        roughness: 0.94,
        metalness: 0.02,
      }),
    [],
  );

  const eyeMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.12,
        metalness: 0.0,
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
        depthWrite: true,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const eyeTexState = useMaterialTexture(eyeMaterial, 'map', eyeSrc, {
    colorSpace: THREE.SRGBColorSpace,
    wrap: true,
  });

  const lashesTexSrc =
    parts?.lashes?.texture ?? manifest?.eye?.lashesTexture ?? (packMode ? undefined : '/assets/mo2/eyes/eyelashes.webp');
  const lashesTexState = useMaterialTexture(lashesMaterial, 'map', lashesTexSrc, {
    colorSpace: THREE.SRGBColorSpace,
    wrap: true,
  });

  const mouthMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.35,
        metalness: 0.0,
      }),
    [],
  );

  /* UBE's mouth UVs run u ≈ 4.0–5.0 and the brows span u ≈ −0.1–1.07, so both
     tile — with a clamp every out-of-range sample collapses to the atlas edge
     and the part paints a smeared band. */
  const mouthTexState = useMaterialTexture(
    mouthMaterial,
    'map',
    parts?.mouth?.texture ?? (packMode ? undefined : '/assets/mo2/mouth/mouthmap.webp'),
    { colorSpace: THREE.SRGBColorSpace, wrap: true },
  );

  const browsMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a1412',
        roughness: 0.9,
        metalness: 0.0,
        transparent: true,
        alphaTest: 0.15,
        depthWrite: true,
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

  const bodyMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: skinRoughness,
        metalness: 0.0,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    bodyMaterial.roughness = skinRoughness;
    bodyMaterial.needsUpdate = true;
  }, [bodyMaterial, skinRoughness]);

  const bodyTexUrl =
    parts?.body?.texture ?? manifest?.body?.texture ?? (packMode ? undefined : '/assets/mo2/body/femalebody.webp');
  const bodyNormalUrl =
    parts?.body?.normalTexture ??
    manifest?.body?.normalTexture ??
    (packMode ? undefined : '/assets/mo2/body/femalebody_n.webp');
  const bodyTexState = useMaterialTexture(bodyMaterial, 'map', bodyTexUrl, {
    colorSpace: THREE.SRGBColorSpace,
    wrap: true,
  });
  useMaterialTexture(bodyMaterial, 'normalMap', bodyNormalUrl, { wrap: true });

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
     failsafe on a resource that will never arrive. */
  const geometryReady =
    !manifest?.headMesh?.meshUrl || Boolean(realMesh) || headResource.settled;
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
     stand-in. */
  const headUntextured = packMode && isReal && headMapState !== 'loaded';
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
     more — it renders grey — so only geometry failures are reported. */
  const packIssue =
    !packMode
      ? null
      : headResource.error
        ? headResource.error
        : headResource.settled && !realMesh
          ? 'head mesh is missing from the preset pack'
          : null;
  useEffect(() => {
    onIssue?.(packIssue);
  }, [packIssue, onIssue]);

  useEffect(() => {
    onAssetsReady?.(settled);
  }, [settled, onAssetsReady]);

  // ── pose the skeleton whenever sliders or the gizmo change ──────
  useEffect(() => {
    const defs = SLIDER_DEFS;
    /* Every region owns its own bone since `lips` stopped sharing `'Jaw'`, so
       one pass is complete. The extra pass for `activeRegion` existed only to
       let the active tab win the lips/jaw collision, and it had the side
       effect that merely switching tabs re-displaced the mouth. */
    for (const rid of Object.keys(REGIONS_BY_ID) as Array<keyof typeof REGIONS_BY_ID>) {
      for (const key of rig.regionBoneKeys[rid]) {
        poseRegionBone(rig, key, rid, defs, sliders[rid], poses[rid]);
      }
    }

    rig.root.updateMatrixWorld(true);
    onDirty();
  }, [rig, sliders, poses, onDirty]);

  /* A part with geometry is never withheld: pack mode draws its own material
     once its atlas is on the GPU, and the flat grey stand-in until then (or
     for good, when the pack supplied none). Legacy keeps its old behaviour and
     simply draws the material without a map. */
  const partMaterial = (state: TextureState, material: THREE.Material) =>
    packMode && state !== 'loaded' ? flatGrey : material;

  return (
    <group name="character" visible={visible}>
      {/* The skeleton is a scene graph, not a drawn object: bones are visible
          only as `SkinnedMesh` inputs.

          `rig.root` is driven from the head bone's world matrix (see the pose
          effect), and the facial part meshes are rendered *inside* it: the
          eyes, lashes, brows and mouth are authored in the same head-centred
          frame as the head, so they have to ride the same head transform. At
          rest that transform is the identity, so nesting changes nothing. */}
      <primitive object={skeletonRegistry.group} />
      <primitive object={rig.root}>
        {mouthGeo && (
          <mesh geometry={mouthGeo} material={partMaterial(mouthTexState, mouthMaterial)} renderOrder={1} />
        )}
        {eyeGeo && (
          <mesh geometry={eyeGeo} material={partMaterial(eyeTexState, eyeMaterial)} renderOrder={2} />
        )}
        {lashesGeo && (
          <mesh geometry={lashesGeo} material={partMaterial(lashesTexState, lashesMaterial)} renderOrder={3} />
        )}
        {browsGeo && (
          <mesh geometry={browsGeo} material={partMaterial(browsTexState, browsMaterial)} renderOrder={4} />
        )}
      </primitive>
      {bodyGeo && bodyMesh ? (
        bodyMesh.bones?.length ? (
          <SkinnedPart
            key="body"
            mesh={bodyMesh}
            registry={skeletonRegistry}
            /* The baked body JSON carries no material groups — it is one skin
               shape over the body atlas — so without an explicit role it would
               inherit `SkinnedPart`'s hair default and draw translucent with a
               0.35 alpha test. */
            defaultRole="skin"
            fallbackTexture={bodyTexUrl}
            fallbackNormalByRole={{ skin: bodyNormalUrl }}
            renderOrder={0}
          />
        ) : (
          <mesh geometry={bodyGeo} material={partMaterial(bodyTexState, bodyMaterial)} renderOrder={0} />
        )
      ) : packMode ? null : (
        <>
          <mesh geometry={neckGeo} material={neckMaterial} />
          <mesh geometry={torsoGeo} material={torsoMaterial} />
        </>
      )}
      {/* The outfit's embedded body is always drawn; only the garment shapes
          follow the toggle. Missing garment atlases hide just those shapes. */}
      {clothingResource.mesh && (
        clothingResource.mesh.bones?.length ? (
          <SkinnedPart
            key="clothing"
            mesh={clothingResource.mesh}
            registry={skeletonRegistry}
            defaultRole="clothing"
            fallbackByRole={clothingFallback}
            fallbackNormalByRole={clothingNormalFallback}
            hiddenRoles={clothingHiddenRoles}
            renderOrder={0}
          />
        ) : (
          <AuthoredPart
            key="clothing"
            mesh={clothingResource.mesh}
            defaultRole="clothing"
            fallbackByRole={clothingFallback}
            fallbackNormalByRole={clothingNormalFallback}
            hiddenRoles={clothingHiddenRoles}
            renderOrder={0}
          />
        )
      )}
      {hairAuthored && (
        hairAuthored.bones?.length ? (
          <SkinnedPart
            key="hair"
            mesh={hairAuthored}
            registry={skeletonRegistry}
            defaultRole="hair"
            fallbackTexture={hairSrc}
            fallbackNormalByRole={hairNormalFallback}
            hair={hairSettings}
            renderOrder={6}
          />
        ) : (
          <AuthoredPart
            key="hair"
            mesh={hairAuthored}
            defaultRole="hair"
            fallbackTexture={hairSrc}
            fallbackNormalByRole={hairNormalFallback}
            hair={hairSettings}
            renderOrder={6}
          />
        )
      )}
      <MeshOverlay rig={rig} headBuild={headBuild} />
      <FaceGizmo rig={rig} />
    </group>
  );
}
