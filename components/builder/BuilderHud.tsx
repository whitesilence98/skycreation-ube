'use client';

import { useState } from 'react';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { useCharacter } from '@/lib/store';
import { useBuilderStore, type BuilderMode } from '@/lib/builderStore';
import { INTERACT_LABELS } from '@/lib/builderCatalog';
import { getSmartObjectDef, resolveSmartSlot } from '@/lib/builder/smartObjects';
import { BuilderPanel } from '@/components/builder/BuilderPanel';
import { BottomBar } from '@/components/builder/BottomBar';
import { ClockControlsPill, RoomLifeNeedsCard } from '@/components/builder/RoomLifeHud';
import { cn } from '@/lib/cn';

const MODE_TABS: ReadonlyArray<{ id: BuilderMode; label: string }> = [
  { id: 'build', label: 'BUILD WALLS' },
  { id: 'decorate', label: 'DECORATE' },
  { id: 'tour', label: 'TOUR' },
];

export function BuilderHud({ manifest: _manifest }: { manifest: Mo2Manifest | null }) {
  const [panelOpen, setPanelOpen] = useState(true);
  const mode = useBuilderStore((s) => s.mode);
  const grid = useBuilderStore((s) => s.grid);
  const snapAngle = useBuilderStore((s) => s.snapAngle);
  const selectedItemId = useBuilderStore((s) => s.selectedItemId);
  const ghostCatalogId = useBuilderStore((s) => s.ghostCatalogId);
  const nearbyInteract = useBuilderStore((s) => s.nearbyInteract);

  const setMode = useBuilderStore((s) => s.setMode);
  const setGrid = useBuilderStore((s) => s.setGrid);
  const setSnapAngle = useBuilderStore((s) => s.setSnapAngle);

  const exitToStudio = () => {
    useCharacter.getState().setAnimationId('idle');
    useCharacter.getState().setAppMode('studio');
  };

  const triggerInteract = () => {
    if (!nearbyInteract) return;
    const builder = useBuilderStore.getState();
    const item = builder.placedItems.find((i) => i.id === nearbyInteract.itemId);
    const def = item ? getSmartObjectDef(item.catalogId) : null;
    if (item && def) {
      const slot = resolveSmartSlot(item, def);
      builder.setPlayerPose([slot.standXZ[0], 0, slot.standXZ[1]], slot.facingYaw + Math.PI);
    }
    const meta = INTERACT_LABELS[nearbyInteract.tag];
    useCharacter.getState().setAnimationId('idle');
    useCharacter.getState().setBackgroundMode('room');
    useCharacter.getState().setPrimaryTab(meta.tab);
    useCharacter.getState().setAppMode('studio');
    useCharacter.getState().showToast(meta.label);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden select-none">
      {/* Top Mode Bar matching reference layout */}
      <header
        aria-label="Room Builder Navigation"
        className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-[52px] items-center justify-between bg-gradient-to-b from-[#0d0e13]/92 via-[#0d0e13]/65 to-transparent px-2 sm:px-7"
      >
        {/* Left label */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={exitToStudio}
            className="flex min-h-[30px] items-center gap-1.5 rounded-[2px] border border-[#dfba73]/45 bg-[#1b1c23]/85 px-2 sm:px-2.5 text-[10px] font-mono tracking-widest text-[#f2dfbe] uppercase transition-colors hover:border-[#dfba73] hover:bg-[#dfba73]/20 focus-visible:outline focus-visible:outline-[#eac87f]"
            title="Return to Character Customization Studio"
          >
            <span aria-hidden>←</span>
            <span className="hidden sm:inline">Studio</span>
          </button>
          {mode !== 'tour' && (
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              aria-expanded={panelOpen}
              className="flex md:hidden min-h-[30px] items-center rounded-[2px] border border-white/15 bg-[#1b1c23]/85 px-2 text-[10px] font-mono text-[#dcd6cb] uppercase"
            >
              {panelOpen ? 'Hide' : 'Catalog'}
            </button>
          )}
        </div>

        {/* Center Mode Tabs: BUILD WALLS | DECORATE | TOUR */}
        <nav
          aria-label="Builder Modes"
          className="flex items-center gap-2 sm:gap-6"
        >
          {MODE_TABS.map((tab, idx) => {
            const isActive = mode === tab.id;
            return (
              <div key={tab.id} className="flex items-center gap-2 sm:gap-6">
                {idx > 0 && <span className="h-3.5 w-px bg-white/15" aria-hidden />}
                <button
                  type="button"
                  onClick={() => setMode(tab.id)}
                  aria-pressed={isActive}
                  className={cn(
                    'relative min-h-[34px] px-1 sm:px-1.5 font-sans text-[11px] sm:text-[14px] tracking-[0.08em] sm:tracking-[0.12em] uppercase transition-colors focus-visible:outline focus-visible:outline-[#eac87f] whitespace-nowrap',
                    isActive
                      ? 'font-medium text-[#e4cca8]'
                      : 'text-[#9a969e] hover:text-[#dfd8cc]',
                  )}
                >
                  <span>{tab.label}</span>
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute right-0 bottom-0 left-0 h-[2px] bg-gradient-to-r from-transparent via-[#e4cca8] to-transparent"
                    />
                  )}
                </button>
              </div>
            );
          })}
        </nav>

        {/* Top-right Clock, AI Speed & Grid/Angle Snap Pills */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <ClockControlsPill />
          <button
            type="button"
            onClick={() => setGrid(grid === 0.5 ? 1.0 : 0.5)}
            title="Toggle placement grid snap increment"
            className="hidden lg:inline-flex min-h-[28px] items-center rounded-[2px] border border-white/15 bg-[#1b1c23]/85 px-2.5 font-mono text-[10px] tracking-wider text-[#dcd6cb] uppercase transition-colors hover:border-[#dfba73]/60 hover:text-white"
          >
            GRID: {grid.toFixed(1)}m
          </button>
          <button
            type="button"
            onClick={() => setSnapAngle(snapAngle === 45 ? 90 : 45)}
            title="Toggle rotation snap increment"
            className="hidden lg:inline-flex min-h-[28px] items-center rounded-[2px] border border-white/15 bg-[#1b1c23]/85 px-2.5 font-mono text-[10px] tracking-wider text-[#dcd6cb] uppercase transition-colors hover:border-[#dfba73]/60 hover:text-white"
          >
            {snapAngle}° SNAP
          </button>
        </div>
      </header>

      {/* Left Catalog & Blueprint Panel */}
      {panelOpen && (
        <div className="pointer-events-none absolute top-[62px] left-2 sm:left-5 z-20">
          <BuilderPanel />
        </div>
      )}

      {/* Tour Mode Status Pill & Interactive Prompt Button */}
      {mode === 'tour' && (
        <div className="pointer-events-none absolute top-[64px] left-4 z-20 flex flex-col gap-2">
          <div className="rounded-[2px] border border-[#dfba73]/35 bg-[#14151b]/85 px-3 py-2 text-[11px] font-mono text-[#e2dcd1] backdrop-blur-md">
            <div className="text-[10px] tracking-widest text-[#eac87f] uppercase">Room Tour Active</div>
            <div className="mt-0.5 text-[10px] text-[#a7a29b]">
              Walk up to a Vanity, Mirror, Rack, or Bed to customize
            </div>
          </div>
          {nearbyInteract && (
            <button
              type="button"
              onClick={triggerInteract}
              className="pointer-events-auto flex min-h-[36px] items-center gap-2 rounded-[2px] border border-[#eac87f] bg-[#1a1914]/92 px-3 py-1.5 text-[11px] font-mono tracking-wider text-[#f7eedc] uppercase shadow-[0_0_16px_rgba(234,200,127,0.3)] hover:bg-[#dfba73]/25"
            >
              <span className="rounded-[2px] border border-[#dfba73] bg-[#dfba73]/25 px-1.5 py-0.5 text-[10px] font-bold text-[#eac87f]">
                E
              </span>
              <span>{nearbyInteract.label}</span>
            </button>
          )}
        </div>
      )}

      {/* Autonomous Room Life Needs & Activity Card */}
      <RoomLifeNeedsCard />

      {/* Bottom Keyboard Hints */}
      <BottomBar
        mode={mode}
        hasSelection={Boolean(selectedItemId)}
        hasGhost={Boolean(ghostCatalogId)}
        hasNearbyInteract={Boolean(nearbyInteract)}
      />
    </div>
  );
}
