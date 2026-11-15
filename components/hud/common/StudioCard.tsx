'use client';

import React from 'react';
import { cn } from '@/lib/cn';

export interface StudioCardProps {
  title?: string;
  badge?: string;
  headerTrailing?: React.ReactNode;
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
  footerLeading,
  footerTrailing,
  showSparkle = false,
  className,
  children,
}: StudioCardProps) {
  const hasHeader = Boolean(title || badge || headerTrailing);
  const hasFooter = Boolean(footerLeading || footerTrailing || showSparkle);

  return (
    <div
      className={cn(
        'relative flex w-full max-w-[276px] flex-col select-none text-[#e6e1d8]',
        className,
      )}
    >
      <div className="flex flex-col gap-2.5 rounded-[2px] border border-[#463a2e] bg-[#161311]/92 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.65)] backdrop-blur-md">
        {/* Header */}
        {hasHeader && (
          <div className="flex items-center justify-between pb-0.5">
            {title && (
              <h2 className="text-[11px] font-medium tracking-[0.14em] text-[#d8c39c] uppercase font-mono truncate">
                {title}
              </h2>
            )}
            <div className="flex items-center gap-2 shrink-0">
              {badge && (
                <span className="text-[9.5px] font-mono tracking-wider text-[#8f8778]">
                  {badge}
                </span>
              )}
              {headerTrailing}
            </div>
          </div>
        )}

        {/* Content Body */}
        {children}

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
