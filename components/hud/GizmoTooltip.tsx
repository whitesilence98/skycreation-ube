'use client';

import { useCharacter } from '@/lib/store';
import { useGizmoTip } from '@/lib/gizmoTip';
import { REGIONS_BY_ID } from '@/lib/regions';

/**
 * Floating dark tooltip that rides the active facial bone: a short gold rule,
 * the selected region, and the current transform mode.
 *
 * It lives in the HUD layer rather than inside the R3F canvas because the
 * label is DOM and react-three-fiber's reconciler only accepts three objects.
 * `FaceGizmo` writes the projected bone anchor into `useGizmoTip` each frame;
 * this reads it back. Coordinates are canvas-relative CSS pixels, so the
 * element is placed outside the scaled HUD layer and carries `--hud-scale`
 * itself to keep the type at the same weight as the rest of the HUD.
 */
export function GizmoTooltip() {
  const x = useGizmoTip((s) => s.x);
  const y = useGizmoTip((s) => s.y);
  const visible = useGizmoTip((s) => s.visible);
  const activeRegion = useCharacter((s) => s.activeRegion);
  const mode = useCharacter((s) => s.transformMode);

  if (!visible) return null;

  const label =
    activeRegion === 'nose' ? 'NOSE [Selected]' : `${REGIONS_BY_ID[activeRegion].short} [Selected]`;

  return (
    <div
      className="pointer-events-none absolute z-20 flex items-center whitespace-nowrap"
      style={{
        left: x,
        top: y,
        transform: 'translate(0,-50%) scale(var(--hud-scale, 1))',
        transformOrigin: 'left center',
      }}
    >
      <div className="h-px w-6 bg-[#d4b483]/45" />
      <div className="tooltip-dark px-2 py-[5px] text-[9px] leading-[1.35] tracking-[0.14em] text-[#cfc6b4]">
        <div className="flex items-center gap-1">
          <span className="inline-block h-[3px] w-[3px] rounded-full bg-[#d4b483]" />
          <span className="text-[#e4d8c2]">{label}</span>
        </div>
        <div className="pl-[7px] uppercase text-[#9c9384]">{mode.toUpperCase()}</div>
      </div>
    </div>
  );
}
