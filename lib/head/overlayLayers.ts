import type { OverlayBlend, OverlayLayer } from '@/lib/store';

/**
 * Composites makeup / tattoo / wrinkle tintmasks onto a head atlas.
 *
 * Why atlas space and not face space: Skyrim's tintmasks are painted in the
 * *same* UV layout as `femaleHead_d.dds`. Compositing them onto the decoded
 * atlas before the landmark projection means they register by construction —
 * the overlay follows the skin's own eye line and mouth the way the skin does,
 * and a per-skin `atlasFit` moves both together. Painting them afterwards in
 * face space would need a second registration, and getting that wrong is what
 * makes painted makeup sit under the eyes.
 *
 * Tintmasks carry coverage separately from colour. A `source-in` fill colours
 * that coverage; the selected blend mode then combines it with the skin atlas.
 * Normal mode uses source-over, preserving the historical tint behaviour.
 */

export interface OverlayInput {
  layer: OverlayLayer;
  /** Greyscale mask, white = painted. Null when the fetch failed. */
  mask: HTMLImageElement | null;
}

/** Loads one converted tintmask; a missing file is a skipped layer, not an error. */
export function loadMask(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The canvas operation each layer blend maps onto. */
const BLEND_OP: Record<OverlayBlend, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
};

/** A layer's coverage, 0–1. An absent or unusable value means "keep the mask". */
export function overlayCoverage(layer: OverlayLayer): number {
  const c = layer.coverage;
  if (typeof c !== 'number' || !Number.isFinite(c)) return 1;
  return Math.min(1, Math.max(0, c));
}

/**
 * Coverage as a threshold on the mask, not a fade.
 *
 * The mask's painted core should stay fully painted while coverage rises; what
 * coverage removes is its faint edge. So the bottom `1 - coverage` of the
 * alpha range is cut to zero and the remainder is stretched back over 0–255:
 *
 *     t = 1 - coverage
 *     a' = a <= t ? 0 : (a - t) / (1 - t)
 *
 * `coverage = 0` therefore zeroes every pixel and `coverage = 1` is identity.
 */
export function coverageAlpha(alpha: number, coverage: number): number {
  if (coverage <= 0) return 0;
  if (coverage >= 1) return alpha;
  const t = 1 - coverage;
  const norm = Math.min(1, Math.max(0, alpha / 255));
  if (norm <= t) return 0;
  return Math.round(((norm - t) / (1 - t)) * 255);
}

/**
 * Draws `layers` over `ctx`, which must already hold the head diffuse at
 * `size × size`.
 *
 * Each layer goes through a scratch canvas the size of the atlas: fill it with
 * the layer colour, keep only where the mask is opaque (`destination-in`),
 * then draw the result at the layer's opacity and blend mode. Doing it in one
 * scratch canvas per layer rather than per-pixel keeps this off the JS heap —
 * 2048² × 4 bytes per layer is a lot of `getImageData` otherwise.
 */
export function compositeOverlays(
  ctx: CanvasRenderingContext2D,
  layers: OverlayInput[],
  size: number,
): number {
  let drawn = 0;

  for (const { layer, mask } of layers) {
    if (!mask) continue;
    const a = Math.min(1, Math.max(0, layer.opacity));
    if (a <= 0) continue;

    const coverage = overlayCoverage(layer);
    /* Coverage 0 removes the mask entirely; creating a scratch canvas only to
       draw nothing is wasted work. */
    if (coverage <= 0) continue;

    const blend: OverlayBlend =
      layer.blend && BLEND_OP[layer.blend] ? layer.blend : 'normal';

    const scratch = document.createElement('canvas');
    scratch.width = size;
    scratch.height = size;
    const sctx = scratch.getContext('2d');
    if (!sctx) continue;

    // Draw mask to scratch canvas
    sctx.drawImage(mask, 0, 0, size, size);

    /* Verify alpha coverage: if mask has no transparent pixels (loaded as opaque greyscale),
       convert luminance to true alpha and clean background noise (< 10 -> 0).
       A mask that already carries alpha needs no pixel work at full coverage;
       below full coverage the coverage threshold is applied in the same pass. */
    const hasAlpha = maskHasAlpha(mask);
    if (!hasAlpha || coverage < 1) {
      const imgData = sctx.getImageData(0, 0, size, size);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        let alpha = d[i + 3];
        if (!hasAlpha) {
          const lum = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
          alpha = lum < 10 ? 0 : lum;
          d[i] = 255;
          d[i + 1] = 255;
          d[i + 2] = 255;
        }
        d[i + 3] = coverage < 1 ? coverageAlpha(alpha, coverage) : alpha;
      }
      sctx.putImageData(imgData, 0, 0);
    }

    /* Flood color into coverage: `source-in` keeps color only where alpha > 0.
       Areas with alpha = 0 remain 100% transparent. */
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = layer.color;
    sctx.fillRect(0, 0, size, size);

    /* Blend onto base atlas at layer opacity. */
    ctx.save();
    ctx.globalAlpha = a;
    ctx.globalCompositeOperation = BLEND_OP[blend];
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();

    drawn += 1;
  }

  return drawn;
}

