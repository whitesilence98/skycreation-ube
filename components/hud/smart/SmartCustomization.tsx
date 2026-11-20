'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { MeshImportError } from '@/lib/smart/headMesh';
import { readHeadFile } from '@/lib/smart/importHeadMesh';
import { useSmartSession } from '@/lib/smart/session';
import {
  IMAGE_ACCEPT,
  MESH_ACCEPT,
  isImageFile,
  isMeshFile,
  meshModeEnabled,
} from '@/lib/smart/smartMode';
import { SmartDropZone } from '@/components/hud/smart/SmartDropZone';
import '@/components/hud/smart/smart.css';

/**
 * Smart Customization — the "make me a face" screen.
 *
 * Composition follows the reference: a source rail on the left (Voice / Image,
 * plus the hidden Mesh test source), the ring dropzone in the left-centre
 * column, Gallery / Share on the right, and the hotkey bar at the bottom.
 * The character stays live on the canvas behind all of it, which is the point
 * of the screen — you see the change as you make it.
 *
 * The photo framing is kept deliberately: that is the product's promise. What
 * this build can actually do is assign a 3D head mesh, and the copy says so
 * rather than letting an upload silently do nothing.
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

function IconMesh({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M16 4 27 10v12L16 28 5 22V10Z" strokeLinejoin="round" />
      <path d="M16 4v24M5 10l11 6 11-6M5 22l11-6 11 6" strokeLinejoin="round" opacity="0.55" />
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

export function SmartCustomization({ manifest: _manifest }: { manifest: Mo2Manifest | null }) {
  const showToast = useCharacter(s => s.showToast);
  const setAssets = useCharacter(s => s.setAssets);
  const selectedHeadId = useCharacter(s => s.assetSelection.headMesh ?? null);

  const status = useSmartSession(s => s.status);
  const error = useSmartSession(s => s.error);
  const imageUrl = useSmartSession(s => s.imageUrl);
  const staged = useSmartSession(s => s.staged);
  const setStatus = useSmartSession(s => s.setStatus);
  const setError = useSmartSession(s => s.setError);
  const setImageUrl = useSmartSession(s => s.setImageUrl);

  const [dev] = useState(() => meshModeEnabled());
  /* `?smart=mesh` opens straight into the mesh test source; without it the
     Image tile is the only source and accepts both photos and meshes. */
  const [source, setSource] = useState<'image' | 'mesh'>(() => (meshModeEnabled() ? 'mesh' : 'image'));
  const [dragOver, setDragOver] = useState(false);
  const ownedImageUrl = useRef<string | null>(null);

  const accept = dev && source === 'mesh' ? MESH_ACCEPT : IMAGE_ACCEPT;

  /* Object URLs are owned by this component; revoke on replace and unmount, or
     every photo pick leaks an image blob for the life of the tab. */
  useEffect(() => () => {
    if (ownedImageUrl.current) URL.revokeObjectURL(ownedImageUrl.current);
    ownedImageUrl.current = null;
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setError(null);

    if (isImageFile(file.name)) {
      if (ownedImageUrl.current) URL.revokeObjectURL(ownedImageUrl.current);
      const url = URL.createObjectURL(file);
      ownedImageUrl.current = url;
      setImageUrl(url);
      setStatus('image');
      return;
    }

    if (!isMeshFile(file.name)) {
      setStatus('rejected');
      setError(`“${file.name}” is not a file this screen can use. Choose a .obj, .glb or .gltf mesh, or a .png/.jpg photo.`);
      return;
    }

    setStatus('parsing');
    try {
      const imported = await readHeadFile(file);
      /* Assign on accept rather than waiting for Apply: the whole promise of
         this screen is seeing the face change. `Space` keeps it, `Esc` puts the
         previous head back. */
      const previousHeadId = selectedHeadId;
      setAssets({ headMesh: imported.option.id });
      useSmartSession.getState().stage({
        name: file.name,
        verts: imported.option.shapes?.vertexCount ?? 0,
        tris: imported.option.shapes?.triangleCount ?? 0,
        scale: imported.mesh.scale,
        rotatedZUp: imported.mesh.rotatedZUp,
        previewEdges: imported.preview.edges,
        previousHeadId,
      });
      useSmartSession.getState().markApplied();
      showToast(`Applied ${file.name} to the head`);
    } catch (caught) {
      const message = caught instanceof MeshImportError
        ? caught.message
        : caught instanceof Error ? caught.message : 'this file could not be read';
      setStatus('rejected');
      setError(message);
    }
  }, [selectedHeadId, setAssets, setError, setImageUrl, setStatus, showToast]);

  const onDragStateChange = useCallback((over: boolean) => setDragOver(over), []);

  const dropState = dragOver
    ? 'drag-over'
    : status === 'image' ? 'image'
      : status === 'staged' ? 'staged'
        : status === 'rejected' ? 'rejected'
          : status === 'parsing' ? 'parsing'
            : 'idle';

  const preview = useMemo(
    () => (staged ? { edges: staged.previewEdges, size: PREVIEW_SIZE } : null),
    [staged],
  );

  const detail = staged
    ? `${staged.verts.toLocaleString()} verts · ${staged.tris.toLocaleString()} tris · ×${staged.scale.toFixed(3)}`
    : null;

  const sources = useMemo(() => {
    const list: Array<{
      id: 'voice' | 'image' | 'mesh';
      label: string;
      icon: (props: { className?: string }) => React.JSX.Element;
      disabled: boolean;
      hint: string;
    }> = [
      { id: 'voice', label: 'Voice', icon: IconVoice, disabled: true, hint: 'Voice input is not part of this build' },
      { id: 'image', label: 'Image', icon: IconImage, disabled: false, hint: 'Choose a photo or a 3D mesh' },
    ];
    if (dev) list.push({ id: 'mesh', label: 'Mesh', icon: IconMesh, disabled: false, hint: 'Test source — assign a mesh directly' });
    return list;
  }, [dev]);

  return (
    <div className="creator-smart pointer-events-none absolute inset-0 z-20">
      {/* ── Left: source rail + dropzone ─────────────────────────────── */}
      <div className="creator-smart-main">
        <nav className="creator-smart-sources" aria-label="Smart customization source">
          {sources.map(({ id, label, icon: Icon, disabled, hint }) => {
            const selected = id === source;
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                aria-pressed={!disabled && selected}
                title={hint}
                onClick={() => {
                  if (disabled) return;
                  setSource(id === 'mesh' ? 'mesh' : 'image');
                  if (id === 'mesh') {
                    useSmartSession.getState().clear();
                    if (ownedImageUrl.current) URL.revokeObjectURL(ownedImageUrl.current);
                    ownedImageUrl.current = null;
                    setImageUrl(null);
                  }
                }}
                className={cn('creator-smart-source', selected && !disabled && 'is-selected', disabled && 'is-disabled')}
              >
                <span className="creator-smart-source-tile">
                  <Icon className="h-6 w-6" />
                  {disabled && <span aria-hidden className="creator-smart-source-soon">SOON</span>}
                  {id === 'mesh' && <span aria-hidden className="creator-smart-source-dev">DEV</span>}
                </span>
                <span className="creator-smart-source-label">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="creator-smart-stage">
          <SmartDropZone
            state={dropState}
            accept={accept}
            preview={preview}
            imageUrl={imageUrl}
            fileName={staged?.name ?? null}
            error={error}
            detail={detail}
            onFile={handleFile}
            onDragStateChange={onDragStateChange}
          />
          {/* ── DEV diagnostics ──────────────────────────────────────────── */}
          {dev && (
        <aside className="creator-smart-dev-panel" aria-label="Mesh import diagnostics">
          <div className="creator-smart-dev-head">
            <span>MESH IMPORT · DEV</span>
            <span className="creator-smart-dev-dot" aria-hidden />
          </div>
          {staged ? (
            <>
              <dl>
                <div><dt>file</dt><dd title={staged.name}>{staged.name}</dd></div>
                <div><dt>vertices</dt><dd>{staged.verts.toLocaleString()}</dd></div>
                <div><dt>triangles</dt><dd>{staged.tris.toLocaleString()}</dd></div>
                <div><dt>scale</dt><dd>×{staged.scale.toFixed(4)}</dd></div>
                <div><dt>axis</dt><dd>{staged.rotatedZUp ? 'Z-up → Y-up' : 'Y-up'}</dd></div>
                <div><dt>slot</dt><dd>headMesh</dd></div>
              </dl>
              <div className="creator-smart-dev-actions">
                <button type="button" onClick={() => {
                  if (staged.previousHeadId !== null || useSmartSession.getState().applied) {
                    setAssets({ headMesh: staged.previousHeadId });
                  }
                  useSmartSession.getState().markReverted();
                  showToast('Head restored');
                }}>
                  Reset head
                </button>
                <button type="button" onClick={() => {
                  useSmartSession.getState().clear();
                  if (ownedImageUrl.current) URL.revokeObjectURL(ownedImageUrl.current);
                  ownedImageUrl.current = null;
                  setImageUrl(null);
                }}>
                  Clear
                </button>
              </div>
            </>
          ) : (
            <p>No mesh imported. Drop a .obj/.glb on the ring to test the head assignment.</p>
          )}
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
