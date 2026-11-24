import type {
  Mo2AssetOption, Mo2EyeOption, Mo2HairOption, Mo2Manifest, Mo2MeshOption,
  Mo2PartOption, Mo2PresetOption, Mo2SkeletonOption, Mo2SkinOption,
} from '@/lib/head/faceTexture';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { convertUrl } from '@/lib/mo2/client';
import { EQUIP_SLOTS, isWholeOutfit, equipSlotOf, type EquipSelection, type EquipSlot } from '@/lib/equipment';
import { getDynamicSculptHeads } from '@/lib/head/dynamicSculpt';
import { buildHairGroups, findHairGroupForPartId } from '@/lib/hair';
import { findCuratedGlbHair } from '@/lib/hairGlbRegistry';

export type PartMeshKind = 'headMesh' | 'eyeMesh' | 'lashesMesh' | 'browsMesh' | 'mouthMesh' | 'bodyMesh' | 'handsMesh' | 'feetMesh' | 'hairMesh' | 'clothingMesh';
export type AssetKind = PartMeshKind | 'skin' | 'eyes' | 'lashes' | 'brows' | 'mouth' | 'body' | 'hair' | 'clothing'
  | 'skeleton' | 'preset' | 'makeup' | 'tattoo';
export type AssetSelection = Partial<Record<AssetKind, string>>;
export type AssetCatalogues = Partial<Record<AssetKind, CatalogueEntry[]>>;

export const ASSET_KINDS: AssetKind[] = [
  'headMesh', 'eyeMesh', 'lashesMesh', 'browsMesh', 'mouthMesh', 'bodyMesh', 'handsMesh', 'feetMesh', 'hairMesh', 'clothingMesh',
  'skin', 'eyes', 'lashes', 'brows', 'mouth', 'body', 'hair', 'clothing',
  'skeleton', 'preset', 'makeup', 'tattoo',
];
export const OVERLAY_KINDS = ['makeup', 'tattoo'] as const;
export const MANIFEST_KINDS = ASSET_KINDS.filter((kind) => !isOverlayKind(kind));
export function isOverlayKind(kind: string): boolean {
  return (OVERLAY_KINDS as readonly string[]).includes(kind);
}
export interface CategorySpec { label: string; mesh?: AssetKind; texture?: AssetKind }
export const CATEGORY_MAP: Record<'headMesh' | 'eyes' | 'lashes' | 'brows' | 'mouth' | 'body' | 'hands' | 'feet' | 'hair' | 'clothing' | 'equipment' | 'skin' | 'makeup' | 'tattoo' | 'skeleton' | 'preset', CategorySpec> = {
  headMesh: { label: 'HEAD', mesh: 'headMesh', texture: 'skin' },
  eyes: { label: 'EYES', mesh: 'eyeMesh', texture: 'eyes' },
  lashes: { label: 'LASHES', mesh: 'lashesMesh', texture: 'lashes' },
  brows: { label: 'BROWS', mesh: 'browsMesh', texture: 'brows' },
  mouth: { label: 'MOUTH', mesh: 'mouthMesh', texture: 'mouth' },
  body: { label: 'BODY', mesh: 'bodyMesh', texture: 'body' },
  /* Hands and feet are separate geometry slots that wear the BODY atlas; they
     list `body` textures rather than introducing new texture kinds. */
  hands: { label: 'HANDS', mesh: 'handsMesh', texture: 'body' },
  feet: { label: 'FEET', mesh: 'feetMesh', texture: 'body' },
  hair: { label: 'HAIR', mesh: 'hairMesh', texture: 'hair' },
  clothing: { label: 'CLOTHING', mesh: 'clothingMesh', texture: 'clothing' },
  /* EQUIPMENT lists the same mesh kind as CLOTHING: a worn garment *is* a
     `clothingMesh` row. Only the pick target differs — the paper-doll fills
     `equipment[slot]` instead of the single `clothingMesh` id, and the list is
     filtered to the active slot. */
  equipment: { label: 'EQUIPMENT', mesh: 'clothingMesh', texture: 'clothing' },
  skin: { label: 'SKIN', texture: 'skin' },
  makeup: { label: 'MAKEUP', texture: 'makeup' },
  tattoo: { label: 'TATTOO', texture: 'tattoo' },
  skeleton: { label: 'SKELETON' }, preset: { label: 'PRESET' },
} satisfies Record<string, CategorySpec>;
export type UiCategory = keyof typeof CATEGORY_MAP;

