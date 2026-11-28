import type { Mo2MeshOption, Mo2Manifest } from '@/lib/head/faceTexture';
import { registerDynamicMesh, addDynamicHeadOption, resolveOrBuildSculptHead } from '@/lib/head/dynamicSculpt';
import type { MeshData } from '@/components/scene/useMeshGeometry';
import { parsePreset, payloadFromMorphs, type PresetPayload } from '@/lib/presetIO';
import { sculptHeadFor } from '@/lib/manifestSelect';
import { fetchCatalogue } from '@/lib/mo2/client';
import { ensureActiveUbeCategories, loadUbeMorphIndex } from '@/lib/morphs/ubeMorphLoader';

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

async function resolveLashesFromHeadParts(
  headParts: PresetPayload['headParts'],
  manifest: Mo2Manifest | null,
): Promise<{ lashesId: string; note: string } | null> {
  const lashPart = headParts?.find((p) => /lash/i.test(p.formIdentifier));
  if (!lashPart) return null;

  const fromManifest = manifest?.assets?.lashes;
  const rawList = fromManifest?.length
    ? fromManifest
    : await fetchCatalogue('lashes').catch(() => []);
  const albedos = rawList.filter((e) => (e as { mapRole?: string }).mapRole !== 'normal');
  if (!albedos.length) return null;

  const tokens = lashPart.formIdentifier
    .toLowerCase()
    .split(/[|\s._-]+/)
    .filter((t) => t.length >= 3 && !['ube', 'esp', 'esm', 'esl', 'addon', 'lash', 'lashes', '2'].includes(t));

  const direct = tokens.length
    ? albedos.find((e) => {
        const hay = `${e.label ?? ''} ${e.file ?? ''} ${e.rel ?? ''}`.toLowerCase();
        return tokens.some((t) => hay.includes(t));
      })
    : undefined;

  if (direct) {
    const name = (direct.label ?? direct.file ?? direct.id).toUpperCase();
    return { lashesId: direct.id, note: `LASHES ${name}` };
  }

  // Fallback for external lash mods (e.g. Lashivious Lashes) not synced in pack
  const preferred =
    albedos.find((e) => /deliah/i.test(e.label ?? e.file ?? '')) ??
    albedos.find((e) => /eyefemalelashes/i.test(e.file ?? '')) ??
    albedos[0];

  const prefName = (preferred.label ?? preferred.file ?? preferred.id).toUpperCase();
  return { lashesId: preferred.id, note: `LASHES ${prefName} (PACK MATCH)` };
}

