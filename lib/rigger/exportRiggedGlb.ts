/**
 * lib/rigger/exportRiggedGlb.ts
 *
 * Rigged GLB Exporter — Phase 5 (final) of the CC-Kit Auto-Rigger pipeline.
 *
 * Takes the fitted skeleton, smoothed skin weights, and original mesh
 * geometry/materials, assembles them into a Three.js SkinnedMesh, and
 * exports a standards-compliant .glb file that works in:
 *
 *   • Blender 4.x (via standard glTF import)
 *   • Unity / Godot (Humanoid avatar, standard glTF skinning)
 *   • VRChat / VSeeFace (via VRMC_vrm 1.0 extension, optional)
 *   • Three.js / R3F (loads as SkinnedMesh natively)
 *
 * ─── Pipeline ────────────────────────────────────────────────────────────────
 *
 *   fitSkeletonToLandmarks()   →  FitResult
 *   transferWeights()          →  WeightTransferResult
 *   diffuseWeights()           →  DiffusionResult
 *   exportRiggedGlb()          →  .glb download         ← this file
 *
 * ─── GLB Post-processing ─────────────────────────────────────────────────────
 *
 *   After GLTFExporter emits the binary, two patches are applied to the
 *   raw JSON chunk without touching the BIN buffer:
 *
 *   1. KHR_materials_ior (ior = 1.0)
 *      Prevents Blender from adding phantom specular highlights on skin
 *      (Blender's Principled BSDF defaults to IOR = 1.5 when missing).
 *
 *   2. VRMC_vrm 1.0 humanoid extension  (optional, default: true)
 *      Maps each VRM bone name to its glTF node index so VRM-aware runtimes
 *      (VRChat, VSeeFace, three-vrm) can drive the humanoid avatar correctly.
 *
 * ─── Legal ───────────────────────────────────────────────────────────────────
 *
 *   glTF 2.0 is an open Khronos standard (CC-BY 4.0).
 *   VRM 1.0 is an open VRM Consortium standard (MIT).
 *   KHR_materials_ior is a ratified Khronos extension (public domain usage).
 *   No proprietary code is used or derived.
 *
 * Usage:
 *   import { exportRiggedGlb, createRiggedSkinnedMesh } from '@/lib/rigger/exportRiggedGlb';
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three-stdlib';
import type { FitResult }             from '@/lib/rigger/templateFitter';
import type { DiffusionResult }       from '@/lib/rigger/heatDiffusion';
import type { WeightTransferResult }  from '@/lib/rigger/weightTransfer';
import { buildVrmHumanoidExtension, isVrmBoneName, type VrmBoneName } from '@/lib/rigger/vrmSkeleton';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface RiggedExportOptions {
  /**
   * Display name for the character — written to the glTF root node and VRM meta.
   * Sanitised to alphanumerics + hyphens/underscores. Default: 'Character'.
   */
  name?: string;

  /**
   * Inject the VRMC_vrm 1.0 humanoid extension into the GLB.
   * Required for VRChat, VSeeFace, and three-vrm. Default: true.
   */
  includeVrmExtension?: boolean;

  /**
   * Inject KHR_materials_ior (ior = 1.0).
   * Default: false (Blender defaults to 1.5).
   */
  patchIor?: boolean;

  /**
   * Maximum texture size passed to GLTFExporter. Default: 4096.
   */
  maxTextureSize?: number;

  /**
   * Automatically trigger a browser download of the .glb file. Default: true.
   * Set to false to only return the ArrayBuffer (useful for preview/testing).
   */
  download?: boolean;

  /**
   * Optional VRM author name, written to the VRM meta block. Default: 'CC-Kit Auto-Rigger'.
   */
  vrmAuthor?: string;

  /**
   * Optional VRM license URL. Default: VRM Public License 1.0.
   */
  vrmLicenseUrl?: string;
}

/** Accepted weight source: either raw (from transferWeights) or smoothed (from diffuseWeights). */
export type WeightSource = WeightTransferResult | DiffusionResult;

