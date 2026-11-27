/**
 * Camera math, framing constants, and canonical angles for the 3D character viewer.
 *
 * Kept pure (zero Three.js or DOM imports) so CLI test harnesses like
 * `scripts/check_hair.cjs` can evaluate the store in bare Node `vm` contexts.
 */

export type CameraFraming = 'auto' | 'macro' | 'face' | 'hair' | 'bust' | 'mid' | 'body';
export type CameraLockMode = 'locked' | 'free';

export interface CameraZoneSpec {
  id: string;
  anchor: 'eyes' | 'head' | 'lips' | 'jaw' | 'bodyMid' | 'hands' | 'feet';
  standoff: number;
  yawDeg: number;
  pitchDeg: number;
  minDistance: number;
  maxDistance: number;
  minPolarDeg: number;
  maxPolarDeg: number;
  /** Optional azimuth clamp in degrees (`null` = full 360° orbit). */
  minAzimuthDeg: number | null;
  maxAzimuthDeg: number | null;
  scaleByHeight?: boolean;
}

export interface FramingSpec {
  standoff: number;
  targetY: number;
  fov: number;
  label: string;
}

export interface CameraPoseRequest {
  /** Azimuth angle in radians around the Y axis (0 = facing character front). */
  yaw?: number;
  /** Polar angle elevation offset in radians (0 = eye level, >0 = low angle looking up, <0 = high angle looking down). */
  pitch?: number;
  /** Distance from target in meters. */
  distance?: number;
  /** Look-at target Y coordinate in meters. */
  targetY?: number;
  /** Restore the tab's framing distance/target as well as the requested angles. */
  reset?: boolean;
  /** Incrementing identifier to trigger an animated transition. */
  nonce: number;
}

export const CAMERA_ROTATE_SPEED_DEFAULT = 0.42;
export const CAMERA_ROTATE_SPEED_MIN = 0.15;
export const CAMERA_ROTATE_SPEED_MAX = 1.2;

/** Inverse of CameraRig's spherical pose; positive pitch means a low camera. */
export function cameraSpherical(
  position: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number }
) {
  const x = position.x - target.x,
    y = position.y - target.y,
    z = position.z - target.z;
  const distance = Math.hypot(x, y, z);
  return {
    yawDeg: (Math.atan2(x, z) * 180) / Math.PI,
    pitchDeg: distance ? (-Math.asin(Math.max(-1, Math.min(1, y / distance))) * 180) / Math.PI : 0,
    distance,
  };
}

/** 85mm portrait telephoto equivalent default (22°) eliminates wide-angle facial distortion. */
export const CAMERA_FOV_DEFAULT = 22;
export const CAMERA_FOV_MIN = 15;
export const CAMERA_FOV_MAX = 60;

/**
 * Computes the vertical look-at offset to place the eye line at the Golden Ratio (62% of viewport height).
 */
export function goldenRatioOffset(distance: number, fovDeg: number): number {
  return 0.236 * distance * Math.tan(((fovDeg / 2) * Math.PI) / 180);
}

/**
 * AAA Framing presets across facial, hair, and body customization regions.
 */
export const FRAMING_SPECS: Record<'macro' | 'face' | 'hair' | 'bust' | 'mid' | 'body', FramingSpec> = {
  macro: { standoff: 0.52, targetY: 0.020, fov: 20, label: 'MACRO' },
  face: { standoff: 0.72, targetY: -0.008, fov: 22, label: 'FACE' },
  hair: { standoff: 1.05, targetY: 0.000, fov: 25, label: 'HAIR' },
  bust: { standoff: 1.25, targetY: -0.120, fov: 24, label: 'BUST' },
  mid: { standoff: 2.10, targetY: -0.450, fov: 26, label: 'MID' },
  body: { standoff: 3.50, targetY: -0.750, fov: 28, label: 'BODY' },
};

