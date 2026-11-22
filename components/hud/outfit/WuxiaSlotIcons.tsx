'use client';

import React from 'react';
import { cn } from '@/lib/cn';

interface IconProps {
  className?: string;
}

/** Traditional Wuxia Robe / Hanfu crossover top */
export function IconWuxiaRobe({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      {/* Crossover collar */}
      <path d="M10 6 L16 14 L22 6" />
      <path d="M16 14 L12 26" />
      <path d="M14 18 L20 26" />
      {/* Shoulders and sleeves */}
      <path d="M10 6 L4 11 L7 17 L10 14 L10 26 L22 26 L22 14 L25 17 L28 11 L22 6 Z" strokeLinejoin="round" />
      {/* Belt sash */}
      <line x1="10" y1="20" x2="22" y2="20" />
      <line x1="10" y1="22" x2="22" y2="22" />
    </svg>
  );
}

/** Traditional Asian Conical Bamboo Hat (笠) */
export function IconWuxiaHat({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      <ellipse cx="16" cy="18" rx="13" ry="5" />
      <path d="M3 18 C3 18 10 13 16 9 C22 13 29 18 29 18" />
      <circle cx="16" cy="8.5" r="1" fill="currentColor" />
    </svg>
  );
}

/** Flowing neck scarf / silk ribbon */
export function IconWuxiaScarf({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      <path d="M8 12 C11 9 21 9 24 12 C25 15 22 17 18 17 C14 17 10 15 8 12 Z" />
      <path d="M18 17 C19 21 21 24 23 27 C21 27 19 25 18 22" />
      <path d="M15 17 C15 21 16 25 17 28 C15 28 14 25 13 21" />
    </svg>
  );
}

/** Wuxia / Oni Demon Mask */
export function IconWuxiaMask({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      <path d="M8 9 C8 7 11 6 16 6 C21 6 24 7 24 9 L25 17 C25 22 21 26 16 26 C11 26 7 22 7 17 Z" strokeLinejoin="round" />
      {/* Horns / Brow */}
      <path d="M7 11 L5 8 M25 11 L27 8" />
      {/* Eyes */}
      <path d="M10 14 Q12 12 14 15" strokeLinecap="round" />
      <path d="M22 14 Q20 12 18 15" strokeLinecap="round" />
      {/* Mouth / Fangs */}
      <path d="M11 20 Q16 23 21 20" strokeLinecap="round" />
      <path d="M13 20 L13 22 M19 20 L19 22" />
    </svg>
  );
}

/** Shoulder Armor / Pauldron */
export function IconWuxiaShoulder({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      <path d="M10 9 C13 7 19 7 22 9 L25 15 C25 19 21 22 16 23 C11 22 7 19 7 15 Z" strokeLinejoin="round" />
      <path d="M9 14 C12 16 20 16 23 14" />
      <path d="M11 18 C13 20 19 20 21 18" />
    </svg>
  );
}

