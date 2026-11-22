# Quick Design Spec: Smart UBE Sculpt Transfer

**Type:** Addition  
**System:** Smart Customization  
**Date:** 2026-11-20  
**Status:** Phase 1 measurement harness implemented; real-head calibration and visual approval pending. Phases 2–5 not started.  
**GDD Reference:** None found. Baseline: `scripts/retarget_head.py`, `scripts/check_retarget.cjs`, `components/hud/smart/`, `lib/smart/`, `lib/head/dynamicSculpt.ts`. No game brief, systems index or prior quick spec found.  
**Scope:** OBJ-to-UBE sculpt integration first. Document the ComfyUI boundary; do not build image reconstruction yet.

## Change Summary

Replace Smart Customization's direct uploaded-mesh assignment with the existing Python OBJ-to-jslot converter. Replay its sculpt offsets on the canonical default UBE head so the character retains UBE topology, UVs and skinning. The source OBJ is a fitting target, never replacement character geometry.

## Motivation

Direct replacement normalizes an arbitrary head but does not preserve the project's UBE face structure or texture compatibility. The user wants generated faces transferred onto the default head, represented by reusable RaceMenu sculpt data. Future ComfyUI image-to-OBJ output must feed this same pipeline.

## Design Delta

Current behavior, `components/hud/smart/SmartCustomization.tsx`:

> Assign on accept rather than waiting for Apply

Current `lib/smart/importHeadMesh.ts` parses OBJ/GLB/glTF, normalizes its geometry and registers the uploaded mesh itself as a head option with `headTextureMissing: true`. Image input only creates a local preview.

Replacement behavior:

1. Upload an isolated, upright, neutral-expression OBJ head.
2. Submit it to a local Next.js Node conversion endpoint.
3. Run `scripts/retarget_head.py` against the pinned canonical UBE base.
4. Validate the returned sculpt and fit metrics.
5. Replay the sculpt on that exact UBE base and preview the derived head.
6. Apply commits validated face state. Cancel restores the previous face.
7. Persist and download the sculpt used for preview, not just a mesh identifier.

A `dynamic://` render cache is allowed when derived from canonical UBE plus sculpt deltas. Directly registering uploaded geometry as the worn head is not.

## Fidelity Contract

| Claim | Contract |
| --- | --- |
| Photo-to-OBJ likeness | Future ComfyUI responsibility. Single-image reconstruction cannot guarantee the true 3D face. |
| OBJ-to-UBE likeness | Approximate constrained fitting. Measure and reject unacceptable results; never advertise exact identity from surface RMS alone. |
| Fitted UBE-to-jslot-to-UBE | Faithful numerical replay within sculpt quantization and floating-point tolerance. Required. |

Existing fitting pins open eye/mouth boundaries, protects the neck, smooths offsets and may reduce fit strength to prevent inverted triangles. These are current likeness limits, not solved by connecting an API. Eyelid and lip changes require coordinated companion-part work before broader likeness claims.

## Target Frontend/Backend Contract

Proposed endpoint: `POST /api/smart/retarget`, multipart field `file` containing OBJ; optional explicitly validated yaw/mirror overrides only if exposed by the UI.

Success response: a versioned envelope containing the parsed `.jslot` sculpt payload, fit metrics, converter version and canonical-base fingerprint. Preserve the authoritative payload for download. Do not return private filesystem paths.

Error response: stable error code and actionable message distinguishing invalid input, poor fit, busy capacity, timeout, missing toolchain and internal failure. No silent neutral-head success or direct-import fallback.

The backend chooses script, interpreter and canonical base from trusted server configuration. Clients cannot choose a base path, output path, executable or shell command.

## Implementation Plan

### Phase 1 — Prove fitting quality before UI integration

Reuse `scripts/retarget_head.py` and `scripts/check_retarget.cjs`.

- Establish reference fixtures: neutral UBE, known deformed UBE, unrelated-topology head, malformed/rejected input.
- Measure nose, eyes, lips, jaw and silhouette in addition to aggregate surface distance.
- Record alignment, fit strength, error and preservation of protected regions.
- Separate approximate fitting tests from exact encoding/replay tests.
- Compare front, profile and three-quarter views using consistent cameras and skin-off geometry views.
- Calibrate regional pass/fail thresholds against approved references. Current broad rejection thresholds are not a likeness specification.
- If real-head fitting is inadequate, improve correspondence with landmarks and constrained regional fitting. Do not remove neck protection or lower quality standards to obtain success.
- Coordinate eyelids/lips with eyes, lashes, brows and mouth when those regions move. Until supported, expose the limitation and reject unacceptable outcomes.

**Gate:** reference comparisons and numerical criteria approved before calling the converter production-ready. Integration work alone must not be represented as a likeness improvement.

#### Phase 1 evidence and reproducible commands

Implemented: `scripts/check_retarget_quality.py`, run on demand via `npm run check:retarget:quality`; optional `--report-dir` on both the quality suite and converter. Requires NumPy; PNG generation additionally uses Pillow. All checks run isolated Python (`-I`).

