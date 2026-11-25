/**
 * lib/morphs/blinkController.ts
 *
 * Frame-rate-independent natural eye blink state machine and renderer-agnostic
 * morph target updater supporting ARKit / UE MetaHuman / UBE target names.
 */

import * as THREE from 'three';
import { BLINK_LEFT_ALIASES, BLINK_RIGHT_ALIASES } from '@/lib/morphs/eyeBlinkMorphs';
import { setNamedMorphWeight } from '@/lib/morphs/gpuMorphUtils';

const BASE_CLOSE_SEC = 0.065;
const BASE_HOLD_SEC = 0.025;
const BASE_OPEN_SEC = 0.145;

export class BlinkController {
  private nextBlinkIn = 1.8;
  private elapsed = -1;
  private doubleBlinkPending = false;
  private tempoScale = 1.0;

  reset(): void {
    this.nextBlinkIn = 1.8;
    this.elapsed = -1;
    this.doubleBlinkPending = false;
    this.tempoScale = 1.0;
  }

  /** Triggers an immediate single natural blink cycle (even if auto-blink is paused). */
  triggerBlink(): void {
    this.elapsed = 0;
    this.doubleBlinkPending = false;
    this.tempoScale = 1.0;
  }

  /** Advance blink state machine and return `[0..1]` left/right closure weights. */
  step(delta: number, enabled: boolean): { left: number; right: number } {
    if (!enabled && this.elapsed < 0) {
      this.doubleBlinkPending = false;
      return { left: 0, right: 0 };
    }

    const dt = Math.min(0.08, Math.max(0, delta));

    if (this.elapsed < 0) {
      this.nextBlinkIn -= dt;
      if (this.nextBlinkIn <= 0) {
        this.elapsed = 0;
        this.doubleBlinkPending = Math.random() < 0.14;
        this.tempoScale = 0.9 + Math.random() * 0.2;
      }
      return { left: 0, right: 0 };
    }

    const closeSec = BASE_CLOSE_SEC * this.tempoScale;
    const holdSec = BASE_HOLD_SEC * this.tempoScale;
    const openSec = BASE_OPEN_SEC * this.tempoScale;
    const totalSec = closeSec + holdSec + openSec;

    this.elapsed += dt;
    if (this.elapsed >= totalSec) {
      if (enabled && this.doubleBlinkPending) {
        this.doubleBlinkPending = false;
        this.elapsed = 0;
        this.tempoScale = 0.88 + Math.random() * 0.16;
      } else {
        this.elapsed = -1;
        this.doubleBlinkPending = false;
        this.nextBlinkIn = 2.2 + Math.random() * 3.6;
      }
      return { left: 0, right: 0 };
    }

    // Asymmetric eyelid kinematics: brisk accelerating close, soft hold, smooth decelerating lift.
    let w = 0;
    if (this.elapsed < closeSec) {
      const t = this.elapsed / closeSec;
      w = t * t * (2.4 - 1.4 * t);
    } else if (this.elapsed < closeSec + holdSec) {
      w = 1;
    } else {
      const t = (this.elapsed - closeSec - holdSec) / openSec;
      w = Math.pow(Math.max(0, 1 - t), 2.15);
    }

    return { left: w, right: w };
  }
}

/**
 * Updates `eyeBlinkLeft` / `eyeBlinkRight` (and MetaHuman/ARKit aliases)
 * on every morph-capable mesh in `root`.
 */
export function applyBlinkWeights(root: THREE.Object3D | null | undefined, left: number, right: number): void {
  if (!root) return;
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (!obj.morphTargetDictionary || !obj.morphTargetInfluences) return;
    setNamedMorphWeight(obj, BLINK_LEFT_ALIASES, left);
    setNamedMorphWeight(obj, BLINK_RIGHT_ALIASES, right);
  });
}
