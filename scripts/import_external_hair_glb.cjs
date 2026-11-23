#!/usr/bin/env node
/**
 * import_external_hair_glb.cjs
 *
 * Normalizes external 3D hair models (from Blender, Sketchfab, Maya, etc.)
 * into clean, standalone glTF 2.0 Binary (.glb) files optimized for the
 * Skyrim UBE WebGL Character Creator.
 *
 * What this script does:
 * 1. Analyzes vertex coordinates and calculates the crown / scalp boundary.
 * 2. Translates vertex Y positions so the hair root seats perfectly onto the
 *    Skyrim UBE head (default crown height = +0.150m in head-local space).
 * 3. Strips foreign armature skins, joints, and arbitrary parent node scalings
 *    (e.g. Sketchfab/FBX 0.01 * 312.8 scaling artifacts), converting the model
 *    into a clean static mesh that attaches directly to `SkyrimHeadRoot`.
 * 4. Preserves 100% of original embedded textures (PNG/JPEG/WebP), UVs, normals,
 *    indices, and materials with zero re-encoding loss.
 *
 * Usage:
 *   node scripts/import_external_hair_glb.cjs <inputGlbPath> [options]
 *
 * Options:
 *   --out <path>         Output .glb path (default: public/assets/hair/<name>.glb)
 *   --scale <float>      Scale factor multiplier (e.g. 0.80 for 20% smaller)
 *   --deltaY <float>     Manual vertical offset in metres (e.g. -1.138)
 *   --targetCrown <fl>   Target crown height in metres (default: 0.150)
 *   --name <string>      Mesh node name
 *   --dry-run            Analyze and display calculations without writing
 */

const fs = require('node:fs');
const path = require('node:path');

// Target crown height in Skyrim UBE head-local coordinates:
// Canonical UBE head top is at Y = +0.1385m, so +0.150m gives natural ~1.1cm scalp volume.
const DEFAULT_TARGET_CROWN = 0.150;

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(`
Usage: node scripts/import_external_hair_glb.cjs <inputGlbPath> [options]

Options:
  --out <path>         Output file path (default: public/assets/hair/<name>.glb)
  --scale <float>      Scale factor multiplier (default: 1.0, e.g. 0.80 for 20% smaller)
  --deltaY <float>     Explicit vertical offset in metres (overrides --targetCrown)
  --targetCrown <fl>   Target crown top height (default: ${DEFAULT_TARGET_CROWN}m)
  --name <string>      Node name in glTF scene (default: auto from filename)
  --dry-run            Analyze bounds without writing file
`);
    process.exit(0);
  }

  const inputPath = path.resolve(args[0]);
  let outPath = null;
  let scale = 1.0;
  let manualDeltaY = null;
  let targetCrown = DEFAULT_TARGET_CROWN;
  let meshName = null;
  let dryRun = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) {
      outPath = path.resolve(args[++i]);
    } else if (args[i] === '--scale' && args[i + 1]) {
      scale = parseFloat(args[++i]);
    } else if (args[i] === '--deltaY' && args[i + 1]) {
      manualDeltaY = parseFloat(args[++i]);
    } else if (args[i] === '--targetCrown' && args[i + 1]) {
      targetCrown = parseFloat(args[++i]);
    } else if (args[i] === '--name' && args[i + 1]) {
      meshName = args[++i];
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { inputPath, outPath, scale, manualDeltaY, targetCrown, meshName, dryRun };
}

