import type {
  Mo2AssetOption, Mo2EyeOption, Mo2HairOption, Mo2Manifest, Mo2MeshOption,
  Mo2PartOption, Mo2PresetOption, Mo2SkeletonOption, Mo2SkinOption,
} from '@/lib/head/faceTexture';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { convertUrl } from '@/lib/mo2/client';

export type PartMeshKind = 'headMesh' | 'eyeMesh' | 'lashesMesh' | 'browsMesh' | 'mouthMesh' | 'bodyMesh' | 'hairMesh' | 'clothingMesh';
export type AssetKind = PartMeshKind | 'skin' | 'eyes' | 'lashes' | 'brows' | 'mouth' | 'body' | 'hair' | 'clothing'
  | 'skeleton' | 'preset' | 'makeup' | 'tattoo' | 'wrinkle';
export type AssetSelection = Partial<Record<AssetKind, string>>;
export type AssetCatalogues = Partial<Record<AssetKind, CatalogueEntry[]>>;

export const ASSET_KINDS: AssetKind[] = [
  'headMesh', 'eyeMesh', 'lashesMesh', 'browsMesh', 'mouthMesh', 'bodyMesh', 'hairMesh', 'clothingMesh',
  'skin', 'eyes', 'lashes', 'brows', 'mouth', 'body', 'hair', 'clothing',
  'skeleton', 'preset', 'makeup', 'tattoo', 'wrinkle',
];
export const OVERLAY_KINDS = ['makeup', 'tattoo', 'wrinkle'] as const;
export const MANIFEST_KINDS = ASSET_KINDS.filter((kind) => !isOverlayKind(kind));
export function isOverlayKind(kind: string): boolean {
  return (OVERLAY_KINDS as readonly string[]).includes(kind);
}
export interface CategorySpec { label: string; mesh?: AssetKind; texture?: AssetKind }
export const CATEGORY_MAP: Record<'headMesh' | 'eyes' | 'lashes' | 'brows' | 'mouth' | 'body' | 'hair' | 'clothing' | 'skin' | 'makeup' | 'tattoo' | 'wrinkle' | 'skeleton' | 'preset', CategorySpec> = {
  headMesh: { label: 'HEAD', mesh: 'headMesh', texture: 'skin' },
  eyes: { label: 'EYES', mesh: 'eyeMesh', texture: 'eyes' },
  lashes: { label: 'LASHES', mesh: 'lashesMesh', texture: 'lashes' },
  brows: { label: 'BROWS', mesh: 'browsMesh', texture: 'brows' },
  mouth: { label: 'MOUTH', mesh: 'mouthMesh', texture: 'mouth' },
  body: { label: 'BODY', mesh: 'bodyMesh', texture: 'body' },
  hair: { label: 'HAIR', mesh: 'hairMesh', texture: 'hair' },
  clothing: { label: 'CLOTHING', mesh: 'clothingMesh', texture: 'clothing' },
  skin: { label: 'SKIN', texture: 'skin' },
  makeup: { label: 'MAKEUP', texture: 'makeup' },
  tattoo: { label: 'TATTOO', texture: 'tattoo' },
  wrinkle: { label: 'WRINKLE', texture: 'wrinkle' },
  skeleton: { label: 'SKELETON' }, preset: { label: 'PRESET' },
} satisfies Record<string, CategorySpec>;
export type UiCategory = keyof typeof CATEGORY_MAP;

