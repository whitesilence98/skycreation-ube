// Run after sync: node scripts/check_pack_server.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const loaded = new Map();
function load(file) {
  if (loaded.has(file)) return loaded.get(file).exports;
  const module = { exports: {} };
  loaded.set(file, module);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    module, exports: module.exports, process, Buffer, console, Request, Response, URL, URLSearchParams,
    require: (id) => id.startsWith('@/') ? load(path.resolve(id.slice(2) + '.ts')) : require(id),
  }, { filename: file });
  return module.exports;
}
(async () => {
  const { ASSET_SOURCE } = load(path.resolve('lib/mo2/assetSource.ts'));
  const server = load(path.resolve('lib/mo2/server.ts'));
  assert.equal(ASSET_SOURCE.layout, 'pack');
  assert.equal(ASSET_SOURCE.publicBase, '/assets/preset-pack');
  const manifest = await server.readManifest();
  const index = await server.readCatalogueIndex();
  assert.equal(manifest.sourceLayout, 'pack');
  assert.equal(index.available, true);
  assert.equal(index.sourceLayout, 'pack');
  assert.ok(!JSON.stringify(index).includes(ASSET_SOURCE.root));
  assert.equal(await server.findEntry('headMesh', 'not-in-catalogue'), null);
  const heads = await server.readCatalogue('headMesh');
  assert.ok(heads.length);
  assert.ok(await server.resolveArchivePath(heads.find((e) => e.decodable !== false)));
  assert.equal(await server.resolveArchivePath({ rel: path.resolve('package.json') }), null);
  assert.equal(await server.resolveArchivePath({ rel: '..\\..\\outside.dds' }), null);
  assert.equal(await server.resolveArchivePath({ rel: 'missing.dds' }), null);
  const manifestRoute = load(path.resolve('app/api/mo2/manifest/route.ts'));
  const manifestResponse = await manifestRoute.GET();
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get('cache-control'), 'no-store');
  assert.equal((await manifestResponse.json()).sourceKey, ASSET_SOURCE.key);
  const route = load(path.resolve('app/api/mo2/convert/route.ts'));
  assert.equal((await route.GET(new Request('http://localhost/api/mo2/convert?kind=skin&id=x&role=../../outside'))).status, 400);
  assert.equal((await route.GET(new Request('http://localhost/api/mo2/convert?kind=headMesh&id=missing&mode=mesh'))).status, 404);
  const hairRows = await server.readCatalogue('hairMesh');
  const greyHair = hairRows.find((e) => e.untextured === true && e.decodable !== false);
  if (greyHair) {
    // The exemption is mesh mode only: the geometry is served, but the worker
    // must emit nothing a browser could fetch as an atlas.
    const meshUrl = new URL('http://localhost/api/mo2/convert');
    meshUrl.search = new URLSearchParams({ kind: 'hairMesh', id: greyHair.id, mode: 'mesh' });
    const meshResponse = await route.GET(new Request(meshUrl));
    assert.equal(meshResponse.status, 200);
    const mesh = await meshResponse.json();
    assert.equal(mesh.authored, true);
    assert.ok(mesh.groups?.length && mesh.materials?.length);
    assert.ok(mesh.vertexCount > 0);
    for (const material of mesh.materials) {
      assert.equal(material.texture, undefined, 'untextured mesh named an albedo URL');
      assert.equal(material.normalTexture, undefined, 'untextured mesh named a normal URL');
    }
    const atlasUrl = new URL('http://localhost/api/mo2/convert');
    atlasUrl.search = new URLSearchParams({ kind: 'hairMesh', id: greyHair.id, mode: 'albedo' });
    assert.equal((await route.GET(new Request(atlasUrl))).status, 422);
  }
  const blockedHair = hairRows.find((e) => e.decodable === false);
  if (blockedHair) {
    const url = new URL('http://localhost/api/mo2/convert');
    url.search = new URLSearchParams({ kind: 'hairMesh', id: blockedHair.id, mode: 'mesh' });
    assert.equal((await route.GET(new Request(url))).status, 422);
  }
  const head = heads.find((e) => e.decodable !== false);
  const response = await route.GET(new Request(`http://localhost/api/mo2/convert?${new URLSearchParams({ kind: 'headMesh', id: head.id, mode: 'mesh' })}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const geometry = await response.json();
  assert.ok(geometry.vertexCount > 0);
  assert.equal(geometry.positions.length, geometry.vertexCount * 3);
  const bodies = await server.readCatalogue('bodyMesh');
  const embedded = bodies.find((e) => e.geometryRole === 'skin' && e.decodable !== false);
  if (embedded) {
    const bodyResponse = await route.GET(new Request(`http://localhost/api/mo2/convert?${new URLSearchParams({ kind: 'bodyMesh', id: embedded.id, mode: 'mesh' })}`));
    assert.equal(bodyResponse.status, 200);
    const body = await bodyResponse.json();
    assert.equal(body.materials.length, 1);
    assert.equal(body.materials[0].role, 'skin');
    assert.ok(body.materials[0].texture?.includes('kind=body'));
    const textureQuery = new URL(body.materials[0].texture, 'http://localhost').searchParams;
    const textureEntry = await server.findEntry(textureQuery.get('kind'), textureQuery.get('id'));
    assert.ok(textureEntry && await server.resolveArchivePath(textureEntry), 'cross-category body texture missing');
    if (fs.existsSync(path.join(ASSET_SOURCE.root, 'body', 'textures'))) {
      assert.ok(textureEntry.rel.replace(/\\/g, '/').startsWith('body/textures/'));
    }
    assert.equal(body.groups.length, 1);
    assert.equal(body.groups[0].count, body.indices.length);
    assert.ok(body.vertexCount > 0);
    assert.equal(body.positions.length, body.vertexCount * 3);
  }
  for (const kind of ['bodyMesh', 'handsMesh', 'feetMesh']) {
    const entries = await server.readCatalogue(kind);
    const part = entries.find((e) => e.authored && e.weightDefault === 1 && e.file.startsWith('female'));
    assert.ok(part, `${kind}: canonical authored pair missing`);
    const response = await route.GET(new Request(`http://localhost/api/mo2/convert?${new URLSearchParams({ kind, id: part.id, mode: 'mesh' })}`));
    assert.equal(response.status, 200, `${kind}: conversion failed`);
    const mesh = await response.json();
    assert.ok(mesh.bones.length > 0);
    assert.equal(mesh.skinIndex.length, mesh.vertexCount * 4);
    assert.equal(mesh.skinWeight.length, mesh.vertexCount * 4);
    assert.ok(mesh.materials.every((m) => m.role === 'skin' && m.texture?.includes('kind=body')));
  }
  const clothes = await server.readCatalogue('clothingMesh');
  const texturedGarment = clothes.find((e) => e.authored && e.decodable !== false && !e.untextured);
  assert.ok(texturedGarment, 'at least one authored clothing mesh with textures exists');
  const garmentResp = await route.GET(new Request(`http://localhost/api/mo2/convert?${new URLSearchParams({ kind: 'clothingMesh', id: texturedGarment.id, mode: 'mesh' })}`));
  assert.equal(garmentResp.status, 200, 'clothing conversion failed');
  const garmentMesh = await garmentResp.json();
  assert.ok(garmentMesh.authored, true);
  assert.ok(garmentMesh.materials?.length > 0);
  const garmentMat = garmentMesh.materials.find((m) => m.role === 'clothing' || m.role === 'accessory');
  if (garmentMat) {
    assert.ok(garmentMat.texture, 'garment material has albedo URL');
    assert.ok(garmentMat.texture.includes('kind=clothing'), 'albedo URL routes to clothing texture');
    const albedoResp = await route.GET(new Request(`http://localhost${garmentMat.texture}`));
    assert.equal(albedoResp.status, 200, 'albedo texture resolves');
  }
  const embeddedSkin = garmentMesh.materials.find((m) => m.role === 'skin');
  if (embeddedSkin && embeddedSkin.texture) {
    assert.ok(embeddedSkin.texture.includes('kind=body'), 'embedded skin uses body texture');
  }
  console.log('pack server: source, metadata, whitelist, containment, conversion and clothing texture delivery ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
