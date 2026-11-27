import type { BuilderCategory, InteractTargetTag, PlacedItemType } from '@/lib/builderStore';

export interface CatalogItem {
  id: string;
  label: string;
  path: string;
  thumbnail: string;
  category: BuilderCategory;
  subcategory: string;
  type: PlacedItemType;
  interactTag?: InteractTargetTag;
  noCollide?: boolean;
}

const RAW_ASSETS: ReadonlyArray<{
  folder: 'structure' | 'furniture' | 'lighting' | 'decor';
  file: string;
  label: string;
  category: BuilderCategory;
  subcategory: string;
  type: PlacedItemType;
  interactTag?: InteractTargetTag;
  noCollide?: boolean;
}> = [
  // ── WALLS ────────────────────────────────────────────────────────────────
  { folder: 'structure', file: 'wall', label: 'Full Wall (2m)', category: 'walls', subcategory: 'Wall Segments', type: 'wall' },
  { folder: 'structure', file: 'wallHalf', label: 'Half Wall (1m)', category: 'walls', subcategory: 'Wall Segments', type: 'wall' },
  { folder: 'structure', file: 'wallCorner', label: 'Corner Wall', category: 'walls', subcategory: 'Corners & Trim', type: 'wall' },
  { folder: 'structure', file: 'wallCornerRond', label: 'Round Corner', category: 'walls', subcategory: 'Corners & Trim', type: 'wall' },
  { folder: 'structure', file: 'paneling', label: 'Wood Paneling', category: 'walls', subcategory: 'Corners & Trim', type: 'wall' },

  // ── FLOORS ───────────────────────────────────────────────────────────────
  { folder: 'structure', file: 'floorFull', label: 'Wood Floor (2×2)', category: 'floors', subcategory: 'Floor Tiles', type: 'floor', noCollide: true },
  { folder: 'structure', file: 'floorHalf', label: 'Half Floor', category: 'floors', subcategory: 'Floor Tiles', type: 'floor', noCollide: true },
  { folder: 'structure', file: 'floorCorner', label: 'Corner Floor', category: 'floors', subcategory: 'Floor Tiles', type: 'floor', noCollide: true },
  { folder: 'structure', file: 'floorCornerRound', label: 'Round Floor', category: 'floors', subcategory: 'Floor Tiles', type: 'floor', noCollide: true },

  // ── WINDOWS & DOORS ──────────────────────────────────────────────────────
  { folder: 'structure', file: 'wallWindow', label: 'Window Wall', category: 'windows', subcategory: 'Windows', type: 'wall' },
  { folder: 'structure', file: 'wallWindowSlide', label: 'Sliding Window', category: 'windows', subcategory: 'Windows', type: 'wall' },
  { folder: 'structure', file: 'wallDoorway', label: 'Doorway Wall', category: 'windows', subcategory: 'Doors & Arches', type: 'wall' },
  { folder: 'structure', file: 'wallDoorwayWide', label: 'Wide Doorway', category: 'windows', subcategory: 'Doors & Arches', type: 'wall' },
  { folder: 'structure', file: 'doorway', label: 'Door Frame', category: 'windows', subcategory: 'Doors & Arches', type: 'wall' },
  { folder: 'structure', file: 'doorwayFront', label: 'Front Door', category: 'windows', subcategory: 'Doors & Arches', type: 'wall' },
  { folder: 'structure', file: 'doorwayOpen', label: 'Open Door', category: 'windows', subcategory: 'Doors & Arches', type: 'wall' },

  // ── FURNITURE ────────────────────────────────────────────────────────────
  { folder: 'furniture', file: 'bathroomMirror', label: 'Vanity Mirror', category: 'furniture', subcategory: 'Mirrors & Vanity', type: 'prop', interactTag: 'mirror' },
  { folder: 'furniture', file: 'desk', label: 'Vanity Desk', category: 'furniture', subcategory: 'Tables & Desks', type: 'prop', interactTag: 'vanity' },
  { folder: 'furniture', file: 'deskCorner', label: 'Corner Desk', category: 'furniture', subcategory: 'Tables & Desks', type: 'prop', interactTag: 'vanity' },
  { folder: 'furniture', file: 'coatRackStanding', label: 'Standing Rack', category: 'furniture', subcategory: 'Wardrobe & Storage', type: 'prop', interactTag: 'wardrobe' },
  { folder: 'furniture', file: 'coatRack', label: 'Wall Coat Rack', category: 'furniture', subcategory: 'Wardrobe & Storage', type: 'prop', interactTag: 'wardrobe' },
  { folder: 'furniture', file: 'cabinetBedDrawer', label: 'Drawer Chest', category: 'furniture', subcategory: 'Wardrobe & Storage', type: 'prop', interactTag: 'dresser' },
  { folder: 'furniture', file: 'cabinetBedDrawerTable', label: 'Dresser Table', category: 'furniture', subcategory: 'Wardrobe & Storage', type: 'prop', interactTag: 'dresser' },
  { folder: 'furniture', file: 'loungeSofa', label: 'Lounge Sofa', category: 'furniture', subcategory: 'Seating', type: 'prop' },
  { folder: 'furniture', file: 'loungeSofaLong', label: 'Long Sofa', category: 'furniture', subcategory: 'Seating', type: 'prop' },
  { folder: 'furniture', file: 'loungeSofaCorner', label: 'Corner Sofa', category: 'furniture', subcategory: 'Seating', type: 'prop' },
  { folder: 'furniture', file: 'loungeDesignSofa', label: 'Modern Sofa', category: 'furniture', subcategory: 'Seating', type: 'prop' },
  { folder: 'furniture', file: 'loungeDesignChair', label: 'Accent Chair', category: 'furniture', subcategory: 'Seating', type: 'prop' },
  { folder: 'furniture', file: 'loungeChairRelax', label: 'Relax Chair', category: 'furniture', subcategory: 'Seating', type: 'prop' },
  { folder: 'furniture', file: 'chairModernCushion', label: 'Modern Chair', category: 'furniture', subcategory: 'Seating', type: 'prop' },
  { folder: 'furniture', file: 'chairModernFrameCushion', label: 'Frame Chair', category: 'furniture', subcategory: 'Seating', type: 'prop' },
  { folder: 'furniture', file: 'chairCushion', label: 'Dining Chair', category: 'furniture', subcategory: 'Seating', type: 'prop' },
  { folder: 'furniture', file: 'benchCushion', label: 'Cushion Bench', category: 'furniture', subcategory: 'Seating', type: 'prop' },
  { folder: 'furniture', file: 'benchCushionLow', label: 'Low Bench', category: 'furniture', subcategory: 'Seating', type: 'prop' },
  { folder: 'furniture', file: 'stoolBar', label: 'Bar Stool', category: 'furniture', subcategory: 'Seating', type: 'prop' },
  { folder: 'furniture', file: 'bedDouble', label: 'Double Bed', category: 'furniture', subcategory: 'Beds', type: 'prop', interactTag: 'scale' },
  { folder: 'furniture', file: 'bedSingle', label: 'Single Bed', category: 'furniture', subcategory: 'Beds', type: 'prop', interactTag: 'scale' },
  { folder: 'furniture', file: 'bookcaseOpen', label: 'Open Bookcase', category: 'furniture', subcategory: 'Wardrobe & Storage', type: 'prop' },
  { folder: 'furniture', file: 'bookcaseClosed', label: 'Bookcase', category: 'furniture', subcategory: 'Wardrobe & Storage', type: 'prop' },
  { folder: 'furniture', file: 'bookcaseClosedWide', label: 'Wide Bookcase', category: 'furniture', subcategory: 'Wardrobe & Storage', type: 'prop' },
  { folder: 'furniture', file: 'tableCoffee', label: 'Coffee Table', category: 'furniture', subcategory: 'Tables & Desks', type: 'prop' },
  { folder: 'furniture', file: 'tableCoffeeGlass', label: 'Glass Table', category: 'furniture', subcategory: 'Tables & Desks', type: 'prop' },
  { folder: 'furniture', file: 'tableRound', label: 'Round Table', category: 'furniture', subcategory: 'Tables & Desks', type: 'prop' },
  { folder: 'furniture', file: 'sideTable', label: 'Side Table', category: 'furniture', subcategory: 'Tables & Desks', type: 'prop' },
  { folder: 'furniture', file: 'sideTableDrawers', label: 'Drawer Table', category: 'furniture', subcategory: 'Tables & Desks', type: 'prop' },

  // ── DECOR ────────────────────────────────────────────────────────────────
  { folder: 'decor', file: 'rugRectangle', label: 'Woven Rug', category: 'decor', subcategory: 'Rugs', type: 'prop', noCollide: true },
  { folder: 'decor', file: 'rugRound', label: 'Round Rug', category: 'decor', subcategory: 'Rugs', type: 'prop', noCollide: true },
  { folder: 'decor', file: 'rugRounded', label: 'Rounded Rug', category: 'decor', subcategory: 'Rugs', type: 'prop', noCollide: true },
  { folder: 'decor', file: 'rugSquare', label: 'Square Rug', category: 'decor', subcategory: 'Rugs', type: 'prop', noCollide: true },
  { folder: 'decor', file: 'pottedPlant', label: 'Tall Plant', category: 'decor', subcategory: 'Plants', type: 'prop' },
  { folder: 'decor', file: 'plantSmall1', label: 'Small Plant I', category: 'decor', subcategory: 'Plants', type: 'prop', noCollide: true },
  { folder: 'decor', file: 'plantSmall2', label: 'Small Plant II', category: 'decor', subcategory: 'Plants', type: 'prop', noCollide: true },
  { folder: 'decor', file: 'plantSmall3', label: 'Small Plant III', category: 'decor', subcategory: 'Plants', type: 'prop', noCollide: true },
  { folder: 'decor', file: 'televisionModern', label: 'Modern TV', category: 'decor', subcategory: 'Accents', type: 'prop' },
  { folder: 'decor', file: 'speaker', label: 'Audio Speaker', category: 'decor', subcategory: 'Accents', type: 'prop' },
  { folder: 'decor', file: 'laptop', label: 'Laptop', category: 'decor', subcategory: 'Accents', type: 'prop', noCollide: true },
  { folder: 'decor', file: 'books', label: 'Book Stack', category: 'decor', subcategory: 'Accents', type: 'prop', noCollide: true },
  { folder: 'decor', file: 'pillow', label: 'Linen Pillow', category: 'decor', subcategory: 'Accents', type: 'prop', noCollide: true },
  { folder: 'decor', file: 'pillowBlue', label: 'Blue Pillow', category: 'decor', subcategory: 'Accents', type: 'prop', noCollide: true },

  // ── LIGHTING (surfaced under DECOR -> Lighting) ──────────────────────────
  { folder: 'lighting', file: 'lampRoundFloor', label: 'Round Floor Lamp', category: 'decor', subcategory: 'Lighting', type: 'prop' },
  { folder: 'lighting', file: 'lampSquareFloor', label: 'Square Floor Lamp', category: 'decor', subcategory: 'Lighting', type: 'prop' },
  { folder: 'lighting', file: 'lampRoundTable', label: 'Round Table Lamp', category: 'decor', subcategory: 'Lighting', type: 'prop', noCollide: true },
  { folder: 'lighting', file: 'lampSquareTable', label: 'Square Table Lamp', category: 'decor', subcategory: 'Lighting', type: 'prop', noCollide: true },
  { folder: 'lighting', file: 'lampWall', label: 'Wall Sconce', category: 'decor', subcategory: 'Lighting', type: 'prop', noCollide: true },
  { folder: 'lighting', file: 'lampSquareCeiling', label: 'Ceiling Light', category: 'decor', subcategory: 'Lighting', type: 'prop', noCollide: true },
  { folder: 'lighting', file: 'ceilingFan', label: 'Ceiling Fan', category: 'decor', subcategory: 'Lighting', type: 'prop', noCollide: true },
];

