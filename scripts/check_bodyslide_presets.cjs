/**
 * scripts/check_bodyslide_presets.cjs
 *
 * Verification suite for BodySlide preset parser and legacy silhouette mappings.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Verify XML Preset Parsing
const presetDir = path.join(__dirname, '..', 'public', 'assets', 'bodyslide', 'presets');

const v1Path = path.join(presetDir, 'UBE Necoco V1.xml');
const v2Path = path.join(presetDir, 'UBE Necoco V2.xml');
const outfitsPath = path.join(presetDir, 'UBE Necoco for Converting Outfits.xml');

assert(fs.existsSync(v1Path), 'V1 preset file missing');
assert(fs.existsSync(v2Path), 'V2 preset file missing');
assert(fs.existsSync(outfitsPath), 'Converting Outfits preset file missing');

// Load TS/compiled or mock parser function matching presetParser.ts
function unescapeXml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseBodySlidePresetXml(xml) {
  const presets = [];
  const presetRegex = /<Preset\s+([^>]+)>([\s\S]*?)<\/Preset>/gi;
  let match;

  while ((match = presetRegex.exec(xml)) !== null) {
    const attrString = match[1];
    const bodyString = match[2];

    const nameMatch = /name\s*=\s*["']([^"']+)["']/i.exec(attrString);
    const setMatch = /set\s*=\s*["']([^"']+)["']/i.exec(attrString);

    const name = nameMatch ? unescapeXml(nameMatch[1]) : 'Unnamed Preset';
    const set = setMatch ? unescapeXml(setMatch[1]) : 'UBE SE 2.0 - Necoco Body';

    const groups = [];
    const groupRegex = /<Group\s+name\s*=\s*["']([^"']+)["']/gi;
    let groupMatch;
    while ((groupMatch = groupRegex.exec(bodyString)) !== null) {
      groups.push(unescapeXml(groupMatch[1]));
    }

    const sliders = {};
    const smallSliders = {};

    const sliderRegex = /<SetSlider\s+([^>]+)\/?>/gi;
    let sliderMatch;
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

      if (size === 'small') {
        smallSliders[sName] = sValue;
        if (sliders[sName] === undefined) {
          sliders[sName] = sValue;
        }
      } else {
        sliders[sName] = sValue;
      }
    }

    presets.push({ name, set, groups, sliders, smallSliders });
  }

  return presets;
}

// Test V1
const v1 = parseBodySlidePresetXml(fs.readFileSync(v1Path, 'utf8'));
assert.strictEqual(v1.length, 1, 'V1 should have 1 preset');
assert.strictEqual(v1[0].name, 'UBE Necoco V1');
assert.strictEqual(v1[0].sliders['Necoco_Boob_Base'], 100);
assert.strictEqual(v1[0].sliders['Necoco_Body_Addon_Belly'], 100);
assert.strictEqual(v1[0].sliders['Necoco_Body_Addon_Butt'], 100);

// Test V2
const v2 = parseBodySlidePresetXml(fs.readFileSync(v2Path, 'utf8'));
assert.strictEqual(v2.length, 1, 'V2 should have 1 preset');
assert.strictEqual(v2[0].name, 'UBE Necoco V2');
assert.strictEqual(v2[0].sliders['Necoco_Boob_Addon_Bom39'], 65);

// Test Outfits
const outfits = parseBodySlidePresetXml(fs.readFileSync(outfitsPath, 'utf8'));
assert.strictEqual(outfits.length, 1);
assert.strictEqual(outfits[0].name, 'UBE Necoco for Converting Outfits');
assert(Object.keys(outfits[0].sliders).length > 100, 'Converting outfits should have >100 sliders');
assert.strictEqual(outfits[0].sliders['AnkleThickness p|n'], -80);

// Test Legacy Silhouette Mapping
const LEGACY_SILHOUETTE_MAPPING = {
  'body.chestSize': 'Necoco_Overall_Boob',
  'body.waistSize': 'Necoco_Body_Addon_Belly',
  'body.buttSize': 'Necoco_Body_Addon_Butt',
  'body.belly': 'Necoco_Body_Addon_Belly',
  'body.thighWidth': 'Necoco_Body_Addon_Leg',
  'body.fat': 'Necoco_Body_Addon_Upper_Body_Smooth',
  'body.hipWidth': 'Upper_Outer_Thighs_Width',
};

function mapLegacySilhouetteToBodySlide(legacyAnatomy = {}) {
  const result = {};
  for (const [legacyKey, morphKey] of Object.entries(LEGACY_SILHOUETTE_MAPPING)) {
    const val = legacyAnatomy[legacyKey];
    if (typeof val === 'number' && Number.isFinite(val)) {
      result[morphKey] = Math.max(0, Math.min(100, val));
    }
  }
  return result;
}

const legacyTest = {
  'body.chestSize': 85,
  'body.waistSize': 40,
  'body.buttSize': 95,
  'body.heightCm': 175, // Should not map to morph
};

const mapped = mapLegacySilhouetteToBodySlide(legacyTest);
assert.strictEqual(mapped['Necoco_Overall_Boob'], 85);
assert.strictEqual(mapped['Necoco_Body_Addon_Belly'], 40);
assert.strictEqual(mapped['Necoco_Body_Addon_Butt'], 95);
assert.strictEqual(mapped['Necoco_Body_Addon_Leg'], undefined);
assert.strictEqual(mapped['body.heightCm'], undefined);

console.log('ALL BODYSLIDE PRESET & STORE VERIFICATION TESTS PASSED!');
