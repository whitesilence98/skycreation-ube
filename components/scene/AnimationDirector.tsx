'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCharacter } from '@/lib/store';
import type { SkeletonRegistry } from '@/lib/character/skeleton';
import { buildIdleClip, stepMixer, toAdditiveClip } from '@/lib/character/animation';
import {
  buildXp32Clip,
  preloadXp32Animations,
  type Xp32AnimationId,
} from '@/lib/animations/xp32GlbAnimation';
import { resolveArmCollisions } from '@/lib/character/armCollision';
import { BlinkController, applyBlinkWeights } from '@/lib/morphs/blinkController';
import { applyFacialExpressionWeights } from '@/lib/morphs/facialExpressionMorphs';

export interface AnimationDirectorProps {
  registry: SkeletonRegistry;
  /** Optional head/face root traversed for named blink morph targets (`eyeBlinkLeft`, `eyeBlinkRight`, etc.). */
  rigRoot?: THREE.Object3D | null;
  /**
   * Snapshot of the applied pose, built by `HeadModel` immediately after it
   * writes the pose to the bones. Passing the clip (rather than snapshotting
   * live bones on a later frame) removes any race with the mixer's own writes.
   */
  poseClip: THREE.AnimationClip | null;
  /** Id of the pose `poseClip` was built from; a change crossfades. */
  poseId: string;
  /**
   * Runs after the mixer writes this frame. `HeadModel` uses it to make the
   * facial rig and neck seam follow the animated head bone.
   */
  onAfterFrame?: () => void;
}

const POSE_FADE_SECONDS = 0.35;

/**
 * Drives the shared XP32 skeleton with an `AnimationMixer`.
 *
 * Two layers:
 *
 *  - a **base pose** action playing `poseClip`; changing pose crossfades from
 *    the previous one (0.35 s).
 *  - an **additive idle** action: deterministic breathing/sway deltas that
 *    compose onto whatever the base action writes. `makeClipAdditive` reduces
 *    it to a pure delta, so one idle clip layers over every pose.
 *
 * `rest` mutes idle (base pose holds); pausing pins the mixer's `timeScale` to
 * zero so every bone — and any crossfade in flight — freezes.
 *
 * The subscription uses priority `-1` so it runs before `BodyPhysics` (default
 * priority 0), which then settles soft-body bones on top of this frame's pose.
 */
