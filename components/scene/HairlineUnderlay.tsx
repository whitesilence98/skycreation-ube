'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { createPortal } from '@react-three/fiber';
import { useMeshGeometry, useMaterialTexture } from '@/components/scene/useMeshGeometry';
import { DEFAULT_HAIR, hairOffsetMetres, type HairSettings } from '@/lib/hair/settings';
import { hairMaterialState } from '@/lib/hair/material';

export interface HairlineUnderlayProps {
  rigRoot?: THREE.Object3D | null;
  /** Tone, alpha and the ADVANCED TUNING thresholds for the scalp filler. */
  hair?: HairSettings;
  renderOrder?: number;
}

/**
 * HairlineUnderlay
 *
 * Renders the scalp cap and hairline root geometry underneath worn hairstyles
 * to prevent visible bald patches or scalp clipping gaps at the forehead and crown.
 */
export function HairlineUnderlay({
  rigRoot,
  hair,
  renderOrder = 5,
}: HairlineUnderlayProps) {
  const loaded = useMeshGeometry('/assets/hair/hairline-scalp.json', 'hairline scalp');

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        /* Opaque: blending the cap into the transparent pass made it show the
           crown through itself. The scalp is a filler, so it keeps a near-zero
           cutout — dropping its faint texels would open bald patches. */
        transparent: false,
        alphaTest: DEFAULT_HAIR.scalpCutoff,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: DEFAULT_HAIR.scalpPolyFactor,
        polygonOffsetUnits: DEFAULT_HAIR.scalpPolyUnits,
        side: THREE.DoubleSide,
        color: new THREE.Color(hair?.tone ?? '#1a1412'),
        roughness: DEFAULT_HAIR.scalpRoughness,
        metalness: DEFAULT_HAIR.scalpMetalness,
      }),
    [],
  );

  useEffect(() => {
    material.color.set(hair?.tone ?? '#1a1412');
    const alpha = hair?.alpha !== undefined ? Math.max(0.0, Math.min(1.0, hair.alpha)) : 1.0;
    const state = hairMaterialState(alpha, hair);
    material.opacity = state.opacity;
    material.transparent = state.transparent;
    material.depthWrite = state.depthWrite;
    /* The scalp is a filler: even opaque it keeps a near-zero cutout, because
       dropping its faint texels would open bald patches. */
    material.alphaTest = state.transparent ? state.alphaTest : (hair?.scalpCutoff ?? DEFAULT_HAIR.scalpCutoff);
    material.roughness = hair?.scalpRoughness ?? DEFAULT_HAIR.scalpRoughness;
    material.metalness = hair?.scalpMetalness ?? DEFAULT_HAIR.scalpMetalness;
    material.polygonOffsetFactor = hair?.scalpPolyFactor ?? DEFAULT_HAIR.scalpPolyFactor;
    material.polygonOffsetUnits = hair?.scalpPolyUnits ?? DEFAULT_HAIR.scalpPolyUnits;
    material.needsUpdate = true;
  }, [material, hair]);

  useMaterialTexture(material, 'map', '/assets/hair/hairline01.png', {
    colorSpace: THREE.SRGBColorSpace,
  });
  useMaterialTexture(material, 'normalMap', '/assets/hair/hairline01_n.png');

  useEffect(() => {
    return () => {
      material.map?.dispose();
      material.normalMap?.dispose();
      material.dispose();
    };
  }, [material]);

  const offset = hairOffsetMetres(hair?.hairOffset ?? 0);

  if (!loaded?.geometry) return null;

  const meshElement = (
    <mesh
      name="HairlineUnderlay"
      geometry={loaded.geometry}
      material={material}
      renderOrder={renderOrder}
      position={[0, offset, 0]}
    />
  );

  return rigRoot ? createPortal(meshElement, rigRoot) : meshElement;
}
