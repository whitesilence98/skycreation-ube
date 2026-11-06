import * as THREE from 'three';

/**
 * Procedural female head, lofted from anatomical cross-sections.
 *
 * Coordinate frame: head-local metres, Y up, Z forward (toward the camera),
 * origin at the head's vertical mid-point. Landmarks follow standard
 * craniofacial proportions measured from the chin:
 *
 *   crown        1.000   y = +0.1288
 *   hairline     0.860   y = +0.0894
 *   brow         0.600   y = +0.0165
 *   eye line     0.470   y = -0.0200
 *   nose tip     0.330   y = -0.0593
 *   subnasale    0.283   y = -0.0725
 *   mouth line   0.220   y = -0.0902
 *   chin         0.000   y = -0.1520
 *
 * Widths follow a bizygomatic breadth of 0.59 × head height.
 */

export const HEAD_TOP = 0.1288;
export const HEAD_CHIN = -0.152;
export const HEAD_HEIGHT = HEAD_TOP - HEAD_CHIN;

/** Landmark heights in head-local metres (single source of truth). */
export const LANDMARK = {
  crown: 0.1288,
  hairline: 0.0894,
  brow: 0.0165,
  eye: -0.02,
  noseRadix: 0.0045,
  noseTip: -0.0593,
  subnasale: -0.0725,
  mouth: -0.0902,
  lowerLip: -0.1015,
  chin: -0.152,
  jawAngle: -0.107,
  ear: -0.0125,
} as const;

/** Horizontal landmark offsets (half-widths) in metres. */
export const WIDTH = {
  eyeX: 0.0318,
  browInner: 0.0135,
  browOuter: 0.0545,
  mouth: 0.0252,
  noseAlar: 0.0189,
  cheek: 0.083,
  jawAngle: 0.0605,
  chin: 0.0285,
  temple: 0.0775,
  crown: 0.0585,
} as const;

export interface HeadCtrl {
  v: number;
  y: number;
  rx: number;
  rz: number;
  cz: number;
  /** Superellipse exponent; > 2 gives a flatter face plane. */
  e: number;
}

/* Rings, crown → chin. `rz` is the half-depth, `cz` shifts the ring
   forward/backward so the back of the skull stays round while the face
   plane stays almost flat. */
export const HEAD_CTRL: HeadCtrl[] = [
  { v: 0.0, y: 0.1288, rx: 0.0, rz: 0.0, cz: -0.004, e: 2.0 },
  { v: 0.04, y: 0.1272, rx: 0.0282, rz: 0.0312, cz: -0.004, e: 2.04 },
  { v: 0.09, y: 0.1215, rx: 0.0478, rz: 0.0538, cz: -0.003, e: 2.1 },
  { v: 0.15, y: 0.1128, rx: 0.0622, rz: 0.0718, cz: -0.002, e: 2.18 },
  { v: 0.22, y: 0.0992, rx: 0.0726, rz: 0.0828, cz: 0.0, e: 2.26 },
  { v: 0.30, y: 0.0822, rx: 0.0778, rz: 0.0882, cz: 0.002, e: 2.30 },
  { v: 0.38, y: 0.0615, rx: 0.0806, rz: 0.0906, cz: 0.004, e: 2.36 },
  /* The mid-face exponent used to peak at 2.6, i.e. r(45°)/r(0) = 0.923 — near
     enough a rounded rectangle, which is what gave the cheeks their slab-sided
     look. A real mid-face is much closer to circular; 2.20 puts r(45°)/r(0) at
     0.85 and lets the light wrap instead of hitting two flat planes. */
  { v: 0.46, y: 0.0392, rx: 0.0822, rz: 0.0918, cz: 0.005, e: 2.36 },
  { v: 0.54, y: 0.0158, rx: 0.0832, rz: 0.0922, cz: 0.005, e: 2.26 },
  { v: 0.62, y: -0.0072, rx: 0.0828, rz: 0.0918, cz: 0.005, e: 2.18 },
  { v: 0.70, y: -0.0308, rx: 0.0792, rz: 0.0902, cz: 0.004, e: 2.16 },
  { v: 0.78, y: -0.0538, rx: 0.0728, rz: 0.0866, cz: 0.002, e: 2.26 },
  { v: 0.85, y: -0.0758, rx: 0.0682, rz: 0.0812, cz: 0.0, e: 2.36 },
  /* The jaw used to taper to rx 0.0288, which rendered as a pointed wedge —
     the single most obvious mismatch against the reference, whose chin is a
     broad soft curve.

     The real defect was not the taper *rate* but where it stopped. The loft
     ended on a 21 mm-radius ring and then dropped onto a 3.5 mm-flat disc, so
     the front silhouette ended in a corner and the cap read as a cut-off base.
     The rings now keep shrinking all the way down (42 → 21 mm over the last
     7 mm) and the pole sits 5 mm below a 21 mm ring, so the closure is a dome.
     `LANDMARK.chin` stays at −0.152 — it anchors the sculpt terms and the
     slider ranges — while the surface itself bottoms out at the pole. */
  { v: 0.89, y: -0.0920, rx: 0.0655, rz: 0.0755, cz: -0.002, e: 2.36 },
  { v: 0.925, y: -0.1060, rx: 0.0605, rz: 0.0690, cz: -0.001, e: 2.32 },
  { v: 0.955, y: -0.1175, rx: 0.0540, rz: 0.0615, cz: 0.001, e: 2.28 },
  { v: 0.978, y: -0.1275, rx: 0.0455, rz: 0.0520, cz: 0.003, e: 2.24 },
  { v: 0.992, y: -0.1355, rx: 0.0345, rz: 0.0395, cz: 0.004, e: 2.18 },
  { v: 1.0, y: -0.1420, rx: 0.0210, rz: 0.0245, cz: 0.005, e: 2.12 },
];

