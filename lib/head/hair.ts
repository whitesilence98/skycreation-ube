import { DEFAULT_HAIR, shiftTone, type HairSettings } from '@/lib/hair/settings';
import * as THREE from 'three';
import {
  LANDMARK,
  headSurfaceZ,
  headPointAt,
  smoothstep,
  type HeadBuild,
} from '@/lib/head/geometry';

/**
 * Hair is built as textured cards projected onto an ellipsoid skull. The
 * strand texture is the HG Hairdos diffuse atlas shipped with the mod, so
 * the silhouette and the strand shading both come from the real asset.
 */

interface CardStrip {
  group?: HairGroup;
  /** Path in (x, y) head-local space, root → tip. */
  points: Array<[number, number]>;
  /** Card width in metres, root → tip. */
  width0: number;
  width1: number;
  /** How far off the skull the card floats. */
  offset: number;
  /** Atlas sub-rect for the strand block (must sit inside a lit block). */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /**
   * Mirror across the YZ plane. The side curtains and the wisp are authored
   * on one side only; the bang strips already span both sides of the
   * hairline, so mirroring them would double them up over the same face.
   */
  mirror?: boolean;
  /**
   * `points` are (theta, y) pairs around the skull rather than (x, y), and
   * `width0/1` are angular spans in radians.
   */
  angular?: boolean;
  /**
   * Brightness multiplier written into the card's vertex colours, root → tip.
   * The cards share one material, so without this they are nine identical
   * #2b211a ribbons stacked on the same shell — which is exactly the "one
   * black mass" read. Varying each card, and lightening toward the tips,
   * is what gives the fringe depth under the rim light.
   */
  shade0?: number;
  shade1?: number;
}

const skullZ = (x: number, y: number, extra = 0) => headSurfaceZ(x, y, extra);

/**
 * Side hair, in *angular* head coordinates: `theta` is the around-the-head
 * angle (0 = straight ahead, +π/2 = the character's left ear) and `y` is
 * height.
 *
 * Authoring these in (x, y) was the recurring bug. A path from the hairline
 * to the side of the jaw passes outside the skull's half-width partway down;
 * `headSurfaceZ` then clamps and the card's root ends up draped across the
 * forehead — the heavy dark arc. In angular form the path is always on the
 * skull, and the band's width is an angular span, so it wraps the head
 * instead of cutting across it.
 */
const CURTAIN_SIDE: Array<[number, number]> = [
  /* Start behind the temple. At theta ≈ 1.0 the card hangs beside the
     forehead and reads as an arch across it; it belongs at the ear line,
     falling past the cheek.

     Pushed a further 0.09 rad back from the ear line: at 1.44 the inner edge
     of the 0.118 rad band still landed on the cheek and threw a hard shade
     down the viewer's right side, which measured [108,88,79] against the
     reference's [168,147,132]. Past θ ≈ 1.53 the band hangs off the face. */
  [1.53, 0.0935],
  [1.63, 0.0702],
  [1.70, 0.0402],
  [1.74, 0.0062],
  [1.76, -0.0308],
  [1.76, -0.0682],
  [1.73, -0.1052],
  [1.68, -0.1422],
  [1.62, -0.1782],
  [1.55, -0.2102],
  [1.49, -0.2402],
];

/** The matching band a little further round the back. */
const CURTAIN_BACK: Array<[number, number]> = [
  [2.02, 0.0862],
  [2.16, 0.0632],
  [2.28, 0.0332],
  [2.36, -0.0005],
  [2.40, -0.0372],
  [2.40, -0.0742],
  [2.36, -0.1102],
  [2.29, -0.1462],
  [2.21, -0.1812],
  [2.12, -0.2122],
  [2.03, -0.2422],
];

/** Shifts an angular curtain path around the skull by `dTheta` radians. */
function offsetCurtain(
  src: Array<[number, number]>,
  dTheta: number,
): Array<[number, number]> {
  return src.map(([th, y]) => [th + dTheta, y] as [number, number]);
}

/**
 * One bang strip hanging from the hairline down to `tipY`.
 *
 * The earlier fringe was a single 8.4 cm-wide swept card, mirrored — so two
 * near-metre-wide sheets met over the forehead and the whole face read as a
 * cream slab. A set of narrow strips reads as hair, leaves the face visible,
 * and gives the bangs individual tips the way the reference does.
 */
function fringeStrip(x: number, tipY: number, tipX = x): Array<[number, number]> {
  const rootY = 0.1055;
  const pts: Array<[number, number]> = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = rootY + (tipY - rootY) * t;
    /* Sweep out to `tipX` along a shallow curve: the strand leaves the part
       heading outward, then falls. A straight line from root to tip gave the
       fringe a hard fan of identical diagonals. */
    const xAt = x + (tipX - x) * Math.pow(t, 0.72);
    pts.push([xAt, y]);
  }
  return pts;
}