export type PartOption = Mo2PartOption & { pairedTextureId?: string };
export interface AssetOptionMap {
  skin: Mo2SkinOption; eyes: Mo2EyeOption; hair: Mo2HairOption;
  headMesh: Mo2MeshOption; skeleton: Mo2SkeletonOption; preset: Mo2PresetOption;
  eyeMesh: PartOption; lashesMesh: PartOption; browsMesh: PartOption;
  mouthMesh: PartOption; bodyMesh: PartOption; handsMesh: PartOption; feetMesh: PartOption;
  hairMesh: PartOption; clothingMesh: PartOption;
  lashes: PartOption; brows: PartOption; mouth: PartOption; body: PartOption; clothing: PartOption;
}
export function assetOptions<K extends keyof AssetOptionMap>(manifest: Mo2Manifest | null, kind: K): Array<AssetOptionMap[K]>;
export function assetOptions(manifest: Mo2Manifest | null, kind: AssetKind): Mo2AssetOption[];
export function assetOptions(manifest: Mo2Manifest | null, kind: AssetKind): Mo2AssetOption[] {
  if (isOverlayKind(kind)) return [];
  const assets = manifest?.assets as Partial<Record<AssetKind, Mo2AssetOption[]>> | undefined;
  const list = assets?.[kind] ?? [];
  if (kind === 'headMesh') {
    const dynamicHeads = getDynamicSculptHeads();
    return dynamicHeads.length ? [...dynamicHeads, ...list] : list;
  }
  return list;
}
export function defaultAssetId(manifest: Mo2Manifest | null, kind: AssetKind): string | undefined {
  return assetOptions(manifest, kind)[0]?.id;
}

/** Find an explicitly linked export or sculpt replay; accept only unique stem matches. */
export function sculptHeadFor(
  manifest: Mo2Manifest | null,
  jslotName: string | undefined,
): Mo2MeshOption | undefined {
  const wanted = jslotName?.trim().toLowerCase();
  if (!wanted) return undefined;
  const heads = assetOptions(manifest, 'headMesh') as Mo2MeshOption[];
  const baked = heads.find((h) => h.sculptSource?.toLowerCase() === wanted);
  if (baked) return baked;
  /* A LYRA export names the preset rather than the `.jslot`. Accept a unique
     stem match ("Frau" → "Frau.jslot" or "Frau.nif") so exports round-trip too, but only
     when exactly one head claims it — an ambiguous stem must not pick a face. */
  const stem = wanted.replace(/\.(jslot|nif)$/i, '');
  const hits = heads.filter(
    (h) => h.sculptSource?.toLowerCase().replace(/\.(jslot|nif)$/i, '') === stem,
  );
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * Can this catalogue/manifest row be served as geometry?
 *
 * A row is renderable when it decodes and either has its atlases or is the
 * producer's explicit `untextured` case (decodable geometry whose DDS are
 * absent — drawn flat grey). Anything the producer marked undecodable, or
 * unavailable without that exemption, stays refused.
 */
export function isRenderableMeshRow(row: {
  decodable?: boolean;
  available?: boolean;
  unavailable?: boolean;
  untextured?: boolean;
}): boolean {
  if (row.decodable === false) return false;
  if (row.untextured === true) return true;
  return row.available !== false && !row.unavailable;
}

