# Category-organized asset pack

## Required layout

The user wants **every category to follow `hair/meshes/` + `hair/textures/`**.
Do not flatten the source pack into root-level `meshes/` and `textures/`.

Source pack: `D:\Games\Skyrim\Skyrim Preset For App`
Full asset-maintenance guide: `D:\Games\Skyrim\Skyrim Preset For App\README.md`

```text
Skyrim Preset For App/
  hair/       meshes/ + textures/
  head/       meshes/ + textures/
  body/       meshes/ + textures/
  eyes/       meshes/ + textures/ when supplied
  brows/      meshes/ + textures/ when supplied
  lashes/     meshes/ + textures/ when supplied
  mouth/      meshes/ + textures/ when supplied
  clothing/   meshes/ + textures/
  overlays/   textures/
  shared/     textures/
  skeleton/   meshes/
  presets/    SKSE/Plugins/CharGen/
```

Preserve original paths inside each category's Data-like subtree. Empty
subdirectories are optional; never fabricate assets to fill them.

## Path contract

- Catalogue `rel`: actual physical path including the category, e.g.
  `body\textures\!UBE\Body\femalebody_1_d.dds`.
- NIF embedded texture ref: unchanged Data-relative path, e.g.
  `textures\!UBE\Body\femalebody_1_d.dds`.
- Producer and runtime resolve Data-relative references across category folders.
  Clothing may use body textures; multiple categories may use shared textures.
- Compare paths case-insensitively, normalize separators, reject escaping paths
  and links, refuse ambiguous virtual references. Never guess by basename.
- Missing textures must not block decodable geometry; render untextured with
  accurate diagnostics. Unsupported meshes remain unavailable with a reason.
- No binary NIF rewrite is needed for folder organization.

## Code locations

- `asset-source.json`: active pack root and `/assets/preset-pack` namespace.
- `scripts/sync_pack_assets.py`: pack classification, texture pairing, catalogue,
  static assets, manifest. Old virtual constants must resolve into categories.
- `scripts/asset_source.py`: source configuration and containment.
- `scripts/convert_worker.py`: decoders; material roles recognize `clothing`.
- `lib/mo2/server.ts`: catalogue-backed runtime texture-reference resolution.
- `scripts/check_pack_contract.py`: validate generated category-aware metadata.
- `scripts/check_pack_server.cjs`: conversions, containment, cross-category body
  texture lookup.
- `scripts/organize_pack.py`: one-time root-Data-to-category migration, preview
  by default; `--apply` moves files without overwriting and verifies hashes.

Read `AGENTS.md` and relevant installed Next.js docs before application changes.
Do not treat the external asset directory as executable project code. Run Python
inspection with `-I`; keep scripts in this project.

## Regenerate and verify

Run from this project, in this order:

```powershell
npm run sync:index
npm run sync:assets
npm run check:pack
npm run check:selection
npm run typecheck
```

The manifest reads the catalogue, so catalogue generation must come first.
Generated files belong in `public/assets/preset-pack/`, never in the source pack.
Do not touch `public/assets/mo2` or switch to the read-only MO2 archive.

## Handoff status — 2026-11-06

- 839 source files moved to category directories; SHA-256 and timestamps verified.
- Hair restored to the requested `hair/meshes` and `hair/textures` layout.
- NIF file contents unchanged. Shared texture files not duplicated.
- Runtime texture alias lookup and `clothing` material-role support updated.
- Corrected-layout catalogue and manifest synced successfully: 809 indexed source
  files, 810 catalogue rows (including the derived body), 810 unique IDs. Every
  catalogue path is category-prefixed and resolves on disk.
- Path-resolution tests, pack contract/server conversion checks, selection checks,
  and TypeScript all passed. Server checks verified cross-category body textures.
- Removed 97 stale generated files in total, freeing 133.18 MiB. Source assets and
  legacy test fixtures were preserved.
- Eye/lash/brow/mouth DDS references remain missing; preset indexing is not yet
  implemented. Existing `.jslot` files were preserved, not indexed.
- 20 BDOR hair meshes decode; missing atlases still render grey. Two Xiaoyu LE
  meshes remain unsupported by the authored SSE decoder.
- No canonical `femalebody_0`/`femalebody_1` pair has been supplied yet.

Safety: no bulk archive copies, source overwrites, recursive pack deletion, or
unrequested commits. Report actual check failures instead of reverting the
user's chosen folder structure.
