---
paths:
  - "components/hud/smart/**"
  - "lib/smart/**"
  - "app/api/smart/**"
  - "scripts/retarget_head.py"
  - "scripts/check_retarget.cjs"
  - "scripts/check_smart_import.cjs"
  - "lib/head/dynamicSculpt.ts"
  - "lib/head/dynamicStorage.ts"
  - "lib/presetIO.ts"
  - "lib/session.ts"
---

# Smart Customization: UBE Sculpt Only

Approved target: `design/quick-specs/smart-ube-sculpt-transfer-2026-11-20.md`.
This is the implementation contract, not a claim that migration is complete.

- Smart input is a fitting target, never replacement character geometry.
- Use `scripts/retarget_head.py` as the shared OBJ-to-jslot converter.
  Do not implement a second frontend fitting algorithm.
- Preserve canonical UBE vertex order, topology, UVs and skinning.
  Derived dynamic meshes are permitted only as sculpt-replay caches.
- Conversion and replay must use the same verified canonical base.
- Keep the protected neck seam unchanged. Reject invalid geometry.
  Never remove safety constraints merely to improve a fit score.
- Approximate source fitting and faithful jslot replay are different claims.
  Never promise exact photo likeness from surface-error metrics alone.
- Do not apply existing facial deformation twice.
  Preview must be reversible; Apply commits only validated results.
- Persist/export the sculpt payload, not merely a dynamic mesh reference.
  Export and reimport must reproduce the accepted fitted head.
- Fail visibly on malformed sculpt, missing base, poor fit or unavailable
  conversion. Never fall back to direct mesh replacement or neutral success.
- Treat uploads as untrusted. Bound size, geometry, execution and concurrency.
  Use isolated Python, fixed executable arguments and private temp paths.
- Photo-to-OBJ generation belongs upstream in ComfyUI.
  Do not add an image-generation integration without an approved workflow.
- Changes require typecheck, fitting/replay regression checks, and browser
  verification of preview, Cancel, Apply, reload and export/reimport.

These Markdown rules are advisory. Runtime validators and runnable regression
checks must enforce the invariants; prose alone is not a hard block.
