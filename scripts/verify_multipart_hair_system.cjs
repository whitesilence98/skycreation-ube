const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(name) {
  const file = path.join(root, name + '.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    {
      module,
      exports: module.exports,
      console,
      process,
      URLSearchParams,
      require: (id) => {
        if (id.startsWith('@/')) return load(id.slice(2));
        if (id.startsWith('.')) {
          const rel = path.relative(root, path.resolve(path.dirname(file), id)).split(path.sep).join('/');
          return load(rel);
        }
        return require(id);
      },
    },
    { filename: file },
  );
  return module.exports;
}

// 1. Test parsing rules
const hairMod = load('lib/hair');
const { parseHairLabel, buildHairGroups, findHairGroupForPartId } = hairMod;

console.log('=== Test 1: Hair Label Parsing Rules ===');
const testCases = [
  { input: 'AsterionM', expectedGroup: 'AsterionM', expectedPart: 0, expectedHL: false },
  { input: 'AsterionM2', expectedGroup: 'AsterionM', expectedPart: 2, expectedHL: false },
  { input: 'AsterionM3', expectedGroup: 'AsterionM', expectedPart: 3, expectedHL: false },
  { input: 'AsterionMHL', expectedGroup: 'AsterionMHL', expectedPart: 0, expectedHL: true },
  { input: 'AsterionM2HL', expectedGroup: 'AsterionMHL', expectedPart: 2, expectedHL: true },
  { input: 'AsterionM3HL', expectedGroup: 'AsterionMHL', expectedPart: 3, expectedHL: true },
  { input: 'Flute', expectedGroup: 'Flute', expectedPart: 0, expectedHL: false },
  { input: 'Flute1', expectedGroup: 'Flute', expectedPart: 1, expectedHL: false },
  { input: 'Flute1HL', expectedGroup: 'FluteHL', expectedPart: 1, expectedHL: true },
  { input: 'FluteHL', expectedGroup: 'FluteHL', expectedPart: 0, expectedHL: true },
  { input: 'Maeve2HL', expectedGroup: 'MaeveHL', expectedPart: 2, expectedHL: true },
  { input: 'Azathoth5', expectedGroup: 'Azathoth', expectedPart: 5, expectedHL: false },
  // Universal Companion Token Tests
  { input: 'EmpressOf', expectedGroup: 'EmpressOf', expectedPart: 0, expectedHL: false },
  { input: 'EmpressOf1', expectedGroup: 'EmpressOf', expectedPart: 1, expectedHL: false },
  { input: 'EmpressOfAC', expectedGroup: 'EmpressOf', expectedPart: 100, expectedHL: false },
  { input: 'EmpressOfAC3', expectedGroup: 'EmpressOf', expectedPart: 103, expectedHL: false },
  { input: 'EmpressOfAC6', expectedGroup: 'EmpressOf', expectedPart: 106, expectedHL: false },
  { input: 'EmpressOfHL', expectedGroup: 'EmpressOfHL', expectedPart: 0, expectedHL: true },
  { input: 'EmpressOf1HL', expectedGroup: 'EmpressOfHL', expectedPart: 1, expectedHL: true },
  { input: 'MarcellusSC', expectedGroup: 'Marcellus', expectedPart: 50, expectedHL: false },
  { input: 'BuriedTreasureBan', expectedGroup: 'BuriedTreasure', expectedPart: 100, expectedHL: false },
  { input: 'PiratessBr1', expectedGroup: 'Piratess', expectedPart: 101, expectedHL: false },
  { input: 'PiratessRTai', expectedGroup: 'Piratess', expectedPart: 100, expectedHL: false },
];

