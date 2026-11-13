'use client';

import { useEffect, useRef, useState } from 'react';
import { TopBar } from '@/components/hud/TopBar';
import { LeftPanel } from '@/components/hud/LeftPanel';
import { RightPanel } from '@/components/hud/RightPanel';
import { Footer } from '@/components/hud/Footer';
import { AssetPanel } from '@/components/hud/AssetPanel';
import { GraphicsPanel } from '@/components/hud/GraphicsPanel';
import { CameraPanel } from '@/components/hud/CameraPanel';
import { PosePanel } from '@/components/hud/PosePanel';
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

const WORKSPACES: Array<{ id: Workspace; label: string; Icon: (p: { className?: string }) => React.JSX.Element }> = [
  { id: 'edit', label: 'EDIT', Icon: IconMove },
  { id: 'assets', label: 'ASSETS', Icon: IconAlbum },
  { id: 'camera', label: 'CAMERA', Icon: IconCamera },
  { id: 'graphics', label: 'GRAPHICS', Icon: IconGear },
];

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
  const hasProperties = primaryTab === 'HAIR' || primaryTab === 'FACE SHAPE' || (primaryTab === 'FACE' && subTab === 'MAKEUP') || primaryTab === 'BODY';

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const leftTrigger = useRef<HTMLButtonElement>(null);
  const rightTrigger = useRef<HTMLButtonElement>(null);
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

  /* Nonmodal drawers return focus to the workspace that opened them. Escape
     follows focus context first, so a drawer is closable from anywhere and is
     never a dead key when both rails happen to be open. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const active = document.activeElement;
      if (previewMode) {
        setPreviewMode(false);
      } else if (active?.closest('#hud-right-rail')) {
        setRightOpen(false);
        requestAnimationFrame(() => rightTrigger.current?.focus());
      } else if (leftOpen && workspace !== 'poses') {
        setLeftOpen(false);
        requestAnimationFrame(() => leftTrigger.current?.focus());
      } else if (rightOpen && (hasProperties || workspace === 'poses')) {
        setRightOpen(false);
        requestAnimationFrame(() => rightTrigger.current?.focus());
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewMode, setPreviewMode, leftOpen, rightOpen, hasProperties, workspace]);

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

      {/* ── left workspace dock ─────────────────────────────────────── */}
      <div className={cn(
        "pointer-events-auto fixed left-2 top-[112px] z-[60] flex flex-col gap-1 lg:top-[104px]",
        (primaryTab === 'EQUIPMENT' || primaryTab === 'BODY' || primaryTab === 'PRESET') && 'opacity-0 pointer-events-none'
      )}>
        {chrome && WORKSPACES.map(({ id, label, Icon }) => {
          const active = workspace === id && leftOpen;
          return (
            <button
              key={id}
              ref={(node) => { if (workspace === id) leftTrigger.current = node; }}
              type="button"
              onClick={(event) => {
                leftTrigger.current = event.currentTarget;
                if (leftOpen && workspace === id) {
                  setLeftOpen(false);
                  return;
                }
                pendingFocus.current = true;
                openWorkspace(id);
              }}
              aria-expanded={leftOpen && workspace === id}
              aria-controls="hud-left-rail"
              aria-label={`${label} workspace`}
              title={`${label} workspace`}
              className={cn(
                'flex w-[46px] flex-col items-center gap-[2px] border px-[2px] py-[5px] text-[10px] tracking-[0.08em] backdrop-blur-[6px] transition-colors duration-200 hud-focus',
                active
                  ? 'border-[#d4b483]/78 bg-[#d4b483]/16 text-[#f0dfb9] shadow-[0_0_12px_rgba(212,180,131,0.22)]'
                  : 'border-[#d4b483]/30 bg-black/46 text-[#c3b698]/85 hover:border-[#d4b483]/62 hover:text-[#f0e6d4]',
              )}
            >
              <Icon className="h-[15px] w-[15px]" />
              <span className="leading-none">{label}</span>
            </button>
          );
        })}
        <span className="my-[2px] h-px w-full bg-[#d4b483]/24" />
        <button
          type="button"
          onClick={() => setPreviewMode(!previewMode)}
          aria-pressed={previewMode}
          aria-label={previewMode ? 'Exit preview' : 'Hide interface preview'}
          title={previewMode ? 'Exit preview (Esc)' : 'Hide the interface'}
          className={cn(
            'flex w-[46px] flex-col items-center gap-[2px] border px-[2px] py-[5px] text-[10px] tracking-[0.08em] backdrop-blur-[6px] transition-colors duration-200 hud-focus',
            previewMode
              ? 'border-[#c9a86a]/60 bg-[#c9a86a]/14 text-[#f0dfb9]'
              : 'border-[#d4b483]/30 bg-black/46 text-[#c3b698]/85 hover:border-[#d4b483]/62 hover:text-[#f0e6d4]',
          )}
        >
          <IconEye className="h-[15px] w-[15px]" />
          <span className="leading-none">VIEW</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (workspace === 'poses' && rightOpen) {
              setRightOpen(false);
            } else {
              setWorkspace('poses');
              setLeftOpen(false);
              setRightOpen(true);
            }
          }}
          aria-expanded={workspace === 'poses' && rightOpen}
          aria-controls="hud-right-rail"
          aria-label="Poses workspace"
          title="Poses & Animations"
          className={cn(
            'flex w-[46px] flex-col items-center gap-[2px] border px-[2px] py-[5px] text-[10px] tracking-[0.08em] backdrop-blur-[6px] transition-colors duration-200 hud-focus',
            workspace === 'poses' && rightOpen
              ? 'border-[#d4b483]/78 bg-[#d4b483]/16 text-[#f0dfb9] shadow-[0_0_12px_rgba(212,180,131,0.22)]'
              : 'border-[#d4b483]/30 bg-black/46 text-[#c3b698]/85 hover:border-[#d4b483]/62 hover:text-[#f0e6d4]',
          )}
        >
          <IconPose className="h-[15px] w-[15px]" />
          <span className="leading-none">POSES</span>
        </button>
      </div>

      {/* ── left rail: one workspace at a time, all four mounted ────── */}
      <aside
        id="hud-left-rail"
        aria-label="Edit workspace"
        aria-hidden={!leftOpen || !chrome || workspace === 'poses'}
        inert={!leftOpen || !chrome || workspace === 'poses'}
        className={cn(
          'pointer-events-auto fixed bottom-[96px] left-[60px] top-[108px] z-50 flex w-[min(calc(100vw-76px),340px)] select-none flex-col border-r border-[#d4b483]/25 bg-[#0a0907]/94 shadow-[0_18px_44px_rgba(0,0,0,0.55)] backdrop-blur-xl transition-transform duration-300 motion-reduce:transition-none',
          'lg:bottom-[72px] lg:left-[60px] lg:top-[96px] lg:z-30 lg:w-[290px] lg:border lg:border-[#d4b483]/22 lg:bg-[#0a0907]/82 lg:shadow-[0_14px_38px_rgba(0,0,0,0.42)]',
          (primaryTab === 'EQUIPMENT' || primaryTab === 'BODY' || primaryTab === 'PRESET') && '!left-[16px] lg:!left-[24px]',
          leftOpen && chrome && workspace !== 'poses' ? 'translate-x-0' : 'invisible -translate-x-[130%]',
        )}
      >
        {!(primaryTab === 'EQUIPMENT' || primaryTab === 'BODY' || primaryTab === 'PRESET') && (
          <div className="flex shrink-0 items-center justify-between border-b border-[#d4b483]/18 px-[12px] py-[9px]">
            <span className="text-[10px] tracking-[0.16em] text-[#d8c39c]">
              {WORKSPACES.find((w) => w.id === workspace)?.label ?? 'EDIT'} WORKSPACE
            </span>
            <button
              type="button"
              onClick={closeLeft}
              aria-label="Collapse left workspace"
              title="Collapse workspace"
              className="flex h-[22px] w-[22px] items-center justify-center border border-[#d4b483]/28 text-[#c3b698]/85 transition-colors hover:border-[#d4b483]/60 hover:text-[#f0e6d4] hud-focus"
            >
              <IconChevronLeft className="h-[10px] w-[10px]" />
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          <div data-workspace="edit" className={cn('min-h-0 flex-1 overflow-y-auto thin-scroll', workspace !== 'edit' && 'hidden')}>
            <LeftPanel manifest={manifest} />
          </div>
          <div data-workspace="assets" className={cn('min-h-0 flex-1 overflow-hidden', workspace !== 'assets' && 'hidden')}>
            <AssetPanel manifest={manifest} active={workspace === 'assets' && leftOpen} />
          </div>
          <div data-workspace="camera" className={cn('min-h-0 flex-1 overflow-y-auto thin-scroll', workspace !== 'camera' && 'hidden')}>
            <CameraPanel />
          </div>
          <div data-workspace="graphics" className={cn('min-h-0 flex-1 overflow-y-auto thin-scroll', workspace !== 'graphics' && 'hidden')}>
            <GraphicsPanel />
          </div>
        </div>
      </aside>

      {(hasProperties || workspace === 'poses') && (
        <aside
          id="hud-right-rail"
          aria-label={workspace === 'poses' ? 'Poses' : 'Properties'}
          aria-hidden={!rightOpen || !chrome}
          inert={!rightOpen || !chrome}
          className={cn(
            'pointer-events-auto fixed bottom-[96px] right-2 top-[108px] z-50 flex select-none flex-col border-l border-[#d4b483]/25 bg-[#0a0907]/94 shadow-[0_18px_44px_rgba(0,0,0,0.55)] backdrop-blur-xl transition-all duration-300 motion-reduce:transition-none',
            workspace === 'poses'
              ? 'w-[min(calc(100vw-76px),380px)] lg:bottom-[72px] lg:top-[96px] lg:z-30 lg:w-[380px] lg:border lg:border-[#d4b483]/22 lg:bg-[#0a0907]/88 lg:shadow-[0_14px_38px_rgba(0,0,0,0.42)]'
              : 'w-[min(calc(100vw-76px),340px)] lg:bottom-[72px] lg:top-[96px] lg:z-30 lg:w-[274px] lg:border lg:border-[#d4b483]/22 lg:bg-[#0a0907]/82 lg:shadow-[0_14px_38px_rgba(0,0,0,0.42)]',
            rightOpen && chrome ? 'translate-x-0' : 'invisible translate-x-[110%]',
          )}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-[#d4b483]/18 px-[12px] py-[9px]">
            <span className="text-[10px] tracking-[0.16em] text-[#d8c39c]">
              {workspace === 'poses' ? 'POSES' : 'PROPERTIES'}
            </span>
            <button
              type="button"
              onClick={closeRight}
              aria-label={workspace === 'poses' ? 'Collapse poses rail' : 'Collapse properties rail'}
              title={workspace === 'poses' ? 'Collapse poses' : 'Collapse properties'}
              className="flex h-[22px] w-[22px] items-center justify-center border border-[#d4b483]/28 text-[#c3b698]/85 transition-colors hover:border-[#d4b483]/60 hover:text-[#f0e6d4] hud-focus"
            >
              <IconChevronLeft className="h-[10px] w-[10px] rotate-180" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto thin-scroll">
            {workspace === 'poses' ? <PosePanel /> : <RightPanel manifest={manifest} />}
          </div>
        </aside>
      )}

      {/* Reopen the properties / poses rail. Sits at the edge so it never competes
          with the viewport while the rail is open. */}
      {chrome && (hasProperties || workspace === 'poses') && !rightOpen && (
        <button
          ref={rightTrigger}
          type="button"
          onClick={openRight}
          aria-expanded={rightOpen}
          aria-controls="hud-right-rail"
          aria-label={workspace === 'poses' ? 'Open poses rail' : 'Open properties rail'}
          title={workspace === 'poses' ? 'Poses' : 'Properties'}
          className="pointer-events-auto fixed right-0 top-1/2 z-40 flex h-[92px] w-[26px] -translate-y-1/2 items-center justify-center border border-r-0 border-[#d4b483]/38 bg-black/52 text-[#e2cba0]/85 backdrop-blur-[6px] transition-colors hover:border-[#d4b483]/70 hover:text-[#f4e8cc] hud-focus"
        >
          <span className="rotate-180 text-[10px] tracking-[0.16em] [writing-mode:vertical-rl]">
            {workspace === 'poses' ? 'POSES' : 'PROPERTIES'}
          </span>
        </button>
      )}

      {chrome && <Footer manifest={manifest} />}

      {/* Screen-space companion to the 3D gizmo; coordinates are already
          canvas pixels, so no layer scale is applied. */}
      {chrome && <GizmoTooltip />}
    </div>
  );
}
