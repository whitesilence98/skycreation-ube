'use client';

import React, { useState } from 'react';
import { useCharacter, type Workspace, type EnbPreset } from '@/lib/store';
import { useBodySlideStore } from '@/lib/bodyslide/store';
import { redoPhysique, undoPhysique } from '@/lib/bodyslide/physiqueHistory';
import { cn } from '@/lib/cn';

const ENB_LABELS: Record<EnbPreset, string> = {
  enb: 'ENB PALETTE',
  pure: 'PURE RESHADE',
  all: 'ENB + PURE',
};

/**
 * Wuxia Floating Tool Strip matching Image 2 reference design:
 * - Circular floating glass buttons along the right edge.
 * - 💡 Lighting (HDR panel toggle)
 * - 🎨 ENB & Graphics (preset indicator & graphics drawer toggle)
 * - ↶ Undo (face history back)
 * - ↷ Redo (face history forward)
 * - 👁️ Toggle HUD (preview mode toggle)
 * - 🎽 Outfit / Armor (wardrobe drawer toggle)
 * - 🧍 Poses & Stance (pose drawer toggle)
 * - 🔄 Camera Reset (re-center front face camera)
 *
 * Meets all accessibility standards: button hit target >= 36px, type="button",
 * visible focus rings, aria labels, and zero visible scrollbars.
 */
