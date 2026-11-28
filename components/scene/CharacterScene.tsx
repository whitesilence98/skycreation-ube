'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
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
  SMAA,
} from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode, SMAAPreset, type DepthOfFieldEffect } from 'postprocessing';
import * as THREE from 'three';
import { createEnvironmentScene, ENV_CONFIG } from '@/components/scene/environments';
import { HeadModel, type SceneHandles } from '@/components/scene/HeadModel';
import { EnbReshadeEffect } from '@/components/scene/EnbReshadeEffect';
import { GradeEffect } from '@/components/scene/GradeEffect';
import { BackgroundStage } from '@/components/scene/BackgroundStage';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { useHdr } from '@/lib/hdrState';
import { inspectHdrHeader, checkHdrDimensions } from '@/lib/hdr';
import { ExposureEffect } from '@/components/scene/ExposureEffect';
import { FrameRateCap } from '@/components/scene/FrameRateCap';
import { GraphicsRuntimeBridge } from '@/components/scene/GraphicsRuntimeBridge';
import { SHADOW_QUALITY_SPEC, useGraphicsSettings } from '@/lib/graphicsSettings';
import { StatsProbe } from '@/components/scene/StatsProbe';
import { isGradeNeutral } from '@/lib/graphics';
import {
  cameraSpherical,
  FRAMING_SPECS,
  goldenRatioOffset,
  resolveTabCameraSpec,
  CAMERA_FOV_DEFAULT,
} from '@/lib/camera';
import { rigDirections } from '@/lib/lighting';
import { useViewState } from '@/lib/viewState';
import { useCharacter, type ToneMappingId } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { GlbExportBridge } from '@/lib/exportGlb';
import { PresetCaptureBridge } from '@/components/scene/PresetCaptureBridge';

interface CharacterSceneProps {
  manifest: Mo2Manifest | null;
  /** True once the character's mesh and albedo are both on screen. */
  onAssetsReady?: (ready: boolean) => void;
  /** Pack mode: why the pack cannot draw the head, or null once it can. */
  onIssue?: (issue: string | null) => void;
}

/** Camera distance and target height, calibrated for AAA portrait telephoto framing (85mm equivalent). */
const CAM = { y: -0.008, z: 0.72 } as const;
const ORBIT_MOUSE_BUTTONS = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

/** The store's display-transform vocabulary → the composer's enum. Typed as a
 *  total map so adding an id without a mode fails the typecheck. */
const TONE_MAPPING_MODE: Record<ToneMappingId, ToneMappingMode> = {
  neutral: ToneMappingMode.NEUTRAL,
  agx: ToneMappingMode.AGX,
  aces: ToneMappingMode.ACES_FILMIC,
  cineon: ToneMappingMode.CINEON,
};

const FLOOR_Y = -1.476;

function ViewControls({ packMode }: { packMode: boolean }) {
  const rotateSpeed = useCharacter((s) => s.cameraRotateSpeed);
  const cameraLockMode = useCharacter((s) => s.cameraLockMode);
  const cameraFraming = useCharacter((s) => s.cameraFraming);
  const primaryTab = useCharacter((s) => s.primaryTab);
  const featuresSection = useCharacter((s) => s.featuresSection);
  const makeupSection = useCharacter((s) => s.makeupSection);
  const physiqueSection = useCharacter((s) => s.physiqueSection);
  const equipSlot = useCharacter((s) => s.equipSlot);

  const locked = cameraLockMode === 'locked' && cameraFraming === 'auto';
  const spec = locked
    ? resolveTabCameraSpec({
        primaryTab,
        featuresSection,
        makeupSection,
        physiqueSection,
        equipSlot,
        packMode,
      })
    : null;

  return (
    <OrbitControls
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.07}
      mouseButtons={ORBIT_MOUSE_BUTTONS}
      rotateSpeed={rotateSpeed}
      zoomSpeed={0.55}
      minDistance={spec ? spec.minDistance : 0.30}
      maxDistance={spec ? spec.maxDistance : 6.0}
      minPolarAngle={spec ? THREE.MathUtils.degToRad(spec.minPolarDeg) : Math.PI * 0.10}
      maxPolarAngle={spec ? THREE.MathUtils.degToRad(spec.maxPolarDeg) : Math.PI * 0.90}
      minAzimuthAngle={spec && spec.minAzimuthDeg !== null ? THREE.MathUtils.degToRad(spec.minAzimuthDeg) : -Infinity}
      maxAzimuthAngle={spec && spec.maxAzimuthDeg !== null ? THREE.MathUtils.degToRad(spec.maxAzimuthDeg) : Infinity}
      target={[0, CAM.y, 0]}
    />
  );
}

