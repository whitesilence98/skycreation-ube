'use client';

import React from 'react';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import type { StudioPage } from '@/lib/store';
import { WuxiaSubCategoryRail, type WuxiaSubTab } from '@/components/hud/common/WuxiaSubCategoryRail';
import { WuxiaExpressionsPanel } from '@/components/hud/facemenu/WuxiaExpressionsPanel';
import { WuxiaUbeMorphsPanel } from '@/components/hud/facemenu/WuxiaUbeMorphsPanel';
import { WuxiaSculptBrushPanel } from '@/components/hud/facemenu/WuxiaSculptBrushPanel';
import { WuxiaHeadBasePanel } from '@/components/hud/facemenu/WuxiaHeadBasePanel';
import { WuxiaBodyPaintPanel } from '@/components/hud/facemenu/WuxiaBodyPaintPanel';
import type { EditorCategory } from '@/lib/faceControls';

const CATEGORY_TO_RAIL: Record<EditorCategory, WuxiaSubTab> = {
  preset: 'preset',
  face: 'features',
  body: 'physique',
  styling: 'makeup',
  hair: 'hairstyle',
  outfit: 'outfit',
};

export function FaceMenuScreen({
  page,
  category,
  manifest,
}: {
  page: Exclude<StudioPage, 'default' | 'smart'>;
  category: EditorCategory;
  manifest: Mo2Manifest | null;
}) {
  return (
    <div className="flex items-start gap-3 sm:gap-4 md:gap-5 select-none text-white pointer-events-auto">
      <WuxiaSubCategoryRail activeTab={CATEGORY_TO_RAIL[category]} />
      {page === 'expressions' && <WuxiaExpressionsPanel />}
      {page === 'ube_morphs' && <WuxiaUbeMorphsPanel />}
      {page === 'sculpt' && <WuxiaSculptBrushPanel />}
      {page === 'head_base' && <WuxiaHeadBasePanel manifest={manifest} />}
      {page === 'body_paint' && <WuxiaBodyPaintPanel />}
    </div>
  );
}