async function resolveUbeMorphsFromCustom(
  rawMorphs: PresetPayload['rawCustomMorphs'],
): Promise<{ ubeMorphs: Record<string, number>; handledNames: Set<string> } | undefined> {
  if (!rawMorphs?.length) return undefined;
  const index = await loadUbeMorphIndex();
  if (!index) return undefined;

  const canonicalByLower = new Map<string, string>();
  for (const name of Object.keys(index.morphToCategory)) {
    canonicalByLower.set(name.toLowerCase(), name);
    const bare = name.replace(/^(?:EYES|FACE|LIP|EAR|NOSE|BROW|PERS|NEW)_/i, '');
    canonicalByLower.set(bare.toLowerCase(), name);
  }

  const out: Record<string, number> = {};
  const handledNames = new Set<string>();
  const iniSliders = new Map<string, [string, string]>();
  for (const [k, v] of Object.entries(index.iniSliders ?? {})) {
    iniSliders.set(k.toLowerCase(), v);
  }

  for (const { name, value } of rawMorphs) {
    if (!value || !Number.isFinite(value) || Math.abs(value) <= 0.001) continue;

    // 1. Prefer authored RaceMenu CharGen INI mapping (exact NegMorph / PosMorph polarity)
    const iniPair = iniSliders.get(name.toLowerCase());
    if (iniPair) {
      handledNames.add(name);
      const target = value >= 0 ? iniPair[1] : iniPair[0];
      if (target && index.morphToCategory[target]) {
        out[target] = Math.min(2, Math.abs(value));
      }
      continue;
    }

    const stripped = name.replace(/^[A-Z0-9]{2,4}_/, '');
    const lower = stripped.toLowerCase();

    const exact = canonicalByLower.get(lower);
    if (exact) {
      out[exact] = Math.max(-2, Math.min(2, value));
      handledNames.add(name);
      continue;
    }

    // 2. Fallback heuristic only for sliders absent from UBE INI
    const pairs: Array<[string, string]> = value >= 0
      ? [['out', 'in'], ['up', 'down'], ['upper', 'lower'], ['big', 'small'], ['forward', 'back'], ['wide', 'narrow'], ['longer', 'shorter']]
      : [['in', 'out'], ['down', 'up'], ['lower', 'upper'], ['small', 'big'], ['back', 'forward'], ['narrow', 'wide'], ['shorter', 'longer']];

    for (const [posSuffix] of pairs) {
      const hit =
        canonicalByLower.get(`${lower}${posSuffix}`) ??
        canonicalByLower.get(`${lower}_${posSuffix}`);
      if (hit) {
        out[hit] = Math.min(2, Math.abs(value));
        handledNames.add(name);
        break;
      }
    }
  }

  if (Object.keys(out).length === 0) return undefined;
  await ensureActiveUbeCategories(out);
  return { ubeMorphs: out, handledNames };
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

    const [lashMatch, ubeResolved] = await Promise.all([
      !rawPayload.assets?.lashes && rawPayload.headParts?.length
        ? resolveLashesFromHeadParts(rawPayload.headParts, manifest)
        : Promise.resolve(null),
      rawPayload.rawCustomMorphs?.length
        ? resolveUbeMorphsFromCustom(rawPayload.rawCustomMorphs)
        : Promise.resolve(undefined),
    ]);

    // The NIF geometry is already baked by RaceMenu, so zero out slider morphs if racemenu
    const basePayload: PresetPayload =
      rawPayload.source === 'racemenu'
        ? { ...rawPayload, regions: payloadFromMorphs([], { baked: true }).regions }
        : rawPayload;
    const withUbe: PresetPayload = ubeResolved?.ubeMorphs && rawPayload.source !== 'racemenu'
      ? { ...basePayload, ubeMorphs: ubeResolved.ubeMorphs }
      : basePayload;
    const payload: PresetPayload = lashMatch
      ? { ...withUbe, assets: { ...withUbe.assets, lashes: lashMatch.lashesId } }
      : withUbe;

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

    const [lashMatch, ubeResolved] = await Promise.all([
      !rawPayload.assets?.lashes && rawPayload.headParts?.length
        ? resolveLashesFromHeadParts(rawPayload.headParts, manifest)
        : Promise.resolve(null),
      rawPayload.rawCustomMorphs?.length
        ? resolveUbeMorphsFromCustom(rawPayload.rawCustomMorphs)
        : Promise.resolve(undefined),
    ]);

    const ubeMorphs = ubeResolved?.ubeMorphs;
    const isBaked = rawPayload.source === 'racemenu' && head?.origin === 'racemenu-export';
    let basePayload: PresetPayload;
    if (isBaked) {
      basePayload = { ...rawPayload, regions: payloadFromMorphs([], { baked: true }).regions };
    } else if (rawPayload.source === 'racemenu' && ubeResolved && rawPayload.rawCustomMorphs?.length) {
      // Exclude UBE TRI vertex morphs from bone sliders so they are never double-applied on skeleton scale
      const nonUbeCustom = rawPayload.rawCustomMorphs.filter((m) => !ubeResolved.handledNames.has(m.name));
      basePayload = {
        ...rawPayload,
        regions: payloadFromMorphs(nonUbeCustom, { baked: true }).regions,
      };
    } else {
      basePayload = rawPayload;
    }
    const withUbe: PresetPayload = ubeMorphs && !isBaked
      ? { ...basePayload, ubeMorphs }
      : basePayload;
    const payload: PresetPayload = lashMatch
      ? { ...withUbe, assets: { ...withUbe.assets, lashes: lashMatch.lashesId } }
      : withUbe;

    let summary = `IMPORTED ${presetFile.name}`;
    let kind: 'ok' | 'warn' = 'ok';

    if (rawPayload.source === 'racemenu') {
      const notes: string[] = [];
      const ubeCount = ubeMorphs ? Object.keys(ubeMorphs).length : 0;
      const exprCount = rawPayload.facialExpressions ? Object.keys(rawPayload.facialExpressions).length : 0;
      if (ubeCount) notes.push(`${ubeCount} UBE MORPHS`);
      if (exprCount) notes.push(`${exprCount} EXPR`);
      if (rawPayload.unmapped && !ubeCount) notes.push(`${rawPayload.unmapped} MORPHS UNMAPPED`);
      if (head) notes.push(`HEAD ${head.label.toUpperCase()}`);
      else if (!ubeCount) notes.push('NO BAKED HEAD');
      if (lashMatch) notes.push(lashMatch.note);
      summary = `IMPORTED ${presetFile.name} · ${notes.join(' · ')}`;
      if ((rawPayload.unmapped && !ubeCount) || (!head && !ubeCount)) kind = 'warn';
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
