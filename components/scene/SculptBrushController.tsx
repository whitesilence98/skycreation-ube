'use client';

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { HeadBuild } from '@/lib/head/geometry';
import type { Rig } from '@/lib/head/rig';
import { applySculptBrushStroke } from '@/lib/head/sculptBrush';
import { useCharacter } from '@/lib/store';

interface SculptBrushControllerProps {
  rig: Rig;
  headBuild: HeadBuild;
}

/**
 * Interactive 3D vertex sculpt brush controller for `studioPage === 'sculpt'`.
 * Raycasts pointer strokes directly against `rig.mesh`; dragging on the face
 * sculpts without spinning OrbitControls, while dragging background still orbits.
 */
export function SculptBrushController({ rig, headBuild }: SculptBrushControllerProps) {
  const studioPage = useCharacter((s) => s.studioPage);
  const appMode = useCharacter((s) => s.appMode);
  const active = appMode === 'studio' && studioPage === 'sculpt';
  const { camera, controls, gl } = useThree();

  const sculptingRef = useRef(false);
  const lastHitLocalRef = useRef(new THREE.Vector3());
  const hasLastHitRef = useRef(false);
  const ringRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    if (!active) {
      if (ringRef.current) ringRef.current.visible = false;
      return;
    }

    const dom = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const invHeadMatrix = new THREE.Matrix4();
    const localPoint = new THREE.Vector3();
    const localNormal = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3();
    const worldNormal = new THREE.Vector3();
    const moveDelta = new THREE.Vector3();

    const castToHead = (clientX: number, clientY: number) => {
      const rect = dom.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(rig.mesh, false);
      return hits[0] ?? null;
    };

    const applyStrokeAt = (hit: THREE.Intersection, isMove: boolean) => {
      const state = useCharacter.getState();
      const posAttr = headBuild.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!posAttr) return;

      rig.mesh.updateMatrixWorld(true);
      invHeadMatrix.copy(rig.mesh.matrixWorld).invert();
      localPoint.copy(hit.point).applyMatrix4(invHeadMatrix);

      if (hit.face) {
        normalMatrix.getNormalMatrix(invHeadMatrix);
        localNormal.copy(hit.face.normal).transformDirection(rig.mesh.matrixWorld).applyMatrix3(normalMatrix).normalize();
      } else {
        localNormal.set(0, 0, 1);
      }

      if (isMove && hasLastHitRef.current) {
        moveDelta.subVectors(localPoint, lastHitLocalRef.current);
      } else {
        moveDelta.set(0, 0, 0);
      }
      lastHitLocalRef.current.copy(localPoint);
      hasLastHitRef.current = true;

      if (state.sculptBrushMode === 'move' && !isMove) {
        return;
      }

      const positions = posAttr.array as Float32Array;
      const changed = applySculptBrushStroke(positions, {
        mode: state.sculptBrushMode,
        radius: state.sculptBrushRadius,
        strength: state.sculptBrushStrength,
        symmetry: state.sculptBrushSymmetry,
        hitPoint: [localPoint.x, localPoint.y, localPoint.z],
        hitNormal: [localNormal.x, localNormal.y, localNormal.z],
        moveDelta: [moveDelta.x, moveDelta.y, moveDelta.z],
      });

      if (changed) {
        state.bumpSculptBrushVersion();
      }
    };

    const updatePreviewRing = (hit: THREE.Intersection | null) => {
      const ring = ringRef.current;
      if (!ring) return;
      if (!hit || !hit.face) {
        ring.visible = false;
        return;
      }
      const r = useCharacter.getState().sculptBrushRadius;
      ring.visible = true;
      worldNormal.copy(hit.face.normal).transformDirection(rig.mesh.matrixWorld).normalize();
      ring.position.copy(hit.point).addScaledVector(worldNormal, 0.0015);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
      ring.scale.set(r, r, 1);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const hit = castToHead(e.clientX, e.clientY);
      if (!hit) return;

      e.stopImmediatePropagation();
      e.preventDefault();
      sculptingRef.current = true;
      hasLastHitRef.current = false;
      const orbit = controls as OrbitControlsImpl | null;
      if (orbit) orbit.enabled = false;
      dom.style.cursor = 'crosshair';
      applyStrokeAt(hit, false);
      updatePreviewRing(hit);
    };

    const onPointerMove = (e: PointerEvent) => {
      const hit = castToHead(e.clientX, e.clientY);
      updatePreviewRing(hit);
      if (!sculptingRef.current || !hit) return;
      e.stopImmediatePropagation();
      applyStrokeAt(hit, true);
    };

    const finishStroke = () => {
      if (!sculptingRef.current) return;
      sculptingRef.current = false;
      hasLastHitRef.current = false;
      const orbit = controls as OrbitControlsImpl | null;
      if (orbit) orbit.enabled = true;
      dom.style.cursor = 'grab';
    };

    // Capture phase runs before OrbitControls so strokes on the face don't spin the camera
    dom.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', finishStroke, true);
    window.addEventListener('pointercancel', finishStroke, true);

    return () => {
      dom.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', finishStroke, true);
      window.removeEventListener('pointercancel', finishStroke, true);
      const orbit = controls as OrbitControlsImpl | null;
      if (orbit) orbit.enabled = true;
    };
  }, [active, camera, controls, gl, rig, headBuild]);

  if (!active) return null;

  return (
    <mesh ref={ringRef} visible={false} renderOrder={20}>
      <ringGeometry args={[0.92, 1.0, 32]} />
      <meshBasicMaterial color="#63d9e2" transparent opacity={0.85} depthTest={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
