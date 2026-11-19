import { THUMBNAIL_MAX_CHARS } from '@/lib/presets/records';

type Capture = () => Promise<string | null>;
let handler: Capture | undefined;

export function registerViewportCapture(capture: Capture) { handler = capture; }
export function unregisterViewportCapture(capture: Capture) {
  if (handler === capture) handler = undefined;
}
export async function captureViewport(): Promise<string | null> {
  try { return await handler?.() ?? null; } catch { return null; }
}

export function toSquareThumbnail(source: HTMLCanvasElement): string | null {
  try {
    const side = Math.min(source.width, source.height);
    if (!side) return null;
    const canvas = document.createElement('canvas');
    for (const size of [256, 192]) {
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(source, (source.width - side) / 2, (source.height - side) / 2,
        side, side, 0, 0, size, size);
      const url = canvas.toDataURL(size === 256 ? 'image/webp' : 'image/jpeg', 0.82);
      if (url.length <= THUMBNAIL_MAX_CHARS && /^data:image\/(webp|jpeg|png);base64,/.test(url)) return url;
    }
  } catch { /* A tainted canvas must never prevent saving the character. */ }
  return null;
}
