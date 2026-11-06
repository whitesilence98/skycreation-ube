import * as THREE from 'three';
import { FACE_RECT, LANDMARK, WIDTH } from '@/lib/head/geometry';
import { compositeOverlays, tintLips, type OverlayInput } from '@/lib/head/overlayLayers';

export interface Mo2Blemish {
  x: number;
  y: number;
  a: number;
}

export interface Mo2SkinPalette {
  mean: string;
  shadow: string;
  mid: string;
  highlight: string;
  lip: string;
  blemishes: Mo2Blemish[];
  blemishCount: number;
  faceBox?: { x0: number; x1: number; y0: number; y1: number };
}

/** Where the eyeball sits in a given eye atlas, in UV. */
export interface Mo2EyeAtlas {
  cx: number;
  cy: number;
  r: number;
  /** False when the measurement was implausible and the fallback was used. */
  measured?: boolean;
}

export interface Mo2AssetOption {
  /** Stable slug; this is what the store's `assetSelection` holds. */
  id: string;
  /** MO2 mod folder the file came from. */
  mod: string;
  /** Basename, for the panel's compact readout. */
  file: string;
  /** Short human name for the picker; falls back to `mod` when absent. */
  label?: string;
  /** `<mod>\<archive-relative path>`, i.e. what `mods.*` has always shown. */
  rel: string;
}

/**
 * One selectable non-head part: a mesh, its authored atlas, and optionally the
 * normal map beside it. Both URLs are independent — a part can carry a mesh
 * without a texture, or a texture override without changing geometry.
 */
export interface Mo2PartOption extends Mo2AssetOption {
  meshUrl?: string;
  texture?: string;
  normalTexture?: string;
  /** Catalogue row for an authored NIF converted on demand (`mode=mesh`). */
  catalogueId?: string;
  /** Pack producer flag: the NIF has to be decoded by the worker on demand. */
  onDemand?: boolean;
  /** False when the producer knows this row can never be served (e.g. the
   *  referenced DDS files are absent); the row stays visible but unavailable. */
  available?: boolean;
  /** Why it is unavailable, shown verbatim. */
  reason?: string;
  /** Missing pack-relative DDS references, for the panel's diagnostic. */
  missingTextures?: string[];
  /** Produced geometry decodes but lacks a required albedo atlas: convert in
   *  mesh mode and draw it flat grey; never request texture URLs for it. */
  untextured?: boolean;
  /** Body meshes: the `_0`/`_1` weight pair, resolved to convert URLs. The
   *  renderer fetches both and lerps positions between them. */
  weightVariants?: { w0: string; w1: string };
  /** Body meshes: the normalised stem shared by the pair (`femalebody`). */
  weightKey?: string;
  /** The outfit supplies its embedded body shape. */
  hasBodyShape?: boolean;
}

export interface Mo2SkinOption extends Mo2AssetOption {
  texture: string;
  /** Lossless PNG tangent-space normal authored for the same head UV as
   *  `texture`, when the mod ships a `*_n.dds`. Absent otherwise. */
  normalTexture?: string | null;
  size: [number, number];
  palette: Mo2SkinPalette;
  /** This atlas's own landmark calibration. Absent = the canonical `ATLAS_FIT`,
   *  which is `measured: false` and gets the `ESTIMATED` chip in the picker. */
  atlasFit?: Mo2AtlasFit;
}

/** Landmark fit for one head diffuse: atlas pixels per head-local metre. */
export interface Mo2AtlasFit {
  cx: number;
  kx: number;
  cy: number;
  ky: number;
  /** False when the atlas could not be measured and the canonical fit was used. */
  measured?: boolean;
}

export interface Mo2EyeOption extends Mo2AssetOption {
  texture: string;
  /** Square iris crop for the 3D eyeballs; absent when none was produced. */
  discTexture?: string;
  size: [number, number];
  iris: string;
  mean: string;
  atlas: Mo2EyeAtlas;
  meshUrl?: string;
  lashesMeshUrl?: string;
  lashesTexture?: string;
}

export interface Mo2HairOption extends Mo2AssetOption {
  texture: string;
  size: [number, number];
  /** False when the cards' UV windows are blank on this atlas. */
  usable: boolean;
  /** The DDS carried a real alpha channel, used instead of the luminance ramp. */
  hasAlpha?: boolean;
  curtainCover: [number, number, number];
  /** Per-column alpha spread — 0 means a solid slab, high means strands. */
  strandVariance?: [number, number, number];
  coverMin: number;
  coverMax: number;
  /**
   * Per-group strand blocks measured on this atlas, `{ curtain, fringe, wisp }`.
   *
   * The cards sample one hand-measured layout (`90sBebe`'s), so an atlas with
   * a different block arrangement painted solid ribbons. Each group is fitted
   * to the block that scored best for it; an absent map means this atlas
   * already carries its strands where the authored rects expect them.
   */
  groups?: Partial<Record<'curtain' | 'fringe' | 'wisp', [number, number, number, number]>>;
  /**
   * The atlas's most opaque block, `[u0, u1, v0, v1]`, for the scalp shell.
   *
   * The shell is drawn opaque (`alphaTest: 0`), so it must not sample a
   * strand window — those are mostly holes and would show bare skull. Scored
   * separately on coverage alone, and absent when the atlas has no block that
   * is genuinely solid.
   */
  capWindow?: [number, number, number, number];
}

