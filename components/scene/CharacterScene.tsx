'use client';

import { Suspense, useCallback, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  EffectComposer,
  DepthOfField,
  Vignette,
  Bloom,
  Noise,
  ToneMapping,
} from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode, type DepthOfFieldEffect } from 'postprocessing';
import * as THREE from 'three';
import { createEnvironmentScene, ENV_CONFIG } from '@/components/scene/environments';
import { HeadModel, type SceneHandles } from '@/components/scene/HeadModel';
import { EnbReshadeEffect } from '@/components/scene/EnbReshadeEffect';
import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

interface CharacterSceneProps {
  manifest: Mo2Manifest | null;
  /** True once the character's mesh and albedo are both on screen. */
  onAssetsReady?: (ready: boolean) => void;
  /** Pack mode: why the pack cannot draw the head, or null once it can. */
  onIssue?: (issue: string | null) => void;
}

/** Camera distance and target height, shared by the rig, the controls and
 *  the depth-of-field focus so the three can never drift apart.
 *
 *  Measured against the reference at the same 16:9 aspect: there the head
 *  spans ~80% of the frame height and ~29% of its width. At fov 27° a 0.75 m
 *  standoff gives 2·0.75·tan(13.5°) ≈ 0.360 m of visible height, so the
 *  0.281 m head lands at ~78%. The look-at sits below the head's centre
 *  (y ≈ −0.0116) so the hair keeps a little headroom and the neck gets a
 *  sliver of frame at the bottom, as in the reference. */
const CAM = { y: -0.036, z: 0.75 } as const;

/**
 * Frames the head the way the reference does — the head filling most of the
 * viewport height with the top of the neck below it. On the pack's BODY tab it
 * pulls back to the full outfit instead: the authored outfit runs to y ≈ −1.4,
 * which the head framing can never reach.
 */
function CameraRig({ bodyFraming }: { bodyFraming: boolean }) {
  const { camera, controls } = useThree();
  const hair = useCharacter((s) => s.primaryTab === 'HAIR');
  const moving = useRef(false);
  const goal = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());
  useEffect(() => {
    // Bust framing on HAIR: the head mesh spans y = +0.138…−0.130, so a 1.0 m
    // standoff (≈0.48 m of visible height) frames the crown down to the upper
    // chest. The earlier 1.5 m pulled back to a 0.72 m view — head plus whole
    // torso, not a bust. Long styles run past the bottom edge by design; the
    // wheel reaches 2.2 m for those.
    if (bodyFraming) {
      goal.current.set(0, -0.65, 3.8);
      target.current.set(0, -0.65, 0);
    } else {
      goal.current.set(0, hair ? -0.10 : CAM.y, hair ? 1.0 : CAM.z);
      target.current.set(0, hair ? -0.10 : CAM.y, 0);
    }
    moving.current = true;
    const orbit = controls as OrbitControlsImpl | null;
    const stop = () => { moving.current = false; };
    orbit?.addEventListener('start', stop);
    return () => orbit?.removeEventListener('start', stop);
  }, [hair, bodyFraming, controls]);
  // Before drei's -1 update: camera and target move together, never fight damping.
  useFrame((_, dt) => {
    if (!moving.current) return;
    const orbit = controls as OrbitControlsImpl | null;
    const alpha = 1 - Math.exp(-10 * Math.min(dt, 0.1));
    camera.position.lerp(goal.current, alpha);
    orbit?.target.lerp(target.current, alpha);
    if (camera.position.distanceTo(goal.current) < 0.0005) moving.current = false;
    if (!orbit) camera.lookAt(target.current);
  }, -2);
  return null;
}

/** Environment map for specular response, plus focus tracking for the DoF.
 *
 *  `postprocessing`'s `focusDistance` and `focusRange` are **world units**, not
 *  a depth normalised across near..far — the CoC shader subtracts the former
 *  from a true view-space distance and smoothsteps over the latter. So the
 *  focus has to be the camera's actual distance to the face plane, which the
 *  orbit controls let the user change. */
