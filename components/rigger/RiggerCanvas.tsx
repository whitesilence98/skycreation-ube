'use client';

import * as THREE from 'three';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { GLTFLoader, OBJLoader } from 'three-stdlib';
import { useRiggerStore } from '@/lib/rigger/store';
import { getLandmarkIdsForPreset, nextUnplacedLandmark, type LandmarkId, type VrmBoneName } from '@/lib/rigger/vrmSkeleton';
import { SkeletonOverlay } from '@/components/rigger/SkeletonOverlay';
import { LandmarkEditor, LANDMARK_META, type OrbitControlsLike } from '@/components/rigger/LandmarkEditor';
import { RiggerStepBar } from '@/components/rigger/RiggerSidebar';
import { buildWeightHeatmapColors } from '@/lib/rigger/weightTransfer';
import { createRiggedSkinnedMesh } from '@/lib/rigger/exportRiggedGlb';
import {
  driveTestAnimation,
  captureRestPose,
  preloadGlbAnimations,
  type TestAnimationMode,
} from '@/lib/rigger/testAnimations';
import { bakeAndMergeSceneMeshes, transformMeshGeometry } from '@/lib/rigger/normalizeMesh';

type CameraViewPreset = 'front' | 'side' | 'back' | 'fit';

// ─────────────────────────────────────────────────────────────────────────────
// Inner 3D Scene
// ─────────────────────────────────────────────────────────────────────────────

interface SceneContentProps {
  cameraSnapRef: React.MutableRefObject<((preset: CameraViewPreset) => void) | null>;
  meshTransformRef: React.MutableRefObject<((axis: 'x' | 'y' | 'z', deg: number) => void) | null>;
  onDraggingChange: (id: LandmarkId | null, shiftHeld: boolean) => void;
}

