'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useBuilderStore } from '@/lib/builderStore';
import { useCharacter } from '@/lib/store';
import { RoomLifeBrain } from '@/lib/builder/lifeBrain';
import { formatSimClock, useRoomLifeStore } from '@/lib/builder/lifeStore';

const _hemiSky = new THREE.Color();
const _hemiGround = new THREE.Color();
const _sunColor = new THREE.Color();

interface DayKey {
  hour: number;
  sky: string;
  ground: string;
  hemiInt: number;
  sun: string;
  sunInt: number;
  sunPos: [number, number, number];
}

const DAY_KEYS: ReadonlyArray<DayKey> = [
  { hour: 0, sky: '#6f7ca6', ground: '#1a1d28', hemiInt: 0.45, sun: '#9cb3e6', sunInt: 0.75, sunPos: [-6, 8, -5] },
  { hour: 6, sky: '#ffd6b0', ground: '#2a2630', hemiInt: 0.72, sun: '#ffbe82', sunInt: 1.55, sunPos: [8, 5, 6] },
  { hour: 12, sky: '#f5efe6', ground: '#2a2e38', hemiInt: 0.88, sun: '#fff6ea', sunInt: 2.35, sunPos: [7.5, 11.5, 6.5] },
  { hour: 18, sky: '#ffbf8c', ground: '#2c242e', hemiInt: 0.72, sun: '#ff9b5e', sunInt: 1.6, sunPos: [-7, 5.5, 7] },
  { hour: 21, sky: '#7682ad', ground: '#1c1f2b', hemiInt: 0.5, sun: '#a8bbed', sunInt: 0.85, sunPos: [-6, 9, -4] },
  { hour: 24, sky: '#6f7ca6', ground: '#1a1d28', hemiInt: 0.45, sun: '#9cb3e6', sunInt: 0.75, sunPos: [-6, 8, -5] },
];

function sampleDayLighting(hourFloat: number) {
  let a = DAY_KEYS[0];
  let b = DAY_KEYS[DAY_KEYS.length - 1];
  for (let i = 0; i < DAY_KEYS.length - 1; i++) {
    if (hourFloat >= DAY_KEYS[i].hour && hourFloat <= DAY_KEYS[i + 1].hour) {
      a = DAY_KEYS[i];
      b = DAY_KEYS[i + 1];
      break;
    }
  }
  const span = Math.max(0.001, b.hour - a.hour);
  const t = (hourFloat - a.hour) / span;
  return { a, b, t };
}

/**
 * Smoothly modulates interior hemisphere & key directional lights according to the
 * in-game 24-hour clock in `useRoomLifeStore`.
 */
export function TimeOfDayLighting() {
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);

  useFrame(() => {
    const mins = useRoomLifeStore.getState().simTimeMinutes % 1440;
    const hourFloat = mins / 60;
    const { a, b, t } = sampleDayLighting(hourFloat);

    if (hemiRef.current) {
      _hemiSky.set(a.sky).lerp(new THREE.Color(b.sky), t);
      _hemiGround.set(a.ground).lerp(new THREE.Color(b.ground), t);
      hemiRef.current.color.copy(_hemiSky);
      hemiRef.current.groundColor.copy(_hemiGround);
      hemiRef.current.intensity = THREE.MathUtils.lerp(a.hemiInt, b.hemiInt, t);
    }

    if (sunRef.current) {
      _sunColor.set(a.sun).lerp(new THREE.Color(b.sun), t);
      sunRef.current.color.copy(_sunColor);
      sunRef.current.intensity = THREE.MathUtils.lerp(a.sunInt, b.sunInt, t);
      sunRef.current.position.set(
        THREE.MathUtils.lerp(a.sunPos[0], b.sunPos[0], t),
        THREE.MathUtils.lerp(a.sunPos[1], b.sunPos[1], t),
        THREE.MathUtils.lerp(a.sunPos[2], b.sunPos[2], t),
      );
    }
  });

  return (
    <>
      <hemisphereLight ref={hemiRef} args={['#f5efe6', '#2a2e38', 0.85]} />
      <directionalLight
        ref={sunRef}
        position={[7.5, 11.5, 6.5]}
        intensity={2.35}
        color="#fff6ea"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-camera-near={1}
        shadow-camera-far={28}
        shadow-bias={-0.0004}
        shadow-normalBias={0.015}
      />
      <directionalLight position={[-6, 5, -5]} intensity={0.75} color="#c9daf0" />
    </>
  );
}

