'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCharacter } from '@/lib/store';
import {
  CATEGORY_MAP,
  assetOptions,
  isOverlayKind,
  isRenderableMeshRow,
  sculptHeadFor,
  type AssetKind,
  type CategorySpec,
} from '@/lib/manifestSelect';
import { payloadFromMorphs } from '@/lib/presetIO';
import { cn } from '@/lib/cn';
import { StudioCard } from '@/components/hud/common/StudioCard';
import { EQUIP_SLOT_LABEL, equipSlotOf } from '@/lib/equipment';
import { IconSparkle } from '@/components/hud/Icons';
import type { Mo2AssetOption, Mo2Manifest } from '@/lib/head/faceTexture';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { convertUrl, fetchCatalogue, formatBytes, matchesQuery } from '@/lib/mo2/client';

interface AssetPanelProps {
  manifest: Mo2Manifest | null;
  /** True while the ASSETS workspace is the visible rail. The panel stays
   *  mounted either way; it is only hidden, never unmounted. */
  active?: boolean;
  onClose?: () => void;
}

/** Backend fields the indexer writes; kept local so this panel compiles against
 *  a catalogue type that predates them. */
type Entry = CatalogueEntry & {
  decodable?: boolean;
  reason?: string;
  pairedTextureId?: string;
  normalId?: string;
  /** Producer flag: decodable geometry whose albedo DDS are absent; renders
   *  flat grey in mesh mode. */
  untextured?: boolean;
};

type PairMeta = Mo2AssetOption & {
  pairedTextureId?: string;
  available?: boolean;
  decodable?: boolean;
  untextured?: boolean;
  reason?: string;
  /** Producer-written slot the garment occupies; EQUIPMENT filters on it. */
  equipSlot?: string;
  /** Producer-written `_0`/`_1` pair key and default half. The manifest lists
   *  one row per garment (the `_1` half), so a row without `weightDefault` is
   *  the `_0` twin and would duplicate the picker. */
  weightKey?: string;
  weightDefault?: 0 | 1;
};
type Mode = 'mesh' | 'texture' | 'asset';

/** Fixed height for EVERY row, group and divider included, so the virtual
 *  spacer's `rows.length * ROW_H` stays an honest offset. Tracks the row type
 *  size: at 10 px text a 15 px row clipped its own leading, so the pitch grows
 *  with it and the window count shrinks to keep the same rendered extent. */
const WINDOW = 44;
const ROW_H = 20;

type Row =
  | { t: 'group'; key: string; label: string }
  | { t: 'divider'; key: string; label: string }
  | { t: 'reset'; key: string; label: string }
  | { t: 'curated'; key: string; opt: PairMeta }
  | { t: 'entry'; key: string; e: Entry };

