'use client';

import React from 'react';
import { cn } from '@/lib/cn';

export interface WuxiaRootMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number | string;
  badge?: string;
}

export interface WuxiaRootMenuProps {
  title: string;
  items: WuxiaRootMenuItem[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  className?: string;
}

/**
 * Reusable Wuxia Category Root Menu (View 1):
 * Renders the standardized vertical list of sub-sections with chevrons (›).
 */
export function WuxiaRootMenu({
  title,
  items,
  activeId,
  onSelect,
  className,
}: WuxiaRootMenuProps) {
  return (
    <div className={cn('flex flex-col select-none', className)}>
      <h1 className="text-base font-normal tracking-wide text-white mb-3">{title}</h1>

      <div className="flex flex-col gap-1.5" role="menu" aria-label={`${title} Sub-categories`}>
        {items.map((item) => {
          const isActive = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={cn(
                'group flex h-11 w-full items-center justify-between rounded-sm border px-3.5 text-left transition-all',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]',
                isActive
                  ? 'border-[#dfba73] bg-[#24252e] text-white shadow-sm'
                  : 'border-white/5 bg-[#1f2026]/75 hover:border-[#dfba73]/40 hover:bg-[#272830]'
              )}
              role="menuitem"
              aria-current={isActive ? 'true' : undefined}
            >
              <div className="flex items-center gap-2.5 truncate">
                {item.icon && <span className="text-[#9f9da6] group-hover:text-white transition-colors">{item.icon}</span>}
                <span className="text-xs tracking-wide text-[#d4d3d9] transition-colors group-hover:text-white truncate">
                  {item.label}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {item.badge && (
                  <span className="rounded bg-[#dfba73]/15 px-1.5 py-0.5 text-[9px] font-mono text-[#dfba73]">
                    {item.badge}
                  </span>
                )}
                {item.count !== undefined && (
                  <span className="font-mono text-[10px] text-[#8a8793]">{item.count}</span>
                )}
                <span className="text-sm font-light text-[#75737d] transition-colors group-hover:text-white">
                  ›
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
