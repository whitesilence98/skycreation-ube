'use client';

import * as THREE from 'three';
import { useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Center } from '@react-three/drei';
import { GLTFLoader, OBJLoader } from 'three-stdlib';
import { useRiggerStore } from '@/lib/rigger/store';
import { SkeletonOverlay } from '@/components/rigger/SkeletonOverlay';
import { LandmarkEditor } from '@/components/rigger/LandmarkEditor';
import { buildWeightHeatmapColors } from '@/lib/rigger/weightTransfer';

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
  const activeLandmark  = useRiggerStore((s) => s.activeLandmark);
  const setLandmark     = useRiggerStore((s) => s.setLandmark);
  const setActiveLandmark = useRiggerStore((s) => s.setActiveLandmark);
  const setMeshGeometry = useRiggerStore((s) => s.setMeshGeometry);
  const setMeshBbox     = useRiggerStore((s) => s.setMeshBbox);
  const setError        = useRiggerStore((s) => s.setError);

  const [loadedObject, setLoadedObject] = useState<THREE.Object3D | null>(null);
  const primaryMeshRef = useRef<THREE.Mesh | null>(null);

  // ── Load Mesh from meshUrl ────────────────────────────────────────────────
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
      const loader = new OBJLoader();
      loader.load(
        meshUrl,
        (obj) => {
          if (isCancelled) return;
          processLoadedScene(obj);
        },
        undefined,
        (err) => {
          if (isCancelled) return;
          setError(`Failed to load OBJ file: ${err instanceof Error ? err.message : String(err)}`);
        },
      );
    } else {
      const loader = new GLTFLoader();
      loader.load(
        meshUrl,
        (gltf) => {
          if (isCancelled) return;
          processLoadedScene(gltf.scene || gltf.scenes[0]);
        },
        undefined,
        (err) => {
          if (isCancelled) return;
          setError(`Failed to load GLB/GLTF file: ${err instanceof Error ? err.message : String(err)}`);
        },
      );
    }

    function processLoadedScene(scene: THREE.Object3D) {
      scene.updateMatrixWorld(true);

      // Find all meshes
      let targetMesh: THREE.Mesh | null = null;
      scene.traverse((child) => {
        if (!targetMesh && (child as THREE.Mesh).isMesh) {
          targetMesh = child as THREE.Mesh;
        }
      });

      if (!targetMesh) {
        setError('No 3D mesh geometry found in the uploaded file.');
        return;
      }

      const geom = (targetMesh as THREE.Mesh).geometry;
      geom.computeBoundingBox();
      geom.computeVertexNormals();

      const bbox = new THREE.Box3().setFromObject(scene);

      primaryMeshRef.current = targetMesh;
      setMeshGeometry(geom);
      setMeshBbox(bbox);
      setLoadedObject(scene);
    }

    return () => {
      isCancelled = true;
    };
  }, [meshUrl, meshFile, setError, setMeshBbox, setMeshGeometry]);

  // ── Heatmap vertex colors ─────────────────────────────────────────────────
  const weights = smoothWeights || rawWeights;
  const heatmapColors = useMemo(() => {
    if (!showWeightMap || !weights || !fitResult) return null;
    return buildWeightHeatmapColors(weights, fitResult.built.bones.length);
  }, [showWeightMap, weights, fitResult]);

  useEffect(() => {
    const mesh = primaryMeshRef.current;
    if (!mesh) return;

    if (heatmapColors) {
      mesh.geometry.setAttribute('color', new THREE.BufferAttribute(heatmapColors, 3));
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => {
          m.vertexColors = true;
          m.needsUpdate = true;
        });
      } else if (mesh.material) {
        mesh.material.vertexColors = true;
        mesh.material.needsUpdate = true;
      }
    } else {
      if (mesh.geometry.getAttribute('color')) {
        mesh.geometry.deleteAttribute('color');
      }
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => {
          m.vertexColors = false;
          m.needsUpdate = true;
        });
      } else if (mesh.material) {
        mesh.material.vertexColors = false;
        mesh.material.needsUpdate = true;
      }
    }
  }, [heatmapColors]);

  // ── Click-to-place active landmark ────────────────────────────────────────
  const handlePointerDown = (e: any) => {
    if (!activeLandmark) return;
    e.stopPropagation();
    setLandmark(activeLandmark, e.point);
    setActiveLandmark(null);
  };

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 10, 7]} intensity={1.5} castShadow />
      <directionalLight position={[-5, 5, -5]} intensity={0.6} />

      <gridHelper args={[10, 20, '#3f3f46', '#27272a']} position={[0, -0.001, 0]} />

      {loadedObject && (
        <group onPointerDown={handlePointerDown}>
          <primitive object={loadedObject} />
        </group>
      )}

      {/* Live landmark drag handles */}
      {stage !== 'idle' && (
        <LandmarkEditor targetMeshRef={primaryMeshRef} />
      )}

      {/* Live skeleton overlay */}
      {fitResult && (
        <SkeletonOverlay fitResult={fitResult} visible={showSkeleton} />
      )}

      <OrbitControls makeDefault minDistance={0.2} maxDistance={20} />
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
  const stage = useRiggerStore((s) => s.stage);

  return (
    <div className="relative w-full h-full bg-zinc-950 select-none">
      <Canvas
        camera={{ position: [0, 1.2, 2.5], fov: 40 }}
        gl={{ antialias: true, alpha: false }}
        className="w-full h-full"
      >
        <SceneContent />
      </Canvas>

      {/* Empty State Overlay */}
      {stage === 'idle' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center p-6 rounded-2xl bg-zinc-900/80 border border-zinc-800 backdrop-blur-md max-w-sm">
            <div className="text-4xl mb-3">🦴</div>
            <h3 className="text-lg font-semibold text-zinc-100">No 3D Model Loaded</h3>
            <p className="text-sm text-zinc-400 mt-1">
              Drag & drop a humanoid GLB or OBJ mesh into the left panel to begin auto-rigging.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