/**
 * True when the converted mask actually carries transparent pixels.
 * If all sampled pixels are opaque (alpha >= 200), the mask is treated as
 * an opaque greyscale image that needs luminance-to-alpha conversion.
 */
function maskHasAlpha(mask: HTMLImageElement): boolean {
  try {
    const probe = document.createElement('canvas');
    probe.width = 32;
    probe.height = 32;
    const pctx = probe.getContext('2d');
    if (!pctx) return true;
    pctx.drawImage(mask, 0, 0, 32, 32);
    const d = pctx.getImageData(0, 0, 32, 32).data;
    let hasTransparent = false;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 200) {
        hasTransparent = true;
        break;
      }
    }
    return hasTransparent;
  } catch {
    return true;
  }
}

/**
 * Lip colour, restored as an atlas-space pass.
 *
 * The earlier vector wash was deleted because it was registered against head
 * metres while the atlas's own lip paint is not; this runs where the lip paint
 * actually is. Skyrim's head diffuse already carries a lip line and shaded
 * mouth — this tints toward it rather than drawing a shape, using the painted
 * saturation as the mask so the colour can only land where the atlas put lips.
 *
 * `strength` of 0 leaves the bake untouched, which is the default when the
 * preset carries no lip colour.
 */
export function tintLips(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  strength: number,
): void {
  if (strength <= 0) return;

  const scratch = document.createElement('canvas');
  scratch.width = size;
  scratch.height = size;
  const sctx = scratch.getContext('2d');
  if (!sctx) return;

  /* Only the lower half of the face carries lips; sampling the whole atlas
     would also catch the ears and the hairline. The head atlas puts the mouth
     at roughly 56–62 % down the image, so the band below is generous. */
  sctx.drawImage(ctx.canvas, 0, 0);
  const band = sctx.getImageData(0, Math.round(size * 0.52), size, Math.round(size * 0.16));
  const d = band.data;

  /* Redness over brightness: lip paint is the most saturated warm region in
     that band. Thresholding on r − g finds it on every skin tone in the
     archive, where a fixed colour key would need a per-mod constant. */
  let hits = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const warm = r - g;
    const lipness = Math.min(1, Math.max(0, (warm - 12) / 34)) * Math.min(1, r / 96);
    if (lipness <= 0) {
      d[i + 3] = 0;
      continue;
    }
    d[i + 3] = Math.round(255 * lipness);
    hits += 1;
  }
  if (!hits) return;
  sctx.putImageData(band, 0, Math.round(size * 0.52));

  /* Keep the paint and throw away everything else, then flood the colour
     through it exactly as the overlay compositor does. */
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = color;
  sctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.globalAlpha = Math.min(1, strength);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

/**
 * Composites `overlayImages` directly onto a base head diffuse image.
 * Returns a new HTMLCanvasElement holding the final textured atlas, ready for
 * Three.js CanvasTexture on real head meshes.
 */
export function compositeHeadAtlas(
  baseImage: HTMLImageElement | HTMLCanvasElement,
  overlayImages: OverlayInput[],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const size = Math.min(2048, Math.max(1024, baseImage.width || 1024));
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.drawImage(baseImage, 0, 0, size, size);
  if (overlayImages.length > 0) {
    compositeOverlays(ctx, overlayImages, size);
  }
  return canvas;
}