export function ToolStrip() {
  const workspace = useCharacter((s) => s.workspace);
  const setWorkspace = useCharacter((s) => s.setWorkspace);
  const previewMode = useCharacter((s) => s.previewMode);
  const setPreviewMode = useCharacter((s) => s.setPreviewMode);
  const resetCameraView = useCharacter((s) => s.resetCameraView);

  const enbEnabled = useCharacter((s) => s.enbEnabled);
  const enbPreset = useCharacter((s) => s.enbPreset);
  const setEnbPreset = useCharacter((s) => s.setEnbPreset);
  const showToast = useCharacter((s) => s.showToast);

  const primaryTab = useCharacter((s) => s.primaryTab);
  const facePast = useCharacter((s) => s.facePast);
  const faceFuture = useCharacter((s) => s.faceFuture);
  const bodyPast = useBodySlideStore((s) => s.bodyPast);
  const bodyFuture = useBodySlideStore((s) => s.bodyFuture);

  const isBodyTab = primaryTab === 'BODY';
  const [hoveredTool, setHoveredTool] = useState<string | null>(null);

  const cycleEnbPreset = (e: React.MouseEvent) => {
    e.stopPropagation();
    const presets: EnbPreset[] = ['enb', 'pure', 'all'];
    const nextIdx = (presets.indexOf(enbPreset) + 1) % presets.length;
    const nextPreset = presets[nextIdx];
    setEnbPreset(nextPreset);
    showToast(`ENB Preset: ${ENB_LABELS[nextPreset]}`);
  };

  const toggleWorkspace = (id: Workspace) => {
    setWorkspace(workspace === id ? 'edit' : id);
  };

  const handleUndo = () => {
    if (isBodyTab) {
      undoPhysique();
    } else {
      useCharacter.getState().undoFace();
      showToast('Undo');
    }
  };

  const handleRedo = () => {
    if (isBodyTab) {
      redoPhysique();
    } else {
      useCharacter.getState().redoFace();
      showToast('Redo');
    }
  };

  const canUndo = isBodyTab ? bodyPast.length > 0 : facePast.length > 0;
  const canRedo = isBodyTab ? bodyFuture.length > 0 : faceFuture.length > 0;

  return (
    <nav
      aria-label="Studio tools"
      className="pointer-events-auto fixed right-6 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-3 select-none"
    >
      {/* 1. 💡 Lighting (HDR) */}
      <div className="relative flex items-center">
        <button
          type="button"
          aria-pressed={workspace === 'hdr'}
          aria-label="Lighting and Environment"
          title="Lighting and Environment"
          onClick={() => toggleWorkspace('hdr')}
          onMouseEnter={() => setHoveredTool('hdr')}
          onMouseLeave={() => setHoveredTool(null)}
          className={cn(
            'group flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]',
            workspace === 'hdr'
              ? 'border-[#dfba73] bg-[#dfba73]/25 text-[#dfba73] shadow-[0_0_14px_rgba(223,186,115,0.4)]'
              : 'border-white/10 bg-[#1e1f26]/85 text-[#cfced4] hover:border-[#dfba73]/50 hover:bg-[#282a34] hover:text-white'
          )}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 fill-none stroke-current stroke-[1.5]"
            aria-hidden
          >
            <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-7 7c0 2.5 1.5 4.7 3.5 6h7c2-1.3 3.5-3.5 3.5-6a7 7 0 0 0-7-7z" />
          </svg>
        </button>
        {hoveredTool === 'hdr' && (
          <span className="pointer-events-none absolute right-12 z-50 whitespace-nowrap rounded border border-white/10 bg-[#1e1f26]/95 px-2.5 py-1 text-[11px] text-[#e8dcc2] shadow-xl backdrop-blur-md">
            Lighting (HDR)
          </span>
        )}
      </div>

      {/* 2. 🎨 ENB & Graphics Preset (Requested by User) */}
      <div className="relative flex items-center">
        <button
          type="button"
          aria-pressed={workspace === 'graphics'}
          aria-label={`Graphics & ENB: ${ENB_LABELS[enbPreset]}`}
          title={`Graphics & ENB: ${ENB_LABELS[enbPreset]} (Click to open, Right-click to cycle)`}
          onClick={() => toggleWorkspace('graphics')}
          onContextMenu={cycleEnbPreset}
          onMouseEnter={() => setHoveredTool('enb')}
          onMouseLeave={() => setHoveredTool(null)}
          className={cn(
            'group relative flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]',
            workspace === 'graphics'
              ? 'border-[#dfba73] bg-[#dfba73]/25 text-[#dfba73] shadow-[0_0_14px_rgba(223,186,115,0.4)]'
              : 'border-white/10 bg-[#1e1f26]/85 text-[#cfced4] hover:border-[#dfba73]/50 hover:bg-[#282a34] hover:text-white'
          )}
        >
          {/* Palette / ENB Aperture Icon */}
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 fill-none stroke-current stroke-[1.5]"
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3a9 9 0 0 1 9 9c0 3-2 5-4 5h-2a2 2 0 0 0-2 2c0 1.1-.9 2-2 2a9 9 0 0 1-1-18z" />
            <circle cx="8" cy="9" r="1.2" fill="currentColor" />
            <circle cx="12" cy="7" r="1.2" fill="currentColor" />
            <circle cx="16" cy="9" r="1.2" fill="currentColor" />
          </svg>
          {/* Active ENB Status Dot */}
          {enbEnabled && (
            <span
              className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-[#dfba73] ring-2 ring-[#1e1f26]"
              aria-hidden
            />
          )}
        </button>
        {hoveredTool === 'enb' && (
          <span className="pointer-events-none absolute right-12 z-50 flex items-center gap-1.5 whitespace-nowrap rounded border border-white/10 bg-[#1e1f26]/95 px-2.5 py-1 text-[11px] text-[#e8dcc2] shadow-xl backdrop-blur-md">
            <span>ENB Preset:</span>
            <span className="font-semibold text-[#dfba73]">
              {ENB_LABELS[enbPreset]}
            </span>
          </span>
        )}
      </div>

      {/* 3. ↶ Undo */}
      <div className="relative flex items-center">
        <button
          type="button"
          aria-label="Undo face adjustment (Ctrl+Z)"
          title="Undo face adjustment (Ctrl+Z)"
          onClick={handleUndo}
          disabled={!canUndo}
          onMouseEnter={() => setHoveredTool('undo')}
          onMouseLeave={() => setHoveredTool(null)}
          className={cn(
            'group flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]',
            canUndo
              ? 'border-white/10 bg-[#1e1f26]/85 text-[#cfced4] hover:border-[#dfba73]/50 hover:bg-[#282a34] hover:text-white'
              : 'border-white/5 bg-[#1e1f26]/40 text-[#605e66] cursor-not-allowed opacity-60'
          )}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 fill-none stroke-current stroke-[1.6]"
            aria-hidden
          >
            <path d="M4 8v6h6" strokeLinecap="round" strokeLinejoin="round" />
            <path
              d="M4 14a8 8 0 1 0 2.4-5.7L4 10"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {hoveredTool === 'undo' && (
          <span className="pointer-events-none absolute right-12 z-50 whitespace-nowrap rounded border border-white/10 bg-[#1e1f26]/95 px-2.5 py-1 text-[11px] text-[#e8dcc2] shadow-xl backdrop-blur-md">
            Undo (Ctrl+Z)
          </span>
        )}
      </div>

      {/* 4. ↷ Redo */}
      <div className="relative flex items-center">
        <button
          type="button"
          aria-label="Redo face adjustment (Ctrl+Y)"
          title="Redo face adjustment (Ctrl+Y)"
          onClick={handleRedo}
          disabled={!canRedo}
          onMouseEnter={() => setHoveredTool('redo')}
          onMouseLeave={() => setHoveredTool(null)}
          className={cn(
            'group flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]',
            canRedo
              ? 'border-white/10 bg-[#1e1f26]/85 text-[#cfced4] hover:border-[#dfba73]/50 hover:bg-[#282a34] hover:text-white'
              : 'border-white/5 bg-[#1e1f26]/40 text-[#605e66] cursor-not-allowed opacity-60'
          )}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 fill-none stroke-current stroke-[1.6]"
            aria-hidden
          >
            <path d="M20 8v6h-6" strokeLinecap="round" strokeLinejoin="round" />
            <path
              d="M20 14a8 8 0 1 1-2.4-5.7L20 10"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {hoveredTool === 'redo' && (
          <span className="pointer-events-none absolute right-12 z-50 whitespace-nowrap rounded border border-white/10 bg-[#1e1f26]/95 px-2.5 py-1 text-[11px] text-[#e8dcc2] shadow-xl backdrop-blur-md">
            Redo (Ctrl+Y)
          </span>
        )}
      </div>

      {/* 5. 👁️ Toggle HUD / View Mode */}
      <div className="relative flex items-center">
        <button
          type="button"
          aria-pressed={previewMode}
          aria-label="Toggle Interface Visibility"
          title="Toggle Interface Visibility"
          onClick={() => setPreviewMode(!previewMode)}
          onMouseEnter={() => setHoveredTool('view')}
          onMouseLeave={() => setHoveredTool(null)}
          className={cn(
            'group flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]',
            previewMode
              ? 'border-[#dfba73] bg-[#dfba73]/25 text-[#dfba73] shadow-[0_0_14px_rgba(223,186,115,0.4)]'
              : 'border-white/10 bg-[#1e1f26]/85 text-[#cfced4] hover:border-[#dfba73]/50 hover:bg-[#282a34] hover:text-white'
          )}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 fill-none stroke-current stroke-[1.5]"
            aria-hidden
          >
            <path
              d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3" />
            <line
              x1="3"
              y1="3"
              x2="21"
              y2="21"
              strokeLinecap="round"
              className="opacity-70"
            />
          </svg>
        </button>
        {hoveredTool === 'view' && (
          <span className="pointer-events-none absolute right-12 z-50 whitespace-nowrap rounded border border-white/10 bg-[#1e1f26]/95 px-2.5 py-1 text-[11px] text-[#e8dcc2] shadow-xl backdrop-blur-md">
            Toggle UI Visibility
          </span>
        )}
      </div>

      {/* 7. 🧍 Poses & Stance */}
      <div className="relative flex items-center">
        <button
          type="button"
          aria-pressed={workspace === 'poses'}
          aria-label="Poses and Animation"
          title="Poses and Animation"
          onClick={() => toggleWorkspace('poses')}
          onMouseEnter={() => setHoveredTool('poses')}
          onMouseLeave={() => setHoveredTool(null)}
          className={cn(
            'group flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]',
            workspace === 'poses'
              ? 'border-[#dfba73] bg-[#dfba73]/25 text-[#dfba73] shadow-[0_0_14px_rgba(223,186,115,0.4)]'
              : 'border-white/10 bg-[#1e1f26]/85 text-[#cfced4] hover:border-[#dfba73]/50 hover:bg-[#282a34] hover:text-white'
          )}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 fill-none stroke-current stroke-[1.5]"
            aria-hidden
          >
            <circle cx="12" cy="4" r="2" />
            <path
              d="M12 6v8M9 9l3-1 3 1M10 20l2-6 2 6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {hoveredTool === 'poses' && (
          <span className="pointer-events-none absolute right-12 z-50 whitespace-nowrap rounded border border-white/10 bg-[#1e1f26]/95 px-2.5 py-1 text-[11px] text-[#e8dcc2] shadow-xl backdrop-blur-md">
            Poses & Animation
          </span>
        )}
      </div>

      {/* 8. 📷 Camera & Framing */}
      <div className="relative flex items-center">
        <button
          type="button"
          aria-pressed={workspace === 'camera'}
          aria-label="Camera and Framing"
          title="Camera & Framing Settings"
          onClick={() => toggleWorkspace('camera')}
          onMouseEnter={() => setHoveredTool('camera')}
          onMouseLeave={() => setHoveredTool(null)}
          className={cn(
            'group flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]',
            workspace === 'camera'
              ? 'border-[#dfba73] bg-[#dfba73]/25 text-[#dfba73] shadow-[0_0_14px_rgba(223,186,115,0.4)]'
              : 'border-white/10 bg-[#1e1f26]/85 text-[#cfced4] hover:border-[#dfba73]/50 hover:bg-[#282a34] hover:text-white'
          )}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 fill-none stroke-current stroke-[1.5]"
            aria-hidden
          >
            <path
              d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
        {hoveredTool === 'camera' && (
          <span className="pointer-events-none absolute right-12 z-50 whitespace-nowrap rounded border border-white/10 bg-[#1e1f26]/95 px-2.5 py-1 text-[11px] text-[#e8dcc2] shadow-xl backdrop-blur-md">
            Camera & Framing
          </span>
        )}
      </div>
    </nav>
  );
}