export interface Mo2MeshOption extends Mo2AssetOption {
  label: string;
  bytes: number;
  version: string;
  nodes: string[];
  shapes: Record<string, number>;
  meshUrl?: string;
  isRealMesh?: boolean;
  /**
   * Basename of the `.jslot` whose RaceMenu sculpt is already baked into this
   * mesh. Preset import matches on it, which is what lets a `.jslot` actually
   * change the face instead of only nudging a handful of sliders.
   */
  sculptSource?: string;
  origin?: 'racemenu-export' | 'sculpt-replay';
  headTextureMissing?: boolean;
}

export interface Mo2SkeletonOption extends Mo2AssetOption {
  label: string;
  bytes: number;
  version: string;
  nodes: string[];
}

export interface Mo2PresetOption extends Mo2AssetOption {
  label: string;
  morphs: Array<{ name: string; value: number }>;
  sculpt: { vertexCount: number; pointCount: number };
  faceTextures?: Array<{ index: number; texture: string }>;
  headParts?: Array<{ type: number; form: string }>;
  actor?: Record<string, unknown>;
}

export interface Mo2Manifest {
  available: boolean;
  source: string;
  /** Stable identity of the active source; `preset-pack` in pack mode. */
  sourceId?: string;
  /** Fingerprint of the resolved source root/config. Two sources can share an
   *  id (the same preset pack relocated); this is what makes them distinct. */
  sourceKey?: string;
  /** `pack` uses the generated preset-pack namespace only; legacy is `mo2`. */
  sourceLayout?: 'pack' | 'mo2';
  /** Producer-side problems that never became a usable resource. */
  diagnostics?: string[];
  generatedAt?: string;
  textures: Partial<Record<'skin' | 'eye' | 'hair' | 'normal' | 'headMesh' | 'eyeDisc', string>>;
  skin?: Mo2SkinPalette;
  /** Landmark calibration for the active skin's atlas, when measured. */
  atlasFit?: Mo2AtlasFit;
  /** Lip tint carried by the preset's `tintInfo`, applied in atlas space. */
  lipColor?: string;
  lipStrength?: number;
  eye?: {
    iris: string;
    mean: string;
    atlas?: Mo2EyeAtlas;
    meshUrl?: string;
    lashesMeshUrl?: string;
    lashesTexture?: string;
  };
  skinSource?: { file: string; size: [number, number] };
  eyeSource?: { file: string; size: [number, number] };
  hairSource?: { file: string; size: [number, number] };
  body?: Mo2AssetOption & { meshUrl?: string; texture?: string; normalTexture?: string };
  /**
   * Per-part overrides resolved from the selection. Each key is independent:
   * a part's mesh and texture can be chosen separately, and an absent key
   * falls back to the older single-value fields (`body`, `eye.lashes*`).
   */
  parts?: Partial<Record<'mouth' | 'brows' | 'lashes' | 'hair' | 'body' | 'clothing', Mo2PartOption>>;
  /** The active hair atlas's per-group strand blocks, when it needed remapping. */
  hairGroups?: Partial<
    Record<'curtain' | 'fringe' | 'wisp', [number, number, number, number]>
  >;
  /** The active hair atlas's most opaque block, for the scalp shell. */
  hairCapWindow?: [number, number, number, number];
  headMesh?: {
    file: string;
    version: string;
    bytes?: number;
    nodes: string[];
    shapes: Record<string, number>;
    isGltf?: boolean;
    meshUrl?: string;
    isRealMesh?: boolean;
  };
  skeleton?: {
    file: string;
    version?: string;
    bytes?: number;
    nodes: string[];
    isGltf?: boolean;
  };
  preset?: {
    preset: string;
    morphs: Array<{ name: string; value: number }>;
    sculpt: { vertexCount: number; pointCount: number };
    faceTextures?: Array<{ index: number; texture: string }>;
    headParts?: Array<{ type: number; form: string }>;
    actor?: Record<string, unknown>;
  };
  mods?: Record<string, string | null>;
  errors?: string[];
  /** Every selectable option per category, in preference order. */
  assets?: {
    skin?: Mo2SkinOption[];
    eyes?: Mo2EyeOption[];
    hair?: Mo2HairOption[];
    headMesh?: Mo2MeshOption[];
    skeleton?: Mo2SkeletonOption[];
    preset?: Mo2PresetOption[];
    body?: (Mo2AssetOption & { meshUrl?: string; texture?: string; normalTexture?: string })[];
    /** Per-part mesh/texture options, one list per part. */
    mouth?: Mo2PartOption[];
    eyeMesh?: Mo2PartOption[];
    lashesMesh?: Mo2PartOption[];
    browsMesh?: Mo2PartOption[];
    mouthMesh?: Mo2PartOption[];
    brows?: Mo2PartOption[];
    lashes?: Mo2PartOption[];
    /** `hair` already names the atlas list; `hairMesh` carries authored hair. */
    hairMesh?: Mo2PartOption[];
    bodyMesh?: Mo2PartOption[];
    /** Authored outfit; one mesh carries both the embedded body and garment. */
    clothingMesh?: Mo2PartOption[];
    clothing?: Mo2PartOption[];
  };
}

/**
 * Head-local metres → atlas pixels on femaleHead_d at 1024², least-squares
 * through the painted landmarks: eyes (409, 454) / (611, 454), mouth
 * (510, 590). Deriving these from the image rather than eyeballing them is
 * what keeps the painted brows, eyes, lips and nostrils on the modelled
 * features.
 */
export const ATLAS_FIT = {
  cx: 512, // px at x = 0 — the mesh centre must match the UV rect's centre
  kx: 3176, // px per metre across
  cy: 415.25, // px at y = 0
  ky: -1937.3, // px per metre down (negative: +y is up, +py is down)
} as const;

export const FACE_SIZE = 1536;

export { FACE_RECT };

