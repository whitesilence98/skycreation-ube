'use client';

import { useCharacter } from '@/lib/store';
import { navigateCategory } from '@/lib/editorNav';
import { IconLotus, IconScroll } from '@/components/hud/outfit/WuxiaSlotIcons';

export function OutfitSideActions() {
  const showToast = useCharacter(s => s.showToast);
  const primaryTab = useCharacter(s => s.primaryTab);
  const isOutfit = primaryTab === 'EQUIPMENT';

  return (
    <aside
      className="pointer-events-auto absolute right-8 top-16 z-20 hidden md:flex flex-col items-end gap-6 select-none"
      aria-label="Side actions and status"
    >
      {/* ─────────────────────────────────────────────────────────────────────────────
          Quick Action Buttons (Collection / Share & Gallery)
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        {isOutfit ? (
          /* CALLOUT 7: Collection for Outfit */
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
        ) : (
          /* Gallery at top for Makeup/Hair (Image 2 & 3 Match) */
          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={() => navigateCategory('preset')}
              aria-label="Preset and community gallery"
              title="Gallery"
              className="group relative flex h-11 w-11 items-center justify-center rounded-[2px] border border-white/10 bg-[#202126]/90 backdrop-blur-md transition-all hover:border-[#d4b483]/50 hover:bg-[#282930] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
            >
              <IconScroll className="h-6 w-6 text-[#cfcacf] transition-colors group-hover:text-[#e4cca8]" />
              {/* Red Notification Dot */}
              <span
                aria-hidden
                className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-[#d7443e] ring-2 ring-[#202126] shadow-[0_0_6px_rgba(215,68,62,0.8)]"
              />
            </button>
            <span className="mt-1 text-[10px] tracking-wide text-[#9f9da6] group-hover:text-white">Gallery</span>
          </div>
        )}

        {isOutfit ? (
          /* CALLOUT 8: Gallery for Outfit */
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
        ) : (
          /* Share Button for Makeup/Hair (Image 2 & 3 Match) */
          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={() => showToast('Customization data copied to clipboard')}
              aria-label="Share customization data"
              title="Share"
              className="group relative flex h-11 w-11 items-center justify-center rounded-[2px] border border-white/10 bg-[#202126]/90 backdrop-blur-md transition-all hover:border-[#d4b483]/50 hover:bg-[#282930] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#cfcacf] transition-colors group-hover:text-[#e4cca8] fill-none stroke-current stroke-[1.8]" aria-hidden>
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </button>
            <span className="mt-1 text-[10px] tracking-wide text-[#9f9da6] group-hover:text-white">Share</span>
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          CALLOUT 9: Disguised Status Card (Outfit Only)
          ───────────────────────────────────────────────────────────────────────────── */}
      {isOutfit && (
        <div className="mt-28 flex flex-col items-end">
          <div
            role="region"
            aria-label="Character disguise status"
            className="relative flex w-[215px] items-start gap-2.5 rounded-[2px] border border-white/10 bg-[#1e1e23]/92 p-2.5 shadow-2xl backdrop-blur-md"
          >
            <div className="flex-1">
              <div className="text-xs font-medium text-[#da5c58]">Disguised</div>
              <p className="mt-0.5 text-[10px] leading-[1.35] text-[#9a98a0]">
                Currently disguised. Appearance will revert after the disguise is removed.
              </p>
            </div>

            {/* Red Silhouette Circular Portrait */}
            <div
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#da5c58]/40 bg-[#3a2022] overflow-hidden"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-[#da5c58]" fill="currentColor">
                <circle cx="12" cy="8" r="4" />
                <path d="M12 14 C7.5 14 4 17 4 21 L20 21 C20 17 16.5 14 12 14 Z" />
              </svg>
            </div>
          </div>

          {/* Debug Link */}
          <button
            type="button"
            onClick={() => showToast('Debug info: Character disguise active')}
            className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-[#8a8793] transition-colors hover:text-[#d4c8cf]"
          >
            <span>Debug</span>
            <span aria-hidden>›</span>
          </button>
        </div>
      )}
    </aside>
  );
}