for (const tc of testCases) {
  const res = parseHairLabel(tc.input);
  assert.strictEqual(res.groupKey, tc.expectedGroup, `Group mismatch for ${tc.input}: got ${res.groupKey}, expected ${tc.expectedGroup}`);
  assert.strictEqual(res.partNumber, tc.expectedPart, `Part mismatch for ${tc.input}: got ${res.partNumber}, expected ${tc.expectedPart}`);
  assert.strictEqual(res.isHL, tc.expectedHL, `HL mismatch for ${tc.input}: got ${res.isHL}, expected ${tc.expectedHL}`);
  console.log(`  ✓ ${tc.input.padEnd(18)} -> Group: ${res.groupKey.padEnd(14)} Part: ${res.partNumber} HL: ${res.isHL}`);
}

console.log('\n=== Test 2: Full Catalogue Hairstyle Grouping ===');
const hairMeshes = JSON.parse(fs.readFileSync('public/assets/preset-pack/catalogue/hairMesh.json', 'utf8'));
const groups = buildHairGroups(hairMeshes);

console.log(`  Total raw NIF meshes: ${hairMeshes.length}`);
console.log(`  Consolidated hairstyles: ${groups.length}`);
assert(groups.length > 0, 'Catalogue must contain hairstyle groups');

// Check EmpressOf (Full 7-Part Hairstyle)
const empress = groups.find(g => g.groupKey.toLowerCase() === 'empressof');
assert(empress, 'EmpressOf group must exist');
assert.strictEqual(empress.parts.length, 7, `EmpressOf must have 7 parts, got ${empress.parts.length}`);
console.log(`  ✓ EmpressOf: ${empress.parts.length} parts (Base + 1 + AC + AC3 + AC4 + AC5 + AC6)`);

// Check Piratess (Full 12-Part Hairstyle with Braids, Ponytail, Accessories)
const piratess = groups.find(g => g.groupKey.toLowerCase() === 'piratess');
assert(piratess, 'Piratess group must exist');
assert.strictEqual(piratess.parts.length, 12, `Piratess must have 12 parts, got ${piratess.parts.length}`);
console.log(`  ✓ Piratess: ${piratess.parts.length} parts (Base + 1 + AC..4 + Bangs + Braids..2 + Right Tail)`);

// Check Shadow (5 Parts: Base + 2 + AC + AC2 + In)
const shadow = groups.find(g => g.groupKey.toLowerCase() === 'shadow');
assert(shadow, 'Shadow group must exist');
assert.strictEqual(shadow.parts.length, 5, `Shadow must have 5 parts including ShadowIn, got ${shadow.parts.length}`);
assert(!groups.some(g => g.groupKey.toLowerCase() === 'shadowin'), 'ShadowIn must not exist as standalone group');
console.log(`  ✓ Shadow: ${shadow.parts.length} parts (Base + 2 + AC + AC2 + In [Inner volume])`);

// Check Regina (2 Parts: Base + In)
const regina = groups.find(g => g.groupKey.toLowerCase() === 'regina');
assert(regina, 'Regina group must exist');
assert.strictEqual(regina.parts.length, 2, `Regina must have 2 parts including ReginaIn, got ${regina.parts.length}`);
assert(!groups.some(g => g.groupKey.toLowerCase() === 'reginain'), 'ReginaIn must not exist as standalone group');
console.log(`  ✓ Regina: ${regina.parts.length} parts (Base + In [Inner volume])`);

// Synthetic companions stay covered even when these hairstyles are pruned.
const fixtureGroups = buildHairGroups(
  ['AsterionM', 'AsterionM2', 'AsterionM3', 'AsterionMHL', 'AsterionM2HL', 'AsterionM3HL'].map(label => ({
    id: `fixture-${label}`,
    label,
    pairedTextureId: 'fixture-texture',
  }))
);
assert.strictEqual(fixtureGroups.length, 2, 'Base and HL fixtures must remain separate groups');

// Check AsterionM
const asterion = fixtureGroups.find(g => g.groupKey === 'AsterionM');
assert(asterion, 'AsterionM group must exist');
assert.strictEqual(asterion.parts.length, 3, `AsterionM must have 3 parts, got ${asterion.parts.length}`);
assert.strictEqual(asterion.isHL, false, 'AsterionM isHL must be false');
console.log(`  ✓ AsterionM: ${asterion.parts.length} parts (${asterion.parts.map(p => p.label).join(', ')})`);

