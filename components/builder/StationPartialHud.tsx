'use client';

import { useEffect } from 'react';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import type { ActiveStation } from '@/lib/builderStore';
import { INTERACT_LABELS } from '@/lib/builderCatalog';
import { WuxiaFeaturesPanel } from '@/components/hud/features/WuxiaFeaturesPanel';
import { WuxiaMakeupPanel } from '@/components/hud/makeup/WuxiaMakeupPanel';
import { HairStyles } from '@/components/hud/HairStyles';
import { BodyPanel } from '@/components/hud/BodyPanel';
import { EquipmentPanel } from '@/components/hud/EquipmentPanel';
import { PresetPanel } from '@/components/hud/PresetPanel';

interface StationPartialHudProps {
  manifest: Mo2Manifest | null;
  station: ActiveStation | null;
  presetsOpen: boolean;
  onClose: () => void;
}

const STATION_SUBTITLES: Record<ActiveStation['tag'], string> = {
  mirror: 'Features & Facial Sculpt',
  vanity: 'Skin Tone & Makeup',
  wardrobe: 'Wardrobe & Outfit',
  dresser: 'Hairstyle & Color',
  scale: 'Body Physique & Scale',
};

/**
 * Single-tab contextual HUD overlay rendered directly over the Room Builder
 * canvas when interacting with a furniture station (or opening Presets).
 */
export function StationPartialHud({
  manifest,
  station,
  presetsOpen,
  onClose,
}: StationPartialHudProps) {
  useEffect(() => {
    if (!station && !presetsOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target;
      if (target instanceof Element && target.closest('input, textarea, select')) return;
      if (document.querySelector('dialog[open], [role="menu"]')) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [station, presetsOpen, onClose]);

  if (!station && !presetsOpen) return null;

  const title = station ? INTERACT_LABELS[station.tag].label : 'Character Presets';
  const subtitle = station ? STATION_SUBTITLES[station.tag] : 'Load or manage presets';

  return (
    <aside
      aria-label={title}
      className="pointer-events-auto absolute top-[62px] left-2 sm:left-5 z-30 flex w-[348px] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-82px)] flex-col overflow-hidden rounded-[3px] border border-[#dfba73]/30 bg-[#14151b]/88 shadow-[0_14px_42px_rgba(0,0,0,0.68)] backdrop-blur-xl"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3.5 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-medium tracking-wide text-[#f4ead7]">
            {title}
          </h2>
          <p className="truncate text-[10px] font-mono tracking-wider text-[#a7a19a] uppercase">
            {subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[28px] shrink-0 rounded-[2px] border border-[#dfba73]/55 bg-[#dfba73]/18 px-2.5 text-[10px] font-mono tracking-widest text-[#f7eedc] uppercase transition-colors hover:bg-[#dfba73]/30 focus-visible:outline focus-visible:outline-[#eac87f]"
        >
          ✓ Done
        </button>
      </div>

      <div className="creator-library flex-1 overflow-y-auto scrollbar-none p-3.5 text-white">
        {presetsOpen && !station && <PresetPanel manifest={manifest} />}
        {station?.tag === 'mirror' && <WuxiaFeaturesPanel manifest={manifest} />}
        {station?.tag === 'vanity' && <WuxiaMakeupPanel manifest={manifest} />}
        {station?.tag === 'dresser' && <HairStyles manifest={manifest} />}
        {station?.tag === 'scale' && <BodyPanel manifest={manifest} />}
        {station?.tag === 'wardrobe' && <EquipmentPanel manifest={manifest} />}
      </div>
    </aside>
  );
}
