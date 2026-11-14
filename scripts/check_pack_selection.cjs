// Run: node scripts/check_pack_selection.cjs
// Pack contract for the parts the frontend resolves. Reuses the same pure
// resolveManifest the app uses; the legacy check keeps its own expectations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

/** TypeScript's own resolver has no path alias here; this stub is enough for
 *  `tsc`'s emit pass because the imports are type-only. */
const transpile = (file) => ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const fakeRequire = (id) => {
  if (id === '@/lib/equipment') return equipmentModule();
  assert.equal(id, '@/lib/mo2/client');
  return { convertUrl: (options) => `/api/mo2/convert?${new URLSearchParams(options)}` };
};
const loadModule = (file) => {
  const moduleObject = { exports: {} };
  vm.runInNewContext(transpile(file), {
    exports: moduleObject.exports, module: moduleObject, require: fakeRequire,
  });
  return moduleObject.exports;
};
let equipmentCache;
/** `manifestSelect` imports the slot vocabulary as values, so the vm needs it. */
const equipmentModule = () => (equipmentCache ??= loadModule('../lib/equipment.ts'));
const { resolveManifest, assetOptions, CATEGORY_MAP } = loadModule('../lib/manifestSelect.ts');
const { EQUIP_SLOTS, isEquipSelection, equipSlotOf, normalizeEquipSlot } = equipmentModule();

const asset = (id, more = {}) => ({ id, mod: 'pack', file: id, rel: `pack/${id}`, ...more });
const pack = {
  available: true,
  source: 'Skyrim Preset For App',
  sourceId: 'preset-pack',
  sourceLayout: 'pack',
  diagnostics: [],
  textures: { skin: '/api/mo2/convert?kind=skin&id=skin&mode=albedo' },
  assets: {
    headMesh: [asset('head', { meshUrl: '/api/mo2/convert?kind=headMesh&id=head&mode=mesh', isRealMesh: true })],
    skin: [asset('skin', { texture: '/skin.webp', palette: {}, size: [1, 1] })],
    hairMesh: [asset('hairA', { meshUrl: '/hair-a.json', pairedTextureId: 'hairTex' })],
    hair: [asset('hairTex', { texture: '/hair.webp' })],
    clothingMesh: [asset('outfit', { meshUrl: '/outfit.json', pairedTextureId: 'outfitTex' })],
    clothing: [asset('outfitTex', { texture: '/outfit.webp', normalTexture: '/outfit_n.png' })],
  },
};
const catalogue = {
  hairMesh: [asset('hairB', { mapRole: 'mesh', decodable: true })],
  clothingMesh: [asset('outfitBlocked', { mapRole: 'mesh', decodable: false, reason: 'unsupported shape layout' })],
  clothing: [asset('outfitTexAlt', { mapRole: 'albedo' })],
};

assert.equal(pack.sourceLayout, 'pack');
assert.ok(CATEGORY_MAP.clothing, 'CLOTHING is a picker category');
assert.equal(CATEGORY_MAP.clothing.mesh, 'clothingMesh');
assert.equal(CATEGORY_MAP.clothing.texture, 'clothing');
assert.ok(assetOptions(pack, 'clothingMesh').length, 'clothing meshes are manifest options');

// Default outfit is the supplied authored mesh with its authored atlas.
let resolved = resolveManifest(pack, {}, catalogue);
assert.equal(resolved.parts.clothing.meshUrl, '/outfit.json');
assert.equal(resolved.parts.clothing.texture, '/outfit.webp');
assert.equal(resolved.parts.clothing.normalTexture, '/outfit_n.png');

// Selecting a catalogue outfit carries its mesh URL and does not borrow the
// default atlas when the catalogue has no pairing.
resolved = resolveManifest(pack, { clothingMesh: 'outfitBlocked' }, catalogue);
assert.equal(resolved.parts.clothing.meshUrl, '/outfit.json', 'undecodable outfit cannot resolve');

resolved = resolveManifest(pack, { clothingMesh: 'outfitBlocked', clothing: 'outfitTexAlt' }, catalogue);
assert.ok(resolved.parts.clothing.texture.includes('id=outfitTexAlt'));

// Authored hair without a pack pairing keeps its manifest default atlas.
resolved = resolveManifest(pack, { hairMesh: 'hairB' }, catalogue);
assert.ok(resolved.parts.hair.meshUrl.includes('id=hairB'));

