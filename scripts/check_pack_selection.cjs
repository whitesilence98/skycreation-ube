// Run: node scripts/check_pack_selection.cjs
// Pack contract for the parts the frontend resolves. Reuses the same pure
// resolveManifest the app uses; the legacy check keeps its own expectations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../lib/manifestSelect.ts'), 'utf8');
const moduleObject = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: moduleObject.exports, module: moduleObject,
  require: (id) => {
    assert.equal(id, '@/lib/mo2/client');
    return { convertUrl: (options) => `/api/mo2/convert?${new URLSearchParams(options)}` };
  },
});
const { resolveManifest, assetOptions, CATEGORY_MAP } = moduleObject.exports;

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

// A stale cross-source id must not name another source's file.
assert.equal(resolveManifest(pack, { clothingMesh: 'legacyOnly' }, catalogue).parts.clothing.meshUrl, '/outfit.json');

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
console.log('pack selection: ok');
