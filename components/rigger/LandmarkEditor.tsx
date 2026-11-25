'use client';

import * as THREE from 'three';
import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Html, Line } from '@react-three/drei';
import { useThree, useFrame, type ThreeEvent } from '@react-three/fiber';
import { useRiggerStore, MIRROR_PAIR } from '@/lib/rigger/store';
import { fitSkeletonToLandmarks } from '@/lib/rigger/templateFitter';
import type { LandmarkId, LandmarkMap, RigBoneName } from '@/lib/rigger/vrmSkeleton';
import { RIG_BONE_BY_NAME, getLandmarkIdsForPreset } from '@/lib/rigger/vrmSkeleton';

export interface OrbitControlsLike {
  enabled: boolean;
  target: THREE.Vector3;
  update: () => void;
}

// ── Landmark metadata ────────────────────────────────────────────────────────

export const LANDMARK_META: Record<LandmarkId, { label: string; emoji: string; color: string }> = {
  headTop:       { label: 'Crown',       emoji: '👑', color: '#FFD700' },
  chin:          { label: 'Chin',        emoji: '🔵', color: '#C084FC' },
  neckBase:      { label: 'Neck Base',   emoji: '🔵', color: '#FFA500' },
  leftShoulder:  { label: 'L. Shoulder', emoji: '🔵', color: '#00BFFF' },
  rightShoulder: { label: 'R. Shoulder', emoji: '🔵', color: '#FF6347' },
  leftElbow:     { label: 'L. Elbow',    emoji: '🔵', color: '#60A5FA' },
  rightElbow:    { label: 'R. Elbow',    emoji: '🔵', color: '#FB923C' },
  leftWrist:     { label: 'L. Wrist',    emoji: '🔵', color: '#2DD4BF' },
  rightWrist:    { label: 'R. Wrist',    emoji: '🔵', color: '#FBBF24' },
  leftHip:       { label: 'L. Hip',      emoji: '🔵', color: '#32CD32' },
  rightHip:      { label: 'R. Hip',      emoji: '🔵', color: '#FF69B4' },
  groin:         { label: 'Groin',       emoji: '🔵', color: '#22D3EE' },
  leftKnee:      { label: 'L. Knee',     emoji: '🔵', color: '#A3E635' },
  rightKnee:     { label: 'R. Knee',     emoji: '🔵', color: '#E879F9' },
  leftAnkle:     { label: 'L. Ankle',    emoji: '🔵', color: '#00FA9A' },
  rightAnkle:    { label: 'R. Ankle',    emoji: '🔵', color: '#FF4500' },
};

export { MIRROR_PAIR };

const REGION_COLORS: Record<string, string> = {
  spine: '#ffffff', head: '#ffd700',
  leftArm: '#00bfff', rightArm: '#ff8c00',
  leftLeg: '#00c800', rightLeg: '#c8ff00',
  leftFinger: '#888888', rightFinger: '#888888',
  secondary: '#f472b6',
};

function regionColor(boneName: string): string {
  const def = RIG_BONE_BY_NAME[boneName as RigBoneName];
  return REGION_COLORS[def?.region ?? ''] ?? '#ffffff';
}

// ── Live skeleton preview (computed from current landmarks) ──────────────────

