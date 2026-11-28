/**
 * lib/head/bodyPaint.ts
 *
 * Offscreen canvas texture compositor for BodyPaint / HandPaint / FootPaint overlays.
 */

import * as THREE from 'three';
import {
  hasActiveBodyPaint,
  type BodyPaintLayer,
} from '@/lib/head/bodyPaintTypes';

export * from '@/lib/head/bodyPaintTypes';

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  const existing = imageCache.get(url);
  if (existing) return existing;

  const p = new Promise<HTMLImageElement | null>((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  imageCache.set(url, p);
  return p;
}

/**
 * Composites a tinted Body/Hand/Foot paint overlay onto `baseSkinUrl` inside an
 * offscreen canvas and returns an sRGB `THREE.CanvasTexture`.
 * Returns `null` if no overlay is active or loading fails.
 */
export async function buildBodyPaintCanvas(
  baseSkinUrl: string,
  layer: BodyPaintLayer,
): Promise<HTMLCanvasElement | null> {
  if (!hasActiveBodyPaint(layer) || !layer.textureUrl) return null;

  const [baseImg, overlayImg] = await Promise.all([
    loadImage(baseSkinUrl),
    loadImage(layer.textureUrl),
  ]);
  if (!baseImg || !overlayImg) return null;

  const size = Math.min(2048, Math.max(512, baseImg.naturalWidth || 1024));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(baseImg, 0, 0, size, size);

  const tintCanvas = document.createElement('canvas');
  tintCanvas.width = size;
  tintCanvas.height = size;
  const tctx = tintCanvas.getContext('2d');
  if (!tctx) return null;

  tctx.drawImage(overlayImg, 0, 0, size, size);
  tctx.globalCompositeOperation = 'source-in';
  tctx.fillStyle = layer.color;
  tctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity));
  ctx.drawImage(tintCanvas, 0, 0, size, size);
  ctx.restore();
  return canvas;
}

export async function buildBodyPaintBlobUrl(
  baseSkinUrl: string,
  layer: BodyPaintLayer,
): Promise<string | null> {
  const canvas = await buildBodyPaintCanvas(baseSkinUrl, layer);
  if (!canvas) return null;
  return new Promise<string | null>((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ? URL.createObjectURL(blob) : null);
    }, 'image/webp', 0.92);
  });
}

export async function buildBodyPaintTexture(
  baseSkinUrl: string,
  layer: BodyPaintLayer,
): Promise<THREE.CanvasTexture | null> {
  const canvas = await buildBodyPaintCanvas(baseSkinUrl, layer);
  if (!canvas) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
