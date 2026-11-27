'use client';

import { useCallback, useEffect, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useBuilderStore, type BuilderMode } from '@/lib/builderStore';
import { useCharacter } from '@/lib/store';
import { useViewState } from '@/lib/viewState';
import { cameraSpherical, FRAMING_SPECS } from '@/lib/camera';

interface BuilderCameraProps {
  mode: BuilderMode;
  orbitEnabled: boolean;
}

const HEAD_BASE_Y = 1.48;
const BODY_MID_Y = 0.92;

/**
 * Isometric 3/4 Orbit camera for `build` and `decorate` modes, plus
 * portrait/body close-up orbit camera (with FOV, Framing, and Yaw/Pitch
 * controls from `CameraPanel`) while a furniture Station is active.
 */
export function BuilderCamera({ mode, orbitEnabled }: BuilderCameraProps) {
  const { camera, size } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const prevModeRef = useRef<BuilderMode | null>(null);
  const prevStationIdRef = useRef<string | null>(null);
  const lastPoseNonceRef = useRef<number | null>(null);

  const roomWidth = useBuilderStore((s) => s.roomWidth);
  const roomDepth = useBuilderStore((s) => s.roomDepth);
  const activeStation = useBuilderStore((s) => s.activeStation);

  const cameraFov = useCharacter((s) => s.cameraFov);
  const cameraFraming = useCharacter((s) => s.cameraFraming);
  const cameraPoseRequest = useCharacter((s) => s.cameraPoseRequest);
  const cameraRotateSpeed = useCharacter((s) => s.cameraRotateSpeed);

  const stationOpen = activeStation !== null;

  const publishView = useCallback(() => {
    const orbit = controlsRef.current;
    if (!orbit) return;
    useViewState.setState(cameraSpherical(camera.position, orbit.target));
  }, [camera]);

  // Desktop left-panel projection compensation & dynamic FOV
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    if (mode === 'tour' && !stationOpen) {
      camera.clearViewOffset();
      camera.fov = 52;
      camera.updateProjectionMatrix();
      return;
    }
    camera.fov = stationOpen ? cameraFov : 44;
    const isDesktop = size.width >= 1024;
    if (isDesktop) {
      camera.setViewOffset(
        size.width,
        size.height,
        stationOpen ? -165 : -145,
        0,
        size.width,
        size.height,
      );
    } else {
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
    return () => {
      camera.clearViewOffset();
    };
  }, [camera, mode, stationOpen, cameraFov, size.width, size.height]);

  // Compute target Y & standoff for the current station + framing preset
  const resolveStationView = useCallback(() => {
    const tag = activeStation?.tag;
    const defaultPreset =
      tag === 'mirror' || tag === 'vanity'
        ? 'face'
        : tag === 'dresser'
          ? 'hair'
          : 'body';
    const key = cameraFraming === 'auto' ? defaultPreset : cameraFraming;
    const spec = FRAMING_SPECS[key] ?? FRAMING_SPECS.face;

    let targetY = HEAD_BASE_Y;
    if (key === 'macro') targetY = HEAD_BASE_Y + 0.015;
    else if (key === 'face') targetY = HEAD_BASE_Y - 0.01;
    else if (key === 'hair') targetY = HEAD_BASE_Y + 0.02;
    else if (key === 'bust') targetY = HEAD_BASE_Y - 0.14;
    else if (key === 'mid') targetY = BODY_MID_Y + 0.14;
    else if (key === 'body') targetY = BODY_MID_Y;

    return { standoff: spec.standoff, targetY };
  }, [activeStation?.tag, cameraFraming]);

  // Position camera on station entry, framing switch, or CameraPanel pose request
  useEffect(() => {
    const stationKey = activeStation ? `${activeStation.itemId}:${activeStation.tag}` : null;
    if (activeStation) {
      const { playerPos, playerYaw } = useBuilderStore.getState();
      const [px, , pz] = playerPos;
      const { standoff, targetY } = resolveStationView();

      const req = cameraPoseRequest;
      const hasNewPoseReq = Boolean(req && req.nonce !== lastPoseNonceRef.current);
      const isNewStation = stationKey !== prevStationIdRef.current;

      if (hasNewPoseReq && req) {
        lastPoseNonceRef.current = req.nonce;
        const orbit = controlsRef.current;
        const current = cameraSpherical(
          camera.position,
          orbit?.target ?? new THREE.Vector3(px, targetY, pz),
        );
        const dist = req.distance ?? (req.reset ? standoff : current.distance);
        const tY = req.targetY ?? (req.reset ? targetY : orbit?.target.y ?? targetY);
        const yaw =
          req.yaw !== undefined
            ? playerYaw + req.yaw
            : req.reset
              ? playerYaw
              : (current.yawDeg * Math.PI) / 180;
        const pitch =
          req.pitch !== undefined
            ? req.pitch
            : req.reset
              ? 0
              : (current.pitchDeg * Math.PI) / 180;

        const cosPitch = Math.cos(pitch);
        const camX = px + Math.sin(yaw) * cosPitch * dist;
        const camY = tY - Math.sin(pitch) * dist;
        const camZ = pz + Math.cos(yaw) * cosPitch * dist;

        camera.position.set(camX, camY, camZ);
        if (orbit) {
          orbit.target.set(px, tY, pz);
          orbit.update();
        } else {
          camera.lookAt(px, tY, pz);
        }
        publishView();
        prevStationIdRef.current = stationKey;
        return;
      }

      if (isNewStation || cameraFraming !== 'auto') {
        prevStationIdRef.current = stationKey;
        const camX = px + Math.sin(playerYaw) * standoff;
        const camZ = pz + Math.cos(playerYaw) * standoff;
        camera.position.set(camX, targetY + 0.04, camZ);
        if (controlsRef.current) {
          controlsRef.current.target.set(px, targetY, pz);
          controlsRef.current.update();
        } else {
          camera.lookAt(px, targetY, pz);
        }
        publishView();
      }
      return;
    }

    const closedStation = !activeStation && prevStationIdRef.current !== null;
    prevStationIdRef.current = null;

    if (mode === 'tour') {
      prevModeRef.current = mode;
      return;
    }
    const wasTour = prevModeRef.current === 'tour';
    const isInitial = prevModeRef.current === null;
    prevModeRef.current = mode;

    if (isInitial || wasTour || closedStation) {
      camera.position.set(7.2, 6.8, 8.4);
      if (controlsRef.current) {
        controlsRef.current.target.set(-0.2, 0.7, -0.2);
        controlsRef.current.update();
      } else {
        camera.lookAt(-0.2, 0.7, -0.2);
      }
    }
  }, [camera, mode, activeStation, cameraFraming, cameraPoseRequest, resolveStationView, publishView]);

  if (mode === 'tour' && !stationOpen) return null;

  const maxOrbitDist = stationOpen
    ? 6.0
    : Math.max(20, Math.max(roomWidth, roomDepth) * 1.65);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={stationOpen ? true : orbitEnabled}
      enablePan={!stationOpen}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={stationOpen ? cameraRotateSpeed : 0.75}
      minDistance={stationOpen ? 0.35 : 3.2}
      maxDistance={maxOrbitDist}
      minPolarAngle={THREE.MathUtils.degToRad(stationOpen ? 10 : 22)}
      maxPolarAngle={THREE.MathUtils.degToRad(stationOpen ? 88 : 74)}
      onChange={stationOpen ? publishView : undefined}
    />
  );
}
