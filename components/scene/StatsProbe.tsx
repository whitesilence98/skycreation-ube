'use client';

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRenderStats } from '@/lib/perf';

/**
 * Publishes FPS and per-frame draw counts for the graphics panel.
 *
 * `gl.info.autoReset` is switched off in `Canvas.onCreated`: three would
 * otherwise reset the counters on every internal `render` call, and the
 * composer issues several per frame. With it off the counters are window
 * totals, so they are divided by the number of frames actually drawn before
 * being published. The probe runs after the composer's render priority.
 */
export function StatsProbe({ priority = 3 }: { priority?: number }) {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ frames: 0, seconds: 0 });

  useFrame((_, dt) => {
    const a = acc.current;
    a.frames += 1;
    /* A backgrounded tab can hand back a multi-second delta; clamping keeps a
       single resume frame from collapsing the FPS readout. */
    a.seconds += Math.min(dt, 0.25);
    if (a.seconds < 0.5) return;

    const info = gl.info;
    useRenderStats.getState().set({
      fps: Math.max(1, Math.round(a.frames / a.seconds)),
      calls: Math.round(info.render.calls / Math.max(1, a.frames)),
      tris: Math.round(info.render.triangles / Math.max(1, a.frames)),
      textures: info.memory.textures,
    });
    a.frames = 0;
    a.seconds = 0;
    info.reset();
  }, priority);

  return null;
}
