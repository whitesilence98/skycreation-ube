'use client';

import { OBJLoader, GLTFLoader } from 'three-stdlib';
import type * as THREE from 'three';
import type { Mo2MeshOption } from '@/lib/head/faceTexture';
import { addDynamicHeadOption, registerDynamicMesh } from '@/lib/head/dynamicSculpt';
import {
  MeshImportError,
  mergeSceneMeshes,
  normaliseHead,
  toMeshData,
  type NormalisedHead,
} from '@/lib/smart/headMesh';
import { isMeshFile } from '@/lib/smart/smartMode';

/**
 * Load an uploaded `.obj`/`.glb`/`.gltf` and register it as a head the character
 * can wear.
 *
 * This is deliberately the same shape as `lib/head/nifImport.ts`: decode →
 * `registerDynamicMesh('dynamic://meshes/…')` → `addDynamicHeadOption`. That
 * reuse is why no renderer change is needed — `assetOptions` already prepends
 * dynamic heads, and `resolveManifest` passes `dynamic://` URLs through
 * untouched.
 */

export interface ImportedHead {
  option: Mo2MeshOption;
  mesh: NormalisedHead;
  /** 2D projection used for the dropzone thumbnail. */
  preview: { edges: Float32Array; width: number; height: number };
}

function readAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new MeshImportError('this file could not be read'));
    reader.readAsText(file);
  });
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new MeshImportError('this file could not be read'));
    reader.readAsArrayBuffer(file);
  });
}

function loadObject(file: File): Promise<THREE.Object3D> {
  const lower = file.name.toLowerCase();
  const manager = undefined;

  if (lower.endsWith('.obj')) {
    return readAsText(file).then(
      (text) => new Promise<THREE.Object3D>((resolve, reject) => {
        try {
          resolve(new OBJLoader(manager).parse(text));
        } catch (error) {
          reject(new MeshImportError(
            `this .obj could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
          ));
        }
      }),
    );
  }

  if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
    return readAsArrayBuffer(file).then(
      (buffer) => new Promise<THREE.Object3D>((resolve, reject) => {
        new GLTFLoader(manager).parse(
          buffer,
          '',
          (gltf) => resolve(gltf.scene ?? gltf.scenes[0]),
          (error) => reject(new MeshImportError(
            `this model could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
          )),
        );
      }),
    );
  }

  throw new MeshImportError('only .obj, .glb and .gltf files can be assigned to the head');
}

/**
 * Project the head's front view to a small edge list for the dropzone thumbnail.
 *
 * Deliberately cheap — every triangle edge between X/Y, drawn as a faint net.
 * It is a 96×96 preview, not a render: no depth sort, no shading, no GPU. The
 * point is that the user can see *their* mesh arrived before they commit.
 */
function buildPreview(mesh: NormalisedHead, size = 96): ImportedHead['preview'] {
  const { positions, indices } = mesh;
  const vertexCount = positions.length / 3;
  if (vertexCount === 0) return { edges: new Float32Array(0), width: size, height: size };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const pad = size * 0.12;
  const scale = (size - pad * 2) / span;
  const offsetX = (size - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (size - (maxY - minY) * scale) / 2 - minY * scale;

  /* Deduplicate edges: a closed mesh shares almost every edge between two
     triangles, and drawing both doubles the ink for no added information. */
  const seen = new Set<number>();
  const edges: number[] = [];
  const pushEdge = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * vertexCount + hi;
    if (seen.has(key)) return;
    seen.add(key);
    /* Y is flipped so the canvas reads the model the right way up. */
    edges.push(
      positions[lo * 3] * scale + offsetX,
      size - (positions[lo * 3 + 1] * scale + offsetY),
      positions[hi * 3] * scale + offsetX,
      size - (positions[hi * 3 + 1] * scale + offsetY),
    );
  };

  /* A dense scan is fine at 96 px; cap the work on pathological meshes so a
     200k-triangle upload cannot stall the main thread on the preview alone. */
  const limit = Math.min(indices.length, 60_000);
  for (let t = 0; t + 2 < limit; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    pushEdge(a, b); pushEdge(b, c); pushEdge(c, a);
  }

  return { edges: new Float32Array(edges), width: size, height: size };
}

export async function readHeadFile(file: File): Promise<ImportedHead> {
  if (!isMeshFile(file.name)) {
    throw new MeshImportError('only .obj, .glb and .gltf files can be assigned to the head');
  }
  const object = await loadObject(file);
  const merged = mergeSceneMeshes(object);
  const normalised = normaliseHead(merged);

  const stem = file.name.replace(/\.[^.]+$/, '').trim() || 'imported';
  const safeStem = stem.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const meshId = `smart-head-${safeStem}-${Date.now()}`;
  const meshUrl = `dynamic://meshes/${meshId}.json`;

  registerDynamicMesh(meshUrl, toMeshData(normalised));

  const option: Mo2MeshOption = {
    id: meshId,
    mod: 'Smart Customization',
    rel: `Smart/${file.name}`,
    file: file.name,
    label: `${stem} (Imported Head)`,
    meshUrl,
    isRealMesh: true,
    /* The imported mesh has no UBE atlas UVs. Declaring that is what makes
       `resolveManifest` drop skin/normal/roughness for this head, so the renderer
       draws its deliberate grey sculpt instead of smearing a UBE face onto
       unknown UVs. */
    headTextureMissing: true,
    origin: 'mesh-import',
    bytes: file.size,
    version: 'OBJ',
    nodes: [],
    shapes: {
      vertexCount: normalised.positions.length / 3,
      triangleCount: normalised.indices.length / 3,
    },
  };

  addDynamicHeadOption(option);

  return { option, mesh: normalised, preview: buildPreview(normalised) };
}
