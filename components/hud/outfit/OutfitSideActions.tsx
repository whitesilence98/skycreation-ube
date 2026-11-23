'use client';

import { useCharacter } from '@/lib/store';
import { navigateCategory } from '@/lib/editorNav';
import { IconLotus, IconScroll } from '@/components/hud/outfit/WuxiaSlotIcons';

export function OutfitSideActions() {
  const showToast = useCharacter(s => s.showToast);
  const primaryTab = useCharacter(s => s.primaryTab);
  const isOutfit = primaryTab === 'EQUIPMENT';

  if (!isOutfit) return null;

  return (
    <aside
      className="pointer-events-auto absolute right-8 top-16 z-20 hidden md:flex flex-col items-end gap-6 select-none"
      aria-label="Side actions"
    >
      {/* ─────────────────────────────────────────────────────────────────────────────
          Quick Action Buttons (Collection & Gallery for Outfit)
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        {/* Collection for Outfit */}
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => showToast('Collection catalog opened')}
            aria-label="Collection (New items available)"
            title="Collection"
            className="group relative flex h-11 w-11 items-center justify-center rounded-[2px] border border-white/10 bg-[#202126]/90 backdrop-blur-md transition-all hover:border-[#d4b483]/50 hover:bg-[#282930] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
          >
            <IconLotus className="h-6 w-6 text-[#cfcacf] transition-colors group-hover:text-[#e4cca8]" />
            {/* Red Notification Dot */}
            <span
              aria-hidden
              className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-[#d7443e] ring-2 ring-[#202126] shadow-[0_0_6px_rgba(215,68,62,0.8)]"
            />
          </button>
          <span className="mt-1 text-[10px] tracking-wide text-[#9f9da6] group-hover:text-white">Collection</span>
        </div>

        {/* Gallery for Outfit */}
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => navigateCategory('preset')}
            aria-label="Preset and community gallery"
            title="Gallery"
            className="group relative flex h-11 w-11 items-center justify-center rounded-[2px] border border-white/10 bg-[#202126]/90 backdrop-blur-md transition-all hover:border-[#d4b483]/50 hover:bg-[#282930] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
          >
            <IconScroll className="h-6 w-6 text-[#cfcacf] transition-colors group-hover:text-[#e4cca8]" />
          </button>
          <span className="mt-1 text-[10px] tracking-wide text-[#9f9da6] group-hover:text-white">Gallery</span>
        </div>
      </div>
    </aside>
  );
}