/** Prefer a fully textured row; fall back to grey, then to the raw first row. */
function preferredOption(list: Array<{ available?: boolean; unavailable?: boolean; decodable?: boolean; untextured?: boolean }>) {
  return list.find((o) => isRenderableMeshRow(o) && o.untextured !== true)
    ?? list.find(isRenderableMeshRow)
    ?? list[0];
}

/**
 * The default row for a kind, which is not always the first renderable one.
 *
 * `clothingMesh` now holds two populations: the whole-body outfit (the `full`
 * pseudo-slot) and the individual garments the paper-doll wears. The legacy
 * default must stay the *outfit* — the pack's own first row has always been
 * that NIF, and BODY → OUTFIT is the control that draws it. Falling through to
 * whichever garment happened to sort first would quietly swap the body.
 */
function defaultRowFor(kind: string, list: Array<PartOption>): PartOption | undefined {
  if (kind === 'clothingMesh') {
    const outfit = list.filter((o) => isWholeOutfit(o));
    if (outfit.length) return preferredOption(outfit) as PartOption | undefined;
  }
  return preferredOption(list) as PartOption | undefined;
}

/**
 * A `_0`/`_1` pair as two convert URLs.
 *
 * The producer records the pair either as catalogue ids (on a catalogue row) or
 * already as route URLs (on the manifest's own default row), so each half is
 * only wrapped when it is still an id.
 */
export function weightVariantsFor(
  meshKind: string,
  row: { weightKey?: string; weightVariants?: { w0: string; w1: string } } | undefined,
): { w0: string; w1: string } | undefined {
  if (!row?.weightKey || !row.weightVariants) return undefined;
  const url = (v: string) => (v.startsWith('/') ? v : convertUrl({ kind: meshKind, id: v, mode: 'mesh' }));
  return { w0: url(row.weightVariants.w0), w1: url(row.weightVariants.w1) };
}

export function findClothingOption(
  rows: PartOption[],
  catalogues: AssetCatalogues,
  id: string,
): PartOption | undefined {
  return (
    rows.find((o) => o.id === id || o.weightVariants?.w0 === id || o.weightVariants?.w1 === id)
    ?? (catalogues.clothingMesh?.find((e) => (e.id === id || e.weightVariants?.w0 === id || e.weightVariants?.w1 === id) && e.mapRole === 'mesh') as PartOption | undefined)
    ?? undefined
  );
}