// ─────────────────────────────────────────────────────────────────────────────
// 1. SkinnedMesh factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a fully-bound `THREE.SkinnedMesh` from a geometry, materials,
 * fitted skeleton, and computed skin weights.
 *
 * The returned mesh is ready for:
 *   • Viewport rendering (add to scene directly)
 *   • GLTFExporter export
 *   • Pose testing (animate `fitResult.built.bones`)
 *
 * The input `geometry` is cloned internally — the caller's geometry is never
 * mutated, so the original can still be used for further processing.
 *
 * @param geometry   Source mesh geometry (must have `position` attribute).
 * @param material   Material or array of materials for the mesh.
 * @param fitResult  Fitted skeleton from `fitSkeletonToLandmarks()`.
 * @param weights    Skin weights from `transferWeights()` or `diffuseWeights()`.
 * @param name       Mesh name written into the SkinnedMesh. Default: 'Body'.
 */
export function createRiggedSkinnedMesh(
  geometry:  THREE.BufferGeometry,
  material:  THREE.Material | THREE.Material[],
  fitResult: FitResult,
  weights:   WeightSource,
  name = 'Body',
): THREE.SkinnedMesh {
  // Clone geometry — we're about to add attributes to it
  const geo = geometry.clone();

  // Write skin attributes
  geo.setAttribute('skinIndex',  new THREE.BufferAttribute(new Uint16Array(weights.skinIndex),   4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(weights.skinWeight),  4));

  // Create the skinned mesh
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.name = name;
  mesh.castShadow    = true;
  mesh.receiveShadow = true;

  // Bind the skeleton: bones must already be in final world-space positions
  // (templateFitter called root.updateMatrixWorld before returning)
  fitResult.built.root.updateMatrixWorld(true);
  fitResult.built.skeleton.calculateInverses();
  mesh.bind(fitResult.built.skeleton, new THREE.Matrix4()); // identity bind matrix

  return mesh;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. GLB binary patching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * glTF 2.0 JSON structure — partial, only the fields we touch.
 */
interface GltfJson {
  asset?:          { version: string; generator?: string };
  extensionsUsed?: string[];
  extensions?:     Record<string, unknown>;
  materials?:      Array<{ extensions?: Record<string, unknown>; [k: string]: unknown }>;
  nodes?:          Array<{ name?: string; [k: string]: unknown }>;
  scenes?:         Array<{ nodes?: number[]; [k: string]: unknown }>;
  scene?:          number;
}

/**
 * Reconstructs a GLB binary from a modified JSON object + the original BIN chunk.
 * The BIN chunk is copied verbatim — only the JSON chunk is replaced.
 */
function repackGlb(json: GltfJson, originalGlb: ArrayBuffer): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  // JSON chunk must be 4-byte aligned; pad with spaces (0x20) per glTF spec
  const paddedLen = Math.ceil(encoded.length / 4) * 4;
  const padded = new Uint8Array(paddedLen).fill(0x20);
  padded.set(encoded);

  // Locate and copy the BIN chunk verbatim
  const originalJsonLen = new DataView(originalGlb).getUint32(12, true);
  const binStart        = 20 + originalJsonLen;
  const binChunk        = new Uint8Array(originalGlb, binStart);

  const totalLen = 12 + 8 + paddedLen + binChunk.length;
  const out      = new ArrayBuffer(totalLen);
  const outView  = new DataView(out);
  const outBytes = new Uint8Array(out);

  // GLB header
  outView.setUint32(0,  0x46546c67, true); // magic  "glTF"
  outView.setUint32(4,  2,          true); // version 2
  outView.setUint32(8,  totalLen,   true); // total byte length

  // JSON chunk
  outView.setUint32(12, paddedLen,   true); // chunk length
  outView.setUint32(16, 0x4e4f534a, true); // chunk type JSON
  outBytes.set(padded, 20);

  // BIN chunk (unchanged)
  outBytes.set(binChunk, 20 + paddedLen);

  return out;
}

/**
 * Applies both post-processing patches to a raw GLB binary:
 *
 *   1. KHR_materials_ior (ior = 1.0) on every material.
 *   2. VRMC_vrm 1.0 humanoid bone map (if `includeVrm` is true).
 *
 * @param glb            Raw GLB output from GLTFExporter.
 * @param boneNames      Ordered list of VRM bone names (from fitResult.built.bones).
 * @param characterName  Written to glTF asset.generator and VRM meta.name.
 * @param patchIor       Whether to inject KHR_materials_ior. Default: true.
 * @param includeVrm     Whether to inject VRMC_vrm. Default: true.
 * @param vrmAuthor      Author string for VRM meta. Default: 'CC-Kit Auto-Rigger'.
 * @param vrmLicenseUrl  License URL for VRM meta.
 */