/** Ear with Dangling Jade Earring */
export function IconWuxiaEarring({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      {/* Ear contour */}
      <path d="M13 9 C17 9 20 11 20 15 C20 19 16 21 15 23 C14 24 13 24 13 22" strokeLinecap="round" />
      <path d="M15 13 C17 14 17 16 16 17" strokeLinecap="round" />
      {/* Hanging Earring */}
      <line x1="13" y1="22" x2="13" y2="25" />
      <circle cx="13" cy="27" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** Daoist Jade Talisman / Pendant with Tassel */
export function IconWuxiaTalisman({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      {/* Top cord */}
      <line x1="16" y1="5" x2="16" y2="9" />
      {/* Jade Bi disc or pouch */}
      <circle cx="16" cy="15" r="6" />
      <circle cx="16" cy="15" r="2" />
      {/* Hanging silk ribbons / tassel */}
      <path d="M14 21 C13 24 11 27 10 28" />
      <path d="M16 21 L16 29" />
      <path d="M18 21 C19 24 21 27 22 28" />
    </svg>
  );
}

/** Antique Signet Ring / Hairpin */
export function IconWuxiaRing({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      <circle cx="16" cy="13" r="4.5" />
      <line x1="16" y1="17.5" x2="16" y2="26" strokeLinecap="round" />
      <circle cx="16" cy="27" r="0.8" fill="currentColor" />
    </svg>
  );
}

/** Jian / Curved Martial Sword across diagonal */
export function IconWuxiaSword({ className }: IconProps) {
  return (
    <svg viewBox="0 0 40 24" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      {/* Diagonal blade & scabbard */}
      <path d="M6 20 L28 6 L34 4 L32 8 L8 22 Z" strokeLinejoin="round" />
      {/* Guard */}
      <line x1="10" y1="15" x2="6" y2="21" strokeWidth="2" strokeLinecap="round" />
      {/* Pommel / Tassel */}
      <circle cx="5" cy="21.5" r="1" fill="currentColor" />
      <path d="M5 22 Q4 24 3 26" strokeLinecap="round" />
    </svg>
  );
}

/** Open Traditional Folding Fan (扇) */
export function IconWuxiaFan({ className }: IconProps) {
  return (
    <svg viewBox="0 0 40 24" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      {/* Fan arc */}
      <path d="M12 21 C12 21 16 11 32 7 C34 11 34 16 33 21 C27 20 20 20 12 21 Z" strokeLinejoin="round" />
      {/* Ribs */}
      <line x1="12" y1="21" x2="22" y2="8" />
      <line x1="12" y1="21" x2="28" y2="10" />
      <line x1="12" y1="21" x2="31" y2="15" />
      {/* Pivot */}
      <circle cx="12" cy="21" r="1.2" fill="currentColor" />
    </svg>
  );
}

/** Yin-Yang Emblem for Appearance button */
export function IconYinYang({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('fill-current', className)} aria-hidden>
      <circle cx="12" cy="12" r="11" fill="white" stroke="#222" strokeWidth="1" />
      {/* Dark side S-curve */}
      <path d="M12 1 A11 11 0 0 0 12 23 A5.5 5.5 0 0 0 12 12 A5.5 5.5 0 0 1 12 1 Z" fill="#222" />
      {/* Contrasting dots */}
      <circle cx="12" cy="6.5" r="1.6" fill="white" />
      <circle cx="12" cy="17.5" r="1.6" fill="#222" />
    </svg>
  );
}

/** Lotus Flower emblem for Collection */
export function IconLotus({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      {/* Central petal */}
      <path d="M12 4 C10 8 10 14 12 18 C14 14 14 8 12 4 Z" fill="currentColor" fillOpacity="0.2" />
      {/* Left petal */}
      <path d="M12 18 C8 17 5 13 6 9 C9 10 11 13 12 18 Z" />
      {/* Right petal */}
      <path d="M12 18 C16 17 19 13 18 9 C15 10 13 13 12 18 Z" />
      {/* Outer side flairs */}
      <path d="M6 15 C3 14 3 11 5 9" />
      <path d="M18 15 C21 14 21 11 19 9" />
      {/* Base water line */}
      <path d="M7 20 Q12 21 17 20" />
    </svg>
  );
}

/** Ancient Book / Scroll emblem for Gallery */
export function IconScroll({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 8 L16 8 M8 12 L16 12 M8 16 L13 16" />
      {/* Bookmark or tassel */}
      <path d="M15 4 L15 10 L16.5 8.5 L18 10 L18 4" fill="currentColor" fillOpacity="0.3" />
    </svg>
  );
}

/** Double Chevron pointing top-right for collapse / full preview */
export function IconDoubleChevron({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('fill-none stroke-current stroke-[1.6]', className)} aria-hidden>
      <path d="M7 17 L17 7 M10 7 L17 7 L17 14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14 L11 7" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    </svg>
  );
}

/** Magnifying glass search icon */
export function IconSearch({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('fill-none stroke-current stroke-[1.6]', className)} aria-hidden>
      <circle cx="11" cy="11" r="6" />
      <line x1="16" y1="16" x2="20" y2="20" strokeLinecap="round" />
    </svg>
  );
}