// Check AsterionMHL
const asterionHL = fixtureGroups.find(g => g.groupKey === 'AsterionMHL');
assert(asterionHL, 'AsterionMHL group must exist');
assert.strictEqual(asterionHL.parts.length, 3, `AsterionMHL must have 3 parts, got ${asterionHL.parts.length}`);
assert.strictEqual(asterionHL.isHL, true, 'AsterionMHL isHL must be true');
console.log(`  ✓ AsterionMHL (Hairline): ${asterionHL.parts.length} parts (${asterionHL.parts.map(p => p.label).join(', ')})`);

// Verify companion texture sharing
assert.strictEqual(asterion.pairedTextureId, 'fixture-texture', 'Base fixture must retain its paired texture');
assert.strictEqual(asterionHL.pairedTextureId, asterion.pairedTextureId, 'HL fixture must share the base texture');
console.log(`  ✓ Shared texture: AsterionM & AsterionMHL both share texture ${asterion.pairedTextureId}`);

console.log('\n=== Test 3: Backward-Compatible Sub-Part Lookup ===');
// Selecting AsterionM2 directly should resolve the entire AsterionM group
const subpart = findHairGroupForPartId(fixtureGroups, 'fixture-AsterionM2');
assert(subpart, 'Sub-part AsterionM2 must resolve to a group');
assert.strictEqual(subpart.groupKey, 'AsterionM', 'Sub-part AsterionM2 must resolve to AsterionM group');
assert.strictEqual(subpart.parts.length, 3, 'Resolved group must contain all 3 parts');
console.log(`  ✓ Sub-part AsterionM2 resolves to full group [${subpart.groupKey}] with ${subpart.parts.length} parts`);

// Selecting AsterionM3HL directly should resolve the entire AsterionMHL group
const subpartHL = findHairGroupForPartId(fixtureGroups, 'fixture-AsterionM3HL');
assert(subpartHL, 'Sub-part AsterionM3HL must resolve to a group');
assert.strictEqual(subpartHL.groupKey, 'AsterionMHL', 'Sub-part AsterionM3HL must resolve to AsterionMHL group');
assert.strictEqual(subpartHL.parts.length, 3, 'Resolved group must contain all 3 parts');
console.log(`  ✓ Sub-part AsterionM3HL resolves to full group [${subpartHL.groupKey}] with ${subpartHL.parts.length} parts`);

console.log('\n=== Test 4: Manifest Resolution & Multi-Part Output ===');
const sel = load('lib/manifestSelect');
const { resolveManifest } = sel;
const manifest = JSON.parse(fs.readFileSync('public/assets/preset-pack/manifest.json', 'utf8'));

const hairTextures = JSON.parse(fs.readFileSync('public/assets/preset-pack/catalogue/hair.json', 'utf8'));

// Resolve a retained full hairstyle with hairMesh and hair catalogues.
const resolved = resolveManifest(
  manifest,
  { hairMesh: empress.id },
  { hairMesh: hairMeshes, hair: hairTextures }
);

assert(resolved, 'Resolved manifest must not be null');
assert(resolved.parts, 'Resolved manifest must have parts');
assert(Array.isArray(resolved.parts.hairParts), 'resolved.parts.hairParts must be an array');
assert.strictEqual(resolved.parts.hairParts.length, 7, `Expected 7 EmpressOf hair parts in manifest, got ${resolved.parts.hairParts.length}`);

for (let i = 0; i < resolved.parts.hairParts.length; i++) {
  const p = resolved.parts.hairParts[i];
  assert(p.meshUrl && p.meshUrl.includes('/api/mo2/convert'), `Part ${i + 1} (${p.label}) must have a valid meshUrl: ${p.meshUrl}`);
  assert(p.texture, `Part ${i + 1} (${p.label}) must inherit texture: ${p.texture}`);
  console.log(`  ✓ Part ${i + 1} [${p.label}]: meshUrl=${p.meshUrl} texture=${p.texture}`);
}