function SceneContent({ cameraSnapRef, meshTransformRef, onDraggingChange }: SceneContentProps) {
  const meshUrl         = useRiggerStore((s) => s.meshUrl);
  const meshFile        = useRiggerStore((s) => s.meshFile);
  const meshBbox        = useRiggerStore((s) => s.meshBbox);
  const stage           = useRiggerStore((s) => s.stage);
  const uiPhase         = useRiggerStore((s) => s.uiPhase);
  const lockCamera      = useRiggerStore((s) => s.lockCamera);
  const fitResult       = useRiggerStore((s) => s.fitResult);
  const showSkeleton    = useRiggerStore((s) => s.showSkeleton);
  const showWeightMap   = useRiggerStore((s) => s.showWeightMap);
  const smoothWeights   = useRiggerStore((s) => s.smoothWeights);
  const rawWeights      = useRiggerStore((s) => s.rawWeights);
  const testAnimation   = useRiggerStore((s) => s.testAnimation);
  const isDraggingLandmark = useRiggerStore((s) => s.isDraggingLandmark);
  const activeLandmark  = useRiggerStore((s) => s.activeLandmark);
  const setLandmark     = useRiggerStore((s) => s.setLandmark);
  const setActiveLandmark = useRiggerStore((s) => s.setActiveLandmark);
  const clearLandmarks  = useRiggerStore((s) => s.clearLandmarks);
  const setStage        = useRiggerStore((s) => s.setStage);
  const setMeshGeometry = useRiggerStore((s) => s.setMeshGeometry);
  const setMeshMaterial = useRiggerStore((s) => s.setMeshMaterial);
  const setMeshBbox     = useRiggerStore((s) => s.setMeshBbox);
  const setError        = useRiggerStore((s) => s.setError);
  const landmarks       = useRiggerStore((s) => s.landmarks);
  const setLandmarkMissFlash = useRiggerStore((s) => s.setLandmarkMissFlash);

  const { camera } = useThree();
  const orbitControlsRef = useRef<OrbitControlsLike | null>(null);
  const [loadedObject, setLoadedObject] = useState<THREE.Object3D | null>(null);
  const primaryMeshRef = useRef<THREE.Mesh | null>(null);
  const pendingPoint = useRef<THREE.Vector3 | null>(null);
  const [ghost, setGhost] = useState<THREE.Vector3 | null>(null);

  // ── Camera snap presets (Mixamo Front / Side / Back / Fit) ─────────────────
  const snapCamera = useCallback(
    (preset: CameraViewPreset, boxOverride?: THREE.Box3 | null) => {
      const bb = boxOverride ?? meshBbox;
      const center = bb ? bb.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0.85, 0);
      const size   = bb ? bb.getSize(new THREE.Vector3())   : new THREE.Vector3(0.6, 1.7, 0.4);
      const span   = Math.max(size.y, size.x * 0.85, 0.6);
      const dist   = span * 1.7;

      const controls = orbitControlsRef.current;
      if (preset === 'front') {
        camera.position.set(center.x, center.y + size.y * 0.03, center.z + dist);
      } else if (preset === 'back') {
        camera.position.set(center.x, center.y + size.y * 0.03, center.z - dist);
      } else if (preset === 'side') {
        camera.position.set(center.x + dist, center.y + size.y * 0.03, center.z);
      } else {
        // Fit: keep current viewing angle, re-center & scale distance to bbox
        const prevTarget = controls ? controls.target : center;
        const dir = camera.position.clone().sub(prevTarget);
        if (dir.lengthSq() < 1e-6) dir.set(0, 0.05, 1);
        dir.normalize();
        camera.position.copy(center).addScaledVector(dir, dist);
      }

      if (controls) {
        controls.target.copy(center);
        controls.update();
      } else {
        camera.lookAt(center);
      }
    },
    [camera, meshBbox],
  );

  useEffect(() => {
    cameraSnapRef.current = (preset) => snapCamera(preset);
    return () => { cameraSnapRef.current = null; };
  }, [cameraSnapRef, snapCamera]);

  useEffect(() => {
    meshTransformRef.current = (axis, deg) => {
      const mesh = primaryMeshRef.current;
      if (!mesh || stage === 'rigging' || stage === 'done') return;
      const bb = transformMeshGeometry(mesh, axis, (deg * Math.PI) / 180);
      clearLandmarks();
      setStage('mesh-loaded');
      setMeshBbox(bb);
      snapCamera('front', bb);
    };
    return () => { meshTransformRef.current = null; };
  }, [meshTransformRef, stage, clearLandmarks, setStage, setMeshBbox, snapCamera]);

  // ── Skinned mesh for animation preview ────────────────────────────────────
  const weights = smoothWeights || rawWeights;
  const skinnedMesh = useMemo(() => {
    if (!fitResult || !weights || !primaryMeshRef.current?.geometry) return null;
    const geo = primaryMeshRef.current.geometry;
    const mat = primaryMeshRef.current.material ?? new THREE.MeshStandardMaterial({ color: 0xcccccc });
    return createRiggedSkinnedMesh(geo, mat, fitResult, weights);
  }, [fitResult, weights]);

  useEffect(() => {
    void preloadGlbAnimations();
  }, []);

  // Capture rest pose quaternions once when skinnedMesh is built
  const restQuatsRef = useRef<Map<VrmBoneName, THREE.Quaternion>>(new Map());
  const boneMapRef   = useRef<Map<VrmBoneName, THREE.Bone>>(new Map());
  useEffect(() => {
    if (!fitResult || !skinnedMesh) return;
    boneMapRef.current = fitResult.built.boneMap as Map<VrmBoneName, THREE.Bone>;
    restQuatsRef.current = captureRestPose(boneMapRef.current);
  }, [fitResult, skinnedMesh]);

  // Immediately reset bones to rest pose when returning to T-pose
  useEffect(() => {
    if (testAnimation === 'tpose' && fitResult && restQuatsRef.current.size > 0) {
      driveTestAnimation(boneMapRef.current, restQuatsRef.current, 'tpose', 0);
      fitResult.built.root.updateMatrixWorld(true);
    }
  }, [testAnimation, fitResult]);

  // Animation loop
  useFrame(({ clock }) => {
    if (stage !== 'done' || !skinnedMesh || !fitResult || restQuatsRef.current.size === 0) return;
    if (testAnimation === 'tpose') return;
    driveTestAnimation(boneMapRef.current, restQuatsRef.current, testAnimation, clock.getElapsedTime());
    fitResult.built.root.updateMatrixWorld(true);
  });

  // ── Load Mesh ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!meshUrl) {
      setLoadedObject(null);
      primaryMeshRef.current = null;
      setMeshGeometry(null);
      setMeshMaterial(null);
      setMeshBbox(null);
      return;
    }

    const isObj = meshFile?.name.toLowerCase().endsWith('.obj');
    let isCancelled = false;
    let bakedMesh: THREE.Mesh | null = null;

    if (isObj) {
      new OBJLoader().load(
        meshUrl,
        (obj) => { if (!isCancelled) processLoadedScene(obj); },
        undefined,
        (err) => { if (!isCancelled) setError(`OBJ load failed: ${err instanceof Error ? err.message : String(err)}`); },
      );
    } else {
      new GLTFLoader().load(
        meshUrl,
        (gltf) => { if (!isCancelled) processLoadedScene(gltf.scene || gltf.scenes[0]); },
        undefined,
        (err) => { if (!isCancelled) setError(`GLB load failed: ${err instanceof Error ? err.message : String(err)}`); },
      );
    }

    function processLoadedScene(scene: THREE.Object3D) {
      const merged = bakeAndMergeSceneMeshes(scene);
      if (!merged) { setError('No mesh geometry found in uploaded file.'); return; }
      bakedMesh = merged;
      const geom = merged.geometry;
      geom.computeBoundingBox();
      primaryMeshRef.current = merged;
      const bb = geom.boundingBox?.clone() ?? new THREE.Box3().setFromObject(merged);
      setMeshGeometry(geom);
      setMeshMaterial(merged.material);
      setMeshBbox(bb);
      setLoadedObject(merged);
      snapCamera('front', bb);
    }

    return () => {
      isCancelled = true;
      bakedMesh?.geometry.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshUrl, meshFile, setError, setMeshBbox, setMeshGeometry]);

  // ── Heatmap colors ─────────────────────────────────────────────────────────
  const heatmapColors = useMemo(() => {
    if (!showWeightMap || !weights || !fitResult) return null;
    return buildWeightHeatmapColors(weights, fitResult.built.bones.length);
  }, [showWeightMap, weights, fitResult]);

  useEffect(() => {
    const targets = [primaryMeshRef.current, skinnedMesh].filter(
      (m): m is THREE.Mesh => m !== null,
    );
    if (targets.length === 0) return;

    for (const mesh of targets) {
      if (heatmapColors) {
        mesh.geometry.setAttribute('color', new THREE.BufferAttribute(heatmapColors, 3));
      } else if (mesh.geometry.getAttribute('color')) {
        mesh.geometry.deleteAttribute('color');
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        m.vertexColors = Boolean(heatmapColors);
        m.needsUpdate = true;
      });
    }
  }, [heatmapColors, skinnedMesh]);

  // Dispose cloned skinned geometry when replaced or unmounted
  useEffect(() => {
    return () => {
      skinnedMesh?.geometry.dispose();
    };
  }, [skinnedMesh]);

  // Live SkeletonHelper that tracks animated bones
  const liveSkeletonHelper = useMemo(() => {
    if (!fitResult) return null;
    const helper = new THREE.SkeletonHelper(fitResult.built.root);
    const mat = helper.material as THREE.LineBasicMaterial;
    mat.depthTest = false;
    mat.transparent = true;
    mat.opacity = 0.85;
    return helper;
  }, [fitResult]);

  useEffect(() => {
    return () => {
      liveSkeletonHelper?.dispose();
    };
  }, [liveSkeletonHelper]);

  // ── Click-to-place active landmark ────────────────────────────────────────
  /* Orbiting and placing used to be mutually exclusive: selecting a marker
     disabled OrbitControls, so looking at the far side of the model meant
     Esc → orbit → re-select, eight times. Instead we let the camera stay live
     and decide on pointer-up: a press that barely moved is a placement, a
     press that travelled is an orbit. */
  const pressOrigin = useRef<{ x: number; y: number; id: LandmarkId } | null>(null);
  const CLICK_SLOP_PX = 5;

  const handleMeshPointerDown = (e: {
    stopPropagation: () => void;
    point: THREE.Vector3;
    clientX?: number;
    clientY?: number;
    intersections?: Array<{ object: THREE.Object3D }>;
  }) => {
    // Always let Mixamo-style landmark handles win even if buried inside the mesh
    if (e.intersections?.some((hit) => Boolean(hit.object.userData?.landmarkHandleId))) {
      return;
    }
    if (uiPhase !== 'rig' || !activeLandmark) return;
    e.stopPropagation();
    pressOrigin.current = { x: e.clientX ?? 0, y: e.clientY ?? 0, id: activeLandmark };
    // Record where the press landed; the commit happens on pointer-up.
    pendingPoint.current = e.point.clone();
  };

  const handleMeshPointerUp = (e: { clientX?: number; clientY?: number }) => {
    const origin = pressOrigin.current;
    pressOrigin.current = null;
    if (!origin) return;
    const dx = (e.clientX ?? 0) - origin.x;
    const dy = (e.clientY ?? 0) - origin.y;
    // The pointer travelled: the user was orbiting, not placing.
    if (Math.hypot(dx, dy) > CLICK_SLOP_PX) return;
    const point = pendingPoint.current;
    pendingPoint.current = null;
    if (!point) return;
    setLandmark(origin.id, point);
    // Advance straight to the next empty marker — Mixamo-style — instead of
    // dropping the user back to the sidebar after every single click.
    const activeOrder = getLandmarkIdsForPreset(useRiggerStore.getState().landmarkPreset);
    const next = nextUnplacedLandmark(origin.id, { ...landmarks, [origin.id]: point }, activeOrder);
    setActiveLandmark(next);
  };

  /* A miss used to do literally nothing. Surface it so the user can tell a
     misclick from a broken tool. */
  const handleMissed = () => {
    if (uiPhase !== 'rig' || !activeLandmark) return;
    setLandmarkMissFlash(true);
    window.setTimeout(() => setLandmarkMissFlash(false), 900);
  };

  // Show live preview during landmark placement only in Phase 1 (Rig)
  const showLivePreview = uiPhase === 'rig' && stage !== 'idle' && stage !== 'done' && !fitResult;

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 10, 7]} intensity={1.4} castShadow />
      <directionalLight position={[-5, 5, -5]} intensity={0.5} />
      <gridHelper args={[10, 20, '#3f3f46', '#27272a']} position={[0, -0.001, 0]} />

      {loadedObject && (
        <primitive
          object={loadedObject}
          visible={!(stage === 'done' && skinnedMesh && testAnimation !== 'tpose')}
          onPointerDown={handleMeshPointerDown}
          onPointerUp={handleMeshPointerUp}
          onPointerMissed={handleMissed}
          onPointerMove={(e: { point: THREE.Vector3 }) => {
            if (uiPhase !== 'rig' || !activeLandmark) return;
            setGhost(e.point.clone());
          }}
        />
      )}

      {/* Live-animated SkinnedMesh — shown only when rig is done and animating */}
      {stage === 'done' && skinnedMesh && testAnimation !== 'tpose' && (
        <>
          <primitive object={skinnedMesh} />
          {fitResult && <primitive object={fitResult.built.root} />}
        </>
      )}

      {/* Ghost marker: shows where the click would land during Phase 1 placement */}
      {uiPhase === 'rig' && activeLandmark && ghost && (
        <mesh position={ghost}>
          <sphereGeometry args={[0.022, 12, 12]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.55} depthTest={false} />
        </mesh>
      )}

      {/* Draggable landmark handles & pills — ONLY shown in Phase 1 (Rig), hidden in Preview & Export */}
      {uiPhase === 'rig' && stage !== 'idle' && (
        <LandmarkEditor
          targetMeshRef={primaryMeshRef}
          orbitControlsRef={orbitControlsRef}
          showLivePreview={showLivePreview}
          onDraggingChange={onDraggingChange}
        />
      )}

      {/* Confirmed rig skeleton overlay (toggleable in Preview/Export; zero landmark clutter) */}
      {fitResult && (stage === 'done' && testAnimation !== 'tpose' ? (
        liveSkeletonHelper && showSkeleton ? (
          <primitive object={liveSkeletonHelper} />
        ) : null
      ) : (
        <SkeletonOverlay fitResult={fitResult} visible={showSkeleton} />
      ))}

      {/* Orbit stays live during placement unless user explicitly locks camera in Phase 1 */}
      <OrbitControls
        ref={orbitControlsRef as React.RefObject<React.ComponentRef<typeof OrbitControls>>}
        makeDefault
        minDistance={0.2}
        maxDistance={20}
        enabled={!isDraggingLandmark && !(uiPhase === 'rig' && lockCamera)}
      />
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#ffffff" />
      </GizmoHelper>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Canvas Component
