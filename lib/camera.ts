/**
 * Camera math, framing constants, and canonical angles for the 3D character viewer.
 *
 * Kept pure (zero Three.js or DOM imports) so CLI test harnesses like
 * `scripts/check_hair.cjs` can evaluate the store in bare Node `vm` contexts.
 */

export type CameraFraming = 'auto' | 'face' | 'bust' | 'body';

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
export function cameraSpherical(position: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) {
  const x = position.x - target.x, y = position.y - target.y, z = position.z - target.z;
  const distance = Math.hypot(x, y, z);
  return {
    yawDeg: Math.atan2(x, z) * 180 / Math.PI,
    pitchDeg: distance ? -Math.asin(Math.max(-1, Math.min(1, y / distance))) * 180 / Math.PI : 0,
    distance,
  };
}

export const CAMERA_FOV_DEFAULT = 27;
export const CAMERA_FOV_MIN = 15;
export const CAMERA_FOV_MAX = 60;

export const FRAMING_SPECS: Record<'face' | 'bust' | 'body', { standoff: number; targetY: number; label: string }> = {
  face: { standoff: 0.75, targetY: -0.036, label: 'FACE' },
  bust: { standoff: 1.25, targetY: -0.150, label: 'BUST' },
  body: { standoff: 3.80, targetY: -0.650, label: 'BODY' },
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