function PipelineRig({ dof }: { dof: React.RefObject<DepthOfFieldEffect | null> }) {
  const { gl, scene } = useThree();
  const envMode = useCharacter((s) => s.envMode);
  const envRotation = useCharacter((s) => s.envRotation);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = createEnvironmentScene(envMode);
    const env = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = ENV_CONFIG[envMode].baseIntensity;
    pmrem.dispose();
    (envScene as any).dispose?.();
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, scene, envMode]);

  useEffect(() => {
    if (!scene.environmentRotation) {
      scene.environmentRotation = new THREE.Euler(0, 0, 0);
    }
    scene.environmentRotation.set(0, THREE.MathUtils.degToRad(envRotation), 0);
  }, [scene, envRotation]);

  // Focus on the face plane, not the orbit pivot: the nose sits ~0.07 m in
  // front of it. The range is 28% of the standoff, so the whole head stays
  // inside the sharp band at every camera distance the controls allow —
  // bokeh should only ever touch the neck and the far hair.
  const focus = useRef(new THREE.Vector3(0, CAM.y, 0.06));
  useFrame(({ camera, controls }) => {
    const effect = dof.current;
    if (!effect) return;
    const orbit = controls as OrbitControlsImpl | null;
    if (orbit) focus.current.set(0, orbit.target.y, 0.06);
    const d = camera.position.distanceTo(focus.current);
    effect.cocMaterial.focusDistance = d;
    effect.cocMaterial.focusRange = Math.max(0.10, 0.28 * d);
  });

  return null;
}

