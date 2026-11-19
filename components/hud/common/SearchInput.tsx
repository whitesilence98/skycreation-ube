'use client';

import React from 'react';
import { cn } from '@/lib/cn';

export interface SearchInputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  className,
  autoFocus = false,
}: SearchInputProps) {
  return (
    <div
      className={cn(
        'group flex h-[28px] w-full items-center gap-1.5 rounded-xs border border-[#443729] bg-[#110e0c]/90 px-2 py-1 text-[10px] font-mono leading-none transition-all duration-150',
        'focus-within:border-[#eac87f] focus-within:shadow-[0_0_8px_rgba(234,200,127,0.25)] focus-within:bg-[#16120e]',
        className,
      )}
    >
      {/* Magnifying Glass Icon */}
      <svg
        className="h-3 w-3 shrink-0 text-[#d4b483]/60 transition-colors group-focus-within:text-[#eac87f]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>

      {/* Text Input */}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onChange('');
          }
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        className="w-full min-w-0 bg-transparent text-[10px] font-mono tracking-wider text-[#efece6] outline-none placeholder:text-[#8c8477]/65"
      />

      {/* Clear Button when Query Exists */}
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange('')}
          title="Clear search (Esc)"
          aria-label="Clear search"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-black/60 text-[10px] leading-none text-[#a89e8f] transition-colors hover:bg-[#d4b483]/25 hover:text-[#f2dfbe]"
        >
          ✕
        </button>
      )}
    </div>
  );
}