// ── hands / feet ───────────────────────────────────────────────────────────
// They are geometry slots that share the BODY atlas; no new texture kind.
const types = loadModule('../lib/mo2/types.ts');
for (const kind of ['handsMesh', 'feetMesh']) {
  assert.ok(types.MESH_KINDS.includes(kind), `${kind} is a mesh kind`);
  assert.ok(types.PICKER_KINDS.includes(kind), `${kind} is a picker kind`);
  assert.ok(!types.TEXTURE_KINDS.includes(kind), `${kind} must not become a texture kind`);
}
assert.equal(CATEGORY_MAP.hands.mesh, 'handsMesh');
assert.equal(CATEGORY_MAP.hands.texture, 'body');
assert.equal(CATEGORY_MAP.feet.mesh, 'feetMesh');
assert.equal(CATEGORY_MAP.feet.texture, 'body');

// Default: the authored hand/foot meshes are drawn and wear the body default
// atlas, because the pack may already have selected one.
const extremityPack = {
  ...pack,
  assets: {
    ...pack.assets,
    body: [asset('bodyTex', { texture: '/body.webp', normalTexture: '/body_n.png' })],
    handsMesh: [asset('hands', { meshUrl: '/hands.json' })],
    feetMesh: [asset('feet', { meshUrl: '/feet.json' })],
  },
};
resolved = resolveManifest(extremityPack, {}, {});
assert.equal(resolved.parts.hands.meshUrl, '/hands.json');
assert.equal(resolved.parts.feet.meshUrl, '/feet.json');
assert.equal(resolved.parts.hands.texture, '/body.webp');
assert.equal(resolved.parts.feet.texture, '/body.webp');
assert.equal(resolved.parts.hands.normalTexture, '/body_n.png');

// A shared BODY override reaches all three slots...
const sharedAtlas = { body: [asset('bodyAlt', { mapRole: 'albedo', normalId: 'bodyAltN' }), asset('bodyAltN', { mapRole: 'normal' })] };
resolved = resolveManifest(extremityPack, { body: 'bodyAlt' }, sharedAtlas);
const shared = '/api/mo2/convert?kind=body&id=bodyAlt&mode=atlas';
assert.equal(resolved.parts.body.texture, shared, 'body uses the shared BODY override');
assert.equal(resolved.parts.hands.texture, shared, 'hands inherit the BODY override');
assert.equal(resolved.parts.feet.texture, shared, 'feet inherit the BODY override');
assert.equal(
  resolved.parts.hands.normalTexture,
  '/api/mo2/convert?kind=body&id=bodyAltN&mode=normal',
  'hand normals come from the BODY kind, not a hands kind',
);

// ...and selecting a mesh must neither invent a cross-kind URL nor borrow a
// weight pair from the default row it replaced.
const pairedBody = {
  ...extremityPack,
  assets: {
    ...extremityPack.assets,
    bodyMesh: [asset('bodyPair', {
      meshUrl: '/body.json', weightKey: 'femalebody',
      weightVariants: { w0: 'bw0', w1: 'bw1' },
    })],
    handsMesh: [asset('handsPair', {
      meshUrl: '/hands.json', weightKey: 'femalehands',
      weightVariants: { w0: 'hw0', w1: 'hw1' },
    })],
  },
};
const pairCatalogue = {
  handsMesh: [asset('handsCatalogue', { mapRole: 'mesh', decodable: true })],
};
resolved = resolveManifest(pairedBody, { bodyMesh: 'bodyPair' }, pairCatalogue);
assert.ok(resolved.parts.body.weightVariants, 'the paired body resolves its own weight URLs');
assert.ok(resolved.parts.body.weightVariants.w0.includes('kind=bodyMesh'), 'body weight URLs keep the body mesh kind');
assert.ok(resolved.parts.body.weightVariants.w0.includes('id=bw0'));

resolved = resolveManifest(pairedBody, {}, {});
assert.ok(resolved.parts.hands.weightVariants?.w0.includes('kind=handsMesh'), 'hand weight URLs name the hands mesh kind, not bodyMesh');
assert.ok(resolved.parts.hands.weightVariants?.w0.includes('id=hw0'));

resolved = resolveManifest(pairedBody, { bodyMesh: 'bodyPair', handsMesh: 'handsCatalogue' }, pairCatalogue);
assert.ok(resolved.parts.hands.meshUrl.includes('kind=handsMesh'), 'hand geometry uses the handsMesh route kind');
assert.ok(resolved.parts.hands.meshUrl.includes('id=handsCatalogue'));
assert.equal(resolved.parts.hands.weightVariants, undefined, 'a single hand mesh must not inherit the default row weight pair');