/**
 * One fine wisp crossing the outer corner of the right eye.
 *
 * It must start out at the hairline, not on the midline: rooted at x ≈ 0 it
 * swept diagonally down across the whole brow and, at card width, painted a
 * thick dark arch — the defect that survived several rounds of hair fixes.
 */
const WISP: Array<[number, number]> = [
  [0.0305, 0.0902],
  [0.0362, 0.0802],
  [0.0422, 0.0662],
  [0.0472, 0.0492],
  [0.0505, 0.0302],
  [0.0522, 0.0102],
  [0.0525, -0.0092],
  [0.0505, -0.0252],
  [0.0382, -0.0412],
];

/**
 * Eighteen single-strand flyaways around the silhouette.
 *
 * The cheapest cue that hair is made of individual hairs rather than one
 * surface: at this framing a strand that leaves the mass and catches the rim
 * light is what separates "a hairstyle" from "a shell". Each is a 1.2–2.4 mm
 * card floating 12.5 mm off the skull, rooted on the hairline and falling
 * 8–20 mm outside the head's half-width.
 *
 * Deterministic, not random per build: a Math.random() here would re-scatter
 * the silhouette on every hot reload and make the render impossible to
 * compare against the previous one.
 */
function flyaways(): CardStrip[] {
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const out: CardStrip[] = [];
  for (let k = 0; k < 18; k++) {
    /* Rooted at the temples and behind the ears — θ ≈ 1.15 to 2.55 rad, i.e.
       the sides and the back. `θ = 0` is straight ahead, so rooting them
       anywhere near it paints 18 dark strands across the forehead; that was
       the ink-splatter in the first render of this function. Alternates
       sides so the silhouette stays symmetric. */
    const side = k % 2 === 0 ? 1 : -1;
    const th0 = side * (1.18 + ((k >> 1) / 8) * 1.30);
    const drift = (rand() - 0.5) * 0.10;
    const drop = 0.075 + rand() * 0.115;
    const flare = (0.06 + rand() * 0.16) * side;
    const pts: Array<[number, number]> = [];
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      /* Falls and drifts outward, away from the skull, so the tip clears the
         silhouette instead of lying on it. */
      pts.push([th0 + drift * t + flare * t * t, 0.0985 - drop * t]);
    }
    const w = 0.0006 + rand() * 0.0006;
    out.push({
      points: pts,
      width0: w,
      width1: w * 0.45,
      offset: 0.0125,
      u0: 0.455,
      u1: 0.477,
      v0: 0.60 + rand() * 0.12,
      v1: 0.86,
      angular: true,
    });
  }
  return out;
}

/* The atlas is a grid of strand blocks separated by black gutters, measured
   at 1024² as x ∈ [0.009,0.151] [0.164,0.275] [0.300,0.362] [0.384,0.417]
   [0.447,0.483] [0.542,0.603] [0.645,0.679] and y ∈ [0.056,0.531]
   [0.580,0.882]. Every card rect is inset inside a lit block, so no card
   ever samples a gutter — that was the black wedges in the earlier pass. */