type PartOption = Mo2PartOption & { pairedTextureId?: string };
export interface AssetOptionMap {
  skin: Mo2SkinOption; eyes: Mo2EyeOption; hair: Mo2HairOption;
  headMesh: Mo2MeshOption; skeleton: Mo2SkeletonOption; preset: Mo2PresetOption;
  eyeMesh: PartOption; lashesMesh: PartOption; browsMesh: PartOption;
  mouthMesh: PartOption; bodyMesh: PartOption; hairMesh: PartOption; clothingMesh: PartOption;
  lashes: PartOption; brows: PartOption; mouth: PartOption; body: PartOption; clothing: PartOption;
}
export function assetOptions<K extends keyof AssetOptionMap>(manifest: Mo2Manifest | null, kind: K): Array<AssetOptionMap[K]>;
export function assetOptions(manifest: Mo2Manifest | null, kind: AssetKind): Mo2AssetOption[];
export function assetOptions(manifest: Mo2Manifest | null, kind: AssetKind): Mo2AssetOption[] {
  if (isOverlayKind(kind)) return [];
  const assets = manifest?.assets as Partial<Record<AssetKind, Mo2AssetOption[]>> | undefined;
  return assets?.[kind] ?? [];
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
     stem match ("Frau" → "Frau.jslot") so exports round-trip too, but only
     when exactly one head claims it — an ambiguous stem must not pick a face. */
  const stem = wanted.replace(/\.jslot$/, '');
  const hits = heads.filter(
    (h) => h.sculptSource?.toLowerCase().replace(/\.jslot$/, '') === stem,
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

/** Only registered catalogue ids resolve to URLs. Unknown/stale preset ids use the offline default. */
export function resolveManifest(
  manifest: Mo2Manifest | null,
  selection: AssetSelection,
  catalogues: AssetCatalogues = {},
): Mo2Manifest | null {
  if (!manifest) return null;
  const resolveMeshUrl = (kind: string, option: PartOption | undefined): PartOption | undefined => {
    if (!option || option.meshUrl || !option.onDemand) return option;
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
      const fallback = preferredOption(list as PartOption[]) as PartOption | undefined;
      return (mesh ? resolveMeshUrl(kind, fallback) : fallback) as AssetOptionMap[K];
    }
    const base = preferredOption(list as PartOption[]) as PartOption | undefined;
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
  const head = pick('headMesh');
  const skel = pick('skeleton');
  const preset = pick('preset');
  const eyeMesh = pick('eyeMesh');
  const body = pick('body');
  const clothing = pick('clothing');
  const mods: Record<string, string | null> = { ...(manifest.mods ?? {}) };
  for (const kind of MANIFEST_KINDS) {
    const option = pick(kind as keyof AssetOptionMap);
    if (option) mods[kind] = option.rel;
  }
  const part = (name: 'mouth' | 'brows' | 'lashes' | 'body' | 'hair' | 'clothing', meshKind: keyof AssetOptionMap) => {
    const texture = pick(name) as PartOption | undefined;
    const mesh = pick(meshKind) as PartOption | undefined;
    const fallback = manifest.parts?.[name] ?? (name === 'body' ? manifest.body : undefined);
    const pairId = mesh?.pairedTextureId ?? catalogues[meshKind]?.find((e) => e.rel === mesh?.rel)?.pairedTextureId;
    const pair = !selection[name] && pairId ? catalogues[name]?.find((e) => e.id === pairId && (e.mapRole ?? 'albedo') === 'albedo') : undefined;
    /* Undecodable rows keep their id for the picker but are never drawn.
       `untextured` rows are drawn, in grey: a blocked-looking slot would
       otherwise hide geometry the pack actually supplied. A grey row also
       names no atlas — painting some other style's atlas over UVs it was not
       authored for would be worse than the honest placeholder. */
    /* A `_0`/`_1` pair is two meshes with the same topology. The producer
       records the pair either as catalogue ids (on a catalogue row) or already
       as route URLs (on the manifest's own default row), so each half is only
       wrapped when it is still an id. Only `body` has a pair today, and only
       when the producer measured one. */
    const weightUrl = (v: string) =>
      v.startsWith('/') ? v : convertUrl({ kind: 'bodyMesh', id: v, mode: 'mesh' });
    const weightVariants = name === 'body' && mesh?.weightKey && mesh.weightVariants
      ? { w0: weightUrl(mesh.weightVariants.w0), w1: weightUrl(mesh.weightVariants.w1) }
      : undefined;
    const grey = mesh?.untextured === true;
    const usableTexture = !grey && texture && texture.available !== false ? texture : undefined;
    const usableMesh = mesh && isRenderableMeshRow(mesh) ? mesh : undefined;
    return {
      ...(fallback ?? {}), ...(usableTexture ?? {}),
      meshUrl: name === 'hair' || name === 'clothing'
        ? usableMesh?.meshUrl
        : usableMesh?.meshUrl ?? fallback?.meshUrl ?? (name === 'body' ? body?.meshUrl : undefined),
      texture: pair ? convertUrl({ kind: name, id: pair.id, mode: 'atlas' }) : usableTexture?.texture ?? (grey ? undefined : fallback?.texture),
      normalTexture: pair ? (pair.normalId ? convertUrl({ kind: name, id: pair.normalId, mode: 'normal' }) : undefined) : usableTexture ? usableTexture.normalTexture : (grey ? undefined : fallback?.normalTexture),
      ...(weightVariants ? { weightVariants } : {}),
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
    hair: part('hair', 'hairMesh'), clothing: part('clothing', 'clothingMesh'),
  };
  return {
    ...manifest, mods, parts,
    textures: {
      ...manifest.textures,
      skin: head?.headTextureMissing ? undefined : skin?.texture ?? manifest.textures?.skin,
      eye: eye?.texture ?? manifest.textures?.eye,
      hair: hair?.texture ?? manifest.textures?.hair,
      normal: head?.headTextureMissing ? undefined : skin ? skin.normalTexture ?? undefined : manifest.textures?.normal,
      eyeDisc: eye ? eye.discTexture ?? eye.texture : manifest.textures?.eyeDisc,
    },
    skin: skin?.palette ?? manifest.skin,
    atlasFit: skin?.atlasFit ?? manifest.atlasFit,
    skinSource: skin ? { file: skin.file, size: skin.size } : manifest.skinSource,
    eye: {
      ...(manifest.eye ?? { iris: '#80705b', mean: '#80705b' }),
      ...(eye ? { iris: eye.iris, mean: eye.mean, atlas: eye.atlas } : {}),
      meshUrl: eyeMesh?.meshUrl ?? eye?.meshUrl ?? manifest.eye?.meshUrl,
      lashesMeshUrl: parts.lashes.meshUrl ?? manifest.eye?.lashesMeshUrl,
      lashesTexture: parts.lashes.texture ?? manifest.eye?.lashesTexture,
    },
    eyeSource: eye ? { file: eye.file, size: eye.size } : manifest.eyeSource,
    hairSource: hair ? { file: hair.file, size: hair.size } : manifest.hairSource,
    hairGroups: hair ? hair.groups : manifest.hairGroups,
    hairCapWindow: hair ? hair.capWindow : manifest.hairCapWindow,
    headMesh: head ? {
      file: head.file, version: head.version, bytes: head.bytes, nodes: head.nodes,
      shapes: head.shapes, isGltf: false, meshUrl: head.meshUrl, isRealMesh: head.isRealMesh,
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