/** Convert Three.js vertical FOV (degrees) into Skyrim Creation Engine horizontal FOV (degrees) at 16:9. */
export function verticalFovToSkyrimHov(vFovDeg: number, aspect = 16 / 9): number {
  const vFovRad = (vFovDeg * Math.PI) / 180;
  const hFovRad = 2 * Math.atan(aspect * Math.tan(vFovRad / 2));
  return Math.round((hFovRad * 180) / Math.PI);
}

/** Convert Skyrim horizontal FOV (degrees) into Three.js vertical FOV (degrees) at 16:9. */
export function skyrimHovToVerticalFov(hFovDeg: number, aspect = 16 / 9): number {
  const hFovRad = (hFovDeg * Math.PI) / 180;
  const vFovRad = 2 * Math.atan(Math.tan(hFovRad / 2) / aspect);
  return Math.round((vFovRad * 180) / Math.PI);
}

export interface AnglePreset {
  id: string;
  label: string;
  yaw: number;
}

export const YAW_PRESETS: AnglePreset[] = [
  { id: 'front', label: 'FRONT 0°', yaw: 0 },
  { id: 'threeQuarterL', label: '3/4 L -45°', yaw: -Math.PI / 4 },
  { id: 'threeQuarterR', label: '3/4 R +45°', yaw: Math.PI / 4 },
  { id: 'profileL', label: 'PROF L -90°', yaw: -Math.PI / 2 },
  { id: 'profileR', label: 'PROF R +90°', yaw: Math.PI / 2 },
  { id: 'back', label: 'BACK 180°', yaw: Math.PI },
];

export interface PitchPreset {
  id: string;
  label: string;
  pitch: number;
}

export const PITCH_PRESETS: PitchPreset[] = [
  { id: 'low', label: 'LOW -12°', pitch: (12 * Math.PI) / 180 },
  { id: 'eye', label: 'EYE 0°', pitch: 0 },
  { id: 'high', label: 'HIGH +12°', pitch: (-12 * Math.PI) / 180 },
];

export interface TabCameraQuery {
  primaryTab: string;
  featuresSection?: string | null;
  makeupSection?: string | null;
  physiqueSection?: string | null;
  equipSlot?: string | null;
  packMode?: boolean;
}

/**
 * Resolves the curated AAA game camera rig (anchor, distance, default angle, and OrbitControls clamps)
 * for the active primary tab and sub-section. Pure math so Node checks can import safely.
 */