/**
 * Frames the character using AAA cinematic principles:
 * - Dynamic Bone Tracking: Anchors to `NPC Head [Head]` so poses/height never detach focus.
 * - Golden Ratio: Eye line locked at 62% viewport height (Upper Third).
 * - 85mm portrait telephoto compression (22° FOV).
 * - 330px HUD drawer compensation via camera.setViewOffset.
 */
function CameraRig({ bodyFraming, packMode }: { bodyFraming: boolean; packMode: boolean }) {
  const { camera, controls, gl, scene, size } = useThree();
  const hair = useCharacter((s) => s.primaryTab === 'HAIR');
  const primaryTab = useCharacter((s) => s.primaryTab);
  const featuresSection = useCharacter((s) => s.featuresSection);
  const makeupSection = useCharacter((s) => s.makeupSection);
  const physiqueSection = useCharacter((s) => s.physiqueSection);
  const equipSlot = useCharacter((s) => s.equipSlot);
  const cameraLockMode = useCharacter((s) => s.cameraLockMode);
  const cameraFov = useCharacter((s) => s.cameraFov);
  const characterHeight = useCharacter((s) => s.characterHeight);
  const cameraFraming = useCharacter((s) => s.cameraFraming);
  const cameraPoseRequest = useCharacter((s) => s.cameraPoseRequest);

  const moving = useRef(false);
  const goal = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());
  const lastNonce = useRef<number | null>(null);
  const publishNow = useRef<(() => void) | null>(null);

  // Sync camera FOV
  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      if (camera.fov !== cameraFov) {
        camera.fov = cameraFov;
        camera.updateProjectionMatrix();
      }
    }
  }, [camera, cameraFov]);

  // Viewport Offset for 330px Left HUD Panel
  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      const isDesktop = size.width >= 1024;
      const panelWidth = isDesktop ? 330 : 0;
      if (panelWidth > 0) {
        camera.setViewOffset(size.width, size.height, -panelWidth / 2, 0, size.width, size.height);
      } else {
        camera.clearViewOffset();
      }
    }
  }, [camera, size.width, size.height]);

  // Dynamic bone anchor resolution
  const getAnchorWorldY = useCallback((): {
    headY: number;
    eyesY: number;
    lipsY: number;
    jawY: number;
    bodyMidY: number;
    handsY: number;
    feetY: number;
  } => {
    const headBone = scene.getObjectByName('NPC Head [Head]');
    const pelvisBone = scene.getObjectByName('NPC Pelvis [Pelv]');
    const handBone = scene.getObjectByName('NPC L Hand [LHnd]');
    let headY: number = CAM.y;
    let eyesY: number = CAM.y + 0.025;
    let bodyMidY: number = -0.65;
    let pelvisY: number = -0.75;
    let handsY: number = -0.7;
    const feetY: number = FLOOR_Y + 0.18;

    if (headBone) {
      const headPos = new THREE.Vector3();
      headBone.getWorldPosition(headPos);
      headY = headPos.y;
      eyesY = headPos.y + 0.025;
    }

    if (pelvisBone) {
      const pelvisPos = new THREE.Vector3();
      pelvisBone.getWorldPosition(pelvisPos);
      pelvisY = pelvisPos.y;
      bodyMidY = (headY + pelvisY) / 2;
      handsY = pelvisY + 0.04;
    } else {
      bodyMidY = headY - 0.72;
    }

    if (handBone) {
      const handPos = new THREE.Vector3();
      handBone.getWorldPosition(handPos);
      handsY = handPos.y;
    }

    return {
      headY,
      eyesY,
      lipsY: headY - 0.042,
      jawY: headY - 0.03,
      bodyMidY,
      handsY,
      feetY,
    };
  }, [scene]);

  useEffect(() => {
    const anchors = getAnchorWorldY();
    let baseStandoff: number = FRAMING_SPECS.face.standoff;
    let baseTargetY: number = anchors.eyesY - goldenRatioOffset(baseStandoff, cameraFov);
    let defaultYawRad = 0;
    let defaultPitchRad = 0;

    if (cameraFraming === 'auto') {
      if (cameraLockMode === 'locked') {
        const spec = resolveTabCameraSpec({
          primaryTab,
          featuresSection,
          makeupSection,
          physiqueSection,
          equipSlot,
          packMode,
        });
        baseStandoff = spec.standoff * (spec.scaleByHeight ? characterHeight / 1.554 : 1);
        defaultYawRad = THREE.MathUtils.degToRad(spec.yawDeg);
        defaultPitchRad = THREE.MathUtils.degToRad(spec.pitchDeg);
        if (spec.anchor === 'eyes') {
          baseTargetY = anchors.eyesY - goldenRatioOffset(baseStandoff, cameraFov);
        } else if (spec.anchor === 'lips') {
          baseTargetY = anchors.lipsY;
        } else if (spec.anchor === 'jaw') {
          baseTargetY = anchors.jawY;
        } else if (spec.anchor === 'head') {
          baseTargetY = anchors.headY;
        } else if (spec.anchor === 'hands') {
          baseTargetY = anchors.handsY;
        } else if (spec.anchor === 'feet') {
          baseTargetY = anchors.feetY;
        } else {
          baseTargetY = anchors.bodyMidY;
        }
      } else if (bodyFraming) {
        baseStandoff = FRAMING_SPECS.body.standoff * (characterHeight / 1.554);
        baseTargetY = anchors.bodyMidY;
      } else if (hair) {
        baseStandoff = FRAMING_SPECS.hair.standoff;
        baseTargetY = anchors.headY;
      } else {
        baseStandoff = FRAMING_SPECS.face.standoff;
        baseTargetY = anchors.eyesY - goldenRatioOffset(baseStandoff, cameraFov);
      }
    } else {
      const spec = (FRAMING_SPECS as any)[cameraFraming] ?? FRAMING_SPECS.face;
      baseStandoff = spec.standoff;
      if (cameraFraming === 'macro') {
        baseTargetY = anchors.eyesY - goldenRatioOffset(baseStandoff, cameraFov);
      } else if (cameraFraming === 'face') {
        baseTargetY = anchors.eyesY - goldenRatioOffset(baseStandoff, cameraFov);
      } else if (cameraFraming === 'hair') {
        baseTargetY = anchors.headY;
      } else if (cameraFraming === 'bust') {
        baseTargetY = anchors.headY - 0.12;
      } else if (cameraFraming === 'mid') {
        baseTargetY = anchors.bodyMidY + 0.15;
      } else if (cameraFraming === 'body') {
        baseStandoff *= characterHeight / 1.554;
        baseTargetY = anchors.bodyMidY;
      } else {
        baseTargetY = spec.targetY;
      }
    }

    const orbit = controls as OrbitControlsImpl | null;
    const req = cameraPoseRequest;

    if (req && req.nonce !== lastNonce.current) {
      lastNonce.current = req.nonce;
      const current = cameraSpherical(camera.position, orbit?.target ?? new THREE.Vector3(0, baseTargetY, 0));
      // Changing only yaw or pitch must not reset the other angle or wheel zoom.
      const dist = req.distance ?? (req.reset ? baseStandoff : current.distance);
      const tY = req.targetY ?? (req.reset ? baseTargetY : orbit?.target.y ?? baseTargetY);
      const yaw = req.yaw ?? (req.reset ? defaultYawRad : (current.yawDeg * Math.PI) / 180);
      const pitch = req.pitch ?? (req.reset ? defaultPitchRad : (current.pitchDeg * Math.PI) / 180);

      const r = dist;
      const cosPitch = Math.cos(pitch);
      const sinPitch = Math.sin(pitch);
      const x = r * cosPitch * Math.sin(yaw);
      const y = Math.max(FLOOR_Y + 0.14, tY - r * sinPitch);
      const z = r * cosPitch * Math.cos(yaw);

      goal.current.set(x, y, z);
      target.current.set(0, tY, 0);
      moving.current = true;
    } else {
      const cosPitch = Math.cos(defaultPitchRad);
      const sinPitch = Math.sin(defaultPitchRad);
      const x = baseStandoff * cosPitch * Math.sin(defaultYawRad);
      const y = Math.max(FLOOR_Y + 0.14, baseTargetY - baseStandoff * sinPitch);
      const z = baseStandoff * cosPitch * Math.cos(defaultYawRad);
      goal.current.set(x, y, z);
      target.current.set(0, baseTargetY, 0);
      moving.current = true;
    }

    moving.current = true;
  }, [
    hair,
    bodyFraming,
    packMode,
    primaryTab,
    featuresSection,
    makeupSection,
    physiqueSection,
    equipSlot,
    cameraLockMode,
    characterHeight,
    cameraFraming,
    cameraPoseRequest,
    controls,
    camera,
    cameraFov,
    getAnchorWorldY,
  ]);

  useEffect(() => {
    const orbit = controls as OrbitControlsImpl | null;
    if (!orbit) return;
    let lastPublished = 0;
    let lastAdaptiveDist = camera.position.distanceTo(orbit.target);
    const publish = (force = false) => {
      const now = performance.now();
      if (!force && now - lastPublished < 80) return;
      lastPublished = now;
      const view = cameraSpherical(camera.position, orbit.target);
      const next = { yawDeg: Math.round(view.yawDeg), pitchDeg: -Math.round(view.pitchDeg), distance: Math.round(view.distance * 100) / 100 };
      const old = useViewState.getState();
      if (next.yawDeg !== old.yawDeg || next.pitchDeg !== old.pitchDeg || next.distance !== old.distance) useViewState.setState(next);
    };
    const start = () => { moving.current = false; gl.domElement.style.cursor = 'grabbing'; };
    const end = () => { gl.domElement.style.cursor = 'grab'; publish(true); };
    const change = () => {
      const dist = camera.position.distanceTo(orbit.target);
      if (!moving.current && Math.abs(dist - lastAdaptiveDist) > 0.004) {
        lastAdaptiveDist = dist;
        const anchors = getAnchorWorldY();
        const faceY = anchors.eyesY - goldenRatioOffset(FRAMING_SPECS.face.standoff, cameraFov);
        const t = Math.min(1, Math.max(0, (dist - 1.25) / 2.25));
        const smooth = t * t * (3 - 2 * t);
        const desiredY = THREE.MathUtils.lerp(faceY, anchors.bodyMidY, smooth);
        const dy = desiredY - orbit.target.y;
        if (Math.abs(dy) > 0.0005) {
          orbit.target.y += dy;
          camera.position.y += dy;
        }
      } else if (moving.current) {
        lastAdaptiveDist = dist;
      }
      publish();
    };
    publishNow.current = () => publish(true);
    gl.domElement.style.cursor = 'grab';
    publish(true);
    orbit.addEventListener('start', start);
    orbit.addEventListener('end', end);
    orbit.addEventListener('change', change);
    return () => {
      orbit.removeEventListener('start', start);
      orbit.removeEventListener('end', end);
      orbit.removeEventListener('change', change);
      publishNow.current = null;
      gl.domElement.style.cursor = '';
    };
  }, [camera, controls, gl, cameraFov, getAnchorWorldY]);
  // Before drei's -1 update: camera and target move together, never fight damping.
  useFrame((_, dt) => {
    if (camera.position.y < FLOOR_Y + 0.14) {
      camera.position.y = FLOOR_Y + 0.14;
    }
    if (!moving.current) return;
    const orbit = controls as OrbitControlsImpl | null;
    const alpha = 1 - Math.exp(-10 * Math.min(dt, 0.1));
    camera.position.lerp(goal.current, alpha);
    orbit?.target.lerp(target.current, alpha);
    if (camera.position.distanceTo(goal.current) < 0.0005 && (!orbit || orbit.target.distanceTo(target.current) < 0.0005)) {
      camera.position.copy(goal.current);
      orbit?.target.copy(target.current);
      moving.current = false;
      // The exact final pose never reaches OrbitControls, so flush it here.
      publishNow.current?.();
    }
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
  const envIntensity = useCharacter((s) => s.envIntensity);
  const hdrSource = useHdr(s => s.source);
  const [customReady, setCustomReady] = useState(false);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    let envTarget: THREE.WebGLRenderTarget | undefined;
    let texture: THREE.DataTexture | undefined;
    let envScene: THREE.Scene | undefined;
    let ready = false;
    try {
      if (hdrSource) {
        inspectHdrHeader(hdrSource.buffer, hdrSource.format);
        const loader = hdrSource.format === 'hdr' ? new HDRLoader() : new EXRLoader();
        texture = loader.createDataTexture(hdrSource.buffer);
        checkHdrDimensions(texture.image.width, texture.image.height);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        envTarget = pmrem.fromEquirectangular(texture);
        ready = true;
        useHdr.setState({ status: 'ready', error: null });
      }
    } catch (error) {
      useHdr.setState({ status: 'error', error: error instanceof Error ? error.message : 'Could not decode this HDRI. Try a standard equirectangular HDR panorama.' });
    } finally {
      texture?.dispose();
    }
    try {
      if (!envTarget) {
        envScene = createEnvironmentScene(envMode);
        envTarget = pmrem.fromScene(envScene, 0.04);
      }
      scene.environment = envTarget.texture;
      setCustomReady(ready);
    } finally {
      pmrem.dispose();
      envScene?.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
        }
      });
    }
    const owned = envTarget;
    return () => {
      if (scene.environment === owned?.texture) scene.environment = null;
      owned?.dispose();
    };
  }, [gl, scene, envMode, hdrSource]);

  useEffect(() => {
    scene.environmentIntensity = (customReady ? 1 : ENV_CONFIG[envMode].baseIntensity) * envIntensity;
  }, [scene, envMode, envIntensity, customReady]);

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
    // When close up on face (<1.2m), maintain shallow portrait bokeh on the background.
    // When zoomed out (>1.2m), scale focus range up so the entire head-to-toe body stays sharp.
    const rangeMult = d > 1.2 ? 1.4 : 0.28;
    effect.cocMaterial.focusRange = Math.max(0.12, rangeMult * d);
  });

  return null;
}

