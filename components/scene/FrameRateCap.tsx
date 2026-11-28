'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useGraphicsSettings } from '@/lib/graphicsSettings';

/**
 * Drives R3F's `advance(now)` loop at a capped frame rate (`maxFps`, or `0` for
 * unlimited) when `<Canvas frameloop="never">` is used, preventing 144–240 Hz
 * displays from saturating GPU/CPU thermal headroom and causing FPS drops.
 */
export function FrameRateCap({ maxFps }: { maxFps?: number }) {
  const advance = useThree((s) => s.advance);
  const storeMaxFps = useGraphicsSettings((s) => s.maxFps);
  const effectiveMaxFps = maxFps ?? storeMaxFps;

  useEffect(() => {
    const startMs = performance.now();
    let rafId = 0;
    let lastTime = startMs;
    let mounted = true;

    if (effectiveMaxFps <= 0) {
      const unlimitedLoop = (now: number) => {
        if (!mounted) return;
        rafId = window.requestAnimationFrame(unlimitedLoop);
        advance((now - startMs) / 1000);
      };
      rafId = window.requestAnimationFrame(unlimitedLoop);
      return () => {
        mounted = false;
        window.cancelAnimationFrame(rafId);
      };
    }

    const intervalMs = 1000 / effectiveMaxFps;
    const loop = (now: number) => {
      if (!mounted) return;
      rafId = window.requestAnimationFrame(loop);
      const elapsed = now - lastTime;
      // Allow a 0.5 ms jitter tolerance so 60 Hz VSync never skips alternating frames
      if (elapsed >= intervalMs - 0.5) {
        lastTime = now - (elapsed % intervalMs);
        // R3F advance(timestamp) expects seconds in frameloop="never" mode
        advance((now - startMs) / 1000);
      }
    };

    rafId = window.requestAnimationFrame(loop);
    return () => {
      mounted = false;
      window.cancelAnimationFrame(rafId);
    };
  }, [advance, effectiveMaxFps]);

  return null;
}
