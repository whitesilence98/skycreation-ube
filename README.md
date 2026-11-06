# LYRA — character creation viewport

A dark-fantasy character-creation HUD with a live 3D face viewport, built to
match a BDO/Skyrim-RaceMenu-style reference frame. The interface is React +
Tailwind; the viewport is React Three Fiber. Assets come from the active local
source in `asset-source.json`; the current source is the UBE preset pack.

## Active asset source

`asset-source.json` selects one source, never a merged catalogue:

```json
{
  "layout": "pack",
  "root": "D:\\Games\\Skyrim\\Skyrim Preset For App",
  "publicBase": "/assets/preset-pack"
}
```

Run `npm run sync:assets`, then `npm run sync:index`, then restart the app.
Generated files stay under `public/assets/preset-pack`; the old
`public/assets/mo2` tree remains untouched. Missing maps and unsupported meshes
are reported, never borrowed from MO2. The supplied skin is **Diamond Skin UBE**;
add compatible Imperfect head/body maps to the pack before selecting Imperfect.
Hair/clothing use static authored geometry; no HDT/SMP physics or animation.
Add their referenced textures inside the pack, then resync to enable them.

`npm run check:pack`, `npm run check:selection`, and `npm run typecheck` verify
contracts without browser testing. `check:mo2` continues to check legacy output.

Rollback: change `layout` to `mo2`, `root` to
`D:\Games\Skyrim\MO2_Archive\mods`, `publicBase` to `/assets/mo2`; restart.
`MO2_MODS_ROOT` overrides the root only in `mo2` mode. The API exposes a source
label, not the absolute source root. Older sections below describe the legacy
MO2 setup and are not pack defaults.

## Running it

```bash
npm install
npm run sync:assets     # read the active source; generate its manifest
npm run sync:index      # refresh the active source catalogue
npm run dev
```

`npm run build && npm start` for a production build. `npm run typecheck`
runs the strict TypeScript check on its own.

### Prerequisites for `sync:assets`

- Node 20+
- Python 3 with `pillow` and `numpy` (`pip install pillow numpy`)

A cold run takes about a minute — two of the skins are 85 MB 4096² diffuses
that take ~25 s each to decode. Every output is cached against its source and
against the script's own mtime, so a warm run is under three seconds and
editing the transcode logic re-encodes automatically. It only ever *reads* the
archive: nothing is copied wholesale, and the 80 GB mod directory is never
staged anywhere. Pass a different root with
`python scripts/sync_mo2_assets.py --mods "D:/path/to/mods"`.

If the script has never been run, `public/assets/mo2/manifest.json` reports
`available: false` and the app falls back to a procedural skin gradient, a
procedural iris and a matte hair cap. It still runs — it just no longer wears
the user's assets.

## What is real and what is procedural

**Real, read from the mod archive:**

| Asset | Source mod | How it is used |
| --- | --- | --- |
| Head diffuse | Imperfect Skin - UBE | Projected onto the face as the albedo, graded, then sharpened |
| Body diffuse | Imperfect Skin - UBE | The torso's albedo, with the UBE normal authored for the same UV |
| Eye diffuse | Zhizhen Eyes | The actual iris/sclera disc, blitted into the painted eye aperture |
| Iris/tint palette | both of the above | Sampled by `sync:assets` and carried in the manifest; the procedural iris fallback tints from it |
| Hair strand atlas | HG Hairdos 2 | Alpha-masked strand mask driving every hair card and the fringe |
| Bone names | XP32 Maximum Skeleton | Listed in the asset panel; the rig's bone vocabulary follows them |
| Preset morphs | All My UBE Preset (`Frau.jslot`) | 37 RaceMenu morph names and values, surfaced in the asset panel |
| Head mesh / skeleton | COR MAIN - CBBE SE, XP32 | Read and *reported* (version, block classes, node names) — see the note below |

**Procedural:**

- The head mesh itself. It is lofted from anatomical cross-sections and then
  sculpted analytically (brow ridge, orbital sockets, nose, cheekbones, lips).
- The skinning rig and its five deform bones per region.
- Hair card geometry — only the *texture* is the real asset.
- Neck, collar and torso.
- Lighting, depth of field, vignette, and the cyan region overlay.

### Choosing which assets to wear

`sync:assets` does not stop at the first file it finds in each category: it
scans the whole candidate family and writes one option per file. The expanded
**MO2 ASSET PIPELINE** panel lists them, one accordion per category, and the
viewport follows the pick.

