'use client';

import type { Mo2MeshOption } from '@/lib/head/faceTexture';
import {
  MAX_OBJ_BYTES,
  validateFitMetrics,
  validateSculptPayload,
  type SculptPayload,
  type SmartFitMetrics,
} from '@/lib/head/sculptPayload';
import {
  getDynamicMesh,
  removeDynamicHeadOption,
  replaySculptPayload,
} from '@/lib/head/dynamicSculpt';
import { isObjFile } from '@/lib/smart/smartMode';

/**
 * Client half of the Smart OBJ → UBE sculpt flow.
 *
 * The browser never parses the OBJ: it posts to `/api/smart/retarget`, validates
 * the payload against the same canonical contract, then replays it on the
 * verified UBE base. The upload is a fitting target, never replacement geometry.
 */

/** Error codes the route can return, plus the ones the client raises itself. */
export type RetargetErrorCode =
  | 'busy'
  | 'rejected-fit'
  | 'unavailable'
  | 'timeout'
  | 'invalid-output'
  | 'network'
  | 'too-large'
  | 'unsupported'
  | 'conversion-failed'
  | 'invalid-request'
  | 'forbidden'
  | 'cancelled';

export class SmartRetargetError extends Error {
  readonly code: RetargetErrorCode;

  constructor(code: RetargetErrorCode, message: string) {
    super(message);
    this.name = 'SmartRetargetError';
    this.code = code;
  }
}

const DEFAULT_MESSAGES: Record<RetargetErrorCode, string> = {
  busy: 'Another head is being fitted right now. Wait for it to finish, then try again.',
  'rejected-fit': 'The converter rejected this fit. Nothing was applied.',
  unavailable: 'Head fitting is unavailable. The local Python toolchain or the canonical UBE base is missing.',
  timeout: 'Fitting took too long and was stopped. Try again with a simpler isolated head.',
  'invalid-output': 'The converter returned an invalid sculpt. Nothing was applied.',
  network: 'Could not reach the fitting service. Check that the local server is still running.',
  'too-large': `That OBJ is too large (maximum ${MAX_OBJ_BYTES / (1024 * 1024)} MB).`,
  unsupported: 'Smart Customization accepts .obj only — export the isolated head as OBJ.',
  'conversion-failed': 'The converter failed before producing a sculpt. Nothing was applied.',
  'invalid-request': 'The fitting request was malformed. Nothing was applied.',
  forbidden: 'The fitting request was rejected by the local server.',
  cancelled: 'Fitting was cancelled.',
};

const CODES: readonly RetargetErrorCode[] = [
  'busy', 'rejected-fit', 'unavailable', 'timeout', 'invalid-output', 'network',
  'too-large', 'unsupported', 'conversion-failed', 'invalid-request', 'forbidden',
  'cancelled',
];

function asCode(value: unknown): RetargetErrorCode | null {
  return typeof value === 'string' && (CODES as readonly string[]).includes(value)
    ? (value as RetargetErrorCode)
    : null;
}

