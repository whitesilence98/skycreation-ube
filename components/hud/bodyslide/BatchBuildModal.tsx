'use client';

import React, { useEffect } from 'react';
import { cn } from '@/lib/cn';
import type { BatchBuildProgress } from '@/lib/bodyslide/batchBuilder';

export interface BatchBuildModalProps {
  isOpen: boolean;
  progress: BatchBuildProgress | null;
  onClose: () => void;
  onCancel?: () => void;
}

/**
 * Wuxia-themed Floating HUD Modal for BodySlide Batch Build operations.
 * Displays live percentage, active outfit item tracker, and animated gold progress bar.
 */
export function BatchBuildModal({
  isOpen,
  progress,
  onClose,
}: BatchBuildModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !progress) return null;

  const isDone = progress.status === 'completed';
  const isError = progress.status === 'error';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-build-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[3px] select-none p-4"
    >
      <div className="relative w-full max-w-[420px] rounded-[3px] border border-[#d4b483]/40 bg-[#14151a]/95 p-5 shadow-[0_12px_40px_rgba(0,0,0,0.8),0_0_24px_rgba(212,180,131,0.15)] backdrop-blur-md">
        {/* Top Gold Corner Accents */}
        <span className="absolute -top-[1.5px] left-1/2 -translate-x-1/2 h-[2px] w-12 rounded-full bg-[#eac87f]" />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d4b483]/18 pb-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[11px]',
                isDone
                  ? 'bg-[#64b574]/20 text-[#72d585]'
                  : isError
                  ? 'bg-[#d7443e]/20 text-[#e66a65]'
                  : 'bg-[#d4b483]/20 text-[#eac87f] animate-pulse',
              )}
            >
              {isDone ? '✓' : isError ? '!' : '✦'}
            </span>
            <div>
              <h3
                id="batch-build-title"
                className="font-mono text-[11px] font-bold tracking-wider text-[#efece6] uppercase"
              >
                {isDone
                  ? 'BATCH BUILD COMPLETE'
                  : isError
                  ? 'BATCH BUILD FAILED'
                  : 'BATCH CONFORMING WARDROBE'}
              </h3>
              <p className="font-mono text-[10px] text-[#9f9584]">
                CONVERTING OUTFITS · UBE NECOCO
              </p>
            </div>
          </div>

          <span className="font-mono text-[13px] font-bold text-[#eac87f]">
            {progress.percent}%
          </span>
        </div>

        {/* Progress Bar */}
        <div className="mt-4 flex flex-col gap-2">
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-black/60 border border-[#d4b483]/20">
            <div
              className={cn(
                'h-full transition-all duration-150 ease-out',
                isDone
                  ? 'bg-gradient-to-r from-[#5ca36a] to-[#79d88c]'
                  : isError
                  ? 'bg-[#d7443e]'
                  : 'bg-gradient-to-r from-[#d4b483]/70 via-[#eac87f] to-[#d4b483] shadow-[0_0_10px_rgba(234,200,127,0.5)]',
              )}
              style={{ width: `${Math.max(2, progress.percent)}%` }}
            />
          </div>

          {/* Current Item Tracker */}
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="truncate max-w-[280px] text-[#c9c1b3]">
              {progress.currentItem}
            </span>
            <span className="shrink-0 text-[#8f8574]">
              {progress.current} / {progress.total}
            </span>
          </div>
        </div>

        {/* Description / Summary message */}
        <p className="mt-3 font-mono text-[10px] leading-relaxed text-[#9f9584]">
          {isDone
            ? 'All 51 outfits successfully deformed with 0-clipping body tuck deltas for UBE Necoco.'
            : isError
            ? progress.message || 'An error occurred during the batch process.'
            : 'Applying 140+ BodySlide morph targets non-destructively to outfit geometries...'}
        </p>

        {/* Actions */}
        <div className="mt-4 flex justify-end gap-2 border-t border-[#d4b483]/18 pt-3">
          <button
            type="button"
            disabled={!isDone && !isError}
            onClick={onClose}
            className={cn(
              'rounded-[2px] border px-4 py-1.5 font-mono text-[10px] font-medium tracking-wider transition-all min-h-[30px]',
              isDone
                ? 'border-[#eac87f] bg-[#d4b483]/25 text-[#f2dfbe] hover:bg-[#d4b483]/35 shadow-[0_0_8px_rgba(234,200,127,0.25)]'
                : !isDone && !isError
                ? 'opacity-40 cursor-not-allowed border-[#d4b483]/15 text-[#8f8574]'
                : 'border-[#d4b483]/30 text-[#d4ccbb] hover:border-[#d4b483]/60',
            )}
          >
            {isDone ? 'DONE' : 'CLOSE'}
          </button>
        </div>
      </div>
    </div>
  );
}