const CARDS: CardStrip[] = [
  /* Side curtains. Measured on the silhouette: at y = −0.05 the head is only
     x ≈ 0.074 wide, i.e. θ ≈ 1.10 rad. A single card centred at θ 1.44 with a
     0.30 rad half-width therefore had its *inner* edge on the cheek, and at
     the top of its path (smaller rx) it wrapped onto the brow — the flat grey
     ribbon across the face. Three narrow cards per side, centred at θ 1.42 /
     1.78 / 2.04 with a 0.12 rad half-width, keep every inner edge past
     θ ≈ 1.29, clear of the cheek, and build a curtain with visible strand
     separation instead of one smooth sheet. */
  { points: CURTAIN_SIDE, width0: 0.108, width1: 0.116, offset: 0.0085, u0: 0.530, u1: 0.617, v0: 0.60, v1: 0.87, mirror: true, angular: true },
  { points: offsetCurtain(CURTAIN_SIDE, 0.34), width0: 0.105, width1: 0.114, offset: 0.0102, u0: 0.632, u1: 0.733, v0: 0.60, v1: 0.87, mirror: true, angular: true },
  { points: CURTAIN_BACK, width0: 0.120, width1: 0.128, offset: 0.0078, u0: 0.741, u1: 0.833, v0: 0.60, v1: 0.87, mirror: true, angular: true },

  /* Bangs, swept from a centre part.
     Widening the atlas window to ~20% of the texture (an earlier attempt at
     "more mass") turned the fringe into a solid slab, because at that width
     every strip samples the same bright interior of one lit block. These keep
     a narrow window — so each card still shows individual strands — but *fan
     out from the part*: each strand leaves x ≈ 0 heading outward and falls
     short of the next, and the tips are staggered by 1–2 cm so the hairline of
     the fringe is ragged rather than a ruler edge.

     The window moved from `u 0.392–0.420` to `u 0.264–0.288`. Measured on the
     shipped 90sBebe atlas, the old window is **81 % covered at alphaTest 0.18**
     (68 % even at 0.42) with visible-luma sd 0.09 — an opaque ribbon, which is
     the flat brown sheet in the viewport. The new band measures cover
     0.70/0.56 with column sd **0.39**, and is ~30 % darker in luma, which alone
     removes the cream-slab read. Each strip is offset by ~0.003 u so they do
     not all sample one strand. */
  { points: fringeStrip(-0.006, 0.018, -0.074), width0: 0.026, width1: 0.031, offset: 0.0084, u0: 0.264, u1: 0.281, v0: 0.09, v1: 0.50, shade0: 0.55, shade1: 0.98 },
  { points: fringeStrip(-0.001, 0.006, -0.062), width0: 0.027, width1: 0.032, offset: 0.0079, u0: 0.267, u1: 0.284, v0: 0.08, v1: 0.52, shade0: 0.62, shade1: 1.06 },
  { points: fringeStrip(-0.002, 0.004, -0.052), width0: 0.027, width1: 0.032, offset: 0.0086, u0: 0.267, u1: 0.284, v0: 0.08, v1: 0.52, shade0: 0.66, shade1: 1.14 },
  { points: fringeStrip(0.000, 0.030, -0.035), width0: 0.027, width1: 0.032, offset: 0.0087, u0: 0.270, u1: 0.287, v0: 0.10, v1: 0.48, shade0: 0.50, shade1: 0.90 },
  { points: fringeStrip(0.001, 0.011, -0.019), width0: 0.027, width1: 0.033, offset: 0.0092, u0: 0.273, u1: 0.288, v0: 0.08, v1: 0.51, shade0: 0.76, shade1: 1.28 },
  /* the part itself: a short strand either side of centre, barely falling */
  { points: fringeStrip(0.002, 0.052, -0.006), width0: 0.024, width1: 0.028, offset: 0.0095, u0: 0.264, u1: 0.280, v0: 0.12, v1: 0.46, shade0: 0.44, shade1: 0.74 },
  { points: fringeStrip(0.004, 0.049, 0.014), width0: 0.024, width1: 0.028, offset: 0.0095, u0: 0.266, u1: 0.282, v0: 0.12, v1: 0.46, shade0: 0.44, shade1: 0.74 },
  { points: fringeStrip(0.005, 0.012, 0.030), width0: 0.027, width1: 0.033, offset: 0.0092, u0: 0.271, u1: 0.288, v0: 0.08, v1: 0.51, shade0: 0.76, shade1: 1.28 },
  { points: fringeStrip(0.006, 0.031, 0.047), width0: 0.027, width1: 0.032, offset: 0.0088, u0: 0.268, u1: 0.285, v0: 0.10, v1: 0.48, shade0: 0.50, shade1: 0.90 },
  { points: fringeStrip(0.009, 0.007, 0.068), width0: 0.026, width1: 0.031, offset: 0.0084, u0: 0.265, u1: 0.282, v0: 0.08, v1: 0.52, shade0: 0.62, shade1: 1.06 },
  { points: fringeStrip(0.011, 0.021, 0.076), width0: 0.025, width1: 0.030, offset: 0.0079, u0: 0.268, u1: 0.285, v0: 0.09, v1: 0.50, shade0: 0.55, shade1: 0.98 },

  /* A face-framing strand, and the one card that sits over skin rather than
     hair — so its width is what decides whether it reads as a wisp or as a
     dark ribbon painted on the cheek. At 5→9 mm it was the latter: a solid
     brown band from the brow to the jaw. 1.8→3.2 mm still catches the light
     and still frames the face, but the cheek shows either side of it. */
  { points: WISP, width0: 0.0018, width1: 0.0032, offset: 0.0092, u0: 0.455, u1: 0.477, v0: 0.60, v1: 0.87 },
];

/** Mirrors a card across the YZ plane, reversing the atlas block. */
function mirrorCard(c: CardStrip): CardStrip {
  return {
    ...c,
    points: c.points.map(([a, y]) => [-a, y] as [number, number]),
    u0: c.u0,
    u1: c.u1,
    offset: c.offset * 1.03,
    mirror: false,
  };
}

export interface HairBuild {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** Opaque scalp shell; drawn separately from the alpha-masked cards. */
  capGeometry: THREE.BufferGeometry;
  capMaterial: THREE.MeshStandardMaterial;
}

/** The atlas rectangle every card rect in `CARDS` was measured inside. */
const ENVELOPE = { u0: 0.264, u1: 0.833, v0: 0.08, v1: 0.87 };

