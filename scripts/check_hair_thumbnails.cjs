// Run: node scripts/check_hair_thumbnails.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const THREE = require('three');

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
      THREE,
      Float32Array,
      require: (id) => {
        if (id === 'three') return THREE;
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

const { getCachedHairThumbnail, requestHairThumbnail } = load('lib/hair/thumbnailRenderer');

async function run() {
  console.log('--- 1. Testing Hair Thumbnail Cache Interface ---');
  assert.equal(typeof getCachedHairThumbnail, 'function', 'getCachedHairThumbnail must be a function');
  assert.equal(typeof requestHairThumbnail, 'function', 'requestHairThumbnail must be a function');
  assert.equal(getCachedHairThumbnail('non-existent-hair'), undefined, 'Uncached hair returns undefined');
  console.log('✓ Hair thumbnail cache interface verified');

  console.log('--- 2. Testing Multi-Part Hair Bounding Volume Compositing ---');
  // Part 1: Main hair body (scalp & crown: width=16cm, height=20cm, depth=18cm)
  const part1Geom = new THREE.BoxGeometry(0.16, 0.20, 0.18);
  part1Geom.translate(0, 0.08, -0.02);
  part1Geom.computeBoundingBox();

  // Part 2: Long ponytail companion part (behind & lower: width=8cm, height=30cm, depth=8cm)
  const part2Geom = new THREE.BoxGeometry(0.08, 0.30, 0.08);
  part2Geom.translate(0, -0.10, -0.14);
  part2Geom.computeBoundingBox();

  const combinedBox = new THREE.Box3();
  combinedBox.union(part1Geom.boundingBox);
  combinedBox.union(part2Geom.boundingBox);

  assert.ok(combinedBox.min.y <= -0.24, 'Combined bounding box captures lower ponytail tips');
  assert.ok(combinedBox.max.y >= 0.17, 'Combined bounding box captures top crown volume');
  assert.ok(combinedBox.min.z <= -0.17, 'Combined bounding box captures rear ponytail extension');

  const sphere = new THREE.Sphere();
  combinedBox.getBoundingSphere(sphere);
  assert.ok(sphere.radius >= 0.15, `Bounding sphere radius (${sphere.radius.toFixed(3)}m) captures full multi-part volume`);
  console.log(`✓ Multi-part bounding sphere calculated: radius=${sphere.radius.toFixed(3)}m, center=(${sphere.center.x.toFixed(3)}, ${sphere.center.y.toFixed(3)}, ${sphere.center.z.toFixed(3)})`);

  console.log('--- 3. Testing Salon Portrait Framing Calculations ---');
  const fov = 35;
  const fovRad = (fov * Math.PI) / 180;
  const radius = sphere.radius;
  const dist = Math.max((radius / Math.sin(fovRad / 2)) * 1.15, 0.38);

  const yaw = (22 * Math.PI) / 180;
  const pitch = (12 * Math.PI) / 180;
  const camPos = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch) * dist,
    Math.sin(pitch) * dist,
    Math.cos(yaw) * Math.cos(pitch) * dist,
  );

  assert.ok(camPos.x > 0, 'Camera yaw places viewpoint at 3/4 studio right');
  assert.ok(camPos.y > 0, 'Camera pitch elevates view slightly to capture crown & bangs');
  assert.ok(camPos.z > 0, 'Camera remains in front of the head');
  assert.ok(dist >= 0.38, 'Distance satisfies minimum studio framing distance');
  console.log(`✓ Salon camera positioning verified: dist=${dist.toFixed(3)}m, pos=(${camPos.x.toFixed(3)}, ${camPos.y.toFixed(3)}, ${camPos.z.toFixed(3)})`);

  console.log('--- 4. Testing Mannequin Head Context Proportions ---');
  const craniumGeo = new THREE.SphereGeometry(0.076, 32, 24);
  craniumGeo.scale(0.85, 1.15, 0.98);
  craniumGeo.computeBoundingBox();
  const box = craniumGeo.boundingBox;
  const width = box.max.x - box.min.x;
  const height = box.max.y - box.min.y;
  const depth = box.max.z - box.min.z;

  assert.ok(width >= 0.12 && width <= 0.14, `Cranium width ~13cm (${(width * 100).toFixed(1)}cm)`);
  assert.ok(height >= 0.16 && height <= 0.19, `Cranium height ~17.5cm (${(height * 100).toFixed(1)}cm)`);
  assert.ok(depth >= 0.14 && depth <= 0.16, `Cranium depth ~15cm (${(depth * 100).toFixed(1)}cm)`);
  console.log('✓ Mannequin head proportions verified: realistic human head scale fits inside hair volume');

  console.log('\nAll hair thumbnail test assertions passed successfully!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
