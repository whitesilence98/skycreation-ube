/**
 * lib/bodyslide/presetParser.ts
 *
 * BodySlide XML Preset Parser & Serializer.
 * Compatible with Bethesda Creation Engine BodySlide presets (.xml).
 *
 * Runs seamlessly in both Browser and Node.js environments (no DOM dependency).
 */

export interface BodySlidePreset {
  /** Name of the preset (e.g. 'UBE Necoco V1') */
  name: string;
  /** Slider set name (e.g. 'UBE SE 2.0 - Necoco Body') */
  set: string;
  /** BodySlide category groups (e.g. ['UBE', 'UBE Female', 'UBE Male', 'UBE Outfit']) */
  groups: string[];
  /** Primary slider values (size="big" or general value). Values typically range 0 - 100 or signed. */
  sliders: Record<string, number>;
  /** Optional secondary slider values (size="small"). */
  smallSliders?: Record<string, number>;
  /** Detailed slider values indexed by size variant */
  sliderDetails?: Record<string, { big?: number; small?: number }>;
}

export interface ExportBodySlideOptions {
  /** Preset display name. Defaults to 'Custom Preset' */
  presetName?: string;
  /** Slider set target. Defaults to 'UBE SE 2.0 - Necoco Body' */
  setName?: string;
  /** Target groups. Defaults to standard UBE groups */
  groups?: string[];
  /** Active slider values map (slider name -> numeric value) */
  sliders: Record<string, number>;
  /** Optional secondary slider values (size="small") */
  smallSliders?: Record<string, number>;
  /** Primary size variant attribute. Defaults to 'big' */
  size?: 'big' | 'small';
  /** Whether to serialize sliders with a value of 0. Defaults to false (sparse output) */
  includeZeros?: boolean;
}

export const DEFAULT_UBE_GROUPS: readonly string[] = Object.freeze([
  'UBE',
  'UBE Female',
  'UBE Male',
  'UBE Outfit',
]);

export const DEFAULT_SLIDER_SET = 'UBE SE 2.0 - Necoco Body';

/**
 * Unescapes standard XML entities.
 */
function unescapeXml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Escapes special characters for XML attribute output.
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Parses a BodySlide preset XML string into an array of BodySlidePreset objects.
 * Handles single or multiple <Preset> definitions within <SliderPresets>.
 */
export function parseBodySlidePresetXml(xml: string): BodySlidePreset[] {
  const presets: BodySlidePreset[] = [];

  // Match each <Preset name="..." set="...">...</Preset> block
  const presetRegex = /<Preset\s+([^>]+)>([\s\S]*?)<\/Preset>/gi;
  let match: RegExpExecArray | null;

  while ((match = presetRegex.exec(xml)) !== null) {
    const attrString = match[1];
    const bodyString = match[2];

    const nameMatch = /name\s*=\s*["']([^"']+)["']/i.exec(attrString);
    const setMatch = /set\s*=\s*["']([^"']+)["']/i.exec(attrString);

    const name = nameMatch ? unescapeXml(nameMatch[1]) : 'Unnamed Preset';
    const set = setMatch ? unescapeXml(setMatch[1]) : DEFAULT_SLIDER_SET;

    const groups: string[] = [];
    const groupRegex = /<Group\s+name\s*=\s*["']([^"']+)["']/gi;
    let groupMatch: RegExpExecArray | null;
    while ((groupMatch = groupRegex.exec(bodyString)) !== null) {
      groups.push(unescapeXml(groupMatch[1]));
    }

    const sliders: Record<string, number> = {};
    const smallSliders: Record<string, number> = {};
    const sliderDetails: Record<string, { big?: number; small?: number }> = {};

    // Match <SetSlider name="..." size="..." value="..."/>
    const sliderRegex = /<SetSlider\s+([^>]+)\/?>/gi;
    let sliderMatch: RegExpExecArray | null;
    while ((sliderMatch = sliderRegex.exec(bodyString)) !== null) {
      const sAttrs = sliderMatch[1];
      const sNameMatch = /name\s*=\s*["']([^"']+)["']/i.exec(sAttrs);
      const sValueMatch = /value\s*=\s*["']([^"']+)["']/i.exec(sAttrs);
      const sSizeMatch = /size\s*=\s*["']([^"']+)["']/i.exec(sAttrs);

      if (!sNameMatch || !sValueMatch) continue;

      const sName = unescapeXml(sNameMatch[1]);
      const sValue = parseFloat(sValueMatch[1]);
      if (Number.isNaN(sValue)) continue;

      const size = sSizeMatch ? sSizeMatch[1].toLowerCase() : 'big';

      if (!sliderDetails[sName]) {
        sliderDetails[sName] = {};
      }

      if (size === 'small') {
        smallSliders[sName] = sValue;
        sliderDetails[sName].small = sValue;
        // If big was not set yet, provide small as fallback
        if (sliders[sName] === undefined) {
          sliders[sName] = sValue;
        }
      } else {
        sliders[sName] = sValue;
        sliderDetails[sName].big = sValue;
      }
    }

    presets.push({
      name,
      set,
      groups: groups.length > 0 ? groups : [...DEFAULT_UBE_GROUPS],
      sliders,
      smallSliders: Object.keys(smallSliders).length > 0 ? smallSliders : undefined,
      sliderDetails: Object.keys(sliderDetails).length > 0 ? sliderDetails : undefined,
    });
  }

  return presets;
}