// A stale cross-source id must not name another source's file.
assert.equal(resolveManifest(pack, { clothingMesh: 'legacyOnly' }, catalogue).parts.clothing.meshUrl, '/outfit.json');
assert.equal(resolveManifest(extremityPack, { handsMesh: 'legacyOnly' }, {}).parts.hands.meshUrl, '/hands.json', 'stale hand id restores the pack default');

// A producer default that is converted on demand has no meshUrl until the
// worker runs: the default branch must resolve it exactly like a pick.
const onDemand = {
  ...pack,
  assets: {
    ...pack.assets,
    hairMesh: [asset('hairOnDemand', { authored: true, onDemand: true, catalogueId: 'hairOnDemand' })],
    clothingMesh: [asset('outfitOnDemand', { authored: true, onDemand: true, catalogueId: 'outfitOnDemand' })],
  },
};
resolved = resolveManifest(onDemand, {}, {});
assert.ok(resolved.parts.hair.meshUrl?.includes('kind=hairMesh'), 'on-demand default hair resolves a worker mesh URL');
assert.ok(resolved.parts.hair.meshUrl?.includes('mode=mesh'));
assert.ok(resolved.parts.clothing.meshUrl?.includes('kind=clothingMesh'), 'on-demand default outfit resolves a worker mesh URL');

// A producer row with missing DDS is never the default that renders.
resolved = resolveManifest(
  { ...onDemand, assets: { ...onDemand.assets, hairMesh: [
    asset('hairMissing', { authored: true, onDemand: true, available: false, reason: 'missing DDS' }),
    asset('hairOnDemand', { authored: true, onDemand: true, catalogueId: 'hairOnDemand' }),
  ] } },
  {},
  {},
);
assert.ok(resolved.parts.hair.meshUrl?.includes('id=hairOnDemand'), 'unavailable default row is skipped');

// A catalogue row the producer marks unavailable cannot become the selection:
// the pack default stands in, exactly as for an undecodable row.
resolved = resolveManifest(pack, { clothingMesh: 'outfitMissing' }, {
  ...catalogue,
  clothingMesh: [asset('outfitMissing', { mapRole: 'mesh', available: false, reason: 'missing DDS' })],
});
assert.equal(resolved.parts.clothing.meshUrl, '/outfit.json', 'unavailable catalogue outfit falls back to the default');

resolved = resolveManifest(pack, { hairMesh: 'hairUnavailable' }, {
  ...catalogue,
  hairMesh: [asset('hairUnavailable', { mapRole: 'mesh', unavailable: true })],
});
assert.equal(resolved.parts.hair.meshUrl, '/hair-a.json', 'unavailable catalogue hair falls back to the default');

// The producer's `untextured` exemption: decodable geometry with absent DDS is
// still selectable and resolves a worker URL. Its `available:false` keeps every
// texture mode refusing it, so no atlas is ever borrowed for it.
const grey = asset('hairGrey', {
  authored: true, onDemand: true, catalogueId: 'hairGrey',
  available: false, untextured: true, reason: 'required textures missing',
});
resolved = resolveManifest(
  { ...onDemand, assets: { ...onDemand.assets, hairMesh: [grey] } },
  {},
  {},
);
assert.ok(resolved.parts.hair.meshUrl?.includes('id=hairGrey'), 'untextured hair resolves a mesh URL');
assert.equal(resolved.parts.hair.untextured, true, 'untextured flag reaches the renderer');
assert.equal(resolved.parts.hair.missingTextures, undefined, 'the fixture carries no missing list');

// With no hair atlas registered, the grey row names no texture at all.
resolved = resolveManifest(
  { ...onDemand, assets: { ...onDemand.assets, hair: [], hairMesh: [grey] } },
  {},
  {},
);
assert.equal(resolved.parts.hair.texture, undefined, 'untextured hair must not name an atlas');

// A textured row still wins the default when both exist.
resolved = resolveManifest(
  { ...onDemand, assets: { ...onDemand.assets, hairMesh: [grey, ...onDemand.assets.hairMesh] } },
  {},
  {},
);
assert.ok(resolved.parts.hair.meshUrl?.includes('id=hairOnDemand'), 'textured default beats grey');

