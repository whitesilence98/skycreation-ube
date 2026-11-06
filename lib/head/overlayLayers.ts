import type { OverlayLayer } from '@/lib/store';

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
 * The layer colour is not multiplied over the texture's own RGB. Skyrim stores
 * tintmasks as alpha coverage and supplies the colour separately in
 * `tintInfo`, so a `source-in` fill followed by a `destination-over` at the
 * layer's alpha reproduces the game's own maths: the mask shapes the colour,
 * the colour does not shape the mask.
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

/**
 * Draws `layers` over `ctx`, which must already hold the head diffuse at
 * `size × size`.
 *
 * Each layer goes through a scratch canvas the size of the atlas: fill it with
 * the layer colour, keep only where the mask is opaque (`destination-in`),
 * then draw the result at the layer's opacity. Doing it in one scratch canvas
 * per layer rather than per-pixel keeps this off the JS heap — 2048² × 4 bytes
 * per layer is a lot of `getImageData` otherwise.
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

    const scratch = document.createElement('canvas');
    scratch.width = size;
    scratch.height = size;
    const sctx = scratch.getContext('2d');
    if (!sctx) continue;

    /* The mask is drawn first, then the colour is flooded over it and clipped
       to the mask's own coverage. `destination-in` keeps the flood only where
       the mask has alpha, so soft mask edges stay soft instead of turning into
       a hard silhouette. */
    sctx.drawImage(mask, 0, 0, size, size);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = layer.color;
    sctx.fillRect(0, 0, size, size);

    /* A tintmask's own alpha is the coverage, but some packs ship a white-on-
       black greyscale with a fully-opaque alpha channel. In that case the PNG
       we converted carries the coverage in *luminance* — so weight the colour
       by the mask again, with `multiply`, which darkens toward the mask's own
       greys without touching transparent pixels. */
    const hasRealAlpha = maskHasAlpha(mask);
    if (!hasRealAlpha) {
      sctx.globalCompositeOperation = 'multiply';
      sctx.drawImage(mask, 0, 0, size, size);
      sctx.globalCompositeOperation = 'destination-in';
      sctx.drawImage(mask, 0, 0, size, size);
    }

    ctx.save();
    ctx.globalAlpha = a;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();

    drawn += 1;
  }

  return drawn;
}

/**
 * True when the converted mask actually carries transparency.
 *
 * The worker writes a greyscale PNG whose alpha is the source alpha, or the
 * luminance when the source had none — but a luminance fallback is stored in
 * the *alpha* channel too, so a converted mask always has alpha. What varies
 * is whether the browser's `<img>` will report it, which depends on the PNG
 * having an alpha channel at all. Sampling a cheap downscaled copy answers
 * that without reading 16 megapixels per layer.
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
    let minA = 255;
    for (let i = 3; i < d.length; i += 4) minA = Math.min(minA, d[i]);
    return minA < 250;
  } catch {
    /* A cross-origin image taints the canvas; assume the mask is usable and
       let the composite decide. Everything here is same-origin in practice. */
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
