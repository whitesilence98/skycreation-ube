/**
 * Multi-Part Skyrim Hairstyle Parsing & Grouping.
 *
 * In Skyrim hair mods (HG Hairdos, KS Hairdos, BDOR Hair, etc.), high-poly
 * hairstyles are split into multiple companion NIF files:
 *  - Main Hairstyle: e.g. AsterionM.nif, AsterionM2.nif, AsterionM3.nif
 *  - HairLine Variant: e.g. AsterionMHL.nif, AsterionM2HL.nif, AsterionM3HL.nif
 *
 * All companion NIFs of a hairstyle must be loaded together to form the complete
 * volume. Hairline (HL) variants are treated as separate standalone styles.
 */

export interface HairPartItem<T = any> {
  id: string;
  label: string;
  partNumber: number;
  raw: T;
}

export type HairBrand = 'BDOR' | 'KSHAIR' | 'OTHER';

export interface HairGroup<T = any> {
  /** Primary part ID (for backward-compatible selection & state storage) */
  id: string;
  /** Normalized identifier key, e.g. 'AsterionM' or 'AsterionMHL' */
  groupKey: string;
  /** Human-readable display label */
  label: string;
  /** Whether this group is a HairLine variant */
  isHL: boolean;
  /** All companion parts sorted in mounting order (Part 1 -> Part 2 -> Part 3...) */
  parts: HairPartItem<T>[];
  /** Total count of constituent NIF parts */
  partCount: number;
  /** Paired texture ID shared across all parts in this group */
  pairedTextureId?: string;
  /** Mod origin */
  mod?: string;
  /** Detected hair pack brand */
  brand: HairBrand;
  /** The primary/representative part object */
  representative: T;
}

export interface ParsedHairLabel {
  groupKey: string;
  label: string;
  isHL: boolean;
  partNumber: number;
}

/**
 * Parses a hairstyle label or filename into its base group key, hairline flag,
 * and companion part index.
 */
export function parseHairLabel(rawLabel: string): ParsedHairLabel {
  const label = (rawLabel || '').trim();

  // Pattern 1: ends with digit + HL (e.g. AsterionM2HL, CatoALTM2HL, Flute1HL)
  let m = label.match(/^(.*?)(?:_|\s|-)?(\d+)(?:_|\s|-)?(hl)$/i);
  if (m) {
    const base = m[1].replace(/[_\s-]+$/, '');
    const partNum = parseInt(m[2], 10);
    return {
      groupKey: base + 'HL',
      label: base + ' HL',
      isHL: true,
      partNumber: partNum,
    };
  }

  // Pattern 2: ends with HL + digit (e.g. AsterionMHL2, HairHL3)
  m = label.match(/^(.*?)(?:_|\s|-)?(hl)(?:_|\s|-)?(\d+)$/i);
  if (m) {
    const base = m[1].replace(/[_\s-]+$/, '');
    const partNum = parseInt(m[3], 10);
    return {
      groupKey: base + 'HL',
      label: base + ' HL',
      isHL: true,
      partNumber: partNum,
    };
  }

  // Pattern 3: ends with HL (no digit, e.g. AsterionMHL, MaeveHL)
  m = label.match(/^(.*?)(?:_|\s|-)?(hl)$/i);
  if (m) {
    const base = m[1].replace(/[_\s-]+$/, '');
    return {
      groupKey: base + 'HL',
      label: base + ' HL',
      isHL: true,
      partNumber: 0,
    };
  }

  // Pattern 4: Non-HL ending with digit (e.g. AsterionM2, AsterionM3, Flute1, Azathoth5)
  m = label.match(/^(.*?)(?:_|\s|-)?(\d+)$/);
  if (m) {
    const base = m[1].replace(/[_\s-]+$/, '');
    const partNum = parseInt(m[2], 10);
    return {
      groupKey: base,
      label: base,
      isHL: false,
      partNumber: partNum,
    };
  }

  // Pattern 5: Standard hair (no digits, no HL, e.g. AsterionM, Azathoth, LanXin)
  return {
    groupKey: label,
    label: label,
    isHL: false,
    partNumber: 0,
  };
}

/**
 * Detects hair brand/mod origin from file path or mod string.
 */
export function getHairBrand(item: { rel?: string; file?: string; mod?: string }): HairBrand {
  const rel = (item.rel || item.file || '').toLowerCase();
  const mod = (item.mod || '').toLowerCase();
  if (rel.includes('bdor') || rel.includes('dint') || mod.includes('bdor')) return 'BDOR';
  if (rel.includes('ks hair') || rel.includes('kash') || mod.includes('ks hair')) return 'KSHAIR';
  return 'OTHER';
}

/**
 * Groups an array of raw hair mesh options into consolidated multi-part hairstyles.
 */
export function buildHairGroups<
  T extends {
    id: string;
    label?: string;
    file?: string;
    rel?: string;
    mod?: string;
    pairedTextureId?: string;
    bytes?: number;
    mtime?: number;
  },
>(options: T[]): HairGroup<T>[] {
  const groupMap = new Map<string, HairGroup<T>>();

  for (const opt of options) {
    const parsed = parseHairLabel(opt.label || opt.file || opt.id);
    const key = parsed.groupKey.toLowerCase();

    let group = groupMap.get(key);
    if (!group) {
      group = {
        id: opt.id,
        groupKey: parsed.groupKey,
        label: parsed.label,
        isHL: parsed.isHL,
        parts: [],
        partCount: 0,
        pairedTextureId: opt.pairedTextureId,
        mod: opt.mod,
        brand: getHairBrand(opt),
        representative: opt,
      };
      groupMap.set(key, group);
    }

    if (!group.pairedTextureId && opt.pairedTextureId) {
      group.pairedTextureId = opt.pairedTextureId;
    }

    group.parts.push({
      id: opt.id,
      label: opt.label || parsed.label,
      partNumber: parsed.partNumber,
      raw: opt,
    });
  }

  // Finalize each group: sort companion parts in mounting order (Part 1 -> Part 2 -> Part 3...)
  const result: HairGroup<T>[] = [];
  for (const group of groupMap.values()) {
    group.parts.sort((a, b) => a.partNumber - b.partNumber || a.label.localeCompare(b.label));
    group.partCount = group.parts.length;
    // Set the primary part as the id and representative
    if (group.parts.length > 0) {
      group.id = group.parts[0].id;
      group.representative = group.parts[0].raw;
      if (!group.pairedTextureId) {
        const foundTex = group.parts.find((p) => p.raw.pairedTextureId)?.raw.pairedTextureId;
        if (foundTex) group.pairedTextureId = foundTex;
      }
    }
    result.push(group);
  }

  return result;
}

/**
 * Finds the hair group corresponding to a selected hairMesh ID or sub-part ID.
 * Ensures backward compatibility when presets reference a sub-part (e.g. 'AsterionM2').
 */
export function findHairGroupForPartId<T>(
  groups: HairGroup<T>[],
  partId: string | undefined | null,
): HairGroup<T> | undefined {
  if (!partId) return undefined;
  // 1. Direct group ID match
  const direct = groups.find((g) => g.id === partId);
  if (direct) return direct;

  // 2. Sub-part ID match
  return groups.find((g) => g.parts.some((p) => p.id === partId));
}