// An undecodable row is still refused, exemption or not.
resolved = resolveManifest(
  { ...onDemand, assets: { ...onDemand.assets, hairMesh: [
    asset('hairBroken', { authored: true, onDemand: true, available: false, decodable: false, untextured: true }),
  ] } },
  {},
  {},
);
assert.equal(resolved.parts.hair.meshUrl, undefined, 'undecodable row cannot be served');

// Pack mode carries no legacy public URLs in the parts it resolves.
const urls = JSON.stringify(resolved);
assert.ok(!urls.includes('/assets/mo2'), 'pack selection must not emit legacy asset URLs');

const body = resolveManifest(pack, {}).parts.body;
assert.equal(body?.texture, undefined, 'pack mode must not inherit a legacy body atlas');
const generated = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/assets/preset-pack/manifest.json'), 'utf8'));
const actual = resolveManifest(generated, {});
assert.equal(actual.sourceLayout, 'pack');
assert.ok(actual.headMesh.meshUrl.startsWith('/assets/preset-pack/'));
assert.ok(actual.textures.skin.startsWith('/assets/preset-pack/'));
assert.ok(!JSON.stringify(actual).includes('/assets/mo2'));
for (const part of ['hair', 'clothing']) {
  const rows = generated.assets[`${part}Mesh`] ?? [];
  const renderable = rows.some((row) => row.decodable !== false
    && (row.untextured === true || (row.available !== false && !row.unavailable)));
  if (!renderable) assert.equal(actual.parts[part].meshUrl, undefined);
  else assert.ok(actual.parts[part].meshUrl, `${part} mesh resolves a renderable row`);
}

// ── equipment paper-doll ───────────────────────────────────────────────────
// Several garments are worn at once from the same `clothingMesh` kind, which
// `assetSelection.clothingMesh` cannot express: one id per slot, resolved into
// `parts.equipment`. A garment pair contributes its own weight URLs so the
// WEIGHT slider morphs it with the body.
const gear = {
  ...pack,
  assets: {
    ...pack.assets,
    clothingMesh: [
      asset('top1', {
        authored: true, onDemand: true, catalogueId: 'top1', equipSlot: 'top',
        weightKey: 'gladiator top', weightDefault: 1, weightVariants: { w0: 'top0', w1: 'top1' },
      }),
      asset('arms1', { authored: true, onDemand: true, catalogueId: 'arms1', equipSlot: 'hands' }),
      asset('legs1', { authored: true, onDemand: true, catalogueId: 'legs1', equipSlot: 'bottom' }),
      asset('outfit', { meshUrl: '/outfit.json', equipSlot: 'full' }),
    ],
  },
};
const gearCatalogue = {
  clothingMesh: [
    asset('boots0', { mapRole: 'mesh', decodable: true, equipSlot: 'feet', weightKey: 'boots' }),
    asset('boots1', { mapRole: 'mesh', decodable: true, equipSlot: 'feet', weightKey: 'boots', weightDefault: 1,
      onDemand: true, weightVariants: { w0: 'boots0', w1: 'boots1' } }),
  ],
};

assert.deepEqual([...EQUIP_SLOTS], ['outfit', 'top', 'bottom', 'bra', 'panties', 'stockings', 'hands', 'feet', 'accessories']);
assert.ok(isEquipSelection({ top: 'top1' }), 'a slot map validates');
assert.ok(!isEquipSelection({ top: 'top1', elbows: 'x' }), 'an unknown slot is refused');
assert.ok(!isEquipSelection({ top: 3 }), 'a non-string id is refused');
assert.equal(CATEGORY_MAP.equipment.mesh, 'clothingMesh', 'EQUIPMENT lists clothing meshes');

// Empty selection: no equipment parts, and the legacy outfit is untouched.
resolved = resolveManifest(gear, {}, gearCatalogue);
assert.equal(resolved.parts.equipment, undefined, 'an empty paper-doll contributes no parts');
assert.equal(resolved.parts.clothing.meshUrl, '/outfit.json', 'the whole outfit still resolves');
assert.equal(gear.assets.clothingMesh.find((r) => r.id === 'outfit').equipSlot, 'full',
  'the whole outfit is the `full` pseudo-slot, not a worn slot');