/** A per-atlas strand block, `[u0, u1, v0, v1]`. */
export type HairWindow = [number, number, number, number];

/** Which group a card belongs to, for the per-atlas block remap. */
type HairGroup = 'curtain' | 'fringe' | 'wisp';

/**
 * The block each group is fitted to on a given atlas.
 *
 * Hair atlases are not one layout scaled: Regina carries seven separate strand
 * blocks, Kiki four, Cicada three. Fitting all thirteen cards to one rect drags
 * most of them onto blank space, so `sync:assets` scores every block against
 * every group and records the winner per group. Absent keys keep the authored
 * rects — the atlas already puts strands where they belong.
 */
export type HairGroups = Partial<Record<HairGroup, HairWindow>>;

/** The canonical scalp-shell rect — 90sBebe's measured opaque block. */
const CAP_RECT = { u0: 0.020, u1: 0.110, v0: 0.220, v1: 0.500 };

/** The authored rect each group occupies, i.e. what `CARDS` were measured in. */
const GROUP_ENV: Record<HairGroup, { u0: number; u1: number; v0: number; v1: number }> = {
  curtain: { u0: 0.530, u1: 0.833, v0: 0.60, v1: 0.87 },
  fringe: { u0: 0.264, u1: 0.288, v0: 0.08, v1: 0.52 },
  wisp: { u0: 0.455, u1: 0.477, v0: 0.60, v1: 0.87 },
};

/**
 * Re-maps a card's canonical atlas rect into an atlas-specific block.
 *
 * Preserves the card's offset *inside its group*, so the nine fringe strips
 * keep the staggered arrangement they were authored with — a strip near the
 * left edge stays near the left edge, and neighbours stay neighbours. Only the
 * enclosing block changes.
 */
function mapRect(
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  env: { u0: number; u1: number; v0: number; v1: number },
  win: HairWindow,
): [number, number, number, number] {
  const [wu0, wu1, wv0, wv1] = win;
  const nu0 = wu0 + ((u0 - env.u0) / (env.u1 - env.u0)) * (wu1 - wu0);
  const nu1 = wu0 + ((u1 - env.u0) / (env.u1 - env.u0)) * (wu1 - wu0);
  const nv0 = wv0 + ((v0 - env.v0) / (env.v1 - env.v0)) * (wv1 - wv0);
  const nv1 = wv0 + ((v1 - env.v0) / (env.v1 - env.v0)) * (wv1 - wv0);
  return [nu0, nu1, nv0, nv1];
}

/** Which group a card's authored rect belongs to. */
function groupOf(c: CardStrip): HairGroup {
  if (c.u0 >= 0.53) return 'curtain';
  if (c.u0 < 0.30) return 'fringe';
  return 'wisp';
}

/** The rect a card samples, honouring its group's measured block if any. */
function cardRect(
  c: CardStrip,
  groups: HairGroups | null,
): [number, number, number, number] {
  const g = c.group ?? groupOf(c);
  const win = groups?.[g];
  if (!win) return [c.u0, c.u1, c.v0, c.v1];
  return mapRect(c.u0, c.u1, c.v0, c.v1, GROUP_ENV[g], win);
}

/** A solid atlas block `[u0, u1, v0, v1]` for the scalp shell. */
export type HairCapWindow = [number, number, number, number];

function capRect(win: HairCapWindow | null) {
  if (!win) return CAP_RECT;
  const [u0, u1, v0, v1] = win;
  return { u0, u1, v0, v1 };
}

/**
 * The real head's own surface radius, so the scalp shell can sit on it.
 *
 * The shell used to be lofted with `headPointAt` — the *procedural* skull.
 * That is the wrong surface whenever the viewport wears a real `.tri` head,
 * and it was 9 mm too wide at the temples (rx 0.0765 against the UBE head's
 * 0.0673 at y = 0.090) and 11 mm too short at the crown (0.1288 against
 * 0.1385). The result read as a smooth dome floating over the skull with its
 * rim standing off the temples — the round shape on top of the head.
 *
 * A blend of neighbouring vertex *positions* was tried first and is wrong: a
 * real head mesh covers only about half of its (theta, y) bins, and averaging
 * over a partly empty neighbourhood pulls the result inward — at ear height it
 * returned a 2 mm radius where the skull is 76 mm. Averaging positions across
 * a hull also cuts its corners. So each bin keeps the farthest-from-axis
 * radius, and a query takes the **maximum** over a small angular window: that
 * can only ever sit outside the head, never inside it, however sparse the
 * mesh is over the ears and the nape. Blending happens in y, where the rows
 * are dense enough to interpolate cleanly.
 */
