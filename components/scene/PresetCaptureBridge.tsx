'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Object3D } from 'three';
import { registerViewportCapture, unregisterViewportCapture, toSquareThumbnail } from '@/lib/presets/capture';

export function PresetCaptureBridge() {
  const { scene, gl, invalidate } = useThree();
  const pending = useRef<{
    promise: Promise<string | null>;
    finish: (image: string | null) => void;
    hidden: Object3D[];
    armed: boolean;
  } | null>(null);

  useEffect(() => {
    const capture = () => {
      if (pending.current) return pending.current.promise;
      let resolve!: (image: string | null) => void;
      const promise = new Promise<string | null>(done => { resolve = done; });
      const timer = window.setTimeout(() => pending.current?.finish(null), 3000);
      pending.current = {
        promise, hidden: [], armed: false,
        finish: image => {
          clearTimeout(timer);
          for (const object of pending.current?.hidden ?? []) object.visible = true;
          pending.current = null;
          resolve(image);
          invalidate();
        },
      };
      invalidate();
      return promise;
    };
    registerViewportCapture(capture);
    return () => {
      unregisterViewportCapture(capture);
      pending.current?.finish(null);
    };
  }, [scene, gl, invalidate]);

  useFrame(() => {
    const request = pending.current;
    if (!request || request.armed) return;
    scene.traverse(object => {
      if (object.visible && (object.name === 'face-gizmo' || object.name === 'mesh-overlay'
        || object.userData.isHelper || (object as Object3D & { isTransformControls?: boolean }).isTransformControls)) {
        request.hidden.push(object);
        object.visible = false;
      }
    });
    request.armed = true;
  });

  // The permanently mounted composer renders at priority 1. Read its final frame
  // in the same task, without preserveDrawingBuffer or bypassing postprocessing.
  useFrame(() => {
    const request = pending.current;
    if (!request?.armed) return;
    try { request.finish(toSquareThumbnail(gl.domElement)); }
    finally { if (pending.current === request) request.finish(null); }
  }, 2);

  return null;
}
