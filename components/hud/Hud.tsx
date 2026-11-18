'use client';

import { useEffect, useRef, useState } from 'react';
import { TopBar } from '@/components/hud/TopBar';
import { LeftPanel } from '@/components/hud/LeftPanel';
import { RightPanel } from '@/components/hud/RightPanel';
import { Footer } from '@/components/hud/Footer';
import { AssetPanel } from '@/components/hud/AssetPanel';
import { HdrPanel } from '@/components/hud/HdrPanel';
import { GraphicsPanel } from '@/components/hud/GraphicsPanel';
import { CameraPanel } from '@/components/hud/CameraPanel';
import { PosePanel } from '@/components/hud/PosePanel';
import { BodyProperties } from '@/components/hud/BodyProperties';
import { SettingsPanel } from '@/components/hud/SettingsPanel';
import { WardrobeDrawer } from '@/components/hud/WardrobeDrawer';
import { BrowProperties } from '@/components/hud/BrowProperties';
import { HairProperties } from '@/components/hud/HairProperties';
import { SkinProperties } from '@/components/hud/SkinProperties';
import { MakeupProperties } from '@/components/hud/MakeupProperties';
import { GizmoTooltip } from '@/components/hud/GizmoTooltip';
import {
  IconAlbum,
  IconCamera,
  IconChevronLeft,
  IconEye,
  IconGear,
  IconMove,
  IconPose,
} from '@/components/hud/Icons';
import { useCharacter, type Workspace } from '@/lib/store';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

interface HudProps {
  manifest: Mo2Manifest | null;
}

/** Below this the docked rails become edge drawers. Mirrors Tailwind's `lg`. */
const NARROW = 1024;

/**
 * Full-bleed overlay above the canvas. The shell is inert
 * (pointer-events-none) so the 3D viewport keeps LMB/RMB/scroll; each control
 * cluster re-enables pointer events for itself.
 *
 * The old layer scaled a fixed 1024 × 572 metric to the window, which made a
 * large monitor render 7 px labels and a small one render everything off the
 * edge. The HUD is now a fluid layout: fixed header and action bar, a docked
 * left workspace rail and an independent right properties rail. Every panel
 * stays mounted and is only hidden, so filters, scroll positions and draft
 * edits survive a workspace switch. Under 1024 px both rails become edge
 * drawers instead of shrinking the type any further.
 */