// Three slots filled at once, each its own part.
resolved = resolveManifest(gear, {}, gearCatalogue, { top: 'top1', hands: 'arms1', bottom: 'legs1' });
assert.equal(resolved.parts.equipment.length, 3, 'one part per filled slot');
/* Every resolved array comes out of the vm's own realm, so compare a copy. */
assert.deepEqual([...resolved.parts.equipment.map((p) => p.slot)].sort(), ['bottom', 'hands', 'top']);
for (const part of resolved.parts.equipment) {
  assert.ok(part.meshUrl?.includes('kind=clothingMesh'), `${part.slot} garment uses the clothingMesh route`);
}
const topPart = resolved.parts.equipment.find((p) => p.slot === 'top');
assert.deepEqual(Object.keys(topPart.weightVariants ?? {}), ['w0', 'w1'], 'a garment pair resolves its weight URLs');
assert.ok(topPart.weightVariants.w0.includes('kind=clothingMesh'), 'garment weight URLs keep the clothing mesh kind');
assert.ok(topPart.weightVariants.w0.includes('id=top0'));

// A slot only wears its own garment: the wrong-slot id resolves nothing there.
resolved = resolveManifest(gear, {}, gearCatalogue, { feet: 'top1' });
assert.equal(resolved.parts.equipment, undefined, 'a top garment does not fill the feet slot');

resolved = resolveManifest(gear, {}, gearCatalogue, { feet: 'boots1' });
assert.equal(resolved.parts.equipment.length, 1);
assert.equal(resolved.parts.equipment[0].slot, 'feet');
assert.ok(resolved.parts.equipment[0].meshUrl.includes('id=boots1'));
assert.ok(resolved.parts.equipment[0].weightVariants.w1.includes('id=boots1'));

// A garment the pack cannot draw contributes nothing rather than a broken shape.
resolved = resolveManifest(pack, {}, {
  clothingMesh: [asset('torn', { mapRole: 'mesh', decodable: false, reason: 'unsupported' })],
}, { chest: 'torn' });
assert.equal(resolved.parts.equipment, undefined, 'an undecodable garment is not drawn');

// ── Extended selection checks ──────────────────────────────────────────────
// 1. Shorts: inferred as bottom
assert.equal(equipSlotOf({ file: 'Aokili_Shorts_1.nif' }), 'bottom');
assert.equal(equipSlotOf({ file: 'Leather_Short_0.nif' }), 'bottom');

// 2. Aliases normalization
assert.equal(normalizeEquipSlot('full'), 'outfit');
assert.equal(normalizeEquipSlot('chest'), 'top');
assert.equal(normalizeEquipSlot('legs'), 'bottom');
assert.equal(equipSlotOf({ equipSlot: 'full' }), 'outfit');
assert.equal(equipSlotOf({ equipSlot: 'chest' }), 'top');
assert.equal(equipSlotOf({ equipSlot: 'legs' }), 'bottom');

// 3. Missing metadata uses filename inference
assert.equal(equipSlotOf({ file: 'Iron_Gauntlets.nif' }), 'hands');
assert.equal(equipSlotOf({ file: 'Steel_Boots.nif' }), 'feet');
assert.equal(equipSlotOf({ file: 'Silk_Panties.nif' }), 'panties');

// 4. Explicit metadata takes precedence over conflicting filename
assert.equal(equipSlotOf({ file: 'Gloves_Dress.nif', equipSlot: 'top' }), 'top');
assert.equal(equipSlotOf({ file: 'Boots_Crown.nif', equipSlot: 'accessories' }), 'accessories');

// 5. Cross-slot rejection
const testPack = {
  ...pack,
  assets: {
    ...pack.assets,
    clothingMesh: [
      asset('shortsA', { authored: true, onDemand: true, file: 'Shorts_1.nif', equipSlot: 'bottom' }),
      asset('shirtA', { authored: true, onDemand: true, file: 'Shirt_1.nif', equipSlot: 'top' }),
    ],
  },
};
// Placing shorts in top slot rejected
resolved = resolveManifest(testPack, {}, {}, { top: 'shortsA' });
assert.equal(resolved.parts.equipment, undefined, 'cross-slot rejected in strict mode');

// Placing shorts in bottom slot accepted
resolved = resolveManifest(testPack, {}, {}, { bottom: 'shortsA' });
assert.equal(resolved.parts.equipment.length, 1);
assert.equal(resolved.parts.equipment[0].slot, 'bottom');

// 6. Unrestricted mode allows cross-slot placement
resolved = resolveManifest(testPack, {}, {}, { top: 'shortsA' }, { unrestrictedSlots: true });
assert.equal(resolved.parts.equipment.length, 1, 'cross-slot accepted in unrestricted mode');
assert.equal(resolved.parts.equipment[0].slot, 'top');

console.log('pack selection: ok');
