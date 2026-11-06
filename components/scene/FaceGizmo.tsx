'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useCharacter } from '@/lib/store';
import { useGizmoTip } from '@/lib/gizmoTip';
import { regionPivot, type Rig } from '@/lib/head/rig';
import { REGIONS_BY_ID, SLIDER_DEFS } from '@/lib/regions';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

interface FaceGizmoProps {
  rig: Rig;
}

/**
 * BDO-style axis gizmo bound to the active facial bone.
 *
 * The visible transform is split in two:
 *   - a proxy Object3D the user drags (TransformControls),
 *   - the real bones, which are re-posed from the proxy on every change.
 *
 * Slider values are folded in by `poseBone()` in HeadModel, so the gizmo only
 * contributes the residual the user drags. Readback subtracts the slider
 * contribution before writing to the store, which keeps both in sync.
 */
export function FaceGizmo({ rig }: FaceGizmoProps) {
  const activeRegion = useCharacter((s) => s.activeRegion);
  const mode = useCharacter((s) => s.transformMode);
  const setPose = useCharacter((s) => s.setPose);
  const pose = useCharacter((s) => s.poses[s.activeRegion]);
  /* The gizmo edits the sculpt, so it only exists under FACE SHAPE. Leaving it
     live on the asset tabs meant the arms and the red anchor stayed grabbable
     over a face the user was only picking textures for. */
  const showGizmo = useCharacter((s) => s.primaryTab === 'FACE SHAPE');
  const setTipScreen = useGizmoTip((s) => s.setTip);

  const proxy = useMemo(() => new THREE.Object3D(), []);
  const dragging = useRef(false);

  const def = REGIONS_BY_ID[activeRegion];
  const boneKey = rig.regionBoneKeys[activeRegion][0];
  const bone = rig.bones[boneKey];
  /* Subscribed at the top level, not inside the `sliderDelta` memo's
     dependency array. Calling a hook in a dep array happens to work but
     breaks the moment the memo is moved into a conditional, and it makes the
     dependency chain impossible to read. */
  const sliders = useCharacter((s) => s.sliders[s.activeRegion]);

  const anchor = useMemo(() => {
    const p = new THREE.Vector3(...def.center);
    if (activeRegion === 'cheeks') p.x = 0;
    return p;
  }, [def, activeRegion]);

  // Slider contribution in bone-local space (must mirror poseBone()).
  const sliderDelta = useMemo(() => {
    /* Translation and rotation only — the scale channels deform the bone in
       place and must not drag the grab proxy off its anchor. */
    const d = { x: 0, y: 0, z: 0, rotX: 0 };
    for (const s of SLIDER_DEFS) {
      const v = sliders[s.id] ?? 0;
      if (s.channel === 'x') d.x += v * s.gain;
      if (s.channel === 'y') d.y += v * s.gain;
      if (s.channel === 'z') d.z += v * s.gain;
      if (s.channel === 'rotX' || s.channel === 'rotZ') d.rotX += v * s.gain;
    }
    return d;
  }, [sliders]);

  // Place the proxy at the bone in rest pose + residual pose.
  useEffect(() => {
    if (!bone) return;
    proxy.position.set(anchor.x, anchor.y, anchor.z);
    proxy.position.x += pose.offset[0] + sliderDelta.x;
    proxy.position.y += pose.offset[1] + sliderDelta.y;
    proxy.position.z += pose.offset[2] + sliderDelta.z;
    _q.setFromEuler(new THREE.Euler(pose.rotation[0] + sliderDelta.rotX, pose.rotation[1], pose.rotation[2]));
    proxy.quaternion.copy(_q);
    proxy.scale.set(1, 1, 1);
    proxy.updateMatrixWorld(true);
  }, [proxy, anchor, bone, pose, sliderDelta]);

  const applyToBones = () => {
    proxy.updateMatrixWorld(true);
    /* The proxy rides at the region's *visual* centre, the bone sits at its
       bind pivot. Copying `proxy.position` straight onto the bone is what
       displaced the forehead 87 mm and sheared the face: translate by the
       proxy's offset from the anchor, then re-add the pivot that `poseBone`
       also adds. Mirrored bones take the mirrored pivot. */
    const pivot = regionPivot(activeRegion);
    const dx = proxy.position.x - anchor.x;
    const dy = proxy.position.y - anchor.y;
    const dz = proxy.position.z - anchor.z;
    const keys = rig.regionBoneKeys[activeRegion];
    for (const key of keys) {
      const b = rig.bones[key];
      if (!b) continue;
      const side = key.endsWith('_R') ? -1 : 1;
      b.position.set(pivot[0] * side + dx, pivot[1] + dy, pivot[2] + dz);
      b.quaternion.copy(proxy.quaternion);
      b.scale.copy(proxy.scale);
    }
    rig.root.updateMatrixWorld(true);
  };

  const onObjectChange = () => {
    applyToBones();
    if (!dragging.current) return;
    // residual = proxy − anchor − slider contribution
    const offX = proxy.position.x - anchor.x - sliderDelta.x;
    const offY = proxy.position.y - anchor.y - sliderDelta.y;
    const offZ = proxy.position.z - anchor.z - sliderDelta.z;
    const e = new THREE.Euler().setFromQuaternion(proxy.quaternion);
    setPose({
      offset: [offX, offY, offZ],
      rotation: [e.x - sliderDelta.rotX, e.y, e.z],
      scale: [proxy.scale.x - 1, proxy.scale.y - 1, proxy.scale.z - 1],
    });
  };

  // tooltip follows the bone tip in screen space
  const tipRef = useRef<THREE.Group>(null);
  const [tip, setTip] = useState<[number, number, number]>([anchor.x, anchor.y, anchor.z]);

  useEffect(() => {
    setTip([anchor.x, anchor.y, anchor.z]);
  }, [anchor]);

  /* drei's <Html> never appends its portal here: its layout effect bails while
     the group ref is still null on the first commit, and its dependency list
     never changes, so it never retries. A `createPortal` from inside <Canvas>
     is no better — the reconciler still sees a `<div>` and throws "Div is not
     part of the THREE namespace". So the scene only publishes the projected
     point, and `GizmoTooltip` in the HUD layer (plain React DOM) draws it. */
  const { camera, size } = useThree();

  useFrame(() => {
    if (!showGizmo) {
      setTipScreen(0, 0, false);
      return;
    }
    const g = tipRef.current;
    if (!g) return;
    g.updateWorldMatrix(true, false);
    const v = _v.setFromMatrixPosition(g.matrixWorld).project(camera);
    // Behind the camera: hide rather than mirror the label through the origin.
    if (v.z > 1) {
      setTipScreen(0, 0, false);
      return;
    }
    setTipScreen(
      (v.x * 0.5 + 0.5) * size.width,
      (-v.y * 0.5 + 0.5) * size.height,
      true,
    );
  });

  if (!showGizmo) return null;

  return (
    <>
      <primitive object={proxy} />
      {bone && (
        <TransformControls
          object={proxy}
          mode={mode}
          size={0.52}
          space="local"
          showX
          showY
          showZ
          onMouseDown={() => {
            dragging.current = true;
          }}
          onMouseUp={() => {
            dragging.current = false;
            onObjectChange();
          }}
          onObjectChange={onObjectChange}
        />
      )}

      {/* anchor dot at the bone origin */}
      <mesh position={tip} renderOrder={7}>
        <sphereGeometry args={[0.0028, 12, 12]} />
        <meshBasicMaterial color="#ff4d3d" toneMapped={false} depthTest={false} transparent />
      </mesh>

      {/* Above and to the right of the bone, clear of the gizmo's own arms —
          at +0.032/+0.006 the label's rule crossed the X and Y handles. */}
      <group ref={tipRef} position={[tip[0] + 0.056, tip[1] + 0.030, tip[2] + 0.012]} />
    </>
  );
}