export function Hud({ manifest }: HudProps) {
  const workspace = useCharacter((s) => s.workspace);
  const setWorkspace = useCharacter((s) => s.setWorkspace);
  const previewMode = useCharacter((s) => s.previewMode);
  const setPreviewMode = useCharacter((s) => s.setPreviewMode);
  const chrome = !previewMode;
  const primaryTab = useCharacter((s) => s.primaryTab);
  const subTab = useCharacter((s) => s.subTab);
  const isDedicatedTab = primaryTab === 'EQUIPMENT' || primaryTab === 'BODY' || primaryTab === 'PRESET' || primaryTab === 'HAIR' || primaryTab === 'FACE';
  const isBrowsTab = primaryTab === 'FACE' && subTab === 'BROWS';
  const isHairTab = primaryTab === 'HAIR';
  const isSkinTab = primaryTab === 'FACE' && subTab === 'SKIN';
  const isMakeupTab = primaryTab === 'FACE' && subTab === 'MAKEUP';
  const isDualStudioTab = isBrowsTab || isHairTab || isSkinTab || isMakeupTab;
  const isStudioLeftTab = isDualStudioTab || primaryTab === 'BODY' || (primaryTab === 'FACE' && subTab === 'EYES');
  const isRightDrawerActive = chrome && (workspace !== 'edit' || isDualStudioTab);
  const toast = useCharacter((s) => s.toast);
  const rightTitle = workspace === 'hdr' ? 'HDR ENVIRONMENT LIGHTING' : isBrowsTab
    ? 'BROW COLOR & PROPERTIES'
    : isHairTab
      ? 'HAIR COLOR & PROPERTIES'
      : isSkinTab
        ? 'SKIN COLOR & PROPERTIES'
        : isMakeupTab
          ? 'MAKEUP & TINT'
          : workspace === 'camera'
      ? 'CAMERA STUDIO'
      : workspace === 'graphics'
        ? 'GRAPHICS & SHADERS'
        : workspace === 'poses'
          ? 'POSES & ANIMATIONS'
          : workspace === 'physics'
            ? 'BODY WEIGHT & PHYSICS'
            : workspace === 'sculpt'
              ? '3D FACE SCULPT CONTROLLER'
              : workspace === 'settings'
                ? 'SETTINGS & MOD PREFERENCES'
                : workspace === 'assets'
                  ? `${subTab} ASSET BROWSER`
                  : workspace === 'wardrobe'
                    ? 'WARDROBE & EQUIPMENT BROWSER'
                    : 'TOOL DRAWER';

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const leftTrigger = useRef<HTMLButtonElement>(null);
  const rightTrigger = useRef<HTMLButtonElement>(null);

  const closeRightDrawer = () => {
    setRightOpen(false);
    setWorkspace('edit');
  };
  /* Only a deliberate workspace switch moves focus into the rail. Mounting the
     HUD or leaving preview must never pull focus off whatever had it. */
  const pendingFocus = useRef(false);

  /* Track the breakpoint in JS: drawers need a real open/closed state for
     focus management and inertness, while the rails stay mounted either way. */
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW - 1}px)`);
    const apply = () => {
      if (mq.matches) {
        setLeftOpen(false);
        setRightOpen(false);
      } else {
        setLeftOpen(true);
        setRightOpen(true);
      }
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (isDualStudioTab) {
      setLeftOpen(true);
      setRightOpen(true);
    } else if (workspace !== 'edit') {
      setRightOpen(true);
    }
  }, [workspace, isDualStudioTab]);

  /* Nonmodal drawers return focus to the workspace that opened them. Escape
     follows focus context first, so a drawer is closable from anywhere and is
     never a dead key when both rails happen to be open. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (previewMode) {
        setPreviewMode(false);
      } else if (workspace !== 'edit') {
        setWorkspace('edit');
        setRightOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewMode, setPreviewMode, workspace, setWorkspace]);

  const openWorkspace = (id: Workspace) => {
    setWorkspace(id);
    setLeftOpen(true);
  };

  /* Close a rail and hand focus to its trigger — on desktop too, where the
     trigger is a dock button rather than the only way back in. */
  const closeLeft = () => {
    setLeftOpen(false);
    requestAnimationFrame(() => leftTrigger.current?.focus());
  };

  const closeRight = () => {
    setRightOpen(false);
    requestAnimationFrame(() => rightTrigger.current?.focus());
  };

  const openRight = () => {
    setRightOpen(true);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('#hud-right-rail button, #hud-right-rail input, #hud-right-rail [tabindex]')
        ?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    if (!pendingFocus.current || !chrome || !leftOpen) return;
    pendingFocus.current = false;
    document
      .querySelector<HTMLElement>(`#hud-left-rail [data-workspace="${workspace}"] button, #hud-left-rail [data-workspace="${workspace}"] input`)
      ?.focus({ preventScroll: true });
  }, [workspace, leftOpen, chrome]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* cinematic edge falloff */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_46%,transparent_38%,rgba(0,0,0,0.42)_100%)]" />

      {chrome && <TopBar manifest={manifest} />}

      {/* ── left rail: always shows LeftPanel flush-left ────── */}
      <aside
        id="hud-left-rail"
        aria-label="Creation workspace"
        aria-hidden={!leftOpen || !chrome}
        inert={!leftOpen || !chrome}
        className={cn(
          'pointer-events-auto fixed bottom-[96px] left-[16px] top-[84px] z-50 flex w-[min(calc(100vw-76px),340px)] select-none flex-col border-r border-[#d4b483]/25 bg-[#0a0907]/94 shadow-[0_18px_44px_rgba(0,0,0,0.55)] backdrop-blur-xl transition-transform duration-300 motion-reduce:transition-none',
          'lg:bottom-[72px] lg:left-[20px] lg:top-[84px] lg:z-30 lg:w-[290px] lg:border lg:border-[#d4b483]/22 lg:bg-[#0a0907]/82 lg:shadow-[0_14px_38px_rgba(0,0,0,0.42)]',
          leftOpen && chrome ? 'translate-x-0' : 'invisible -translate-x-[130%]',
          isStudioLeftTab && '!left-[20px] !top-[84px] !w-[276px] lg:!left-[20px] lg:!top-[84px] lg:!w-[276px] !bg-transparent !border-0 !shadow-none !backdrop-blur-none',
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto thin-scroll">
          <LeftPanel manifest={manifest} />
        </div>
      </aside>

      {/* ── right studio drawer: universal floating studio card for tools and properties ────── */}
      {chrome && (
        <aside
          id="hud-right-rail"
          aria-label={rightTitle}
          aria-hidden={!rightOpen || !isRightDrawerActive}
          inert={!rightOpen || !isRightDrawerActive}
          className={cn(
            'pointer-events-auto fixed right-[20px] top-[84px] z-50 flex w-[276px] select-none flex-col',
            'bg-transparent border-0 shadow-none backdrop-blur-none transition-all duration-300 motion-reduce:transition-none',
            rightOpen && isRightDrawerActive ? 'translate-x-0' : 'invisible translate-x-[120%]',
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto thin-scroll">
            {workspace === 'hdr' ? (
              <HdrPanel onClose={closeRightDrawer} />
            ) : isBrowsTab ? (
              <BrowProperties />
            ) : isHairTab ? (
              <HairProperties />
            ) : isSkinTab ? (
              <SkinProperties />
            ) : isMakeupTab ? (
              <MakeupProperties />
            ) : (
              <>
                {workspace === 'poses' && <PosePanel onClose={closeRightDrawer} />}
                {workspace === 'camera' && <CameraPanel onClose={closeRightDrawer} />}
                {workspace === 'graphics' && <GraphicsPanel onClose={closeRightDrawer} />}
                {workspace === 'physics' && <BodyProperties manifest={manifest} onClose={closeRightDrawer} />}
                {workspace === 'sculpt' && <RightPanel manifest={manifest} onClose={closeRightDrawer} />}
                {workspace === 'settings' && <SettingsPanel onClose={closeRightDrawer} />}
                {workspace === 'assets' && <AssetPanel manifest={manifest} active={true} onClose={closeRightDrawer} />}
                {workspace === 'wardrobe' && <WardrobeDrawer manifest={manifest} onClose={closeRightDrawer} />}
              </>
            )}
          </div>
        </aside>
      )}

      {chrome && <Footer manifest={manifest} />}

      {/* Screen-space companion to the 3D gizmo; coordinates are already
          canvas pixels, so no layer scale is applied. */}
      {chrome && <GizmoTooltip />}

      {/* ── ambient studio HUD feedback toast ──────────────────────── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-[72px] right-[24px] z-[70] flex items-center gap-2 rounded-full border border-[#eac87f]/50 bg-[#16120e]/95 px-3.5 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.7)] backdrop-blur-md transition-all duration-200"
        >
          <span className="text-[12px] text-[#eac87f] drop-shadow-[0_0_6px_rgba(234,200,127,0.8)]">✧</span>
          <span className="text-[10px] font-mono tracking-wider text-[#f2dfbe]">
            {toast}
          </span>
        </div>
      )}
    </div>
  );
}
