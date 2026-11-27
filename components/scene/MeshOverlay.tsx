'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  buildGridEdges,
  buildMeshEdges,
  regionPredicate,
  selectRegionVertices,
  CONTOURS,
  snapContour,
  writeContourPositions,
} from '@/lib/head/overlay';
import type { HeadBuild } from '@/lib/head/geometry';
import { isPairedRegion, REGION_BONES, skinPoint, type Rig } from '@/lib/head/rig';
import type { RegionId } from '@/lib/regions';
import { FACE_SECTIONS, type FaceSectionId } from '@/lib/faceControls';
import { useCharacter, type GizmoPose } from '@/lib/store';

interface MeshOverlayProps {
  rig: Rig;
  headBuild: HeadBuild;
}

interface RegionGeometry {
  segments: Uint32Array;
  segmentPositions: Float32Array;
  anchors: Uint32Array;
  anchorPositions: Float32Array;
}

/** Outward surface push (1.2 mm) so curved wireframe chords & dots sit crisply above skin. */
const NORMAL_OFFSET = 0.0012;

const _localHit = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _worldDelta = new THREE.Vector3();
const _invHeadQ = new THREE.Quaternion();
const _headQ = new THREE.Quaternion();
const _headRight = new THREE.Vector3();

const SCULPT_DRAG_MAP: Partial<
  Record<RegionId, { hMorph: string; hSign: number; vMorph: string; vSign: number }>
> = {
  eyebrows: { hMorph: 'BrowIn', hSign: -1, vMorph: 'BrowUp', vSign: 1 },
  eyes: { hMorph: 'EyesMoveOut', hSign: 1, vMorph: 'EyesMoveUp', vSign: 1 },
  nose: { hMorph: 'NoseLong', hSign: 1, vMorph: 'NoseUp', vSign: 1 },
  cheeks: { hMorph: 'CheeksOut', hSign: 1, vMorph: 'CheeksUp', vSign: 1 },
  lips: { hMorph: 'LipMoveOut', hSign: 1, vMorph: 'LipMoveUp', vSign: 1 },
  jaw: { hMorph: 'JawWide', hSign: 1, vMorph: 'JawUp', vSign: 1 },
};

function pickRegionAtPoint(localPt: THREE.Vector3): RegionId | null {
  let best: RegionId | null = null;
  let bestD2 = Infinity;
  for (const rb of REGION_BONES) {
    const paired = isPairedRegion(rb.region);
    const px = paired ? Math.abs(localPt.x) : localPt.x;
    const cx = paired ? Math.abs(rb.influence[0]) : rb.influence[0];
    const rx = rb.radii[0] * 1.18;
    const ry = rb.radii[1] * 1.18;
    const rz = rb.radii[2] * 1.18;
    const d2 =
      ((px - cx) / rx) ** 2 +
      ((localPt.y - rb.influence[1]) / ry) ** 2 +
      ((localPt.z - rb.influence[2]) / rz) ** 2;
    if (d2 <= 1.35 && d2 < bestD2) {
      bestD2 = d2;
      best = rb.region;
    }
  }
  return best;
}

function sectionIdForRegion(region: RegionId): FaceSectionId {
  return FACE_SECTIONS.find((s) => s.region === region)?.id ?? 'forehead';
}

/**
 * Anchor dot: crisp glowing white core with soft cyan halo.
 */