/** Sub-rail: Presets / Character Gallery / Album icon */
export function IconSubPreset({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      {/* Outer portrait / preset card frame */}
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Head silhouette */}
      <circle cx="12" cy="9.2" r="2.3" />
      {/* Bust / shoulder contour */}
      <path d="M7.5 17 C7.5 14.4 9.5 13.5 12 13.5 C14.5 13.5 16.5 14.4 16.5 17" strokeLinecap="round" />
      {/* Top hanger / card tab */}
      <line x1="8.5" y1="3.5" x2="15.5" y2="3.5" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Sub-rail: Face Customization / Sculpt icon */
export function IconSubFace({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      {/* Half face sculpt profile with dashed mirror */}
      <path d="M12 4 C16 4 19 7 19 12 C19 17 16 20 12 21" />
      <path d="M12 4 C8 4 6 7 6 12 C6 17 8 20 12 21" strokeDasharray="1.5 1.5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** Sub-rail: Physique / Athletic Body Torso icon */
export function IconSubPhysique({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      {/* Torso silhouette: Neck to shoulders, waist taper, and hips */}
      <path
        d="M9.5 4 C8 5.2 5.5 6.8 4.5 8.5 C5.5 11 7 12.8 7.5 15 C8 17 6.5 19 6 20 C8.5 21 11 21 12 21 C13 21 15.5 21 18 20 C17.5 19 16 17 16.5 15 C17 12.8 18.5 11 19.5 8.5 C18.5 6.8 16 5.2 14.5 4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Neck arch */}
      <path d="M9.5 4 C10.5 4.8 13.5 4.8 14.5 4" strokeLinecap="round" />
      {/* Clavicle / Collarbone */}
      <path d="M8 8 C10 9 11.5 8.5 12 7.2 C12.5 8.5 14 9 16 8" strokeLinecap="round" />
      {/* Athletic abdominal / torso definition */}
      <line x1="12" y1="9.5" x2="12" y2="15.5" strokeLinecap="round" />
      <path d="M9 12 C10.5 13 13.5 13 15 12" strokeLinecap="round" />
    </svg>
  );
}

/** Sub-rail: Makeup / Eyes / Brows icon */
export function IconSubMakeup({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      {/* Stylized eye with arched brow */}
      <path d="M5 8 C9 6 15 6 19 8" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 14 C7 10 17 10 20 14 C17 18 7 18 4 14 Z" />
      <circle cx="12" cy="14" r="2.5" fill="currentColor" />
    </svg>
  );
}

/** Sub-rail: Hairstyle silhouette (Ponytail / Topknot) */
export function IconSubHair({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('fill-current', className)} aria-hidden>
      {/* Topknot / bun */}
      <circle cx="12" cy="4.5" r="2" />
      {/* Main hair silhouette with bangs and side tufts */}
      <path d="M12 7 C7.5 7 5 10 5 15 C5 17 6.5 19 7.5 18 C8.5 17 8.5 14 9.5 12 C10.5 10 13.5 10 14.5 12 C15.5 14 15.5 17 16.5 18 C17.5 19 19 17 19 15 C19 10 16.5 7 12 7 Z" />
      {/* Trailing back strand */}
      <path d="M12 5.5 C13.5 5.5 16 8 16.5 11 C15.5 10 13.5 9 12 9 Z" />
    </svg>
  );
}

/** Sub-rail: Outfit / Robe / Wardrobe icon */
export function IconSubOutfit({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('fill-none stroke-current stroke-[1.4]', className)} aria-hidden>
      {/* Crossover collar */}
      <path d="M8 5 L12 10 L16 5" />
      <path d="M12 10 L9 19" />
      <path d="M11 13 L15 19" />
      {/* Shoulders and sleeves */}
      <path d="M8 5 L3 9 L5 13 L8 11 L8 19 L16 19 L16 11 L19 13 L21 9 L16 5 Z" strokeLinejoin="round" />
      {/* Sash */}
      <line x1="8" y1="15" x2="16" y2="15" />
    </svg>
  );
}