function patchRiggedGlb(
  glb:           ArrayBuffer,
  boneNames:     string[],
  characterName: string,
  patchIor:      boolean,
  includeVrm:    boolean,
  vrmAuthor:     string,
  vrmLicenseUrl: string,
): ArrayBuffer {
  // Parse JSON chunk
  const view     = new DataView(glb);
  const jsonLen  = view.getUint32(12, true);
  const jsonBytes = new Uint8Array(glb, 20, jsonLen);
  const json      = JSON.parse(new TextDecoder().decode(jsonBytes)) as GltfJson;

  // ── Patch 1: KHR_materials_ior ──────────────────────────────────────────
  if (patchIor && json.materials && json.materials.length > 0) {
    for (const mat of json.materials) {
      mat.extensions = mat.extensions ?? {};
      mat.extensions['KHR_materials_ior'] = { ior: 1.0 };
    }
    json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'KHR_materials_ior'])];
  }

  // ── Patch 2: VRMC_vrm 1.0 humanoid extension ────────────────────────────
  if (includeVrm && json.nodes && json.nodes.length > 0) {
    // Map bone name → glTF node index by matching node.name
    const nodeIndexByName = new Map<string, number>();
    for (let i = 0; i < json.nodes.length; i++) {
      const nodeName = json.nodes[i]?.name;
      if (nodeName) nodeIndexByName.set(nodeName, i);
    }

    // Build humanoid bone map — only include standard VRM 1.0 humanoid bones that exist in exported nodes.
    // Non-VRM secondary bones (pelvisLower, leftButt, rightButt, leftBreast, rightBreast) are safely
    // skipped here while remaining exported as glTF skin nodes and vertex weights.
    const boneToNodeIndex = new Map<VrmBoneName, number>();
    for (const boneName of boneNames) {
      if (!isVrmBoneName(boneName)) continue;
      const nodeIdx = nodeIndexByName.get(boneName);
      if (nodeIdx !== undefined) {
        boneToNodeIndex.set(boneName, nodeIdx);
      }
    }

    if (boneToNodeIndex.size > 0) {
      json.extensions = json.extensions ?? {};
      json.extensions['VRMC_vrm'] = buildVrmHumanoidExtension(boneToNodeIndex);

      // Override meta with export-time values
      const vrmExt = json.extensions['VRMC_vrm'] as Record<string, unknown>;
      vrmExt['meta'] = {
        name:        characterName,
        version:     '1.0',
        authors:     [vrmAuthor],
        licenseUrl:  vrmLicenseUrl,
      };

      json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'VRMC_vrm'])];
    }
  }

  // ── Asset metadata ──────────────────────────────────────────────────────
  json.asset = { ...(json.asset ?? { version: '2.0' }), generator: 'CC-Kit Auto-Rigger' };

  return repackGlb(json, glb);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Scene assembly
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assembles the export scene graph:
 *
 * ```
 * exportRoot  (Object3D  → becomes the glTF scene root node)
 *   ├── Armature  (Object3D  → bone container, named "Armature")
 *   │     └── hips  (Bone)
 *   │           └── spine → chest → …
 *   └── Body  (SkinnedMesh)
 * ```
 *
 * The SkinnedMesh references bones from the Armature; GLTFExporter resolves
 * the skin.joints[] array automatically from the skeleton.bones list.
 */
