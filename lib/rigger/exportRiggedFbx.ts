/**
 * lib/rigger/exportRiggedFbx.ts
 *
 * ASCII FBX 7.4 Exporter for the CC-Kit Auto-Rigger Studio.
 *
 * Exports a standards-compliant FBX 7.4 ASCII file with:
 *   - Clean rest-pose bone hierarchy (`Armature` + `LimbNode` joints)
 *   - Skinned mesh geometry (positions, normals, UVs, multi-material groups)
 *   - Full `Skin` + per-bone `Cluster` deformers + `BindPose` node
 *   - Embedded diffuse textures (PNG base64 `Video` + `Texture` + `Material`)
 *   - Optional baked animation clips (`Idle`, `Walk`, `Run`, or `All`)
 *
 * Compatible with Blender 3.x/4.x, Unity, Unreal Engine 5, Maya, and Three.js FBXLoader.
 */

import * as THREE from 'three';
import type { FitResult } from '@/lib/rigger/templateFitter';
import type { WeightSource } from '@/lib/rigger/exportRiggedGlb';
import { cloneRestFitResult } from '@/lib/rigger/exportRiggedGlb';
import {
  captureRestPose,
  driveTestAnimation,
  getGlbAnimationDuration,
  preloadGlbAnimations,
  type TestAnimationMode,
} from '@/lib/rigger/testAnimations';
import {
  getEngineProfile,
  mapBoneNameForTarget,
  type ExportTarget,
} from '@/lib/rigger/engineProfiles';
import type { VrmBoneName } from '@/lib/rigger/vrmSkeleton';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Types
// ─────────────────────────────────────────────────────────────────────────────

const FBX_TIME_PER_SEC = 46_186_158_000;
const EXPORT_FPS = 30;
const MAX_EMBEDDED_TEX_SIZE = 2048;

export type FbxAnimationClipOption = 'idle' | 'walk' | 'run' | 'all';

export interface RiggedFbxExportOptions {
  /** Character / root name written inside the FBX scene graph. Default: 'Character'. */
  name?: string;
  /** Target game engine / DCC rig convention. Default: 'vrm'. */
  target?: ExportTarget;
  /** Whether to bake animation curve stack(s) into the FBX. Default: false. */
  includeAnimation?: boolean;
  /** Which procedural test clip(s) to bake when `includeAnimation` is true. Default: 'walk'. */
  animationClip?: FbxAnimationClipOption;
  /** Trigger browser download automatically. Default: true. */
  download?: boolean;
}

export interface FbxExportResult {
  buffer: ArrayBuffer;
  byteLength: number;
  filename: string;
  clipNames: string[];
}

interface ClipSpec {
  mode: Exclude<TestAnimationMode, 'tpose'>;
  name: string;
  durationSec: number;
}

const CLIP_SPECS: Record<Exclude<TestAnimationMode, 'tpose'>, ClipSpec> = {
  idle: { mode: 'idle', name: 'Idle', durationSec: (Math.PI * 2) / 0.7 },
  walk: { mode: 'walk', name: 'Walk', durationSec: (Math.PI * 2) / 4.2 },
  run:  { mode: 'run',  name: 'Run',  durationSec: (Math.PI * 2) / 7.5 },
};

interface ExtractedTexture {
  name: string;
  base64Png: string;
  wrapS: number;
  wrapT: number;
  flipY: boolean;
}

interface ExtractedMaterial {
  name: string;
  diffuse: [number, number, number];
  specular: [number, number, number];
  emissive: [number, number, number];
  opacity: number;
  shininess: number;
  diffuseTex: ExtractedTexture | null;
}

interface SampledChannel {
  boneIndex: number;
  property: 'Lcl Translation' | 'Lcl Rotation';
  curveTypeName: 'T' | 'R';
  times: number[];
  x: number[];
  y: number[];
  z: number[];
}

interface BakedTake {
  name: string;
  durationSec: number;
  channels: SampledChannel[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 1e-8) return '0';
  const rounded = Math.round(n * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function fmtMat4(m: THREE.Matrix4): string {
  // THREE.Matrix4.elements is already column-major — matching FBX TransformLink / PoseNode.
  return m.elements.map((v) => fmt(v)).join(',');
}

function sanitizeFbxName(raw: string, fallback: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_\- ]/g, '_').replace(/\s+/g, '_');
  return cleaned || fallback;
}

/**
 * Formats an array into FBX `a: ...` lines without leading indentation on wrapped
 * continuation lines so both Autodesk SDK / Blender and Three.js TextParser parse them.
 */
function formatNumberArrayProperty(indent: string, values: ArrayLike<number>): string {
  const len = values.length;
  if (len === 0) return `${indent}a: \n`;
  const parts: string[] = [];
  const chunkSize = 24;
  for (let i = 0; i < len; i += chunkSize) {
    const end = Math.min(len, i + chunkSize);
    const slice: string[] = [];
    for (let j = i; j < end; j++) {
      slice.push(fmt(values[j]!));
    }
    const line = slice.join(',') + (end < len ? ',' : '');
    parts.push(i === 0 ? `${indent}a: ${line}` : line);
  }
  return parts.join('\n') + '\n';
}