interface CapProfile {
  /** Radius of the head at (theta, y), or null where the mesh has no coverage. */
  radiusAt(theta: number, y: number): number | null;
  /** Top of the real mesh — the shell closes here, not at the loft's crown. */
  yTop: number;
}

const PROFILE_T = 96;
const PROFILE_Y = 96;
/** Angular half-window, in bins, searched for the outermost vertex. */
const PROFILE_SPREAD = 2;

export function buildCapProfile(build: HeadBuild | null): CapProfile | null {
  const p = build?.basePositions;
  if (!p || p.length < 900) return null; // < 300 vertices: nothing to sample

  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 1; i < p.length; i += 3) {
    const y = p[i];
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const ySpan = Math.max(1e-6, yMax - yMin);

  const bins = new Float32Array(PROFILE_T * PROFILE_Y);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const z = p[i + 2];
    const r = Math.hypot(x, z);
    const ti = Math.min(
      PROFILE_T - 1,
      Math.max(0, Math.floor((Math.atan2(x, z) / (Math.PI * 2) + 0.5) * PROFILE_T)),
    );
    const yi = Math.min(
      PROFILE_Y - 1,
      Math.max(0, Math.floor(((y - yMin) / ySpan) * (PROFILE_Y - 1))),
    );
    const bi = ti * PROFILE_Y + yi;
    if (r > bins[bi]) bins[bi] = r;
  }

  return {
    yTop: yMax,
    radiusAt(theta, y) {
      const u = Math.round((theta / (Math.PI * 2) + 0.5) * PROFILE_T);
      const v = ((y - yMin) / ySpan) * (PROFILE_Y - 1);
      const v0 = Math.floor(v);
      const fv = v - v0;

      const atRow = (yi: number): number => {
        if (yi < 0 || yi >= PROFILE_Y) return 0;
        let m = 0;
        for (let d = -PROFILE_SPREAD; d <= PROFILE_SPREAD; d++) {
          const ti = ((u + d) % PROFILE_T + PROFILE_T) % PROFILE_T;
          const r = bins[ti * PROFILE_Y + yi];
          if (r > m) m = r;
        }
        return m;
      };

      const r0 = atRow(v0);
      const r1 = atRow(v0 + 1);
      // Interpolate only when both rows know the surface; a half-empty pair
      // would average toward zero and sink the shell into the skull.
      if (r0 > 0 && r1 > 0) return r0 + (r1 - r0) * fv;
      const r = r0 || r1;
      return r > 0 ? r : null;
    },
  };
}

