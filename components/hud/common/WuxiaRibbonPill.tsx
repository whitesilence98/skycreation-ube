'use client';

import React from 'react';
import { cn } from '@/lib/cn';

export interface WuxiaRibbonPillProps {
  label: string;
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Reusable Wuxia Brush Ribbon Pill:
 * Gradient white badge with category glyph, establishing clear sub-category identity in Level 2 Drill-Downs.
 */
export function WuxiaRibbonPill({ label, icon, className }: WuxiaRibbonPillProps) {
  return (
    <div className={cn('flex items-center select-none', className)}>
      <div className="relative inline-flex items-center gap-2 rounded-sm bg-gradient-to-r from-white via-white/95 to-white/80 px-3.5 py-1 text-black shadow-sm">
        {icon ? (
          icon
        ) : (
          <svg viewBox="0 0 24 10" className="h-2.5 w-6 fill-current text-neutral-800" aria-hidden>
            <path d="M1 8 C6 2 16 1 23 4 C18 5 9 6 1 8 Z" />
          </svg>
        )}
        <span className="text-[11px] font-semibold tracking-wide text-neutral-900 uppercase">
          {label}
        </span>
      </div>
    </div>
  );
}
