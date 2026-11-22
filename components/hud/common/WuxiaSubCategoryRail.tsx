'use client';

import React from 'react';
import { navigateCategory } from '@/lib/editorNav';
import {
  IconSubPreset,
  IconSubFace,
  IconSubPhysique,
  IconSubMakeup,
  IconSubHair,
  IconSubOutfit,
} from '@/components/hud/outfit/WuxiaSlotIcons';
import { cn } from '@/lib/cn';

export type WuxiaSubTab = 'preset' | 'features' | 'physique' | 'makeup' | 'hairstyle' | 'outfit';

interface WuxiaSubCategoryRailProps {
  activeTab: WuxiaSubTab;
  onSelectTab?: (tab: WuxiaSubTab) => void;
  className?: string;
}

/**
 * Reusable Left Sub-Category Rail for character customization screens:
 * Presets (Character & Body), Features (Face Sculpt), Physique (Body), Makeup (Cosmetics), and Hairstyle.
 * Follows 100% pixel-accurate styling from Image 2 reference.
 */
export function WuxiaSubCategoryRail({
  activeTab,
  onSelectTab,
  className,
}: WuxiaSubCategoryRailProps) {
  const tabs = [
    {
      id: 'preset' as const,
      label: 'Presets',
      title: 'Character & Preset Gallery',
      Icon: IconSubPreset,
      onSelect: () => {
        navigateCategory('preset');
        onSelectTab?.('preset');
      },
    },
    {
      id: 'features' as const,
      label: 'Features',
      title: 'Face Features',
      Icon: IconSubFace,
      onSelect: () => {
        navigateCategory('face');
        onSelectTab?.('features');
      },
    },
    {
      id: 'physique' as const,
      label: 'Physique',
      title: 'Body Physique',
      Icon: IconSubPhysique,
      onSelect: () => {
        navigateCategory('body');
        onSelectTab?.('physique');
      },
    },
    {
      id: 'makeup' as const,
      label: 'Makeup',
      title: 'Makeup & Cosmetics',
      Icon: IconSubMakeup,
      onSelect: () => {
        navigateCategory('styling');
        onSelectTab?.('makeup');
      },
    },
    {
      id: 'hairstyle' as const,
      label: 'Hairstyle',
      title: 'Hairstyles',
      Icon: IconSubHair,
      onSelect: () => {
        navigateCategory('hair');
        onSelectTab?.('hairstyle');
      },
    },
    {
      id: 'outfit' as const,
      label: 'Outfit',
      title: 'Wardrobe & Equipment',
      Icon: IconSubOutfit,
      onSelect: () => {
        navigateCategory('outfit');
        onSelectTab?.('outfit');
      },
    },
  ];

  return (
    <nav
      className={cn('flex w-[72px] shrink-0 flex-col items-center gap-5 pt-1 select-none pointer-events-auto', className)}
      aria-label="Character Customization Sub-categories"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              tab.onSelect();
            }}
            className="group flex flex-col items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
            aria-current={isActive ? 'page' : undefined}
            aria-label={tab.label}
            title={tab.title}
          >
            {isActive ? (
              <div className="flex h-11 w-11 items-center justify-center rounded-[2px] bg-white text-black shadow-lg transition-transform group-hover:scale-105">
                <tab.Icon className="h-6 w-6" />
              </div>
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-white/10 bg-[#202126]/80 text-[#9f9da6] backdrop-blur-md transition-all group-hover:border-white/30 group-hover:text-white">
                <tab.Icon className="h-6 w-6" />
              </span>
            )}
            <span
              className={cn(
                'text-[10px] tracking-tight whitespace-nowrap transition-colors',
                isActive
                  ? 'font-medium text-white'
                  : 'text-[#9f9da6] group-hover:text-white'
              )}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