const EPS = 1e-6;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const gauss = (d: number) => Math.exp(-d * d * 2.2);

/** Non-uniform Catmull-Rom sampler over an ascending control-v axis. */
function sampleChannel(ctrl: HeadCtrl[], key: keyof HeadCtrl, v: number): number {
  const n = ctrl.length;
  if (v <= ctrl[0].v) return ctrl[0][key] as number;
  if (v >= ctrl[n - 1].v) return ctrl[n - 1][key] as number;

  let i = 0;
  while (i < n - 2 && v > ctrl[i + 1].v) i++;

  const p0 = ctrl[Math.max(0, i - 1)];
  const p1 = ctrl[i];
  const p2 = ctrl[i + 1];
  const p3 = ctrl[Math.min(n - 1, i + 2)];

  const h = Math.max(EPS, p2.v - p1.v);
  const t = (v - p1.v) / h;

  const m0 = ((p2[key] as number) - (p0[key] as number)) / Math.max(EPS, p2.v - p0.v);
  const m1 = ((p3[key] as number) - (p1[key] as number)) / Math.max(EPS, p3.v - p1.v);

  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return h00 * (p1[key] as number) + h10 * h * m0 + h01 * (p2[key] as number) + h11 * h * m1;
}

/* ────────────────────────────────────────────────────────────────
   Analytic sculpt on the lofted skull
   ──────────────────────────────────────────────────────────────── */