function assembleExportScene(
  skinnedMesh: THREE.SkinnedMesh,
  fitResult:   FitResult,
  characterName: string,
): THREE.Object3D {
  const exportRoot = new THREE.Object3D();
  exportRoot.name  = characterName;

  // Bone container (named "Armature" for Blender convention)
  const armature  = new THREE.Object3D();
  armature.name   = 'Armature';
  armature.add(fitResult.built.root);
  exportRoot.add(armature);

  // Mesh
  exportRoot.add(skinnedMesh);

  // Recompute world matrices so the exporter sees correct transforms
  exportRoot.updateMatrixWorld(true);

  return exportRoot;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Browser download helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Triggers a browser file-save dialog for a GLB ArrayBuffer.
 * No-ops in non-browser environments (SSR safety).
 */
function triggerDownload(glb: ArrayBuffer, filename: string): void {
  if (typeof document === 'undefined') return;

  const blob = new Blob([glb], { type: 'model/gltf-binary' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Main export function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full pipeline: assemble → export → patch → (download).
 *
 * @param geometry   Source mesh geometry. Must have `position` attribute.
 * @param material   Material(s) for the mesh — preserved as-is in the GLB.
 * @param fitResult  Output of `fitSkeletonToLandmarks()`.
 * @param weights    Output of `diffuseWeights()` or `transferWeights()`.
 * @param options    Export tuning options.
 * @returns          The final patched GLB as an `ArrayBuffer`.
 *
 * @example
 * ```ts
 * // Complete auto-rig + export in 4 lines:
 * const fit      = fitSkeletonToLandmarks(landmarks);
 * const raw      = transferWeights(geometry, fit, mesh.matrixWorld);
 * const smooth   = diffuseWeights(raw, geometry);
 * const glb      = await exportRiggedGlb(geometry, mesh.material, fit, smooth);
 * ```
 */
export async function exportRiggedGlb(
  geometry:  THREE.BufferGeometry,
  material:  THREE.Material | THREE.Material[],
  fitResult: FitResult,
  weights:   WeightSource,
  options:   RiggedExportOptions = {},
): Promise<ArrayBuffer> {
  // ── Defaults ────────────────────────────────────────────────────────────
  const rawName       = (options.name ?? 'Character').trim();
  const characterName = rawName.replace(/[^a-zA-Z0-9_\-]/g, '_') || 'Character';
  const includeVrm    = options.includeVrmExtension ?? true;
  const patchIor      = options.patchIor            ?? false;
  const maxTexture    = options.maxTextureSize       ?? 4096;
  const doDownload    = options.download             ?? true;
  const vrmAuthor     = options.vrmAuthor            ?? 'CC-Kit Auto-Rigger';
  const vrmLicense    = options.vrmLicenseUrl        ?? 'https://vrm.dev/licenses/1.0/';

  // ── Build SkinnedMesh ────────────────────────────────────────────────────
  const skinnedMesh = createRiggedSkinnedMesh(
    geometry, material, fitResult, weights, characterName,
  );

  // ── Collect bone names in skeleton.bones[] order ─────────────────────────
  // These are needed for VRM node-index lookup after GLTFExporter runs.
  const boneNames = fitResult.built.bones.map((b) => b.name);

  // ── Assemble scene ───────────────────────────────────────────────────────
  const exportRoot = assembleExportScene(skinnedMesh, fitResult, characterName);

  // ── GLTFExporter ─────────────────────────────────────────────────────────
  const exporter = new GLTFExporter();
  const rawGlb   = await exporter.parseAsync(exportRoot, {
    binary:         true,
    trs:            true,   // separate T/R/S (better for animation runtimes)
    onlyVisible:    true,
    maxTextureSize: maxTexture,
    animations:     [],     // no animation in the auto-rigger export (bare bind pose)
  }) as ArrayBuffer;

  // ── Post-processing patches ──────────────────────────────────────────────
  const patchedGlb = patchRiggedGlb(
    rawGlb,
    boneNames,
    characterName,
    patchIor,
    includeVrm,
    vrmAuthor,
    vrmLicense,
  );

  // ── Browser download ─────────────────────────────────────────────────────
  if (doDownload) {
    triggerDownload(patchedGlb, `${characterName}_rigged.glb`);
  }

  // ── Cleanup: dispose the temporary export scene ──────────────────────────
  skinnedMesh.geometry.dispose();
  // Note: fitResult.built.skeleton is NOT disposed here — the caller may
  // still need it for viewport preview (createRiggedSkinnedMesh for display).

  return patchedGlb;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Full pipeline convenience wrapper
// ─────────────────────────────────────────────────────────────────────────────

import { fitSkeletonToLandmarks, type FitOptions }                    from '@/lib/rigger/templateFitter';
import { type LandmarkMap }                                           from '@/lib/rigger/vrmSkeleton';
import { transferWeightsAsync, type WeightTransferOptions }          from '@/lib/rigger/weightTransfer';
import { diffuseWeightsAsync,  type DiffusionOptions }               from '@/lib/rigger/heatDiffusion';

export interface AutoRigOptions {
  fit?:      FitOptions;
  weights?:  WeightTransferOptions;
  diffuse?:  DiffusionOptions;
  export?:   RiggedExportOptions;
  /** Called with progress 0–1 during the full pipeline. */
  onProgress?: (stage: 'fit' | 'weights' | 'diffuse' | 'export', progress: number) => void;
}

/**
 * One-call full auto-rig pipeline:
 *
 *   landmarks → fit skeleton → transfer weights → diffuse → export GLB
 *
 * This is the entry point a UI button would call.
 * All heavy work yields to the event loop, keeping the browser responsive.
 *
 * @param geometry   The input humanoid mesh geometry.
 * @param material   Material(s) on the mesh.
 * @param landmarks  7 anatomical landmark positions (world-space, metres).
 * @param worldMatrix World matrix of the mesh. Default: identity.
 * @param options    Per-stage tuning options.
 * @returns          The final patched GLB `ArrayBuffer`.
 *
 * @example
 * ```ts
 * const glb = await autoRig(geometry, material, landmarks, mesh.matrixWorld, {
 *   export: { name: 'MyCharacter', download: true },
 *   onProgress: (stage, p) => console.log(stage, (p * 100).toFixed(0) + '%'),
 * });
 * ```
 */
export async function autoRig(
  geometry:    THREE.BufferGeometry,
  material:    THREE.Material | THREE.Material[],
  landmarks:   LandmarkMap,
  worldMatrix: THREE.Matrix4 = new THREE.Matrix4(),
  options:     AutoRigOptions = {},
): Promise<ArrayBuffer> {
  const { onProgress } = options;

  // ── Stage 1: Fit skeleton ────────────────────────────────────────────────
  onProgress?.('fit', 0);
  const fitResult = fitSkeletonToLandmarks(landmarks, options.fit);
  onProgress?.('fit', 1);

  // ── Stage 2: Transfer weights ────────────────────────────────────────────
  const rawWeights = await transferWeightsAsync(
    geometry,
    fitResult,
    worldMatrix,
    {
      ...options.weights,
      onProgress: (p) => onProgress?.('weights', p),
    },
  );

  // ── Stage 3: Diffuse weights ─────────────────────────────────────────────
  const smoothWeights = await diffuseWeightsAsync(
    rawWeights,
    geometry,
    {
      ...options.diffuse,
      onProgress: (p) => onProgress?.('diffuse', p),
    },
  );

  // ── Stage 4: Export ──────────────────────────────────────────────────────
  onProgress?.('export', 0);
  const glb = await exportRiggedGlb(
    geometry,
    material,
    fitResult,
    smoothWeights,
    options.export,
  );
  onProgress?.('export', 1);

  return glb;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Diagnostic helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a human-readable summary of a completed export, useful for a
 * "Rig complete" toast notification in the UI.
 *
 * Example output:
 *   Character: MyCharacter
 *   Height:    1.724 m
 *   Bones:     54 (VRM 1.0 humanoid)
 *   Vertices:  15420
 *   File size: 2.3 MB
 */
export function exportSummary(
  fitResult:    FitResult,
  weights:      WeightSource,
  glbByteLength: number,
  characterName: string,
): string {
  const mb = (glbByteLength / 1_048_576).toFixed(2);
  const vrmCount = fitResult.built.bones.filter((b) => isVrmBoneName(b.name)).length;
  const secCount = fitResult.built.bones.length - vrmCount;
  const boneLabel = secCount > 0
    ? `${fitResult.built.bones.length} (${vrmCount} VRM 1.0 + ${secCount} custom)`
    : `${fitResult.built.bones.length} (VRM 1.0 humanoid)`;
  return [
    `Character: ${characterName}`,
    `Height:    ${fitResult.characterHeight.toFixed(3)} m`,
    `Scale:     ${fitResult.scale.toFixed(3)}× (ref 1.70 m)`,
    `Bones:     ${boneLabel}`,
    `Vertices:  ${weights.vertexCount}`,
    `File size: ${mb} MB`,
  ].join('\n');
}