/** Only registered catalogue ids resolve to URLs. Unknown/stale preset ids use the offline default. */
export function resolveManifest(
  manifest: Mo2Manifest | null,
  selection: AssetSelection,
  catalogues: AssetCatalogues = {},
  equipment: EquipSelection = {},
  options?: { unrestrictedSlots?: boolean },
): Mo2Manifest | null {
  if (!manifest) return null;
  const resolveMeshUrl = (kind: string, option: PartOption | undefined): PartOption | undefined => {
    if (!option || option.meshUrl) return option;
    const id = option.catalogueId ?? option.id;
    /* Undecodable rows are never served; an `untextured` row is decodable but
       has no atlas, and the worker will emit geometry with no texture URLs. */
    if (!isRenderableMeshRow(option) || !id) return option;
    return { ...option, meshUrl: convertUrl({ kind, id, mode: 'mesh' }) };
  };
  const pick = <K extends keyof AssetOptionMap>(kind: K): AssetOptionMap[K] | undefined => {
    const list = assetOptions(manifest, kind);
    const id = selection[kind];
    const mesh = kind.endsWith('Mesh');
    const curated = list.find((option) => option.id === id);
    if (curated) {
      return (mesh ? resolveMeshUrl(kind, curated as PartOption) : curated) as AssetOptionMap[K];
    }
    const entry = id ? catalogues[kind]?.find((e) => e.id === id && (mesh ? e.mapRole === 'mesh' : (e.mapRole ?? 'albedo') === 'albedo')
      && (mesh ? isRenderableMeshRow(e) : e.available !== false && !e.unavailable)) : undefined;
    if (!entry || kind === 'preset' || kind === 'skeleton') {
      /* The default is as likely to be an on-demand row as an explicit pick,
         so it goes through the same worker URL resolution. A textured option
         always wins; grey is only chosen when nothing textured renders. */
      const fallback = defaultRowFor(kind, list as PartOption[]) as PartOption | undefined;
      return (mesh ? resolveMeshUrl(kind, fallback) : fallback) as AssetOptionMap[K];
    }
    const base = defaultRowFor(kind, list as PartOption[]) as PartOption | undefined;
    const url = (mode: Parameters<typeof convertUrl>[0]['mode'], entryId = entry.id) => convertUrl({ kind, id: entryId, mode });
    const normal = entry.normalId ? url('normal', entry.normalId) : undefined;
    return {
      ...base, ...entry,
      ...(mesh ? {
        meshUrl: url('mesh'), isRealMesh: true, version: 'FRTRI003 / OBJ', nodes: [], shapes: {},
      } : {
        texture: url('atlas'), normalTexture: normal,
        ...(kind === 'skin' ? {
          palette: (base as Mo2SkinOption | undefined)?.palette ?? manifest.skin,
          atlasFit: manifest.atlasFit ? { ...manifest.atlasFit, measured: false } : undefined,
        } : {}),
        ...(kind === 'eyes' ? {
          iris: manifest.eye?.iris ?? '#80705b', mean: manifest.eye?.mean ?? '#80705b',
          atlas: { ...(manifest.eye?.atlas ?? { cx: 0.497, cy: 0.754, r: 0.126 }), measured: false },
          discTexture: url('disc'),
        } : {}),
        ...(kind === 'hair' ? { groups: undefined, capWindow: undefined, usable: true } : {}),
      }),
    } as unknown as AssetOptionMap[K];
  };
  const skin = pick('skin');
  const eye = pick('eyes');
  const hair = pick('hair');
  const preset = pick('preset');
  const explicitHead = selection.headMesh ? pick('headMesh') : undefined;
  const head = explicitHead ?? sculptHeadFor(manifest, preset?.file) ?? pick('headMesh');
  const skel = pick('skeleton');
  const eyeMesh = pick('eyeMesh');
  const body = pick('body');
  const clothing = pick('clothing');
  const mods: Record<string, string | null> = { ...(manifest.mods ?? {}) };
  for (const kind of MANIFEST_KINDS) {
    const option = pick(kind as keyof AssetOptionMap);
    if (option) mods[kind] = option.rel;
  }
  /**
   * One part's resolved geometry and atlases.
   *
   * `name` is the manifest part key (`parts.<name>`); `textureKind` is the
   * catalogue kind its atlases come from. They usually match, but hands and
   * feet wear the shared BODY atlas, so their routes say `kind=body` even
   * though their part keys are `hands`/`feet`.
   */
  const companionEyeMesh = selection.eyeMesh ? undefined : (head as { eyeMeshUrl?: string })?.eyeMeshUrl;
  const companionLashesMesh = selection.lashesMesh ? undefined : (head as { lashesMeshUrl?: string })?.lashesMeshUrl;
  const companionBrowsMesh = selection.browsMesh ? undefined : (head as { browsMeshUrl?: string })?.browsMeshUrl;
  const companionMouthMesh = selection.mouthMesh ? undefined : (head as { mouthMeshUrl?: string })?.mouthMeshUrl;

  const pairedBody = !selection.body && (skin as any)?.bodyTexture ? {
    texture: (skin as any).bodyTexture as string,
    normalTexture: ((skin as any).bodyNormalTexture as string | null | undefined) ?? undefined,
    roughnessTexture: ((skin as any).bodyRoughnessTexture as string | null | undefined) ?? undefined,
  } : undefined;
  const defaultBodyTexture = manifest.textures?.body;
  const defaultBodyNormal = manifest.textures?.bodyNormal;
  const defaultBodyRoughness = manifest.textures?.bodyRoughness;

  const part = (
    name: 'mouth' | 'brows' | 'lashes' | 'body' | 'hands' | 'feet' | 'hair' | 'clothing',
    meshKind: keyof AssetOptionMap,
    textureKind: string = name,
  ) => {
    const texture = pick(textureKind as keyof AssetOptionMap) as PartOption | undefined;
    const mesh = pick(meshKind) as PartOption | undefined;
    const fallback = manifest.parts?.[name] ?? (name === 'body' ? manifest.body : undefined);
    const pairId = mesh?.pairedTextureId ?? catalogues[meshKind]?.find((e) => e.rel === mesh?.rel)?.pairedTextureId;
    /* A shared texture override (`body` for the extremities too) beats any
       authored pairing: the user asked for that atlas explicitly. */
    const pair = !selection[textureKind as AssetKind] && pairId
      ? catalogues[textureKind as AssetKind]?.find((e) => e.id === pairId && (e.mapRole ?? 'albedo') === 'albedo')
      : undefined;
    /* Undecodable rows keep their id for the picker but are never drawn.
       `untextured` rows are drawn, in grey: a blocked-looking slot would
       otherwise hide geometry the pack actually supplied. A grey row also
       names no atlas — painting some other style's atlas over UVs it was not
       authored for would be worse than the honest placeholder. */
    /* A `_0`/`_1` pair is two meshes with the same topology. The producer
       records the pair either as catalogue ids (on a catalogue row) or already
       as route URLs (on the manifest's own default row), so each half is only
       wrapped when it is still an id. Read the pair off the row that actually
       represents the selection — a single/nonpaired row must not inherit the
       default's pair through the merged `base` object in `pick`. */
    const selectedMeshRow = (() => {
      const id = selection[meshKind as AssetKind];
      if (id) {
        if (meshKind === 'clothingMesh') {
          const match = findClothingOption(assetOptions(manifest, 'clothingMesh') as PartOption[], catalogues, id);
          if (match) return match;
        }
        const curatedRow = (assetOptions(manifest, meshKind as AssetKind) as PartOption[])
          .find((o) => o.id === id);
        if (curatedRow) return curatedRow;
        const entry = catalogues[meshKind as AssetKind]?.find((e) => e.id === id && e.mapRole === 'mesh');
        if (entry) return entry;
      }
      if (meshKind === 'clothingMesh' && !id) return undefined;
      return defaultRowFor(meshKind as string, assetOptions(manifest, meshKind as AssetKind) as PartOption[]) as PartOption | undefined;
    })();
    const weightVariants = weightVariantsFor(meshKind as string, selectedMeshRow);
    const grey = mesh?.untextured === true;
    const usableTexture = !grey && texture && texture.available !== false ? texture : undefined;
    const usableMesh = mesh && isRenderableMeshRow(mesh) ? mesh : undefined;
    const resolvedTexture = textureKind === 'body'
      ? (pairedBody?.texture ?? usableTexture?.texture ?? fallback?.texture ?? defaultBodyTexture)
      : (usableTexture?.texture ?? (grey ? undefined : fallback?.texture));
    const resolvedNormal = textureKind === 'body'
      ? (pairedBody?.normalTexture ?? (usableTexture ? usableTexture.normalTexture : (grey ? undefined : fallback?.normalTexture)) ?? defaultBodyNormal)
      : (usableTexture ? usableTexture.normalTexture : (grey ? undefined : fallback?.normalTexture));
    const resolvedRoughness = textureKind === 'body'
      ? (pairedBody?.roughnessTexture ?? usableTexture?.roughnessTexture ?? fallback?.roughnessTexture ?? defaultBodyRoughness)
      : (usableTexture?.roughnessTexture ?? fallback?.roughnessTexture);
    return {
      ...(fallback ?? {}), ...(usableTexture ?? {}),
      meshUrl: (name === 'lashes' ? companionLashesMesh : name === 'brows' ? companionBrowsMesh : name === 'mouth' ? companionMouthMesh : undefined)
        ?? (name === 'hair'
          ? usableMesh?.meshUrl
          : (weightVariants?.w0 ?? (name === 'clothing' && usableMesh?.meshUrl ? usableMesh.meshUrl.replace(/_1\.nif/i, '_0.nif') : usableMesh?.meshUrl) ?? (name === 'clothing' && fallback?.meshUrl ? fallback.meshUrl.replace(/_1\.nif/i, '_0.nif') : fallback?.meshUrl) ?? (name === 'body' ? body?.meshUrl : undefined))),
      texture: pair ? convertUrl({ kind: textureKind, id: pair.id, mode: 'atlas' }) : resolvedTexture,
      normalTexture: pair ? (pair.normalId ? convertUrl({ kind: textureKind, id: pair.normalId, mode: 'normal' }) : (textureKind === 'body' ? (pairedBody?.normalTexture ?? defaultBodyNormal) : undefined)) : resolvedNormal,
      roughnessTexture: resolvedRoughness,
      ...(weightVariants ? { weightVariants } : { weightVariants: undefined }),
      ...(mesh?.untextured === true
        ? { untextured: true, missingTextures: mesh.missingTextures, reason: mesh.reason }
        : mesh && !isRenderableMeshRow(mesh)
          ? { available: false as const, reason: mesh.reason }
          : {}),
    } as PartOption;
  };
  const parts = {
    mouth: part('mouth', 'mouthMesh'), brows: part('brows', 'browsMesh'),
    lashes: part('lashes', 'lashesMesh'), body: part('body', 'bodyMesh'),
    hands: part('hands', 'handsMesh', 'body'), feet: part('feet', 'feetMesh', 'body'),
    hair: part('hair', 'hairMesh'), clothing: part('clothing', 'clothingMesh'),
  };
  const fallbackBodyNormal = pairedBody?.normalTexture ?? defaultBodyNormal;
  const fallbackBodyRoughness = pairedBody?.roughnessTexture ?? defaultBodyRoughness;
  const fallbackBodyTexture = pairedBody?.texture ?? defaultBodyTexture;
  for (const partKey of ['body', 'hands', 'feet'] as const) {
    const p = parts[partKey];
    if (p) {
      if (!p.texture && fallbackBodyTexture) p.texture = fallbackBodyTexture;
      if (!p.normalTexture && fallbackBodyNormal) p.normalTexture = fallbackBodyNormal;
      if (!p.roughnessTexture && fallbackBodyRoughness) p.roughnessTexture = fallbackBodyRoughness;
    }
  }
  /**
   * One garment per filled equipment slot.
   *
   * A slot's pick is a `clothingMesh` id, exactly like the whole-outfit pick,
   * but the row is keyed by slot instead: the paper-doll fills several slots
   * at once, and `assetSelection.clothingMesh` can only hold one id. The row
   * is read from the same two sources the picker uses (the manifest's curated
   * list, then the catalogue) and resolved by the same rules — an unavailable
   * or undecodable pick contributes nothing rather than a broken shape.
   *
   * Garments carry no atlas override: each NIF's authored per-material DDS
   * refs are the authority, and one picked atlas painted over another set's
   * UVs would be worse than the grey the renderer already draws.
   *
   * A row the producer classified into a *different* slot is refused: the
   * picker filters by slot, but a preset written by another pack (or an older
   * session) can name a chest garment in the feet slot, and wearing it there
   * would put boots on the hands. A row with no classification is accepted —
   * `equipSlot` is the producer's hint, not a requirement.
   */
  const clothingRows = assetOptions(manifest, 'clothingMesh') as PartOption[];
  const equipmentParts: Array<PartOption & { slot: EquipSlot }> = [];
  for (const slot of EQUIP_SLOTS) {
    const id = equipment[slot];
    if (!id) continue;
    const row = findClothingOption(clothingRows, catalogues, id);
    if (!row || !isRenderableMeshRow(row)) continue;
    const unrestricted = options?.unrestrictedSlots ?? false;
    if (!unrestricted && equipSlotOf(row) !== slot) continue;
    const resolved = resolveMeshUrl('clothingMesh', row);
    if (!resolved?.meshUrl) continue;
    const weightVariants = weightVariantsFor('clothingMesh', row);
    equipmentParts.push({
      ...resolved,
      slot,
      ...(weightVariants ? { weightVariants } : { weightVariants: undefined }),
    });
  }

  /**
   * Multi-part companion NIF resolution for hair.
   *
   * In Skyrim hair mods, high-poly hairstyles are authored across multiple NIFs
   * (e.g. `AsterionM.nif` + `AsterionM2.nif` + `AsterionM3.nif`). We group all
   * companion parts together and emit `parts.hairParts`, sharing the active
   * hair texture and material maps.
   */
  const hairMeshRows = assetOptions(manifest, 'hairMesh') as PartOption[];
  const allHairMeshes: PartOption[] = [
    ...hairMeshRows,
    ...((catalogues.hairMesh ?? []).filter(
      (e) => isRenderableMeshRow(e) && !hairMeshRows.some((c) => c.rel === e.rel),
    ) as PartOption[]),
  ];
  const hairGroups = buildHairGroups(allHairMeshes);
  const activeHairId = selection.hairMesh ?? (parts.hair?.id && !parts.hair.id.startsWith('hairMesh-') ? parts.hair.id : undefined) ?? 'dint_hair_12';
  const activeHairGroup = findHairGroupForPartId(hairGroups, activeHairId);

  const resolvedHairParts: Mo2PartOption[] = [];
  const curatedGlb = findCuratedGlbHair(activeHairId);
  if (curatedGlb) {
    resolvedHairParts.push({
      id: curatedGlb.id,
      label: curatedGlb.label,
      mod: curatedGlb.mod || curatedGlb.author || 'Custom',
      file: curatedGlb.file,
      rel: curatedGlb.file,
      meshUrl: curatedGlb.meshUrl,
    });
  } else if (typeof activeHairId === 'string' && activeHairId.endsWith('.glb')) {
    resolvedHairParts.push({
      id: activeHairId,
      label: 'Custom Hair',
      mod: 'Custom',
      file: activeHairId.split('/').pop() || 'hair.glb',
      rel: activeHairId.split('/').pop() || 'hair.glb',
      meshUrl: activeHairId,
    });
  } else if (activeHairGroup && activeHairGroup.parts.length > 0) {
    for (const p of activeHairGroup.parts) {
      const glbUrl = (p.raw as any)?.meshUrl;
      if (typeof glbUrl === 'string' && glbUrl.endsWith('.glb')) {
        resolvedHairParts.push({
          id: p.id,
          label: p.label,
          mod: (p.raw as any)?.mod || 'Dint999',
          file: (p.raw as any)?.file || 'hair_03.glb',
          rel: (p.raw as any)?.rel || p.id,
          meshUrl: glbUrl,
        });
        continue;
      }
      const resolved = resolveMeshUrl('hairMesh', p.raw);
      if (resolved?.meshUrl) {
        resolvedHairParts.push({
          ...resolved,
          id: p.id,
          label: p.label,
          texture: parts.hair?.texture,
          normalTexture: parts.hair?.normalTexture,
          roughnessTexture: parts.hair?.roughnessTexture,
        });
      }
    }
  } else if (parts.hair?.meshUrl) {
    resolvedHairParts.push(parts.hair);
  }

  return {
    ...manifest, mods,
    parts: {
      ...parts,
      ...(equipmentParts.length ? { equipment: equipmentParts } : {}),
      hairParts: resolvedHairParts.length ? resolvedHairParts : (parts.hair?.meshUrl ? [parts.hair] : undefined),
    },
    textures: {
      ...manifest.textures,
      body: parts.body?.texture ?? manifest.textures?.body,
      bodyNormal: parts.body?.normalTexture ?? manifest.textures?.bodyNormal,
      bodyRoughness: parts.body?.roughnessTexture ?? manifest.textures?.bodyRoughness,
      skin: head?.headTextureMissing ? undefined : skin?.texture ?? manifest.textures?.skin,
      eye: eye?.texture ?? manifest.textures?.eye,
      hair: hair?.texture ?? manifest.textures?.hair,
      normal: head?.headTextureMissing ? undefined : skin ? skin.normalTexture ?? undefined : manifest.textures?.normal,
      /* The pack's head gloss mask is authored for the head UV. A catalogue
         skin pick converts its own atlas on demand and has no mask, so the
         key drops rather than letting the head wear the default's gloss. */
      skinRoughness: head?.headTextureMissing
        ? undefined
        : skin ? skin.roughnessTexture ?? undefined : manifest.textures?.skinRoughness,
      eyeDisc: eye ? eye.discTexture ?? eye.texture : manifest.textures?.eyeDisc,
    },
    skin: skin?.palette ?? manifest.skin,
    atlasFit: skin?.atlasFit ?? manifest.atlasFit,
    skinSource: skin ? { file: skin.file, size: skin.size } : manifest.skinSource,
    eye: {
      ...(manifest.eye ?? { iris: '#80705b', mean: '#80705b' }),
      ...(eye ? { iris: eye.iris, mean: eye.mean, atlas: eye.atlas } : {}),
      /* The eye is the one facial pair without a `parts` entry: its mesh and
         maps ride the `eyes` texture row, so the normal has to be lifted out
         of that row explicitly or the eyeball draws flat. */
      texture: eye?.texture ?? manifest.eye?.texture,
      normalTexture: eye?.normalTexture ?? manifest.eye?.normalTexture,
      meshUrl: companionEyeMesh ?? eyeMesh?.meshUrl ?? eye?.meshUrl ?? manifest.eye?.meshUrl,
      lashesMeshUrl: companionLashesMesh ?? parts.lashes.meshUrl ?? manifest.eye?.lashesMeshUrl,
      lashesTexture: parts.lashes.texture ?? manifest.eye?.lashesTexture,
    },
    eyeSource: eye ? { file: eye.file, size: eye.size } : manifest.eyeSource,
    hairSource: hair ? { file: hair.file, size: hair.size } : manifest.hairSource,
    hairGroups: hair ? hair.groups : manifest.hairGroups,
    hairCapWindow: hair ? hair.capWindow : manifest.hairCapWindow,
    headMesh: head ? {
      file: head.file, version: head.version, bytes: head.bytes, nodes: head.nodes,
      shapes: head.shapes, isGltf: false, meshUrl: head.meshUrl, isRealMesh: head.isRealMesh,
      /* The renderer reads `origin` to decide whether UBE-specific work (the
         neck seam delta, the facial overlay/gizmo) applies to this head. An
         imported mesh has neither the topology nor the rig those assume. */
      ...(head.origin ? { origin: head.origin } : {}),
      eyeMeshUrl: companionEyeMesh,
      lashesMeshUrl: companionLashesMesh,
      browsMeshUrl: companionBrowsMesh,
      mouthMeshUrl: companionMouthMesh,
    } : manifest.headMesh,
    skeleton: skel ? {
      file: skel.file, version: skel.version, bytes: skel.bytes, nodes: skel.nodes, isGltf: false,
    } : manifest.skeleton,
    preset: preset ? {
      preset: preset.file, morphs: preset.morphs, sculpt: preset.sculpt,
      faceTextures: preset.faceTextures, headParts: preset.headParts, actor: preset.actor,
    } : manifest.preset,
    body: parts.body,
  };
}
