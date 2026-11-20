'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { useSmartSession } from '@/lib/smart/session';
import { meshModeEnabled } from '@/lib/smart/smartMode';

/**
 * The Smart Customization hotkey bar.
 *
 * Same markup vocabulary as `HairFooter` — same keycap, same left/right split,
 * same gradient — because a second visual language for a bar with the same job
 * would read as a different product.
 *
 * `Space Apply` commits and returns to the Customization screen; `Esc Return`
 * puts the head back the way it was and leaves. Both are real: a key printed on
 * the bar that does nothing is worse than no key at all.
 */

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="flex h-[18px] items-center justify-center rounded-[2px] border border-white/20 bg-[#5f5a5e]/70 px-1 font-mono text-[10px] font-medium text-[#eae5dc]"
      aria-hidden
    >
      {children}
    </span>
  );
}

export function SmartFooter() {
  const state = useCharacter.getState;
  const staged = useSmartSession(s => s.staged);
  const applied = useSmartSession(s => s.applied);
  /* The flag is URL-driven, so it can only be read after mount; reading it in
     a lazy initialiser would mismatch the server render. */
  const [dev, setDev] = useState(false);
  useEffect(() => { setDev(meshModeEnabled()); }, []);

  const apply = useCallback(() => {
    const session = useSmartSession.getState();
    if (session.staged) state().showToast(`Applied ${session.staged.name}`);
    session.reset();
    state().setStudioPage('default');
  }, [state]);

  const revert = useCallback(() => {
    const session = useSmartSession.getState();
    /* Only restore when something was actually applied, or `Esc` on an empty
       screen would clear the user's existing head selection. */
    if (session.applied && session.staged) {
      state().setAssets({ headMesh: session.staged.previousHeadId });
      state().showToast('Head restored');
    }
    session.reset();
    state().setStudioPage('default');
  }, [state]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof Element &&
          target.closest('input, textarea, select, button, summary, a, [contenteditable="true"]')) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        revert();
      } else if (event.key === ' ') {
        event.preventDefault();
        apply();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [apply, revert]);

  const canApply = Boolean(staged) || applied;

  return (
    <footer className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 flex min-h-[54px] flex-wrap md:flex-nowrap items-center justify-between gap-3 px-4 sm:px-8 py-2 md:py-0 select-none bg-gradient-to-t from-black/80 to-transparent">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-3 sm:gap-5 text-xs text-[#cfcacf] flex-wrap">
          <button type="button" onClick={revert} className="flex items-center gap-1.5 transition-colors hover:text-white">
            <span className="flex h-4 w-4 items-center justify-center rounded-[2px] border border-white/20 bg-[#5f5a5e]/70 font-mono text-[10px] font-medium text-[#eae5dc]">
              ↵
            </span>
            <span>Return</span>
          </button>

          <button
            type="button"
            onClick={() => state().showToast('Drop a photo or a 3D mesh on the ring to import it')}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Key>V</Key>
            <span>Import Customization Data</span>
          </button>

          <button
            type="button"
            onClick={() => state().showToast(staged
              ? 'Randomize is not available while a custom head is staged'
              : 'Randomize is not part of this build yet')}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Key>T</Key>
            <span>Random</span>
          </button>

          <button
            type="button"
            onClick={() => state().showToast('This screen assigns a 3D head mesh; photo-to-face matching is not available in this build')}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Key>F1</Key>
            <span>Info</span>
          </button>
        </div>

        <span className="font-mono text-[10px] tracking-wide text-[#7a7882]/80 select-none">
          SMART CUSTOMIZATION{dev ? ' · MESH TEST' : ''}
        </span>
      </div>

      <div className="flex items-center gap-4 sm:gap-6 text-xs text-[#cfcacf]">
        <button
          type="button"
          onClick={() => state().showToast('Uploading to the Gallery is not part of this build yet')}
          className="flex items-center gap-1.5 transition-colors hover:text-white"
        >
          <Key>R</Key>
          <span>Upload to the Gallery</span>
        </button>

        <button
          type="button"
          onClick={apply}
          disabled={!canApply}
          className="flex items-center gap-2 rounded-[2px] border border-[#eac87f] bg-gradient-to-br from-[#d4b483] to-[#b89862] px-4 py-2 text-xs font-semibold text-[#12100c] shadow-[0_0_16px_rgba(212,180,131,0.22)] transition-all hover:from-[#e0c293] hover:to-[#c4a46e] disabled:cursor-not-allowed disabled:border-[#d4b483]/30 disabled:from-transparent disabled:to-transparent disabled:text-[#cfcacf]/40 disabled:shadow-none"
        >
          <Key>Space</Key>
          <span>Apply</span>
        </button>
      </div>
    </footer>
  );
}
