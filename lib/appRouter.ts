import { editorCategory, type EditorCategory } from '@/lib/faceControls';
import type { BuilderMode } from '@/lib/builderStore';
import type { StudioPage } from '@/lib/store';

export type AppRoute =
  | {
      appMode: 'studio';
      category: EditorCategory;
      primaryTab: string;
      studioPage: StudioPage;
    }
  | {
      appMode: 'builder';
      builderMode: BuilderMode | null;
    };

export interface AppRouteSnapshot {
  appMode: 'studio' | 'builder';
  primaryTab: string;
  studioPage: StudioPage;
  builderMode: BuilderMode;
}

export const CATEGORY_TO_SLUG: Record<EditorCategory, string> = {
  preset: 'presets',
  face: 'features',
  styling: 'makeup',
  hair: 'hair',
  body: 'physique',
  outfit: 'outfit',
};

export const CATEGORY_TO_PRIMARY_TAB: Record<EditorCategory, string> = {
  preset: 'PRESET',
  face: 'FACE SHAPE',
  styling: 'FACE',
  hair: 'HAIR',
  body: 'BODY',
  outfit: 'EQUIPMENT',
};

const SLUG_TO_CATEGORY: Record<string, EditorCategory> = {
  presets: 'preset',
  preset: 'preset',
  features: 'face',
  face: 'face',
  makeup: 'styling',
  styling: 'styling',
  hair: 'hair',
  hairstyle: 'hair',
  physique: 'body',
  body: 'body',
  outfit: 'outfit',
  wardrobe: 'outfit',
  equipment: 'outfit',
};

const BUILDER_MODES: ReadonlySet<BuilderMode> = new Set(['build', 'decorate', 'tour']);

const SLUG_TO_STUDIO_PAGE: Record<string, StudioPage> = {
  expressions: 'expressions',
  'ube-morphs': 'ube_morphs',
  ube_morphs: 'ube_morphs',
  sculpt: 'sculpt',
  '3d-sculpt': 'sculpt',
  'head-base': 'head_base',
  head_base: 'head_base',
  'body-paint': 'body_paint',
  body_paint: 'body_paint',
  smart: 'smart',
};

const STUDIO_PAGE_TO_SLUG: Record<StudioPage, string | null> = {
  default: null,
  expressions: 'expressions',
  ube_morphs: 'ube-morphs',
  sculpt: 'sculpt',
  head_base: 'head-base',
  body_paint: 'body-paint',
  smart: 'smart',
};

/**
 * Parse a URL hash string (e.g. `#hair`, `#makeup/smart`, `#features/expressions`, `#room/tour`) into a structured route.
 * Returns `null` for empty or unrecognized hashes.
 */
export function parseAppHash(rawHash: string): AppRoute | null {
  const cleaned = rawHash.replace(/^#\/?/, '').replace(/\/+$/, '').trim().toLowerCase();
  if (!cleaned) return null;

  const [seg1, seg2] = cleaned.split('/');

  if (seg1 === 'room') {
    if (!seg2) {
      return { appMode: 'builder', builderMode: null };
    }
    if (BUILDER_MODES.has(seg2 as BuilderMode)) {
      return { appMode: 'builder', builderMode: seg2 as BuilderMode };
    }
    return { appMode: 'builder', builderMode: null };
  }

  const category = SLUG_TO_CATEGORY[seg1];
  if (!category) return null;

  const mappedPage = seg2 ? SLUG_TO_STUDIO_PAGE[seg2] : undefined;
  const studioPage: StudioPage =
    mappedPage === 'smart' && category !== 'hair' && category !== 'styling'
      ? 'default'
      : (mappedPage ?? 'default');

  return {
    appMode: 'studio',
    category,
    primaryTab: CATEGORY_TO_PRIMARY_TAB[category],
    studioPage,
  };
}

/**
 * Convert the current studio/builder store snapshot into its canonical `#` hash path.
 */
export function formatAppHash(snapshot: AppRouteSnapshot): string {
  if (snapshot.appMode === 'builder') {
    return `#room/${snapshot.builderMode}`;
  }

  const category = editorCategory(snapshot.primaryTab);
  const slug = CATEGORY_TO_SLUG[category];
  if (snapshot.studioPage === 'smart' && category !== 'hair' && category !== 'styling') {
    return `#${slug}`;
  }
  const sub = STUDIO_PAGE_TO_SLUG[snapshot.studioPage];
  return sub ? `#${slug}/${sub}` : `#${slug}`;
}
