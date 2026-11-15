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
 * Universal companion tokens commonly used by Skyrim hair mod authors
 * to split high-poly hair into non-overlapping accessory, volume, or scalp layers.
 */
export const COMPANION_TOKENS = [
  // Anatomical Under-Scalp Caps
  'Scalp', 'SCALP', 'SC', 'MSC', 'SCA',
  // Accessories & Auxiliary Volume Buns
  'AC', 'ACM', 'ACH',
  // Headbands, Bandanas & Hair Ties
  'Ban', 'MBan', 'Band',
  // Ponytails & Tails
  'Tail', 'RTai', 'TailM',
  // Braids
  'Br',
  // Loose Framing Strands
  'STR', 'STr',
  // Hair Jewelry, Ears, Horns, Props & Ribbons
  'Pearl', 'Ear', 'Ears', 'Horn', 'Ring', 'Bow', 'Ribbon',
  'Mask', 'Goggle', 'Hat', 'Crown', 'CROWN',
  'Feath', 'Flor', 'Leaf',
  // Structural Sub-Sections
  'Bk', 'FR', 'Mid', 'Inner', 'Main',
  // Hair Wraps & Major Bang Sections
  'W', 'B',
] as const;

const COMPANION_TOKEN_PATTERN = new RegExp(
  '^(.*?)(?:[\\s_-]+|(?<=[a-z0-9]))(' +
    [...COMPANION_TOKENS].sort((a, b) => b.length - a.length).join('|') +
    ')(\\d*)$'
);

/**
 * Parses a hairstyle label or filename into its base group key, hairline flag,
 * and companion part index.
 *
 * Implements generic prefix-pattern grouping so hairstyles with companion
 * parts (numbered layers, scalp caps, accessory buns, braids, bands) are united
 * under their primary hairstyle, while keeping HairLine (HL) as an alternative variant.
 */
export function parseHairLabel(rawLabel: string): ParsedHairLabel {
  let label = (rawLabel || '').trim();
  // Strip duplicate artifact suffixes commonly left by mod creators
  label = label.replace(/\s*-\s*copy$/i, '').replace(/_n$/i, '');

  // 1. Check for HL (HairLine) variant patterns
  // Pattern 1a: ends with digit + HL (e.g. AsterionM2HL, CatoALTM2HL, Flute1HL)
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

  // Pattern 1b: ends with HL + digit (e.g. AsterionMHL2, HairHL3)
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

  // Pattern 1c: general HL ending (e.g. AsterionMHL, PiratessBr1HL, ZhiAC1HL)
  let isHL = false;
  let workLabel = label;
  m = label.match(/^(.*?)(?:_|\s|-)?hl$/i);
  if (m) {
    isHL = true;
    workLabel = m[1].replace(/[_\s-]+$/, '');
  }

  // 2. Check for universal companion tokens (AC, SC, Ban, Tail, Br, STR, etc.)
  const tm = workLabel.match(COMPANION_TOKEN_PATTERN);
  if (tm && tm[1].length >= 3 && !/^(face|race|grace|peace|space|trace|ace)$/i.test(tm[1])) {
    const base = tm[1].replace(/[_\s-]+$/, '');
    const tok = tm[2].toUpperCase();
    const subNum = tm[3] ? parseInt(tm[3], 10) : 0;
    // Scalps sort at 50, accessories/sections sort at 100+
    const offset = ['SC', 'SCALP', 'MSC', 'SCA'].includes(tok) ? 50 : 100;
    return {
      groupKey: isHL ? base + 'HL' : base,
      label: isHL ? base + ' HL' : base,
      isHL,
      partNumber: offset + subNum,
    };
  }

  // 3. Delimited companion parts: e.g. Hair_Accessories, Style-Bun
  const dm = workLabel.match(/^(.*?)[_\s-]+([a-zA-Z]+)(\d*)$/);
  if (dm && dm[1].length >= 3 && !/^(hl)$/i.test(dm[2])) {
    const base = dm[1].replace(/[_\s-]+$/, '');
    const subNum = dm[3] ? parseInt(dm[3], 10) : 0;
    return {
      groupKey: isHL ? base + 'HL' : base,
      label: isHL ? base + ' HL' : base,
      isHL,
      partNumber: 150 + subNum,
    };
  }

  // 4. Non-HL ending with digit (e.g. AsterionM2, AsterionM3, Flute1, EmpressOf1, Azathoth5)
  m = workLabel.match(/^(.*?)(?:_|\s|-)?(\d+)$/);
  if (m) {
    const base = m[1].replace(/[_\s-]+$/, '');
    const partNum = parseInt(m[2], 10);
    return {
      groupKey: isHL ? base + 'HL' : base,
      label: isHL ? base + ' HL' : base,
      isHL,
      partNumber: partNum,
    };
  }

  // 5. Standard hair (no companion markers)
  return {
    groupKey: isHL ? workLabel + 'HL' : workLabel,
    label: isHL ? workLabel + ' HL' : workLabel,
    isHL,
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

    // Deduplicate identical parts (e.g. duplicate files or copy artifacts)
    const isDup = group.parts.some(
      (p) =>
        p.id === opt.id ||
        (p.raw.file && opt.file && p.raw.file.toLowerCase() === opt.file.toLowerCase()),
    );
    if (isDup) continue;

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
