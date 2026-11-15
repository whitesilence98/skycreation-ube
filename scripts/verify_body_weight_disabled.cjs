const assert = require('assert');
const path = require('path');
const fs = require('fs');

const root = process.cwd();
const storeSrc = path.join(root, 'lib/store.ts');
const rawTs = fs.readFileSync(storeSrc, 'utf8');

// Verify exports and constant
console.log('=== Step 1: Verify BODY_WEIGHT_ENABLED flag ===');
assert.ok(rawTs.includes('export const BODY_WEIGHT_ENABLED = false;'), 'BODY_WEIGHT_ENABLED must be false');
console.log('  ✓ BODY_WEIGHT_ENABLED is false');

console.log('\n=== Step 2: Verify default weight ===');
assert.ok(rawTs.includes('weight: BODY_WEIGHT_ENABLED ? 1 : 0'), 'Default weight must be 0 when disabled');
console.log('  ✓ Default weight is locked to 0');

console.log('\n=== Step 3: Verify setWeight guard ===');
assert.ok(rawTs.includes('if (!BODY_WEIGHT_ENABLED) return;'), 'setWeight must be guarded by BODY_WEIGHT_ENABLED');
console.log('  ✓ setWeight is guarded against changes');

console.log('\n=== Step 4: Verify applyPreset and loadPreset guards ===');
assert.ok(rawTs.includes('BODY_WEIGHT_ENABLED && def?.weight !== undefined'), 'applyPreset must lock weight to 0');
assert.ok(rawTs.includes('weight: BODY_WEIGHT_ENABLED ? (payload.weight ?? s.weight) : 0'), 'loadPreset must lock weight to 0');
console.log('  ✓ Presets and imports lock weight to 0 when disabled');

console.log('\n>>> ALL BODY WEIGHT DISABLE VERIFICATIONS PASSED! <<<');