export interface FaceTextureResult {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  landmarks: {
    irisL: [number, number];
    irisR: [number, number];
    lip: [number, number];
  };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Paints the features the mod's head diffuse does not carry.
 *
 * `femaleHead_d.dds` is a Skyrim head atlas: the eyes are *closed*, with
 * nothing but a lash-line crease and no iris at all, and there are no brow
 * hairs — the game draws those as separate meshes and hair overlays. Projected
 * onto our mesh, that produces a blank mannequin with two dark smudges. So the
 * eyes, brows and lip colour are drawn here, in head-local metres, onto the
 * projected albedo. This is also why the earlier attempts to "light the face
 * better" never brought the features back: there was nothing there to light.
 */
/**
 * Fallback location of the eyeball inside an eye atlas, measured from the
 * Zhizhen image: the iris is a disc of radius ≈0.126 atlas-widths centred at
 * (0.497, 0.754) in UV, in the lower half of the atlas.
 *
 * Every eye mod lays its atlas out slightly differently, so `sync:assets`
 * measures each one and carries the result on `manifest.eye.atlas`; this
 * constant is only used when that measurement is missing or implausible.
 */
export const EYE_ATLAS: Mo2EyeAtlas = { cx: 0.497, cy: 0.754, r: 0.126, measured: false };

/** Half the interpupillary distance, in head-local metres. Re-uses the mesh
 *  landmark so the painter and the returned landmarks cannot drift apart. */
const IRIS_X = WIDTH.eyeX;

function paintFaceFeatures(
  ctx: CanvasRenderingContext2D,
  S: number,
  rect: { x0: number; x1: number; y0: number; y1: number },
  eyeTex: HTMLImageElement | null,
  irisHex: string,
  atlas: Mo2EyeAtlas,
) {
  const rectW = rect.x1 - rect.x0;
  const rectH = rect.y1 - rect.y0;
  const KX = (S - 1) / rectW;
  const KY = (S - 1) / rectH;
  const X = (x: number) => (x - rect.x0) * KX;
  const Y = (y: number) => (rect.y1 - y) * KY;

  ctx.save();

  /* ── brows ──────────────────────────────────────────────────────
     A tapered spine swept slightly above the bony ridge, thickest over the
     inner third and running to a fine tail. Painted rather than modelled so
     they read as hair at any zoom. */
  for (const side of [-1, 1]) {
    const inner = side * 0.0142;
    const outer = side * 0.0555;
    const n = 48;
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];
    /* A nearly flat spine with a gentle arch — the reference's brows are
       low and level, not the high theatrical arc of a drawn-on brow. Sits
       just above the bony ridge; 0.0136 read as too high at full frame. */
    const spine = (t: number) =>
      0.0126 + Math.sin(Math.PI * Math.min(1, t * 1.1)) * 0.0030 - t * 0.0020;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = inner + (outer - inner) * t;
      const y = spine(t);
      const thick =
        (0.0006 + 0.0022 * Math.sin(Math.PI * Math.pow(t, 0.72))) *
        (1 - 0.55 * smoothstepLocal(0.82, 1, t));
      left.push([X(x), Y(y - thick * 0.5)]);
      right.push([X(x), Y(y + thick * 0.5)]);
    }
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    // a wash, not a solid shape: the strokes below carry the density
    ctx.fillStyle = 'rgba(62,44,32,0.58)';
    ctx.fill();

