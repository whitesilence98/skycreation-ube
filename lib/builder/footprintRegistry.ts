/**
 * Registry of unscaled local XZ/Y mesh extents per `catalogId`, populated live
 * from loaded GLTF `Box3.getSize()` and seeded with accurate Kenney fallbacks
 * so pure TypeScript placement validation works before assets finish loading.
 */

const runtimeSizes = new Map<string, [number, number, number]>();

/** Unscaled Kenney Furniture Kit local extents `[widthX, heightY, depthZ]` (multiply by `item.scale`). */
const FALLBACK_EXTENTS: ReadonlyArray<[string, [number, number, number]]> = [
  ['bedDouble', [0.98, 0.55, 1.05]],
  ['bedSingle', [0.58, 0.55, 1.05]],
  ['loungeSofaLong', [1.22, 0.45, 0.52]],
  ['loungeSofaCorner', [1.02, 0.45, 1.02]],
  ['loungeSofa', [0.92, 0.45, 0.5]],
  ['loungeDesignSofa', [0.95, 0.45, 0.5]],
  ['loungeDesignChair', [0.46, 0.45, 0.46]],
  ['loungeChairRelax', [0.46, 0.45, 0.5]],
  ['chair', [0.34, 0.45, 0.36]],
  ['stoolBar', [0.24, 0.45, 0.24]],
  ['benchCushion', [0.64, 0.32, 0.34]],
  ['deskCorner', [0.92, 0.42, 0.92]],
  ['desk', [0.68, 0.42, 0.38]],
  ['tableCoffee', [0.58, 0.25, 0.38]],
  ['tableRound', [0.48, 0.42, 0.48]],
  ['sideTable', [0.32, 0.36, 0.32]],
  ['cabinetBedDrawerTable', [0.34, 0.36, 0.34]],
  ['cabinetBedDrawer', [0.48, 0.48, 0.34]],
  ['bookcaseClosedWide', [0.76, 0.95, 0.32]],
  ['bookcase', [0.48, 0.95, 0.32]],
  ['coatRackStanding', [0.32, 0.92, 0.32]],
  ['televisionModern', [0.62, 0.52, 0.24]],
  ['speaker', [0.24, 0.48, 0.24]],
  ['pottedPlant', [0.28, 0.65, 0.28]],
  ['lampRoundFloor', [0.24, 0.85, 0.24]],
  ['lampSquareFloor', [0.24, 0.85, 0.24]],
  ['floorHalf', [0.5, 0.08, 1.0]],
  ['floor', [1.0, 0.08, 1.0]],
  ['wallHalf', [0.5, 1.29, 0.08]],
  ['wallCorner', [0.55, 1.29, 0.55]],
  ['wall', [1.0, 1.29, 0.08]],
  ['doorway', [1.0, 1.29, 0.12]],
];

export function registerCatalogExtent(
  catalogId: string,
  size: readonly [number, number, number],
): void {
  if (!catalogId) return;
  if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) return;
  runtimeSizes.set(catalogId, [size[0], size[1], size[2]]);
}

export function getCatalogExtent(catalogId: string): [number, number, number] {
  const cached = runtimeSizes.get(catalogId);
  if (cached) return cached;

  for (const [pattern, dims] of FALLBACK_EXTENTS) {
    if (catalogId.includes(pattern)) return dims;
  }
  return [0.42, 0.6, 0.42];
}
