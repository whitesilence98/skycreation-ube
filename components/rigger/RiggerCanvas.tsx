'use client';

import * as THREE from 'three';
import { useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { GLTFLoader, OBJLoader } from 'three-stdlib';
import { useRiggerStore } from '@/lib/rigger/store';
import { nextUnplacedLandmark, LANDMARK_IDS, type LandmarkId, type VrmBoneName } from '@/lib/rigger/vrmSkeleton';
import { SkeletonOverlay } from '@/components/rigger/SkeletonOverlay';
import { LandmarkEditor, LANDMARK_META } from '@/components/rigger/LandmarkEditor';
import { buildWeightHeatmapColors } from '@/lib/rigger/weightTransfer';
import { createRiggedSkinnedMesh } from '@/lib/rigger/exportRiggedGlb';
import { driveTestAnimation, captureRestPose } from '@/lib/rigger/testAnimations';

// ─────────────────────────────────────────────────────────────────────────────
// Inner 3D Scene
// ─────────────────────────────────────────────────────────────────────────────

function SceneContent() {
  const meshUrl         = useRiggerStore((s) => s.meshUrl);
  const meshFile        = useRiggerStore((s) => s.meshFile);
  const stage           = useRiggerStore((s) => s.stage);
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
  const setMeshGeometry = useRiggerStore((s) => s.setMeshGeometry);
  const setMeshBbox     = useRiggerStore((s) => s.setMeshBbox);
  const setError        = useRiggerStore((s) => s.setError);
  const landmarks       = useRiggerStore((s) => s.landmarks);
  const setLandmarkMissFlash = useRiggerStore((s) => s.setLandmarkMissFlash);

  const [loadedObject, setLoadedObject] = useState<THREE.Object3D | null>(null);
  const primaryMeshRef = useRef<THREE.Mesh | null>(null);
  const pendingPoint = useRef<THREE.Vector3 | null>(null);
  const [ghost, setGhost] = useState<THREE.Vector3 | null>(null);

  // ── Skinned mesh for animation preview ────────────────────────────────────
  const weights = smoothWeights || rawWeights;
  const skinnedMesh = useMemo(() => {
    if (!fitResult || !weights || !primaryMeshRef.current?.geometry) return null;
    const geo = primaryMeshRef.current.geometry;
    const mat = primaryMeshRef.current.material ?? new THREE.MeshStandardMaterial({ color: 0xcccccc });
    return createRiggedSkinnedMesh(geo, mat, fitResult, weights);
  }, [fitResult, weights]);

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
      setMeshBbox(null);
      return;
    }

    const isObj = meshFile?.name.toLowerCase().endsWith('.obj');
    let isCancelled = false;

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
      scene.updateMatrixWorld(true);
      let targetMesh: THREE.Mesh | null = null;
      scene.traverse((child) => {
        const asMesh = child as THREE.Mesh;
        if (asMesh.isMesh) {
          if (!asMesh.raycast) asMesh.raycast = THREE.Mesh.prototype.raycast.bind(asMesh);
          asMesh.castShadow = true;
          asMesh.receiveShadow = true;
          if (!targetMesh) targetMesh = asMesh;
        }
      });
      if (!targetMesh) { setError('No mesh geometry found in uploaded file.'); return; }
      const geom = (targetMesh as THREE.Mesh).geometry;
      geom.computeBoundingBox();
      geom.computeVertexNormals();
      primaryMeshRef.current = targetMesh;
      setMeshGeometry(geom);
      setMeshBbox(new THREE.Box3().setFromObject(scene));
      setLoadedObject(scene);
    }

    return () => { isCancelled = true; };
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

  const handleMeshPointerDown = (e: { stopPropagation: () => void; point: THREE.Vector3; clientX?: number; clientY?: number }) => {
    if (!activeLandmark) return;
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
    const next = nextUnplacedLandmark(origin.id, { ...landmarks, [origin.id]: point });
    setActiveLandmark(next);
  };

  /* A miss used to do literally nothing. Surface it so the user can tell a
     misclick from a broken tool. */
  const handleMissed = () => {
    if (!activeLandmark) return;
    setLandmarkMissFlash(true);
    window.setTimeout(() => setLandmarkMissFlash(false), 900);
  };

  // Show live preview during landmark placement (not after full rig)
  const showLivePreview = stage !== 'idle' && stage !== 'done' && !fitResult;

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
            if (!activeLandmark) return;
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

      {/* Ghost marker: shows where the click would land. Placement was blind
          before this — the user aimed at an invisible target. */}
      {activeLandmark && ghost && (
        <mesh position={ghost}>
          <sphereGeometry args={[0.022, 12, 12]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.55} depthTest={false} />
        </mesh>
      )}

      {stage !== 'idle' && (
        <LandmarkEditor
          targetMeshRef={primaryMeshRef}
          showLivePreview={showLivePreview}
        />
      )}

      {/* Confirmed rig skeleton overlay (static joint spheres in T-pose, live SkeletonHelper when animating) */}
      {fitResult && (stage === 'done' && testAnimation !== 'tpose' ? (
        liveSkeletonHelper && showSkeleton ? (
          <primitive object={liveSkeletonHelper} />
        ) : null
      ) : (
        <SkeletonOverlay fitResult={fitResult} visible={showSkeleton} />
      ))}

      {/* Orbit stays live during placement — the click/drag slop in
          `handleMeshPointerUp` separates the two gestures. */}
      <OrbitControls makeDefault minDistance={0.2} maxDistance={20} enabled={!isDraggingLandmark} />
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
  const activeLandmark     = useRiggerStore((s) => s.activeLandmark);
  const setActiveLandmark  = useRiggerStore((s) => s.setActiveLandmark);
  const landmarks          = useRiggerStore((s) => s.landmarks);
  const landmarkCount      = Object.keys(landmarks).length;
  const missFlash          = useRiggerStore((s) => s.landmarkMissFlash);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveLandmark(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveLandmark]);

  return (
    <div
      className="relative w-full h-full bg-zinc-950 select-none"
      style={{ cursor: activeLandmark ? 'crosshair' : 'default' }}
    >
      <Canvas camera={{ position: [0, 1.2, 2.5], fov: 40 }} gl={{ antialias: true, alpha: false }} className="w-full h-full">
        <SceneContent />
      </Canvas>

      {/* Active landmark placement banner */}
      {activeLandmark && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none z-10">
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

      {/* Landmark placement progress badge */}
      {stage !== 'idle' && stage !== 'done' && !activeLandmark && landmarkCount > 0 && landmarkCount < 8 && (
        <div className="absolute top-4 right-4 pointer-events-none z-10">
          <div className="bg-zinc-900/90 border border-zinc-700 text-zinc-300 text-[11px] px-3 py-1.5 rounded-lg backdrop-blur-sm flex items-center gap-2">
            <span className="font-mono font-bold text-sky-400">{landmarkCount}/8</span>
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
              The auto-rigger will fit a full VRM 1.0 skeleton to your character.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
