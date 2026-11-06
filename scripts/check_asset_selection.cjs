// Run: node scripts/check_asset_selection.cjs
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
const { resolveManifest } = moduleObject.exports;
const asset = (id, more = {}) => ({ id, mod: 'UBE', file: id, rel: `UBE/${id}`, ...more });
const manifest = {
  available: true, source: 'test', textures: {},
  assets: {
    headMesh: [asset('head', { meshUrl: '/head.json', isRealMesh: true })],
    skin: [asset('skin', { texture: '/skin.webp', palette: {}, size: [1, 1] })],
    mouthMesh: [asset('mouth', { meshUrl: '/mouth.json' })],
    mouth: [asset('mouthTex', { texture: '/mouth.webp', normalTexture: '/mouth_n.png' })],
    hair: [asset('hair', { texture: '/hair.webp' })],
  },
};
const catalogue = {
  mouthMesh: [asset('otherMesh', { mapRole: 'mesh' }), asset('blocked', { mapRole: 'mesh', decodable: false })],
  mouth: [asset('otherTex', { mapRole: 'albedo' }), asset('normal', { mapRole: 'normal' })],
  hairMesh: [asset('authored', { mapRole: 'mesh' })],
};
let resolved = resolveManifest(manifest, {}, catalogue);
assert.equal(resolved.parts.mouth.meshUrl, '/mouth.json');
assert.equal(resolved.parts.mouth.texture, '/mouth.webp');
resolved = resolveManifest(manifest, { mouthMesh: 'otherMesh', mouth: 'otherTex' }, catalogue);
assert.ok(resolved.parts.mouth.meshUrl.includes('id=otherMesh'));
assert.ok(resolved.parts.mouth.texture.includes('id=otherTex'));
assert.equal(resolved.parts.mouth.normalTexture, undefined, 'missing normal must not inherit old atlas normal');
assert.equal(resolveManifest(manifest, { mouthMesh: 'blocked' }, catalogue).parts.mouth.meshUrl, '/mouth.json');
assert.equal(resolveManifest(manifest, { mouthMesh: 'missing' }, catalogue).parts.mouth.meshUrl, '/mouth.json');
assert.equal(resolveManifest(manifest, { mouth: 'normal' }, catalogue).parts.mouth.texture, '/mouth.webp');
assert.ok(resolveManifest(manifest, { hairMesh: 'authored' }, catalogue).parts.hair.meshUrl.includes('id=authored'));
assert.equal(resolveManifest(manifest, {}, catalogue).parts.hair.meshUrl, undefined);
const realManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/assets/mo2/manifest.json'), 'utf8'));
// Skin/body defaults are the curator's choice (PREFERRED_DEFAULT in
// sync_mo2_assets.py), not something this test fixes; assert the hair contract.
assert.equal(realManifest.assets.hair[0].file, '90sBebe.dds');
assert.equal(resolveManifest(realManifest, {}).parts.hair.meshUrl, realManifest.assets.hairMesh[0].meshUrl, 'fresh hair uses premade MO2 mesh');
const optionalHair = realManifest.assets.hairMesh[0];
assert.ok(resolveManifest(realManifest, { hairMesh: optionalHair.id }).parts.hair.meshUrl);
assert.equal(resolveManifest(realManifest, { hairMesh: 'stale' }).parts.hair.meshUrl, optionalHair.meshUrl, 'stale hair restores default premade mesh');

// The picker hides meshes the shipped head swallows. The catalogue carries a
// measured `visibility` per decodable hair mesh; the default premade style has
// to be one of the visible ones or a fresh session would open on nothing.
const hairCatalogue = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/assets/mo2/catalogue/hairMesh.json'), 'utf8'));
const measured = hairCatalogue.filter((e) => typeof e.visibility === 'number');
assert.ok(measured.length > 0, 'catalogue carries measured hair visibility');
const VISIBLE_MIN = 0.55;
const visibleRels = new Set(measured.filter((e) => e.visibility >= VISIBLE_MIN).map((e) => e.rel));
assert.ok(visibleRels.size >= 10, `only ${visibleRels.size} hair meshes clear the visibility cutoff`);
assert.ok(visibleRels.has(optionalHair.rel), 'default premade hair is itself visible against the shipped head');
const buried = measured.filter((e) => e.visibility < VISIBLE_MIN);
assert.ok(buried.length > 0, 'the measurement must reject something, or it proves nothing');
assert.ok(buried.every((e) => e.decodable !== false), 'rejected meshes decode fine — it is the head that hides them');

// The picker keeps one tile per distinct mesh. The archive genuinely carries
// byte-identical copies (00hairline02 / 00hairline_himeji, hairline04 /
// hairline05), and offering both is a way to pick the wrong one.
const offered = hairCatalogue.filter((e) => e.decodable !== false && e.visibility >= VISIBLE_MIN);
const fingerprints = offered.map((e) => `${e.bytes}/${e.mtime}`);
const dupes = fingerprints.filter((f, i) => fingerprints.indexOf(f) !== i);
assert.ok(new Set(dupes).size >= 2, `expected at least the archive's duplicate pairs, saw ${new Set(dupes).size}`);
console.log(`asset selection: ok (${visibleRels.size}/${measured.length} hair meshes visible, ${new Set(fingerprints).size} distinct offered)`);
