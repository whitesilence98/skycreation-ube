'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { useCharacter } from '@/lib/store';
import { useBuilderStore, type PlacedItem } from '@/lib/builderStore';
import { INTERACT_LABELS } from '@/lib/builderCatalog';
import { getSmartObjectDef, resolveSmartSlot } from '@/lib/builder/smartObjects';
import { BuilderPanel } from '@/components/builder/BuilderPanel';
import { BottomBar } from '@/components/builder/BottomBar';
import { ClockControlsPill, RoomLifeNeedsCard } from '@/components/builder/RoomLifeHud';
import { StationPartialHud } from '@/components/builder/StationPartialHud';
import { WuxiaExportDropdown } from '@/components/hud/common/WuxiaExportDropdown';
import { WuxiaImportButton } from '@/components/hud/common/WuxiaImportButton';
import { HdrPanel } from '@/components/hud/HdrPanel';
import { GraphicsPanel } from '@/components/hud/GraphicsPanel';
import { CameraPanel } from '@/components/hud/CameraPanel';
import { SettingsPanel } from '@/components/hud/SettingsPanel';
import { useRenderStats } from '@/lib/perf';
import { cn } from '@/lib/cn';

type RoomVisualTool = 'hdr' | 'graphics' | 'camera' | 'settings';

function FpsBadge() {
  const fps = useRenderStats((s) => s.fps);
  const calls = useRenderStats((s) => s.calls);
  const tris = useRenderStats((s) => s.tris);

  const tone =
    fps >= 50
      ? 'border-emerald-500/35 text-emerald-300'
      : fps >= 30
        ? 'border-[#dfba73]/45 text-[#eac87f]'
        : 'border-rose-500/45 text-rose-300';

  return (
    <span
      title={`${fps} FPS · ${calls} draw calls · ${Math.round(tris / 1000)}k tris`}
      className={cn(
        'inline-flex min-h-[28px] items-center rounded-[2px] border bg-[#1b1c23]/85 px-2 font-mono text-[10px] tracking-wider tabular-nums',
        tone,
      )}
    >
      {fps > 0 ? `${fps} FPS` : '-- FPS'}
    </span>
  );
}