const normRel = (rel: string) => rel.replace(/\//g, '\\').toLowerCase();

function entryChip(e: Entry): string {
  const ext = e.file.split('.').pop()?.toUpperCase() ?? 'FILE';
  if (ext === 'NIF') return 'NIF';
  if (e.reason?.includes('PIRT')) return 'PIRT';
  if (e.reason?.toLowerCase().includes('degenerate')) return 'DEGEN';
  return ext;
}

export function AssetPanel({ manifest, active = false, onClose }: AssetPanelProps) {
  /* The workspace tab is the disclosure control now; the panel body renders
     whenever ASSETS owns the rail so filters, scroll and fetched catalogues
     survive a switch. */
  const expanded = active;
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement | null>(null);

  const selection = useCharacter((s) => s.assetSelection);
  const setAssets = useCharacter((s) => s.setAssets);
  /* The paper-doll owns its own slot map: EQUIPMENT lists the same
     `clothingMesh` rows, but a pick fills `equipment[slot]` instead of the
     single whole-outfit id in `assetSelection`. */
  const equipment = useCharacter((s) => s.equipment);
  const equipSlot = useCharacter((s) => s.equipSlot);
  const setEquip = useCharacter((s) => s.setEquip);
  const loadPreset = useCharacter((s) => s.loadPreset);
  const activeCategory = useCharacter((s) => s.activeCategory);
  const overlayLayers = useCharacter((s) => s.overlayLayers);
  const toggleOverlay = useCharacter((s) => s.toggleOverlay);
  const assetCatalogues = useCharacter((s) => s.assetCatalogues);
  const setAssetCatalogue = useCharacter((s) => s.setAssetCatalogue);
  const panelMode = useCharacter((s) => s.panelMode);
  const setPanelMode = useCharacter((s) => s.setPanelMode);

  const unrestrictedSlots = useCharacter((s) => s.unrestrictedSlots);
  const spec: CategorySpec = CATEGORY_MAP[activeCategory];
  /* EQUIPMENT is mesh-only: a garment's atlas lives inside its NIF, so there
     is no per-slot TEX list to show, and the stored `panelMode` from the last
     category must not leak in for even one render. */
  const equipMode = activeCategory === 'equipment';
  const mode: Mode = equipMode
    ? 'mesh'
    : spec.mesh && spec.texture
      ? panelMode === 'mesh'
        ? 'mesh'
        : 'texture'
      : spec.mesh
        ? 'mesh'
        : spec.texture
          ? 'texture'
          : 'asset';
  const activeKind = (mode === 'mesh' ? spec.mesh : mode === 'texture' ? spec.texture : activeCategory) as AssetKind;
  const meshKind = spec.mesh;
  const textureKind = spec.texture;
  const overlay = isOverlayKind(activeKind);
  const equipTarget = equipMode ? equipment[equipSlot] : undefined;
  /* The worn value for the list's own kind: the paper-doll's slot when in
     EQUIPMENT, otherwise the ordinary one-per-kind selection. */
  const selectedId = equipMode ? equipTarget : selection[activeKind];

  /* A category with a mesh defaults to the mesh segment; a texture-only one
     (SKIN, an overlay) and the two list-less ones open on their texture/asset.
     EYES defaults to texture so the user sees eye colors immediately.
     EQUIPMENT is not listed here: its mode is derived, never stored, so it
     neither reads nor writes the shared `panelMode`. */
  useEffect(() => {
    if (activeCategory === 'eyes') {
      setPanelMode('texture');
    } else if (activeCategory !== 'equipment') {
      setPanelMode(spec.mesh ? 'mesh' : 'texture');
    }
  }, [activeCategory, setPanelMode, spec.mesh]);

  /* Only the open category's two kinds are fetched. Switching tabs lazily
     pulls the next pair; the client caches the promise for the session and
     this registers the result so `resolveManifest` can validate archive ids. */
  useEffect(() => {
    if (!expanded) return;
    const kinds = [meshKind, textureKind].filter((k): k is AssetKind => Boolean(k));
    if (!kinds.length) return;
    let cancelled = false;
    setLoading(new Set());
    const have = useCharacter.getState().assetCatalogues;
    for (const kind of kinds) {
      if (have[kind]?.length) continue;
      setLoading((prev) => new Set(prev).add(kind));
      fetchCatalogue(kind)
        .then((list) => {
          if (!cancelled && list.length) setAssetCatalogue(kind, list);
        })
        .finally(() => {
          if (cancelled) return;
          setLoading((prev) => {
            const next = new Set(prev);
            next.delete(kind);
            return next;
          });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [expanded, activeCategory, meshKind, textureKind, setAssetCatalogue]);

  useEffect(() => {
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [activeKind, query, mode]);

  const curated = useMemo(() => {
    const list = assetOptions(manifest, activeKind) as PairMeta[];
    /* EQUIPMENT lists one garment per slot. The pack ships each garment twice
       (`_1` and its `_0` twin) because the renderer lerps between them, so the
       `_0` half would offer the same boots a second time; the whole-outfit row
       is `full` and belongs to BODY → OUTFIT. Neither is a worn-slot pick. */
    return equipMode
      ? list.filter((r) => (unrestrictedSlots || equipSlotOf(r) === equipSlot) && !(r.weightKey && !r.weightDefault))
      : list;
  }, [manifest, activeKind, equipMode, equipSlot, unrestrictedSlots]);
  const catalogue = useMemo(() => {
    const list = (assetCatalogues[activeKind] ?? []) as Entry[];
    return equipMode
      ? list.filter((e) => (unrestrictedSlots || equipSlotOf(e) === equipSlot) && !(e.weightKey && !e.weightDefault))
      : list;
  }, [assetCatalogues, activeKind, equipMode, equipSlot, unrestrictedSlots]);
  const textureCatalogue = useMemo(
    () => (textureKind ? ((assetCatalogues[textureKind] ?? []) as Entry[]) : []),
    [assetCatalogues, textureKind],
  );
  const catalogueByRel = useMemo(
    () => new Map(catalogue.map((e) => [normRel(e.rel), e] as const)),
    [catalogue],
  );
  const textureIds = useMemo(() => {
    const ids = new Set(textureCatalogue.map((e) => e.id));
    if (textureKind) {
      for (const o of assetOptions(manifest, textureKind)) ids.add(o.id);
    }
    return ids;
  }, [textureCatalogue, textureKind, manifest]);

  const rows = useMemo<Row[]>(() => {
    const q = query.toLowerCase();
    const matchesOption = (o: Mo2AssetOption) =>
      !q ||
      [o.label, o.file, o.mod, o.rel].some((v) => v?.toLowerCase().includes(q));

    const curatedRows: Row[] = curated
      .filter(matchesOption)
      .map((opt) => ({ t: 'curated', key: `c:${opt.id}`, opt }));

    /* Curated ids are slugs, archive ids are hashes: dedupe on `rel`. */
    const curatedRels = new Set(curated.map((o) => normRel(o.rel)));
    const archive =
      mode === 'asset'
        ? []
        : catalogue.filter((e) => matchesQuery(e, query) && !curatedRels.has(normRel(e.rel)));
    const ok =
      mode === 'texture' ? archive.filter((e) => (e.mapRole ?? 'albedo') === 'albedo') : archive;
    const blocked = mode === 'mesh' ? archive.filter((e) => e.decodable === false) : [];
    const decodable = mode === 'mesh' ? ok.filter((e) => e.decodable !== false) : ok;

    const out: Row[] = [...curatedRows];
    const packMode = manifest?.sourceLayout === 'pack';
    /* An authored pick hides the manifest default, so the way back has to be
       a row. Pack mode's default is another authored option, never procedural.
       EQUIPMENT's way back is "leave this slot empty", not "wear the default":
       an empty slot is a legitimate state there, so the row clears the slot. */
    if (mode === 'mesh' && meshKind && selectedId && (!q || 'default procedural'.includes(q))) {
      out.unshift({
        t: 'reset',
        key: 'reset',
        label: equipMode
          ? `CLEAR ${EQUIP_SLOT_LABEL[equipSlot]}`
          : packMode ? `${spec.label} PACK DEFAULT` : `${spec.label} DEFAULT`,
      });
    }
    if (decodable.length) {
      if (curatedRows.length) {
        out.push({
          t: 'divider',
          key: 'd:archive',
          label: mode === 'mesh' ? `ARCHIVE MESHES · ${decodable.length}` : `ARCHIVE TEXTURES · ${decodable.length}`,
        });
      }
      let lastMod: string | null = null;
      for (const e of decodable) {
        if (e.mod !== lastMod) {
          out.push({ t: 'group', key: `g:${e.mod}`, label: e.mod });
          lastMod = e.mod;
        }
        out.push({ t: 'entry', key: `e:${e.id}`, e });
      }
    }
    if (blocked.length) {
      out.push({ t: 'divider', key: 'd:blocked', label: `NOT DECODABLE · ${blocked.length}` });
      for (const e of blocked) out.push({ t: 'entry', key: `b:${e.id}`, e });
    }
    return out;
  }, [curated, catalogue, query, mode, meshKind, spec.label, selection, selectedId, equipMode, equipSlot]);

  const visible = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 6);
    return { start, rows: rows.slice(start, start + WINDOW) };
  }, [rows, scrollTop]);

  if (!manifest) return null;

  /* Defaults mirror `resolveManifest`: skip rows that cannot be drawn, and in
     mesh mode prefer a textured row over a grey one so the highlighted row is
     the one the viewport actually paints. */
  const defaultRow = (list: Mo2AssetOption[] | undefined, mesh: boolean) => {
    const rows = (list ?? []) as PairMeta[];
    if (!mesh) return rows.find((o) => o.available !== false);
    return rows.find((o) => isRenderableMeshRow(o) && o.untextured !== true)
      ?? rows.find(isRenderableMeshRow)
      ?? rows[0];
  };
  const defaultId = equipMode || activeKind === 'hairMesh'
    ? undefined
    : defaultRow(curated, mode === 'mesh')?.id;
  const defaultTextureId = !equipMode && textureKind
    ? defaultRow(assetOptions(manifest, textureKind), false)?.id
    : undefined;
  const effectiveTextureId = textureKind ? selection[textureKind] ?? defaultTextureId : undefined;
  const overlayIds = new Set(overlayLayers.map((l) => `${l.kind}:${l.id}`));

  /** The texture this mesh authored, if its catalogue entry is registered. */
  const pairFor = (opt: PairMeta): string | null => {
    if (!textureKind) return null;
    const id = opt.pairedTextureId ?? catalogueByRel.get(normRel(opt.rel))?.pairedTextureId;
    return id && textureIds.has(id) ? id : null;
  };

  const selectMesh = (id: string, pair: string | null) => {
    if (!meshKind) return;
    /* A garment has no per-slot atlas pick: its NIF names its own DDS refs,
       and one picked atlas painted over another set's UVs would look worse
       than the grey placeholder. So EQUIPMENT fills the slot and nothing else. */
    if (equipMode) {
      setEquip({ [equipSlot]: id });
      return;
    }
    const patch: Partial<Record<AssetKind, string | null>> = { [meshKind]: id };
    /* Pair only when the sibling atlas is registered; otherwise retain the current texture. */
    if (textureKind && pair) patch[textureKind] = pair;
    setAssets(patch);
  };

  const pickCurated = (opt: PairMeta) => {
    /* A row the pack cannot draw must never be selected — but an `untextured`
       row is drawable (in grey), so it is deliberately allowed through. */
    if (mode === 'mesh' ? !isRenderableMeshRow(opt) : opt.available === false) return;
    if (activeKind === 'preset') {
      setAssets({ preset: opt.id });
      const preset = curated.find((p) => p.id === opt.id);
      if (preset) {
        const head = sculptHeadFor(manifest, preset.file);
        loadPreset(
          payloadFromMorphs(head?.origin === 'racemenu-export' ? [] : (preset as unknown as { morphs: Array<{ name: string; value: number }> }).morphs, {
            name: preset.label ?? preset.file,
            baked: head?.origin === 'racemenu-export',
            actorWeight: (preset as unknown as { actor?: Record<string, unknown> }).actor?.weight,
          }),
          head?.id,
        );
      }
      return;
    }
    if (mode === 'mesh') selectMesh(opt.id, pairFor(opt));
    else setAssets({ [activeKind]: opt.id } as Partial<Record<AssetKind, string | null>>);
  };

  const pickEntry = (e: Entry) => {
    if (overlay) {
      toggleOverlay({
        kind: activeKind,
        id: e.id,
        color: DEFAULT_OVERLAY_COLOR[activeKind] ?? '#b98a72',
        opacity: 0.55,
      });
      return;
    }
    if (mode === 'mesh') selectMesh(e.id, pairFor(e));
    else setAssets({ [activeKind]: e.id } as Partial<Record<AssetKind, string | null>>);
  };

  const isSelected = (key: string) => {
    if (overlay) return overlayIds.has(`${activeKind}:${key}`);
    return selectedId ? selectedId === key : key === defaultId;
  };

  const pairChip = (opt: PairMeta) => {
    /* EQUIPMENT never pairs an atlas: a garment's DDS are authored inside its
       own NIF, and the slot is filled by the mesh alone. */
    if (equipMode || mode !== 'mesh' || !textureKind) return null;
    const pair = pairFor(opt);
    if (!pair) {
      return (
        <span className="shrink-0 border border-[#b56a5a]/40 bg-[#b56a5a]/[0.08] px-[3px] py-[1px] text-[10px] tracking-[0.08em] text-[#dda898]/85">
          NO ATLAS
        </span>
      );
    }
    const effectiveTexture = textureKind
      ? [...assetOptions(manifest, textureKind), ...textureCatalogue].find((e) => e.id === effectiveTextureId)
      : undefined;
    const pairedTexture = textureCatalogue.find((e) => e.id === pair);
    const applied = effectiveTextureId === pair || Boolean(effectiveTexture && pairedTexture
      && normRel(effectiveTexture.rel) === normRel(pairedTexture.rel));
    return (
      <span
        className={cn(
          'shrink-0 border px-[3px] py-[1px] text-[10px] tracking-[0.08em]',
          applied
            ? 'border-[#4fd1c5]/40 bg-[#4fd1c5]/[0.08] text-[#8fe3da]/85'
            : 'border-[#d4b483]/34 bg-[#d4b483]/[0.06] text-[#c9b184]/80',
        )}
      >
        {applied ? '◈ PAIRED' : '◇ OVERRIDE'}
      </span>
    );
  };

  const curatedChip = (opt: PairMeta) => (
    <>
      {activeKind === 'headMesh' && (
        <span className="shrink-0 border border-[#4fd1c5]/30 bg-[#4fd1c5]/[0.07] px-[3px] py-[1px] text-[10px] tracking-[0.08em] text-[#8fe3da]/75">
          {(opt as { isRealMesh?: boolean }).isRealMesh ? 'REAL' : 'PROC'}
        </span>
      )}
      {activeKind === 'skin' && (
        <span
          className={cn(
            'shrink-0 border px-[3px] py-[1px] text-[10px] tracking-[0.08em]',
            (opt as { atlasFit?: { measured?: boolean } }).atlasFit?.measured === false
              ? 'border-[#b56a5a]/34 bg-[#b56a5a]/[0.08] text-[#dda898]/80'
              : 'border-[#4fd1c5]/30 bg-[#4fd1c5]/[0.07] text-[#8fe3da]/75',
          )}
        >
          {(opt as { atlasFit?: { measured?: boolean } }).atlasFit?.measured === false ? 'ESTIMATED' : 'MEASURED'}
        </span>
      )}
      {(opt as { usable?: boolean }).usable === false && (
        <span className="shrink-0 text-[10px] tracking-[0.06em] text-[#c08f80]/80">NO STRAND</span>
      )}
    </>
  );

  const count = rows.filter((r) => r.t === 'curated' || r.t === 'entry').length;

  /* The workspace rail, not a floating popover: the list fills the dock below
     its own header. EQUIPMENT lists one slot's garments in the same panel. */
  return (
    <StudioCard
      title={`${spec.label} BROWSER`}
      badge={manifest.available ? (count ? `${count} ITEMS` : 'ONLINE') : 'OFFLINE'}
      onClose={onClose ?? (() => useCharacter.getState().setWorkspace('edit'))}
      footerLeading={<span>+ MO2 VIRTUAL MODS</span>}
      footerTrailing={<span>HOT-RELOAD</span>}
      showSparkle
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[2px] py-[4px] thin-scroll font-mono">
          <div className="mb-[7px] flex items-center gap-[5px] text-[10px] tracking-[0.13em] text-[#8f8778]/72">
            <IconSparkle className="h-[9px] w-[9px] text-[#c9b184]/55" />
            <span className="truncate normal-case" title={manifest.source}>
              {manifest.source}
            </span>
          </div>

          <div className="mb-[6px] flex items-baseline justify-between border-b border-[#d4b483]/14 pb-[4px]">
            <span className="text-[10px] tracking-[0.14em] text-[#d8c39c]">
              {equipMode ? `EQUIPMENT · ${EQUIP_SLOT_LABEL[equipSlot]}` : spec.label}
            </span>
            <span className="num text-[10px] tracking-[0.06em] text-[#8f8778]/60">
              {loading.has(activeKind)
                ? 'INDEXING…'
                : mode === 'asset'
                  ? `${curated.length} OPTIONS`
                  : `${count} FILES`}
            </span>
          </div>

          {/* MESH | TEX, or the one segment the category owns. SKELETON and
              PRESET have neither, so they read ASSET. EQUIPMENT is mesh-only
              by construction (a garment's atlas rides its own NIF), so it
              reads MESH rather than offering a segment with nothing behind it. */}
          <div className="mb-[6px] flex items-stretch border border-[#d4b483]/22">
            {spec.mesh && spec.texture && !equipMode ? (
              (['mesh', 'texture'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPanelMode(m)}
                  aria-pressed={panelMode === m}
                  className={cn(
                    'flex-1 px-[4px] py-[3px] text-[10px] tracking-[0.12em] transition-colors',
                    panelMode === m
                      ? 'bg-[#d4b483]/[0.1] text-[#f2e4c8]'
                      : 'text-[#9b9284]/70 hover:text-[#e8ddc8]',
                  )}
                >
                  {m === 'mesh' ? 'MESH' : 'TEX'}
                </button>
              ))
            ) : (
              <span className="flex-1 bg-[#d4b483]/[0.1] px-[4px] py-[3px] text-center text-[10px] tracking-[0.12em] text-[#f2e4c8]">
                {mode === 'mesh' ? 'MESH' : mode === 'texture' ? 'TEX' : 'ASSET'}
              </span>
            )}
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="FILTER"
            aria-label={`Filter ${spec.label}`}
            className="mb-[6px] w-full border border-[#d4b483]/25 bg-black/40 px-[6px] py-[4px] text-[10px] tracking-[0.12em] text-[#e8ddc8] uppercase placeholder:text-[#7d6f5e]/70 focus:border-[#d4b483]/55 focus:outline-none"
          />

          {overlayLayers.length > 0 && (
            <div className="mb-[5px] flex flex-wrap gap-[3px]">
              {overlayLayers.map((l) => (
                <button
                  key={`${l.kind}:${l.id}`}
                  type="button"
                  onClick={() => toggleOverlay(l)}
                  title="Remove this layer"
                  className="flex items-center gap-[3px] border border-[#4fd1c5]/32 bg-[#4fd1c5]/[0.08] px-[4px] py-[1px] text-[10px] tracking-[0.05em] text-[#8fe3da]/85 hover:border-[#b56a5a]/60 hover:text-[#e0a898]"
                >
                  <span className="inline-block h-[4px] w-[4px] rounded-full" style={{ background: l.color }} />
                  {l.opacity.toFixed(2)}
                  <span className="text-[#8fe3da]/50">×</span>
                </button>
              ))}
            </div>
          )}

          <div
            ref={listRef}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            className="min-h-[120px] flex-1 overflow-y-auto pr-[2px] thin-scroll"
          >
            <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
              <div
                style={{ transform: `translateY(${visible.start * ROW_H}px)` }}
                className="flex flex-col"
              >
                {visible.rows.map((row) => {
                  if (row.t === 'group') {
                    return (
                      <div
                        key={row.key}
                        style={{ height: ROW_H }}
                        className="flex items-center truncate text-[10px] tracking-[0.1em] text-[#d4b483]/60"
                      >
                        {row.label}
                      </div>
                    );
                  }
                  if (row.t === 'divider') {
                    return (
                      <div
                        key={row.key}
                        style={{ height: ROW_H }}
                        className="flex items-center gap-[4px] text-[10px] tracking-[0.1em] text-[#b56a5a]/75"
                      >
                        <span className="h-[1px] flex-1 bg-[#b56a5a]/22" />
                        <span className="shrink-0">{row.label}</span>
                        <span className="h-[1px] flex-1 bg-[#b56a5a]/22" />
                      </div>
                    );
                  }
                  if (row.t === 'reset') {
                    return (
                      <button
                        key={row.key}
                        type="button"
                        onClick={() => {
                          if (equipMode) setEquip({ [equipSlot]: null });
                          else if (meshKind) setAssets({ [meshKind]: null });
                        }}
                        style={{ height: ROW_H }}
                        className="flex items-center gap-[5px] border border-[#4fd1c5]/28 bg-[#4fd1c5]/[0.06] px-[4px] text-left text-[10px] tracking-[0.03em] text-[#8fe3da]/85 transition-colors hover:border-[#4fd1c5]/55 hover:text-[#b6f0e9]"
                      >
                        <span className="inline-block h-[3px] w-[3px] shrink-0 rounded-full bg-[#4fd1c5]" />
                        <span className="min-w-0 flex-1 truncate">↺ {row.label}</span>
                      </button>
                    );
                  }
                  if (row.t === 'curated') {
                    const opt = row.opt;
                    const active = isSelected(opt.id);
                    const pair = pairChip(opt);
                    /* The producer keeps an unavailable authored row visible so
                       adding the missing DDS and resyncing re-enables it. A row
                       with the `untextured` exemption is drawable in grey and
                       stays selectable; anything else unavailable is blocked. */
                    const blocked = mode === 'mesh' ? !isRenderableMeshRow(opt) : opt.available === false;
                    const untextured = !blocked && mode === 'mesh' && opt.untextured === true;
                    const reason = opt.reason;
                    return (
                      <button
                        key={row.key}
                        type="button"
                        disabled={!opt.id || blocked}
                        aria-disabled={blocked || undefined}
                        onClick={() => pickCurated(opt)}
                        aria-pressed={active}
                        title={reason ? `${opt.rel}\n${reason}` : opt.rel}
                        style={{ height: ROW_H }}
                        className={cn(
                          'flex items-center gap-[5px] border px-[4px] text-left text-[10px] tracking-[0.03em] transition-colors',
                          active
                            ? 'border-[#d8b273]/85 bg-[#d4b483]/[0.09] text-[#f2e4c8]'
                            : 'border-[#d4b483]/22 bg-[#d4b483]/[0.05] text-[#cdc2ac]/78 hover:border-[#d4b483]/52 hover:text-[#e8ddc8]',
                          ((opt as { usable?: boolean }).usable === false || blocked) && !active && 'opacity-45',
                          blocked && 'cursor-default',
                        )}
                      >
                        <span
                          className={cn(
                            'inline-block h-[3px] w-[3px] shrink-0 rounded-full',
                            blocked ? 'bg-[#b56a5a]' : active ? 'bg-[#e8c98e]' : 'bg-[#8f8778]/45',
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">{opt.label ?? opt.mod}</span>
                        {blocked ? (
                          <span className="shrink-0 border border-[#b56a5a]/40 px-[3px] py-[1px] text-[10px] tracking-[0.08em] text-[#dda898]/85">
                            UNAVAILABLE
                          </span>
                        ) : untextured ? (
                          <span className="shrink-0 border border-[#d4b483]/40 bg-[#d4b483]/[0.08] px-[3px] py-[1px] text-[10px] tracking-[0.08em] text-[#c9b184]/85">
                            UNTEXTURED
                          </span>
                        ) : (
                          <>
                            {active && pair}
                            {!active && curatedChip(opt)}
                          </>
                        )}
                      </button>
                    );
                  }

                  const e = row.e;
                  const active = isSelected(e.id);
                  const blocked = e.decodable === false;
                  if (blocked) {
                    const reason = e.reason ?? 'not decodable';
                    return (
                      <button
                        key={row.key}
                        type="button"
                        disabled
                        aria-disabled="true"
                        aria-label={`${e.label} — ${reason}`}
                        title={reason}
                        style={{ height: ROW_H }}
                        className="flex w-full cursor-default flex-col justify-center border border-transparent px-[4px] text-left opacity-40"
                      >
                        <span className="flex min-w-0 items-center gap-[4px] text-[10px] leading-[1.1] tracking-[0.03em] text-[#cdc2ac]/78">
                          <span className="shrink-0 border border-[#b56a5a]/40 px-[2px] text-[10px] tracking-[0.06em] text-[#dda898]/85">
                            {entryChip(e)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{e.label}</span>
                        </span>
                        <span className="min-w-0 truncate text-[10px] leading-[1.1] text-[#c08f80]/80">
                          {reason}
                        </span>
                      </button>
                    );
                  }
                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => pickEntry(e)}
                      aria-pressed={active}
                      title={`${e.rel}\n${formatBytes(e.bytes)}`}
                      style={{ height: ROW_H }}
                      className={cn(
                        'flex w-full items-center gap-[4px] border px-[3px] text-left text-[10px] tracking-[0.03em] transition-colors',
                        active
                          ? 'border-[#d8b273]/85 bg-[#d4b483]/[0.09] text-[#f2e4c8]'
                          : 'border-transparent text-[#cdc2ac]/78 hover:border-[#d4b483]/40 hover:text-[#e8ddc8]',
                      )}
                    >
                      {mode === 'mesh' ? (
                        <span className="shrink-0 border border-[#d4b483]/25 px-[2px] text-[10px] tracking-[0.06em] text-[#c9b184]/80">
                          {entryChip(e)}
                        </span>
                      ) : (
                        <img
                          src={convertUrl({ kind: activeKind, id: e.id, mode: 'thumb', role: e.mapRole })}
                          alt=""
                          loading="lazy"
                          width={12}
                          height={12}
                          className="h-[12px] w-[12px] shrink-0 border border-[#d4b483]/20 object-cover"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{e.label}</span>
                      {active && (mode === 'mesh' ? pairChip(e) : <span className="text-[10px] text-[#8fe3da]">●</span>)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {!rows.length && (
            <div className="py-[3px] text-[10px] text-[#7d6f5e]/60">
              {loading.has(activeKind) ? 'indexing…' : 'not found'}
            </div>
          )}

          {/* Pickers, not readouts: the bone map is only useful when no list
              is being browsed, so it stays below the list rather than above. */}
          {activeCategory === 'skeleton' && manifest.skeleton?.nodes?.length ? (
            <div className="mt-[8px] border-t border-[#d4b483]/14 pt-[7px]">
              <div className="mb-[4px] text-[10px] tracking-[0.12em] text-[#8f8778]/60">BONE MAP</div>
              <div className="flex flex-wrap gap-[3px]">
                {['Head', 'Nose', 'Brow_L', 'Brow_R', 'Jaw', 'Lips', 'Cheek_L', 'Cheek_R', 'Forehead'].map((b) => (
                  <span
                    key={b}
                    className="border border-[#4fd1c5]/28 bg-[#4fd1c5]/[0.07] px-[4px] py-[1px] text-[10px] tracking-[0.06em] text-[#8fe3da]/82"
                  >
                    {b}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {activeCategory === 'preset' && manifest.preset?.morphs?.length ? (
            <div className="mt-[8px] border-t border-[#d4b483]/14 pt-[7px]">
              <div className="mb-[4px] flex items-baseline justify-between text-[10px] tracking-[0.12em] text-[#8f8778]/60">
                <span>RACEMENU MORPHS</span>
                <span className="num text-[#c9b184]/72">{manifest.preset.morphs.length}</span>
              </div>
              <div className="flex flex-wrap gap-[3px]">
                {manifest.preset.morphs.slice(0, 8).map((m) => (
                  <span
                    key={m.name}
                    className="border border-[#d4b483]/22 bg-[#d4b483]/[0.05] px-[4px] py-[1px] text-[10px] tracking-[0.04em] text-[#cdc2ac]/78"
                  >
                    {m.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {(() => {
            const notes = [...new Set([...(manifest.diagnostics ?? []), ...(manifest.errors ?? [])])];
            return notes.length ? (
              <div className="mt-[8px] border-t border-[#b56a5a]/24 pt-[6px] text-[10px] leading-[1.5] text-[#c08f80]/72">
                <div className="mb-[3px] tracking-[0.12em] text-[#b56a5a]/85">
                  DIAGNOSTICS · {notes.length}
                </div>
                {notes.slice(0, 6).map((e) => (
                  <div key={e} className="truncate" title={e}>
                    {e}
                  </div>
                ))}
              </div>
            ) : null;
          })()}
        </div>
    </StudioCard>
  );
}

/** Neutral starting colours, close to the presets' own tint values. */
const DEFAULT_OVERLAY_COLOR: Partial<Record<AssetKind, string>> = {
  makeup: '#b0645a',
  tattoo: '#4a4f52',
  wrinkle: '#5a4a42',
  brows: '#3e2c20',
};