export function AnimationDirector({
  registry,
  rigRoot,
  poseClip,
  poseId,
  onAfterFrame,
}: AnimationDirectorProps) {
  const animationId = useCharacter((s) => s.animationId);
  const animationPlaying = useCharacter((s) => s.animationPlaying);
  const animationSpeed = useCharacter((s) => s.animationSpeed);
  const weight = useCharacter((s) => s.weight);
  const autoBlink = useCharacter((s) => s.autoBlink);
  const blinkPreview = useCharacter((s) => s.blinkPreview);
  const blinkPulseNonce = useCharacter((s) => s.blinkPulseNonce);
  const facialExpressions = useCharacter((s) => s.facialExpressions);
  const blinkController = useMemo(() => new BlinkController(), []);
  const lastPulseRef = useRef(blinkPulseNonce);

  const mixer = useMemo(() => new THREE.AnimationMixer(registry.group), [registry]);

  const poseActionRef = useRef<THREE.AnimationAction | null>(null);
  /** Current + outgoing pose clips, retained so a fade is never uncached. */
  const poseClipsRef = useRef<THREE.AnimationClip[]>([]);
  const idleActionRef = useRef<THREE.AnimationAction | null>(null);
  const idleClipRef = useRef<THREE.AnimationClip | null>(null);
  const locomotionActionRef = useRef<THREE.AnimationAction | null>(null);
  const locomotionClipRef = useRef<THREE.AnimationClip | null>(null);
  const lastPoseIdRef = useRef<string | null>(null);
  const playingRef = useRef(animationPlaying);
  playingRef.current = animationPlaying;
  const animationIdRef = useRef(animationId);
  animationIdRef.current = animationId;

  const [glbReadyVersion, setGlbReadyVersion] = useState(0);
  const [registryVersion, setRegistryVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void preloadXp32Animations().then(() => {
      if (!cancelled) setGlbReadyVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const unsub = registry.subscribe(() => {
      // Defer state bump out of SkinnedPart's render/useMemo registration pass.
      queueMicrotask(() => {
        if (active) setRegistryVersion((v) => v + 1);
      });
    });
    return () => {
      active = false;
      unsub();
    };
  }, [registry]);

  /* Swap in a new base-pose snapshot. A changed pose fades from the old one;
     a rebuild for the same pose (mesh/intensity change) swaps instantly. */
  useEffect(() => {
    if (!poseClip) return;
    const changed = lastPoseIdRef.current !== null && lastPoseIdRef.current !== poseId;
    const next = mixer.clipAction(poseClip);
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.enabled = true;
    next.play();

    const previous = poseActionRef.current;
    if (previous && previous !== next) {
      /* A paused mixer cannot advance a fade, so swap instead of freezing on
         the outgoing pose. */
      if (changed && playingRef.current) {
        next.setEffectiveWeight(1);
        previous.crossFadeTo(next, POSE_FADE_SECONDS, false);
      } else {
        previous.stop();
        next.setEffectiveWeight(1);
      }
    } else {
      next.setEffectiveWeight(1);
    }

    /* Keep the new clip plus the one still fading out; evict anything older.
       Uncaching the outgoing clip outright would cancel its crossfade. */
    const retained = [poseClip, ...poseClipsRef.current.filter((c) => c !== poseClip)].slice(0, 2);
    for (const stale of poseClipsRef.current) {
      if (!retained.includes(stale)) mixer.uncacheClip(stale);
    }
    poseClipsRef.current = retained;
    poseActionRef.current = next;
    lastPoseIdRef.current = poseId;

    /* Rebuild idle from the same bone set. Its delta is pose-independent, but
       rebuilding keeps the track set aligned with the registered bones. */
    const idleClip = toAdditiveClip(buildIdleClip(registry.byName.values()));
    idleActionRef.current?.stop();
    if (idleClipRef.current) mixer.uncacheClip(idleClipRef.current);
    const idle = mixer.clipAction(idleClip);
    idle.setLoop(THREE.LoopRepeat, Infinity);
    idle.enabled = true;
    idle.setEffectiveWeight(1);
    idle.play();
    idleActionRef.current = idle;
    idleClipRef.current = idleClip;

    /* Apply the current idle/locomotion/rest choice before the next frame runs. */
    const curAnim = animationIdRef.current;
    const isClip =
      Boolean(locomotionActionRef.current) &&
      (curAnim === 'idle-clip' || curAnim === 'selfie');
    if (isClip) {
      next.setEffectiveWeight(0);
    }
    idle.setEffectiveWeight(curAnim === 'idle' ? 1 : 0);
    // `animationId` is intentionally read for the new action only; the effect
    // below keeps the live choice in sync without rebuilding pose clips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixer, poseClip, poseId, registry]);

  useEffect(() => {
    locomotionActionRef.current?.stop();
    locomotionActionRef.current = null;
    if (locomotionClipRef.current) {
      mixer.uncacheClip(locomotionClipRef.current);
      locomotionClipRef.current = null;
    }

    if (animationId === 'idle-clip' || animationId === 'selfie') {
      const xp32Id: Xp32AnimationId = animationId === 'idle-clip' ? 'idle' : 'selfie';
      const clip = buildXp32Clip(xp32Id, registry);
      if (clip) {
        poseActionRef.current?.setEffectiveWeight(0);
        idleActionRef.current?.setEffectiveWeight(0);
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.enabled = true;
        action.setEffectiveWeight(1);
        action.play();
        locomotionActionRef.current = action;
        locomotionClipRef.current = clip;
        return;
      }
    }

    poseActionRef.current?.setEffectiveWeight(1);
    idleActionRef.current?.setEffectiveWeight(animationId === 'idle' ? 1 : 0);
  }, [mixer, registry, animationId, glbReadyVersion, registryVersion]);

  useEffect(() => {
    if (blinkPulseNonce === lastPulseRef.current) return;
    lastPulseRef.current = blinkPulseNonce;
    blinkController.triggerBlink();
  }, [blinkPulseNonce, blinkController]);

  useEffect(() => {
    const w = blinkPreview ?? 0;
    if (blinkPreview !== null || !autoBlink) {
      applyBlinkWeights(rigRoot, w, w);
      applyBlinkWeights(registry.group, w, w);
    }
  }, [autoBlink, blinkPreview, rigRoot, registry]);

  const lastBlinkRef = useRef<{ left: number; right: number }>({ left: -1, right: -1 });
  const hasActiveExpr = Object.values(facialExpressions).some((v) => Math.abs(v) > 1e-4);

  useEffect(() => {
    applyFacialExpressionWeights(rigRoot, facialExpressions);
    applyFacialExpressionWeights(registry.group, facialExpressions);
  }, [facialExpressions, rigRoot, registry]);

  useFrame((_, delta) => {
    if (!poseActionRef.current) return;
    stepMixer(mixer, delta, animationPlaying, animationSpeed);
    resolveArmCollisions(registry, weight);
    const { left, right } =
      blinkPreview !== null
        ? { left: blinkPreview, right: blinkPreview }
        : blinkController.step(
            delta * (animationPlaying ? animationSpeed : 1),
            autoBlink && animationPlaying,
          );
    if (
      Math.abs(left - lastBlinkRef.current.left) > 1e-4 ||
      Math.abs(right - lastBlinkRef.current.right) > 1e-4
    ) {
      lastBlinkRef.current.left = left;
      lastBlinkRef.current.right = right;
      applyBlinkWeights(rigRoot, left, right);
      applyBlinkWeights(registry.group, left, right);
    }
    if (hasActiveExpr) {
      applyFacialExpressionWeights(rigRoot, facialExpressions);
      applyFacialExpressionWeights(registry.group, facialExpressions);
    }
    /* The head-follow and BodyPhysics read world matrices this frame; they
       must reflect the mixer's output before either runs. */
    registry.updateWorld();
    onAfterFrame?.();
  }, -1);

  useEffect(() => () => {
    mixer.stopAllAction();
    mixer.uncacheRoot(registry.group);
  }, [mixer, registry]);

  return null;
}
