# New Machine Asset & Environment Setup

This guide explains how to set up the project on a new machine using Git for code/rules and Google Drive for heavy non-Git runtime assets.

---

## 1. What Comes From Git vs. Google Drive

- **Included in Git (`git clone`)**:
  - Application code, UI, Three.js scene, scripts, and agent rules (`AGENTS.md`, `CLAUDE.md`, `.agents/`, `.claude/`).
  - Currently Git-tracked assets: `public/assets/bodyslide/`, `public/assets/wardrobe/`, `public/assets/hair/`, `public/assets/styling/`, `public/assets/morphs/`, `public/assets/enb/`, and `public/assets/taxonomy-manifest.json`.
- **Downloaded from Google Drive (Gitignored)**:
  - `1-preset-pack-core.zip` (`66.38 MB`) — **Required**: 7 baked skins (`public/assets/preset-pack/textures/skin/`), body skins, default meshes, poses, catalogues, and `manifest.json`.
  - `2-mo2.zip` (`112.52 MB`) — **Recommended**: Fallback meshes (`public/assets/mo2/`) and legacy catalogue/cache.
  - `3-preset-pack-cache-base.zip` (`182.34 MB`) — **Optional**: Pre-cached eyes, brows, lashes, makeup, tattoos, clothing, head, and skin previews.
  - `4-preset-pack-cache-hair.zip` (`1,401.16 MB`) — **Optional**: Pre-cached NIF hair thumbnails and decoded meshes (skip if you only work with GLB hair in `public/assets/hair/`).

---

## 2. Step-by-Step Setup

### Step 1: Clone & Install Dependencies

```powershell
git clone https://github.com/whitesilence98/skycreation-ube.git
cd skycreation-ube
npm install
```

### Step 2: Set Up Python Virtual Environment (Optional / For Scripts & Checks)

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

> On macOS/Linux: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`

### Step 3: Extract the Google Drive ZIPs at the Repo Root

Every ZIP already preserves the `public/assets/...` paths inside it. **Extract directly inside the repository root folder** (not inside a subfolder).

**Windows (PowerShell — `tar` is built into Windows 10/11 and supports large Zip64 files):**

```powershell
# Put downloaded zips in .\share\ (gitignored), then run from repo root:
tar -xf share\1-preset-pack-core.zip
tar -xf share\2-mo2.zip

# Optional pre-warmed caches:
tar -xf share\3-preset-pack-cache-base.zip
tar -xf share\4-preset-pack-cache-hair.zip
```

**macOS / Linux:**

```bash
unzip -o share/1-preset-pack-core.zip
unzip -o share/2-mo2.zip

# Optional pre-warmed caches:
unzip -o share/3-preset-pack-cache-base.zip
unzip -o share/4-preset-pack-cache-hair.zip
```

After extracting, verify `public/assets/preset-pack/manifest.json` and `public/assets/preset-pack/textures/skin/diamond_head.webp` exist.

### Step 4: Keep `asset-source.json` Unchanged (Important!)

- Do **not** set `ASSET_PACK_ROOT` in `.env.local` unless you also have the raw `Skyrim Preset For App` source pack on disk and plan to regenerate assets.
- `lib/mo2/assetSource.ts` hashes the configured `root` into `sourceKey` (`662378fafcfa2b4b`). Keeping `asset-source.json` untouched allows `/api/mo2/manifest` and `/api/mo2/catalogue` to load the prebuilt `preset-pack` cleanly.
- **Note on `/api/mo2/convert`**: Clothing resolves standalone from `public/assets/wardrobe/doneb14n-cp6/`. However, converting *uncached* raw Skyrim NIF/DDS items on demand via `/api/mo2/convert` still checks for the raw `Skyrim Preset For App` directory on disk (`lib/mo2/server.ts`). If you need to rebuild packs from raw Skyrim files, place the raw pack folder locally, set `ASSET_PACK_ROOT=<your_path>` in `.env.local`, and run:

```powershell
npm run sync:index
npm run sync:assets
```

### Step 5: Verify & Run

```powershell
npm run typecheck
npm run dev
```

Open `http://localhost:3000`.

---

## 3. For Maintainers: Rebuilding the Share ZIPs

When skins, poses, or preset-pack meshes are updated, rebuild the ZIPs into `share/` (already gitignored):

```powershell
python -I scripts/pack_share_zips.py
```

Upload the updated ZIP(s) in `share/` to your Google Drive folder.
