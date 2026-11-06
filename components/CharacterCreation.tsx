'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Hud } from '@/components/hud/Hud';
import { resolveManifest } from '@/lib/manifestSelect';
import { useAssetCatalogues } from '@/lib/mo2/useAssetCatalogues';
import { resetAssetCatalogues } from '@/lib/mo2/client';
import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

/** A cold load reads a 2.2 MB head mesh plus a 4 k atlas; on a slow disk that
 *  can miss this. Past it the veil lifts regardless, so a dead URL degrades to
 *  a bare viewport instead of a spinner that never stops. */
const REVEAL_FAILSAFE_MS = 20_000;

const CharacterScene = dynamic(
  () => import('@/components/scene/CharacterScene').then((m) => m.CharacterScene),
  { ssr: false, loading: () => <SceneLoader visible /> },
);

/** The viewport's own ground: a warm core falling off to near-black. Shared by
 *  the JS-chunk wait, the asset wait and the canvas beneath it, so the three
 *  read as one continuous backdrop rather than three different screens. */
function ViewportBackdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-[#07070a]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_42%,#241a12_0%,#0d0b09_46%,#060608_100%)]" />
      <div className="absolute left-1/2 top-1/2 h-[420px] w-[320px] -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-[#d4b483]/[0.04] blur-3xl" />
    </>
  );
}

/**
 * Covers the viewport until the character is genuinely ready.
 *
 * The scene stays mounted underneath — it has to, or nothing would ever load —
 * but `HeadModel` keeps its group invisible until the mesh and the albedo are
 * both in. Without this the first frame was an untextured mannequin, and every
 * head-mesh swap flashed the procedural fallback again.
 *
 * `pointer-events-none` is load-bearing: orbit and zoom keep working behind it,
 * so the viewport never feels frozen. It fades rather than cuts and stays
 * mounted so that fade can actually run.
 */
