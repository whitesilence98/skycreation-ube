/**
 * Geometry lifecycle self-check — run with `node --experimental-strip-types components/scene/useMeshGeometry.check.mts`.
 *
 * Node 24 strips the types; this file imports only the pure decode/dispose
 * helpers, not the React hooks, so it needs no DOM or test framework.
 */
import assert from 'node:assert/strict';
import { disposeMesh, meshDataToGeometry } from './useMeshGeometry.ts';

const data = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  uvs: [0, 0, 1, 0, 0, 1],
  indices: [0, 1, 2],
};

const { geometry, positions } = meshDataToGeometry(data);
assert.equal(geometry.getAttribute('position').count, 3);
assert.equal(geometry.getAttribute('uv').itemSize, 2);
assert.deepEqual(Array.from(geometry.getIndex()!.array), [0, 1, 2]);
assert.ok(positions instanceof Float32Array && positions.length === 9);

// A stale fetch result can be released without touching the live one.
let disposed = false;
geometry.addEventListener('dispose', () => (disposed = true));
disposeMesh({ geometry, positions });
assert.equal(disposed, true);

// Malformed payloads are rejected rather than producing a broken mesh.
assert.throws(() => meshDataToGeometry({ ...data, positions: [0, 0] }));
assert.throws(() => meshDataToGeometry({ ...data, indices: undefined as unknown as number[] }));
assert.throws(() => meshDataToGeometry({ ...data, indices: [0, 1, 9] }));
assert.throws(() => meshDataToGeometry({ ...data, normals: [] }));
assert.throws(() => meshDataToGeometry({ ...data, uvs: [NaN, 0, 1, 0, 0, 1] }));
assert.doesNotThrow(() => disposeMesh(null));

// Authored multi-material payload: every index has exactly one material.
const materials = [
  { name: 'body', role: 'skin' as const, texture: '/assets/preset-pack/skin/body.webp' },
  { name: 'garment', role: 'clothing' as const, texture: '/api/mo2/convert?kind=clothing&id=outfit&mode=atlas' },
];
const grouped = {
  ...data,
  positions: [...data.positions, 0, 0, 1],
  normals: [...data.normals, 0, 1, 0],
  uvs: [...data.uvs, 0, 0],
  indices: [0, 1, 2, 2, 1, 3],
  groups: [
    { start: 0, count: 3, materialIndex: 0 },
    { start: 3, count: 3, materialIndex: 1 },
  ],
  materials,
};
const multi = meshDataToGeometry(grouped);
assert.equal(multi.geometry.groups.length, 2);
assert.equal(multi.geometry.groups[1].materialIndex, 1);
assert.deepEqual(multi.materials?.[1].role, 'clothing');
assert.throws(
  () => meshDataToGeometry({ ...grouped, groups: [{ start: 0, count: 3, materialIndex: 2 }] }),
  'material index out of range is rejected',
);
assert.throws(
  () => meshDataToGeometry({ ...grouped, groups: [{ start: 0, count: 3, materialIndex: 0 }] }),
  'uncovered indices are rejected',
);
assert.throws(
  () => meshDataToGeometry({ ...grouped, materials: undefined } as never),
  'groups without materials are rejected',
);
// Author material descriptors: the renderer must never be handed a role it
// cannot classify, an out-of-range cutout, or a non-local URL.
assert.throws(
  () => meshDataToGeometry({ ...grouped, materials: [{ ...materials[0], role: 'skinny' }] } as never),
  'unknown material role is rejected',
);
assert.throws(
  () => meshDataToGeometry({ ...grouped, materials: [materials[0], { ...materials[1], alphaTest: 1.5 }] } as never),
  'alphaTest outside 0..1 is rejected',
);
assert.throws(
  () => meshDataToGeometry({ ...grouped, materials: [materials[0], { ...materials[1], doubleSided: 'yes' }] } as never),
  'non-boolean doubleSided is rejected',
);
assert.throws(
  () => meshDataToGeometry({ ...grouped, materials: [materials[0], { ...materials[1], texture: 'https://evil.test/a.png' }] } as never),
  'non-local texture URL is rejected',
);
assert.throws(
  () => meshDataToGeometry({ ...grouped, materials: [null, materials[1]] } as never),
  'null material is rejected',
);
assert.throws(
  () => meshDataToGeometry({ ...grouped, groups: [{ start: 0, count: 4, materialIndex: 0 }, { start: 4, count: 2, materialIndex: 1 }] }),
  'non-triangle-aligned group is rejected',
);
assert.throws(
  () => meshDataToGeometry({ ...grouped, materials: [{ ...materials[0] }] } as never),
  'material index past the descriptor list is rejected',
);
// Authored cutout/2-sided flags are honoured when supplied.
const authored = meshDataToGeometry({
  ...grouped,
  materials: [{ ...materials[0], alphaTest: 0.5, doubleSided: false }, materials[1]],
});
assert.equal(authored.materials?.[0].alphaTest, 0.5);
assert.equal(authored.materials?.[0].doubleSided, false);

console.log('useMeshGeometry lifecycle: ok');
