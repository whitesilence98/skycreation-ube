'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
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
import { skinPoint, type Rig } from '@/lib/head/rig';
import { useCharacter } from '@/lib/store';

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

/**
 * Anchor dot: a tiny hard white core with a soft cyan halo. The earlier
 * version was opaque out to r = 0.24 of the sprite and read as a white blot
 * rather than a vertex anchor.
 */
function radialSprite(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.1, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.13, 'rgba(198,253,255,0.65)');
  grd.addColorStop(0.3, 'rgba(79,209,197,0.16)');
  grd.addColorStop(0.62, 'rgba(79,209,197,0.04)');
  grd.addColorStop(1, 'rgba(79,209,197,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Cyan BDO-style mesh readout:
 *  - faint full-face wire veil
 *  - dense glowing wire restricted to the active region
 *  - white vertex anchors
 *  - dashed contours hugging the surface of every zone
 *
 * Everything is re-skinned on the CPU so the overlay follows the GPU
 * deformation exactly.
 */
export function MeshOverlay({ rig, headBuild }: MeshOverlayProps) {
  const activeRegion = useCharacter((s) => s.activeRegion);
  /* The net is a reading aid, not part of the character: hiding it has to stop
     the per-frame CPU skin mirroring too, or a hidden overlay still costs the
     scene ~60 k `skinPoint` calls a second for pixels nobody sees. */
  const showMesh = useCharacter((s) => s.showMesh);

  /* ── faint full-face veil ─────────────────────────────────────
     Sampled from the loft's own (ring, segment) grid rather than filtered out
     of the full edge table. The table is ~61 k unique segments; drawing it all
     is what laid the pale rectangular grid over the whole face, and it was the
     scene's heaviest per-frame CPU loop. `buildVeilEdges` takes every 4th ring
     and every 6th segment with one alternating diagonal per quad. */
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
      color: new THREE.Color('#63d9e2'),
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
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
      color: new THREE.Color('#4fd1c5'),
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const glow = new THREE.LineBasicMaterial({
      color: new THREE.Color('#7ee9e0'),
      transparent: true,
      opacity: 0.12,
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
        /* 0.0046 read as dust at the reference framing; the reference's
           anchors are the brightest marks on the patch. */
        size: 0.006,
        sizeAttenuation: true,
        map: sprite,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
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
          color: new THREE.Color(active ? '#d9feff' : '#7fe6ee'),
          dashSize: 0.0022,
          gapSize: 0.0017,
          transparent: true,
          opacity: active ? 0.85 : 0.52,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        });
        const line = new THREE.Line(geo, mat);
        line.frustumCulled = false;
        line.renderOrder = 6;
        return { def, indices, line, geo, mat };
      }),
    [headBuild, activeRegion],
  );

  // ── per-frame CPU skin mirroring ───────────────────────────────
  const tick = useMemo(() => ({ n: 0 }), []);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!showMesh) return;
    tick.n++;
    if (tick.n % 2 !== 0) return;

    const writeSegments = (segs: Uint32Array, arr: Float32Array) => {
      for (let s = 0; s < segs.length; s += 2) {
        skinPoint(rig, segs[s], v);
        const o = (s / 2) * 6;
        arr[o] = v.x;
        arr[o + 1] = v.y;
        arr[o + 2] = v.z;
        skinPoint(rig, segs[s + 1], v);
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
      skinPoint(rig, region.anchors[i], v);
      region.anchorPositions[i * 3] = v.x;
      region.anchorPositions[i * 3 + 1] = v.y;
      region.anchorPositions[i * 3 + 2] = v.z;
    }
    (anchorGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    for (const c of contours) {
      writeContourPositions(
        c.geo.getAttribute('position') as THREE.BufferAttribute,
        c.indices,
        (idx, out) => skinPoint(rig, idx, out),
        v,
        c.def.closed,
      );
      c.line.computeLineDistances();
    }
  });

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
      <primitive object={veil.line} />
      <primitive object={wire.line} />
      <primitive object={wire.glowLine} />
      <points geometry={anchorGeo} material={anchorMat} />
      {contours.map((c) => (
        <primitive key={c.def.region} object={c.line} />
      ))}
    </group>
  );
}