/**
 * Parses a BodySlide preset XML string and returns the first preset or one matching presetName.
 */
export function parseBodySlidePreset(xml: string, presetName?: string): BodySlidePreset | null {
  const presets = parseBodySlidePresetXml(xml);
  if (presets.length === 0) return null;
  if (!presetName) return presets[0];

  const search = presetName.trim().toLowerCase();
  const found = presets.find((p) => p.name.trim().toLowerCase() === search);
  return found ?? presets[0];
}

/**
 * Serializes active slider values into standard BodySlide XML preset format.
 */
export function exportBodySlidePresetXml(options: ExportBodySlideOptions): string {
  const presetName = options.presetName ?? 'Custom Preset';
  const setName = options.setName ?? DEFAULT_SLIDER_SET;
  const groups = options.groups && options.groups.length > 0 ? options.groups : DEFAULT_UBE_GROUPS;
  const defaultSize = options.size ?? 'big';
  const includeZeros = options.includeZeros ?? false;

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<SliderPresets>',
    `    <Preset name="${escapeXml(presetName)}" set="${escapeXml(setName)}">`,
  ];

  for (const group of groups) {
    lines.push(`        <Group name="${escapeXml(group)}"/>`);
  }

  // Deterministic alphabetical ordering for stable output
  const sortedNames = Object.keys(options.sliders).sort((a, b) => a.localeCompare(b));

  for (const sName of sortedNames) {
    const val = options.sliders[sName];
    if (typeof val !== 'number' || Number.isNaN(val)) continue;
    if (!includeZeros && val === 0) continue;
    lines.push(`        <SetSlider name="${escapeXml(sName)}" size="${defaultSize}" value="${val}"/>`);
  }

  // Optional small sliders
  if (options.smallSliders) {
    const sortedSmallNames = Object.keys(options.smallSliders).sort((a, b) => a.localeCompare(b));
    for (const sName of sortedSmallNames) {
      const val = options.smallSliders[sName];
      if (typeof val !== 'number' || Number.isNaN(val)) continue;
      if (!includeZeros && val === 0) continue;
      lines.push(`        <SetSlider name="${escapeXml(sName)}" size="small" value="${val}"/>`);
    }
  }

  lines.push('    </Preset>');
  lines.push('</SliderPresets>');
  lines.push('');

  return lines.join('\n');
}

/**
 * Alias for exportBodySlidePresetXml that accepts a BodySlidePreset object.
 */
export function exportPresetToXml(preset: BodySlidePreset): string {
  return exportBodySlidePresetXml({
    presetName: preset.name,
    setName: preset.set,
    groups: preset.groups,
    sliders: preset.sliders,
    smallSliders: preset.smallSliders,
  });
}

/**
 * Fetches and parses a BodySlide preset XML file from a URL.
 */
export async function loadPresetFromXmlUrl(url: string): Promise<BodySlidePreset | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[presetParser] Failed to fetch preset from ${url}: ${res.statusText}`);
      return null;
    }
    const text = await res.text();
    return parseBodySlidePreset(text);
  } catch (err) {
    console.error(`[presetParser] Error loading preset from ${url}:`, err);
    return null;
  }
}