export function buildHairCap(
  texture: THREE.Texture | null,
  capWindow: HairCapWindow | null = null,
  profile: CapProfile | null = null,
  bangs: HairSettings['bangs'] = DEFAULT_HAIR.bangs,
): { capGeometry: THREE.BufferGeometry; capMaterial: THREE.MeshStandardMaterial } {
  const cap = capRect(capWindow);

  const capPos: number[] = [];
  const capUv: number[] = [];
  const capIdx: number[] = [];

  /* Hair cap: a skull-hugging shell covering the scalp above the hairline.
     Without it the crown and temples are bare skin, which reads as a bald
     mannequin however good the fringe cards are.

     Built from the head's own ring table (`headPointAt`), not a hand-written
     ellipsoid. The ellipsoid constants were ~13% wider than the real loft at
     the hairline, so the rim floated clear of the temple and the open gap
     drew as a heavy dark arch across the forehead.

     It also gets its own opaque geometry and material. Sharing the card
     material meant the strand atlas's alpha — which is a *mask* of individual
     strands with real holes between them — punched through the scalp shell,
     so half the cap vanished and the gap read as an arch. */
  {
    const RINGS = 24;
    const SEGS = 64;
    /* Sit on the real crown when there is one. The loft's crown is 9 mm below
       a real head's, which is exactly the gap that showed bare scalp above the
       shell; the profile's own top closes that. */
    const yTop = (profile ? profile.yTop : LANDMARK.crown) - 0.002;

    /* The rim is *not* a level ring. A constant-height rim cuts the forehead
       off with a dead-straight horizontal edge, which reads as a seam — the
       bright band across the brow. It has to sweep: highest over the front of
       the forehead, dropping at the temples and carrying on down the back of
       the skull toward the nape, the way a real hairline does. */
    /* Carried 10 mm below the hairline rather than ending at it. The fringe
       cards root at y 0.1055 and their alpha mask opens holes right under the
       rim — so a rim sitting exactly on the hairline leaves a bright band of
       forehead between the cap and the first solid strand, which reads as a
       receding hairline against a pale dome. Hair in front of the face lies
       *over* the forehead, so the shell has to go past the hairline too. */
    const yBotFront = LANDMARK.hairline + (bangs === 'none' ? 0.002 : -0.0145);
    const yBotBack = -0.062;
    const yBotAt = (theta: number) => {
      const back = (1 - Math.cos(theta)) * 0.5; // 0 at the face, 1 at the nape
      // temple recession: the front corners sit lower than the brow centre
      const temple = Math.exp(-Math.pow((Math.abs(Math.sin(theta)) - 0.55) / 0.30, 2));
      return yBotFront - 0.0105 * temple * (1 - back) + (yBotBack - yBotFront) * Math.pow(back, 1.25);
    };

    for (let ri = 0; ri <= RINGS; ri++) {
      const t = ri / RINGS;
      /* Never taper to zero: flush with the skin, the shell and the face
         occupy the same depth and z-fight into a dark band along the
         hairline. Just under a millimetre is sub-pixel at this framing but
         orders of magnitude outside the depth buffer's noise. */
      const inflate = 0.0009 + 0.0032 * (1 - smoothstep(0.45, 1, t));

      for (let si = 0; si <= SEGS; si++) {
        const th = (si / SEGS) * Math.PI * 2;
        const y = yTop + (yBotAt(th) - yTop) * t;
        /* The shell is a *shrink-wrap*: the real surface radius, pushed a
           fraction of a millimetre out so it does not z-fight. `headPointAt` is
           only the fallback for heights the mesh does not cover. */
        const r = profile?.radiusAt(th, y);
        if (r !== null && r !== undefined) {
          const [px, , pz] = headPointAt(th, y, 0);
          const base = Math.hypot(px, pz) || 1;
          const k = (r + inflate + 0.0004) / base;
          capPos.push(px * k, y, pz * k);
        } else {
          const [x, yy, z] = headPointAt(th, y, inflate);
          capPos.push(x, yy, z);
        }
        /* The shell never samples the *strand* window — that block is mostly
           holes by definition, and an `alphaTest: 0` material over holes
           paints a bare skull. `capWindow` is the atlas's own solid block,
           scored on coverage alone; without one it keeps the canonical rect.

           It is **tiled**, not stretched. The block is about a tenth of the
           atlas across and the shell is the whole scalp, so sampling it once
           magnified the fibre grain ~10× and averaged it into a smooth brown
           dome — the round shape on top of the head. Repeating the block keeps
           the grain at roughly its authored scale, so the shell reads as hair
           rather than as untextured skin. `cap.u0 == cap.u1` is impossible for
           a measured block, but guard the divide anyway. */
        const spanU = Math.max(1e-4, cap.u1 - cap.u0);
        const spanV = Math.max(1e-4, cap.v1 - cap.v0);
        const tileU = Math.max(1, Math.round(1 / spanU));
        const tileV = Math.max(1, Math.round(1 / spanV));
        capUv.push(
          cap.u0 + spanU * (si / SEGS) * tileU,
          cap.v0 + spanV * t * tileV,
        );
      }
    }

    const stride = SEGS + 1;
    for (let ri = 0; ri < RINGS; ri++) {
      for (let si = 0; si < SEGS; si++) {
        const a = ri * stride + si;
        const b = ri * stride + si + 1;
        const c = (ri + 1) * stride + si;
        const d = (ri + 1) * stride + si + 1;
        capIdx.push(a, c, b, b, c, d);
      }
    }

    /* Close the crown with a fan. Until this existed the shell was a tube open
       at the top: its first ring sits at `yTop`, where the skull is still
       ~30 mm across, so nothing covered the middle of the scalp — a bare,
       smoothly-lit patch of head, which is the "weird round shape" on top.

       The apex is lifted `apexLift` above `yTop` so it sits over the real
       crown rather than cutting a flat disc through it. */
    const apexLift = 0.0075;
    const apex = capPos.length / 3;
    capPos.push(0, yTop + apexLift, 0);
    capUv.push(
      cap.u0 + (cap.u1 - cap.u0) * 0.5,
      cap.v0 + (cap.v1 - cap.v0) * 0.5,
    );
    for (let si = 0; si < SEGS; si++) {
      /* (apex, si, si+1) matches the tube's (a, c, b) with the apex playing
         the upper ring, so the fan's normals face up and out like the rest of
         the shell. The opposite order points them down and inward, and
         `FrontSide` then culls the crown entirely. */
      capIdx.push(apex, si, si + 1);
    }
  }

  const capGeometry = new THREE.BufferGeometry();
  capGeometry.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3));
  capGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(capUv, 2));
  capGeometry.setIndex(capIdx);
  capGeometry.computeVertexNormals();
  capGeometry.computeBoundingSphere();

  const capMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#17100c'), roughness: 0.62, metalness: 0,
    alphaTest: 0, side: THREE.FrontSide,
  });
  if (texture) capMaterial.map = texture;
  capMaterial.visible = !!texture;
  return { capGeometry, capMaterial };
}