function normalizeHairGlb(options) {
  const { inputPath, scale = 1.0, manualDeltaY, targetCrown, dryRun } = options;

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file does not exist: ${inputPath}`);
    process.exit(1);
  }

  const baseName = path.basename(inputPath, path.extname(inputPath))
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .toLowerCase();
  const outPath = options.outPath || path.resolve(__dirname, '..', 'public', 'assets', 'hair', `${baseName}.glb`);
  const meshName = options.meshName || baseName
    .split('_')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');

  console.log(`\n======================================================`);
  console.log(`Normalizing External Hair GLB:`);
  console.log(`  Source: ${inputPath}`);
  console.log(`  Target: ${outPath}`);
  console.log(`======================================================\n`);

  const srcBuf = fs.readFileSync(inputPath);
  if (srcBuf.toString('ascii', 0, 4) !== 'glTF') {
    console.error('Error: File is not a valid glTF 2.0 Binary (.glb) container');
    process.exit(1);
  }

  const version = srcBuf.readUInt32LE(4);
  const totalLength = srcBuf.readUInt32LE(8);
  const chunk0Length = srcBuf.readUInt32LE(12);
  const chunk0Type = srcBuf.toString('ascii', 16, 20);

  if (chunk0Type !== 'JSON') {
    console.error(`Error: Expected JSON chunk, got ${chunk0Type}`);
    process.exit(1);
  }

  const gltf = JSON.parse(srcBuf.toString('utf8', 20, 20 + chunk0Length));
  const binHeaderOffset = 20 + chunk0Length;
  const binLength = srcBuf.readUInt32LE(binHeaderOffset);
  const binType = srcBuf.toString('ascii', binHeaderOffset + 4, binHeaderOffset + 8);

  if (!binType.startsWith('BIN')) {
    console.error(`Error: Expected BIN chunk, got ${binType}`);
    process.exit(1);
  }

  const binDataOffset = binHeaderOffset + 8;
  const binData = Buffer.from(srcBuf.buffer, srcBuf.byteOffset + binDataOffset, binLength);

  // 1. Gather all POSITION accessors across all primitives
  const positionAccessorIndices = new Set();
  let rawGlobalMinY = Infinity;
  let rawGlobalMaxY = -Infinity;
  let rawMinX = Infinity, rawMaxX = -Infinity;
  let rawMinZ = Infinity, rawMaxZ = -Infinity;

  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.attributes && prim.attributes.POSITION !== undefined) {
        positionAccessorIndices.add(prim.attributes.POSITION);
        const acc = gltf.accessors[prim.attributes.POSITION];
        if (acc && acc.min && acc.max) {
          rawMinX = Math.min(rawMinX, acc.min[0]);
          rawMaxX = Math.max(rawMaxX, acc.max[0]);
          rawGlobalMinY = Math.min(rawGlobalMinY, acc.min[1]);
          rawGlobalMaxY = Math.max(rawGlobalMaxY, acc.max[1]);
          rawMinZ = Math.min(rawMinZ, acc.min[2]);
          rawMaxZ = Math.max(rawMaxZ, acc.max[2]);
        }
      }
    }
  }

  console.log(`Original Vertex Extents:`);
  console.log(`  X (Width):  ${rawMinX.toFixed(4)} to ${rawMaxX.toFixed(4)} (dx: ${(rawMaxX - rawMinX).toFixed(4)}m)`);
  console.log(`  Y (Height): ${rawGlobalMinY.toFixed(4)} to ${rawGlobalMaxY.toFixed(4)} (dy: ${(rawGlobalMaxY - rawGlobalMinY).toFixed(4)}m)`);
  console.log(`  Z (Depth):  ${rawMinZ.toFixed(4)} to ${rawMaxZ.toFixed(4)} (dz: ${(rawMaxZ - rawMinZ).toFixed(4)}m)`);

  // 2. Compute scale and deltaY
  const centerX = (rawMinX + rawMaxX) / 2;
  const centerZ = (rawMinZ + rawMaxZ) / 2;
  const scaledMaxY = rawGlobalMaxY * scale;

  let deltaY;
  if (manualDeltaY !== null) {
    deltaY = manualDeltaY;
    console.log(`\nUsing scale: ${scale.toFixed(2)}x, manual deltaY: ${deltaY.toFixed(4)}m`);
  } else {
    deltaY = targetCrown - scaledMaxY;
    console.log(`\nUsing scale: ${scale.toFixed(2)}x`);
    console.log(`Auto-computed deltaY (target crown ${targetCrown.toFixed(4)}m - scaled max ${scaledMaxY.toFixed(4)}m): ${deltaY.toFixed(4)}m`);
  }

  const projMinX = (rawMinX - centerX) * scale + centerX;
  const projMaxX = (rawMaxX - centerX) * scale + centerX;
  const projMinY = rawGlobalMinY * scale + deltaY;
  const projMaxY = rawGlobalMaxY * scale + deltaY;
  const projMinZ = (rawMinZ - centerZ) * scale + centerZ;
  const projMaxZ = (rawMaxZ - centerZ) * scale + centerZ;

  if (dryRun) {
    console.log(`\n[DRY RUN] Projected normalized bounds (scale ${scale.toFixed(2)}x):`);
    console.log(`  X (Width):  ${projMinX.toFixed(4)} to ${projMaxX.toFixed(4)} (dx: ${(projMaxX - projMinX).toFixed(4)}m)`);
    console.log(`  Y (Height): ${projMinY.toFixed(4)} to ${projMaxY.toFixed(4)} (dy: ${(projMaxY - projMinY).toFixed(4)}m)`);
    console.log(`  Z (Depth):  ${projMinZ.toFixed(4)} to ${projMaxZ.toFixed(4)} (dz: ${(projMaxZ - projMinZ).toFixed(4)}m)`);
    console.log(`  Done.`);
    return;
  }

  // 3. Scale and translate coordinates in the binary buffer
  for (const accIndex of positionAccessorIndices) {
    const acc = gltf.accessors[accIndex];
    const bv = gltf.bufferViews[acc.bufferView];
    const baseOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);

    for (let i = 0; i < acc.count; i++) {
      const xOff = baseOffset + i * 12;
      const yOff = baseOffset + i * 12 + 4;
      const zOff = baseOffset + i * 12 + 8;

      const origX = binData.readFloatLE(xOff);
      const origY = binData.readFloatLE(yOff);
      const origZ = binData.readFloatLE(zOff);

      const newX = (origX - centerX) * scale + centerX;
      const newY = origY * scale + deltaY;
      const newZ = (origZ - centerZ) * scale + centerZ;

      binData.writeFloatLE(newX, xOff);
      binData.writeFloatLE(newY, yOff);
      binData.writeFloatLE(newZ, zOff);
    }

    acc.min[0] = (acc.min[0] - centerX) * scale + centerX;
    acc.max[0] = (acc.max[0] - centerX) * scale + centerX;
    acc.min[1] = acc.min[1] * scale + deltaY;
    acc.max[1] = acc.max[1] * scale + deltaY;
    acc.min[2] = (acc.min[2] - centerZ) * scale + centerZ;
    acc.max[2] = (acc.max[2] - centerZ) * scale + centerZ;
  }

  // 4. Strip foreign armature skinning, bones, and nested FBX transform nodes
  delete gltf.skins;
  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.attributes) {
        delete prim.attributes.JOINTS_0;
        delete prim.attributes.WEIGHTS_0;
      }
    }
  }

  // 5. Reorganize scene into clean static hierarchy
  gltf.nodes = (gltf.meshes || []).map((_, idx) => ({
    name: idx === 0 ? meshName : `${meshName}_Part${idx + 1}`,
    mesh: idx,
  }));
  gltf.scenes = [{ name: 'Scene', nodes: gltf.nodes.map((_, i) => i) }];
  gltf.scene = 0;

  // 6. Encode new GLB container
  const jsonStr = JSON.stringify(gltf);
  let jsonBuf = Buffer.from(jsonStr, 'utf8');
  const jsonPadding = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPadding > 0) {
    jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPadding, 0x20)]); // 0x20 space padding
  }

  const outTotalLength = 12 + 8 + jsonBuf.length + 8 + binData.length;
  const outBuf = Buffer.alloc(outTotalLength);

  outBuf.write('glTF', 0, 4, 'ascii');
  outBuf.writeUInt32LE(2, 4);
  outBuf.writeUInt32LE(outTotalLength, 8);

  outBuf.writeUInt32LE(jsonBuf.length, 12);
  outBuf.write('JSON', 16, 4, 'ascii');
  jsonBuf.copy(outBuf, 20);

  const binHeaderPos = 20 + jsonBuf.length;
  outBuf.writeUInt32LE(binData.length, binHeaderPos);
  outBuf.write('BIN\0', binHeaderPos + 4, 4, 'ascii');
  binData.copy(outBuf, binHeaderPos + 8);

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, outBuf);

  console.log(`\nSuccessfully normalized and exported:`);
  console.log(`  File: ${outPath} (${(outBuf.length / 1024).toFixed(1)} KB)`);
  console.log(`  Normalized Extents (scale: ${scale.toFixed(2)}x, deltaY: ${deltaY.toFixed(4)}m):`);
  console.log(`    X: ${projMinX.toFixed(4)} to ${projMaxX.toFixed(4)} (dx: ${(projMaxX - projMinX).toFixed(4)}m)`);
  console.log(`    Y: ${projMinY.toFixed(4)} to ${projMaxY.toFixed(4)} (dy: ${(projMaxY - projMinY).toFixed(4)}m)`);
  console.log(`    Z: ${projMinZ.toFixed(4)} to ${projMaxZ.toFixed(4)} (dz: ${(projMaxZ - projMinZ).toFixed(4)}m)`);
  console.log(`\nTo register this hair in the Character Creator, add to lib/hairGlbRegistry.ts:`);
  console.log(`{`);
  console.log(`  id: '${baseName}',`);
  console.log(`  label: '${meshName}',`);
  console.log(`  file: '${path.basename(outPath)}',`);
  console.log(`  meshUrl: '/assets/hair/${path.basename(outPath)}',`);
  console.log(`  badge: 'GLB',`);
  console.log(`  description: 'Clean normalized glTF 2.0 hairstyle.',`);
  console.log(`}`);
}

const options = parseArgs();
normalizeHairGlb(options);
