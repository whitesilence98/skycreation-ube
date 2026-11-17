import type { Mo2MeshOption, Mo2Manifest } from '@/lib/head/faceTexture';
import { registerDynamicMesh, addDynamicHeadOption, getDynamicSculptHeads, resolveOrBuildSculptHead } from '@/lib/head/dynamicSculpt';
import type { MeshData } from '@/components/scene/useMeshGeometry';
import { parsePreset, payloadFromMorphs, type PresetPayload } from '@/lib/presetIO';
import { sculptHeadFor } from '@/lib/manifestSelect';

export interface DecodedNifResponse {
  ok: boolean;
  fileName?: string;
  head?: MeshData;
  mouth?: MeshData;
  eyes?: MeshData;
  lashes?: MeshData;
  brows?: MeshData;
  error?: string;
}

/**
 * Uploads a binary Skyrim .nif file to `/api/nif` for decoding into Three.js
 * attribute buffers, registers the resulting meshes into the dynamic cache,
 * and returns a Mo2MeshOption ready to load into the store.
 */
export async function decodeAndRegisterNif(file: File): Promise<Mo2MeshOption> {
  const formData = new FormData();
  formData.append('file', file, file.name);

  const res = await fetch('/api/nif', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.error || `Failed to decode NIF file (HTTP ${res.status})`);
  }

  const data = (await res.json()) as DecodedNifResponse;
  if (!data.ok || !data.head) {
    throw new Error(data.error || 'NIF file did not contain a valid female head shape');
  }

  const safeStem = file.name.replace(/\.nif$/i, '').trim();
  const timestamp = Date.now();
  const headMeshId = `dynamic-nif-${safeStem.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}-${timestamp}`;
  const dynamicHeadUrl = `dynamic://meshes/${headMeshId}.json`;

  registerDynamicMesh(dynamicHeadUrl, data.head);

  let mouthMeshUrl: string | undefined;
  let eyeMeshUrl: string | undefined;
  let lashesMeshUrl: string | undefined;
  let browsMeshUrl: string | undefined;

  if (data.mouth) {
    mouthMeshUrl = `dynamic://meshes/${headMeshId}-mouth.json`;
    registerDynamicMesh(mouthMeshUrl, data.mouth);
  }
  if (data.eyes) {
    eyeMeshUrl = `dynamic://meshes/${headMeshId}-eyes.json`;
    registerDynamicMesh(eyeMeshUrl, data.eyes);
  }
  if (data.lashes) {
    lashesMeshUrl = `dynamic://meshes/${headMeshId}-lashes.json`;
    registerDynamicMesh(lashesMeshUrl, data.lashes);
  }
  if (data.brows) {
    browsMeshUrl = `dynamic://meshes/${headMeshId}-brows.json`;
    registerDynamicMesh(browsMeshUrl, data.brows);
  }

  const dynamicOption: Mo2MeshOption = {
    id: headMeshId,
    mod: 'RaceMenu',
    rel: `RaceMenu/${file.name}`,
    file: file.name,
    label: `${safeStem} (Imported NIF)`,
    meshUrl: dynamicHeadUrl,
    isRealMesh: true,
    sculptSource: file.name,
    origin: 'racemenu-export',
    bytes: file.size,
    version: 'BSDynamicTriShape',
    nodes: [],
    shapes: {
      vertexCount: data.head.positions.length / 3,
      triangleCount: data.head.indices.length / 3,
    },
    eyeMeshUrl,
    lashesMeshUrl,
    browsMeshUrl,
    mouthMeshUrl,
  };

  addDynamicHeadOption(dynamicOption);
  return dynamicOption;
}

export interface ImportPresetResult {
  payload: PresetPayload;
  headOption?: Mo2MeshOption;
  characterName?: string;
  summary: string;
  kind: 'ok' | 'warn';
}

/**
 * High-level import handler for presets and NIF files.
 * Supports:
 * - Single .jslot or .json file
 * - Single .nif file (baked 3D head geometry)
 * - Dual import: .jslot/.json + .nif selected together!
 */
export async function importPresetFromFiles(
  files: File[] | FileList,
  manifest: Mo2Manifest | null,
): Promise<ImportPresetResult> {
  const fileList = Array.from(files);
  if (!fileList.length) {
    throw new Error('No files selected for import.');
  }

  const nifFile = fileList.find((f) => /\.nif$/i.test(f.name));
  const presetFile = fileList.find((f) => /\.(jslot|json)$/i.test(f.name));

  if (!nifFile && !presetFile) {
    throw new Error('Please select a .jslot, .json, or .nif file.');
  }

  // Dual import: both .nif and .jslot/.json provided together
  if (nifFile && presetFile) {
    const headOption = await decodeAndRegisterNif(nifFile);
    const text = await presetFile.text();
    const rawPayload = parsePreset(text, presetFile.name);

    // The NIF geometry is already baked by RaceMenu, so zero out slider morphs if racemenu
    const payload: PresetPayload =
      rawPayload.source === 'racemenu'
        ? { ...rawPayload, regions: payloadFromMorphs([], { baked: true }).regions }
        : rawPayload;

    const charName = rawPayload.name || nifFile.name.replace(/\.nif$/i, '').trim();
    const summary = `IMPORTED ${presetFile.name} + ${nifFile.name}`;

    return {
      payload,
      headOption,
      characterName: charName,
      summary,
      kind: 'ok',
    };
  }

  // Single .nif import: baked 3D sculpted head
  if (nifFile) {
    const headOption = await decodeAndRegisterNif(nifFile);
    const safeStem = nifFile.name.replace(/\.nif$/i, '').trim();
    const payload = payloadFromMorphs([], { name: safeStem, baked: true });
    const summary = `IMPORTED ${nifFile.name} (3D SCULPT HEAD)`;

    return {
      payload,
      headOption,
      characterName: safeStem,
      summary,
      kind: 'ok',
    };
  }

  // Single .jslot or .json import
  if (presetFile) {
    const text = await presetFile.text();
    const rawPayload = parsePreset(text, presetFile.name);
    const dynamicHead = await resolveOrBuildSculptHead(manifest, text, presetFile.name);
    const head = dynamicHead ?? sculptHeadFor(manifest, rawPayload.sourceFile);

    const isBaked = rawPayload.source === 'racemenu' && head?.origin === 'racemenu-export';
    const payload: PresetPayload = isBaked
      ? { ...rawPayload, regions: payloadFromMorphs([], { baked: true }).regions }
      : rawPayload;

    let summary = `IMPORTED ${presetFile.name}`;
    let kind: 'ok' | 'warn' = 'ok';

    if (rawPayload.source === 'racemenu') {
      const notes: string[] = [];
      if (rawPayload.unmapped) notes.push(`${rawPayload.unmapped} MORPHS UNMAPPED`);
      if (head) notes.push(`HEAD ${head.label.toUpperCase()}`);
      else notes.push('NO BAKED HEAD');
      summary = `IMPORTED ${presetFile.name} · ${notes.join(' · ')}`;
      if (rawPayload.unmapped || !head) kind = 'warn';
    }

    return {
      payload,
      headOption: head,
      characterName: rawPayload.name,
      summary,
      kind,
    };
  }

  throw new Error('Unsupported file selection.');
}
