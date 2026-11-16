'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/cn';

export interface StudioCardProps {
  title?: string;
  badge?: string;
  headerTrailing?: React.ReactNode;
  onClose?: () => void;
  allowMinimize?: boolean;
  defaultMinimized?: boolean;
  footerLeading?: React.ReactNode;
  footerTrailing?: React.ReactNode;
  showSparkle?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function StudioCard({
  title,
  badge,
  headerTrailing,
  onClose,
  allowMinimize = true,
  defaultMinimized = false,
  footerLeading,
  footerTrailing,
  showSparkle = false,
  className,
  children,
}: StudioCardProps) {
  const [minimized, setMinimized] = useState(defaultMinimized);
  const hasHeader = Boolean(title || badge || headerTrailing || onClose || allowMinimize);
  const hasFooter = Boolean(!minimized && (footerLeading || footerTrailing || showSparkle));

  return (
    <div
      className={cn(
        'relative flex w-full max-w-[276px] flex-col select-none text-[#e6e1d8] transition-all duration-200',
        className,
      )}
    >
      <div
        className={cn(
          'relative flex flex-col rounded-[2px] border border-[#463a2e] bg-[#161311]/92 shadow-[0_16px_40px_rgba(0,0,0,0.65)] backdrop-blur-md transition-all duration-200',
          minimized ? 'p-2.5 pb-2 bg-[#161311]/96' : 'p-3 gap-2.5',
        )}
      >
        {/* Ornate Nordic Antique Corner Brackets */}
        <span className="pointer-events-none absolute -top-[1px] -left-[1px] h-[6px] w-[6px] border-t border-l border-[#d4b483]/60" />
        <span className="pointer-events-none absolute -top-[1px] -right-[1px] h-[6px] w-[6px] border-t border-r border-[#d4b483]/60" />
        <span className="pointer-events-none absolute -bottom-[1px] -left-[1px] h-[6px] w-[6px] border-b border-l border-[#d4b483]/60" />
        <span className="pointer-events-none absolute -bottom-[1px] -right-[1px] h-[6px] w-[6px] border-b border-r border-[#d4b483]/60" />

        {/* Header */}
        {hasHeader && (
          <div className="flex items-center justify-between pb-0.5">
            <div
              className={cn(
                'flex min-w-0 items-center gap-1.5',
                minimized && 'cursor-pointer hover:opacity-90',
              )}
              onClick={minimized ? () => setMinimized(false) : undefined}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#eac87f] shadow-[0_0_5px_rgba(234,200,127,0.7)] shrink-0" />
              {title && (
                <h2 className="text-[11px] font-medium tracking-[0.14em] text-[#d8c39c] uppercase font-mono truncate">
                  {title}
                </h2>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {badge && (
                <span className="text-[9.5px] font-mono tracking-wider text-[#8f8778]">
                  {badge}
                </span>
              )}
              {headerTrailing}
              {allowMinimize && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMinimized((v) => !v);
                  }}
                  aria-label={minimized ? 'Expand panel' : 'Minimize panel'}
                  title={minimized ? 'Expand panel' : 'Minimize panel'}
                  className="flex h-[18px] w-[18px] items-center justify-center rounded-[2px] border border-[#d4b483]/22 text-[#a89b85] transition-all hover:border-[#d4b483]/60 hover:text-[#f0e6d4] hover:bg-[#d4b483]/10"
                >
                  <span className="text-[11px] leading-none select-none font-mono">
                    {minimized ? '＋' : '−'}
                  </span>
                </button>
              )}
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close panel"
                  title="Close (Esc)"
                  className="flex h-[18px] w-[18px] items-center justify-center rounded-[2px] border border-[#d4b483]/22 text-[#a89b85] transition-all hover:border-[#d4b483]/60 hover:text-[#f0e6d4] hover:bg-[#d4b483]/10"
                >
                  <span className="text-[10px] leading-none select-none font-mono">✕</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Content Body */}
        {!minimized && children}

        {/* Footer */}
        {hasFooter && (
          <div className="flex items-center justify-between border-t border-[#463a2e]/50 pt-2 text-[9px] font-mono tracking-wider text-[#736b5e]">
            <div className="flex items-center gap-[4px]">{footerLeading}</div>
            <div className="flex items-center gap-1.5">
              {footerTrailing && <span>{footerTrailing}</span>}
              {showSparkle && (
                <span className="text-[13px] leading-none text-[#d4b483]/35 select-none pointer-events-none">
                  ✧
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
