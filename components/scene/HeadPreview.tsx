'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Suspense, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { buildHeadGeometry, buildNeckGeometry } from '@/lib/head/geometry';
import { createRig } from '@/lib/head/rig';
import {
  buildDetailTexture,
  buildFaceTexture,
  buildProjectedNormal,
  type Mo2Manifest,
} from '@/lib/head/faceTexture';
import { resolveManifest } from '@/lib/manifestSelect';
import { useAssetCatalogues } from '@/lib/mo2/useAssetCatalogues';
import { useCharacter } from '@/lib/store';
import { convertUrl } from '@/lib/mo2/client';
import { loadMask, type OverlayInput } from '@/lib/head/overlayLayers';

function Cam({ view }: { view: 'front' | 'side' | 'three' }) {
  const { camera } = useThree();
  useEffect(() => {
    // frame the whole head plus a little neck: head is ~0.28 m tall, so at
    // fov 26° it fills ~0.62 of the vertical at 0.80 m
    const d = 0.80;
    if (view === 'front') camera.position.set(0, -0.012, d);
    else if (view === 'side') camera.position.set(d, -0.004, 0.02);
    else camera.position.set(d * 0.58, d * 0.26, d * 0.77);
    camera.lookAt(0, -0.012, 0.02);
  }, [camera, view]);
  return null;
}

const QS = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const BARE = !!QS?.has('bare');
const NO_NORMAL = !!QS?.has('nonormal');
const SHOW_NORMALS = !!QS?.has('normals');
const FLAT_LIGHT = !!QS?.has('flatlight');

function Head({
  manifest,
  overlays,
}: {
  manifest: Mo2Manifest | null;
  overlays: OverlayInput[];
}) {
  const headBuild = useMemo(() => buildHeadGeometry(), []);
  const neckGeo = useMemo(() => buildNeckGeometry(), []);
  const rig = useMemo(() => createRig(headBuild.geometry), [headBuild]);
  const [state, setState] = useState<{
    tex: THREE.Texture;
    detail: THREE.Texture | null;
    normal: THREE.Texture | null;
  } | null>(null);

  /* The same pairing HeadModel uses: the skin's own projected `_n.dds` when
     it has one, the albedo Sobel only as a fallback. This route exists to
     debug the bake, so it has to show the bake the app actually renders. */
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      buildFaceTexture(manifest, overlays),
      buildProjectedNormal(manifest),
    ]).then(
      ([r, normal]) => {
        if (cancelled) return;
        setState({
          tex: r.texture,
          detail: normal ? null : buildDetailTexture(r.canvas),
          normal,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [manifest, overlays]);

  useEffect(() => {
    const m = rig.mesh.material as THREE.MeshStandardMaterial;
    rig.mesh.visible = !SHOW_NORMALS;
    if (BARE) {
      m.map = null;
      m.normalMap = null;
      m.color.set('#d8c0ae');
      m.needsUpdate = true;
      return;
    }
    if (!state) return;
    m.map = state.tex;
    const normal = state.normal ?? state.detail;
    m.normalMap = NO_NORMAL ? null : normal;
    /* The mod's normal is real relief at its authored strength; the Sobel is
       a stand-in and needs holding back. */
    const ns = state.normal ? 1.0 : 0.34;
    m.normalScale.set(ns, ns);
    m.color.set('#ffffff');
    m.roughness = 0.62;
    m.needsUpdate = true;
  }, [state, rig]);

  return (
    <>
      <primitive object={rig.root} />
      {SHOW_NORMALS ? (
        <mesh geometry={headBuild.geometry}>
          <meshNormalMaterial />
        </mesh>
      ) : null}
      <mesh geometry={neckGeo}>
        {/* The same neutral multiplier HeadModel applies, so the debug route
            can be trusted for the jawline. */}
        <meshStandardMaterial color="#cfc6bf" roughness={0.8} map={state?.tex ?? null} />
      </mesh>
    </>
  );
}

export function HeadPreview() {
  /* Resolved the same way the editor resolves it. Reading the raw manifest
     meant `/preview` disagreed with the app the moment anything was selected:
     the debug route always showed the default skin and eyes. The selection is
     read from the store, which is empty on a fresh tab, so the default is
     still what a first load shows.

     Like the editor, this route never falls back: the head only mounts after
     the active manifest is known and available, so pack mode issues no legacy
     `/assets/mo2` request. */
  const [manifest, setManifest] = useState<Mo2Manifest | null>(null);
  const [settled, setSettled] = useState(false);
  const selection = useCharacter((s) => s.assetSelection);
  const catalogues = useAssetCatalogues();
  const overlayLayers = useCharacter((s) => s.overlayLayers);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/mo2/manifest', { cache: 'no-store' })
      .then(async (r) => {
        const raw = (await r.json().catch(() => null)) as Mo2Manifest | null;
        if (cancelled) return;
        setManifest(r.ok && raw?.available ? raw : null);
      })
      .catch(() => {
        if (!cancelled) setManifest(null);
      })
      .finally(() => {
        if (!cancelled) setSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolved = useMemo(() => resolveManifest(manifest, selection, catalogues), [manifest, selection, catalogues]);
  const [overlayImages, setOverlayImages] = useState<OverlayInput[]>([]);
  const overlayKey = overlayLayers.map((l) => `${l.kind}:${l.id}`).join('|');
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      overlayLayers.map(async (layer) => ({
        layer,
        mask: await loadMask(convertUrl({ kind: layer.kind, id: layer.id, mode: 'alpha' })),
      })),
    ).then((v) => {
      if (!cancelled) setOverlayImages(v);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKey]);

  return (
    <Canvas
      style={{ position: 'fixed', inset: 0, background: '#14100e' }}
      camera={{ fov: 26, near: 0.01, far: 8, position: [0, -0.012, 0.8] }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
    >
      <color attach="background" args={['#14100e']} />
      {FLAT_LIGHT ? (
        <ambientLight intensity={2.4} color="#ffffff" />
      ) : (
        <>
          <ambientLight intensity={0.55} color="#ffe6d2" />
          <directionalLight position={[-0.5, 0.65, 0.9]} intensity={2.6} color="#ffd9b8" />
          <directionalLight position={[0.8, 0.05, 0.35]} intensity={0.85} color="#9fbcd8" />
          <directionalLight position={[0.2, 0.4, -0.8]} intensity={1.2} color="#8fb0c4" />
        </>
      )}
      <Cam view="front" />
      <OrbitControls target={[0, -0.02, 0.03]} />
      {/* No fallback head before the manifest settles: a procedural head here
          would make the debug route disagree with the editor, and pack mode
          must never stand one in for an unavailable source. */}
      <Suspense fallback={null}>
        {settled && manifest ? <Head manifest={resolved} overlays={overlayImages} /> : null}
      </Suspense>
    </Canvas>
  );
}
