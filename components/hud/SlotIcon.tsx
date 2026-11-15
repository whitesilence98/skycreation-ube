'use client';

import { type EquipSlot } from '@/lib/equipment';
import { cn } from '@/lib/cn';

export interface SlotIconProps {
  slot: EquipSlot;
  className?: string;
}

export function SlotIcon({ slot, className }: SlotIconProps) {
  const cls = cn('h-5 w-5 fill-none stroke-current stroke-[1.2]', className);
  switch (slot) {
    case 'outfit':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M8 3 L12 6 L16 3 L19 7 L16 9 L17 21 L7 21 L8 9 L5 7 Z" />
        </svg>
      );
    case 'top':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M8 4 L12 6 L16 4 L20 8 L17 11 L16 19 L8 19 L7 11 L4 8 Z" />
        </svg>
      );
    case 'bottom':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M7 4 L17 4 L18 13 L14 13 L12 8 L10 13 L6 13 Z" />
          <path d="M7 4 L6 20 L10.5 20 L12 11 L13.5 20 L18 20 L17 4" />
        </svg>
      );
    case 'bra':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <circle cx="8" cy="13" r="3.5" />
          <circle cx="16" cy="13" r="3.5" />
          <path d="M11.5 13 L12.5 13 M4.5 12 L2 10 M19.5 12 L22 10 M8 9.5 L8 5 M16 9.5 L16 5" />
        </svg>
      );
    case 'panties':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M5 8 L19 8 L17 17 C15 19, 13 19, 12 19 C11 19, 9 19, 7 17 Z" />
          <path d="M7 8 C8 12, 10 15, 12 15 C14 15, 16 12, 17 8" strokeDasharray="1.5 1.5" />
        </svg>
      );
    case 'stockings':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M8 4 L11 4 L10 18 L12 20 L9 20 L7 16 Z" />
          <path d="M16 4 L13 4 L14 18 L12 20 L15 20 L17 16 Z" />
          <line x1="8" y1="7" x2="11" y2="7" />
          <line x1="16" y1="7" x2="13" y2="7" />
        </svg>
      );
    case 'hands':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M7 19 L7 12 C7 10, 8 10, 9 10 L9 7 C9 6, 10 6, 11 6 L11 5 C11 4, 12 4, 13 5 L13 10 C14 10, 15 11, 15 12 L17 14 C17 17, 16 19, 14 19 Z" />
        </svg>
      );
    case 'feet':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M8 4 L13 4 L12 14 L17 16 L17 20 L7 20 L7 14 Z" />
        </svg>
      );
    case 'accessories':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path d="M6 7 C5 4, 8 3, 10 6 C9 8, 8 10, 8 12" />
          <path d="M18 7 C19 4, 16 3, 14 6 C15 8, 16 10, 16 12" />
          <circle cx="12" cy="15" r="4.5" />
        </svg>
      );
    default:
      return null;
  }
}