function SceneContent({ manifest, onAssetsReady, onIssue }: CharacterSceneProps) {
  const onReady = useCallback((_h: SceneHandles) => {}, []);
  const onDirty = useCallback(() => {}, []);
  const dof = useRef<DepthOfFieldEffect>(null);
  const enbEnabled = useCharacter((s) => s.enbEnabled);
  const enbPreset = useCharacter((s) => s.enbPreset);
  const toneMapping = useCharacter((s) => s.toneMapping);
  const exposure = useCharacter(s => s.exposure);
  const fx = useCharacter((s) => s.fx);
  const grade = useCharacter((s) => s.grade);
  const lighting = useCharacter((s) => s.lighting);
  const dirs = rigDirections(lighting);
  /* Pack mode's outfit runs to y ≈ −1.4, far outside the head framing.
     Both BODY (Physique) and EQUIPMENT (Gear Slots) tabs, as well as PRESET,
     pull back to full-body framing. */
  const primaryTab = useCharacter((s) => s.primaryTab);
  const bodyFraming = (manifest?.sourceLayout === 'pack' && (primaryTab === 'BODY' || primaryTab === 'EQUIPMENT')) || primaryTab === 'PRESET';
  const backgroundMode = useCharacter((s) => s.backgroundMode);
  const customBackgroundUrl = useCharacter((s) => s.customBackgroundUrl);
  const shadowQuality = useGraphicsSettings((s) => s.shadowQuality);
  const shadowSpec = SHADOW_QUALITY_SPEC[shadowQuality];
  const keyLightRef = useRef<THREE.DirectionalLight>(null);

  useEffect(() => {
    const key = keyLightRef.current;
    if (!key) return;
    if (key.shadow.map) {
      key.shadow.map.dispose();
      key.shadow.map = null;
    }
    key.shadow.mapSize.set(shadowSpec.mapSize, shadowSpec.mapSize);
    key.shadow.needsUpdate = true;
  }, [shadowSpec.mapSize, shadowSpec.enabled]);

  const isBody = bodyFraming;
  const packMode = manifest?.sourceLayout === 'pack';

  return (
    <>
      <BackgroundStage mode={backgroundMode} customUrl={customBackgroundUrl} />
      <CameraRig bodyFraming={bodyFraming} packMode={packMode} />
      <PipelineRig dof={dof} />
      <StatsProbe />

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
      <ambientLight intensity={0.75 * (1 + grade.ambient / 10)} color="#fff2e6" />
      {/* The key is the one shadow caster. A directional light's shadow camera
          is an orthographic box around its target, calibrated for both tight
          head framing and full-body silhouette framing. */}
      <directionalLight
        ref={keyLightRef}
        position={dirs.key}
        intensity={2.8 * lighting.intensity}
        color={lighting.keyColor}
        castShadow={shadowSpec.enabled}
        shadow-mapSize={[shadowSpec.mapSize, shadowSpec.mapSize]}
        shadow-camera-left={isBody ? -1.1 : -0.55}
        shadow-camera-right={isBody ? 1.1 : 0.55}
        shadow-camera-top={isBody ? 0.95 : 0.75}
        shadow-camera-bottom={isBody ? -1.65 : -0.75}
        shadow-camera-near={0.1}
        shadow-camera-far={isBody ? 6.0 : 3.0}
        shadow-bias={-0.0003}
        shadow-normalBias={0.012}
      />
      <directionalLight position={dirs.fill} intensity={1.35 * lighting.fill * lighting.intensity} color="#dce6f2" />
      <directionalLight position={dirs.rim} intensity={1.4 * lighting.rim * lighting.intensity} color="#f0dfbe" />
      <directionalLight position={dirs.bounce} intensity={0.85 * lighting.intensity} color="#faeee4" />

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
      <pointLight position={[0.05, 0.05, 0.38]} intensity={0.38 * lighting.intensity} color="#ffffff" distance={0} decay={2} />




      <Suspense fallback={null}>
        <HeadModel
          manifest={manifest}
          onReady={onReady}
          onDirty={onDirty}
          onAssetsReady={onAssetsReady}
          onIssue={onIssue}
        />
      </Suspense>

      <GlbExportBridge />
      <PresetCaptureBridge />

      <ViewControls packMode={packMode} />

      {/* Tone mapping happens exactly once, in the composer: three gates
          `renderer.toneMapping` on `currentRenderTarget === null`
          (WebGLPrograms.js), so everything drawn into the composer's target is
          linear and the trailing <ToneMapping> is the only conversion. The
          Canvas's own `toneMapping` option is therefore inert while this is
          mounted — do not "fix" exposure by touching it. */}
      {/* SMAA replaces MSAA when enabled; hair alpha-to-coverage needs MSAA. */}
      <EffectComposer multisampling={fx.smaa ? 0 : 4}>
        {/* World units, not normalised depth. `focusDistance`/`focusRange` are
            overwritten every frame by PipelineRig; these are only the values
            used on the first frame. Unmounting is safe: PipelineRig guards on
            a null ref, and the pass order is rebuilt on the next commit. */}
        {fx.dof && (
          <DepthOfField ref={dof} focusDistance={CAM.z} focusRange={0.22} bokehScale={0.55} height={720} />
        )}
        {/* No N8AO. `n8ao@2.0.1` crashes three 0.187 inside
            `WebGLTextures.setupRenderTarget` — every frame throws and the
            viewport renders black. It was the only reason for
            `enableNormalPass`, so that goes too (it costs a full extra
            normal buffer). The socket/lip contact the AO would have given is
            replaced by the key/fill ratio below. */}
        {fx.bloom && (
          <Bloom
            intensity={0.16}
            luminanceThreshold={0.9}
            luminanceSmoothing={0.18}
            mipmapBlur
            radius={0.45}
          />
        )}
        {/* Unmounted while off: a pass with all mixes at 0 still costs a
            full-screen shader run plus the enbpalette texture fetch. */}
        {enbEnabled && <EnbReshadeEffect mode={enbPreset} />}
        {/* The grade pass is mounted only when it would change a pixel, so the
            neutral state costs nothing and the default frame is untouched. It
            sits before Vignette so the vignette darkens the graded image, as a
            camera overlay would. */}
        {!isGradeNeutral(grade) && <GradeEffect settings={grade} />}
        {fx.vignette && <Vignette eskil={false} offset={0.34} darkness={0.48} />}
        {exposure !== 1 && <ExposureEffect exposure={exposure} />}
        <ToneMapping mode={TONE_MAPPING_MODE[toneMapping]} />
        {/* SMAA runs on clean edges before film grain to prevent false edge noise detection */}
        {fx.smaa && <SMAA preset={SMAAPreset.HIGH} />}
        {fx.grain && <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.045} />}
      </EffectComposer>

    </>
  );
}

function createCustomRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  try {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    return renderer;
  } catch (err) {
    console.warn('[CharacterScene] Primary WebGL renderer creation failed, attempting fallback...', err);
  }

  try {
    const fallbackRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false,
    });
    fallbackRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    return fallbackRenderer;
  } catch (fatalErr) {
    console.error('[CharacterScene] Fatal WebGL context creation failure:', fatalErr);
    throw new Error(
      'Could not allocate a WebGL context in your browser. ' +
      'Please check chrome://settings/system (or edge://settings/system) and make sure "Use hardware acceleration when available" is turned ON, then relaunch the browser.'
    );
  }
}

export function CharacterScene({ manifest, onAssetsReady, onIssue }: CharacterSceneProps) {
  return (
    <Canvas
      frameloop="never"
      dpr={[1, 1.5]}
      /* One shadow-casting key light (see the light block above). This is the
         stand-in for the SSAO pass that cannot run here: without it the nose,
         lip line and eye sockets receive no contact darkening at all, which is
         a large part of why the face reads as an airbrushed mask. PCF soft
         shadows are the default type and are enough at this map size. */
      shadows
      gl={(defaults) => createCustomRenderer(defaults.canvas as HTMLCanvasElement)}
      camera={{ fov: CAMERA_FOV_DEFAULT, near: 0.1, far: 8, position: [0, CAM.y, CAM.z] }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        /* Matches the studio pool's outer edge, so a frame cleared before the
           backdrop quad draws does not flash black. */
        gl.setClearColor('#121216', 1);
        /* The composer issues several internal renders per frame; with the
           default auto-reset the counters would only describe the last one.
           StatsProbe reads and resets them once per window instead. */
        gl.info.autoReset = false;
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <FrameRateCap />
      <GraphicsRuntimeBridge />
      <SceneContent manifest={manifest} onAssetsReady={onAssetsReady} onIssue={onIssue} />
    </Canvas>
  );
}
