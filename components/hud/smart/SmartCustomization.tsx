'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useCharacter } from '@/lib/store';
import {
  discardPreview,
  markDownloaded,
  startConversion,
  useSmartSession,
} from '@/lib/smart/session';
import {
  SMART_ACCEPT,
  isImageFile,
  isObjFile,
  isUnsupportedMeshFile,
} from '@/lib/smart/smartMode';
import { downloadJslot, fitSummary } from '@/lib/smart/retarget';
import { SmartDropZone } from '@/components/hud/smart/SmartDropZone';
import '@/components/hud/smart/smart.css';

/**
 * Smart Customization — fit an isolated OBJ head onto the canonical UBE head.
 *
 * Only an OBJ is a fitting target; photos are preview-only and glTF/GLB is
 * rejected explicitly. Orchestration lives in `lib/smart/session.ts` (shared
 * with the footer); this component owns only the DOM and the fit panel.
 */

const PREVIEW_SIZE = 132;

function IconVoice({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="12" y="5" width="8" height="14" rx="4" />
      <path d="M8 15a8 8 0 0 0 16 0" strokeLinecap="round" />
      <path d="M16 23v4M12.5 27h7" strokeLinecap="round" />
    </svg>
  );
}

function IconImage({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M8 27V6.5A1.5 1.5 0 0 1 9.5 5H20l5 5v17a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 8 27Z" strokeLinejoin="round" />
      <path d="M20 5v5h5" strokeLinejoin="round" />
      <circle cx="13.2" cy="16" r="1.6" />
      <path d="M24 25.5 19 20 13.5 25.5" strokeLinejoin="round" />
    </svg>
  );
}

function IconGallery({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="5" y="8" width="22" height="17" rx="2" />
      <path d="M5 20.5 11 15l5 5 3.5-3.5L27 24" strokeLinejoin="round" />
      <circle cx="11.5" cy="13" r="1.6" />
    </svg>
  );
}

