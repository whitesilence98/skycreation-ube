'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { createPortal } from '@react-three/fiber';
import { hairOffsetMetres } from '@/lib/hair/settings';

export interface GlbHairPartProps {
  url: string;
  rigRoot?: THREE.Object3D | null;
  hair?: {
    tone?: string;
    gloss?: number;
    alpha?: number;
    hairOffset?: number;
  };
  renderOrder?: number;
}

/**
 * GlbHairPart
 *
 * Renders a standalone glTF 2.0 Binary (.glb) hairstyle.
 * Loads embedded geometry, textures, normal maps, and alpha masks directly
 * from GPU buffers with zero runtime NIF conversion.
 */
export function GlbHairPart({
  url,
  rigRoot,
  hair,
  renderOrder = 6,
}: GlbHairPartProps) {
  const { scene } = useGLTF(url);

  // Clone scene so multiple mounts or instances don't collide
  const cloned = useMemo(() => scene.clone(true), [scene]);

  // Adjust material properties: double-sided hair cards, alpha masking, render order, color tint, opacity
  useEffect(() => {
    const toneColor = hair?.tone ? new THREE.Color(hair.tone) : null;
    const alpha = hair?.alpha !== undefined ? Math.max(0.0, Math.min(1.0, hair.alpha)) : 1.0;

    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.renderOrder = renderOrder;
        child.frustumCulled = false;

        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.transparent = true;
            mat.depthWrite = alpha > 0.85;
            mat.side = THREE.DoubleSide;

            if (toneColor && mat.name !== 'Mat_Hl') {
              // Tint non-hairline hair meshes with user's chosen hair tone
              mat.color.copy(toneColor);
            }
            if (hair?.gloss !== undefined) {
              mat.roughness = Math.max(0.1, 1.0 - hair.gloss);
            }

            // Real-time hair opacity (alpha) scaling
            mat.opacity = alpha;
            mat.alphaTest = Math.max(0.005, 0.45 * alpha);

            mat.needsUpdate = true;
          }
        }
      }
    });
  }, [cloned, hair?.tone, hair?.gloss, hair?.alpha, renderOrder]);

  const offset = hairOffsetMetres(hair?.hairOffset ?? 0);

  const element = (
    <primitive object={cloned} position={[0, offset, 0]} />
  );

  return rigRoot ? createPortal(element, rigRoot) : element;
}