export function resolveTabCameraSpec(q: TabCameraQuery): CameraZoneSpec {
  const { primaryTab, featuresSection, makeupSection, physiqueSection, equipSlot, packMode } = q;

  if (primaryTab === 'PRESET') {
    return {
      id: 'preset-hero',
      anchor: 'bodyMid',
      standoff: 3.2,
      yawDeg: 14,
      pitchDeg: 3,
      minDistance: 2.1,
      maxDistance: 4.3,
      minPolarDeg: 70,
      maxPolarDeg: 102,
      minAzimuthDeg: null,
      maxAzimuthDeg: null,
      scaleByHeight: true,
    };
  }

  if (primaryTab === 'EQUIPMENT') {
    if (equipSlot === 'accessories' || equipSlot === 'hat' || equipSlot === 'earring') {
      return {
        id: 'outfit-head',
        anchor: 'head',
        standoff: 0.86,
        yawDeg: 12,
        pitchDeg: 0,
        minDistance: 0.55,
        maxDistance: 1.4,
        minPolarDeg: 65,
        maxPolarDeg: 115,
        minAzimuthDeg: null,
        maxAzimuthDeg: null,
      };
    }
    if (equipSlot === 'feet' || equipSlot === 'stockings') {
      return {
        id: 'outfit-feet',
        anchor: 'feet',
        standoff: 1.3,
        yawDeg: 22,
        pitchDeg: -14,
        minDistance: 0.75,
        maxDistance: 2.0,
        minPolarDeg: 62,
        maxPolarDeg: 100,
        minAzimuthDeg: null,
        maxAzimuthDeg: null,
      };
    }
    return {
      id: 'outfit-full',
      anchor: packMode ? 'bodyMid' : 'head',
      standoff: packMode ? 3.15 : 1.05,
      yawDeg: 12,
      pitchDeg: 0,
      minDistance: packMode ? 1.5 : 0.65,
      maxDistance: packMode ? 4.2 : 1.8,
      minPolarDeg: 68,
      maxPolarDeg: 105,
      minAzimuthDeg: null,
      maxAzimuthDeg: null,
      scaleByHeight: Boolean(packMode),
    };
  }

  if (primaryTab === 'BODY') {
    if (physiqueSection === 'hands_arms' || physiqueSection === 'hands') {
      return {
        id: 'body-hands',
        anchor: 'hands',
        standoff: 1.2,
        yawDeg: -22,
        pitchDeg: -6,
        minDistance: 0.65,
        maxDistance: 1.85,
        minPolarDeg: 65,
        maxPolarDeg: 110,
        minAzimuthDeg: null,
        maxAzimuthDeg: null,
      };
    }
    if (physiqueSection === 'boobs_breasts' || physiqueSection === 'nipples' || physiqueSection === 'upper_torso') {
      return {
        id: 'body-bust',
        anchor: 'bodyMid',
        standoff: 1.32,
        yawDeg: 14,
        pitchDeg: 0,
        minDistance: 0.78,
        maxDistance: 2.1,
        minPolarDeg: 68,
        maxPolarDeg: 108,
        minAzimuthDeg: null,
        maxAzimuthDeg: null,
      };
    }
    if (physiqueSection === 'feet') {
      return {
        id: 'body-feet',
        anchor: 'feet',
        standoff: 1.05,
        yawDeg: 25,
        pitchDeg: -16,
        minDistance: 0.55,
        maxDistance: 1.75,
        minPolarDeg: 60,
        maxPolarDeg: 100,
        minAzimuthDeg: null,
        maxAzimuthDeg: null,
      };
    }
    return {
      id: 'body-full',
      anchor: packMode ? 'bodyMid' : 'head',
      standoff: packMode ? 2.85 : 1.15,
      yawDeg: 16,
      pitchDeg: 0,
      minDistance: packMode ? 1.4 : 0.75,
      maxDistance: packMode ? 3.9 : 2.0,
      minPolarDeg: 68,
      maxPolarDeg: 105,
      minAzimuthDeg: null,
      maxAzimuthDeg: null,
      scaleByHeight: Boolean(packMode),
    };
  }

  if (primaryTab === 'HAIR') {
    return {
      id: 'hair-orbit',
      anchor: 'head',
      standoff: 1.05,
      yawDeg: 0,
      pitchDeg: 0,
      minDistance: 0.7,
      maxDistance: 1.65,
      minPolarDeg: 55,
      maxPolarDeg: 118,
      minAzimuthDeg: null,
      maxAzimuthDeg: null,
    };
  }

  if (primaryTab === 'FACE') {
    if (makeupSection === 'eyes' || makeupSection === 'eyeshadow' || makeupSection === 'eyelashes' || makeupSection === 'eyebrows') {
      return {
        id: 'makeup-eyes',
        anchor: 'eyes',
        standoff: 0.5,
        yawDeg: 0,
        pitchDeg: 0,
        minDistance: 0.36,
        maxDistance: 0.8,
        minPolarDeg: 72,
        maxPolarDeg: 108,
        minAzimuthDeg: -55,
        maxAzimuthDeg: 55,
      };
    }
    if (makeupSection === 'lips') {
      return {
        id: 'makeup-lips',
        anchor: 'lips',
        standoff: 0.48,
        yawDeg: 12,
        pitchDeg: -2,
        minDistance: 0.36,
        maxDistance: 0.78,
        minPolarDeg: 70,
        maxPolarDeg: 108,
        minAzimuthDeg: -60,
        maxAzimuthDeg: 60,
      };
    }
    return {
      id: 'makeup-face',
      anchor: 'eyes',
      standoff: 0.68,
      yawDeg: 12,
      pitchDeg: 0,
      minDistance: 0.42,
      maxDistance: 0.98,
      minPolarDeg: 68,
      maxPolarDeg: 112,
      minAzimuthDeg: -70,
      maxAzimuthDeg: 70,
    };
  }

  if (primaryTab === 'FACE SHAPE') {
    if (featuresSection === 'forehead' || featuresSection === 'eyebrows') {
      return {
        id: 'sculpt-brows',
        anchor: 'eyes',
        standoff: 0.56,
        yawDeg: 0,
        pitchDeg: 0,
        minDistance: 0.38,
        maxDistance: 0.88,
        minPolarDeg: 68,
        maxPolarDeg: 112,
        minAzimuthDeg: -65,
        maxAzimuthDeg: 65,
      };
    }
    if (featuresSection === 'eyes') {
      return {
        id: 'sculpt-eyes',
        anchor: 'eyes',
        standoff: 0.46,
        yawDeg: 8,
        pitchDeg: 0,
        minDistance: 0.35,
        maxDistance: 0.78,
        minPolarDeg: 72,
        maxPolarDeg: 108,
        minAzimuthDeg: -60,
        maxAzimuthDeg: 60,
      };
    }
    if (featuresSection === 'nose') {
      return {
        id: 'sculpt-nose',
        anchor: 'head',
        standoff: 0.52,
        yawDeg: 28,
        pitchDeg: 0,
        minDistance: 0.38,
        maxDistance: 0.85,
        minPolarDeg: 68,
        maxPolarDeg: 112,
        minAzimuthDeg: -80,
        maxAzimuthDeg: 80,
      };
    }
    if (featuresSection === 'cheeks' || featuresSection === 'jaw') {
      return {
        id: 'sculpt-jaw',
        anchor: 'jaw',
        standoff: 0.6,
        yawDeg: 34,
        pitchDeg: -2,
        minDistance: 0.42,
        maxDistance: 0.92,
        minPolarDeg: 65,
        maxPolarDeg: 112,
        minAzimuthDeg: -85,
        maxAzimuthDeg: 85,
      };
    }
    if (featuresSection === 'lips') {
      return {
        id: 'sculpt-lips',
        anchor: 'lips',
        standoff: 0.46,
        yawDeg: 14,
        pitchDeg: -2,
        minDistance: 0.35,
        maxDistance: 0.78,
        minPolarDeg: 70,
        maxPolarDeg: 110,
        minAzimuthDeg: -70,
        maxAzimuthDeg: 70,
      };
    }
    if (featuresSection === 'ears') {
      return {
        id: 'sculpt-ears',
        anchor: 'head',
        standoff: 0.52,
        yawDeg: 78,
        pitchDeg: 0,
        minDistance: 0.38,
        maxDistance: 0.88,
        minPolarDeg: 68,
        maxPolarDeg: 112,
        minAzimuthDeg: -110,
        maxAzimuthDeg: 110,
      };
    }
    return {
      id: 'sculpt-root',
      anchor: 'eyes',
      standoff: 0.72,
      yawDeg: 0,
      pitchDeg: 0,
      minDistance: 0.44,
      maxDistance: 1.05,
      minPolarDeg: 68,
      maxPolarDeg: 112,
      minAzimuthDeg: -75,
      maxAzimuthDeg: 75,
    };
  }

  return {
    id: 'default-face',
    anchor: 'eyes',
    standoff: 0.72,
    yawDeg: 0,
    pitchDeg: 0,
    minDistance: 0.42,
    maxDistance: 1.05,
    minPolarDeg: 68,
    maxPolarDeg: 112,
    minAzimuthDeg: -75,
    maxAzimuthDeg: 75,
  };
}