function LiveSkeletonPreview({
  landmarks,
  includeSecondaryBones,
  requiredBonesOnly,
}: {
  landmarks: Partial<LandmarkMap>;
  includeSecondaryBones: boolean;
  requiredBonesOnly: boolean;
}) {
  const count = Object.keys(landmarks).length;

  const preview = useMemo(() => {
    if (count < 2) return null;
    try {
      const full = { ...landmarks } as LandmarkMap;
      const refY = landmarks.leftAnkle?.y ?? landmarks.rightAnkle?.y ?? 0;
      let refH =
        landmarks.headTop?.y ??
        (landmarks.neckBase ? landmarks.neckBase.y + 0.24 : refY + 1.7);
      if (!landmarks.headTop && refH <= refY + 0.3) {
        refH = refY + 1.7;
      }
      const height = Math.max(0.4, refH - refY);
      const midX =
        landmarks.headTop?.x ??
        landmarks.neckBase?.x ??
        landmarks.chin?.x ??
        landmarks.groin?.x ??
        0;
      const midZ =
        landmarks.neckBase?.z ??
        landmarks.headTop?.z ??
        landmarks.groin?.z ??
        0;

      const shoulderDx = landmarks.leftShoulder
        ? Math.max(0.08, Math.abs(landmarks.leftShoulder.x - midX))
        : landmarks.rightShoulder
        ? Math.max(0.08, Math.abs(landmarks.rightShoulder.x - midX))
        : height * 0.118;
      const hipDx = landmarks.leftHip
        ? Math.max(0.04, Math.abs(landmarks.leftHip.x - midX))
        : landmarks.rightHip
        ? Math.max(0.04, Math.abs(landmarks.rightHip.x - midX))
        : height * 0.068;
      const ankleDx = landmarks.leftAnkle
        ? Math.max(0.03, Math.abs(landmarks.leftAnkle.x - midX))
        : landmarks.rightAnkle
        ? Math.max(0.03, Math.abs(landmarks.rightAnkle.x - midX))
        : height * 0.062;

      if (!full.headTop)       full.headTop       = new THREE.Vector3(midX, refH, midZ);
      if (!full.neckBase)      full.neckBase      = new THREE.Vector3(midX, refY + height * 0.85, midZ);
      if (!full.leftShoulder)  full.leftShoulder  = new THREE.Vector3(midX + shoulderDx, refY + height * 0.81, midZ);
      if (!full.rightShoulder) full.rightShoulder = new THREE.Vector3(midX - shoulderDx, refY + height * 0.81, midZ);
      if (!full.leftHip)       full.leftHip       = new THREE.Vector3(midX + hipDx, refY + height * 0.52, midZ);
      if (!full.rightHip)      full.rightHip      = new THREE.Vector3(midX - hipDx, refY + height * 0.52, midZ);
      if (!full.leftAnkle)     full.leftAnkle     = new THREE.Vector3(midX + ankleDx, refY, midZ);
      if (!full.rightAnkle)    full.rightAnkle    = new THREE.Vector3(midX - ankleDx, refY, midZ);

      return fitSkeletonToLandmarks(full, {
        requiredOnly: requiredBonesOnly || !includeSecondaryBones,
        includeSecondaryBones: includeSecondaryBones && !requiredBonesOnly,
      });
    } catch {
      return null;
    }
  }, [landmarks, count, includeSecondaryBones, requiredBonesOnly]);

  if (!preview) return null;

  const { bones } = preview.built;
  const worldPositions = preview.worldPositions;

  const segments: Array<{ key: string; start: THREE.Vector3; end: THREE.Vector3; color: string }> = [];
  for (const bone of bones) {
    const parent = bone.parent;
    if (!parent || !(parent instanceof THREE.Bone)) continue;
    const startPos = worldPositions.get(bone.name as RigBoneName);
    const endPos   = worldPositions.get(parent.name as RigBoneName);
    if (!startPos || !endPos) continue;
    segments.push({ key: bone.name, start: startPos, end: endPos, color: regionColor(bone.name) });
  }

  const joints: Array<{ key: string; pos: THREE.Vector3; color: string }> = [];
  for (const bone of bones) {
    const pos = worldPositions.get(bone.name as RigBoneName);
    if (!pos) continue;
    joints.push({ key: bone.name, pos, color: regionColor(bone.name) });
  }

  return (
    <group>
      {segments.map(({ key, start, end, color }) => (
        <Line key={key} points={[start, end]} color={color} lineWidth={1.5} opacity={0.65} transparent />
      ))}
      {joints.map(({ key, pos, color }) => (
        <mesh key={key} position={pos}>
          <sphereGeometry args={[0.008, 6, 6]} />
          <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.75} />
        </mesh>
      ))}
    </group>
  );
}

// ── Single draggable Mixamo-style bullseye handle ────────────────────────────

const _camRight = new THREE.Vector3();
const _delta    = new THREE.Vector3();

interface HandleProps {
  id: LandmarkId;
  position: THREE.Vector3;
  midlineX: number;
  targetMeshRef: React.RefObject<THREE.Mesh | null>;
  orbitControlsRef: React.RefObject<OrbitControlsLike | null>;
  isActive: boolean;
  isDraggingThis: boolean;
  onDragStateChange: (id: LandmarkId | null, shiftHeld?: boolean) => void;
}