function formatIntArrayProperty(indent: string, values: ArrayLike<number>): string {
  const len = values.length;
  if (len === 0) return `${indent}a: \n`;
  const parts: string[] = [];
  const chunkSize = 36;
  for (let i = 0; i < len; i += chunkSize) {
    const end = Math.min(len, i + chunkSize);
    const slice: string[] = [];
    for (let j = i; j < end; j++) {
      slice.push(String(Math.trunc(values[j]!)));
    }
    const line = slice.join(',') + (end < len ? ',' : '');
    parts.push(i === 0 ? `${indent}a: ${line}` : line);
  }
  return parts.join('\n') + '\n';
}

function textureToBase64Png(tex: THREE.Texture | null | undefined): ExtractedTexture | null {
  if (!tex || !tex.image || typeof document === 'undefined') return null;
  const img = tex.image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  const w0 = img.naturalWidth ?? img.width ?? 0;
  const h0 = img.naturalHeight ?? img.height ?? 0;
  if (w0 <= 0 || h0 <= 0) return null;

  const scale = Math.min(1, MAX_EMBEDDED_TEX_SIZE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/png');
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    return {
      name: sanitizeFbxName(tex.name || 'DiffuseMap', 'DiffuseMap'),
      base64Png: dataUrl.slice(comma + 1),
      wrapS: tex.wrapS === THREE.ClampToEdgeWrapping ? 1 : 0,
      wrapT: tex.wrapT === THREE.ClampToEdgeWrapping ? 1 : 0,
      flipY: tex.flipY,
    };
  } catch {
    return null;
  }
}

function extractMaterials(material: THREE.Material | THREE.Material[]): ExtractedMaterial[] {
  const list = Array.isArray(material) ? material : [material];
  if (list.length === 0) {
    return [{
      name: 'DefaultMaterial',
      diffuse: [0.8, 0.8, 0.8],
      specular: [0.1, 0.1, 0.1],
      emissive: [0, 0, 0],
      opacity: 1,
      shininess: 20,
      diffuseTex: null,
    }];
  }

  return list.map((m, idx) => {
    const std = m as THREE.MeshStandardMaterial & THREE.MeshPhongMaterial;
    const color = std.color instanceof THREE.Color ? std.color : new THREE.Color(0.8, 0.8, 0.8);
    const emissive = std.emissive instanceof THREE.Color ? std.emissive : new THREE.Color(0, 0, 0);
    const specular = std.specular instanceof THREE.Color ? std.specular : new THREE.Color(0.12, 0.12, 0.12);
    const shininess = typeof std.shininess === 'number'
      ? std.shininess
      : typeof std.roughness === 'number'
      ? Math.max(2, (1 - std.roughness) * 64)
      : 20;
    const opacity = typeof m.opacity === 'number' ? m.opacity : 1;
    const tex = textureToBase64Png(std.map);

    return {
      name: sanitizeFbxName(m.name || `Material_${idx}`, `Material_${idx}`),
      diffuse: [color.r, color.g, color.b],
      specular: [specular.r, specular.g, specular.b],
      emissive: [emissive.r, emissive.g, emissive.b],
      opacity,
      shininess,
      diffuseTex: tex,
    };
  });
}

/** Ensures smooth unwrapped Euler keyframes without 360° wrapping pops. */
function unwrapDeg(prev: number, next: number): number {
  let d = next - prev;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return prev + d;
}