console.log('\n=== Test 5: HairLine Manifest Resolution (MaeveHL) ===');
const maeveHL = groups.find(g => g.groupKey.toLowerCase() === 'maevehl');
assert(maeveHL && maeveHL.isHL && maeveHL.parts.length > 1, 'Retained MaeveHL must contain multiple hairline parts');
const resolvedHL = resolveManifest(
  manifest,
  { hairMesh: maeveHL.id },
  { hairMesh: hairMeshes, hair: hairTextures }
);

assert(resolvedHL, 'Resolved manifest must not be null');
assert(resolvedHL.parts, 'Resolved manifest must have parts');
assert(Array.isArray(resolvedHL.parts.hairParts), 'resolvedHL.parts.hairParts must be an array');
assert.strictEqual(resolvedHL.parts.hairParts.length, maeveHL.parts.length, `Expected all ${maeveHL.parts.length} MaeveHL parts in manifest, got ${resolvedHL.parts.hairParts.length}`);

for (let i = 0; i < resolvedHL.parts.hairParts.length; i++) {
  const p = resolvedHL.parts.hairParts[i];
  assert(p.meshUrl && p.meshUrl.includes('/api/mo2/convert'), `HL Part ${i + 1} (${p.label}) must have a valid meshUrl: ${p.meshUrl}`);
  assert(p.texture, `HL Part ${i + 1} (${p.label}) must inherit texture: ${p.texture}`);
  console.log(`  ✓ HL Part ${i + 1} [${p.label}]: meshUrl=${p.meshUrl} texture=${p.texture}`);
}

console.log('\n=== Test 6: Retained A–L Catalogue Groups ===');
const keepGroups = new Set([
  'AenSeidhe', 'Avian', 'Balenciaga', 'BennyWatts', 'BuriedTreasure',
  'CalidusM', 'Dalia', 'DivineDread', 'Eluna', 'EmpressOf',
  'FallofAdam', 'Fawny', 'Flute', 'GinM', 'Grimes',
  'Harley', 'Jack', 'LastKiss', 'Luanne', 'Lute',
].map(key => key.toLowerCase()));
const retainedAL = groups.filter(g => /^[a-l]/i.test(g.groupKey));
assert.strictEqual(retainedAL.length, keepGroups.size, 'Only the twenty retained A–L groups may remain');
for (const group of retainedAL) {
  assert(!group.isHL && keepGroups.has(group.groupKey.toLowerCase()), `Unexpected A–L group: ${group.groupKey}`);
}
for (const item of hairMeshes) {
  const parsed = parseHairLabel(item.label || item.file || item.id);
  if (/^[a-l]/i.test(parsed.groupKey)) {
    assert(!parsed.isHL && keepGroups.has(parsed.groupKey.toLowerCase()), `Unexpected A–L raw mesh: ${item.id} (${item.label})`);
  }
}

console.log('\n=== Test 7: Built-In LYRA Hair Default ===');
const { PRESETS } = load('lib/regions');
const lyra = PRESETS.find(preset => preset.id === 'lyra');
assert(lyra, 'Built-in lyra preset must exist');
assert.strictEqual(lyra.assets?.hairMesh, 'hairMesh-81fd9665619193d4', 'LYRA must default to Maeve hair mesh');
assert.strictEqual(lyra.assets?.hair, 'hair-91a00facdc8ba472', 'LYRA must default to Maeve hair texture');
assert(hairMeshes.some(item => item.id === lyra.assets.hairMesh), 'LYRA default hair mesh must exist in the live catalogue');
assert(hairTextures.some(item => item.id === lyra.assets.hair), 'LYRA default hair texture must exist in the live catalogue');

console.log('\n>>> ALL 7 MULTI-PART HAIR VERIFICATION CHECKS PASSED SUCCESSFULLY! <<<');
