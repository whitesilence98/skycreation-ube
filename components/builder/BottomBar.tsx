'use client';

import type { BuilderMode } from '@/lib/builderStore';

interface BottomBarProps {
  mode: BuilderMode;
  hasSelection: boolean;
  hasGhost: boolean;
  hasNearbyInteract: boolean;
  selectedInteractLabel?: string | null;
}

function KeyCap({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-mono tracking-wide text-[#d8d2c7]">
      <span className="rounded-[2px] border border-[#dfba73]/40 bg-[#1a1b22]/90 px-1.5 py-0.5 text-[10px] font-semibold text-[#eac87f]">
        [{keys}]
      </span>
      <span>{label}</span>
    </div>
  );
}

/**
 * Bottom keyboard hint strip matching the reference isometric room builder HUD.
 */
export function BottomBar({
  mode,
  hasSelection,
  hasGhost,
  hasNearbyInteract,
  selectedInteractLabel,
}: BottomBarProps) {
  return (
    <footer
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex h-[44px] items-center justify-end bg-gradient-to-t from-[#0d0e12]/85 via-[#0d0e12]/45 to-transparent px-4 sm:px-8 select-none"
      aria-label="Room Builder Controls"
    >
      <div className="flex items-center gap-4 sm:gap-5 overflow-x-auto scrollbar-none">
        {mode === 'tour' ? (
          <>
            <KeyCap keys="WASD" label="Walk" />
            <KeyCap keys="SHIFT" label="Run" />
            <KeyCap keys="DRAG" label="Rotate Cam" />
            {hasNearbyInteract && <KeyCap keys="E" label="Customize" />}
            <KeyCap keys="ESC" label="Exit Tour" />
          </>
        ) : mode === 'build' ? (
          <>
            <KeyCap keys="L-CLICK" label="Start / Commit Wall" />
            <KeyCap keys="R" label="Rotate" />
            {hasSelection && <KeyCap keys="DEL" label="Remove" />}
            <KeyCap keys="ESC" label="Done / Cancel" />
          </>
        ) : (
          <>
            <KeyCap keys="L-CLICK" label={hasGhost ? 'Place' : 'Select / Move'} />
            {!hasGhost && <KeyCap keys="CLICK CHAR" label="Tour" />}
            <KeyCap keys="R" label="Rotate" />
            {selectedInteractLabel && <KeyCap keys="E" label={selectedInteractLabel} />}
            {hasSelection && <KeyCap keys="DEL" label="Remove" />}
            <KeyCap keys="ESC" label={hasGhost || hasSelection ? 'Clear' : 'Tour'} />
          </>
        )}
      </div>
    </footer>
  );
}