function IconShare({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M17 5h10v10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M27 5 16.5 15.5" strokeLinecap="round" />
      <path d="M24 19v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Millimetres, one decimal, for the fit readout. */
const mm = (metres: number) => `${(metres * 1000).toFixed(1)} mm`;
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

export function SmartCustomization() {
  const status = useSmartSession(s => s.status);
  const error = useSmartSession(s => s.error);
  const imageUrl = useSmartSession(s => s.imageUrl);
  const staged = useSmartSession(s => s.staged);
  const downloaded = useSmartSession(s => s.downloaded);
  const showImage = useSmartSession(s => s.showImage);
  const reject = useSmartSession(s => s.reject);

  const showToast = useCharacter(s => s.showToast);
  const [dragOver, setDragOver] = useState(false);
  const ownedImageUrl = useRef<string | null>(null);

  const revokeImage = useCallback(() => {
    if (ownedImageUrl.current) URL.revokeObjectURL(ownedImageUrl.current);
    ownedImageUrl.current = null;
  }, []);

  /* Object URLs are owned here; revoke on replace and on unmount, or every photo
     pick leaks a blob for the life of the tab. */
  useEffect(() => () => revokeImage(), [revokeImage]);

  /* Leaving the screen — navigation or unmount — cancels any in-flight fit and
     restores a staged preview. After Apply the session is already reset, so this
     restores nothing. */
  useEffect(() => () => discardPreview(), []);

  const handleFile = useCallback((file: File) => {
    /* Any new upload supersedes the current preview: restore the prior face and
       drop the previous dynamic head before doing anything else. */
    discardPreview();
    revokeImage();

    if (isImageFile(file.name)) {
      const url = URL.createObjectURL(file);
      ownedImageUrl.current = url;
      showImage(url);
      return;
    }

    if (isUnsupportedMeshFile(file.name)) {
      reject(
        `“${file.name}” is a glTF/GLB model. Smart Customization now fits an .obj head onto the UBE base — export this model as OBJ.`,
      );
      return;
    }

    if (!isObjFile(file.name)) {
      reject(
        `“${file.name}” is not a file this screen can use. Drop an isolated .obj head to fit it, or a .png/.jpg photo for a preview.`,
      );
      return;
    }

    void startConversion(file);
  }, [reject, revokeImage, showImage]);

  const onDragStateChange = useCallback((over: boolean) => setDragOver(over), []);

  const dropState = dragOver
    ? 'drag-over'
    : status === 'converting' ? 'converting'
      : status === 'preview-ready' ? 'preview-ready'
        : status === 'rejected' ? 'rejected'
          : status === 'image' ? 'image'
            : 'idle';

  const preview = staged ? { edges: staged.previewEdges, size: PREVIEW_SIZE } : null;

  const detail = staged ? fitSummary(staged.metrics) : null;

  const download = useCallback(() => {
    const current = useSmartSession.getState().staged;
    if (!current) return;
    downloadJslot(current.sculpt, current.sculptName);
    markDownloaded();
    showToast('Downloaded the .jslot sculpt — re-import it in the preset panel to restore this face.');
  }, [showToast]);

  const discard = useCallback(() => {
    discardPreview({ toast: 'Head restored' });
  }, []);

  const sources = [
    { id: 'voice' as const, label: 'Voice', icon: IconVoice, disabled: true, hint: 'Voice input is not part of this build' },
    { id: 'image' as const, label: 'Image', icon: IconImage, disabled: false, hint: 'Drop an .obj head to fit, or a photo for a preview' },
  ];

  return (
    <div className="creator-smart pointer-events-none absolute inset-0 z-20">
      {/* ── Left: source rail + dropzone ─────────────────────────────── */}
      <div className="creator-smart-main">
        <nav className="creator-smart-sources" aria-label="Smart customization source">
          {sources.map(({ id, label, icon: Icon, disabled, hint }) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              aria-pressed={!disabled}
              title={hint}
              className={cn(
                'creator-smart-source',
                !disabled && 'is-selected',
                disabled && 'is-disabled',
              )}
            >
              <span className="creator-smart-source-tile">
                <Icon className="h-6 w-6" />
                {disabled && <span aria-hidden className="creator-smart-source-soon">SOON</span>}
              </span>
              <span className="creator-smart-source-label">{label}</span>
            </button>
          ))}
        </nav>

        <div className="creator-smart-stage">
          <SmartDropZone
            state={dropState}
            accept={SMART_ACCEPT}
            preview={preview}
            imageUrl={imageUrl}
            fileName={staged?.name ?? null}
            error={error}
            detail={detail}
            onFile={handleFile}
            onDragStateChange={onDragStateChange}
          />

          {/* ── Fit panel — always on when a preview is ready ────────────── */}
          {staged && (
            <aside className="creator-smart-dev-panel" aria-label="Fitted head report">
              <div className="creator-smart-dev-head">
                <span>FITTED UBE HEAD</span>
                <span className="creator-smart-dev-dot" aria-hidden />
              </div>
              <dl>
                <div><dt>file</dt><dd title={staged.name}>{staged.name}</dd></div>
                <div><dt>fit strength</dt><dd>{pct(staged.metrics.fit_strength)}</dd></div>
                <div><dt>surface RMS</dt><dd>{mm(staged.metrics.face_surface_rms_m)}</dd></div>
                <div><dt>coverage (15mm)</dt><dd>{pct(staged.metrics.face_coverage_15mm)}</dd></div>
                <div><dt>collar move</dt><dd>{mm(staged.metrics.quality.collar_max_displacement_m)}</dd></div>
              </dl>
              <p>
                Approximate fit, not a likeness claim. Companion parts are unchanged.
                {' '}This sculpt is session-only — download the .jslot before Apply to keep it.
              </p>
              <div className="creator-smart-dev-actions">
                <button type="button" onClick={download}>
                  {downloaded ? 'Download .jslot again' : 'Download .jslot'}
                </button>
                <button type="button" onClick={discard}>
                  Discard
                </button>
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* ── Right: Gallery / Share ───────────────────────────────────── */}
      <div className="creator-smart-side">
        <button
          type="button"
          className="creator-smart-side-action"
          onClick={() => showToast('Gallery is not part of this build yet')}
        >
          <IconGallery className="h-5 w-5" />
          <span>Gallery</span>
        </button>
        <button
          type="button"
          className="creator-smart-side-action"
          onClick={() => showToast('Share is not part of this build yet')}
        >
          <IconShare className="h-5 w-5" />
          <span>Share</span>
        </button>
      </div>
    </div>
  );
}
