'use client';

import { useState } from 'react';
import { convertUrl } from '@/lib/mo2/client';

/**
 * A tintmask swatch: the catalogue DDS alpha is used as a CSS `maskImage`
 * over a solid tint, so the user sees the layer's actual footprint rather than
 * a flat colour disc. Shared by the makeup and tattoo pickers — both kinds are
 * albedo DDS whose alpha is the paint mask.
 *
 * The alpha route is requested for the given `kind`, so `makeup` and `tattoo`
 * each resolve against their own catalogue without a second component.
 */
export function OverlaySwatch({ kind, id, color }: { kind: string; id: string; color: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const src = convertUrl({ kind, id, mode: 'alpha' });
  return (
    <span className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-full border border-[#d4b483]/20 bg-[radial-gradient(ellipse_at_center,#4a3f32_0%,#221d17_62%,#0f0d0b_100%)] p-[3px] transition-transform duration-200 group-hover:scale-105">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full opacity-0"
        onLoad={() => setStatus('ready')}
        onError={() => setStatus('error')}
      />
      {status === 'ready' ? (
        <span
          className="absolute inset-[3px] rounded-full transition-transform duration-200 group-hover:scale-105"
          style={{
            backgroundColor: color,
            maskImage: `url("${src}")`,
            maskSize: 'contain',
            maskPosition: 'center',
            maskRepeat: 'no-repeat',
            WebkitMaskImage: `url("${src}")`,
            WebkitMaskSize: 'contain',
            WebkitMaskPosition: 'center',
            WebkitMaskRepeat: 'no-repeat',
          }}
        />
      ) : (
        <span className="text-[10px] tracking-[0.06em] text-[#dacbad]/70 leading-none">
          {status === 'error' ? 'NO MASK' : '…'}
        </span>
      )}
    </span>
  );
}
