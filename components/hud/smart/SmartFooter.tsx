'use client';

import { useCallback, useEffect } from 'react';
import { useCharacter } from '@/lib/store';
import {
  applyPreview,
  discardPreview,
  useSmartSession,
} from '@/lib/smart/session';

/**
 * The Smart Customization hotkey bar.
 *
 * Same markup vocabulary as `HairFooter` — same keycap, same left/right split,
 * same gradient — because a second visual language for a bar with the same job
 * would read as a different product.
 *
 * `Space Apply` commits the fitted sculpt and returns to the Customization
 * screen; `Esc Return` restores the previous head and leaves. Both are real: a
 * key printed on the bar that does nothing is worse than no key at all.
 *
 * Request ownership and the face transaction live in `lib/smart/session.ts`;
 * this bar only routes the two keys/buttons to it. Apply is gated in the
 * handlers as well as on the button, so `Space` cannot commit a state the
 * button would refuse.
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
  const status = useSmartSession(s => s.status);
  const downloaded = useSmartSession(s => s.downloaded);

  const apply = useCallback(() => {
    /* Guarded here too, not only on the disabled button: `Space` reaches this
       directly. `applyPreview` is a no-op unless a preview is ready. */
    if (useSmartSession.getState().status !== 'preview-ready') return;
    applyPreview();
  }, []);

  const revert = useCallback(() => {
    discardPreview({ toast: 'Head restored' });
    useCharacter.getState().setStudioPage('default');
  }, []);

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

  const canApply = status === 'preview-ready';
  const sessionOnly = canApply && !downloaded;

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
            onClick={() => useCharacter.getState().showToast('Drop an isolated .obj head on the ring to fit it onto the UBE base')}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Key>V</Key>
            <span>Import Customization Data</span>
          </button>

          <button
            type="button"
            onClick={() => useCharacter.getState().showToast(canApply
              ? 'Randomize is not available while a fitted head is previewed'
              : 'Randomize is not part of this build yet')}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Key>T</Key>
            <span>Random</span>
          </button>

          <button
            type="button"
            onClick={() => useCharacter.getState().showToast(
              'Smart Customization fits an .obj head onto the UBE base (approximate, companion parts unchanged). The sculpt is session-only — download the .jslot to keep it.',
            )}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Key>F1</Key>
            <span>Info</span>
          </button>
        </div>

        <span className="font-mono text-[10px] tracking-wide text-[#7a7882]/80 select-none">
          SMART CUSTOMIZATION
          {sessionOnly ? ' · SESSION ONLY — DOWNLOAD .JSLOT' : ''}
        </span>
      </div>

      <div className="flex items-center gap-4 sm:gap-6 text-xs text-[#cfcacf]">
        <button
          type="button"
          onClick={() => useCharacter.getState().showToast('Uploading to the Gallery is not part of this build yet')}
          className="flex items-center gap-1.5 transition-colors hover:text-white"
        >
          <Key>R</Key>
          <span>Upload to the Gallery</span>
        </button>

        <button
          type="button"
          onClick={apply}
          disabled={!canApply}
          title={sessionOnly ? 'This sculpt is session-only — download the .jslot to keep it' : undefined}
          className="flex items-center gap-2 rounded-[2px] border border-[#eac87f] bg-gradient-to-br from-[#d4b483] to-[#b89862] px-4 py-2 text-xs font-semibold text-[#12100c] shadow-[0_0_16px_rgba(212,180,131,0.22)] transition-all hover:from-[#e0c293] hover:to-[#c4a46e] disabled:cursor-not-allowed disabled:border-[#d4b483]/30 disabled:from-transparent disabled:to-transparent disabled:text-[#cfcacf]/40 disabled:shadow-none"
        >
          <Key>Space</Key>
          <span>Apply</span>
        </button>
      </div>
    </footer>
  );
}