export function BuilderHud({ manifest }: { manifest: Mo2Manifest | null }) {
  const [panelOpen, setPanelOpen] = useState(true);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [openTool, setOpenTool] = useState<RoomVisualTool | null>(null);
  const enbEnabled = useCharacter((s) => s.enbEnabled);
  const mode = useBuilderStore((s) => s.mode);
  const grid = useBuilderStore((s) => s.grid);
  const snapAngle = useBuilderStore((s) => s.snapAngle);
  const placedItems = useBuilderStore((s) => s.placedItems);
  const selectedItemId = useBuilderStore((s) => s.selectedItemId);
  const ghostCatalogId = useBuilderStore((s) => s.ghostCatalogId);
  const nearbyInteract = useBuilderStore((s) => s.nearbyInteract);
  const activeStation = useBuilderStore((s) => s.activeStation);
  const toast = useCharacter((s) => s.toast);

  const setMode = useBuilderStore((s) => s.setMode);
  const setGrid = useBuilderStore((s) => s.setGrid);
  const setSnapAngle = useBuilderStore((s) => s.setSnapAngle);

  const selectedItem = selectedItemId
    ? placedItems.find((i) => i.id === selectedItemId) ?? null
    : null;
  const selectedStationMeta =
    mode === 'decorate' && selectedItem?.interactTag
      ? INTERACT_LABELS[selectedItem.interactTag]
      : null;

  const activateStationForItem = useCallback((item: PlacedItem) => {
    if (!item.interactTag) return;
    const builder = useBuilderStore.getState();
    const def = getSmartObjectDef(item.catalogId);
    if (def) {
      const slot = resolveSmartSlot(item, def);
      builder.setPlayerPose([slot.standXZ[0], 0, slot.standXZ[1]], slot.facingYaw + Math.PI);
    }
    setPresetsOpen(false);
    useCharacter.getState().setAnimationId('idle');
    builder.openStation(item.id, item.interactTag);
    useCharacter.getState().showToast(INTERACT_LABELS[item.interactTag].label);
  }, []);

  const triggerInteract = useCallback(() => {
    if (!nearbyInteract) return;
    const item = useBuilderStore
      .getState()
      .placedItems.find((i) => i.id === nearbyInteract.itemId);
    if (item) {
      activateStationForItem(item);
      return;
    }
    setPresetsOpen(false);
    useCharacter.getState().setAnimationId('idle');
    useBuilderStore.getState().openStation(nearbyInteract.itemId, nearbyInteract.tag);
    useCharacter.getState().showToast(nearbyInteract.label);
  }, [nearbyInteract, activateStationForItem]);

  const closeOverlay = useCallback(() => {
    const builder = useBuilderStore.getState();
    if (builder.activeStation) {
      builder.closeStation();
      useCharacter
        .getState()
        .setAnimationId(builder.mode === 'tour' ? 'idle-clip' : 'idle-clip');
    }
    setPresetsOpen(false);
  }, []);

  // Allow pressing [E] in DECORATE mode when an interactive station prop is selected
  useEffect(() => {
    if (mode !== 'decorate' || !selectedItem?.interactTag || activeStation) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'e' || e.repeat) return;
      const target = e.target;
      if (target instanceof Element && target.closest('input, textarea, select')) return;
      e.preventDefault();
      activateStationForItem(selectedItem);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, selectedItem, activeStation, activateStationForItem]);

  // Escape closes open visual popover (HDR / ENB / Cam) cleanly
  useEffect(() => {
    if (!openTool) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('dialog[open], [role="menu"]')) return;
      e.preventDefault();
      setOpenTool(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openTool]);

  const toggleTool = (tool: RoomVisualTool) => {
    setOpenTool((prev) => (prev === tool ? null : tool));
  };

  const overlayActive = Boolean(activeStation) || presetsOpen;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden select-none">
      {/* Top Mode Bar */}
      <header
        aria-label="Room Builder Navigation"
        className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-[52px] items-center justify-between bg-gradient-to-b from-[#0d0e13]/92 via-[#0d0e13]/65 to-transparent px-2 sm:px-7"
      >
        {/* Left Presets, Import & Export controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (activeStation) useBuilderStore.getState().closeStation();
              setPresetsOpen((v) => !v);
            }}
            aria-pressed={presetsOpen && !activeStation}
            className={cn(
              'flex min-h-[28px] items-center gap-1.5 rounded-[2px] border px-2 sm:px-2.5 text-[10px] font-mono tracking-widest uppercase transition-colors focus-visible:outline focus-visible:outline-[#eac87f]',
              presetsOpen && !activeStation
                ? 'border-[#eac87f] bg-[#dfba73]/25 text-[#f7eedc]'
                : 'border-[#dfba73]/40 bg-[#1b1c23]/85 text-[#f2dfbe] hover:border-[#dfba73] hover:bg-[#dfba73]/20',
            )}
            title="Load or save character presets"
          >
            <span aria-hidden>✦</span>
            <span className="hidden sm:inline">Presets</span>
          </button>
          <WuxiaImportButton manifest={manifest} />
          <WuxiaExportDropdown />
          {mode !== 'tour' && !overlayActive && (
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              aria-expanded={panelOpen}
              className="flex md:hidden min-h-[28px] items-center rounded-[2px] border border-white/15 bg-[#1b1c23]/85 px-2 text-[10px] font-mono text-[#dcd6cb] uppercase"
            >
              {panelOpen ? 'Hide' : 'Catalog'}
            </button>
          )}
        </div>

        {/* Top-right FPS, HDR / ENB / Cam Visuals, Clock, AI Speed & Grid/Angle Snap */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          <FpsBadge />
          <div className="flex items-center gap-1" role="group" aria-label="Room Visuals and Camera">
            <button
              type="button"
              onClick={() => toggleTool('hdr')}
              aria-pressed={openTool === 'hdr'}
              title="Lighting & HDRI Environment"
              className={cn(
                'min-h-[28px] rounded-[2px] border px-2 font-mono text-[10px] tracking-wider uppercase transition-colors focus-visible:outline focus-visible:outline-[#eac87f]',
                openTool === 'hdr'
                  ? 'border-[#eac87f] bg-[#dfba73]/25 text-[#f7eedc]'
                  : 'border-white/15 bg-[#1b1c23]/85 text-[#dcd6cb] hover:border-[#dfba73]/60 hover:text-white',
              )}
            >
              <span aria-hidden>☀</span>
              <span className="hidden xl:inline ml-1">HDR</span>
            </button>
            <button
              type="button"
              onClick={() => toggleTool('graphics')}
              aria-pressed={openTool === 'graphics'}
              title="ENB, ReShade & Post-Processing"
              className={cn(
                'min-h-[28px] rounded-[2px] border px-2 font-mono text-[10px] tracking-wider uppercase transition-colors focus-visible:outline focus-visible:outline-[#eac87f]',
                openTool === 'graphics'
                  ? 'border-[#eac87f] bg-[#dfba73]/25 text-[#f7eedc]'
                  : enbEnabled
                    ? 'border-[#dfba73]/55 bg-[#dfba73]/12 text-[#f2dfbe] hover:border-[#eac87f]'
                    : 'border-white/15 bg-[#1b1c23]/85 text-[#dcd6cb] hover:border-[#dfba73]/60 hover:text-white',
              )}
            >
              <span aria-hidden>🎨</span>
              <span className="hidden xl:inline ml-1">ENB</span>
            </button>
            <button
              type="button"
              onClick={() => toggleTool('camera')}
              aria-pressed={openTool === 'camera'}
              title="Camera Framing, FOV & Lighting Rig"
              className={cn(
                'min-h-[28px] rounded-[2px] border px-2 font-mono text-[10px] tracking-wider uppercase transition-colors focus-visible:outline focus-visible:outline-[#eac87f]',
                openTool === 'camera'
                  ? 'border-[#eac87f] bg-[#dfba73]/25 text-[#f7eedc]'
                  : 'border-white/15 bg-[#1b1c23]/85 text-[#dcd6cb] hover:border-[#dfba73]/60 hover:text-white',
              )}
            >
              <span aria-hidden>📷</span>
              <span className="hidden xl:inline ml-1">Cam</span>
            </button>
            <button
              type="button"
              onClick={() => toggleTool('settings')}
              aria-pressed={openTool === 'settings'}
              title="Graphics, Performance & System Settings"
              className={cn(
                'min-h-[28px] rounded-[2px] border px-2 font-mono text-[10px] tracking-wider uppercase transition-colors focus-visible:outline focus-visible:outline-[#eac87f]',
                openTool === 'settings'
                  ? 'border-[#eac87f] bg-[#dfba73]/25 text-[#f7eedc]'
                  : 'border-white/15 bg-[#1b1c23]/85 text-[#dcd6cb] hover:border-[#dfba73]/60 hover:text-white',
              )}
            >
              <span aria-hidden>⚙</span>
              <span className="hidden xl:inline ml-1">Settings</span>
            </button>
          </div>
          <ClockControlsPill />
          <button
            type="button"
            onClick={() => setGrid(grid === 0.5 ? 1.0 : 0.5)}
            title="Toggle placement grid snap increment"
            className="hidden 2xl:inline-flex min-h-[28px] items-center rounded-[2px] border border-white/15 bg-[#1b1c23]/85 px-2.5 font-mono text-[10px] tracking-wider text-[#dcd6cb] uppercase transition-colors hover:border-[#dfba73]/60 hover:text-white"
          >
            GRID: {grid.toFixed(1)}m
          </button>
          <button
            type="button"
            onClick={() => setSnapAngle(snapAngle === 45 ? 90 : 45)}
            title="Toggle rotation snap increment"
            className="hidden 2xl:inline-flex min-h-[28px] items-center rounded-[2px] border border-white/15 bg-[#1b1c23]/85 px-2.5 font-mono text-[10px] tracking-wider text-[#dcd6cb] uppercase transition-colors hover:border-[#dfba73]/60 hover:text-white"
          >
            {snapAngle}° SNAP
          </button>
        </div>
      </header>

      {/* Top-Right Visuals Popover (HDR / ENB / Camera / Settings) */}
      {openTool && (
        <div className="pointer-events-auto absolute top-[62px] right-2 sm:right-5 z-30 w-[308px] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-82px)] overflow-y-auto scrollbar-none">
          {openTool === 'hdr' && <HdrPanel onClose={() => setOpenTool(null)} />}
          {openTool === 'graphics' && <GraphicsPanel onClose={() => setOpenTool(null)} />}
          {openTool === 'camera' && <CameraPanel onClose={() => setOpenTool(null)} />}
          {openTool === 'settings' && <SettingsPanel onClose={() => setOpenTool(null)} />}
        </div>
      )}

      {/* Single-Tab Station Partial HUD (or Presets) */}
      <StationPartialHud
        manifest={manifest}
        station={activeStation}
        presetsOpen={presetsOpen}
        onClose={closeOverlay}
      />

      {/* Left Catalog & Blueprint Panel (hidden while a station/preset overlay is open) */}
      {panelOpen && !overlayActive && (
        <div className="pointer-events-none absolute top-[62px] left-2 sm:left-5 z-20">
          <BuilderPanel />
        </div>
      )}

      {/* Selected interactive station quick-action in DECORATE mode */}
      {mode === 'decorate' && !overlayActive && selectedItem && selectedStationMeta && (
        <div className="pointer-events-none absolute top-[64px] left-1/2 -translate-x-1/2 z-20">
          <button
            type="button"
            onClick={() => activateStationForItem(selectedItem)}
            className="pointer-events-auto flex min-h-[34px] items-center gap-2 rounded-[2px] border border-[#eac87f] bg-[#1a1914]/92 px-3 py-1.5 text-[11px] font-mono tracking-wider text-[#f7eedc] uppercase shadow-[0_0_16px_rgba(234,200,127,0.3)] hover:bg-[#dfba73]/25"
          >
            <span className="rounded-[2px] border border-[#dfba73] bg-[#dfba73]/25 px-1.5 py-0.5 text-[10px] font-bold text-[#eac87f]">
              E
            </span>
            <span>{selectedStationMeta.label}</span>
          </button>
        </div>
      )}

      {/* Tour Mode Status Pill & Interactive Prompt Button */}
      {mode === 'tour' && !overlayActive && (
        <div className="pointer-events-none absolute top-[64px] left-4 z-20 flex flex-col gap-2">
          <div className="pointer-events-auto flex items-start justify-between gap-3 rounded-[2px] border border-[#dfba73]/35 bg-[#14151b]/85 px-3 py-2 text-[11px] font-mono text-[#e2dcd1] backdrop-blur-md">
            <div>
              <div className="text-[10px] tracking-widest text-[#eac87f] uppercase">Room Tour Active</div>
              <div className="mt-0.5 text-[10px] text-[#a7a29b]">
                Walk up to a Vanity, Mirror, Rack, Dresser, or Bed to customize
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                useCharacter.getState().setAnimationId('idle-clip');
                setMode('decorate');
              }}
              className="min-h-[24px] shrink-0 rounded-[2px] border border-[#dfba73]/45 bg-[#dfba73]/15 px-2 text-[10px] tracking-wider text-[#f2dfbe] uppercase transition-colors hover:border-[#eac87f] hover:bg-[#dfba73]/25 focus-visible:outline focus-visible:outline-[#eac87f]"
            >
              Exit Tour
            </button>
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
      {!overlayActive && <RoomLifeNeedsCard />}

      {/* Toast Notification Pill */}
      {toast && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-12 left-1/2 -translate-x-1/2 z-40 rounded-[2px] border border-[#dfba73]/50 bg-[#14151b]/92 px-3.5 py-1.5 text-[11px] font-mono tracking-wider text-[#f5ecd8] shadow-lg backdrop-blur-md"
        >
          {toast}
        </div>
      )}

      {/* Bottom Keyboard Hints */}
      {!overlayActive && (
        <BottomBar
          mode={mode}
          hasSelection={Boolean(selectedItemId)}
          hasGhost={Boolean(ghostCatalogId)}
          hasNearbyInteract={Boolean(nearbyInteract)}
          selectedInteractLabel={selectedStationMeta?.label ?? null}
        />
      )}
    </div>
  );
}