function SceneLoader({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden={!visible}
      className={`pointer-events-none absolute inset-0 z-[5] transition-opacity duration-500 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <ViewportBackdrop />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[14px]">
        <span className="relative block h-[26px] w-[26px]">
          <span className="absolute inset-0 rounded-full border border-[#d4b483]/18" />
          <span className="absolute inset-0 animate-spin rounded-full border border-transparent border-t-[#d4b483]/85 shadow-[0_0_10px_rgba(212,180,131,0.22)]" />
        </span>
        <span className="text-[6.5px] tracking-[0.13em] text-[#9b9284]/72">LOADING ASSETS</span>
      </div>
    </div>
  );
}

/** Shown instead of a viewport when the active source is known to be
 *  unavailable. The scene is not mounted at all in this state: `HeadModel`
 *  would otherwise fall back to legacy `/assets/mo2` URLs, which is exactly the
 *  cross-source request pack mode must never make. */
function UnavailableNotice({ manifest }: { manifest: Mo2Manifest | null }) {
  const notes = manifest?.diagnostics ?? [];
  return (
    <div className="absolute inset-0 z-[6] flex items-center justify-center px-6">
      <ViewportBackdrop />
      <div className="relative max-w-[420px] border border-[#b56a5a]/32 bg-black/55 px-5 py-4 text-center backdrop-blur-md">
        <div className="text-[8px] tracking-[0.16em] text-[#dda898]/85">ASSETS UNAVAILABLE</div>
        <p className="mt-[7px] text-[7.5px] leading-[1.6] tracking-[0.04em] text-[#cbc1af]/72">
          {manifest?.sourceLayout === 'pack'
            ? 'The preset pack manifest could not be read. Run the pack sync, then reload.'
            : manifest?.sourceLayout === 'mo2'
              ? 'The MO2 asset manifest could not be read. Check the asset configuration, then reload.'
              : 'The asset source is not known. Start the app server and reload.'}
        </p>
        {notes.length ? (
          <div className="mt-[8px] border-t border-[#b56a5a]/22 pt-[6px] text-left text-[6.5px] leading-[1.5] text-[#c08f80]/72">
            {notes.slice(0, 4).map((note) => (
              <div key={note} className="truncate" title={note}>
                {note}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Shown over the viewport when the pack resolved but cannot draw the head.
 *  The loader settles (this is not a wait), and the reason is stated rather
 *  than leaving an empty stage. `role="status"` so it is announced when it
 *  appears. */
function SceneIssue({ issue }: { issue: string }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-0 bottom-[14%] z-[6] flex justify-center px-6"
    >
      <div className="border border-[#b56a5a]/32 bg-black/55 px-4 py-2 text-center backdrop-blur-md">
        <div className="text-[7.5px] leading-[1.5] tracking-[0.05em] text-[#dda898]/85">
          HEAD UNAVAILABLE — {issue}
        </div>
      </div>
    </div>
  );
}

export function CharacterCreation() {
  const [manifest, setManifest] = useState<Mo2Manifest | null>(null);
  /** The fetch resolving is what makes `manifest === null` mean "offline"
   *  rather than "not yet" — without it the first paint is indistinguishable
   *  from a failure and the procedural head would show first. */
  const [manifestSettled, setManifestSettled] = useState(false);
  const [assetsReady, setAssetsReady] = useState(false);
  const [sceneIssue, setSceneIssue] = useState<string | null>(null);
  const [revealFailsafe, setRevealFailsafe] = useState(false);
  const assetSelection = useCharacter((s) => s.assetSelection);
  const catalogues = useAssetCatalogues();
  const setAssetSource = useCharacter((s) => s.setAssetSource);

  useEffect(() => {
    let cancelled = false;
    const applySource = (info: { source?: string; sourceId?: string; sourceKey?: string } | null) => {
      resetAssetCatalogues();
      /* Include the resolved-root fingerprint: switching to a different pack
         that reuses the same source id must still clear the old catalogue ids. */
      const id = info?.sourceId ?? info?.source ?? null;
      setAssetSource(id === null ? null : `${id}:${info?.sourceKey ?? ''}`);
    };
    fetch('/api/mo2/manifest', { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (cancelled) return;
        if (r.ok && body) {
          applySource(body as Mo2Manifest);
          setManifest(body as Mo2Manifest);
          return;
        }
        /* Even a failed read still knows the active layout when the server
           sends it. Keeping that means pack mode never falls back to legacy
           `/assets/mo2` URLs just because the manifest is unavailable. */
        const info = body as
          | { source?: string; sourceId?: string; sourceKey?: string; sourceLayout?: 'pack' | 'mo2'; diagnostics?: string[]; error?: string }
          | null;
        if (info?.sourceLayout) {
          /* 503 carries the active identity, but nothing else: the source is
             known and unavailable, never "unknown → legacy". */
          applySource(info);
          setManifest({
            available: false,
            source: info.source ?? 'unavailable',
            sourceId: info.sourceId,
            sourceKey: info.sourceKey,
            sourceLayout: info.sourceLayout,
            diagnostics: info.diagnostics ?? (info.error ? [info.error] : []),
            textures: {},
          });
        } else {
          applySource(null);
          setManifest(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        /* Network failure: the source is genuinely unknown. Leaving the
           manifest null keeps the scene unmounted (unavailable notice), not
           falling back to legacy defaults. */
        applySource(null);
        setManifest(null);
      })
      .finally(() => {
        if (!cancelled) setManifestSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [setAssetSource]);

  useEffect(() => {
    if (assetsReady) return;
    const id = window.setTimeout(() => setRevealFailsafe(true), REVEAL_FAILSAFE_MS);
    return () => window.clearTimeout(id);
  }, [assetsReady]);

  const handleAssetsReady = useCallback((ready: boolean) => setAssetsReady(ready), []);
  const handleSceneIssue = useCallback((issue: string | null) => setSceneIssue(issue), []);

  /* The panel's picks are applied here, once, so both the scene and the HUD
     see the same flattened manifest. `resolveManifest` returns the original
     object when nothing is selected, which keeps the identity stable and
     stops the face bake from re-running on every render. */
  const resolved = useMemo(
    () => resolveManifest(manifest, assetSelection, catalogues),
    [manifest, assetSelection, catalogues],
  );

  /**
   * `null` = unknown (first paint / network failure), which must not be
   * treated as "legacy": mounting the scene there would request `/assets/mo2`
   * fallbacks. The scene mounts only once the manifest is settled and its
   * source is known and available.
   */
  const sourceKnown = manifestSettled && manifest !== null;
  const sceneReady = sourceKnown && manifest?.available === true;
  /* Settled without an available source — including a network failure, where
     the source is unknown — is a final state, not a longer spinner. */
  const unavailable = manifestSettled && !sceneReady;

  const loaded = sceneReady && (assetsReady || revealFailsafe);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#07070a]">
      {/* Nothing is mounted before the manifest settles and names its source:
          an early mount would issue legacy asset requests that pack mode must
          never make. */}
      {sceneReady ? (
        <CharacterScene
          manifest={resolved}
          onAssetsReady={handleAssetsReady}
          onIssue={handleSceneIssue}
        />
      ) : (
        <ViewportBackdrop />
      )}
      {unavailable ? <UnavailableNotice manifest={manifest} /> : <SceneLoader visible={!loaded} />}
      {sceneReady && sceneIssue && loaded ? <SceneIssue issue={sceneIssue} /> : null}
      {sceneReady ? <Hud manifest={resolved} /> : null}
    </main>
  );
}