function buildCards(s: HairSettings): CardStrip[] {
  const strips: CardStrip[] = [];
  // Narrow overlapping bands cover the nape; tips never shrink to the chin radius.
  if (s.lengthCm > 0) for (const sign of [-1, 1]) {
    for (let k = 0; k < 9; k++) {
      const rear = k > 3;
      const theta = 1.48 + k * 0.185 + (s.side === 'tucked' && !rear ? 0.24 : 0);
      const length = s.lengthCm * (sign < 0 ? 1 - s.asymmetry * 0.45 : 1)
        * (rear && s.back === 'cropped' ? 0.48 : 1)
        * (s.back === 'layered' ? 0.84 + (k % 3) * 0.08 : 1);
      const rootY = rear ? 0.088 : 0.096;
      const tipY = Math.min(rootY - 0.002, LANDMARK.hairline - length / 100);
      const points: Array<[number, number]> = [];
      for (let j = 0; j <= 28; j++) {
        const t = j / 28;
        const y = rootY + (tipY - rootY) * t;
        const wave = s.curl * 0.012 * t * Math.sin(t * Math.PI * (1 + s.wave * 7));
        const sweep = s.side === 'swept' && !rear ? 0.4 * t : 0;
        points.push([sign * (theta + wave + sweep), y]);
      }
      const uv = CARDS[k % 3];
      strips.push({ ...uv, group: 'curtain', points, mirror: false,
        width0: 0.23 + s.volume * 0.004, width1: 0.24 + s.volume * 0.005,
        offset: 0.009 + (s.volume + 10) * 0.0005 });
    }
  }
  if (s.bangs === 'side') strips.push(...CARDS.slice(3, 14).map((c) => ({ ...c, group: 'fringe' as const })));
  if (s.bangs === 'full') for (let k = 0; k < 13; k++) {
    const x = (k - 6) * 0.010;
    strips.push({ ...CARDS[3 + k % 11], group: 'fringe',
      points: fringeStrip(x * 0.75, LANDMARK.brow + (k % 3) * 0.003, x),
      width0: 0.011, width1: 0.012 });
  }
  strips.push(...flyaways().slice(0, Math.round(s.wispiness * 18)).map((c) => ({
    ...c, group: 'wisp' as const, width0: c.width0 * (0.5 + s.wispiness),
    points: c.points.map(([th, y]) => [th, Math.max(y, LANDMARK.hairline - s.lengthCm / 100)] as [number, number]),
  })));
  return strips;
}

/** Shared measured skull surface, then a continuous free fall outside the neck. */
function cardPoint(theta: number, y: number, offset: number, profile: CapProfile | null): [number, number, number] {
  const anchorY = -0.075;
  const sampleY = Math.max(y, anchorY);
  const p = headPointAt(theta, sampleY, offset);
  const measured = profile?.radiusAt(theta, sampleY);
  const radius = measured == null ? Math.hypot(p[0], p[2]) : measured + offset;
  const drop = Math.max(0, anchorY - y);
  const r = radius + 0.07 * Math.min(drop, 0.18) + 0.025 * Math.max(0, drop - 0.18);
  // ponytail: static hair only; body collision/physics requires an authored groom.
  return [Math.sin(theta) * r, y, Math.cos(theta) * r - 0.12 * drop];
}

