'use client';

import React from 'react';
import { cn } from '@/lib/cn';

export interface WuxiaBreadcrumbsProps {
  category: string;
  subCategory?: string | null;
  onBack: () => void;
  className?: string;
}

/**
 * Reusable Wuxia Breadcrumb Header for Level 2 Drill-Down screens:
 * Category › Sub-Category with accessible back navigation and Escape support.
 */
export function WuxiaBreadcrumbs({
  category,
  subCategory,
  onBack,
  className,
}: WuxiaBreadcrumbsProps) {
  return (
    <nav
      className={cn('flex items-center gap-1.5 text-xs font-mono select-none', className)}
      aria-label="Breadcrumb navigation"
    >
      <button
        type="button"
        onClick={onBack}
        className="py-1 px-1.5 -ml-1.5 rounded text-[#9f9da6] transition-colors hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#dfba73]"
        title={`Return to ${category}`}
        aria-label={`Return to ${category}`}
      >
        {category}
      </button>

      {subCategory && (
        <>
          <span className="text-[#65636d]" aria-hidden>
            ›
          </span>
          <span className="text-white font-medium truncate" aria-current="page">
            {subCategory}
          </span>
        </>
      )}
    </nav>
  );
}