function bakeTakes(
  fitClone: FitResult,
  option: FbxAnimationClipOption,
): BakedTake[] {
  const modes: Array<Exclude<TestAnimationMode, 'tpose'>> =
    option === 'all' ? ['idle', 'walk', 'run'] : [option];

  const { bones, boneMap } = fitClone.built;
  const boneNameList = bones.map((b) => b.name);
  const restQuats = captureRestPose(boneMap as Map<VrmBoneName, THREE.Bone>);
  const restPositions = bones.map((b) => b.position.clone());
  const euler = new THREE.Euler();
  const RAD_TO_DEG = 180 / Math.PI;

  const takes: BakedTake[] = [];

  for (const mode of modes) {
    const baseSpec = CLIP_SPECS[mode];
    const durationSec = getGlbAnimationDuration(mode) ?? baseSpec.durationSec;
    const numSteps = Math.max(12, Math.round(durationSec * EXPORT_FPS));
    const frameTimes: number[] = [];

    // Per bone arrays of sampled transforms
    const rotX: number[][] = bones.map(() => []);
    const rotY: number[][] = bones.map(() => []);
    const rotZ: number[][] = bones.map(() => []);
    const posX: number[][] = bones.map(() => []);
    const posY: number[][] = bones.map(() => []);
    const posZ: number[][] = bones.map(() => []);

    for (let f = 0; f <= numSteps; f++) {
      const t = (f / numSteps) * durationSec;
      frameTimes.push(t);
      driveTestAnimation(boneMap as Map<VrmBoneName, THREE.Bone>, restQuats, mode, t);

      for (let bi = 0; bi < bones.length; bi++) {
        const bone = bones[bi]!;
        // FBX default RotationOrder = 0 maps to Three.js 'ZYX' Euler order
        euler.setFromQuaternion(bone.quaternion, 'ZYX');
        let ex = euler.x * RAD_TO_DEG;
        let ey = euler.y * RAD_TO_DEG;
        let ez = euler.z * RAD_TO_DEG;
        if (f > 0) {
          ex = unwrapDeg(rotX[bi]![f - 1]!, ex);
          ey = unwrapDeg(rotY[bi]![f - 1]!, ey);
          ez = unwrapDeg(rotZ[bi]![f - 1]!, ez);
        }
        rotX[bi]!.push(ex);
        rotY[bi]!.push(ey);
        rotZ[bi]!.push(ez);

        posX[bi]!.push(bone.position.x);
        posY[bi]!.push(bone.position.y);
        posZ[bi]!.push(bone.position.z);
      }
    }

    const channels: SampledChannel[] = [];
    for (let bi = 0; bi < bones.length; bi++) {
      const rotChanged =
        rotX[bi]!.some((v) => Math.abs(v) > 1e-4) ||
        rotY[bi]!.some((v) => Math.abs(v) > 1e-4) ||
        rotZ[bi]!.some((v) => Math.abs(v) > 1e-4);

      if (rotChanged) {
        channels.push({
          boneIndex: bi,
          property: 'Lcl Rotation',
          curveTypeName: 'R',
          times: frameTimes,
          x: rotX[bi]!,
          y: rotY[bi]!,
          z: rotZ[bi]!,
        });
      }

      const rp = restPositions[bi]!;
      const posChanged =
        boneNameList[bi] === 'hips' ||
        posX[bi]!.some((v) => Math.abs(v - rp.x) > 1e-5) ||
        posY[bi]!.some((v) => Math.abs(v - rp.y) > 1e-5) ||
        posZ[bi]!.some((v) => Math.abs(v - rp.z) > 1e-5);

      if (posChanged && (
        posX[bi]!.some((v) => Math.abs(v - rp.x) > 1e-5) ||
        posY[bi]!.some((v) => Math.abs(v - rp.y) > 1e-5) ||
        posZ[bi]!.some((v) => Math.abs(v - rp.z) > 1e-5)
      )) {
        channels.push({
          boneIndex: bi,
          property: 'Lcl Translation',
          curveTypeName: 'T',
          times: frameTimes,
          x: posX[bi]!,
          y: posY[bi]!,
          z: posZ[bi]!,
        });
      }
    }

    // Restore rest pose between takes
    driveTestAnimation(boneMap as Map<VrmBoneName, THREE.Bone>, restQuats, 'tpose', 0);

    takes.push({
      name: baseSpec.name,
      durationSec,
      channels,
    });
  }

  return takes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core ASCII FBX 7.4 Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a complete ASCII FBX 7.4 string from a geometry, material(s),
 * fitted skeleton, weights, and optional baked animations.
 */
export function buildRiggedFbxString(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  fitResult: FitResult,
  weights: WeightSource,
  options: RiggedFbxExportOptions = {},
): { text: string; filename: string; clipNames: string[] } {
  const charName = sanitizeFbxName(options.name ?? 'Character', 'Character');
  const target: ExportTarget = options.target ?? 'vrm';
  const profile = getEngineProfile(target);
  const scaleFactor = profile.scaleFactor;
  const unitScaleFactor = profile.unitScaleFactor;
  const includeAnimation = options.includeAnimation ?? false;
  const animOption: FbxAnimationClipOption = options.animationClip ?? 'walk';
  const doAnim = includeAnimation;

  // Work on isolated rest-pose clone of fitResult so live canvas preview is never mutated.
  // Animation baking runs BEFORE unit scaling, root-bone injection, or engine bone renaming
  // because `bakeTakes` drives the internal VRM 1.0 skeleton in metres.
  const fitClone = cloneRestFitResult(fitResult);
  const vrmBones = fitClone.built.bones;
  const numVrmBones = vrmBones.length;

  const takes = doAnim ? bakeTakes(fitClone, animOption) : [];

  // Convert local positions + baked translation tracks into target engine units (e.g. cm for UE5)
  if (scaleFactor !== 1) {
    for (const b of vrmBones) {
      b.position.multiplyScalar(scaleFactor);
    }
    for (const take of takes) {
      for (const ch of take.channels) {
        if (ch.property === 'Lcl Translation') {
          ch.x = ch.x.map((v) => v * scaleFactor);
          ch.y = ch.y.map((v) => v * scaleFactor);
          ch.z = ch.z.map((v) => v * scaleFactor);
        }
      }
    }
  }

  // Optionally prepend a grounded `root` bone at world (0,0,0) above hips/pelvis (UE5 Mannequin)
  const animBoneOffset = profile.addRootBone ? 1 : 0;
  let exportBones: THREE.Bone[] = vrmBones;
  if (profile.addRootBone) {
    const rootBone = new THREE.Bone();
    rootBone.name = 'root';
    rootBone.position.set(0, 0, 0);
    const prevTop = fitClone.built.root;
    rootBone.add(prevTop);
    fitClone.built.root = rootBone;
    exportBones = [rootBone, ...vrmBones];
  }

  // Remap exported bone names to target engine convention without altering VRM hierarchy math
  for (const b of exportBones) {
    if (profile.addRootBone && b === exportBones[0]) continue;
    b.name = mapBoneNameForTarget(b.name, target);
  }
  const numBones = exportBones.length;

  // Re-ensure clean rest world matrices for TransformLink & BindPose
  fitClone.built.root.updateMatrixWorld(true);
  for (const b of exportBones) b.updateMatrixWorld(true);

  // Extract triangle geometry cleanly in original vertex indexing
  const geo = geometry.clone();
  if (!geo.getAttribute('normal')) {
    geo.computeVertexNormals();
  }
  const posAttr = geo.getAttribute('position');
  const normAttr = geo.getAttribute('normal');
  const uvAttr = geo.getAttribute('uv');
  const vertexCount = posAttr.count;
  const indexAttr = geo.getIndex();
  const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(vertexCount / 3);

  const polygonVertexIndices = new Int32Array(triCount * 3);
  const flatTriangleIndices = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    const a = indexAttr ? indexAttr.getX(i0) : i0;
    const b = indexAttr ? indexAttr.getX(i0 + 1) : i0 + 1;
    const c = indexAttr ? indexAttr.getX(i0 + 2) : i0 + 2;
    polygonVertexIndices[i0] = a;
    polygonVertexIndices[i0 + 1] = b;
    polygonVertexIndices[i0 + 2] = -(c + 1); // FBX bit-negated end-of-polygon index
    flatTriangleIndices[i0] = a;
    flatTriangleIndices[i0 + 1] = b;
    flatTriangleIndices[i0 + 2] = c;
  }

  // Materials & multi-material triangle mapping
  const materials = extractMaterials(material);
  const hasMultiMat = materials.length > 1 && geo.groups.length > 0;
  let triMaterials: Uint16Array | null = null;
  if (hasMultiMat) {
    triMaterials = new Uint16Array(triCount);
    for (const grp of geo.groups) {
      const matIdx = Math.min(materials.length - 1, Math.max(0, grp.materialIndex ?? 0));
      const startTri = Math.floor(grp.start / 3);
      const endTri = Math.min(triCount, Math.floor((grp.start + grp.count) / 3));
      for (let t = startTri; t < endTri; t++) {
        triMaterials[t] = matIdx;
      }
    }
  }

  // Flip V when source texture follows glTF top-down convention (`flipY === false`)
  const primaryTex = materials.find((m) => m.diffuseTex)?.diffuseTex ?? null;
  const shouldFlipV = primaryTex ? !primaryTex.flipY : true;

  const uvArray = uvAttr ? new Float32Array(vertexCount * 2) : null;
  if (uvAttr && uvArray) {
    for (let v = 0; v < vertexCount; v++) {
      uvArray[v * 2] = uvAttr.getX(v);
      uvArray[v * 2 + 1] = shouldFlipV ? 1 - uvAttr.getY(v) : uvAttr.getY(v);
    }
  }

  // Accumulate per-bone vertex weights from interleaved skinIndex / skinWeight.
  // Offset by `animBoneOffset` when a grounded `root` bone sits at index 0 with 0 skinned weights.
  const clusterIndices: number[][] = Array.from({ length: numBones }, () => []);
  const clusterWeights: number[][] = Array.from({ length: numBones }, () => []);
  const skinIdx = weights.skinIndex;
  const skinWt = weights.skinWeight;
  for (let v = 0; v < weights.vertexCount; v++) {
    const base = v * 4;
    for (let k = 0; k < 4; k++) {
      const b = skinIdx[base + k]!;
      const w = skinWt[base + k]!;
      if (w > 1e-6 && b < numVrmBones) {
        const exportIdx = b + animBoneOffset;
        clusterIndices[exportIdx]!.push(v);
        clusterWeights[exportIdx]!.push(w);
      }
    }
  }

  // ── Allocate unique FBX IDs ───────────────────────────────────────────────
  let nextId = 100_000_000;
  const allocId = () => ++nextId;

  const geoId = allocId();
  const meshModelId = allocId();
  const armatureId = allocId();
  const poseId = allocId();
  const skinId = allocId();

  const boneIds = exportBones.map(() => allocId());
  const boneAttrIds = exportBones.map(() => allocId());
  const clusterIds = exportBones.map(() => allocId());

  const matIds = materials.map(() => allocId());
  const texIds = materials.map((m) => (m.diffuseTex ? allocId() : null));
  const videoIds = materials.map((m) => (m.diffuseTex ? allocId() : null));

  const texCount = texIds.filter((id) => id !== null).length;

  interface AnimIds {
    stackId: number;
    layerId: number;
    curves: Array<{
      channel: SampledChannel;
      curveNodeId: number;
      curveXId: number;
      curveYId: number;
      curveZId: number;
    }>;
  }

  const animIdList: AnimIds[] = takes.map((take) => ({
    stackId: allocId(),
    layerId: allocId(),
    curves: take.channels.map((ch) => ({
      channel: ch,
      curveNodeId: allocId(),
      curveXId: allocId(),
      curveYId: allocId(),
      curveZId: allocId(),
    })),
  }));

  const curveNodeCount = animIdList.reduce((acc, a) => acc + a.curves.length, 0);
  const curveCount = curveNodeCount * 3;
  const maxDurationTicks = takes.reduce(
    (mx, t) => Math.max(mx, Math.round(t.durationSec * FBX_TIME_PER_SEC)),
    0,
  );
  const modelCount = 2 + numBones; // Mesh + Armature Null + Bones
  const deformerCount = 1 + numBones; // 1 Skin + N Clusters

  const out: string[] = [];
  const push = (s: string) => out.push(s);

  // ── Header ────────────────────────────────────────────────────────────────
  const now = new Date();
  push(`; FBX 7.4.0 project file
; Generated by CC-Kit Auto-Rigger Studio
; ----------------------------------------------------

FBXHeaderExtension:  {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
\tCreationTimeStamp:  {
\t\tVersion: 1000
\t\tYear: ${now.getUTCFullYear()}
\t\tMonth: ${now.getUTCMonth() + 1}
\t\tDay: ${now.getUTCDate()}
\t\tHour: ${now.getUTCHours()}
\t\tMinute: ${now.getUTCMinutes()}
\t\tSecond: ${now.getUTCSeconds()}
\t\tMillisecond: ${now.getUTCMilliseconds()}
\t}
\tCreator: "CC-Kit Auto-Rigger Studio"
}

GlobalSettings:  {
\tVersion: 1000
\tProperties70:  {
\t\tP: "UpAxis", "int", "Integer", "",1
\t\tP: "UpAxisSign", "int", "Integer", "",1
\t\tP: "FrontAxis", "int", "Integer", "",2
\t\tP: "FrontAxisSign", "int", "Integer", "",1
\t\tP: "CoordAxis", "int", "Integer", "",0
\t\tP: "CoordAxisSign", "int", "Integer", "",1
\t\tP: "OriginalUpAxis", "int", "Integer", "",1
\t\tP: "OriginalUpAxisSign", "int", "Integer", "",1
\t\tP: "UnitScaleFactor", "double", "Number", "",${unitScaleFactor}
\t\tP: "OriginalUnitScaleFactor", "double", "Number", "",${unitScaleFactor}
\t\tP: "AmbientColor", "ColorRGB", "Color", "",0,0,0
\t\tP: "DefaultCamera", "KString", "", "", "Producer Perspective"
\t\tP: "TimeMode", "enum", "", "",6
\t\tP: "TimeSpanStart", "KTime", "Time", "",0
\t\tP: "TimeSpanStop", "KTime", "Time", "",${maxDurationTicks}
\t\tP: "CustomFrameRate", "double", "Number", "",${EXPORT_FPS}
\t}
}

Documents:  {
\tCount: 1
\tDocument: ${allocId()}, "Scene", "Scene" {
\t\tProperties70:  {
\t\t\tP: "SourceObject", "object", "", ""
\t\t\tP: "ActiveAnimStackName", "KString", "", "", "${takes[0]?.name ?? ''}"
\t\t}
\t\tRootNode: 0
\t}
}

References:  {
}

Definitions:  {
\tVersion: 100
\tCount: ${1 + 1 + modelCount + numBones + 1 + deformerCount + materials.length + texCount * 2 + (takes.length > 0 ? takes.length * 2 + curveNodeCount + curveCount : 0)}
\tObjectType: "GlobalSettings" {
\t\tCount: 1
\t}
\tObjectType: "Geometry" {
\t\tCount: 1
\t}
\tObjectType: "Model" {
\t\tCount: ${modelCount}
\t}
\tObjectType: "NodeAttribute" {
\t\tCount: ${numBones}
\t}
\tObjectType: "Pose" {
\t\tCount: 1
\t}
\tObjectType: "Deformer" {
\t\tCount: ${deformerCount}
\t}
\tObjectType: "Material" {
\t\tCount: ${materials.length}
\t}`);

  if (texCount > 0) {
    push(`\tObjectType: "Texture" {
\t\tCount: ${texCount}
\t}
\tObjectType: "Video" {
\t\tCount: ${texCount}
\t}`);
  }

  if (takes.length > 0) {
    push(`\tObjectType: "AnimationStack" {
\t\tCount: ${takes.length}
\t}
\tObjectType: "AnimationLayer" {
\t\tCount: ${takes.length}
\t}
\tObjectType: "AnimationCurveNode" {
\t\tCount: ${curveNodeCount}
\t}
\tObjectType: "AnimationCurve" {
\t\tCount: ${curveCount}
\t}`);
  }

  push(`}

Objects:  {`);

  // ── 1. Geometry ───────────────────────────────────────────────────────────
  const posArr = posAttr.array as Float32Array;
  const scaledPosArr = scaleFactor === 1
    ? posArr.subarray(0, vertexCount * 3)
    : Float32Array.from(posArr.subarray(0, vertexCount * 3), (v) => v * scaleFactor);
  const normArr = normAttr.array as Float32Array;
  const hasUV = Boolean(uvArray && uvArray.length === vertexCount * 2);

  push(`\tGeometry: ${geoId}, "Geometry::${charName}_Geo", "Mesh" {
\t\tVertices: *${vertexCount * 3} {`);
  push(formatNumberArrayProperty('\t\t\t', scaledPosArr));
  push(`\t\t}
\t\tPolygonVertexIndex: *${polygonVertexIndices.length} {`);
  push(formatIntArrayProperty('\t\t\t', polygonVertexIndices));
  push(`\t\t}
\t\tGeometryVersion: 124
\t\tLayerElementNormal: 0 {
\t\t\tVersion: 102
\t\t\tName: ""
\t\t\tMappingInformationType: "ByVertice"
\t\t\tReferenceInformationType: "Direct"
\t\t\tNormals: *${vertexCount * 3} {`);
  push(formatNumberArrayProperty('\t\t\t\t', normArr.subarray(0, vertexCount * 3)));
  push(`\t\t\t}
\t\t}`);

  if (hasUV && uvArray) {
    push(`\t\tLayerElementUV: 0 {
\t\t\tVersion: 101
\t\t\tName: "UVMap"
\t\t\tMappingInformationType: "ByPolygonVertex"
\t\t\tReferenceInformationType: "IndexToDirect"
\t\t\tUV: *${uvArray.length} {`);
    push(formatNumberArrayProperty('\t\t\t\t', uvArray));
    push(`\t\t\t}
\t\t\tUVIndex: *${flatTriangleIndices.length} {`);
    push(formatIntArrayProperty('\t\t\t\t', flatTriangleIndices));
    push(`\t\t\t}
\t\t}`);
  }

  if (hasMultiMat && triMaterials) {
    push(`\t\tLayerElementMaterial: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "ByPolygon"
\t\t\tReferenceInformationType: "IndexToDirect"
\t\t\tMaterials: *${triMaterials.length} {`);
    push(formatIntArrayProperty('\t\t\t\t', triMaterials));
    push(`\t\t\t}
\t\t}`);
  } else {
    push(`\t\tLayerElementMaterial: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "AllSame"
\t\t\tReferenceInformationType: "IndexToDirect"
\t\t\tMaterials: *1 {
\t\t\t\ta: 0
\t\t\t}
\t\t}`);
  }

  push(`\t\tLayer: 0 {
\t\t\tVersion: 100
\t\t\tLayerElement:  {
\t\t\t\tType: "LayerElementNormal"
\t\t\t\tTypedIndex: 0
\t\t\t}`);
  if (hasUV) {
    push(`\t\t\tLayerElement:  {
\t\t\t\tType: "LayerElementUV"
\t\t\t\tTypedIndex: 0
\t\t\t}`);
  }
  push(`\t\t\tLayerElement:  {
\t\t\t\tType: "LayerElementMaterial"
\t\t\t\tTypedIndex: 0
\t\t\t}
\t\t}
\t}`);

  // ── 2. Models (Mesh, Armature Null, Skeleton Bones) ───────────────────────
  push(`\tModel: ${meshModelId}, "Model::${charName}", "Mesh" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "RotationActive", "bool", "", "",1
\t\t\tP: "InheritType", "enum", "", "",1
\t\t\tP: "ScalingMax", "Vector3D", "Vector", "",0,0,0
\t\t\tP: "DefaultAttributeIndex", "int", "Integer", "",0
\t\t}
\t\tShading: T
\t\tCulling: "CullingOff"
\t}`);

  push(`\tModel: ${armatureId}, "Model::Armature", "Null" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "RotationActive", "bool", "", "",1
\t\t\tP: "InheritType", "enum", "", "",1
\t\t\tP: "DefaultAttributeIndex", "int", "Integer", "",0
\t\t}
\t\tShading: T
\t\tCulling: "CullingOff"
\t}`);

  for (let i = 0; i < numBones; i++) {
    const bone = exportBones[i]!;
    const attrId = boneAttrIds[i]!;
    const boneId = boneIds[i]!;
    push(`\tNodeAttribute: ${attrId}, "NodeAttribute::${bone.name}", "LimbNode" {
\t\tProperties70:  {
\t\t\tP: "Size", "double", "Number", "",${fmt(0.05 * scaleFactor)}
\t\t}
\t\tTypeFlags: "Skeleton"
\t}`);
    push(`\tModel: ${boneId}, "Model::${bone.name}", "LimbNode" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "RotationActive", "bool", "", "",1
\t\t\tP: "RotationOrder", "enum", "", "",0
\t\t\tP: "InheritType", "enum", "", "",1
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A+",${fmt(bone.position.x)},${fmt(bone.position.y)},${fmt(bone.position.z)}
\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A+",0,0,0
\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A+",1,1,1
\t\t}
\t\tShading: T
\t\tCulling: "CullingOff"
\t}`);
  }

  // ── 3. Deformers (Skin + Clusters) ────────────────────────────────────────
  push(`\tDeformer: ${skinId}, "Deformer::Skin", "Skin" {
\t\tVersion: 101
\t\tLink_DeformAcuracy: 50
\t\tSkinningType: "Linear"
\t}`);

  const identityStr = '1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1';
  for (let i = 0; i < numBones; i++) {
    const bone = exportBones[i]!;
    const clusterId = clusterIds[i]!;
    const idxs = clusterIndices[i]!;
    const wts = clusterWeights[i]!;

    push(`\tDeformer: ${clusterId}, "Deformer::Cluster_${bone.name}", "Cluster" {
\t\tVersion: 100
\t\tUserData: "", ""`);
    if (idxs.length > 0) {
      push(`\t\tIndexes: *${idxs.length} {`);
      push(formatIntArrayProperty('\t\t\t', idxs));
      push(`\t\t}
\t\tWeights: *${wts.length} {`);
      push(formatNumberArrayProperty('\t\t\t', wts));
      push(`\t\t}`);
    }
    push(`\t\tTransform: *16 {
\t\t\ta: ${identityStr}
\t\t}
\t\tTransformLink: *16 {
\t\t\ta: ${fmtMat4(bone.matrixWorld)}
\t\t}
\t}`);
  }

  // ── 4. BindPose ───────────────────────────────────────────────────────────
  push(`\tPose: ${poseId}, "Pose::BindPose", "BindPose" {
\t\tType: "BindPose"
\t\tVersion: 100
\t\tNbPoseNodes: ${2 + numBones}
\t\tPoseNode:  {
\t\t\tNode: ${meshModelId}
\t\t\tMatrix: *16 {
\t\t\t\ta: ${identityStr}
\t\t\t}
\t\t}
\t\tPoseNode:  {
\t\t\tNode: ${armatureId}
\t\t\tMatrix: *16 {
\t\t\t\ta: ${identityStr}
\t\t\t}
\t\t}`);
  for (let i = 0; i < numBones; i++) {
    push(`\t\tPoseNode:  {
\t\t\tNode: ${boneIds[i]!}
\t\t\tMatrix: *16 {
\t\t\t\ta: ${fmtMat4(exportBones[i]!.matrixWorld)}
\t\t\t}
\t\t}`);
  }
  push(`\t}`);

  // ── 5. Materials, Textures, Embedded Videos ───────────────────────────────
  for (let i = 0; i < materials.length; i++) {
    const m = materials[i]!;
    const matId = matIds[i]!;
    push(`\tMaterial: ${matId}, "Material::${m.name}", "" {
\t\tVersion: 102
\t\tShadingModel: "Phong"
\t\tMultiLayer: 0
\t\tProperties70:  {
\t\t\tP: "ShadingModel", "KString", "", "", "Phong"
\t\t\tP: "DiffuseColor", "Color", "", "A",${fmt(m.diffuse[0])},${fmt(m.diffuse[1])},${fmt(m.diffuse[2])}
\t\t\tP: "EmissiveColor", "Color", "", "A",${fmt(m.emissive[0])},${fmt(m.emissive[1])},${fmt(m.emissive[2])}
\t\t\tP: "SpecularColor", "Color", "", "A",${fmt(m.specular[0])},${fmt(m.specular[1])},${fmt(m.specular[2])}
\t\t\tP: "Shininess", "Number", "", "A",${fmt(m.shininess)}
\t\t\tP: "Opacity", "Number", "", "A",${fmt(m.opacity)}
\t\t}
\t}`);

    if (m.diffuseTex && texIds[i] !== null && videoIds[i] !== null) {
      const tex = m.diffuseTex;
      const texFile = `${tex.name}_${i}.png`;
      push(`\tTexture: ${texIds[i]!}, "Texture::${tex.name}", "" {
\t\tType: "TextureVideoClip"
\t\tVersion: 202
\t\tTextureName: "Texture::${tex.name}"
\t\tProperties70:  {
\t\t\tP: "WrapModeU", "enum", "", "",${tex.wrapS}
\t\t\tP: "WrapModeV", "enum", "", "",${tex.wrapT}
\t\t}
\t\tMedia: "Video::${tex.name}"
\t\tFileName: "${texFile}"
\t\tRelativeFilename: "${texFile}"
\t}`);
      push(`\tVideo: ${videoIds[i]!}, "Video::${tex.name}", "Clip" {
\t\tType: "Clip"
\t\tProperties70:  {
\t\t\tP: "Path", "KString", "XRefUrl", "", "${texFile}"
\t\t}
\t\tUseMipMap: 0
\t\tFilename: "${texFile}"
\t\tRelativeFilename: "${texFile}"
\t\tContent: ,
\t\t\t"${tex.base64Png}"
\t}`);
    }
  }

  // ── 6. Animation Stack / Layer / CurveNodes / Curves ──────────────────────
  for (let ti = 0; ti < takes.length; ti++) {
    const take = takes[ti]!;
    const aids = animIdList[ti]!;
    const stopTicks = Math.round(take.durationSec * FBX_TIME_PER_SEC);

    push(`\tAnimationStack: ${aids.stackId}, "AnimStack::${take.name}", "" {
\t\tProperties70:  {
\t\t\tP: "LocalStart", "KTime", "Time", "",0
\t\t\tP: "LocalStop", "KTime", "Time", "",${stopTicks}
\t\t\tP: "ReferenceStart", "KTime", "Time", "",0
\t\t\tP: "ReferenceStop", "KTime", "Time", "",${stopTicks}
\t\t}
\t}
\tAnimationLayer: ${aids.layerId}, "AnimLayer::BaseLayer", "" {
\t}`);

    for (const item of aids.curves) {
      const ch = item.channel;
      const dx0 = ch.x[0] ?? 0;
      const dy0 = ch.y[0] ?? 0;
      const dz0 = ch.z[0] ?? 0;
      const keyTicks = ch.times.map((sec) => Math.round(sec * FBX_TIME_PER_SEC));
      const keyCount = keyTicks.length;
      const flags = new Array<number>(keyCount).fill(8); // eInterpolationLinear | constant tangent

      push(`\tAnimationCurveNode: ${item.curveNodeId}, "AnimCurveNode::${ch.curveTypeName}", "" {
\t\tProperties70:  {
\t\t\tP: "d|X", "Number", "", "A",${fmt(dx0)}
\t\t\tP: "d|Y", "Number", "", "A",${fmt(dy0)}
\t\t\tP: "d|Z", "Number", "", "A",${fmt(dz0)}
\t\t}
\t}`);

      const writeCurve = (curveId: number, vals: number[]) => {
        push(`\tAnimationCurve: ${curveId}, "AnimCurve::", "" {
\t\tDefault: ${fmt(vals[0] ?? 0)}
\t\tKeyVer: 4008
\t\tKeyTime: *${keyCount} {`);
        push(formatIntArrayProperty('\t\t\t', keyTicks));
        push(`\t\t}
\t\tKeyValueFloat: *${keyCount} {`);
        push(formatNumberArrayProperty('\t\t\t', vals));
        push(`\t\t}
\t\tKeyAttrFlags: *${keyCount} {`);
        push(formatIntArrayProperty('\t\t\t', flags));
        push(`\t\t}
\t}`);
      };

      writeCurve(item.curveXId, ch.x);
      writeCurve(item.curveYId, ch.y);
      writeCurve(item.curveZId, ch.z);
    }
  }

  push(`}

Connections:  {`);

  // Root scene connections
  push(`\tC: "OO",${meshModelId},0`);
  push(`\tC: "OO",${armatureId},0`);
  push(`\tC: "OO",${geoId},${meshModelId}`);

  // Materials & textures
  for (let i = 0; i < materials.length; i++) {
    push(`\tC: "OO",${matIds[i]!},${meshModelId}`);
    if (texIds[i] !== null && videoIds[i] !== null) {
      push(`\tC: "OP",${texIds[i]!},${matIds[i]!}, "DiffuseColor"`);
      push(`\tC: "OO",${videoIds[i]!},${texIds[i]!}`);
    }
  }

  // Bone hierarchy & Skin deformer
  const boneIndexByBone = new Map<THREE.Bone, number>();
  exportBones.forEach((b, i) => boneIndexByBone.set(b, i));

  push(`\tC: "OO",${skinId},${geoId}`);
  for (let i = 0; i < numBones; i++) {
    const bone = exportBones[i]!;
    const boneId = boneIds[i]!;
    const attrId = boneAttrIds[i]!;
    const clusterId = clusterIds[i]!;
    const parentIdx = bone.parent && (bone.parent as THREE.Bone).isBone
      ? boneIndexByBone.get(bone.parent as THREE.Bone)
      : undefined;
    const parentId = parentIdx !== undefined ? boneIds[parentIdx]! : armatureId;

    push(`\tC: "OO",${boneId},${parentId}`);
    push(`\tC: "OO",${attrId},${boneId}`);
    push(`\tC: "OO",${clusterId},${skinId}`);
    push(`\tC: "OO",${boneId},${clusterId}`);
  }

  // Animation connections
  for (let ti = 0; ti < takes.length; ti++) {
    const aids = animIdList[ti]!;
    push(`\tC: "OO",${aids.layerId},${aids.stackId}`);
    for (const item of aids.curves) {
      const boneId = boneIds[item.channel.boneIndex + animBoneOffset]!;
      push(`\tC: "OO",${item.curveNodeId},${aids.layerId}`);
      push(`\tC: "OP",${item.curveNodeId},${boneId}, "${item.channel.property}"`);
      push(`\tC: "OP",${item.curveXId},${item.curveNodeId}, "d|X"`);
      push(`\tC: "OP",${item.curveYId},${item.curveNodeId}, "d|Y"`);
      push(`\tC: "OP",${item.curveZId},${item.curveNodeId}, "d|Z"`);
    }
  }

  push(`}`);

  geo.dispose();

  const tag = profile.fbxSuffixTag;
  const suffix = doAnim
    ? (animOption === 'all' ? `_${tag}_anim.fbx` : `_${tag}_${animOption}.fbx`)
    : `_${tag}_skeleton.fbx`;
  return {
    text: out.join('\n') + '\n',
    filename: `${charName}${suffix}`,
    clipNames: takes.map((t) => t.name),
  };
}

function triggerFbxDownload(buffer: ArrayBuffer, filename: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/**
 * Exports the rigged character as an ASCII FBX 7.4 file, optionally baking
 * procedural animations (Idle / Walk / Run / All) and triggering a download.
 */
export async function exportRiggedFbx(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  fitResult: FitResult,
  weights: WeightSource,
  options: RiggedFbxExportOptions = {},
): Promise<FbxExportResult> {
  if (options.includeAnimation) {
    await preloadGlbAnimations();
  }
  const { text, filename, clipNames } = buildRiggedFbxString(
    geometry,
    material,
    fitResult,
    weights,
    options,
  );
  const encoded = new TextEncoder().encode(text);
  const buffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);

  if (options.download ?? true) {
    triggerFbxDownload(buffer, filename);
  }

  return {
    buffer,
    byteLength: buffer.byteLength,
    filename,
    clipNames,
  };
}
