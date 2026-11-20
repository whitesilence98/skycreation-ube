'use client';

import React from 'react';
import { cn } from '@/lib/cn';

export interface ItemTileProps {
  /** Unique identifier for the item */
  id: string;
  /** Primary label / title of the item */
  title: string;
  /** Optional subtitle or description (e.g. brand, parts count) */
  subtitle?: string;
  /** Whether this tile is actively selected */
  isSelected?: boolean;
  /** The thumbnail graphic: can be an <img>, 3D Canvas, SVG, or icon */
  thumbnail: React.ReactNode;
  /** Optional top-right badge (e.g. 'NEW') */
  badge?: React.ReactNode;
  /** Whether to render the gold checkmark in the top-left when selected (default true) */
  showCheckmark?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Right-click / context menu handler (e.g. unequip or inspect) */
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Additional CSS class names */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Accessible ARIA label override */
  ariaLabel?: string;
}

/**
 * Universal, reusable square selection tile matching the target Wuxia HUD.
 * Used for hairstyles, makeup, face sculpts, clothing, tattoos, and presets.
 */
export function ItemTile({
  id,
  title,
  subtitle,
  isSelected = false,
  thumbnail,
  badge,
  showCheckmark = true,
  onClick,
  onContextMenu,
  className,
  disabled = false,
  ariaLabel,
}: ItemTileProps) {
  return (
    <div className={cn('relative aspect-square w-full min-w-0 select-none', className)}>
      <button
        type="button"
        id={`item-tile-${id}`}
        disabled={disabled}
        onClick={onClick}
        onContextMenu={e => {
          if (onContextMenu) {
            e.preventDefault();
            onContextMenu(e);
          }
        }}
        aria-pressed={isSelected}
        aria-label={ariaLabel ?? (subtitle ? `${title} — ${subtitle}` : title)}
        title={subtitle ? `${title}\n${subtitle}` : title}
        className={cn(
          'group relative flex h-full w-full items-center justify-center overflow-hidden rounded-[2px] border transition-all duration-150',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]',
          isSelected
            ? 'border-2 border-white ring-1 ring-white/60 bg-[#282930] shadow-[0_0_10px_rgba(255,255,255,0.2)]'
            : 'border-white/10 bg-[#202126]/90 hover:border-white/30 hover:bg-[#26272e]',
          disabled && 'cursor-not-allowed opacity-40'
        )}
      >
        {/* Selected Gold Checkmark in Top-Left */}
        {isSelected && showCheckmark && (
          <span
            aria-hidden="true"
            className="absolute top-1 left-1.5 z-10 font-bold text-[12px] leading-none text-[#e4cca8] drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] select-none"
          >
            ✓
          </span>
        )}

        {/* Optional Top-Right Badge (e.g. 'NEW') */}
        {badge && (
          <span className="absolute top-0 right-0 z-10 bg-[#c8b8a9] px-1 py-[0.5px] font-bold text-[10px] leading-tight text-[#1c1b1d] select-none">
            {badge}
          </span>
        )}

        {/* Thumbnail Graphic */}
        <div className="relative flex h-full w-full items-center justify-center p-0.5">
          {thumbnail}
        </div>
      </button>
    </div>
  );
}
