'use client';

import { IconArrowRight, IconChevronLeft, IconMouse, IconScroll } from '@/components/hud/Icons';
import { PresetIO } from '@/components/hud/PresetIO';
import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

interface FooterProps {
  manifest: Mo2Manifest | null;
}

export function Footer({ manifest }: FooterProps) {
  const region = useCharacter((s) => s.activeRegion);
  const primaryTab = useCharacter((s) => s.primaryTab);

  return (
    <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-30">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[74px] bg-gradient-to-t from-black/70 via-black/24 to-transparent" />

      {/* Reference: guides from x 48 at y 539–552; BACK at 740; the CONFIRM
          pill 838 → 988, 29 px tall centred on the same line. */}
      <div className="relative flex flex-col items-stretch justify-between gap-2 px-4 pb-6 lg:flex-row lg:items-end">
        {/* ── mouse guides ───────────────────────────────────────── */}
        <div className="flex max-w-full items-center gap-3 overflow-x-auto whitespace-nowrap text-[10px] tracking-[0.06em] text-[#b7ad9c]/72 [&>span]:shrink-0">
          {primaryTab === 'EQUIPMENT' || primaryTab === 'BODY' || primaryTab === 'PRESET' ? (
            <>
              <span className="flex items-center gap-[5px]">
                <IconMouse className="h-[13px] w-[9px]" filled />
                <span>Inspect Gear (LMB)</span>
              </span>
              <span className="flex items-center gap-[5px]">
                <IconMouse className="h-[13px] w-[9px]" />
                <span>Unequip / Equip (RMB)</span>
              </span>
              <span className="flex items-center gap-[5px]">
                <IconScroll className="h-[13px] w-[9px]" />
                <span>Zoom (Scroll)</span>
              </span>
            </>
          ) : primaryTab === 'HAIR' ? (
            <>
              <span className="flex items-center gap-[5px]">
                <IconMouse className="h-[13px] w-[9px]" filled />
                <span>Pick Style Tile (LMB)</span>
              </span>
              <span className="flex items-center gap-[5px]">
                <IconMouse className="h-[13px] w-[9px]" />
                <span>Orbit Camera (LMB / RMB)</span>
              </span>
              <span className="flex items-center gap-[5px]">
                <IconScroll className="h-[13px] w-[9px]" />
                <span>Zoom (Scroll)</span>
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-[5px]">
                <IconMouse className="h-[13px] w-[9px]" filled />
                <span>{primaryTab === 'FACE SHAPE' ? 'Sculpt Gizmo (LMB)' : 'Pick Style Tile (LMB)'}</span>
              </span>
              <span className="flex items-center gap-[5px]">
                <IconMouse className="h-[13px] w-[9px]" />
                <span>Orbit Camera (LMB / RMB)</span>
              </span>
              <span className="flex items-center gap-[5px]">
                <IconScroll className="h-[13px] w-[9px]" />
                <span>Zoom (Scroll)</span>
              </span>
            </>
          )}
        </div>

        {/* ── actions ────────────────────────────────────────────── */}
        <div className="pointer-events-auto relative flex flex-wrap items-center justify-end gap-x-3 gap-y-2 [&_button]:min-h-7">
          {(primaryTab === 'EQUIPMENT' || primaryTab === 'BODY' || primaryTab === 'PRESET' || primaryTab === 'HAIR' || primaryTab === 'FACE') && (
            <svg
              className="pointer-events-none absolute -top-10 right-4 h-7 w-7 text-[#d4b483]/45 drop-shadow-[0_0_8px_rgba(212,180,131,0.4)]"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0 L14.2 9.8 L24 12 L14.2 14.2 L12 24 L9.8 14.2 L0 12 L9.8 9.8 Z" />
            </svg>
          )}
          <PresetIO manifest={manifest} />
          <span className="h-[11px] w-px bg-[#d4b483]/18" />
          <button
            type="button"
            className="group flex items-center gap-[4px] text-[10px] tracking-[0.13em] text-[#b6ad9d]/80 transition-colors hover:text-[#eee2ca]"
          >
            <IconChevronLeft className="h-[9px] w-[9px] opacity-70 transition-transform group-hover:-translate-x-[1px]" />
            <span>BACK</span>
          </button>

          <button
            type="button"
            className="group flex h-[29px] items-center gap-[6px] rounded-full border border-[#d4b483]/48 bg-black/28 px-[14px] text-[10px] tracking-[0.13em] text-[#e4d8c2]/92 backdrop-blur-[4px] transition-all duration-200 hover:border-[#e0c48d]/85 hover:bg-[#d4b483]/[0.10] hover:shadow-[0_0_18px_rgba(212,180,131,0.22)]"
          >
            <span>CONFIRM &amp; APPLY</span>
            <IconArrowRight className="h-[9px] w-[9px] opacity-70 transition-transform group-hover:translate-x-[2px]" />
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-[7px] left-0 right-0 flex justify-center">
        <span className="text-[10px] tracking-[0.28em] text-[#8b8375]/28">
          {primaryTab === 'HAIR' ? 'SECTION · HAIR' : `REGION · ${region.toUpperCase()}`}
        </span>
      </div>
    </footer>
  );
}