function LandmarkHandle({
  id,
  position,
  midlineX,
  targetMeshRef,
  orbitControlsRef,
  isActive,
  isDraggingThis,
  onDragStateChange,
}: HandleProps) {
  const setLandmark           = useRiggerStore((s) => s.setLandmark);
  const setActiveLandmark     = useRiggerStore((s) => s.setActiveLandmark);
  const setIsDraggingLandmark = useRiggerStore((s) => s.setIsDraggingLandmark);
  const { camera, gl, raycaster } = useThree();

  const billboardRef    = useRef<THREE.Group>(null);
  const draggingRef     = useRef(false);
  const hoveredRef      = useRef(false);
  const latestPosRef    = useRef(position.clone());
  const cleanupDragRef  = useRef<(() => void) | null>(null);

  const [hovered, setHovered]       = useState(false);
  const [pillSide, setPillSide]     = useState<'left' | 'right' | 'top' | 'topright' | 'bottomleft' | 'bottom'>('top');

  // Keep latest position ref current so window drag listener reads fresh anchor
  latestPosRef.current.copy(position);

  const { color, label } = LANDMARK_META[id];
  const emphasized = isActive || hovered || isDraggingThis;

  // Screen-consistent billboard orientation, size scaling, and smart pill side
  useFrame(() => {
    const group = billboardRef.current;
    if (!group) return;

    // Billboard ring toward camera so it never goes edge-on
    group.quaternion.copy(camera.quaternion);

    // Keep handle consistent ~32px on screen regardless of zoom level
    const dist = camera.position.distanceTo(latestPosRef.current);
    const baseScale = THREE.MathUtils.clamp(dist * 0.019, 0.014, 0.075);
    const boost = isDraggingThis ? 1.28 : hovered ? 1.18 : isActive ? 1.15 : 1.0;
    group.scale.setScalar(baseScale * boost);

    // Determine which side of screen this handle sits on so L/R pills never collide
    if (id === 'headTop') {
      if (pillSide !== 'top') setPillSide('top');
    } else if (id === 'chin') {
      if (pillSide !== 'bottomleft') setPillSide('bottomleft');
    } else if (id === 'neckBase') {
      if (pillSide !== 'topright') setPillSide('topright');
    } else if (id === 'groin') {
      if (pillSide !== 'bottom') setPillSide('bottom');
    } else {
      _camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      _delta.set(latestPosRef.current.x - midlineX, 0, 0);
      const side: 'left' | 'right' = _delta.dot(_camRight) >= 0 ? 'right' : 'left';
      if (pillSide !== side) setPillSide(side);
    }
  });

  // Ensure any active window drag listeners detach cleanly if unmounted mid-drag
  useEffect(() => {
    return () => {
      cleanupDragRef.current?.();
      document.body.style.cursor = '';
    };
  }, []);

  const startDrag = useCallback(
    (clientX: number, clientY: number) => {
      // Tear down any previous drag defensively
      cleanupDragRef.current?.();

      draggingRef.current = true;
      setIsDraggingLandmark(true);
      setActiveLandmark(null);
      onDragStateChange(id, false);
      if (orbitControlsRef.current) orbitControlsRef.current.enabled = false;
      document.body.style.cursor = 'grabbing';

      // Camera-facing drag plane anchored at this handle's starting depth
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, latestPosRef.current);
      const hitTarget = new THREE.Vector3();
      const ndc = new THREE.Vector2();
      let lastReportedShift = false;

      const updateAtClientPos = (cx: number, cy: number, shiftKey: boolean) => {
        const rect = gl.domElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        ndc.set(
          ((cx - rect.left) / rect.width) * 2 - 1,
          -((cy - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(ndc, camera);

        if (shiftKey !== lastReportedShift) {
          lastReportedShift = shiftKey;
          onDragStateChange(id, shiftKey);
        }

        // Hold Shift to optionally snap directly onto the 3D mesh surface
        if (shiftKey && targetMeshRef.current) {
          const hits = raycaster.intersectObject(targetMeshRef.current, true);
          if (hits.length > 0) {
            setLandmark(id, hits[0].point.clone());
            return;
          }
        }

        // Default Mixamo mode: smooth camera-plane drag with zero Z-stutter
        if (raycaster.ray.intersectPlane(plane, hitTarget)) {
          setLandmark(id, hitTarget.clone());
        }
      };

      // Do an initial sample in case pointer already moved slightly on click
      updateAtClientPos(clientX, clientY, false);

      const handleWindowMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        ev.preventDefault();
        updateAtClientPos(ev.clientX, ev.clientY, ev.shiftKey);
      };

      const finishDrag = () => {
        window.removeEventListener('pointermove', handleWindowMove);
        window.removeEventListener('pointerup', finishDrag);
        window.removeEventListener('pointercancel', finishDrag);
        cleanupDragRef.current = null;

        draggingRef.current = false;
        setIsDraggingLandmark(false);
        onDragStateChange(null, false);
        if (orbitControlsRef.current) {
          orbitControlsRef.current.enabled = !hoveredRef.current;
        }
        document.body.style.cursor = hoveredRef.current ? 'grab' : '';
      };

      cleanupDragRef.current = finishDrag;
      window.addEventListener('pointermove', handleWindowMove, { passive: false });
      window.addEventListener('pointerup', finishDrag);
      window.addEventListener('pointercancel', finishDrag);
    },
    [camera, gl.domElement, id, onDragStateChange, orbitControlsRef, raycaster, setActiveLandmark, setIsDraggingLandmark, setLandmark, targetMeshRef],
  );

  const onMeshPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      startDrag(e.clientX, e.clientY);
    },
    [startDrag],
  );

  const onHoverStart = useCallback(() => {
    hoveredRef.current = true;
    setHovered(true);
    if (!draggingRef.current) {
      if (orbitControlsRef.current) orbitControlsRef.current.enabled = false;
      document.body.style.cursor = 'grab';
    }
  }, [orbitControlsRef]);

  const onHoverEnd = useCallback(() => {
    hoveredRef.current = false;
    setHovered(false);
    if (!draggingRef.current) {
      if (orbitControlsRef.current) orbitControlsRef.current.enabled = true;
      document.body.style.cursor = '';
    }
  }, [orbitControlsRef]);

  // Pill screen-space positioning so paired joints sit outward from midline
  const pillTransform =
    pillSide === 'top'
      ? 'translate(-50%, calc(-100% - 14px))'
      : pillSide === 'topright'
      ? 'translate(14px, -110%)'
      : pillSide === 'bottomleft'
      ? 'translate(calc(-100% - 14px), -15%)'
      : pillSide === 'bottom'
      ? 'translate(-50%, 14px)'
      : pillSide === 'left'
      ? 'translate(calc(-100% - 14px), -50%)'
      : 'translate(14px, -50%)';

  return (
    <group position={position}>
      {/* Camera-facing bullseye reticle (always visible on top of mesh) */}
      <group ref={billboardRef}>
        {/* Generous invisible hit sphere — larger than visual ring so grabbing never misses */}
        <mesh
          renderOrder={1000}
          userData={{ landmarkHandleId: id }}
          onPointerDown={onMeshPointerDown}
          onPointerEnter={(e) => { e.stopPropagation(); onHoverStart(); }}
          onPointerLeave={() => onHoverEnd()}
        >
          <sphereGeometry args={[1.75, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
        </mesh>

        {/* Soft translucent center fill */}
        <mesh renderOrder={998}>
          <circleGeometry args={[0.78, 24]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={isDraggingThis ? 0.42 : hovered ? 0.28 : 0.16}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>

        {/* Crisp white outer contrast halo when hovered / active / dragging */}
        {emphasized && (
          <mesh renderOrder={999}>
            <ringGeometry args={[0.98, 1.24, 32]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.95} depthTest={false} depthWrite={false} />
          </mesh>
        )}

        {/* Primary color bullseye ring */}
        <mesh renderOrder={999}>
          <ringGeometry args={[0.66, 0.98, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.98} depthTest={false} depthWrite={false} />
        </mesh>

        {/* Precision center dot */}
        <mesh renderOrder={1000}>
          <circleGeometry args={[0.28, 16]} />
          <meshBasicMaterial color={emphasized ? '#ffffff' : color} transparent opacity={1} depthTest={false} depthWrite={false} />
        </mesh>
      </group>

      {/* Draggable pill label anchored neatly beside the handle */}
      <Html
        position={[0, 0, 0]}
        zIndexRange={isDraggingThis ? [100, 100] : hovered ? [80, 80] : [10, 40]}
        style={{
          pointerEvents: 'none',
          transform: pillTransform,
        }}
      >
        <div
          onPointerDown={(ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            startDrag(ev.clientX, ev.clientY);
          }}
          onPointerEnter={() => onHoverStart()}
          onPointerLeave={() => onHoverEnd()}
          title={`Drag ${label} (hold Shift to snap to surface)`}
          style={{
            pointerEvents: 'auto',
            cursor: isDraggingThis ? 'grabbing' : 'grab',
            userSelect: 'none',
            touchAction: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            minHeight: 24,
            background: isDraggingThis || isActive ? color : hovered ? 'rgba(24,24,27,0.95)' : 'rgba(9,9,11,0.82)',
            color: isDraggingThis || isActive ? '#09090b' : '#f4f4f5',
            padding: '4px 8px',
            borderRadius: 999,
            fontSize: 10,
            lineHeight: '14px',
            whiteSpace: 'nowrap',
            fontFamily: 'system-ui, sans-serif',
            fontWeight: emphasized ? 700 : 500,
            border: `1.5px solid ${emphasized ? '#ffffff' : color}`,
            boxShadow: emphasized ? `0 0 10px ${color}` : '0 2px 6px rgba(0,0,0,0.5)',
            transition: 'background 0.12s, color 0.12s, border-color 0.12s',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '999px',
              background: isDraggingThis || isActive ? '#09090b' : color,
              flexShrink: 0,
            }}
          />
          <span>{label}</span>
        </div>
      </Html>
    </group>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface LandmarkEditorProps {
  targetMeshRef: React.RefObject<THREE.Mesh | null>;
  orbitControlsRef: React.RefObject<OrbitControlsLike | null>;
  showLivePreview: boolean;
  onDraggingChange?: (draggingId: LandmarkId | null, shiftHeld: boolean) => void;
}

export function LandmarkEditor({
  targetMeshRef,
  orbitControlsRef,
  showLivePreview,
  onDraggingChange,
}: LandmarkEditorProps) {
  const landmarks             = useRiggerStore((s) => s.landmarks);
  const landmarkPreset        = useRiggerStore((s) => s.landmarkPreset);
  const activeLandmark        = useRiggerStore((s) => s.activeLandmark);
  const useSymmetry           = useRiggerStore((s) => s.useSymmetry);
  const meshBbox              = useRiggerStore((s) => s.meshBbox);
  const includeSecondaryBones = useRiggerStore((s) => s.includeSecondaryBones);
  const requiredBonesOnly     = useRiggerStore((s) => s.requiredBonesOnly);

  const [draggingId, setDraggingId] = useState<LandmarkId | null>(null);

  const handleDragStateChange = useCallback(
    (id: LandmarkId | null, shiftHeld = false) => {
      setDraggingId(id);
      onDraggingChange?.(id, shiftHeld);
    },
    [onDraggingChange],
  );

  const visibleLandmarkIds = useMemo(
    () => getLandmarkIdsForPreset(landmarkPreset),
    [landmarkPreset],
  );

  const visibleLandmarks = useMemo(() => {
    const subset: Partial<LandmarkMap> = {};
    for (const id of visibleLandmarkIds) {
      const pos = landmarks[id];
      if (pos) subset[id] = pos;
    }
    return subset;
  }, [landmarks, visibleLandmarkIds]);

  // Midline X used to fan left/right pill badges cleanly outward
  const midlineX = useMemo(() => {
    if (meshBbox) return (meshBbox.min.x + meshBbox.max.x) * 0.5;
    if (landmarks.headTop) return landmarks.headTop.x;
    return 0;
  }, [meshBbox, landmarks.headTop]);

  // Dashed horizontal link between active dragged handle and its mirrored partner
  const symmetryLine = useMemo(() => {
    if (!useSymmetry || !draggingId) return null;
    const partnerId = MIRROR_PAIR[draggingId];
    if (!partnerId) return null;
    const a = visibleLandmarks[draggingId];
    const b = visibleLandmarks[partnerId];
    if (!a || !b) return null;
    return { a, b, color: LANDMARK_META[draggingId].color };
  }, [draggingId, visibleLandmarks, useSymmetry]);

  return (
    <group>
      {/* Live skeleton preview — updates as landmarks are placed/dragged */}
      {showLivePreview && Object.keys(visibleLandmarks).length >= 2 && (
        <LiveSkeletonPreview
          landmarks={visibleLandmarks}
          includeSecondaryBones={includeSecondaryBones}
          requiredBonesOnly={requiredBonesOnly}
        />
      )}

      {/* Symmetry mirror link line while dragging L/R joint pairs */}
      {symmetryLine && (
        <Line
          points={[symmetryLine.a, symmetryLine.b]}
          color={symmetryLine.color}
          lineWidth={1.5}
          dashed
          dashSize={0.03}
          gapSize={0.02}
          transparent
          opacity={0.85}
        />
      )}

      {/* Placed Mixamo-style landmark handles */}
      {visibleLandmarkIds.map((id) => {
        const pos = visibleLandmarks[id];
        if (!pos) return null;
        return (
          <LandmarkHandle
            key={id}
            id={id}
            position={pos}
            midlineX={midlineX}
            targetMeshRef={targetMeshRef}
            orbitControlsRef={orbitControlsRef}
            isActive={activeLandmark === id}
            isDraggingThis={draggingId === id}
            onDragStateChange={handleDragStateChange}
          />
        );
      })}
    </group>
  );
}
