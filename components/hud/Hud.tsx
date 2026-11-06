'use client';

import { TopBar } from '@/components/hud/TopBar';
import { LeftPanel } from '@/components/hud/LeftPanel';
import { RightPanel } from '@/components/hud/RightPanel';
import { Footer } from '@/components/hud/Footer';
import { AssetPanel } from '@/components/hud/AssetPanel';
import { GizmoTooltip } from '@/components/hud/GizmoTooltip';
import { HudScale } from '@/components/hud/HudScale';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

interface HudProps {
  manifest: Mo2Manifest | null;
}

/**
 * Full-bleed overlay above the canvas. The shell is inert
 * (pointer-events-none) so the 3D viewport keeps LMB/RMB/scroll; each panel
 * re-enables pointer events for its own controls.
 */
export function Hud({ manifest }: HudProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* cinematic edge falloff */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_46%,transparent_38%,rgba(0,0,0,0.42)_100%)]" />

      {/* The reference metric is 1024 × 572. Every panel is authored in that
          space and the layer is scaled to fit the real viewport, so the HUD
          keeps the reference's proportions at any window size. Scaling the
          container (not each panel) also keeps pointer targets aligned. */}
      <HudScale />
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: 'var(--hud-w, calc(100% / var(--hud-scale, 1)))',
          height: 'var(--hud-h, calc(100% / var(--hud-scale, 1)))',
          transform: 'scale(var(--hud-scale, 1))',
        }}
      >
        <TopBar manifest={manifest} />
        <LeftPanel manifest={manifest} />
        <RightPanel />
        <AssetPanel manifest={manifest} />
        <Footer manifest={manifest} />
      </div>

      {/* Screen-space companion to the 3D gizmo. It is positioned from the
          projector's output, which is already in canvas pixels, so it sits
          outside the scaled 1024 × 572 layer and applies the scale itself. */}
      <GizmoTooltip />
    </div>
  );
}