export const BUILDER_CATALOG: readonly CatalogItem[] = RAW_ASSETS.map((entry) => ({
  id: `${entry.folder}/${entry.file}`,
  label: entry.label,
  path: `/assets/builder/${entry.folder}/${entry.file}.glb`,
  thumbnail: `/assets/builder/thumbnails/${entry.file}.png`,
  category: entry.category,
  subcategory: entry.subcategory,
  type: entry.type,
  interactTag: entry.interactTag,
  noCollide: entry.noCollide,
}));

export const BUILDER_CATALOG_BY_ID: Readonly<Record<string, CatalogItem>> = Object.fromEntries(
  BUILDER_CATALOG.map((item) => [item.id, item]),
);

export const BUILDER_CATEGORY_META: ReadonlyArray<{
  id: BuilderCategory;
  label: string;
  subcategories: string[];
}> = [
  { id: 'walls', label: 'WALLS', subcategories: ['Wall Segments', 'Corners & Trim'] },
  { id: 'floors', label: 'FLOORS', subcategories: ['Floor Tiles'] },
  { id: 'windows', label: 'WINDOWS', subcategories: ['Windows', 'Doors & Arches'] },
  {
    id: 'furniture',
    label: 'FURNITURE',
    subcategories: ['Mirrors & Vanity', 'Seating', 'Tables & Desks', 'Wardrobe & Storage', 'Beds'],
  },
  { id: 'decor', label: 'DECOR', subcategories: ['Rugs', 'Plants', 'Lighting', 'Accents'] },
];

export function getCatalogByCategory(cat: BuilderCategory, subCategory?: string | null): CatalogItem[] {
  return BUILDER_CATALOG.filter(
    (item) => item.category === cat && (!subCategory || item.subcategory === subCategory),
  );
}

export const INTERACT_LABELS: Readonly<Record<InteractTargetTag, { label: string; tab: string }>> = {
  vanity: { label: 'Apply Makeup', tab: 'FACE' },
  mirror: { label: 'Sculpt Features', tab: 'FACE SHAPE' },
  wardrobe: { label: 'Change Outfit', tab: 'EQUIPMENT' },
  dresser: { label: 'Style Hair', tab: 'HAIR' },
  scale: { label: 'Body Physique', tab: 'BODY' },
};