// ─────────────────────────────────────────────────────────────────────────────

export function RiggerCanvas() {
  const stage              = useRiggerStore((s) => s.stage);
  const uiPhase            = useRiggerStore((s) => s.uiPhase);
  const setUiPhase         = useRiggerStore((s) => s.setUiPhase);
  const backToRig          = useRiggerStore((s) => s.backToRig);
  const lockCamera         = useRiggerStore((s) => s.lockCamera);
  const setLockCamera      = useRiggerStore((s) => s.setLockCamera);
  const fitResult          = useRiggerStore((s) => s.fitResult);
  const showSkeleton       = useRiggerStore((s) => s.showSkeleton);
  const showWeightMap      = useRiggerStore((s) => s.showWeightMap);
  const testAnimation      = useRiggerStore((s) => s.testAnimation);
  const toggleSkeleton     = useRiggerStore((s) => s.toggleSkeleton);
  const toggleWeightMap    = useRiggerStore((s) => s.toggleWeightMap);
  const setTestAnimation   = useRiggerStore((s) => s.setTestAnimation);
  const activeLandmark     = useRiggerStore((s) => s.activeLandmark);
  const setActiveLandmark  = useRiggerStore((s) => s.setActiveLandmark);
  const landmarks          = useRiggerStore((s) => s.landmarks);
  const landmarkPreset     = useRiggerStore((s) => s.landmarkPreset);
  const activeIds          = getLandmarkIdsForPreset(landmarkPreset);
  const placedInPreset     = activeIds.filter((id) => Boolean(landmarks[id])).length;
  const totalInPreset      = activeIds.length;
  const missFlash          = useRiggerStore((s) => s.landmarkMissFlash);
  const useSymmetry        = useRiggerStore((s) => s.useSymmetry);

  const cameraSnapRef    = useRef<((preset: CameraViewPreset) => void) | null>(null);
  const meshTransformRef = useRef<((axis: 'x' | 'y' | 'z', deg: number) => void) | null>(null);
  const [dragInfo, setDragInfo] = useState<{ id: LandmarkId; shiftHeld: boolean } | null>(null);

  const handleDraggingChange = useCallback((id: LandmarkId | null, shiftHeld: boolean) => {
    setDragInfo(id ? { id, shiftHeld } : null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (useRiggerStore.getState().activeLandmark) {
          setActiveLandmark(null);
        } else if (useRiggerStore.getState().uiPhase === 'export') {
          setUiPhase('preview');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveLandmark, setUiPhase]);

  return (
    <div
      className="relative w-full h-full bg-zinc-950 select-none"
      style={{ cursor: uiPhase === 'rig' && dragInfo ? 'grabbing' : uiPhase === 'rig' && activeLandmark ? 'crosshair' : 'default' }}
    >
      <Canvas camera={{ position: [0, 1.2, 2.5], fov: 40 }} gl={{ antialias: true, alpha: false }} className="w-full h-full">
        <SceneContent
          cameraSnapRef={cameraSnapRef}
          meshTransformRef={meshTransformRef}
          onDraggingChange={handleDraggingChange}
        />
      </Canvas>

      {/* Camera quick-snap bar + Phase 1 mesh rotation / cam lock controls */}
      {stage !== 'idle' && (
        <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/90 p-1 backdrop-blur-sm shadow-lg max-w-[calc(100vw-24px)]">
          {([
            ['front', 'Front'],
            ['side',  'Side'],
            ['back',  'Back'],
            ['fit',   'Fit'],
          ] as const).map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              onClick={() => cameraSnapRef.current?.(preset)}
              className="min-h-[26px] px-2.5 py-1 rounded-md text-[10px] font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              {label}
            </button>
          ))}
          {uiPhase === 'rig' && stage !== 'done' && stage !== 'rigging' && (
            <>
              <div className="h-4 w-px bg-zinc-700 mx-0.5" />
              <button
                type="button"
                title="Rotate model 90° around Y axis"
                onClick={() => meshTransformRef.current?.('y', 90)}
                className="min-h-[26px] px-2 py-1 rounded-md text-[10px] font-medium text-sky-300 hover:text-white hover:bg-sky-950/60 transition-colors"
              >
                ↺ 90°
              </button>
              <button
                type="button"
                title="Flip model 180° around Y axis"
                onClick={() => meshTransformRef.current?.('y', 180)}
                className="min-h-[26px] px-2 py-1 rounded-md text-[10px] font-medium text-sky-300 hover:text-white hover:bg-sky-950/60 transition-colors"
              >
                ⇄ 180°
              </button>
              <button
                type="button"
                title="Rotate model 90° around X axis (fix Z-up / lying down)"
                onClick={() => meshTransformRef.current?.('x', -90)}
                className="min-h-[26px] px-2 py-1 rounded-md text-[10px] font-medium text-sky-300 hover:text-white hover:bg-sky-950/60 transition-colors"
              >
                ↕ X90°
              </button>
              <div className="h-4 w-px bg-zinc-700 mx-0.5" />
              <button
                type="button"
                title={lockCamera ? 'Camera orbit locked for marker precision (click to unlock)' : 'Lock camera orbit while placing markers'}
                onClick={() => setLockCamera(!lockCamera)}
                className={`min-h-[26px] px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                  lockCamera
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`}
              >
                {lockCamera ? '🔒 Cam Locked' : '🔓 Lock Cam'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Phase 2 Preview — top-right compact step indicator & Creator link */}
      {uiPhase === 'preview' && (
        <div className="hidden sm:flex absolute top-3 right-3 z-10 items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/90 px-3 py-1.5 backdrop-blur-sm shadow-lg">
          <div className="w-44">
            <RiggerStepBar step={2} />
          </div>
          <div className="h-6 w-px bg-zinc-800" />
          <a
            href="/"
            className="min-h-[26px] inline-flex items-center text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-950/60 border border-zinc-800 px-2 py-1 rounded-md no-underline transition-colors"
          >
            ← Creator
          </a>
        </div>
      )}

      {/* Phase 2 Preview — floating bottom control dock */}
      {uiPhase === 'preview' && stage === 'done' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[calc(100%-24px)] max-w-3xl flex justify-center pointer-events-none">
          <div className="pointer-events-auto bg-zinc-900/95 border border-zinc-700/80 backdrop-blur-md rounded-2xl shadow-2xl px-3 py-2 flex flex-wrap items-center justify-center gap-2">
            {/* Test animation bar */}
            <div className="flex items-center gap-1 bg-zinc-950/70 p-1 rounded-xl border border-zinc-800">
              {(['tpose', 'idle', 'walk', 'run'] as TestAnimationMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTestAnimation(mode)}
                  className={`min-h-[28px] px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                    testAnimation === mode
                      ? 'bg-sky-500 text-white shadow-[0_0_10px_rgba(14,165,233,0.45)]'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80'
                  }`}
                >
                  {mode === 'tpose' ? 'T-Pose' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>

            <div className="hidden sm:block h-5 w-px bg-zinc-700" />

            {/* Skeleton & Weights toggles */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleSkeleton}
                disabled={!fitResult}
                className={`min-h-[28px] px-2.5 py-1 rounded-lg border text-[10px] font-medium transition-colors ${
                  showSkeleton
                    ? 'border-sky-500/60 bg-sky-950/50 text-sky-300'
                    : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                🦴 Skeleton
              </button>
              <button
                type="button"
                onClick={toggleWeightMap}
                className={`min-h-[28px] px-2.5 py-1 rounded-lg border text-[10px] font-medium transition-colors ${
                  showWeightMap
                    ? 'border-sky-500/60 bg-sky-950/50 text-sky-300'
                    : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                🎨 Weights
              </button>
            </div>

            <div className="hidden sm:block h-5 w-px bg-zinc-700" />

            {/* Phase flow actions */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={backToRig}
                className="min-h-[30px] px-3 py-1.5 rounded-xl text-[11px] font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
              >
                ← Back to Markers
              </button>
              <button
                type="button"
                onClick={() => setUiPhase('export')}
                className="min-h-[30px] px-3.5 py-1.5 rounded-xl text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)] transition-all"
              >
                ⬇ Export →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live drag feedback banner (Phase 1 only) */}
      {uiPhase === 'rig' && dragInfo && (
        <div className="absolute top-14 sm:top-4 left-1/2 -translate-x-1/2 pointer-events-none z-10">
          <div className="bg-zinc-900/95 border border-zinc-700 text-zinc-100 text-xs font-medium px-4 py-2 rounded-full backdrop-blur-sm shadow-xl flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full inline-block"
              style={{ background: LANDMARK_META[dragInfo.id].color }}
            />
            <span>
              Dragging <strong className="text-white">{LANDMARK_META[dragInfo.id].label}</strong>
            </span>
            <span className="text-zinc-500">·</span>
            <span className={`text-[10px] ${useSymmetry ? 'text-sky-400' : 'text-zinc-400'}`}>
              Mirror {useSymmetry ? 'ON' : 'OFF'}
            </span>
            <span className="text-zinc-500">·</span>
            <span className={`text-[10px] font-medium ${dragInfo.shiftHeld ? 'text-emerald-400' : 'text-zinc-400'}`}>
              {dragInfo.shiftHeld ? 'Surface Snap ON' : 'Hold Shift for Surface Snap'}
            </span>
          </div>
        </div>
      )}

      {/* Active landmark placement banner (Phase 1 only) */}
      {uiPhase === 'rig' && !dragInfo && activeLandmark && (
        <div className="absolute top-14 sm:top-4 left-1/2 -translate-x-1/2 pointer-events-none z-10">
          <div className="bg-sky-900/95 border border-sky-400/60 text-sky-100 text-xs font-semibold px-5 py-2.5 rounded-full backdrop-blur-sm shadow-xl flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse inline-block" />
            {missFlash ? (
              <span className="text-amber-300 font-bold">Missed the mesh — click on the body</span>
            ) : (
              <>
                Click on mesh to place <span className="text-white font-bold ml-1">{LANDMARK_META[activeLandmark]?.label || activeLandmark}</span>
                <span className="text-sky-400 ml-1 font-normal text-[10px]">· orbit to rotate · Esc to cancel</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Landmark placement progress badge (Phase 1 only) */}
      {uiPhase === 'rig' && stage !== 'idle' && stage !== 'done' && !activeLandmark && placedInPreset > 0 && placedInPreset < totalInPreset && (
        <div className="absolute top-4 right-4 pointer-events-none z-10">
          <div className="bg-zinc-900/90 border border-zinc-700 text-zinc-300 text-[11px] px-3 py-1.5 rounded-lg backdrop-blur-sm flex items-center gap-2">
            <span className="font-mono font-bold text-sky-400">{placedInPreset}/{totalInPreset}</span>
            <span>markers placed</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {stage === 'idle' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center p-8 rounded-2xl bg-zinc-900/80 border border-zinc-800 backdrop-blur-md max-w-sm">
            <div className="text-5xl mb-4">🦴</div>
            <h3 className="text-base font-semibold text-zinc-100">Drop a 3D Model to Begin</h3>
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              Upload a humanoid GLB or OBJ mesh from the panel on the left.<br />
              Rig first, preview without marker clutter, then export GLB or FBX.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
