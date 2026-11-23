'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { createPortal } from '@react-three/fiber';
import { useMeshGeometry, useMaterialTexture } from '@/components/scene/useMeshGeometry';
import { hairOffsetMetres } from '@/lib/hair/settings';

export interface HairlineUnderlayProps {
  rigRoot?: THREE.Object3D | null;
  hair?: {
    tone: string;
    gloss?: number;
    alpha?: number;
    hairOffset?: number;
  };
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
        transparent: true,
        alphaTest: 0.02,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
        side: THREE.DoubleSide,
        color: new THREE.Color(hair?.tone ?? '#1a1412'),
        roughness: 0.85,
        metalness: 0.05,
      }),
    [],
  );

  useEffect(() => {
    material.color.set(hair?.tone ?? '#1a1412');
    const alpha = hair?.alpha !== undefined ? Math.max(0.0, Math.min(1.0, hair.alpha)) : 1.0;
    material.opacity = alpha;
    material.alphaTest = 0.02 * alpha;
    material.needsUpdate = true;
  }, [material, hair?.tone, hair?.alpha]);

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
