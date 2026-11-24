// Hair material policy — the alpha/gloss rules every hair loader shares.
//
// Regression guard for the "curtain of glass" bug: cutout hair rendered with
// `transparent: true` at full opacity blends by each texel's own alpha and
// reads as a see-through veil.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, '.tmp-hair-material');

// Compile the TypeScript modules to CJS so the assertions run against the real
// source rather than a copy of its logic.
const out = execSync(
  `npx tsc lib/hair/material.ts lib/hair/settings.ts --outDir .tmp-hair-material --module commonjs --target es2020 --skipLibCheck`,
  { cwd: root, encoding: 'utf8' },
);
assert.equal(out.trim(), '', 'hair modules must compile without diagnostics');

const {
  hairMaterialState,
  hairRoughness,
  HAIR_ALPHA_CUTOFF,
  HAIR_BLEND_THRESHOLD,
} = require(path.join(outDir, 'material.js'));
const { DEFAULT_HAIR, HAIR_LIMITS, coerceHair } = require(path.join(outDir, 'settings.js'));

// ── opaque case: cutout, never blended ─────────────────────────────────────
for (const alpha of [1, 0.999]) {
  const s = hairMaterialState(alpha);
  assert.equal(s.transparent, false, `alpha ${alpha} must not enable blending`);
  assert.equal(s.depthWrite, true, `alpha ${alpha} must write depth`);
  assert.equal(s.alphaTest, HAIR_ALPHA_CUTOFF, `alpha ${alpha} keeps the cutout`);
}

// ── faded case: blend, and stop writing depth ──────────────────────────────
const faded = hairMaterialState(0.5);
assert.equal(faded.transparent, true, 'a faded hairstyle blends');
assert.equal(faded.depthWrite, false, 'blending must not write depth');
assert.ok(faded.alphaTest > 0 && faded.alphaTest < HAIR_ALPHA_CUTOFF,
  'fading lowers the cutout instead of shattering the cards');

// ── a BLEND-authored source keeps blending at any opacity ──────────────────
const blendAuthored = hairMaterialState(1, undefined, true);
assert.equal(blendAuthored.transparent, true, 'alphaMode BLEND is respected');
assert.equal(blendAuthored.alphaTest, 0, 'a blended material has no cutout');

// ── clamping ───────────────────────────────────────────────────────────────
assert.equal(hairMaterialState(5).opacity, 1);
assert.equal(hairMaterialState(-2).opacity, 0);

// ── gloss: no mirror at 100% ───────────────────────────────────────────────
assert.equal(hairRoughness(0), 0.62, 'zero gloss is matte');
assert.ok(hairRoughness(1) >= 0.28, 'full gloss still reads as hair, not chrome');
const rough = [0, 0.25, 0.5, 0.75, 1].map(hairRoughness);
assert.deepEqual(rough, [...rough].sort((a, b) => b - a), 'gloss is monotonic');

// ── tuning overrides are honoured ──────────────────────────────────────────
const tight = hairMaterialState(1, { matCutoff: 0.6 });
assert.equal(tight.alphaTest, 0.6, 'a tuned cutout reaches the material');
const early = hairMaterialState(0.9, { matBlendThreshold: 0.95 });
assert.equal(early.transparent, true, 'a tuned blend threshold takes effect at 0.9');
// gloss 1 → 0.62 − 0.4 = 0.22, so a 0.5 floor must win.
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
near(hairRoughness(1, { matSheenFloor: 0.5 }), 0.5); // floor clamps the curve
assert.equal(hairRoughness(1, { matSheenFloor: 0.5 }), 0.5, 'a tuned floor clamps the curve');
near(hairRoughness(1, { matSheenFloor: 0.05 }), 0.22); // floor below the curve is inert

// ── every exposed tuning field survives coercion ───────────────────────────
const tuningFields = Object.keys(HAIR_LIMITS).filter((k) => /^(mat|sway|scalp)/.test(k));
assert.equal(tuningFields.length, 26, `all 26 tuning fields are exposed, saw ${tuningFields.length}`);
for (const key of tuningFields) {
  assert.equal(typeof DEFAULT_HAIR[key], 'number', `${key} has a numeric default`);
  const [min, max] = HAIR_LIMITS[key];
  assert.ok(min < max, `${key} has an ordered range`);
  assert.ok(DEFAULT_HAIR[key] >= min && DEFAULT_HAIR[key] <= max,
    `${key} default ${DEFAULT_HAIR[key]} sits inside [${min}, ${max}]`);
  // Out-of-range writes clamp rather than reaching the renderer.
  assert.equal(coerceHair({ [key]: max + 1000 })[key], max, `${key} clamps high`);
  assert.equal(coerceHair({ [key]: min - 1000 })[key], min, `${key} clamps low`);
  // Non-finite falls back to the default instead of propagating NaN.
  assert.equal(coerceHair({ [key]: Infinity })[key], DEFAULT_HAIR[key], `${key} rejects Infinity`);
}

// A tuned hair block still round-trips through coercion unchanged.
const custom = coerceHair({ ...DEFAULT_HAIR, matCutoff: 0.5, swayAmpX: 0.04 });
assert.equal(custom.matCutoff, 0.5);
assert.equal(custom.swayAmpX, 0.04);

assert.equal(HAIR_BLEND_THRESHOLD, DEFAULT_HAIR.matBlendThreshold,
  'the exported threshold and the stored default agree');

fs.rmSync(outDir, { recursive: true, force: true });

console.log('✓ hair material policy: cutout stays opaque, blending only on fade');
console.log(`✓ hair tuning: ${tuningFields.length} fields coerced, clamped and defaulted`);