interface RoomLifeControllerProps {
  playerGroupRef: RefObject<THREE.Group | null>;
}

/**
 * Drives the in-game clock and autonomous `RoomLifeBrain` when in `BUILD WALLS` or
 * `DECORATE` mode. Pauses AI movement cleanly during `TOUR`.
 */
export function RoomLifeController({ playerGroupRef }: RoomLifeControllerProps) {
  const mode = useBuilderStore((s) => s.mode);
  const aiEnabled = useRoomLifeStore((s) => s.aiEnabled);
  const brainRef = useRef<RoomLifeBrain | null>(null);
  if (!brainRef.current) brainRef.current = new RoomLifeBrain();

  const lastAnimRef = useRef<'walk' | 'idle-clip'>('idle-clip');
  const storeSyncAccumRef = useRef(0);
  const lastActivityKeyRef = useRef('');

  useEffect(() => {
    if (mode === 'tour' || !aiEnabled) {
      brainRef.current?.clearPlan();
      if (mode !== 'tour' && !aiEnabled) {
        if (lastAnimRef.current !== 'idle-clip') {
          lastAnimRef.current = 'idle-clip';
          useCharacter.getState().setAnimationId('idle-clip');
        }
        useRoomLifeStore.getState().setActivity({
          state: 'idle',
          actionTag: 'idle',
          label: 'AI Paused',
          reason: 'Manual idle',
          targetItemId: null,
          progress: 0,
        });
      }
    }
  }, [mode, aiEnabled]);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const life = useRoomLifeStore.getState();
    const deltaGameMins = dt * life.timeScale;

    // Advance the room clock across all Room Builder modes
    if (deltaGameMins > 0) {
      life.advanceClock(deltaGameMins);
    }

    // Yield character locomotion completely to TourController in TOUR mode
    if (mode === 'tour' || !life.aiEnabled) return;

    const player = playerGroupRef.current;
    const builder = useBuilderStore.getState();
    const curX = player ? player.position.x : builder.playerPos[0];
    const curZ = player ? player.position.z : builder.playerPos[2];
    const curYaw = player ? player.rotation.y : builder.playerYaw;

    const clock = formatSimClock(life.simTimeMinutes + deltaGameMins);

    const out = brainRef.current!.step({
      dtRealSec: dt,
      deltaGameMins,
      timeScale: life.timeScale,
      hourOfDay: clock.hours,
      clockFormatted: clock.formatted,
      pos: [curX, curZ],
      yaw: curYaw,
      needs: life.needs,
      placedItems: builder.placedItems,
      recentItemIds: life.recentItemIds,
    });

    if (player) {
      player.position.set(out.pos[0], 0, out.pos[1]);
      player.rotation.y = out.yaw;
    }

    if (out.animationId !== lastAnimRef.current) {
      lastAnimRef.current = out.animationId;
      useCharacter.getState().setAnimationId(out.animationId);
    }

    if (out.consumedRecentItemId) {
      life.consumeRecentItem(out.consumedRecentItemId);
    }
    if (out.newThought) {
      life.pushThought(out.newThought);
    }

    // Throttle React/store updates to ~5 Hz or immediate state transitions
    const activityKey = `${out.activity.state}:${out.activity.label}:${out.activity.targetItemId ?? ''}`;
    storeSyncAccumRef.current += dt;
    if (storeSyncAccumRef.current >= 0.2 || activityKey !== lastActivityKeyRef.current) {
      storeSyncAccumRef.current = 0;
      lastActivityKeyRef.current = activityKey;
      life.setNeeds(out.needs);
      life.setActivity(out.activity);
      builder.setPlayerPose([out.pos[0], 0, out.pos[1]], out.yaw);
    }
  });

  return null;
}
