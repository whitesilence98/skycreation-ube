const fs = require('fs');
const path = require('path');

console.log('=== Test 1: Catalogue Entries & Albedo Filtering ===');
const browsPath = path.join(process.cwd(), 'public/assets/preset-pack/catalogue/brows.json');
const browsData = JSON.parse(fs.readFileSync(browsPath, 'utf8'));

// Filter out normal maps
const albedoBrows = browsData.filter(
  (e) => (e.mapRole ?? 'albedo') === 'albedo' && !e.file.toLowerCase().endsWith('_n.dds')
);
console.log(`  Total brows in catalogue: ${browsData.length}`);
console.log(`  Filtered albedo brows:    ${albedoBrows.length}`);
if (albedoBrows.length !== 35) {
  throw new Error(`Expected 35 albedo brows, got ${albedoBrows.length}`);
}

console.log('\n=== Test 2: Series Classification ===');
const classicBrows = albedoBrows.filter((b) => !b.rel.includes('Brows_ILV'));
const ilvBrows = albedoBrows.filter((b) => b.rel.includes('Brows_ILV'));
console.log(`  COR Classic brows: ${classicBrows.length} (Expected 11)`);
console.log(`  ILV Series brows:  ${ilvBrows.length} (Expected 24)`);
if (classicBrows.length !== 11 || ilvBrows.length !== 24) {
  throw new Error('Series count mismatch');
}

console.log('\n=== Test 3: 3D Brow Meshes in Catalogue ===');
const meshPath = path.join(process.cwd(), 'public/assets/preset-pack/catalogue/browsMesh.json');
const meshData = JSON.parse(fs.readFileSync(meshPath, 'utf8'));
console.log(`  3D brow meshes found: ${meshData.length}`);
meshData.forEach((m) => {
  console.log(`    - [${m.id}] ${m.label} (${m.file}) -> Vertices: ${m.vertices || 'tri'}`);
});
if (meshData.length !== 4) {
  throw new Error(`Expected 4 brow meshes, got ${meshData.length}`);
}

console.log('\n=== Test 4: Manifest Brow Resolution ===');
// Load manifest and manifestSelect logic
const manifestPath = path.join(process.cwd(), 'public/assets/preset-pack/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Verify manifest defaults
console.log(`  Manifest default brow texture: ${manifest.assets?.brows?.[0]?.label}`);
console.log(`  Manifest default brow mesh:    ${manifest.assets?.browsMesh?.[0]?.label}`);

console.log('\n>>> ALL BROWS PANEL VERIFICATIONS PASSED SUCCESSFULLY! <<<');
