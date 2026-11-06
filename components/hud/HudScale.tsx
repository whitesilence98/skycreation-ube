'use client';

import { useEffect } from 'react';

/** Design metric the HUD is authored against (the reference screenshot). */
export const HUD_BASE = { w: 1024, h: 572 } as const;

/**
 * Publishes `--hud-scale` on the document root.
 *
 * The HUD is authored in the reference's 1024 × 572 metric. Rather than
 * re-author every panel in relative units — which would drift from the
 * reference the moment a spacing changed — the whole layer is scaled by a
 * single factor: the smaller of the horizontal and vertical fit, so the
 * layout never overflows and never letterboxes inside its own bounds.
 */
export function HudScale() {
  useEffect(() => {
    const apply = () => {
      const s = Math.min(window.innerWidth / HUD_BASE.w, window.innerHeight / HUD_BASE.h);
      document.documentElement.style.setProperty('--hud-scale', String(s));
      document.documentElement.style.setProperty('--hud-w', `${window.innerWidth / s}px`);
      document.documentElement.style.setProperty('--hud-h', `${window.innerHeight / s}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);
  return null;
}