The quality suite is deliberately **not** part of `npm run check:retarget`: it performs several full surface fits and takes roughly four minutes, which would make the routine check unusable. `check:retarget` keeps the fast encoder/replay regression.

```text
npm run check:retarget                 # fast: encoding, replay, topology, collar
npm run check:retarget:quality         # slow (~4 min): regional fitting evidence
python -I scripts/check_retarget_quality.py --report-dir .scratch-weight/retarget-review-NEW
python -I scripts/retarget_head.py --mesh "path/to/isolated-head.obj" --out "path/to/new-result.jslot" --report-dir .scratch-weight/real-head-review-NEW
```

A single OBJ conversion currently costs roughly 46 s (dominated by two full surface searches), which fits the planned 180 s process timeout but leaves little headroom for larger inputs.

Report directories must not exist. Each fixture gets `metrics.json`, `comparison.png`, `source.obj` and `fitted.obj`. Comparisons use fixed orthographic front/profile/three-quarter views, identical scale, grayscale lighting and no textures. These are offline diagnostic renders, not verification of the live character renderer.

The suite separates exact encoder/JS replay checks from approximate fitting, verifies regional evaluator sensitivity with deliberately perturbed geometry, checks protected eye/lip boundary limitations, and rejects malformed OBJ and folded decoded geometry. Converter validation now also checks the quantized/decoded sculpt before writing it.

Diagnostic regions are canonical coordinate bands, not anatomical landmarks. Horizontal-band projected extents are silhouette proxies, not visibility-aware silhouettes. Metrics explicitly keep `likeness_approved: false`. Current regression ceilings (surface RMS 3 mm, p95 6 mm; projected-envelope RMS 2 mm; known-correspondence RMS 2.5 mm and maximum 4.5 mm) are synthetic failure guards, NOT approved production likeness thresholds.

Initial synthetic run: neutral fit unchanged; deformed and different-topology fixtures reduce fit strength to 0.5. Known-correspondence error reaches approximately 3.86 mm despite sub-millimetre surface RMS. Encoding coordinate error remains below 0.000644 mm; collar/protected displacement stays zero. This exposes a correspondence limitation rather than certifying likeness. No fitting safety constraints were weakened and no landmark fitting was added without a real reference.

**Still pending:** a representative independently authored/reconstructed isolated head OBJ; approved reference views; calibrated anatomical/companion-part criteria; any correspondence improvements needed to pass those criteria. Synthetic voxel-remeshing changes topology but is not an independent real-head reference. Phase 1 production-quality gate remains open.

### Phase 2 — Add bounded local conversion

Proposed file: `app/api/smart/retarget/route.ts`.

- MVP: local/self-hosted Next.js Node runtime with Python and NumPy installed. No Edge runtime; do not assume serverless supports this workload.
- OBJ only initially. Reject GLB/glTF explicitly; no alternate direct-import fallback.
- Preserve existing 64 MiB OBJ, 200,000-vertex and 400,000-triangle limits. Bound request reading before buffering the full upload, including multipart overhead separately.
- One active conversion per server process; reject extra work as busy. No queue service initially. Multiple processes require a shared concurrency mechanism before deployment at that scale.
- Initial process timeout: 180 seconds, subject to reference measurements; cap stdout/stderr and terminate work on timeout/cancellation.
- Invoke the converter with `python -I` and an argument array, never a shell-interpolated command.
- Create a new private temporary workspace per request, use generated filenames, keep trusted scripts outside it and never run from the upload directory.
- Use fixed trusted base/script paths; clean up on success, rejection, timeout and cancellation after subprocess termination.
- Validate converter output before responding; preserve rejected results as failures.
- Reject untrusted browser origins in local mode. Authentication, request throttling and resource isolation are prerequisites for public deployment.

### Phase 3 — Replace direct Smart imports

Primary existing files:

- `components/hud/smart/SmartCustomization.tsx`
- `components/hud/smart/SmartFooter.tsx`
- `lib/smart/session.ts`
- `lib/smart/importHeadMesh.ts`
- `lib/smart/smartMode.ts`, dropzone copy and `scripts/check_smart_import.cjs` as required by removal of direct-import behavior.

States: idle, converting, preview-ready, rejected. Keep Apply disabled until validated sculpt replay succeeds. Conversion is indeterminate unless real progress is available; do not invent a percentage.

- Preview derived UBE sculpt, not source OBJ geometry.
- Snapshot all face state changed by preview. Cancel/Return restores it; Apply commits only the accepted result.
- Neutralize existing head morph contributions during preview; do not double-apply old sliders or fit against an already-deformed head.
- Preserve unrelated body, equipment, hair and appearance state.
- Reject stale responses after a later upload, Cancel or navigation away. Abort work when possible.
- Use accessible status and error messages.
- Remove direct OBJ/GLB/glTF head assignment, the obsolete mesh-test branch and helpers/tests only after checking references. Preserve unrelated NIF and preset imports.
- Keep photo input explicitly unavailable for generation until the ComfyUI integration exists.