function radialSprite(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.22, 'rgba(225,254,255,0.98)');
  grd.addColorStop(0.42, 'rgba(99,217,226,0.68)');
  grd.addColorStop(0.75, 'rgba(79,209,197,0.18)');
  grd.addColorStop(1, 'rgba(79,209,197,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Cyan BDO-style mesh readout & direct surface sculpting overlay:
 *  - readable full-face cyan wire veil
 *  - high-contrast cyan wire restricted to the active region
 *  - bright vertex anchors
 *  - dashed contours hugging the surface of every zone
 *  - click any facial zone to focus it, or drag directly on the net to sculpt
 */
export function MeshOverlay({ rig, headBuild }: MeshOverlayProps) {
  const activeRegion = useCharacter((s) => s.activeRegion);
  const primaryTab = useCharacter((s) => s.primaryTab);
  /* The net is a reading aid, not part of the character: hiding it stops the
     per-frame CPU skin mirroring and raycast hit surface too. */
  const showMesh = useCharacter((s) => s.showMesh);
  const { camera, controls, gl } = useThree();
  const worldGroupRef = useRef<THREE.Group>(null);
  const hitMeshRef = useRef<THREE.Mesh>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    moved: boolean;
    region: RegionId;
    sideSign: number;
    initialMorphs: Record<string, number>;
    initialPose: GizmoPose;
  } | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  const interactive = showMesh && primaryTab === 'FACE SHAPE';

  /* ── faint full-face veil ───────────────────────────────────── */
  const veil = useMemo(() => {
    const hasIndex = Boolean(headBuild.geometry.getIndex());
    const segs = hasIndex
      ? buildMeshEdges(headBuild.geometry, 8, (idx) => headBuild.basePositions[idx * 3 + 2] > 0.01)
      : buildGridEdges(headBuild.ringCount, headBuild.segmentCount);
    const arr = new Float32Array((segs.length / 2) * 6);
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(arr, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#5ce1e6'),
      transparent: true,
      opacity: 0.34,
      blending: THREE.NormalBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const line = new THREE.LineSegments(geo, mat);
    line.frustumCulled = false;
    line.renderOrder = 3;
    return { line, geo, mat, arr, segs };
  }, [headBuild]);

  // ── active-region wire + anchors ───────────────────────────────
  const region = useMemo<RegionGeometry>(() => {
    const hasIndex = Boolean(headBuild.geometry.getIndex());
    const segments = hasIndex
      ? buildMeshEdges(
          headBuild.geometry,
          1,
          regionPredicate(headBuild.basePositions, activeRegion),
        )
      : buildGridEdges(
          headBuild.ringCount,
          headBuild.segmentCount,
          2,
          2,
          regionPredicate(headBuild.basePositions, activeRegion),
        );
    const anchors = selectRegionVertices(segments, 6);
    return {
      segments,
      segmentPositions: new Float32Array((segments.length / 2) * 6),
      anchors,
      anchorPositions: new Float32Array(anchors.length * 3),
    };
  }, [headBuild, activeRegion]);

  const wire = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(region.segmentPositions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const base = new THREE.LineBasicMaterial({
      color: new THREE.Color('#67f5ff'),
      transparent: true,
      opacity: 0.92,
      blending: THREE.NormalBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const glow = new THREE.LineBasicMaterial({
      color: new THREE.Color('#aafaff'),
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const line = new THREE.LineSegments(geo, base);
    const glowLine = new THREE.LineSegments(geo, glow);
    line.frustumCulled = false;
    glowLine.frustumCulled = false;
    line.renderOrder = 4;
    glowLine.renderOrder = 5;
    return { line, glowLine, geo, base, glow };
  }, [region]);

  // ── anchors ────────────────────────────────────────────────────
  const sprite = useMemo(radialSprite, []);
  const anchorGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(region.anchorPositions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    return geo;
  }, [region]);

  const anchorMat = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.0092,
        sizeAttenuation: true,
        map: sprite,
        transparent: true,
        opacity: 1.0,
        depthWrite: false,
        blending: THREE.NormalBlending,
        toneMapped: false,
      }),
    [sprite],
  );

  // ── dashed contours ────────────────────────────────────────────
  const contours = useMemo(
    () =>
      CONTOURS.map((def) => {
        const indices = snapContour(def.points, headBuild.basePositions);
        const count = indices.length + 1;
        const geo = new THREE.BufferGeometry();
        const attr = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
        attr.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('position', attr);
        const active = def.region === activeRegion;
        const mat = new THREE.LineDashedMaterial({
          color: new THREE.Color(active ? '#e8ffff' : '#7fe6ee'),
          dashSize: 0.0024,
          gapSize: 0.0014,
          transparent: true,
          opacity: active ? 1.0 : 0.45,
          depthWrite: false,
          blending: THREE.NormalBlending,
          toneMapped: false,
        });
        const line = new THREE.Line(geo, mat);
        line.frustumCulled = false;
        line.renderOrder = 6;
        return { def, indices, line, geo, mat };
      }),
    [headBuild, activeRegion],
  );

  // Clean up pointer/orbit listeners if unmounted mid-drag
  useEffect(() => {
    return () => {
      cleanupDragRef.current?.();
      gl.domElement.style.cursor = '';
    };
  }, [gl]);

  // Clear cursor if net is disabled or user leaves FACE SHAPE
  useEffect(() => {
    if (!interactive && !dragRef.current) {
      gl.domElement.style.cursor = '';
    }
  }, [interactive, gl]);

  // Force immediate overlay refresh on region switch or turning Mesh on
  const dirtyOverlayRef = useRef(true);
  useEffect(() => {
    dirtyOverlayRef.current = true;
  }, [showMesh, activeRegion, headBuild]);

  // ── per-frame CPU skin mirroring ───────────────────────────────
  const tick = useMemo(() => ({ n: 0 }), []);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!showMesh) return;

    // skinPoint() outputs world-space coordinates; neutralize parent (characterRef) footDrop/transform
    if (worldGroupRef.current && worldGroupRef.current.parent) {
      worldGroupRef.current.parent.updateMatrixWorld(true);
      worldGroupRef.current.matrix.copy(worldGroupRef.current.parent.matrixWorld).invert();
      worldGroupRef.current.updateMatrixWorld(true);
    }

    if (hitMeshRef.current) {
      hitMeshRef.current.matrix.copy(rig.root.matrix);
      hitMeshRef.current.updateMatrixWorld(true);
    }

    tick.n++;
    if (!dirtyOverlayRef.current && tick.n % 2 !== 0) return;
    dirtyOverlayRef.current = false;

    const posAttr = headBuild.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const normAttr = headBuild.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const baseOverride = posAttr ? (posAttr.array as Float32Array) : undefined;
    const normals = normAttr ? (normAttr.array as Float32Array) : undefined;

    const writeSegments = (segs: Uint32Array, arr: Float32Array) => {
      for (let s = 0; s < segs.length; s += 2) {
        skinPoint(rig, segs[s], v, baseOverride, normals, NORMAL_OFFSET);
        const o = (s / 2) * 6;
        arr[o] = v.x;
        arr[o + 1] = v.y;
        arr[o + 2] = v.z;
        skinPoint(rig, segs[s + 1], v, baseOverride, normals, NORMAL_OFFSET);
        arr[o + 3] = v.x;
        arr[o + 4] = v.y;
        arr[o + 5] = v.z;
      }
    };

    writeSegments(veil.segs, veil.arr);
    (veil.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    writeSegments(region.segments, region.segmentPositions);
    (wire.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    for (let i = 0; i < region.anchors.length; i++) {
      skinPoint(rig, region.anchors[i], v, baseOverride, normals, NORMAL_OFFSET);
      region.anchorPositions[i * 3] = v.x;
      region.anchorPositions[i * 3 + 1] = v.y;
      region.anchorPositions[i * 3 + 2] = v.z;
    }
    (anchorGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    for (const c of contours) {
      writeContourPositions(
        c.geo.getAttribute('position') as THREE.BufferAttribute,
        c.indices,
        (idx, out) => skinPoint(rig, idx, out, baseOverride, normals, NORMAL_OFFSET),
        v,
        c.def.closed,
      );
      c.line.computeLineDistances();
    }
  });

  const handleHover = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive || dragRef.current) return;
    rig.root.updateMatrixWorld(true);
    rig.root.worldToLocal(_localHit.copy(e.point));
    const regionHit = pickRegionAtPoint(_localHit);
    gl.domElement.style.cursor = regionHit ? 'grab' : '';
  };

  const handlePointerOut = () => {
    if (!dragRef.current) {
      gl.domElement.style.cursor = '';
    }
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive || e.button !== 0) return;
    rig.root.updateMatrixWorld(true);
    rig.root.worldToLocal(_localHit.copy(e.point));
    const picked = pickRegionAtPoint(_localHit);
    if (!picked) return;

    e.stopPropagation();
    const orbit = controls as OrbitControlsImpl | null;
    if (orbit) orbit.enabled = false;
    gl.domElement.style.cursor = 'grabbing';

    const state0 = useCharacter.getState();
    const pose0 = state0.poses[picked];
    const drag = {
      startX: e.nativeEvent.clientX,
      startY: e.nativeEvent.clientY,
      moved: false,
      region: picked,
      sideSign: _localHit.x < 0 ? -1 : 1,
      initialMorphs: { ...state0.faceMorphs },
      initialPose: {
        offset: [...pose0.offset] as [number, number, number],
        rotation: [...pose0.rotation] as [number, number, number],
        scale: [...pose0.scale] as [number, number, number],
      },
    };
    dragRef.current = drag;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;

      const store = useCharacter.getState();
      if (!drag.moved) {
        drag.moved = true;
        store.setFeaturesSection(sectionIdForRegion(drag.region));
        store.beginFaceEdit();
      }

      _camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      _camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      rig.root.getWorldQuaternion(_headQ);
      _invHeadQ.copy(_headQ).invert();
      _headRight.set(1, 0, 0).applyQuaternion(_headQ);

      const sectionId = sectionIdForRegion(drag.region);
      const sculptSpec = SCULPT_DRAG_MAP[drag.region];
      const useTri =
        Boolean(sculptSpec) &&
        store.featuresMode === 'sculpt' &&
        sectionId !== 'forehead' &&
        sectionId !== 'ears';

      if (useTri && sculptSpec) {
        // Project screen horizontal drag onto head X; mirror outward pull for paired features
        const rightSign = _camRight.dot(_headRight) >= 0 ? 1 : -1;
        const outwardSign = isPairedRegion(drag.region) ? drag.sideSign : 1;
        const hDelta = dx * rightSign * outwardSign * sculptSpec.hSign * 0.55;
        const vDelta = -dy * sculptSpec.vSign * 0.55;

        const baseH = drag.initialMorphs[sculptSpec.hMorph] ?? 0;
        const baseV = drag.initialMorphs[sculptSpec.vMorph] ?? 0;
        store.setFaceMorph(sculptSpec.hMorph, Math.max(-100, Math.min(100, baseH + hDelta)));
        store.setFaceMorph(sculptSpec.vMorph, Math.max(-100, Math.min(100, baseV + vDelta)));
      } else {
        const mode = store.transformMode;
        const paired = isPairedRegion(drag.region);
        const xMirror = paired ? drag.sideSign : 1;

        if (mode === 'translate') {
          _worldDelta
            .set(0, 0, 0)
            .addScaledVector(_camRight, dx * 0.00028)
            .addScaledVector(_camUp, -dy * 0.00028)
            .applyQuaternion(_invHeadQ);
          store.setPose({
            offset: [
              drag.initialPose.offset[0] + _worldDelta.x * xMirror,
              drag.initialPose.offset[1] + _worldDelta.y,
              drag.initialPose.offset[2] + _worldDelta.z,
            ],
          });
        } else if (mode === 'rotate') {
          store.setPose({
            rotation: [
              drag.initialPose.rotation[0] + dy * 0.0045,
              drag.initialPose.rotation[1] + dx * 0.0045 * xMirror,
              drag.initialPose.rotation[2],
            ],
          });
        } else {
          const rightSign = _camRight.dot(_headRight) >= 0 ? 1 : -1;
          const sx = dx * rightSign * xMirror * 0.003;
          const sy = -dy * 0.003;
          store.setPose({
            scale: [
              drag.initialPose.scale[0] + sx,
              drag.initialPose.scale[1] + sy,
              drag.initialPose.scale[2] + sx * 0.5,
            ],
          });
        }
      }
      dirtyOverlayRef.current = true;
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      cleanupDragRef.current = null;
      dragRef.current = null;
      if (orbit) orbit.enabled = true;
      gl.domElement.style.cursor = interactive ? 'grab' : '';
    };

    const onUp = () => {
      const wasMoved = drag.moved;
      const pickedRegion = drag.region;
      cleanup();
      if (!wasMoved) {
        useCharacter.getState().setFeaturesSection(sectionIdForRegion(pickedRegion));
      } else {
        useCharacter.getState().endFaceEdit();
      }
    };

    cleanupDragRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Lightweight raycast geometry sharing live positions/indices without morphAttributes
  const hitGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = headBuild.geometry.getAttribute('position');
    if (pos) geo.setAttribute('position', pos);
    const idx = headBuild.geometry.getIndex();
    if (idx) geo.setIndex(idx);
    return geo;
  }, [headBuild]);

  useEffect(() => {
    return () => {
      hitGeometry.dispose();
    };
  }, [hitGeometry]);

  useEffect(() => {
    return () => {
      veil.geo.dispose();
      veil.mat.dispose();
      wire.geo.dispose();
      wire.base.dispose();
      wire.glow.dispose();
      anchorGeo.dispose();
      anchorMat.dispose();
      sprite?.dispose();
      for (const c of contours) {
        c.geo.dispose();
        c.mat.dispose();
      }
    };
  }, [veil, wire, anchorGeo, anchorMat, sprite, contours]);

  return (
    <group name="mesh-overlay" visible={showMesh}>
      <group ref={worldGroupRef} matrixAutoUpdate={false}>
        <primitive object={veil.line} />
        <primitive object={wire.line} />
        <primitive object={wire.glowLine} />
        <points geometry={anchorGeo} material={anchorMat} frustumCulled={false} renderOrder={6} />
        {contours.map((c) => (
          <primitive key={c.def.region} object={c.line} />
        ))}
      </group>
      {interactive && (
        <mesh
          ref={hitMeshRef}
          name="mesh-overlay-hit"
          geometry={hitGeometry}
          matrixAutoUpdate={false}
          renderOrder={2}
          onPointerMove={handleHover}
          onPointerOut={handlePointerOut}
          onPointerDown={handlePointerDown}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      )}
    </group>
  );
}
