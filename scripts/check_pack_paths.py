#!/usr/bin/env python
"""Check `pack_paths` against the category layout, in a throwaway tree.

    python -I scripts/check_pack_paths.py

Stdlib only. Builds a miniature pack under a temp directory (so no real assets
are touched), then asserts:

- a physical `category/...` path resolves directly,
- old Data paths resolve across categories (`textures\\!UBE\\Head\\...` ->
  `head\\textures\\...`, `meshes\\hairs\\...` -> `hair\\meshes\\...`, ...),
- a missing path resolves to None,
- a path present under two categories is ambiguous and resolves to None,
- `..`, absolute and drive-qualified input never resolves,
- `virtual_rel` and `pack_mod` strip the category as the server does.

Exit 0 when every check passes; non-zero with the failure on stderr.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import pack_paths  # noqa: E402

failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)


def touch(root: Path, rel: str) -> None:
    path = root / rel.replace("\\", "/")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"")


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        touch(root, r"head\textures\!UBE\Head\femaleHead_d.dds")
        touch(root, r"body\textures\!UBE\Body\femalebody_1_d.dds")
        touch(root, r"hair\meshes\[Dint] BDOR_Hair UBE\Amelia.nif")
        touch(root, r"hair\textures\armor\[dint999]\02 Hair\H1.dds")
        touch(root, r"clothing\meshes\!UBE\Armor\Mu3B\outfit.nif")
        touch(root, r"clothing\textures\clothes\FB_Aokili\Shorts_d.dds")
        touch(root, r"clothing\textures\clothes\FB_Aokili\Shorts_n.dds")
        touch(root, r"shared\textures\cubemaps\mirror_e.dds")
        touch(root, r"presets\SKSE\Plugins\CharGen\Frau.nif")
        touch(root, r"overlays\textures\!UBE\Custom_Scars\1.dds")
        touch(root, r"skeleton\meshes\actors\character\skeleton_female.nif")
        # COR's facial maps and Zhizhen's actor-tree eye atlas, both imported
        # by `import_facial_assets.py` under the category that owns them.
        touch(root, r"eyes\textures\!COR\Eyes_ILV\eye01.dds")
        touch(root, r"lashes\textures\!COR\Lashes\EyeLashesDeliah.dds")
        touch(root, r"brows\textures\!COR\Brows\FemaleBrow_01.dds")
        touch(root, r"mouth\textures\!COR\Mouth\MouthMap_d.dds")
        touch(root, r"eyes\textures\actors\character\ddseyes\eye01.dds")
        # An unlisted COR family is an overlay, not a facial part: it must not
        # resolve into the eyes/brows trees by category fallback.
        touch(root, r"overlays\textures\!COR\MakeupOverlays\m.dds")
        # The pre-category layout must keep resolving as written.
        touch(root, r"meshes\!UBE\Legacy\keep.tri")
        touch(root, r"textures\!UBE\Legacy\keep.dds")
        # The same Data path in two categories: ambiguous by design.
        touch(root, r"head\textures\shared\dup.dds")
        touch(root, r"body\textures\shared\dup.dds")

        def rel_of(value: Path | None) -> str:
            return "" if value is None else str(value.relative_to(root)).replace("/", "\\")

        cases = [
            (r"head\textures\!UBE\Head\femaleHead_d.dds",
             r"head\textures\!UBE\Head\femaleHead_d.dds"),
            (r"textures\!UBE\Head\femaleHead_d.dds",
             r"head\textures\!UBE\Head\femaleHead_d.dds"),
            (r"Textures/!UBE/BODY/femalebody_1_d.dds",
             r"body\textures\!UBE\Body\femalebody_1_d.dds"),
            (r"meshes\hairs\[Dint] BDOR_Hair UBE\Amelia.nif",
             r"hair\meshes\[Dint] BDOR_Hair UBE\Amelia.nif"),
            (r"textures\armor\[dint999]\02 Hair\H1.dds",
             r"hair\textures\armor\[dint999]\02 Hair\H1.dds"),
            (r"meshes\!UBE\Armor\Mu3B\outfit.nif",
             r"clothing\meshes\!UBE\Armor\Mu3B\outfit.nif"),
            (r"clothing\textures\clothes\FB_Aokili\Shorts_d.dds",
             r"clothing\textures\clothes\FB_Aokili\Shorts_d.dds"),
            (r"textures\clothes\FB_Aokili\Shorts_d.dds",
             r"clothing\textures\clothes\FB_Aokili\Shorts_d.dds"),
            (r"textures\clothes\FB_Aokili\Shorts_n.dds",
             r"clothing\textures\clothes\FB_Aokili\Shorts_n.dds"),
            (r"textures\clothes\FB_Aokili\missing.dds", ""),
            (r"textures\cubemaps\mirror_e.dds",
             r"shared\textures\cubemaps\mirror_e.dds"),
            (r"textures\Caenarvon\cubemap\x.dds", ""),
            (r"SKSE\Plugins\CharGen\Frau.nif",
             r"presets\SKSE\Plugins\CharGen\Frau.nif"),
            (r"textures\!UBE\Custom_Scars\1.dds",
             r"overlays\textures\!UBE\Custom_Scars\1.dds"),
            (r"meshes\actors\character\skeleton_female.nif",
             r"skeleton\meshes\actors\character\skeleton_female.nif"),
            # COR facial maps: the folder name is the category.
            (r"textures\!COR\Eyes_ILV\eye01.dds",
             r"eyes\textures\!COR\Eyes_ILV\eye01.dds"),
            (r"textures\!COR\Lashes\EyeLashesDeliah.dds",
             r"lashes\textures\!COR\Lashes\EyeLashesDeliah.dds"),
            (r"textures\!COR\Brows\FemaleBrow_01.dds",
             r"brows\textures\!COR\Brows\FemaleBrow_01.dds"),
            (r"textures\!COR\Mouth\MouthMap_d.dds",
             r"mouth\textures\!COR\Mouth\MouthMap_d.dds"),
            (r"textures\!COR\MakeupOverlays\m.dds",
             r"overlays\textures\!COR\MakeupOverlays\m.dds"),
            # Zhizhen's eye maps live in the actors tree, under `eyes`.
            (r"textures\actors\character\ddseyes\eye01.dds",
             r"eyes\textures\actors\character\ddseyes\eye01.dds"),
            # An ungrouped pre-category pack still resolves its own paths.
            (r"meshes\!UBE\Legacy\keep.tri", r"meshes\!UBE\Legacy\keep.tri"),
            (r"textures\!UBE\Legacy\keep.dds", r"textures\!UBE\Legacy\keep.dds"),
            (r"textures\!UBE\Nails\missing.dds", ""),
            (r"textures\shared\dup.dds", ""),
            # A stale category spelling never falls back to another category.
            (r"hair\textures\!UBE\Head\femaleHead_d.dds", ""),
        ]
        for ref, want in cases:
            got = rel_of(pack_paths.pack_rel(root, ref))
            check(got == want, f"pack_rel({ref!r}) = {got!r}, want {want!r}")

        for bad in ("", "..\\x.dds", "head\\..\\..\\x", "C:\\Windows\\win.ini",
                    "\\\\server\\share\\x.dds", "/etc/passwd"):
            check(pack_paths.pack_rel(root, bad) is None, f"pack_rel({bad!r}) escaped the pack")

        check(pack_paths.virtual_rel(r"head\textures\!UBE\Head\a.dds")
              == r"textures\!UBE\Head\a.dds", "virtual_rel did not strip the category")
        check(pack_paths.virtual_rel(r"clothing\textures\clothes\FB_Aokili\Shorts_d.dds")
              == r"textures\clothes\FB_Aokili\Shorts_d.dds", "virtual_rel did not strip clothing category")
        check(pack_paths.virtual_rel(r"textures\!UBE\Head\a.dds")
              == r"textures\!UBE\Head\a.dds", "virtual_rel changed a Data path")
        check(pack_paths.pack_mod(r"hair\meshes\a.nif") == "meshes", "pack_mod on a mesh")
        check(pack_paths.pack_mod(r"clothing\textures\a.dds") == "textures", "pack_mod on a clothing texture")
        check(pack_paths.pack_mod(r"clothing\meshes\a.nif") == "meshes", "pack_mod on a clothing mesh")
        check(pack_paths.pack_mod(r"SKSE\Plugins\a.nif") == "SKSE", "pack_mod on a preset")
        check(pack_paths.is_physical(r"hair\meshes\a.nif"), "is_physical missed a category")
        check(pack_paths.is_physical(r"clothing\textures\clothes\a.dds"), "is_physical missed clothing texture")
        check(pack_paths.is_physical(r"clothing\meshes\a.nif"), "is_physical missed clothing mesh")
        check(not pack_paths.is_physical(r"meshes\hairs\a.nif"), "is_physical accepted a Data path")
        check(not pack_paths.is_physical(r"textures\clothes\a.dds"), "is_physical accepted a Data clothing texture")

    if failures:
        for f in failures:
            print(f"[x] {f}", file=sys.stderr)
        print(f"\n{len(failures)} pack path failure(s)", file=sys.stderr)
        return 1
    print("ok: pack category resolution, aliases, missing, ambiguity, traversal")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
