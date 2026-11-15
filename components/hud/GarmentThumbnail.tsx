'use client';

import { useEffect, useRef, useState } from 'react';
import type { EquipSlot } from '@/lib/equipment';
import { convertUrl } from '@/lib/mo2/client';
import { getCachedGarmentThumbnail, requestGarmentThumbnail } from '@/lib/equipment/thumbnailRenderer';
import { SlotIcon } from '@/components/hud/SlotIcon';
import { cn } from '@/lib/cn';

export interface GarmentThumbnailProps {
  id: string;
  meshUrl?: string;
  label?: string;
  slot?: EquipSlot;
  className?: string;
  iconClassName?: string;
  imgClassName?: string;
}

export function GarmentThumbnail({
  id,
  meshUrl,
  label,
  slot,
  className,
  iconClassName,
  imgClassName,
}: GarmentThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState<boolean>(() => Boolean(getCachedGarmentThumbnail(id)));
  const [thumbUrl, setThumbUrl] = useState<string | null>(() => getCachedGarmentThumbnail(id) ?? null);
  const [loading, setLoading] = useState<boolean>(!thumbUrl);

  const effectiveUrl = meshUrl ?? (id.startsWith('/') ? id : convertUrl({ kind: 'clothingMesh', id, mode: 'mesh' }));

  useEffect(() => {
    // If thumbnail already cached in memory, no need for observer
    if (getCachedGarmentThumbnail(id)) {
      setThumbUrl(getCachedGarmentThumbnail(id)!);
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
      { rootMargin: '120px' }, // prefetch 120px before card scrolls into viewport
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [id]);

  useEffect(() => {
    if (!isInView) return;

    const cached = getCachedGarmentThumbnail(id);
    if (cached) {
      setThumbUrl(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    requestGarmentThumbnail(id, effectiveUrl).then((url) => {
      if (cancelled) return;
      setThumbUrl(url);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [id, effectiveUrl, isInView]);

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
            'h-full w-full object-contain filter drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)] transition-opacity duration-200',
            loading ? 'opacity-0' : 'opacity-100',
            imgClassName,
          )}
        />
      ) : (
        slot && (
          <SlotIcon
            slot={slot}
            className={cn('transition-opacity duration-150', loading ? 'opacity-40 animate-pulse' : 'opacity-80', iconClassName)}
          />
        )
      )}

      {/* Subtle shimmer bar while rendering */}
      {loading && !thumbUrl && (
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-shimmer" />
      )}
    </div>
  );
}
