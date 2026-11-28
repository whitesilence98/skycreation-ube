'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Bloom,
  DepthOfField,
  EffectComposer,
  Noise,
  SMAA,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import {
  BlendFunction,
  SMAAPreset,
  ToneMappingMode,
  type DepthOfFieldEffect,
} from 'postprocessing';
import * as THREE from 'three';
import { EnbReshadeEffect } from '@/components/scene/EnbReshadeEffect';
import { ExposureEffect } from '@/components/scene/ExposureEffect';
import { GradeEffect } from '@/components/scene/GradeEffect';
import { isGradeNeutral } from '@/lib/graphics';
import { useCharacter, type ToneMappingId } from '@/lib/store';
import { useBuilderStore } from '@/lib/builderStore';
import { useGraphicsSettings } from '@/lib/graphicsSettings';

const COMPOSER_TONE_MODE: Record<ToneMappingId, ToneMappingMode> = {
  neutral: ToneMappingMode.NEUTRAL,
  agx: ToneMappingMode.AGX,
  aces: ToneMappingMode.ACES_FILMIC,
  cineon: ToneMappingMode.CINEON,
};

const RENDERER_TONE_MODE: Record<ToneMappingId, THREE.ToneMapping> = {
  neutral: THREE.NeutralToneMapping,
  agx: THREE.AgXToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  cineon: THREE.CineonToneMapping,
};

/**
 * Room Builder post-processing pipeline:
 * - Zero-overhead bypass when no screen-space FX/ENB/Grade are active.
 * - Heavy multi-pass `DepthOfField` & `Bloom` are automatically skipped during
 *   `BUILD` / `DECORATE` / `TOUR` and enabled only during Station close-ups.
 * - Runs `multisampling={0}` so single-pass ENB + Grade + ToneMapping stays fast.
 */
export function RoomPostPipeline() {
  const { gl } = useThree();
  const dofRef = useRef<DepthOfFieldEffect>(null);
  const focusVec = useRef(new THREE.Vector3());

  const activeStation = useBuilderStore((s) => s.activeStation);
  const enbEnabled = useCharacter((s) => s.enbEnabled);
  const enbPreset = useCharacter((s) => s.enbPreset);
  const toneMapping = useCharacter((s) => s.toneMapping);
  const exposure = useCharacter((s) => s.exposure);
  const fx = useCharacter((s) => s.fx);
  const grade = useCharacter((s) => s.grade);
  const roomPostFx = useGraphicsSettings((s) => s.roomPostFx);

  const inStation = activeStation !== null;
  const allowRoomFx =
    roomPostFx === 'always' || (roomPostFx === 'station' && inStation);
  const useBloom = allowRoomFx && fx.bloom;
  const useDof = roomPostFx !== 'off' && inStation && fx.dof;
  const useSmaa = allowRoomFx && fx.smaa;
  const useVignette = allowRoomFx && fx.vignette;
  const useGrain = allowRoomFx && fx.grain;
  const gradeActive = !isGradeNeutral(grade);

  // During free Room Tour / Build / Decorate, skip EffectComposer unless ENB,
  // Grade, or Exposure is explicitly customized so WebGL renders directly at full FPS.
  const mountComposer =
    enbEnabled ||
    gradeActive ||
    exposure !== 1 ||
    useSmaa ||
    useVignette ||
    useGrain ||
    useBloom ||
    useDof;

  // Keep native WebGLRenderer toneMapping synced whenever EffectComposer is unmounted
  useEffect(() => {
    if (mountComposer) return;
    gl.toneMapping = RENDERER_TONE_MODE[toneMapping];
    gl.toneMappingExposure = exposure;
  }, [gl, mountComposer, toneMapping, exposure]);

  useFrame(({ camera }) => {
    const effect = dofRef.current;
    if (!effect || !useDof) return;
    const [px, , pz] = useBuilderStore.getState().playerPos;
    focusVec.current.set(px, 1.48, pz);
    const d = camera.position.distanceTo(focusVec.current);
    effect.cocMaterial.focusDistance = d;
    effect.cocMaterial.focusRange = Math.max(0.16, (d > 1.3 ? 1.35 : 0.28) * d);
  });

  if (!mountComposer) return null;

  return (
    <EffectComposer multisampling={0}>
      {useDof && (
        <DepthOfField
          ref={dofRef}
          focusDistance={1.0}
          focusRange={0.28}
          bokehScale={0.55}
          height={720}
        />
      )}
      {useBloom && (
        <Bloom
          intensity={0.16}
          luminanceThreshold={0.9}
          luminanceSmoothing={0.18}
          mipmapBlur
          radius={0.45}
        />
      )}
      {enbEnabled && <EnbReshadeEffect mode={enbPreset} />}
      {gradeActive && <GradeEffect settings={grade} />}
      {useVignette && <Vignette eskil={false} offset={0.34} darkness={0.48} />}
      {exposure !== 1 && <ExposureEffect exposure={exposure} />}
      <ToneMapping mode={COMPOSER_TONE_MODE[toneMapping]} />
      {useSmaa && <SMAA preset={SMAAPreset.HIGH} />}
      {useGrain && <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.045} />}
    </EffectComposer>
  );
}
