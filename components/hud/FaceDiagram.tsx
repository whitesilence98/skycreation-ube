'use client';

import type { RegionId } from '@/lib/regions';

interface FaceDiagramProps {
  kind: RegionId | 'cheeks';
  className?: string;
  dim?: boolean;
}

/**
 * Minimalist face-contour diagrams used on the region cards. Each highlights
 * one zone with a soft gold wash, matching the reference's etched look.
 */
export function FaceDiagram({ kind, className, dim = false }: FaceDiagramProps) {
  const stroke = dim ? 'rgba(212,180,131,0.38)' : 'rgba(212,180,131,0.62)';
  const faint = dim ? 'rgba(212,180,131,0.16)' : 'rgba(212,180,131,0.28)';
  const wash = 'rgba(232,198,145,0.26)';
  const washSoft = 'rgba(232,198,145,0.12)';

  const facePath =
    'M32 6c10.4 0 18.2 7 18.2 17.4 0 5.2-1.2 9.3-3 12.8-1.6 3.2-2.7 6.4-2.9 9.6-.2 2.7-.2 5.4 0 8.1.1 2.2-1.6 4-3.8 4h-17c-2.2 0-3.9-1.8-3.8-4 .2-2.7.2-5.4 0-8.1-.2-3.2-1.3-6.4-2.9-9.6-1.8-3.5-3-7.6-3-12.8C13.8 13 21.6 6 32 6z';

  return (
    <svg
      viewBox="0 0 64 72"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id={`fg-${kind}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(232,198,145,0.34)" />
          <stop offset="100%" stopColor="rgba(232,198,145,0.10)" />
        </linearGradient>
        <radialGradient id={`fr-${kind}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(255,236,200,0.34)" />
          <stop offset="100%" stopColor="rgba(255,236,200,0)" />
        </radialGradient>
      </defs>

      {/* skull outline */}
      <path d={facePath} stroke={stroke} strokeWidth="0.7" />
      {/* brow + nose bridge structure */}
      <path
        d="M23.4 25.6c1.9-1.2 4.1-1.7 6.1-1.7h5c2 0 4.2.5 6.1 1.7"
        stroke={faint}
        strokeWidth="0.55"
      />
      <path d="M32 24.4v11.9" stroke={faint} strokeWidth="0.5" />
      {/* jaw */}
      <path
        d="M15.6 38.6c.9 5.4 4.4 9.6 8.3 12.5 2.6 1.9 5.4 3 8.1 3s5.5-1.1 8.1-3c3.9-2.9 7.4-7.1 8.3-12.5"
        stroke={faint}
        strokeWidth="0.55"
      />

      {kind === 'forehead' && (
        <>
          <path
            d="M15.8 20.2c2.6-5.4 8.9-8.6 16.2-8.6s13.6 3.2 16.2 8.6c-4.4-2.6-10.2-4.1-16.2-4.1s-11.8 1.5-16.2 4.1z"
            fill={`url(#fg-${kind})`}
            stroke={wash}
            strokeWidth="0.6"
          />
          <ellipse cx="32" cy="16.4" rx="13" ry="4" fill={`url(#fr-${kind})`} />
        </>
      )}

      {kind === 'eyebrows' && (
        <>
          <path
            d="M17.4 24.6c3.2-2.6 7.4-4 11.2-3.6 1.7.2 2.9.9 3.4 1.7"
            fill="none"
            stroke="rgba(232,198,145,0.72)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M46.6 24.6c-3.2-2.6-7.4-4-11.2-3.6-1.7.2-2.9.9-3.4 1.7"
            fill="none"
            stroke="rgba(232,198,145,0.72)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          {/* eye almonds */}
          <path d="M20.4 30.4c1.9-1.7 4.6-1.8 6.4-.1-1.8 1.6-4.5 1.7-6.4.1z" fill="rgba(232,198,145,0.30)" stroke={wash} strokeWidth="0.5" />
          <path d="M37.2 30.4c1.9-1.7 4.6-1.8 6.4-.1-1.8 1.6-4.5 1.7-6.4.1z" fill="rgba(232,198,145,0.30)" stroke={wash} strokeWidth="0.5" />
        </>
      )}

      {(kind === 'nose' || kind === 'cheeks') && (
        <>
          <path
            d="M32 23.4v9.8c0 1.5-.8 2.4-2 3.1l-3 1.9c-1.2.8-1.6 2.2-.7 3 .8.8 2.3.9 3.6.9h4.2c1.3 0 2.8-.1 3.6-.9.9-.8.5-2.2-.7-3l-3-1.9c-1.2-.7-2-1.6-2-3.1z"
            fill={kind === 'nose' ? `url(#fg-${kind})` : 'none'}
            stroke={kind === 'nose' ? wash : faint}
            strokeWidth="0.6"
          />
          {kind === 'cheeks' && (
            <>
              <path
                d="M21.4 30.6c-1.4 3.4-1.2 7.4 1.3 9.6 2.1 1.9 5 1.6 6.4-.6 1.2-1.9.6-4.6-.8-6.4-1.4-1.9-3.6-3-6.9-2.6z"
                fill={`url(#fg-${kind})`}
                stroke={wash}
                strokeWidth="0.55"
              />
              <path
                d="M42.6 30.6c1.4 3.4 1.2 7.4-1.3 9.6-2.1 1.9-5 1.6-6.4-.6-1.2-1.9-.6-4.6.8-6.4 1.4-1.9 3.6-3 6.9-2.6z"
                fill={`url(#fg-${kind})`}
                stroke={wash}
                strokeWidth="0.55"
              />
            </>
          )}
        </>
      )}

      {kind === 'lips' && (
        <>
          <path
            d="M21.6 42.4c2.4-2.6 5.9-4.1 10.4-4.1s8 1.5 10.4 4.1c-2.9 2.4-6.4 3.7-10.4 3.7s-7.5-1.3-10.4-3.7z"
            fill={`url(#fg-${kind})`}
            stroke={wash}
            strokeWidth="0.6"
          />
          <path d="M21.9 42.4c3.1 1.1 6.4 1.6 10.1 1.6s7-.5 10.1-1.6" stroke="rgba(232,198,145,0.62)" strokeWidth="0.62" />
          <path d="M26.6 39.8c1.8-.7 3.7-1 5.4-1s3.6.3 5.4 1" stroke="rgba(232,198,145,0.42)" strokeWidth="0.5" />
        </>
      )}

      {kind === 'jaw' && (
        <>
          <path
            d="M15.9 35.4c.4 5.7 3.4 10.6 7.9 14 2.6 2 5.4 3.1 8.2 3.1s5.6-1.1 8.2-3.1c4.5-3.4 7.5-8.3 7.9-14-1.6 4.1-4.1 7.4-7.4 9.7-2.6 1.9-5.6 3-8.7 3s-6.1-1.1-8.7-3c-3.3-2.3-5.8-5.6-7.4-9.7z"
            fill={`url(#fg-${kind})`}
            stroke={wash}
            strokeWidth="0.6"
          />
          <ellipse cx="32" cy="52.6" rx="5.6" ry="3.4" fill={`url(#fr-${kind})`} />
        </>
      )}

      {/* ears */}
      <path d="M13.9 28.2c-1.3.2-2.2 1.6-2.1 3.4.1 2 .9 3.8 2.2 5.1" stroke={faint} strokeWidth="0.5" />
      <path d="M50.1 28.2c1.3.2 2.2 1.6 2.1 3.4-.1 2-.9 3.8-2.2 5.1" stroke={faint} strokeWidth="0.5" />
      <path d="M29.4 51.2c.4 3.2.2 6.4-.5 9.6M34.6 51.2c-.4 3.2-.2 6.4.5 9.6" stroke={washSoft} strokeWidth="0.5" />
    </svg>
  );
}