function statusCode(status: number): RetargetErrorCode {
  switch (status) {
    case 400: return 'invalid-request';
    case 403: return 'forbidden';
    case 413: return 'too-large';
    case 415: return 'unsupported';
    case 422: return 'rejected-fit';
    case 429: return 'busy';
    case 503: return 'unavailable';
    case 504: return 'timeout';
    default: return 'conversion-failed';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError');
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export interface RetargetResult {
  sculpt: SculptPayload;
  metrics: SmartFitMetrics;
}

/**
 * POST the OBJ and return a validated sculpt. The client re-validates what the
 * server sent so a truncated/tampered response can never reach replay. Throws
 * `SmartRetargetError` with an actionable message on every failure.
 */
export async function retargetHeadObj(file: File, signal: AbortSignal): Promise<RetargetResult> {
  if (!isObjFile(file.name)) {
    throw new SmartRetargetError('unsupported', DEFAULT_MESSAGES.unsupported);
  }
  if (file.size > MAX_OBJ_BYTES) {
    throw new SmartRetargetError('too-large', DEFAULT_MESSAGES['too-large']);
  }

  const body = new FormData();
  /* Generated field name; the server derives its own temp filename and never
     trusts this one. The original name is still sent for the error copy. */
  body.append('file', file, file.name);

  let response: Response;
  try {
    response = await fetch('/api/smart/retarget', {
      method: 'POST',
      body,
      signal,
      cache: 'no-store',
    });
  } catch (caught) {
    if (isAbort(caught, signal)) {
      throw new SmartRetargetError('cancelled', DEFAULT_MESSAGES.cancelled);
    }
    throw new SmartRetargetError('network', DEFAULT_MESSAGES.network);
  }

  const parsed = await readJson(response);
  if (!response.ok || !record(parsed) || parsed.ok !== true) {
    const code = (record(parsed) ? asCode(parsed.code) : null) ?? statusCode(response.status);
    const serverMessage = record(parsed) && typeof parsed.error === 'string'
      ? parsed.error.trim()
      : '';
    throw new SmartRetargetError(code, serverMessage || DEFAULT_MESSAGES[code]);
  }

  const sculpt = validateSculptPayload(parsed.sculpt);
  if (!sculpt.ok) {
    throw new SmartRetargetError('invalid-output', `The converter returned an invalid sculpt: ${sculpt.reason}`);
  }

  let metrics: SmartFitMetrics;
  try {
    metrics = validateFitMetrics(parsed.metrics);
  } catch {
    throw new SmartRetargetError(
      'invalid-output',
      'The converter returned fitting metrics that failed validation. Nothing was applied.',
    );
  }

  return { sculpt: sculpt.payload, metrics };
}

export interface SculptPreview {
  option: Mo2MeshOption;
  /** Front-projected edge list for the dropzone ring, built from the fitted UBE. */
  previewEdges: Float32Array;
}

/**
 * Replay the sculpt on the canonical base and build the ring preview. Replay
 * registers a transient option, so any later failure must remove it — a failed
 * preview must never leave a phantom head in the picker.
 */
export async function applySculptPreview(
  payload: SculptPayload,
  fileName: string,
): Promise<SculptPreview> {
  let option: Mo2MeshOption;
  try {
    option = await replaySculptPayload(payload, fileName);
  } catch (caught) {
    /* Replay itself failed before registration (base missing, bad payload);
       the strict path is expected to leave no option behind. */
    throw new SmartRetargetError(
      'unavailable',
      caught instanceof Error && caught.message
        ? caught.message
        : 'The fitted head could not be built. The canonical UBE base may be unavailable.',
    );
  }

  try {
    const mesh = option.meshUrl ? getDynamicMesh(option.meshUrl) : undefined;
    if (!mesh) throw new Error('fitted geometry missing from the dynamic registry');
    return { option, previewEdges: frontEdges(mesh.positions, mesh.indices) };
  } catch (caught) {
    removeDynamicHeadOption(option.id);
    throw new SmartRetargetError(
      'invalid-output',
      caught instanceof Error && caught.message
        ? `The fitted head was registered but could not be prepared: ${caught.message}. Nothing was applied.`
        : 'The fitted head was registered but could not be prepared. Nothing was applied.',
    );
  }
}

/**
 * Project the front (X/Y) view to a square edge list for the ring, from the
 * fitted `MeshData` only (the OBJ is never parsed here). Edges are deduped and
 * the index count is capped so a dense mesh cannot stall the thread.
 */
export function frontEdges(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  size = 132,
): Float32Array {
  const vertexCount = Math.floor(positions.length / 3);
  if (vertexCount === 0) return new Float32Array(0);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return new Float32Array(0);

  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const pad = size * 0.12;
  const scale = (size - pad * 2) / span;
  const offsetX = (size - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (size - (maxY - minY) * scale) / 2 - minY * scale;

  const seen = new Set<number>();
  const edges: number[] = [];
  const pushEdge = (a: number, b: number) => {
    if (a < 0 || b < 0 || a >= vertexCount || b >= vertexCount) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * vertexCount + hi;
    if (seen.has(key)) return;
    seen.add(key);
    /* Y is flipped so the canvas reads the model the right way up. */
    edges.push(
      positions[lo * 3] * scale + offsetX,
      size - (positions[lo * 3 + 1] * scale + offsetY),
      positions[hi * 3] * scale + offsetX,
      size - (positions[hi * 3 + 1] * scale + offsetY),
    );
  };

  const limit = Math.min(indices.length, 60_000);
  for (let t = 0; t + 2 < limit; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    pushEdge(a, b);
    pushEdge(b, c);
    pushEdge(c, a);
  }

  return new Float32Array(edges);
}

/** Download the authoritative sculpt payload as a `.jslot` — the only durable
 *  copy, since the session is never persisted. */
export function downloadJslot(payload: SculptPayload, fileName: string): void {
  const stem = (payload.name || fileName.replace(/\.obj$/i, '')).trim() || 'smart-head';
  const safe = stem
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 96)
    .trim() || 'smart-head';
  const name = safe.toLowerCase().endsWith('.jslot') ? safe : `${safe}.jslot`;

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** One honest fit line. Never says "likeness": surface RMS is an approximate
 *  fitting measurement, not a claim the result looks like the source. */
export function fitSummary(metrics: SmartFitMetrics): string {
  const strength = Math.round(metrics.fit_strength * 100);
  const rms = (metrics.face_surface_rms_m * 1000).toFixed(1);
  return `approx. fit ${strength}% · surface RMS ${rms} mm`;
}
