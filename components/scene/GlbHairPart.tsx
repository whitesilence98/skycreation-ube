'use client';

import { useEffect, useMemo } from 'react';
import { useFrame, createPortal } from '@react-three/fiber';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { DEFAULT_HAIR, hairOffsetMetres, type HairSettings } from '@/lib/hair/settings';
import { hairMaterialState, hairRoughness } from '@/lib/hair/material';
import { useCharacter } from '@/lib/store';

export interface GlbHairPartProps {
  url: string;
  rigRoot?: THREE.Object3D | null;
  hair?: HairSettings;
  renderOrder?: number;
}

/** Authored glTF alphaMode, captured before the slider pass overwrites it. */
const AUTHORED_BLEND = 'hairAuthoredBlend';

type SwayUniform = { value: number };

interface SwayUniforms {
  uTime: SwayUniform;
  uSway: SwayUniform;
  uCrownY: SwayUniform;
  uFalloff: SwayUniform;
  uFreqX: SwayUniform;
  uFreqZ: SwayUniform;
  uSpeedX: SwayUniform;
  uSpeedZ: SwayUniform;
  uAmpX: SwayUniform;
  uAmpZ: SwayUniform;
  uPhaseZ: SwayUniform;
}

/**
 * GlbHairPart
 *
 * Renders a standalone glTF 2.0 Binary (.glb) hairstyle.
 * Loads embedded geometry, textures, normal maps, and alpha masks directly
 * from GPU buffers with zero runtime NIF conversion.
 *
 * These assets ship as a flat node list with no skin and no animation
 * (`skins: 0`, `animations: 0`), so `SecondaryPhysics` — which only drives
 * registered *bones* — can never move them. The strand sway is therefore done
 * in the vertex shader: a height-weighted sine offset, no skeleton required.
 *
 * Every sway constant is a *uniform*, not an interpolation into the shader
 * source, so dragging a slider in ADVANCED TUNING re-uploads numbers instead of
 * recompiling the program.
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

  // One uniform set per hairstyle: every card swings in phase, which reads as
  // one head of hair rather than 40 independent sheets.
  const sway = useMemo<SwayUniforms>(
    () => ({
      uTime: { value: 0 },
      uSway: { value: 0 },
      uCrownY: { value: DEFAULT_HAIR.swayCrownY },
      uFalloff: { value: DEFAULT_HAIR.swayFalloff },
      uFreqX: { value: DEFAULT_HAIR.swayFreqX },
      uFreqZ: { value: DEFAULT_HAIR.swayFreqZ },
      uSpeedX: { value: DEFAULT_HAIR.swaySpeedX },
      uSpeedZ: { value: DEFAULT_HAIR.swaySpeedZ },
      uAmpX: { value: DEFAULT_HAIR.swayAmpX },
      uAmpZ: { value: DEFAULT_HAIR.swayAmpZ },
      uPhaseZ: { value: DEFAULT_HAIR.swayPhaseZ },
    }),
    [],
  );

  /** Stable identity so the effect can tell "already patched" from "new". */
  const applySway = useMemo(
    () => (shader: THREE.WebGLProgramParametersWithUniforms) => {
      for (const [name, uniform] of Object.entries(sway)) {
        shader.uniforms[name] = uniform;
      }
      shader.vertexShader = `uniform float uTime;
uniform float uSway;
uniform float uCrownY;
uniform float uFalloff;
uniform float uFreqX;
uniform float uFreqZ;
uniform float uSpeedX;
uniform float uSpeedZ;
uniform float uAmpX;
uniform float uAmpZ;
uniform float uPhaseZ;
${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* Height-weighted falloff: still at the crown, full at the tips.
           `uCrownY`/`uFalloff` are in the mesh's own head space. */
        `#include <begin_vertex>
        float swayFalloff = clamp((uCrownY - transformed.y) * uFalloff, 0.0, 1.0);
        swayFalloff *= swayFalloff;
        float swayPhase = transformed.x * uFreqX + transformed.z * uFreqZ;
        transformed.x += sin(uTime * uSpeedX + swayPhase) * uAmpX * swayFalloff * uSway;
        transformed.z += cos(uTime * uSpeedZ + swayPhase * uPhaseZ) * uAmpZ * swayFalloff * uSway;`,
      );
    },
    [sway],
  );

  useEffect(() => {
    const toneColor = hair?.tone ? new THREE.Color(hair.tone) : null;
    const alpha = hair?.alpha !== undefined ? Math.max(0.0, Math.min(1.0, hair.alpha)) : 1.0;
    let order = renderOrder;

    cloned.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.frustumCulled = false;
      // Distinct render orders keep the transparent pass deterministic; in the
      // opaque pass depth sorting already does the job.
      child.renderOrder = order++;

      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;

        const authored = (mat.userData[AUTHORED_BLEND] ??=
          mat.transparent ? true : false) as boolean;

        if (mat.onBeforeCompile !== applySway) {
          mat.onBeforeCompile = applySway;
          /* Without a distinct key three.js reuses the *unpatched* standard
             program for these materials and the sway silently never runs. */
          mat.customProgramCacheKey = () => 'glbHairSway';
          mat.needsUpdate = true;
        }

        if (toneColor && mat.name !== 'Mat_Hl') {
          // Tint non-hairline hair meshes with user's chosen hair tone
          mat.color.copy(toneColor);
        }
        if (hair?.gloss !== undefined) mat.roughness = hairRoughness(hair.gloss, hair);

        const state = hairMaterialState(alpha, hair, authored);
        mat.opacity = state.opacity;
        mat.alphaTest = state.alphaTest;
        mat.depthWrite = state.depthWrite;
        mat.side = THREE.DoubleSide;

        /* GLB cards ship with normal maps but no TANGENT attribute, so the
           shader derives tangents per-fragment. Harmless, but the highlight
           frame is noisy across a card; flatten the normal contribution as the
           gloss rises instead of letting it sparkle like foil. */
        if (mat.normalScale) {
          mat.normalScale.setScalar(
            state.transparent ? (hair?.matNormalFade ?? DEFAULT_HAIR.matNormalFade) : 1,
          );
        }

        if (mat.transparent !== state.transparent) {
          mat.transparent = state.transparent;
          mat.needsUpdate = true;
        }
      }
    });
  }, [cloned, applySway, hair, renderOrder]);

  const physics = useCharacter((s) => s.hairPhysicsEnabled);
  const stiffness = useCharacter((s) => s.secondaryStiffness);
  const wind = useCharacter((s) => s.secondaryWindIntensity);
  const impulseNonce = useCharacter((s) => s.secondaryImpulseNonce);

  const lastNonce = useMemo(() => ({ value: impulseNonce }), []);
  const kick = useMemo(() => ({ value: 0 }), []);

  useFrame((state, delta) => {
    if (impulseNonce !== lastNonce.value) {
      lastNonce.value = impulseNonce;
      kick.value = 1;
    }
    const decay = hair?.swayImpulseDecay ?? DEFAULT_HAIR.swayImpulseDecay;
    kick.value = Math.max(0, kick.value - delta * decay);

    // Push the authored shape of the sway once per frame; these rarely change.
    sway.uCrownY.value = hair?.swayCrownY ?? DEFAULT_HAIR.swayCrownY;
    sway.uFalloff.value = hair?.swayFalloff ?? DEFAULT_HAIR.swayFalloff;
    sway.uFreqX.value = hair?.swayFreqX ?? DEFAULT_HAIR.swayFreqX;
    sway.uFreqZ.value = hair?.swayFreqZ ?? DEFAULT_HAIR.swayFreqZ;
    sway.uSpeedX.value = hair?.swaySpeedX ?? DEFAULT_HAIR.swaySpeedX;
    sway.uSpeedZ.value = hair?.swaySpeedZ ?? DEFAULT_HAIR.swaySpeedZ;
    sway.uAmpX.value = hair?.swayAmpX ?? DEFAULT_HAIR.swayAmpX;
    sway.uAmpZ.value = hair?.swayAmpZ ?? DEFAULT_HAIR.swayAmpZ;
    sway.uPhaseZ.value = hair?.swayPhaseZ ?? DEFAULT_HAIR.swayPhaseZ;

    if (!physics) {
      sway.uSway.value = 0;
      return;
    }
    sway.uTime.value = state.clock.elapsedTime;
    sway.uSway.value =
      (hair?.swayBase ?? DEFAULT_HAIR.swayBase)
      + (1 - stiffness) * (hair?.swayStiffGain ?? DEFAULT_HAIR.swayStiffGain)
      + wind * (hair?.swayWindGain ?? DEFAULT_HAIR.swayWindGain)
      + kick.value * (hair?.swayImpulseGain ?? DEFAULT_HAIR.swayImpulseGain);
  });

  const offset = hairOffsetMetres(hair?.hairOffset ?? 0);

  const element = <primitive object={cloned} position={[0, offset, 0]} />;

  return rigRoot ? createPortal(element, rigRoot) : element;
}