### Phase 4 — Make replay, persistence and export authoritative

Reuse `lib/head/dynamicSculpt.ts`, `lib/head/dynamicStorage.ts` and the current preset machinery; audit actual schemas before choosing the smallest compatible extension.

- Replay against the same fingerprinted canonical base used by Python, not whichever manifest head happens to match a filename.
- Validate host, vertex count, divisor, vertex indices, finite offsets and displacement limits.
- Do not let generated results use filename-based pre-baked shortcuts, heuristic compatibility acceptance or neutral-head fallback on error.
- Persist original sculpt payload, base identity and converter version. Preserve rollback state until Apply.
- Dynamic geometry is a disposable derived cache; reconstruct it from persisted sculpt after reload. Storage failure must be surfaced rather than presented as durable success.
- Preserve sculpt through application preset export/reimport; current JSON export must be audited, not assumed to include raw sculpt data.
- Offer `.jslot` download of the payload used for preview. Never re-derive it from the rendered mesh.
- A geometry-only `.jslot` is not a complete RaceMenu appearance preset. Verify in-game host/base compatibility separately before claiming Skyrim appearance parity.

### Phase 5 — Document the future ComfyUI boundary

Future sequence: photo, ComfyUI reconstruction, isolated OBJ, existing retarget pipeline, UBE sculpt preview, Apply/export.

Required upstream output: isolated neutral head, declared axes/units, no hair/torso/accessories, supported geometry limits. The converter's current input expects upright Y-up geometry; any future adapter must perform an explicit documented axis transform rather than guess silently.

No reconstruction model selection, GPU service, ComfyUI API integration or automatic photo transmission in this scope. A later approved integration must reuse the same retarget path. Provenance should identify the workflow/model/seed when available; generated OBJ remains untrusted input.

## Affected Systems

| System | Impact | Action |
| --- | --- | --- |
| Smart UI/session | Direct import replaced by validated conversion and reversible preview | Update handlers, state, status/copy and tests |
| Next.js backend | New bounded local Python conversion boundary | Add Node route and endpoint checks |
| Python retargeter | Shared fitting/encoding authority | Measure quality; improve correspondence only if reference gate requires it |
| Sculpt replay | Exact canonical-base and generated-result validation | Tighten or add a strict entry path while preserving general preset compatibility |
| Preset/storage/export | Sculpt payload must survive reload and transfer | Audit schema, minimally extend and verify |
| Scene/companions | Render canonical deformation; protect seams and eye/mouth relationships | Verify; coordinated fitting only where required |
| ComfyUI | Future producer of source OBJ | Document contract only |

## Acceptance Criteria

- [ ] Smart never assigns source OBJ/GLB/glTF geometry as the worn head; unsupported inputs fail explicitly.
- [ ] Vertex count/order, triangle indices, UVs and skinning remain canonical UBE.
- [ ] Neck seam remains unchanged; encoded geometry has no folded/collapsed triangles.
- [ ] Encoder round-trip error is at most half one sculpt quantization step per coordinate.
- [ ] Browser replay matches decoded fitted positions within the existing `1e-7 m` test tolerance.
- [ ] Reference-based regional likeness criteria are documented and met; current aggregate metrics alone do not qualify.
- [ ] Quality checks cover the displayed result, including later rendering/deformation, not only Python intermediates.
- [ ] Preview does not double-apply existing morphs; companion parts do not visibly detach or intersect beyond approved limits.
- [ ] Apply, reload, `.jslot` download and application preset export/reimport reproduce the accepted sculpt.
- [ ] Cancel, failed requests and stale responses preserve/restore previous character state.
- [ ] Invalid input, missing Python/NumPy/base, timeout, busy capacity and storage failure have actionable errors.
- [ ] Temporary files are isolated and cleaned up; client paths and shell text cannot influence process execution.
- [ ] Existing NIF/preset import, equipment and unrelated character controls remain functional.

## Verification

Required implementation checks:

```text
npm run typecheck
npm run check:retarget
npm run check:jslot
npm run check:neck
npm run check:skeleton
npm run check:smart
```

Update the Smart check to verify the new behavior. Leave runnable endpoint tests for malformed/oversized uploads, converter rejection/failure, timeout, output validation and cleanup. Existing retarget tests already cover synthetic fitting, encoding/replay, topology/UV preservation and collar invariance; real-head likeness and end-to-end browser behavior need additional evidence.

Browser verification: front/profile/three-quarter views, skin on/off, preview, Cancel, Apply, reload and export/reimport. Record actual outcomes; do not claim a skipped test passed.

## GDD Update Required?

No existing GDD found. This spec and `.claude/rules/smart-sculpt.md` are the approved feature record. Implementation requires a separate approval of the runtime change set. Rules are advisory; runtime validation and regression tests enforce the invariants.
