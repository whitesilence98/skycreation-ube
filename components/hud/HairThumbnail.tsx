'use client';

import { useEffect, useRef, useState } from 'react';
import { convertUrl } from '@/lib/mo2/client';
import { getCachedHairThumbnail, requestHairThumbnail } from '@/lib/hair/thumbnailRenderer';
import { cn } from '@/lib/cn';

export interface HairThumbnailProps {
  id: string;
  meshUrls?: string | string[];
  label?: string;
  hairTone?: string;
  className?: string;
  iconClassName?: string;
  imgClassName?: string;
}

function IconHairSilhouette({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 2.5C7.8 2.5 4.5 5.8 4.5 10c0 4.8 2.2 8.2 3.8 10.5.4-1.8.8-3.2.8-4.5 0-1.4-.4-2.4-.8-3.3C7.8 11.2 8.2 8.5 12 8.5s4.2 2.7 3.7 4.2c-.4.9-.8 1.9-.8 3.3 0 1.3.4 2.7.8 4.5 1.6-2.3 3.8-5.7 3.8-10.5 0-4.2-3.3-7.5-7.5-7.5z" />
      <path d="M9.2 10.2c.4-1.8 1.5-3 2.8-3s2.4 1.2 2.8 3" strokeOpacity="0.5" strokeWidth="1.2" />
    </svg>
  );
}

export function HairThumbnail({
  id,
  meshUrls,
  label,
  hairTone,
  className,
  iconClassName,
  imgClassName,
}: HairThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState<boolean>(() => Boolean(getCachedHairThumbnail(id)));
  const [thumbUrl, setThumbUrl] = useState<string | null>(() => getCachedHairThumbnail(id) ?? null);
  const [loading, setLoading] = useState<boolean>(!thumbUrl);

  const effectiveUrls: string | string[] = meshUrls ?? (
    id.startsWith('/') ? id : convertUrl({ kind: 'hairMesh', id, mode: 'mesh' })
  );

  useEffect(() => {
    // If thumbnail already cached in memory, display immediately
    const cached = getCachedHairThumbnail(id);
    if (cached) {
      setThumbUrl(cached);
      setLoading(false);
      return;
    }

    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px' }, // prefetch before card enters viewport
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [id]);

  useEffect(() => {
    if (!isInView) return;

    const cached = getCachedHairThumbnail(id);
    if (cached) {
      setThumbUrl(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    requestHairThumbnail(id, effectiveUrls, hairTone).then((url) => {
      if (cancelled) return;
      setThumbUrl(url);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [id, effectiveUrls, hairTone, isInView]);

  return (
    <div
      ref={containerRef}
      className={cn('relative flex h-full w-full items-center justify-center overflow-hidden', className)}
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt={label ?? id}
          loading="lazy"
          className={cn(
            'h-full w-full object-contain filter drop-shadow-[0_2px_8px_rgba(0,0,0,0.65)] transition-opacity duration-200',
            loading ? 'opacity-0' : 'opacity-100',
            imgClassName,
          )}
        />
      ) : (
        <IconHairSilhouette
          className={cn(
            'h-9 w-9 text-amber-500/40 transition-opacity duration-150',
            loading ? 'animate-pulse opacity-40' : 'opacity-70',
            iconClassName,
          )}
        />
      )}

      {/* Subtle shimmer bar while rendering */}
      {loading && !thumbUrl && (
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-shimmer" />
      )}
    </div>
  );
}
