'use client';

import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * The Smart Customization dropzone.
 *
 * A ring, not a card. The reference's concentric hairlines and centred head
 * silhouette are the whole focal moment, and they earn it: the ring is also
 * the progress indicator and the fitted head's preview surface, so the one
 * animated element is the one carrying state.
 *
 * Everything interactive is a real `<label>` wrapping a real file input, so
 * keyboard users and screen readers reach the native picker without a custom
 * affordance.
 *
 * The preview is the *sculpted UBE* silhouette built from the fitted mesh, not
 * the uploaded OBJ. During fitting the ring spins with no percentage — the
 * converter reports no intermediate progress and inventing one would be a lie.
 */

export type DropZoneState =
  | 'idle'
  | 'drag-over'
  | 'converting'
  | 'preview-ready'
  | 'rejected'
  | 'image';

export interface DropZoneProps {
  state: DropZoneState;
  accept: string;
  /** Fitted-UBE preview, already projected to a square edge list. */
  preview?: { edges: Float32Array; size: number } | null;
  /** Photo object URL, shown instead of the ring glyph (preview-only). */
  imageUrl?: string | null;
  /** File name shown while fitting or previewing. */
  fileName?: string | null;
  /** Human-readable reason for a rejection. */
  error?: string | null;
  /** Fit summary line under the headline while previewing. */
  detail?: string | null;
  onFile: (file: File) => void;
  onDragStateChange: (over: boolean) => void;
}

/** Head silhouette in a 24×24 box, drawn rather than glyphed. */
function HeadGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M12 3.4c3.1 0 5.2 2.2 5.2 5.1 0 2.1-.9 3.5-2.1 4.4l.4 2.4c.1.6-.4 1.1-1 1.1h-5c-.6 0-1.1-.5-1-1.1l.4-2.4C7.7 12 6.8 10.6 6.8 8.5c0-2.9 2.1-5.1 5.2-5.1Z" />
      <path d="M9.2 8.2h.01M14.8 8.2h.01" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M10.6 11.6c.9.5 1.9.5 2.8 0" strokeLinecap="round" />
      <path d="M9.4 15.4 8.6 20h6.8l-.8-4.6" />
    </svg>
  );
}

/**
 * Ink the fitted mesh's projected edges onto a canvas.
 *
 * The edge list is precomputed from the fitted UBE (`lib/smart/retarget.ts`);
 * this only draws it, so a re-render never re-walks the mesh.
 */
function MeshPreview({ preview }: { preview: { edges: Float32Array; size: number } }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = preview.size;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(234,200,127,0.55)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    const edges = preview.edges;
    for (let i = 0; i < edges.length; i += 4) {
      ctx.moveTo(edges[i], edges[i + 1]);
      ctx.lineTo(edges[i + 2], edges[i + 3]);
    }
    ctx.stroke();
  }, [preview]);

  return (
    <canvas
      ref={canvasRef}
      width={preview.size}
      height={preview.size}
      className="h-full w-full"
      aria-hidden
    />
  );
}

export function SmartDropZone({
  state, accept, preview, imageUrl, fileName, error, detail, onFile, onDragStateChange,
}: DropZoneProps) {
  const active = state === 'drag-over';
  const busy = state === 'converting';
  const ready = state === 'preview-ready';

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  const headline = useMemo(() => {
    switch (state) {
      case 'converting': return 'Fitting your head to the UBE base…';
      case 'rejected': return 'That file could not be used';
      case 'preview-ready': return 'Previewing your head';
      case 'image': return 'Photo preview only';
      default: return 'Fit an OBJ head to your character';
    }
  }, [state]);

  const detailLine = useMemo(() => {
    if (state === 'rejected') return error ?? 'This file could not be used.';
    if (state === 'image') {
      return 'This photo is a preview only — drop an .obj head to fit it onto the UBE base.';
    }
    if (busy) return fileName ? `${fileName} · fitting (~1 min)` : 'Fitting (~1 min)';
    if (state === 'preview-ready') return detail ?? fileName ?? null;
    return 'Drop an isolated .obj head to fit it onto the UBE base. Photos are a preview only.';
  }, [state, error, fileName, detail, busy]);

  return (
    <div className="pointer-events-auto flex w-full flex-col items-center select-none">
      <label
        className={cn(
          'creator-smart-ring group relative flex items-center justify-center rounded-full cursor-pointer',
          'focus-within:outline-none',
          active && 'is-drag-over',
          busy && 'is-parsing',
          state === 'rejected' && 'is-rejected',
          (state === 'preview-ready' || state === 'image') && 'is-staged',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          if (!active) onDragStateChange(true);
        }}
        onDragLeave={(event) => {
          /* `dragleave` fires when crossing into a child too; only leave when
             the pointer has actually left the ring's box. */
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          onDragStateChange(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          onDragStateChange(false);
          handleFiles(event.dataTransfer?.files ?? null);
        }}
      >
        <input
          type="file"
          accept={accept}
          className="sr-only"
          aria-label="Choose an .obj head to fit or a photo to preview"
          onChange={(event) => {
            handleFiles(event.target.files);
            /* Reset so re-picking the same file still fires a change. */
            event.target.value = '';
          }}
        />

        {/* Concentric hairlines — the ring's own scale, not decoration on a card. */}
        <span aria-hidden className="creator-smart-ring-outer" />
        <span aria-hidden className="creator-smart-ring-inner" />
        {/* The acceptance sweep: one arc, once, on accept. */}
        <span aria-hidden className="creator-smart-ring-arc" />

        <span className="creator-smart-ring-body">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- object URL of a local pick, never a remote asset
            <img src={imageUrl} alt="Selected photo preview" className="h-full w-full rounded-full object-cover" />
          ) : preview ? (
            <MeshPreview preview={preview} />
          ) : (
            <HeadGlyph className={cn(
              'creator-smart-glyph',
              state === 'rejected' && 'text-[#d09e88]/80',
            )} />
          )}
        </span>
      </label>

      <p
        className={cn(
          'creator-smart-headline',
          state === 'rejected' && 'text-[#e0a898]',
        )}
        role="status"
        aria-live="polite"
      >
        {headline}
      </p>
      <p className="creator-smart-detail" aria-live="polite">{detailLine}</p>

      <label className="creator-smart-upload">
        <input
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="M12 16V4m0 0L8 8m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" strokeLinecap="round" />
        </svg>
        <span>{ready ? 'Fit another head' : busy ? 'Fitting…' : 'Upload .obj or photo'}</span>
      </label>
    </div>
  );
}
