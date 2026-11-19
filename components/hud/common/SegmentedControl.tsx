'use client';

import { cn } from '@/lib/cn';

export interface Segment<T extends string> {
  id: T;
  label: string;
}

/**
 * The two/three-button mode switch the asset panels use (MESH | TEX).
 *
 * `aria-pressed` on each button rather than a tablist: these are independent
 * toggles that swap the list below, not keyboard-arrow-navigable tabs, and the
 * existing panels already expose them this way.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  segments: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex items-stretch border border-[#d4b483]/22 bg-black/40', className)}
    >
      {segments.map((segment, index) => (
        <button
          key={segment.id}
          type="button"
          onClick={() => onChange(segment.id)}
          aria-pressed={value === segment.id}
          className={cn(
            'flex-1 px-[4px] py-[3px] text-[10px] tracking-[0.12em] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#eac87f]',
            index > 0 && 'border-l border-[#d4b483]/22',
            value === segment.id
              ? 'bg-[#d4b483]/[0.1] text-[#f2e4c8]'
              : 'text-[#9b9284]/70 hover:text-[#e8ddc8]',
          )}
        >
          {segment.label}
        </button>
      ))}
    </div>
  );
}