| Category | Options (today) | What a pick changes |
| --- | --- | --- |
| SKIN | 6 | Re-bakes the face albedo from that mod's `femaleHead_d.dds` |
| EYES | 7 | Re-blits that atlas's iris into the painted aperture, with that atlas's own measured UV centre and radius |
| HAIR | 7 | Swaps the strand mask on the cards |
| PRESET | 9 | Applies that `.jslot`'s morphs to the sliders |
| HEAD MESH | 2 | The file the pipeline reads and *reports* — the viewport head stays procedural |
| SKELETON | 2 | Same: reported structure only |

So four of the six are real changes and two are readouts. The panel says which
by tagging HEAD MESH `PROCEDURAL`; the same caveat as below applies.

Only the skins that provide the canonical `textures\!UBE\Head\femaleHead_d.dds`
are offered. `ATLAS_FIT` is a least-squares fit to that specific UV layout, so a
Fair Skin or CBBE head map would project its eyes and lips onto the wrong part
of the face. Eye atlases have no such constraint because the atlas's eyeball
centre and radius are measured per texture at sync time.

Hair entries are scored in the script against the five UV windows the cards
actually sample. An atlas with no strand structure there is still listed — it
is the user's file — but dimmed and marked `NO STRAND`, with a tooltip saying
why. Only `90sBebe` and `Seraph` pass today; `Kiki` and `Cicada` are blank in
those windows and `Ash`, `Regina` and `Emmy` are solid slabs.

The selection is part of an exported preset: `assets` records the six ids, and
importing restores them alongside the sliders.

### Note on the head mesh

`COR MAIN - CBBE SE\Meshes\!COR\Head\FemaleHead.nif` is a Skyrim SE
`BSDynamicTriShape`, a packed half-float format that predates and is not
supported by the available Python NIF readers. The pipeline reads and reports
its header — version 20.2.0.7, 9 blocks, `[NiNode, BSDynamicTriShape,
BSDismemberSkinInstance, NiSkinData, NiSkinPartition,
BSLightingShaderProperty, BSShaderTextureSet]` — but does not decode its
vertex buffer, so the viewport keeps the procedural head. The eye mesh
(`Zhizheneyesfemale.nif`) *is* in an older format and does parse; it is what
confirmed the eye atlas's UV layout.

## Layout

The HUD is authored in the reference's own coordinate space (1024 × 572) and
scaled as one layer to fit the window, so proportions hold at any size.
`components/hud/HudScale.tsx` sets `--hud-scale`.

```
app/                   routes; / is the editor, /preview renders the bare head
components/hud/        TopBar, LeftPanel, RightPanel, Footer, AssetPanel
components/scene/      Canvas, HeadModel, MeshOverlay, FaceGizmo
lib/head/              geometry (loft + sculpt), rig, hair, overlay, textures
lib/regions.ts         region + slider definitions — the single source of truth
lib/store.ts           Zustand store, one slider/pose bank per region
scripts/               sync_mo2_assets.py
```

## Controls

- **LMB drag on the mesh** — move / rotate / scale the active bone, per the
  MOVE / ROTATE / SCALE tabs on the right
- **RMB drag** — orbit the camera
- **Scroll** — zoom
- **IMPORT / EXPORT** in the footer — preset files, below

Sliders and the gizmo both write into the active region's bank, so switching
regions is lossless and switching presets resets every bank.

## Presets: import and export

**Export** downloads `lyra-<name>-<date>.json` with two halves:

- `regions` — every region's six slider values and gizmo pose, exactly as the
  app holds them. Importing this file restores the face bit-for-bit.
- `raceMenu.morphs` — the same face written in RaceMenu's vocabulary
  (`BF_Nose_TipHeight`, `AE_FACE_FaceLength`, …), so the numbers can be typed
  into RaceMenu. These morph names were taken from the `.jslot` files in the
  archive, not invented.
- `assets` — the six asset-panel ids the face was wearing, so a shared preset
  brings its skin, eyes and hair with it. Absent when nothing was picked.

**Import** accepts either format:

- The app's own export — restores every region exactly.
- A RaceMenu `.jslot` straight from
  `SKSE/Plugins/CharGen/Presets/`. This is the interesting one: it reads
  `morphs.custom`, maps the morph names onto the six sliders in each region,
  and reports how many morphs it could not place. On the real files in this
  archive, roughly 14–25 of ~37–39 morphs land; the rest are eyes, eyelids,
  lashes, expressions and body weight, which this FACE SHAPE tab does not
  expose.

The mapping lives in `lib/presetIO.ts` (`REGION_MORPHS`). It lists the
RaceMenu Extended names (`AA_Brows_Angle`, `AG_LIP_UpperLipSize`, …) and the
older unprefixed set (`Brow_BrowSlope`, `Nose_NoseBridgeHeight`, …) as aliases,
because the presets in this archive use both.