    /* Individual hairs along the spine. Drawn upward and outward from the
       brow line, each one thin and slightly translucent, so the brow reads
       as hair rather than as an inked silhouette. */
    ctx.lineCap = 'round';
    let seed = 0x1b873593;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let k = 0; k < 170; k++) {
      const t = rand();
      const x = inner + (outer - inner) * t;
      const y = spine(t) + (rand() - 0.5) * 0.0026;
      const len = 0.0024 * (1 - 0.35 * t) * (0.7 + rand() * 0.8);
      const dx = Math.sign(side) * len * (0.45 + rand() * 0.3);
      const dy = len * (0.72 + rand() * 0.3);
      ctx.strokeStyle = `rgba(${44 + Math.floor(rand() * 26)},${31 + Math.floor(rand() * 20)},${22 + Math.floor(rand() * 14)},${0.30 + rand() * 0.34})`;
      // ~4× the old 0.55–1.15 px: see the lash-line note below.
      ctx.lineWidth = Math.max(1.6, (1.9 + rand() * 2.1) * (S / 1536));
      ctx.beginPath();
      ctx.moveTo(X(x), Y(y + len * 0.15));
      ctx.lineTo(X(x + dx), Y(y + dy * 0.65));
      ctx.stroke();
    }
  }

  /* ── eyes ────────────────────────────────────────────────────────
     An open almond aperture. The head mesh already recesses the socket, so
     the painted eye sits in a real cavity and the lid edge is the socket's
     own rim; the lash line here is the only thing that has to carry the
     silhouette. */
  for (const side of [-1, 1]) {
    const ex = side * IRIS_X;
    const ey = LANDMARK.eye;
    /* 11 mm of palpebral fissure across — an anatomical adult aperture. The
       earlier 13.7 mm read as a cartoon eye; the reference's eyes are narrow
       slits under a heavy upper lid. */
    const halfW = 0.0110;
    const tilt = side * 0.0009;

    ctx.save();
    ctx.translate(X(ex), Y(ey));
    const sx = KX;
    const sy = KY;
    const tiltPx = -tilt * sy;

    /* y in head space is +up, canvas +y is down; `up(d)` and `dn(d)` keep
       the path readable. */
    const up = (d: number) => -d * sy;
    const dn = (d: number) => d * sy;

    /* The control offsets set the real apex-to-apex fissure height. At
       0.0046 / 0.0056 up and 0.0032 / 0.0034 down that is only ~6.3 mm, so
       more than 40 % of the ~11 mm iris was clipped away and what showed was
       the dark horizontal sliver in the crop. Raising the controls puts the
       fissure at ~9 mm and exposes ~80 % of the iris without touching `halfW`
       — *not* widening `halfW`, because `dstW ∝ halfW` scales the iris with the
       slit and changes nothing. */
    const almond = () => {
      ctx.beginPath();
      ctx.moveTo(-halfW * sx, tiltPx * side);
      ctx.bezierCurveTo(
        -halfW * 0.58 * sx, up(0.0072),
        halfW * 0.40 * sx, up(0.0086),
        halfW * sx, tiltPx * side,
      );
      ctx.bezierCurveTo(
        halfW * 0.46 * sx, dn(0.0040),
        -halfW * 0.50 * sx, dn(0.0042),
        -halfW * sx, tiltPx * side,
      );
      ctx.closePath();
    };

    // soft shadow in the socket, so the aperture sits in a cavity
    almond();
    ctx.shadowColor = 'rgba(64,40,30,0.42)';
    ctx.shadowBlur = 26 * (S / 1536);
    ctx.fillStyle = 'rgba(112,78,64,0.14)';
    ctx.fill();
    ctx.shadowBlur = 0;

    almond();
    ctx.clip();

    /* ── the eyeball itself ─────────────────────────────────────
       When the mod's eye atlas is available it is blitted straight into
       the aperture: the real sclera, the real iris with its fibres and
       limbal ring, and the real pupil. That is the actual Zhizhen texture
       the character would wear in game, rather than a painterly stand-in.
       The fallback below only runs if the atlas failed to transcode. */
    const irisR = 0.0057;
    const ix = side * 0.0003;
    const iy = -0.0006;
    const ircx = ix * sx;
    const ircy = -iy * sy;

    if (eyeTex) {
      /* Source rect: the iris disc plus enough margin for the sclera to reach
         the canthi. 2.35 × the measured iris radius covers the visible globe at
         an 11 mm aperture; `atlas` is this texture's own measurement.

         The rect has to be clamped on **all four** edges and the destination
         derived from the *clamped* size. Only the origin was clamped before, so
         with the shipped atlas (`r ≈ 0.163`, `cy ≈ 0.743`, 512²) the source
         square reached ~64 px past the bottom edge; the spec clips the source
         and the destination in the same proportion, which cut away the sclera
         under the iris and left the iris floating in a dark slot. */
      const srcR = atlas.r * 2.35 * eyeTex.width;
      const rawX = atlas.cx * eyeTex.width - srcR;
      const rawY = atlas.cy * eyeTex.height - srcR;
      const sx0 = Math.max(0, rawX);
      const sy0 = Math.max(0, rawY);
      const sx1 = Math.min(eyeTex.width, rawX + srcR * 2);
      const sy1 = Math.min(eyeTex.height, rawY + srcR * 2);
      const sw = Math.max(1, sx1 - sx0);
      const sh = Math.max(1, sy1 - sy0);
      /* Keep the drawn disc circular: scale by the clamped source, not the
         nominal one, and offset by where the clamp moved the origin. */
      const dstW = halfW * sx * 2.35;
      const dstH = halfW * sy * 2.35;
      const dx = ((sx0 - rawX) / (srcR * 2)) * dstW;
      const dy = ((sy0 - rawY) / (srcR * 2)) * dstH;
      ctx.globalAlpha = 1;
      ctx.drawImage(
        eyeTex,
        sx0, sy0, sw, sh,
        ircx - dstW / 2 + dx, ircy - dstH / 2 + dy,
        dstW * (sw / (srcR * 2)), dstH * (sh / (srcR * 2)),
      );
    } else {
      const sclera = ctx.createRadialGradient(0, 0, 0, 0, 0, halfW * sx * 1.05);
      sclera.addColorStop(0, '#a89a8c');
      sclera.addColorStop(0.5, '#958578');
      sclera.addColorStop(1, '#6a5a50');
      ctx.fillStyle = sclera;
      ctx.fillRect(-halfW * sx * 1.3, up(0.010), halfW * sx * 2.6, dn(0.020));

      /* Fallback only: the iris tint measured from the mod's own eye
         diffuse, darkened at the limbus. */
      const iris = ctx.createRadialGradient(ircx, ircy, 0, ircx, ircy, irisR * sy);
      iris.addColorStop(0, irisHex);
      iris.addColorStop(0.40, irisHex);
      iris.addColorStop(0.78, 'rgba(40,44,38,0.96)');
      iris.addColorStop(0.94, '#2a2f28');
      iris.addColorStop(1, '#1b1f1a');
      ctx.beginPath();
      ctx.ellipse(ircx, ircy, irisR * sx, irisR * sy, 0, 0, Math.PI * 2);
      ctx.fillStyle = iris;
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(ircx, ircy, irisR * 0.38 * sx, irisR * 0.38 * sy, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#0d0d0b';
      ctx.fill();
    }

    /* ── iris detail ────────────────────────────────────────────
       Drawn over the blit, inside the aperture clip. The atlas' own limbal
       ring is a few texels wide in the source and the blit scales it down
       2.35×, so at the aperture it lands under one pixel; re-stroking it is
       free and is what stops the iris reading as a green smear. The
       catchlight is the single strongest "this is a wet sphere" cue — a
       point light placed for the iris rather than the skin. */
    ctx.beginPath();
    ctx.ellipse(ircx, ircy, irisR * sx * 0.94, irisR * sy * 0.94, 0, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, 0.00045 * sy);
    ctx.strokeStyle = 'rgba(12,16,11,0.55)';
    ctx.stroke();

    /* Upper-left in image space. The bake maps head +x straight onto texture
       +x with no per-eye mirroring, so one sign works for both eyes. */
    const catchX = ircx - 0.0020 * sx;
    const catchY = ircy - 0.0022 * sy;
    const catchR = Math.max(1.6, 0.00105 * sx);
    const catchlight = ctx.createRadialGradient(catchX, catchY, 0, catchX, catchY, catchR);
    catchlight.addColorStop(0, 'rgba(255,252,244,0.92)');
    catchlight.addColorStop(0.55, 'rgba(248,244,236,0.55)');
    catchlight.addColorStop(1, 'rgba(240,236,228,0)');
    ctx.fillStyle = catchlight;
    ctx.beginPath();
    ctx.arc(catchX, catchY, catchR, 0, Math.PI * 2);
    ctx.fill();

    /* Sclera is not white. Toward each canthus it picks up the conjunctiva's
       warm pink; two low-alpha washes at the corners, clipped by the almond. */
    for (const dir of [-1, 1]) {
      const cx = dir * halfW * sx * 0.82;
      const tint = ctx.createRadialGradient(cx, ircy, 0, cx, ircy, halfW * sx * 0.34);
      tint.addColorStop(0, 'rgba(196,116,96,0.30)');
      tint.addColorStop(1, 'rgba(196,116,96,0)');
      ctx.fillStyle = tint;
      ctx.fillRect(cx - halfW * sx * 0.4, up(0.0055), halfW * sx * 0.8, dn(0.011));
    }

    /* The lid's cast shadow. In the reference the upper lid covers the top
       third of the iris and the shadow bleeds a little lower still; without
       this the eye reads as a disc pasted on rather than an organ under
       skin. */
    const lid = ctx.createLinearGradient(0, up(0.0060), 0, up(0.0002));
    lid.addColorStop(0, 'rgba(30,19,15,0.94)');
    lid.addColorStop(0.42, 'rgba(38,24,18,0.55)');
    lid.addColorStop(1, 'rgba(44,29,22,0)');
    ctx.fillStyle = lid;
    ctx.fillRect(-halfW * sx * 1.3, up(0.0075), halfW * sx * 2.6, dn(0.0077));

    /* A soft shadow from the lower lid too — it darkens the bottom of the
       iris and stops the eye from looking painted onto a flat plane. */
    const lowerLid = ctx.createLinearGradient(0, dn(0.0026), 0, dn(0.0002));
    lowerLid.addColorStop(0, 'rgba(46,30,22,0)');
    lowerLid.addColorStop(1, 'rgba(46,30,22,0.34)');
    ctx.fillStyle = lowerLid;
    ctx.fillRect(-halfW * sx * 1.3, up(0.0018), halfW * sx * 2.6, dn(0.0018));

    ctx.restore();

    /* Lash lines. The widths are in the 1536² bake, which the projection then
       squeezes into a head ~300 screen px across — so 1.5 px here is under
       half a screen pixel and reads as speckle. ×4 puts the lash at ~6 px in
       the bake, i.e. just over 1 screen px at the reference framing, and it
       still holds at 1024×572. */
    ctx.save();
    ctx.translate(X(ex), Y(ey));
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(28,19,14,0.86)';
    ctx.lineWidth = Math.max(2.4, 6.0 * (S / 1536));
    ctx.beginPath();
    ctx.moveTo(-halfW * sx, tiltPx * side);
    ctx.bezierCurveTo(
      -halfW * 0.58 * sx, up(0.0046),
      halfW * 0.40 * sx, up(0.0056),
      halfW * sx, tiltPx * side,
    );
    ctx.stroke();
    // short outer flick
    ctx.lineWidth = Math.max(1.8, 3.6 * (S / 1536));
    ctx.strokeStyle = 'rgba(32,22,16,0.55)';
    ctx.beginPath();
    ctx.moveTo(halfW * 0.92 * sx, tiltPx * side);
    ctx.lineTo(halfW * 1.22 * sx, tiltPx * side - up(0.0014));
    ctx.stroke();
    // lower lash line, much fainter
    ctx.strokeStyle = 'rgba(56,36,26,0.42)';
    ctx.lineWidth = Math.max(1.8, 3.6 * (S / 1536));
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.9 * sx, tiltPx * side);
    ctx.bezierCurveTo(
      halfW * 0.46 * sx, dn(0.0032),
      -halfW * 0.50 * sx, dn(0.0034),
      -halfW * 0.9 * sx, tiltPx * side,
    );
    ctx.stroke();
    ctx.restore();
  }

  /* ── lips (deliberately not painted) ─────────────────────────────
     This atlas already carries a complete mouth: cupid's bow, vermilion,
     the darker stomion and a wet lower-lip sheen. Drawing a second lip
     shape over it produced a doubled mouth — and the reason is geometric,
     not cosmetic. `ATLAS_FIT` maps `LANDMARK.mouth` (−0.0902) to atlas row
     590, but every one of the six UBE skins paints its stomion at row
     604–615 (measured per skin; Sayble at 608). So the vector wash sat
     ~9 mm above the real lip and its "lip line" stroke landed across the
     top edge of the upper lip — the hard dark bar in the review frame.

     The wash is therefore gone rather than re-tuned. What is left is a
     colour pass, applied per pixel during the resample in `buildFaceTexture`
     where the *atlas* pixel is in hand: it can only ever tint pixels the
     atlas itself painted as lip, so it is registered by construction and
     adapts to whichever skin is selected. */

  /* ── a scatter of freckles across the nose and cheeks ─────────── */
  {
    let seed = 0x9e3779b1;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    ctx.globalAlpha = 0.22;
    for (let i = 0; i < 120; i++) {
      const cx = (rand() - 0.5) * 0.125;
      const cy = -0.036 - rand() * 0.030;
      // concentrate on the nose and the cheeks, fade at the edge
      const fall = Math.exp(-Math.pow(cx / 0.048, 2) - Math.pow((cy + 0.045) / 0.028, 2));
      if (rand() > fall * 1.5) continue;
      const r = (0.00028 + rand() * 0.0005);
      ctx.beginPath();
      ctx.arc(X(cx), Y(cy), r * KX, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(96,60,42,0.85)';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function smoothstepLocal(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Bilinear sample of an ImageData at fractional pixel coordinates. */
function sampleBilinear(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  fx: number,
  fy: number,
  out: Uint8ClampedArray,
) {
  const x = fx < 0 ? 0 : fx > w - 1 ? w - 1 : fx;
  const y = fy < 0 ? 0 : fy > h - 1 ? h - 1 : fy;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const tx = x - x0;
  const ty = y - y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  out[0] = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
  out[1] = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
  out[2] = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
  out[3] = 255;
}

/**
 * Builds the head albedo by projecting the real Skyrim femalehead diffuse
 * into head-local (x, y) face space. The projection is calibrated to the
 * painted landmarks of the atlas itself: the eye line, the mouth line and
 * the chin all land on their anatomical heights, so the real eyes, brows,
 * lips and pores appear on the mesh where they belong.
 *
 * The head's UVs are the same planar rect, so the front of the face is a
 * 1:1 pixel map of the atlas — no seams, no smearing around the skull.
 */
export async function buildFaceTexture(
  manifest: Mo2Manifest | null,
  overlayImages: OverlayInput[] = [],
): Promise<FaceTextureResult> {
  const src = manifest?.textures?.skin;
  const img = src ? await loadImage(src) : null;
  /* The eye diffuse is a separate atlas in this install (Zhizhen Eyes). The
     head map paints its eyes closed, so the real iris can only come from
     here. Loaded in parallel with the skin and passed to the painter. */
  const eyeSrc = manifest?.textures?.eye;
  const eyeTex = eyeSrc ? await loadImage(eyeSrc) : null;

  const S = FACE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  /* The fit is per-atlas: `ATLAS_FIT` was least-squared against
     `!UBE\Head\femaleHead_d.dds`, and a skin with a different mouth line
     projects ~9 mm high under it. `sync:assets` measures each skin and the
     flattened manifest carries the result; a skin it could not measure falls
     back here and is labelled `ESTIMATED` in the picker. */
  const fit = manifest?.atlasFit ?? ATLAS_FIT;

  const rectW = FACE_RECT.x1 - FACE_RECT.x0;
  const rectH = FACE_RECT.y1 - FACE_RECT.y0;

  const out = ctx.createImageData(S, S);
  const od = out.data;

  if (img) {
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = img.width;
    srcCanvas.height = img.height;
    const sctx = srcCanvas.getContext('2d')!;
    sctx.drawImage(img, 0, 0);

    /* Overlays are painted into the *source* atlas before projection. Doing
       them here, rather than on the projected face, is what registers them:
       tintmasks are authored in femaleHead_d's own UV, so they land where
       Skyrim would put them and move with this skin's fit automatically. */
    if (overlayImages.length) {
      compositeOverlays(sctx, overlayImages, img.width);
      if (manifest?.lipColor) {
        tintLips(sctx, img.width, manifest.lipColor, manifest.lipStrength ?? 0.35);
      }
    }

    const srcData = sctx.getImageData(0, 0, img.width, img.height).data;

    const tmp = new Uint8ClampedArray(4);
    for (let py = 0; py < S; py++) {
      const y = FACE_RECT.y1 - (py / (S - 1)) * rectH;
      const sy = fit.cy + fit.ky * y;
      for (let px = 0; px < S; px++) {
        const x = FACE_RECT.x0 + (px / (S - 1)) * rectW;
        const sx = fit.cx + fit.kx * x;
        sampleBilinear(srcData, img.width, img.height, sx, sy, tmp);
        const o = (py * S + px) * 4;
        od[o] = tmp[0];
        od[o + 1] = tmp[1];
        od[o + 2] = tmp[2];
        od[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);

    /* Grade. The source diffuse is a flat, desaturated brown (mean #675349)
       painted for Skyrim's own lighting; pushed through a warm key it goes
       to brick. So: lift midtones hard, keep the red channel from
       saturating, and pull a little red out of the shadows. Neutral-to-slightly-warm
       skin survives the candlelight rig far better than an amber grade. */
    const frame = ctx.getImageData(0, 0, S, S);
    const d = frame.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255;
      const g = d[i + 1] / 255;
      const b = d[i + 2] / 255;
      /* Lift, then neutralise. The source is a flat brown painted for
         Skyrim's own key light, so an amber grade on top of a warm rig
         lands on terracotta. A gamma lift alone crushes the painted mouth
         into a black smear, so the low end is pulled up separately before
         the midtone lift, and the channels are levelled toward each other. */
      /* Grade for display, but keep the atlas's own contrast. The previous
         floor() lifted anything below 0.30 up towards white to rescue the
         shadowed lip paint — but it also lifted the painted irises, lash
         lines and brow hair (all legitimately dark) to mid-grey, so the face
         rendered as a featureless mask. A gentle gamma plus a mild black-point
         lift is enough: it opens the shadows without flattening the features
         the atlas is there to provide. */
      /* Grade for display, keeping the atlas's own contrast.

         This used to neutralise 40 % toward the per-pixel mean (`desat`), apply
         a gamma lift, and then run a *second* full-image `pow(·, 0.92)` in the
         shadow rescue below. Two compounding lifts on top of a 40 %
         desaturation is what made the bake read as a pale grey mask: the
         rendered cheek measured [99,92,86] (r − b = 13) against the reference's
         lit cheek [168,147,133] (r − b = 35). The desaturation is gone, there is
         one lift instead of two, and the gains are lifted per channel to put
         the warmth back: on the atlas's own [147,121,100] this chain gives
         [165,155,141] where the old one gave [152,137,127]. */
      const lift = (v: number) => Math.pow(Math.max(0, (v - 0.010) / 0.990), 0.78);
      /* Re-tuned against the render, not the atlas. At 1.00 / 1.10 / 1.16 the
         lit cheek measured [158,145,137] — r − b = 21 where the reference's
         [168,147,133] is 35. The blue gain was doing the damage: it lifted
         exactly the channel the warmth is measured against. Now 1.02 / 1.09 /
         1.09, the render is a little brighter and visibly less grey. */
      d[i] = clamp255(lift(r) * 1.02 * 255);
      d[i + 1] = clamp255(lift(g) * 1.09 * 255);
      d[i + 2] = clamp255(lift(b) * 1.09 * 255);
    }
    ctx.putImageData(frame, 0, 0);
  } else {
    const g = ctx.createRadialGradient(S * 0.5, S * 0.42, 0, S * 0.5, S * 0.5, S * 0.72);
    g.addColorStop(0, '#c8a893');
    g.addColorStop(0.6, '#b09280');
    g.addColorStop(1, '#7d6455');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }

  /* Shadow rescue. The painted face carries deep permanent shading around the
     eye sockets and the mouth because Skyrim adds its own; under a three-point
     rig that shading doubles up into a black mask. Lift only the low end — a
     soft floor under the darks, no change to the highlights.

     Capped at 0.16 over a 0–0.20 range, and *not* gamma'd: the old version
     reached 0.30 of the distance to white and then applied `pow(·, 0.92)` to
     the whole image on top of the grade's own lift, which together flattened
     every painted feature (irises, lash line, brow hair) into the mid-tones. */
  const rescue = ctx.getImageData(0, 0, S, S);
  const rd = rescue.data;
  for (let i = 0; i < rd.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = rd[i + c] / 255;
      const t = 1 - Math.min(1, Math.max(0, v / 0.20));
      rd[i + c] = clamp255((v + 0.16 * t * t) * 255);
    }
  }
  ctx.putImageData(rescue, 0, 0);

  /* The mod's diffuse has closed eyes and no brows, so the features are
     painted over the graded skin. Order matters: after the grade, so the
     lift does not wash them out, and before the sharpen, so the pores
     multiply over the paint and sit it in the skin. */
  paintFaceFeatures(
    ctx,
    S,
    FACE_RECT,
    eyeTex,
    manifest?.eye?.iris ?? '#6f7d68',
    manifest?.eye?.atlas ?? EYE_ATLAS,
  );

  // sharpen so the upscaled pores still bite under the normal-mapped light
  ctx.save();
  ctx.globalAlpha = 0.26;
  ctx.globalCompositeOperation = 'overlay';
  ctx.filter = 'contrast(1.14) saturate(1.02)';
  ctx.drawImage(canvas, 0, 0);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  return {
    texture,
    canvas,
    landmarks: {
      irisL: [-IRIS_X, LANDMARK.eye],
      irisR: [IRIS_X, LANDMARK.eye],
      lip: [0, LANDMARK.mouth],
    },
  };
}

/**
 * Projects the skin mod's own tangent-space `femalehead_n.dds` through the
 * same affine map as the albedo, and returns it as a `normalMap`.
 *
 * The atlas normal is authored for the *Skyrim head UV shell*, not for our
 * planar face rect, so it cannot be used raw — but because the projection is
 * affine it is also not a screen-space bump that has to be rebuilt. Resampling
 * a normal through an affine UV→face map rescales the tangent frame: with
 * `k = hypot(kx, ky)` the U and V image axes stretch by `kx/k` and `|ky|/k`, so
 * the vector has to be divided by those factors and renormalised. (The sign of
 * `ky` is negative — the atlas V axis ascends as head y descends — which
 * flips the V tangent, so `ny` keeps its sign while the V axis does not.)
 *
 * Output is `NoColorSpace`: R/G/B here are the vector's x/y/z, not colour. If
 * this were tagged sRGB three would apply an EOTF to it and bend every
 * normal, which is exactly the "faceting under a specular light" failure real
 * normal maps are transcoded losslessly to avoid.
 */
export async function buildProjectedNormal(
  manifest: Mo2Manifest | null,
): Promise<THREE.CanvasTexture | null> {
  const src = manifest?.textures?.normal;
  if (!src) return null;
  const img = await loadImage(src);
  if (!img) return null;

  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(S, S);
  const od = out.data;

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = img.width;
  srcCanvas.height = img.height;
  const sctx = srcCanvas.getContext('2d')!;
  sctx.drawImage(img, 0, 0);
  const srcData = sctx.getImageData(0, 0, img.width, img.height).data;

  const rectW = FACE_RECT.x1 - FACE_RECT.x0;
  const rectH = FACE_RECT.y1 - FACE_RECT.y0;
  /* Same fit as the albedo, or the relief and the paint slide apart. */
  const fit = manifest?.atlasFit ?? ATLAS_FIT;
  const kNorm = Math.hypot(fit.kx, fit.ky);
  const ku = fit.kx / kNorm;
  const kv = Math.abs(fit.ky) / kNorm;

  const tmp = new Uint8ClampedArray(4);
  for (let py = 0; py < S; py++) {
    const y = FACE_RECT.y1 - (py / (S - 1)) * rectH;
    const sy = fit.cy + fit.ky * y;
    for (let px = 0; px < S; px++) {
      const x = FACE_RECT.x0 + (px / (S - 1)) * rectW;
      const sx = fit.cx + fit.kx * x;
      sampleBilinear(srcData, img.width, img.height, sx, sy, tmp);
      let nx = (tmp[0] / 255) * 2 - 1;
      let ny = (tmp[1] / 255) * 2 - 1;
      let nz = (tmp[2] / 255) * 2 - 1;
      nx /= ku;
      ny /= kv;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (py * S + px) * 4;
      od[o] = clamp255((nx * 0.5 + 0.5) * 255);
      od[o + 1] = clamp255((ny * 0.5 + 0.5) * 255);
      od[o + 2] = clamp255((nz * 0.5 + 0.5) * 255);
      od[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Sobel height-to-normal derived from the albedo luminance.
 *
 * This is a *head-space* bump, used only as a fallback when the selected skin
 * has no `_n.dds` — it is a stand-in for relief, not a tangent-space normal
 * map, and feeding it to `normalMap` for its own sake would be a category
 * error. It goes through `normalMap` anyway because `MeshStandardMaterial` has
 * no other relief input at this tier, and because the Sobel of a pore is
 * approximately the pore's own normal at this frequency.
 */
export function buildDetailTexture(albedo: HTMLCanvasElement): THREE.CanvasTexture {
  const S = 1024;
  const srcC = document.createElement('canvas');
  srcC.width = S;
  srcC.height = S;
  const sctx = srcC.getContext('2d')!;
  sctx.drawImage(albedo, 0, 0, S, S);
  const src = sctx.getImageData(0, 0, S, S).data;

  const out = document.createElement('canvas');
  out.width = S;
  out.height = S;
  const octx = out.getContext('2d')!;
  const dst = octx.createImageData(S, S);
  const od = dst.data;

  const lum = new Float32Array(S * S);
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    lum[p] = (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  }

  const strength = 2.6;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < S - 1 ? x + 1 : S - 1;
      const ym = y > 0 ? y - 1 : 0;
      const yp = y < S - 1 ? y + 1 : S - 1;
      const gx =
        lum[ym * S + xm] + 2 * lum[y * S + xm] + lum[yp * S + xm] -
        (lum[ym * S + xp] + 2 * lum[y * S + xp] + lum[yp * S + xp]);
      const gy =
        lum[ym * S + xm] + 2 * lum[ym * S + x] + lum[ym * S + xp] -
        (lum[yp * S + xm] + 2 * lum[yp * S + x] + lum[yp * S + xp]);
      const nx = gx * strength;
      const ny = gy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const o = (y * S + x) * 4;
      od[o] = clamp255(((nx / len) * 0.5 + 0.5) * 255);
      od[o + 1] = clamp255(((ny / len) * 0.5 + 0.5) * 255);
      od[o + 2] = clamp255(((nz / len) * 0.5 + 0.5) * 255);
      od[o + 3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);

  const t = new THREE.CanvasTexture(out);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Hair atlas → alpha-matted texture (the source has black backing). */
/**
 * Turns the HG Hairdos strand atlas into a *strand mask*: a neutral grey
 * ribbon on transparent, and the card material supplies the actual hair
 * colour.
 *
 * Keeping the atlas's own beige albedo was the bug — it is a near-white block
 * of lit strands, so every card painted as a cream sheet no matter what
 * `material.color` was set to. A grey mask lets the dark brown tint drive the
 * colour while the atlas still controls the strand detail and the fringe.
 *
 * The alpha comes from the DDS's own alpha channel when the transcode shipped
 * one, which is the real card shape. Deriving it from luminance instead — the
 * fallback for an atlas with no transparency — made `Emmy` a solid slab: its
 * windows are bright everywhere, so every pixel cleared the ramp.
 */
export function buildHairTexture(src: HTMLImageElement | null): THREE.CanvasTexture | null {
  if (!src) return null;
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0, S, S);
  const frame = ctx.getImageData(0, 0, S, S);
  const d = frame.data;

  /* Browsers ignore a PNG/WebP alpha channel when they draw onto a canvas —
     it lands premultiplied against whatever was there — so read it back in a
     second pass and decide from that. If no pixel is translucent the atlas
     shipped opaque and the luminance ramp is the only signal available. */
  let hasAlpha = false;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 250) {
      hasAlpha = true;
      break;
    }
  }

  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
    /* Softened from (l − 0.22)/0.42. The steep ramp kept enough mid-tones
       below the alpha cutoff that the strips clipped into a comb; a wider,
       lower ramp lets the strand edges keep their falloff so the fringe
       reads as a mass with individual tips rather than a row of scratches. */
    const a = hasAlpha ? d[i + 3] / 255 : clamp01((l - 0.18) / 0.5);
    const shade = clamp255((0.3 + 0.7 * Math.pow(l, 0.9)) * 255);
    d[i] = shade;
    d[i + 1] = shade;
    d[i + 2] = shade;
    d[i + 3] = clamp255(a * 255);
  }
  ctx.putImageData(frame, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  /* The scalp shell tiles one small solid block across the whole skull (see
     `capUv` in lib/head/hair.ts); with the default clamp its UVs would all
     collapse onto the block's last row and the shell would smear. The cards
     stay inside 0–1, so repeating costs them nothing. */
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

export { clamp01 };
