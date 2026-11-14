import * as THREE from 'three';

/**
 * Animation clip builders shared by the preview director and the GLB export.
 *
 * Everything here is pure: it reads bones, never writes them, and produces no
 * timers or React state. Tracks target `bone.uuid` rather than the pack's
 * bracketed names (`NPC Spine2 [Spn2]`); `PropertyBinding.parseTrackName`
 * treats `[`/`]` as array-index syntax, so a name-based track is ambiguous at
 * best and unresolvable at worst. A uuid is an exact node key.
 */

/** Bones whose translation is anatomical root motion, not a joint pivot.
 *  Mirrors the whitelist in `applyPoseTrack`. */
const ROOT_TRANSLATION = new Set([
  'NPC COM [COM ]',
  'x_NPC Translate [Pos ]',
  'NPC Root [Root]',
]);

export const POSE_HOLD_SECONDS = 2 / 3;
export const IDLE_SECONDS = 8;
export const IDLE_FPS = 30;

interface IdleMotion {
  /** Pack bone name; the track is emitted only when the skeleton carries it. */
  name: string;
  /** Local-space axis of the offset. */
  axis: [number, number, number];
  /** Peak offset in degrees. */
  degrees: number;
  /** Seconds per full cycle; must divide `seconds` so frame 0 and frame N match. */
  period: number;
}

/**
 * Procedural breathing/sway offsets.
 *
 * Deliberately tiny: this is layered over whatever pose the user picked as an
 * additive delta, so it must read as life, not as a second pose. Every sine
 * starts at zero, which is what lets `makeClipAdditive` turn frame 0 into the
 * additive identity.
 */
const IDLE_MOTION: readonly IdleMotion[] = [
  { name: 'NPC Spine1 [Spn1]', axis: [1, 0, 0], degrees: 0.25, period: 4 },
  { name: 'NPC Spine2 [Spn2]', axis: [1, 0, 0], degrees: 0.6, period: 4 },
  { name: 'NPC Neck [Neck]', axis: [1, 0, 0], degrees: 0.5, period: 4 },
  { name: 'NPC Head [Head]', axis: [0, 0, 1], degrees: 0.35, period: 8 },
  { name: 'NPC L UpperArm [LUar]', axis: [0, 0, 1], degrees: 0.4, period: 8 },
  { name: 'NPC R UpperArm [RUar]', axis: [0, 0, 1], degrees: -0.4, period: 8 },
];

const ZERO_TIME = 0;
const ONE_QUATERNION = 4;
const ONE_VECTOR = 3;

/**
 * Snapshot the bones' current local TRS as a static clip.
 *
 * The clip has two identical keys so a `LoopRepeat` action holds the pose
 * instead of clamping; the second key also gives `crossFadeTo` a full-duration
 * tail to fade out of.
 */
