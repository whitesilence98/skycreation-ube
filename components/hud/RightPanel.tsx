'use client';

import React from 'react';
import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { cn } from '@/lib/cn';

/** Shared handle controls; region selection and sliders live in the contextual editor. */
export function RightPanel({
  manifest: _manifest,
  onClose,
}: {
  manifest?: Mo2Manifest | null;
  onClose?: () => void;
}) {
  const mode = useCharacter((s) => s.transformMode);
  const showMesh = useCharacter((s) => s.showMesh);

  return (
    <div className="flex flex-col gap-2.5 p-3 rounded-[2px] bg-[#1a1b20]/90 border border-white/5 mb-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#9f9da6]">
          Direct 3D Handles
        </span>
        <label
          htmlFor="creator-show-mesh"
          className="flex items-center gap-1.5 cursor-pointer text-[10px] text-[#cec5b3] select-none hover:text-white transition-colors"
        >
          <input
            id="creator-show-mesh"
            type="checkbox"
            checked={showMesh}
            onChange={(e) => useCharacter.getState().setShowMesh(e.target.checked)}
            className="h-3.5 w-3.5 rounded-none border border-[#dfba73]/40 bg-black/40 text-[#dfba73] focus:ring-1 focus:ring-[#dfba73] focus:ring-offset-0 cursor-pointer"
          />
          <span>Show face mesh</span>
        </label>
      </div>

      <div
        className="grid grid-cols-3 gap-1.5"
        role="group"
        aria-label="Handle transform mode"
      >
        {(['translate', 'rotate', 'scale'] as const).map((value) => {
          const isActive = mode === value;
          const label = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[value];
          return (
            <button
              key={value}
              type="button"
              aria-pressed={isActive}
              onClick={() => useCharacter.getState().setTransformMode(value)}
              className={cn(
                'min-h-[28px] h-7 px-2 rounded-[2px] text-[11px] font-medium tracking-wide transition-all select-none',
                'focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#dfba73]',
                isActive
                  ? 'border border-[#dfba73] bg-[#dfba73]/15 text-[#dfba73] shadow-[0_0_8px_rgba(223,186,115,0.2)] font-semibold'
                  : 'border border-white/10 bg-white/5 text-[#a8a5b0] hover:border-white/20 hover:bg-white/10 hover:text-white'
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-[#75737d] leading-snug select-none">
        Handles reshape whole regions. Independent left/right sculpting is not connected yet.
      </p>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="mt-1 min-h-[24px] h-6 text-[10px] text-[#9f9da6] hover:text-white transition-colors"
        >
          Close handles
        </button>
      )}
    </div>
  );
}