export function featureOffset(x: number, y: number): [number, number, number] {
  let dx = 0;
  let dz = 0;

  // ── brow ridge, with a glabella dip between the brows ───────────
  {
    const fy = (y - LANDMARK.brow - 0.0055) / 0.0165;
    const lateral = Math.exp(-Math.pow(x / 0.062, 2) * 1.9);
    const dip = 1 - 0.46 * Math.exp(-Math.pow(x / 0.0205, 2));
    dz += 0.0084 * Math.exp(-fy * fy) * lateral * dip;
  }

  // ── eye sockets: orbital rim above, globe recess behind ────────
  for (const s of [-1, 1]) {
    const ex = x - s * WIDTH.eyeX;
    const ey = y - LANDMARK.eye;
    // deep socket
    dz -= 0.0122 * gauss(Math.hypot(ex / 0.0248, ey / 0.0192));
    // upper lid shelf / brow shadow transition
    dz += 0.0031 * Math.exp(-Math.pow((ey + 0.0118) / 0.0052, 2)) * Math.exp(-Math.pow(ex / 0.0182, 2));
    // lower lid pouch
    dz += 0.0019 * Math.exp(-Math.pow((ey - 0.0126) / 0.0056, 2)) * Math.exp(-Math.pow(ex / 0.0168, 2));
    // lateral orbital rim
    dz += 0.0026 * Math.exp(-Math.pow((ex / 0.0125), 2)) * Math.exp(-Math.pow((ey + 0.001) / 0.016, 2));
  }

  // ── nose ───────────────────────────────────────────────────────
  {
    /* s runs DOWN the dorsum: 0 at the radix, 1 at the tip. The projection has
       to grow with s — the earlier version peaked mid-bridge and left the tip
       flat, which read as a blade sunk into the face.

       `s` was clamped at 1, so below the nose tip it stayed pinned at 1 and the
       0.0234 m bridge kept full amplitude all the way down the philtrum, the
       lips and the chin. That is the central ridge in the viewport crop: a
       23 mm beak running from the brow to the chin on a face whose whole
       half-width is 83 mm. The ridge now fades out over the last 8 mm above the
       subnasale, so the philtrum and mouth sit on a flat plane. */
    const s = clamp(
      (LANDMARK.noseRadix - y) / (LANDMARK.noseRadix - LANDMARK.noseTip),
      0,
      1,
    );
    /* Y *descends* along the face, so `smoothstep(low, high, y)` is 1 above
       `high` and 0 below `low` — the orientation that ends the dorsum just
       under the tip. The inverted form, `1 - smoothstep(tip + 4 mm, tip + 14
       mm, y)`, stays at 1 for every y below the band, i.e. over the whole jaw,
       chin and neck. That inversion was live in the build and is what put a
       23 mm beak down the middle of the face. */
    const bridgeFade = smoothstep(LANDMARK.noseTip - 0.008, LANDMARK.noseTip, y);
    const bridge = 0.0234 * smoothstep(0.0, 0.5, s) * bridgeFade;
    const halfW = 0.009 + 0.0078 * smoothstep(0.2, 0.92, s);
    const lateral = Math.exp(-Math.pow(x / halfW, 2) * 1.15);
    dz += bridge * lateral;

    // tip bulb, so the nose ends in a lobe rather than a wedge
    dz += 0.0062 * gauss(Math.hypot(x / 0.0112, (y - LANDMARK.noseTip + 0.0012) / 0.0092));

    // alar wings, sitting just above the subnasale
    for (const side of [-1, 1]) {
      const ax = x - side * WIDTH.noseAlar;
      const ay = y - LANDMARK.subnasale - 0.0026;
      dz += 0.0092 * gauss(Math.hypot(ax / 0.0104, ay / 0.008));
      // nostril hollow under the wing
      dz -= 0.0044 * gauss(Math.hypot(ax / 0.0054, (ay + 0.0019) / 0.0042));
    }
    // septal columella
    dz += 0.0038 * Math.exp(-Math.pow(x / 0.0054, 2)) *
      Math.exp(-Math.pow((y - LANDMARK.subnasale + 0.0024) / 0.0084, 2));
  }

  // ── cheekbones + submalar hollow ───────────────────────────────
  for (const s of [-1, 1]) {
    const cx = x - s * 0.0508;
    const cy = y - (LANDMARK.eye - 0.0245);
    dz += 0.0068 * gauss(Math.hypot(cx / 0.0285, cy / 0.0235));
    // hollow beneath the cheekbone
    dz -= 0.0032 * gauss(Math.hypot((x - s * 0.0458) / 0.0172, (y - LANDMARK.mouth + 0.0075) / 0.0148));
  }

  // ── philtrum ───────────────────────────────────────────────────
  /* Both support terms were inverted, so their product was empty and the
     groove never existed. Y descends, so "between the subnasale and the upper
     lip" needs an upper cutoff that is 1 *below* −0.076 and a lower cutoff that
     is 1 *above* the mouth — i.e. one negated smoothstep and one straight one,
     not two of either. */
  dz -= 0.0022 * Math.exp(-Math.pow(x / 0.0068, 2)) *
    (1 - smoothstep(LANDMARK.subnasale - 0.0035, LANDMARK.subnasale + 0.001, y)) *
    smoothstep(LANDMARK.mouth - 0.0085, LANDMARK.mouth - 0.0022, y);

  /* ── lips ───────────────────────────────────────────────────────
     The atlas already paints the lip line, cupid's bow and vermilion. Only
     a soft volume is needed here; modelling full lips on top of that paint
     doubles the feature and reads as a shadowed maw. */
  {
    const inLip = 1 - smoothstep(WIDTH.mouth * 0.9, WIDTH.mouth * 1.18, Math.abs(x));
    const upper = Math.exp(-Math.pow((y - LANDMARK.mouth - 0.0062) / 0.0062, 2));
    const lower = Math.exp(-Math.pow((y - LANDMARK.mouth + 0.0068) / 0.0082, 2));
    const bow = 1 + 0.3 * Math.exp(-Math.pow(x / 0.0072, 2)) -
      0.15 * Math.exp(-Math.pow((Math.abs(x) - 0.0118) / 0.0055, 2));
    dz += (0.0036 * upper + 0.0044 * lower) * inLip;
    dz += 0.0007 * upper * bow * inLip;
    // shallow mouth line, not a slit
    dz -= 0.0018 * Math.exp(-Math.pow((y - LANDMARK.mouth) / 0.0022, 2)) *
      (1 - smoothstep(0.017, WIDTH.mouth * 0.95, Math.abs(x)));
    // corners tuck back
    dz -= 0.0014 * Math.exp(-Math.pow((Math.abs(x) - WIDTH.mouth) / 0.0046, 2)) *
      Math.exp(-Math.pow((y - LANDMARK.mouth) / 0.0062, 2));
  }

  // ── nasolabial folds ───────────────────────────────────────────
  for (const s of [-1, 1]) {
    const fx = x - s * (0.0252 + (y - LANDMARK.mouth) * 0.16);
    dz -= 0.0019 * Math.exp(-Math.pow(fx / 0.0058, 2)) *
      smoothstep(LANDMARK.mouth - 0.019, LANDMARK.mouth - 0.004, y) *
      (1 - smoothstep(LANDMARK.mouth + 0.008, LANDMARK.mouth + 0.016, y));
  }

  /* ── chin: mental protuberance + labiomental groove ───────────────
     The protuberance used to be centred at `chin − 0.0338`, i.e. y = −0.1858,
     which is 25 mm *below* the lowest surface at −0.1602 — where it contributed
     0.056 mm of a nominal 9.2. That is why the chin had no forward mass at all
     and the jaw read as a wedge: the only term that gives it volume was dead.
     Centring it at `chin + 0.010` (−0.142) puts it on the surface. */
  dz += 0.0034 * gauss(Math.hypot(x / 0.0192, (y - LANDMARK.chin - 0.010) / 0.0168));
  /* The companion shadow was dead for the same reason: centred at
     `chin − 0.0552` (−0.2072), 47 mm below the surface. Moved to the
     labiomental crease between the lower lip and the chin — a real groove this
     mesh did not model — rather than the submental hollow, which a front
     projection cannot show and which would fight the protuberance above it. */
  dz -= 0.0018 * Math.exp(-Math.pow(x / 0.0300, 2)) *
    Math.exp(-Math.pow((y - LANDMARK.chin - 0.034) / 0.0072, 2));

  // ── jawline: soften the edge into the ramus ────────────────────
  {
    const edge = Math.exp(-Math.pow((y - LANDMARK.jawAngle) / 0.0088, 2));
    dx += Math.sign(x) * 0.0021 * edge * smoothstep(0.028, 0.056, Math.abs(x));
  }

  return [dx, 0, dz];
}

