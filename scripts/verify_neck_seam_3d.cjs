const fs = require('fs');
const path = require('path');

// Read head mesh
const headJson = JSON.parse(fs.readFileSync('public/assets/preset-pack/meshes/headMesh-96612a53f30f4e56.json', 'utf8'));
const body1Json = JSON.parse(fs.readFileSync('public/assets/preset-pack/meshes/bodyMesh-780aaed8c4e146dd.json', 'utf8'));
const body0Json = JSON.parse(fs.readFileSync('public/assets/preset-pack/meshes/bodyMesh-a7e1ee61c796a028.json', 'utf8'));

// Read neckDeltas.ts
const neckDeltasTs = fs.readFileSync('lib/head/neckDeltas.ts', 'utf8');
const indicesMatch = neckDeltasTs.match(/NECK_DELTA_INDICES = new Uint16Array\(\[([\d\s,]+)\]\)/);
const deltaIndices = indicesMatch[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));

const posMatch = neckDeltasTs.match(/NECK_DELTA_POSITIONS = new Float32Array\(\[([\d\s,e\.\-]+)\]\)/);
const deltaPositions = posMatch[1].split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));

const hp = Float32Array.from(headJson.positions);
const hi = Uint32Array.from(headJson.indices);
const b1p = Float32Array.from(body1Json.positions);
const b0p = Float32Array.from(body0Json.positions);

console.log(`Verification: Head verts=${hp.length/3}, Delta verts=${deltaIndices.length}`);

// 1. Find the 83 seam pairs
const seamPairs = [];
for (let hv = 0; hv < hp.length / 3; hv++) {
  const hy = hp[hv * 3 + 1];
  if (hy < -0.075) {
    const hx = hp[hv * 3];
    const hz = hp[hv * 3 + 2];
    let minD = Infinity;
    let minBv = -1;
    for (let bv = 0; bv < b1p.length / 3; bv++) {
      if (b1p[bv * 3 + 1] > -0.15) {
        const dx = hx - b1p[bv * 3];
        const dy = hy - b1p[bv * 3 + 1];
        const dz = hz - b1p[bv * 3 + 2];
        const d = Math.hypot(dx, dy, dz);
        if (d < minD) {
          minD = d;
          minBv = bv;
        }
      }
    }
    if (minD < 0.0001) {
      seamPairs.push({ hv, bv: minBv });
    }
  }
}
console.log(`Seam boundary pairs verified: ${seamPairs.length} (must be 83)`);
if (seamPairs.length !== 83) {
  console.error('FAIL: seamPairs count != 83');
  process.exit(1);
}

// 2. Test weights: 0.0, 0.25, 0.5, 0.75, 1.0
const weights = [0.0, 0.25, 0.5, 0.75, 1.0];
let allPassed = true;

for (const w of weights) {
  const factor = 1.0 - w;
  const currentHp = new Float32Array(hp);
  
  // applyNeckDelta logic
  for (let i = 0; i < deltaIndices.length; i++) {
    const v = deltaIndices[i];
    currentHp[v * 3] += factor * deltaPositions[i * 3];
    currentHp[v * 3 + 1] += factor * deltaPositions[i * 3 + 1];
    currentHp[v * 3 + 2] += factor * deltaPositions[i * 3 + 2];
  }
  
  // body position at w
  let maxSeamError = 0;
  for (const pair of seamPairs) {
    const hx = currentHp[pair.hv * 3];
    const hy = currentHp[pair.hv * 3 + 1];
    const hz = currentHp[pair.hv * 3 + 2];
    
    const bx = b0p[pair.bv * 3] + (b1p[pair.bv * 3] - b0p[pair.bv * 3]) * w;
    const by = b0p[pair.bv * 3 + 1] + (b1p[pair.bv * 3 + 1] - b0p[pair.bv * 3 + 1]) * w;
    const bz = b0p[pair.bv * 3 + 2] + (b1p[pair.bv * 3 + 2] - b0p[pair.bv * 3 + 2]) * w;
    
    const err = Math.hypot(hx - bx, hy - by, hz - bz);
    if (err > maxSeamError) maxSeamError = err;
  }
  
  // Check triangle orientations / normal dots against base
  let invertedCount = 0;
  let minDot = 1.0;
  
  for (let t = 0; t < hi.length; t += 3) {
    const i0 = hi[t], i1 = hi[t + 1], i2 = hi[t + 2];
    
    // Base normal
    const ax = hp[i1*3] - hp[i0*3], ay = hp[i1*3+1] - hp[i0*3+1], az = hp[i1*3+2] - hp[i0*3+2];
    const bx = hp[i2*3] - hp[i0*3], by = hp[i2*3+1] - hp[i0*3+1], bz = hp[i2*3+2] - hp[i0*3+2];
    const nx0 = ay * bz - az * by, ny0 = az * bx - ax * bz, nz0 = ax * by - ay * bx;
    const l0 = Math.hypot(nx0, ny0, nz0);
    if (l0 < 1e-7) continue; // skip authored degenerate triangles
    
    // Deformed normal
    const cax = currentHp[i1*3] - currentHp[i0*3], cay = currentHp[i1*3+1] - currentHp[i0*3+1], caz = currentHp[i1*3+2] - currentHp[i0*3+2];
    const cbx = currentHp[i2*3] - currentHp[i0*3], cby = currentHp[i2*3+1] - currentHp[i0*3+1], cbz = currentHp[i2*3+2] - currentHp[i0*3+2];
    const cnx = cay * cbz - caz * cby, cny = caz * cbx - cax * cbz, cnz = cax * cby - cay * cbx;
    const lw = Math.hypot(cnx, cny, cnz);
    if (lw < 1e-7) {
      invertedCount++;
      continue;
    }
    
    const dot = (nx0 * cnx + ny0 * cny + nz0 * cnz) / (l0 * lw);
    if (dot < 0) invertedCount++;
    if (dot < minDot) minDot = dot;
  }
  
  const errMm = (maxSeamError * 1000).toFixed(4);
  console.log(`Weight ${w.toFixed(2)}: Max Seam Error = ${errMm} mm, Inverted Triangles = ${invertedCount}, Min Normal Dot = ${minDot.toFixed(4)}`);
  
  if (maxSeamError > 0.00002 || invertedCount > 0) {
    allPassed = false;
  }
}

if (allPassed) {
  console.log('\n>>> ALL 3D NECK SEAM & GEOMETRY CONTRACTS VERIFIED PERFECTLY! <<<');
} else {
  console.error('\n>>> FAIL: CONTRACT VIOLATIONS DETECTED <<<');
  process.exit(1);
}