function SceneContent({ manifest, onAssetsReady, onIssue }: CharacterSceneProps) {
  const onReady = useCallback((_h: SceneHandles) => {}, []);
  const onDirty = useCallback(() => {}, []);
  const dof = useRef<DepthOfFieldEffect>(null);
  const postFxMode = useCharacter((s) => s.postFxMode);
  const hair = useCharacter((s) => s.primaryTab === 'HAIR');
  /* Pack mode's outfit runs to y ≈ −1.4, far outside the head framing. Only
     the BODY tab pulls back; every other tab (and legacy MO2) is unchanged. */
  const primaryTab = useCharacter((s) => s.primaryTab);
  const bodyFraming = manifest?.sourceLayout === 'pack' && primaryTab === 'BODY';

  return (
    <>
      <color attach="background" args={['#07070a']} />
      {/* The fog is atmosphere for the shoulders, not a dimmer on the face:
          its near plane has to stay behind the head or it greys the skin.
          Body framing stands 3.8 m back, so the fog moves behind the subject. */}
      <fog
        attach="fog"
        args={
          bodyFraming
            ? ['#07070a', 4.5, 7]
            : ['#07070a', hair ? 2.1 : 1.35, hair ? 3.65 : 2.9]
        }
      />
      <CameraRig bodyFraming={bodyFraming} />
      <PipelineRig dof={dof} />

      {/* Key from screen-right, fill from screen-left — the reference's cheeks
          measure [168,147,132] (viewer's right) and [130,110,90] (left).

          The ratio is the point. The previous rig was ambient 1.45 plus three
          directionals at 2.0–3.4 plus a 0.9 point light 15 cm from the chin
          (decay 2 makes that ~4× the fill's irradiance), i.e. four sources of
          comparable weight from four directions: a flat, grey, shadowless
          face. This is a real key/fill/rim — one dominant warm key, a weak
          cool fill three stops down, a rim to separate the hair, and a low
          ambient so the shadows keep shape. The environment map carries the
          specular. */}
      <ambientLight intensity={0.30} color="#ffe8d8" />
      <directionalLight position={[0.55, 0.75, 1.0]} intensity={2.2} color="#fff4e6" />
      <directionalLight position={[-0.85, 0.10, 0.60]} intensity={0.55} color="#cfd8e8" />
      <directionalLight position={[-0.25, 0.55, -0.85]} intensity={1.0} color="#8fd0c8" />

      {/* A white point source in front of the face, at eye height, 0.24 m off
          the nose (the head's front surface is at z ≈ +0.11). The directionals
          above are all directional — parallel rays that ignore distance, so
          they shade the whole body evenly. This one falls off, so it lifts the
          eyes, nose and cheeks while the neck and shoulders stay with the
          key/fill and the rim keeps the jaw edge.

          Intensity is candela under three's physical units: irradiance is
          intensity / distance², so 0.14 cd at 0.24 m ≈ 2.4, roughly the key's
          strength at the face. Measured, not guessed: 0.035 changed the cheek
          by +7/255 and was invisible; 0.5 changed it by +56 and flattened the
          freckles out of the skin. 0.14 gives +23 and keeps the texture.

          Offset to screen-right (x +0.06) so it reinforces the key's side
          rather than cancelling it — centred, it pulled the lit and shadow
          cheek within 2/255 of each other and the face went symmetrical.
          `distance={0}` means no cutoff: the falloff is the shaping. */}
      <pointLight position={[0.06, 0.045, 0.35]} intensity={0.14} color="#ffffff" distance={0} decay={2} />




      <Suspense fallback={null}>
        <HeadModel
          manifest={manifest}
          onReady={onReady}
          onDirty={onDirty}
          onAssetsReady={onAssetsReady}
          onIssue={onIssue}
        />
      </Suspense>

      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.06}
        rotateSpeed={0.42}
        zoomSpeed={0.55}
        minDistance={hair ? 0.55 : 0.42}
        maxDistance={bodyFraming ? 4.5 : hair ? 2.2 : 1.35}
        minPolarAngle={Math.PI * 0.26}
        maxPolarAngle={Math.PI * 0.7}
        minAzimuthAngle={-Math.PI * 0.34}
        maxAzimuthAngle={Math.PI * 0.34}
        target={[0, CAM.y, 0]}
      />

      {/* Tone mapping happens exactly once, in the composer: three gates
          `renderer.toneMapping` on `currentRenderTarget === null`
          (WebGLPrograms.js), so everything drawn into the composer's target is
          linear and the trailing <ToneMapping> is the only conversion. The
          Canvas's own `toneMapping` option is therefore inert while this is
          mounted — do not "fix" exposure by touching it. */}
      <EffectComposer multisampling={4}>
        {/* World units, not normalised depth. `focusDistance`/`focusRange` are
            overwritten every frame by PipelineRig; these are only the values
            used on the first frame. */}
        <DepthOfField ref={dof} focusDistance={CAM.z} focusRange={0.22} bokehScale={0.55} height={480} />
        {/* No N8AO. `n8ao@2.0.1` crashes three 0.187 inside
            `WebGLTextures.setupRenderTarget` — every frame throws and the
            viewport renders black. It was the only reason for
            `enableNormalPass`, so that goes too (it costs a full extra
            normal buffer). The socket/lip contact the AO would have given is
            replaced by the key/fill ratio below. */}
        <Bloom
          intensity={0.16}
          luminanceThreshold={0.9}
          luminanceSmoothing={0.18}
          mipmapBlur
          radius={0.45}
        />
        <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.055} />
        {/* Unmounted while off: a pass with all mixes at 0 still costs a
            full-screen shader run plus the enbpalette texture fetch. */}
        {postFxMode !== 'off' && <EnbReshadeEffect mode={postFxMode} />}
        <Vignette eskil={false} offset={0.24} darkness={0.86} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>

    </>
  );
}

export function CharacterScene({ manifest, onAssetsReady, onIssue }: CharacterSceneProps) {
  return (
    <Canvas
      dpr={[1, 1.8]}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      camera={{ fov: 27, near: 0.1, far: 8, position: [0, CAM.y, CAM.z] }}
      onCreated={({ gl }) => {
        gl.setClearColor('#07070a', 1);
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <SceneContent manifest={manifest} onAssetsReady={onAssetsReady} onIssue={onIssue} />
    </Canvas>
  );
}