export interface HeadBuildOptions {
  rings?: number;
  segments?: number;
}

export interface HeadBuild {
  geometry: THREE.BufferGeometry;
  /** Undeformed positions, copied by the deformer. */
  basePositions: Float32Array;
  ringCount: number;
  segmentCount: number;
}

/**
 * Lofts the head and writes UVs that project onto the real Skyrim head atlas
 * (see `faceUv`). The atlas is a frontal unwrap, so the face is projected
 * planarly into one rect; the back of the skull mirrors u so it never
 * duplicates the painted face.
 */
export function buildHeadGeometry({ rings = 128, segments = 160 }: HeadBuildOptions = {}): HeadBuild {
  /* ringVerts + 2: one apex for the crown, one for the chin cap. Both are
     real vertices so the shader has somewhere to put a normal. */
  const ringVerts = rings * segments;
  const positions = new Float32Array((ringVerts + 2) * 3);
  const uvs = new Float32Array((ringVerts + 2) * 2);

  for (let ri = 0; ri < rings; ri++) {
    const v = (ri + 1) / rings;
    const y = sampleChannel(HEAD_CTRL, 'y', v);
    const rx = sampleChannel(HEAD_CTRL, 'rx', v);
    const rz = sampleChannel(HEAD_CTRL, 'rz', v);
    const cz = sampleChannel(HEAD_CTRL, 'cz', v);
    const e = sampleChannel(HEAD_CTRL, 'e', v);

    for (let si = 0; si < segments; si++) {
      const theta = (si / segments) * Math.PI * 2;
      const s = Math.sin(theta);
      const c = Math.cos(theta);

      /* Superellipse as a polar function: the L-norm denominator stays ≥ 1,
         so the section is smooth everywhere. The naive |sin θ|^(2/e) form
         has infinite slope at sin θ = 0 and creases the face at x = 0. */
      const den = Math.pow(
        Math.pow(Math.abs(s), e) + Math.pow(Math.abs(c), e),
        1 / e,
      );

      let x = (rx * s) / den;
      let z = (rz * c) / den + cz;

      const [ox, oy, oz] = featureOffset(x, y);
      x += ox;
      z += oz;

      const idx = (ri * segments + si) * 3;
      positions[idx] = x;
      positions[idx + 1] = y + oy;
      positions[idx + 2] = z;

      const [u, vv] = faceUv(x, y + oy, z);
      const ui = (ri * segments + si) * 2;
      uvs[ui] = u;
      uvs[ui + 1] = vv;
    }
  }

  // Apex vertex.
  const apex = ringVerts;
  positions[apex * 3] = 0;
  positions[apex * 3 + 1] = 0.1298;
  positions[apex * 3 + 2] = -0.004;
  {
    const [au, av] = faceUv(0, 0.1298, -0.004);
    uvs[apex * 2] = au;
    uvs[apex * 2 + 1] = av;
  }

  /* Winding: θ runs counter-clockwise in XZ with the face at +Z, and rings
     descend from crown to chin. (a, c, b) is the order whose cross product
     points away from the skull — (a, b, c) leaves every normal facing
     inward, which reads as an inverted, shadow-cored head. */
  /* The loft is open at the chin. Without this cap you see straight into the
     skull from below — the black well under the jaw in earlier passes.

     The pole sits 5 mm under the last ring, which is 21 mm in radius, so the
     fan closes the surface as a shallow dome. Two earlier attempts failed for
     different reasons and both matter:
       · at −0.1602 under a 36 mm ring it was a 25 mm cone (the wedge in the
         user's crop);
       · at −0.1465 under a 42 mm ring it was a flat disc whose normals pointed
         *up into the head* — the fan's winding is `(pole, a, b)` with θ running
         counter-clockwise, which gives a downward-facing cap here, and it faced
         the wrong way whenever the pole was below the ring.
     With the radius tapering to 21 mm the fan is steep enough (23°) to light
     correctly, and the winding is fixed below by reversing the triple. */
  const chinCap = ringVerts + 1;
  const CHIN_POLE_Y = -0.1470;
  const CHIN_POLE_Z = -0.002;
  positions[chinCap * 3] = 0;
  positions[chinCap * 3 + 1] = CHIN_POLE_Y;
  positions[chinCap * 3 + 2] = CHIN_POLE_Z;
  {
    const [cu, cv] = faceUv(0, CHIN_POLE_Y, CHIN_POLE_Z);
    uvs[chinCap * 2] = cu;
    uvs[chinCap * 2 + 1] = cv;
  }

  const idxArr: number[] = [];
  const lastRing = (rings - 1) * segments;
  for (let si = 0; si < segments; si++) {
    const a = lastRing + si;
    const b = lastRing + ((si + 1) % segments);
    /* Reversed against the crown fan below. The pole is *below* the ring, so
       the same winding that faces outward at the crown faces into the skull
       here — the chin cap was lit from inside and read as a black notch. */
    idxArr.push(chinCap, b, a);
  }
  for (let si = 0; si < segments; si++) {
    const a = si;
    const b = (si + 1) % segments;
    idxArr.push(apex, a, b);
  }
  for (let ri = 0; ri < rings - 1; ri++) {
    for (let si = 0; si < segments; si++) {
      const a = ri * segments + si;
      const b = ri * segments + ((si + 1) % segments);
      const c = (ri + 1) * segments + si;
      const d = (ri + 1) * segments + ((si + 1) % segments);
      idxArr.push(a, c, b);
      idxArr.push(b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(idxArr);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return {
    geometry,
    basePositions: positions.slice(),
    ringCount: rings,
    segmentCount: segments,
  };
}

/* ────────────────────────────────────────────────────────────────
   UV projection onto the Skyrim head atlas
   ──────────────────────────────────────────────────────────────── */

/**
 * The atlas rect the face projects into, in head-local metres, fitted to
 * the painted landmarks of femaleHead_d.dds at 1024²:
 *
 *   eye line   y = -0.0200  →  py 454   (measured 454)
 *   mouth line y = -0.0902  →  py 590   (measured 590)
 *   chin       y = -0.1520  →  py 710   (measured ≈ 705)
 *   crown      y = +0.1288  →  py 165   (measured ≈ 150)
 *   eye X      x = ±0.0318  →  px 411 / 611  (measured 409 / 611)
 *
 * The two eye and mouth rows alone solve the vertical affine; the chin and
 * crown then fall out of it, which is why this fit is trustworthy rather
 * than eyeballed. `buildFaceTexture` resamples the diffuse through this
 * very rect, so geometry and albedo cannot drift apart.
 */
export const FACE_RECT = {
  x0: -0.16118,
  x1: 0.16118,
  y0: -0.31423,
  y1: 0.21435,
} as const;

/** Atlas u per metre of head width (1024² atlas). */
export const FACE_U_PER_M = 1 / (FACE_RECT.x1 - FACE_RECT.x0);

/**
 * Planar frontal projection for the face, compressed to a narrow band behind
 * the ears. Front-facing vertices sample the atlas 1:1 through `FACE_RECT`
 * (so the painted eyes land on the modelled eyes); the nape blends to a
 * near-uniform skin strip instead of the atlas's grey corner margins, which
 * is what produced the black wedges on earlier passes.
 */
export function faceUv(x: number, y: number, z: number): [number, number] {
  const ry = FACE_RECT.y1 - FACE_RECT.y0;
  const planar = (x - FACE_RECT.x0) / (FACE_RECT.x1 - FACE_RECT.x0);
  const nape = 0.5 + clamp(x / 0.093, -1, 1) * 0.3;
  const front = smoothstep(-0.02, 0.03, z);
  const u = nape + (planar - nape) * front;
  return [clamp(u, 0, 1), clamp((y - FACE_RECT.y0) / ry, 0, 1)];
}

/** Neck + trapezius, lofted down and out of frame. */
export function buildNeckGeometry(): THREE.BufferGeometry {
  const segs = 72;
  const rows = 44;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];

  const rowData = (t: number) => {
    const y0 = -0.138;
    const y1 = -0.5;
    const y = y0 + (y1 - y0) * t;
    const w = 0.0318 + 0.0235 * Math.pow(t, 1.55);
    const d = 0.0345 + 0.0242 * Math.pow(t, 1.55);
    const cz = -0.026 - 0.008 * t;
    return { y, w, d, cz };
  };

  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const { y, w, d, cz } = rowData(t);
    for (let s = 0; s < segs; s++) {
      const th = (s / segs) * Math.PI * 2;
      const sn = Math.sin(th);
      const cs = Math.cos(th);
      const den = Math.pow(Math.pow(Math.abs(sn), 2.1) + Math.pow(Math.abs(cs), 2.1), 1 / 2.1);
      const x = (w * sn) / den;
      const z = (d * cs) / den + cz;
      pos.push(x, y, z);
      /* Neck samples clean cheek skin, not the atlas's neck strip: the strip
         carries the painted sternocleidomastoid shading and the under-chin
         shadow wedges, which show up as hard dark edges once the neck is a
         separate smooth cylinder. u 0.44–0.56 / v 0.30–0.40 is unbroken
         forehead-to-cheek tone at every angle. */
      uv.push(clamp(0.5 + (x / Math.max(0.02, w)) * 0.06, 0.44, 0.56), 0.30 + t * 0.10);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * segs + s;
      const b = r * segs + ((s + 1) % segs);
      const c = (r + 1) * segs + s;
      const dd = (r + 1) * segs + ((s + 1) % segs);
      idx.push(a, c, b, b, c, dd);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Shoulders / garment mass, deliberately below the visible frame. */
export function buildTorsoGeometry(): THREE.BufferGeometry {
  const segs = 96;
  const rows = 26;
  const pos: number[] = [];
  const idx: number[] = [];
  const uv: number[] = [];

  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    /* The collar starts high enough to enter the frame. Starting at −0.36
       left the neck hanging as a bare pole below the chin, which reads as a
       mannequin; a garment line just under the jaw is what the reference
       has. */
    const y = -0.205 - t * 0.62;
    const w = 0.072 + Math.pow(t, 1.35) * 0.32;
    const d = 0.070 + Math.pow(t, 1.35) * 0.18;
    const cz = -0.028;
    for (let s = 0; s < segs; s++) {
      const th = (s / segs) * Math.PI * 2;
      const sn = Math.sin(th);
      const cs = Math.cos(th);
      const den = Math.pow(Math.pow(Math.abs(sn), 1.22) + Math.pow(Math.abs(cs), 1.22), 1 / 1.22);
      const x = (w * sn) / den;
      const z = (d * cs) / den + cz;
      const shoulder =
        1 +
        0.5 *
          Math.exp(-Math.pow((y + 0.42) / 0.06, 2)) *
          Math.pow(Math.abs(x) / Math.max(1e-4, w), 1.2);
      pos.push(x * shoulder, y, z);
      uv.push(s / segs, t);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * segs + s;
      const b = r * segs + ((s + 1) % segs);
      const c = (r + 1) * segs + s;
      const dd = (r + 1) * segs + ((s + 1) % segs);
      idx.push(a, c, b, b, c, dd);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Ring cross-section at a given head-local height. */
export interface HeadRing {
  rx: number;
  rz: number;
  cz: number;
  e: number;
}

/**
 * The lofted ring at height `y`. `HEAD_CTRL.y` is monotonically descending in
 * v, so a plain bisection recovers the ring parameter.
 */
export function headRingAt(y: number, inflate = 0): HeadRing {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) * 0.5;
    if (sampleChannel(HEAD_CTRL, 'y', mid) > y) lo = mid;
    else hi = mid;
  }
  const v = Math.max(0.02, Math.min(1, (lo + hi) * 0.5));
  return {
    rx: sampleChannel(HEAD_CTRL, 'rx', v) + inflate,
    rz: sampleChannel(HEAD_CTRL, 'rz', v) + inflate,
    cz: sampleChannel(HEAD_CTRL, 'cz', v),
    e: sampleChannel(HEAD_CTRL, 'e', v),
  };
}

/**
 * Point on the head surface at around-the-head angle `theta` (0 = straight
 * ahead, +π/2 = the character's left ear) and height `y`.
 *
 * Uses the identical superellipse parametrisation as `buildHeadGeometry`, so
 * anything anchored with it sits exactly on the lofted skull. Hair must not
 * use an independent ellipsoid approximation: even a few millimetres of drift
 * lifts a side card off the temple and drapes it across the forehead.
 */
export function headPointAt(
  theta: number,
  y: number,
  inflate = 0,
): [number, number, number] {
  const { rx, rz, cz, e } = headRingAt(y, inflate);
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const den = Math.pow(
    Math.pow(Math.abs(s), e) + Math.pow(Math.abs(c), e),
    1 / e,
  );
  return [(rx * s) / den, y, (rz * c) / den + cz];
}

/**
 * Z of the head surface at a given (x, y), i.e. the half-depth of the lofted
 * ring at that height narrowed to the superellipse half-width at that x.
 */
export function headSurfaceZ(x: number, y: number, inflate = 0): number {
  const { rx, rz, cz, e } = headRingAt(y, inflate);
  // solve the superellipse  |x/rx|^e + |z'/rz|^e = 1  for z'
  const t = Math.min(0.999, Math.abs(x) / Math.max(1e-6, rx));
  return cz + rz * Math.pow(Math.max(0, 1 - Math.pow(t, e)), 1 / e);
}

export { smoothstep, clamp };