export function buildHairCards(
  texture: THREE.Texture | null,
  groups: HairGroups | null = null,
  profile: CapProfile | null = null,
  settings: HairSettings = DEFAULT_HAIR,
): { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial } {
  const pos: number[] = [];
  const uvs: number[] = [];
  const cols: number[] = [];
  const dye: number[] = [];
  const idx: number[] = [];
  const strips = buildCards(settings);

  for (const card of strips) {
    const pts = card.points;
    const n = pts.length;
    const base = pos.length / 3;
    /* This atlas's block for this card, or the authored rect when the atlas
       carries its strands where they were measured. */
    const [cu0, cu1, cv0, cv1] = cardRect(card, groups);

    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const w = (card.width0 + (card.width1 - card.width0) * t) * 0.5;
      const vt = cv1 + (cv0 - cv1) * t; // root → tip runs down the strands

      /* Two vertices per row, so every branch below must push exactly two
         colours. Pushing one before the branch and two inside it (the first
         cut of this) desynchronises `cols` from `pos` and every card after
         the first reads its neighbour's shade. */
      const s0 = card.shade0 ?? 1;
      const s1 = card.shade1 ?? 1;
      const shade = s0 + (s1 - s0) * t;
      const cardIndex = strips.indexOf(card);
      dye.push(t, shade, cardIndex % 2, t, shade, cardIndex % 2);

      if (card.angular) {
        /* (theta, y) form: offset in theta, so the band wraps the skull and
           its width is measured around the head rather than across it. */
        const [th, y] = pts[i];
        const lo = cardPoint(th - w, y, card.offset * 0.92, profile);
        const hi = cardPoint(th + w, y, card.offset * 0.92, profile);
        pos.push(lo[0], lo[1], lo[2]);
        uvs.push(cu0, vt);
        cols.push(shade, shade, shade);
        pos.push(hi[0], hi[1], hi[2]);
        uvs.push(cu1, vt);
        cols.push(shade, shade, shade);
        continue;
      }

      const [x, y] = pts[i];

      // horizontal width vector, in the tangent plane
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(n - 1, i + 1)];
      let tx = next[0] - prev[0];
      let ty = next[1] - prev[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      // perpendicular in the tangent plane
      const px = -ty;
      const py = tx;

      // left edge
      const lx = x + px * w;
      const ly = y + py * w;
      const curlZ = settings.curl * 0.0005 * t * Math.sin(t * Math.PI * (1 + settings.wave * 7));
      pos.push(lx, ly, skullZ(lx, ly, card.offset * 0.92) + curlZ);
      uvs.push(cu0, vt);
      cols.push(shade, shade, shade);

      // right edge
      const rx = x - px * w;
      const ry = y - py * w;
      pos.push(rx, ry, skullZ(rx, ry, card.offset * 0.92) + curlZ);
      uvs.push(cu1, vt);
      cols.push(shade, shade, shade);
    }

    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      const b = base + i * 2 + 1;
      const c = base + (i + 1) * 2;
      const d = base + (i + 1) * 2 + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geometry.setAttribute('hairDye', new THREE.Float32BufferAttribute(dye, 3));
  updateHairColor(geometry, settings);
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  /* Without the strand atlas there is no alpha channel, so `alphaTest`
     rejects nothing and every card paints as an opaque brown ribbon — the
     dark mask that used to sit over the brows. Render nothing instead. */
  /* A **cutout**, not a blend. The strand atlas is an alpha mask, and
     `transparent: true` + `alphaTest 0.18` is the wrong recipe for masked hair:
     it sorts the cards against each other per-object, so nine strips on nearby
     shells blend in draw order and read as one translucent sheet. Alpha-testing
     with `transparent: false` writes depth and lets the z-buffer resolve the
     cards instead. 0.42 is the cut point the atlas itself supports — at 0.18
     the fringe window is 81 % covered, i.e. an opaque ribbon.
     The map is a grey strand mask, so `color` is the hair colour; roughness is
     low enough that the strands catch the rim. */
  const material = new THREE.MeshStandardMaterial({
    /* White, because each card's tint now rides in its vertex colours (see
       `CardStrip.shade0`): nine cards sharing one #2b211a were nine identical
       black ribbons, which is what read as a single ink mass. */
    color: new THREE.Color('#ffffff'),
    vertexColors: true,
    roughness: 0.62 - settings.gloss * 0.35,
    metalness: 0.0,
    transparent: false,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  /* Assigned rather than passed: `map: texture ?? undefined` makes three warn
     "parameter 'map' has value of undefined" on every material rebuild, three
     times per asset select, for a parameter it would have defaulted anyway. */
  if (texture) material.map = texture;
  material.visible = !!texture;

  return { geometry, material };
}

export function updateHairColor(geometry: THREE.BufferGeometry, s: HairSettings): void {
  const dye = geometry.getAttribute('hairDye');
  const colors = geometry.getAttribute('color');
  const root = new THREE.Color(shiftTone(s.tone, s.rootShift));
  const mid = new THREE.Color(shiftTone(s.tone, s.midShift));
  const tip = new THREE.Color(shiftTone(s.tone, s.tipShift));
  const color = new THREE.Color();
  for (let i = 0; i < dye.count; i++) {
    const t = dye.getX(i);
    color.copy(root);
    if (s.gradient) {
      if (t < 0.5) color.lerp(mid, t * 2);
      else color.copy(mid).lerp(tip, t * 2 - 1);
    }
    const shade = dye.getY(i) * (s.highlights && dye.getZ(i) ? 1.25 : 1);
    colors.setXYZ(i, Math.min(1, color.r * shade), Math.min(1, color.g * shade), Math.min(1, color.b * shade));
  }
  colors.needsUpdate = true;
}

export function buildHairGeometry(
  texture: THREE.Texture | null, groups: HairGroups | null = null,
  capWindow: HairCapWindow | null = null, head: HeadBuild | null = null,
  settings: HairSettings = DEFAULT_HAIR,
): HairBuild {
  const profile = buildCapProfile(head);
  const cap = buildHairCap(texture, capWindow, profile, settings.bangs);
  cap.capMaterial.color.set(shiftTone(settings.tone, settings.rootShift)).multiplyScalar(0.35);
  cap.capMaterial.roughness = 0.72 - settings.gloss * 0.35;
  return { ...cap, ...buildHairCards(texture, groups, profile, settings) };
}