export function buildPoseClip(
  bones: Iterable<THREE.Bone>,
  name = 'Pose',
  hold = POSE_HOLD_SECONDS,
  /** Authored rotations to use instead of the live (possibly animating) ones,
   *  keyed by bone uuid. The export passes the stance captured at pose time so
   *  a mid-breath frame never becomes the exported rest. */
  baseByUuid?: ReadonlyMap<string, THREE.Quaternion>,
  /** Authored root translations, same rule as `baseByUuid`: at export time the
   *  live COM/Pos bones may have drifted with BodyPhysics, while the pose
   *  snapshot holds the value the user actually chose. */
  positionByUuid?: ReadonlyMap<string, THREE.Vector3>,
): THREE.AnimationClip {
  const times = [ZERO_TIME, hold];
  const tracks: THREE.KeyframeTrack[] = [];

  for (const bone of bones) {
    const q = baseByUuid?.get(bone.uuid) ?? bone.quaternion;
    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${bone.uuid}.quaternion`,
        times,
        [q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w],
      ),
    );
    if (ROOT_TRANSLATION.has(bone.name)) {
      const p = positionByUuid?.get(bone.uuid) ?? bone.position;
      tracks.push(
        new THREE.VectorKeyframeTrack(
          `${bone.uuid}.position`,
          times,
          [p.x, p.y, p.z, p.x, p.y, p.z],
        ),
      );
    }
  }

  return new THREE.AnimationClip(name, hold, tracks);
}

/** The minimum a bone must expose to author an idle track. */
interface IdleBone {
  name: string;
  uuid: string;
  /** Base local rotation the sway is layered onto. */
  quaternion: THREE.Quaternion;
}

/**
 * Deterministic breathing clip layered onto each bone's `base` rotation.
 *
 * Absolute values (`base * delta`) so the clip also exports cleanly as a normal
 * glTF animation. In the preview it is converted with `toAdditiveClip`, which
 * cancels the base and leaves the pure delta — so the same clip layers over
 * every pose without being rebuilt when the pose changes.
 */
function idleClipFrom(bones: Iterable<IdleBone>, seconds: number, fps: number): THREE.AnimationClip {
  const byName = new Map<string, IdleBone>();
  for (const bone of bones) byName.set(bone.name, bone);

  const count = Math.max(2, Math.round(seconds * fps) + 1);
  const times = new Float32Array(count);
  for (let i = 0; i < count; i++) times[i] = (i / (count - 1)) * seconds;

  const tracks: THREE.KeyframeTrack[] = [];
  const axis = new THREE.Vector3();
  const delta = new THREE.Quaternion();
  const value = new THREE.Quaternion();

  for (const motion of IDLE_MOTION) {
    const bone = byName.get(motion.name);
    if (!bone) continue;

    const values = new Float32Array(count * ONE_QUATERNION);
    axis.set(motion.axis[0], motion.axis[1], motion.axis[2]).normalize();

    for (let i = 0; i < count; i++) {
      const phase = (2 * Math.PI * times[i]) / motion.period;
      const angle = THREE.MathUtils.degToRad(motion.degrees) * Math.sin(phase);
      delta.setFromAxisAngle(axis, angle);
      value.copy(bone.quaternion).multiply(delta);
      const o = i * ONE_QUATERNION;
      values[o] = value.x;
      values[o + 1] = value.y;
      values[o + 2] = value.z;
      values[o + 3] = value.w;
    }

    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, times, values));
  }

  return new THREE.AnimationClip('Idle', seconds, tracks);
}

export function buildIdleClip(
  bones: Iterable<THREE.Bone>,
  seconds = IDLE_SECONDS,
  fps = IDLE_FPS,
): THREE.AnimationClip {
  return idleClipFrom(bones, seconds, fps);
}

/**
 * A constant holding track carrying a source track's first keyframe.
 *
 * Used to merge the pose into the idle. Two keys, not one: glTF samplers and
 * `AnimationAction` both expect a span, and a single key clamps to the last
 * value of whatever played before.
 */
function holdTrack(track: THREE.KeyframeTrack, seconds: number): THREE.KeyframeTrack | null {
  if (track.times.length === 0) return null;
  const size = track.getValueSize();
  const first = Array.from(track.values.slice(0, size));
  const times = [ZERO_TIME, seconds];

  if (track.name.endsWith('.quaternion')) {
    return new THREE.QuaternionKeyframeTrack(track.name, times, first.concat(first));
  }
  if (track.name.endsWith('.position')) {
    return new THREE.VectorKeyframeTrack(track.name, times, first.concat(first));
  }
  /* Pose clips carry only rotation (every bone) and translation (root bones),
     so anything else is unexpected and is dropped rather than guessed at. */
  return null;
}

/**
 * Export `Idle` clip: the authored pose plus the procedural sway.
 *
 * The idle must stand alone. If it only keyed the six sway bones, playing it
 * after `Pose` — or after any other action — would leave every other bone on
 * the last value that clip wrote, which is exactly what "inherit unkeyed stale
 * values" looks like in a viewer. So every pose track the sway does not
 * replace (all other rotations, root translations) is merged in as a constant
 * holding track. Target/property coverage of `Idle` therefore matches `Pose`.
 *
 * The base is the pose clip's first keyframe rather than the bones' current
 * rotation: export runs while the preview mixer is breathing, so live bones
 * would bake a mid-breath offset into the exported base.
 */
export function buildIdleClipOverPose(
  poseClip: THREE.AnimationClip,
  bones: Iterable<THREE.Bone>,
  seconds = IDLE_SECONDS,
  fps = IDLE_FPS,
): THREE.AnimationClip {
  const suffix = '.quaternion';
  const baseByUuid = new Map<string, THREE.Quaternion>();
  for (const track of poseClip.tracks) {
    if (!track.name.endsWith(suffix) || track.times.length === 0) continue;
    const v = track.values;
    baseByUuid.set(
      track.name.slice(0, -suffix.length),
      new THREE.Quaternion(v[0], v[1], v[2], v[3]),
    );
  }

  const bases: IdleBone[] = [];
  for (const bone of bones) {
    bases.push({ name: bone.name, uuid: bone.uuid, quaternion: baseByUuid.get(bone.uuid) ?? bone.quaternion });
  }

  const idle = idleClipFrom(bases, seconds, fps);
  const animated = new Set(idle.tracks.map((track) => track.name));

  /* Merge the rest of the pose so the clip is a complete stance, not a delta
     over whatever happened to play before it. */
  for (const track of poseClip.tracks) {
    if (animated.has(track.name)) continue;
    const held = holdTrack(track, seconds);
    if (held) idle.tracks.push(held);
  }
  idle.resetDuration();
  return idle;
}

/**
 * Convert an absolute clip into a delta over its first frame.
 *
 * Frame 0 of every idle track is the base rotation (sin(0) = 0), so the result
 * is exactly the motion offset and composes onto whatever a normal action has
 * already written for the bone.
 */
export function toAdditiveClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  return THREE.AnimationUtils.makeClipAdditive(clip, 0, clip);
}

/**
 * The authored pose clip for the current selection, kept where the exporter
 * can read it without reaching into React.
 *
 * The preview mixer is always breathing, so bones read at export time carry a
 * mid-breath offset. This slot holds the exact stance snapshot `HeadModel`
 * built when it applied the pose, so the exported pose and the base of the
 * exported idle are the authored values, not whichever frame the export
 * happened to catch.
 */
let authoredPose: { id: string; clip: THREE.AnimationClip } | null = null;

export function setAuthoredPose(id: string, clip: THREE.AnimationClip): void {
  authoredPose = { id, clip };
}

export function getAuthoredPose(): { id: string; clip: THREE.AnimationClip } | null {
  return authoredPose;
}

/**
 * Clips to ship for an animated export, filtered to `keep` (bone uuids/names
 * that survived pruning).
 *
 * Pose and idle derive from the authored snapshot, not the live (breathing)
 * bones, and only the active pose is built — never all 72 tracks.
 */
export function buildExportClips(
  essentialBones: Iterable<THREE.Bone>,
  keep: ReadonlySet<string>,
): THREE.AnimationClip[] {
  const bones = [...essentialBones];
  const authored = getAuthoredPose();
  const poseClip = authored
    ? buildPoseClip(
        bones,
        'Pose',
        undefined,
        quaternionBaselines(authored.clip),
        positionBaselines(authored.clip),
      )
    : buildPoseClip(bones, 'Pose');
  const idleClip = buildIdleClipOverPose(poseClip, bones);
  return [filterClipToBones(poseClip, keep), filterClipToBones(idleClip, keep)].filter(
    (clip) => clip.tracks.length > 0,
  );
}

/** First-keyframe rotations of a pose clip, keyed by bone uuid. */
export function quaternionBaselines(
  clip: THREE.AnimationClip,
): Map<string, THREE.Quaternion> {
  const out = new Map<string, THREE.Quaternion>();
  const suffix = '.quaternion';
  for (const track of clip.tracks) {
    if (!track.name.endsWith(suffix) || track.times.length === 0) continue;
    const v = track.values;
    out.set(track.name.slice(0, -suffix.length), new THREE.Quaternion(v[0], v[1], v[2], v[3]));
  }
  return out;
}

/** First-keyframe translations of a pose clip, keyed by bone uuid. */
export function positionBaselines(
  clip: THREE.AnimationClip,
): Map<string, THREE.Vector3> {
  const out = new Map<string, THREE.Vector3>();
  const suffix = '.position';
  for (const track of clip.tracks) {
    if (!track.name.endsWith(suffix) || track.times.length === 0) continue;
    const v = track.values;
    out.set(track.name.slice(0, -suffix.length), new THREE.Vector3(v[0], v[1], v[2]));
  }
  return out;
}

/**
 * Bind inverses for a pruned skeleton, taken from the **rest** pose.
 *
 * `new THREE.Skeleton(bones)` would call `calculateInverses()` from the bones'
 * current (posed, possibly mid-animation) world matrices, baking the pose into
 * the exported rest. The registry stores each bone's rest world matrix, so the
 * inverse comes from there; a bone without one falls back to the mesh's own
 * bind inverse rather than the live pose.
 */
export function restInverses(
  bones: THREE.Bone[],
  fallback?: THREE.Skeleton,
): THREE.Matrix4[] {
  return bones.map((bone) => {
    const rest = bone.userData.__boneRest?.world as THREE.Matrix4 | undefined;
    if (rest) return rest.clone().invert();
    const origIndex = fallback ? fallback.bones.indexOf(bone) : -1;
    return origIndex >= 0 ? fallback!.boneInverses[origIndex].clone() : new THREE.Matrix4();
  });
}

/** Keep only tracks whose target uuid is in `keep` (bone uuid or node name). */
export function filterClipToBones(
  clip: THREE.AnimationClip,
  keep: ReadonlySet<string>,
): THREE.AnimationClip {
  const suffixAt = (name: string) => name.lastIndexOf('.');
  const tracks = clip.tracks.filter((track) => {
    const dot = suffixAt(track.name);
    return dot > 0 && keep.has(track.name.slice(0, dot));
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}

/**
 * Advance a mixer for one frame at the requested playback rate.
 *
 * Paused playback sets `timeScale` to zero rather than stopping actions, so
 * every bone keeps the value the mixer last applied and crossfades freeze
 * where they are. This is the single place speed/pause become mixer time, so
 * headless checks exercise the same wiring the director runs.
 */
export function stepMixer(
  mixer: THREE.AnimationMixer,
  delta: number,
  playing: boolean,
  speed: number,
): void {
  mixer.timeScale = playing ? speed : 0;
  mixer.update(delta);
}
