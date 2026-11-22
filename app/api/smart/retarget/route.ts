import { execFile } from 'node:child_process';
import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CANONICAL_HEAD_URL,
  MAX_OBJ_BYTES,
  validateFitMetrics,
  validateSculptPayload,
} from '@/lib/head/sculptPayload';

/**
 * POST /api/smart/retarget
 *
 * Local, single-flight OBJ -> UBE .jslot conversion for Smart Customization.
 * The upload is a fitting target only; the response is a sculpt payload that
 * replays against the canonical UBE base. This route never returns uploaded
 * geometry as character data.
 *
 * Trust boundaries:
 * - The request body is streamed and capped before any multipart parsing;
 *   Content-Length is a hint, never a guarantee.
 * - Only `scripts/retarget_head.py` at a fixed absolute path runs, with a
 *   fixed argument array, a private mkdtemp workspace and a generated
 *   `input.obj` / `out.jslot` name. The client filename is only inspected
 *   for its `.obj` extension and never used on disk.
 * - stderr is classified into fixed messages; converter paths and arbitrary
 *   stdout fields never reach the client.
 */

export const runtime = 'nodejs';
export const maxDuration = 180;

const PROJECT_ROOT = process.cwd();
const SCRIPT_PATH = path.join(PROJECT_ROOT, 'scripts', 'retarget_head.py');
const BASE_PATH = path.join(PROJECT_ROOT, 'public', CANONICAL_HEAD_URL.replace(/^\/+/, ''));

/** 64 MiB file + multipart envelope overhead. */
const STREAM_CAP = 66 * 1024 * 1024;
const READ_TIMEOUT_MS = 30_000;
const PROCESS_TIMEOUT_MS = 180_000;
const MAX_BUFFER = 32 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

type ErrorCode =
  | 'busy'
  | 'rejected-fit'
  | 'unavailable'
  | 'timeout'
  | 'invalid-output'
  | 'too-large'
  | 'unsupported'
  | 'invalid-request'
  | 'forbidden'
  | 'conversion-failed'
  | 'cancelled';

const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

/** Module-level single-flight flag. JS is single-threaded, so the check and
 *  set below happen atomically before the first await. */
let conversionInFlight = false;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function failure(status: number, code: ErrorCode, error: string): Response {
  return json({ ok: false, error, code }, status);
}

type BodyRead =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'empty' | 'too-large' | 'timeout' | 'cancelled' | 'unreadable' };

/** Read the request stream ourselves so the cap applies to actual bytes, not
 *  to a spoofable Content-Length. */
async function readCappedBody(request: Request): Promise<BodyRead> {
  if (!request.body) return { ok: false, reason: 'empty' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), READ_TIMEOUT_MS);
  });
  const cancelled = new Promise<'cancelled'>((resolve) => {
    if (request.signal.aborted) {
      resolve('cancelled');
      return;
    }
    onAbort = () => resolve('cancelled');
    request.signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    for (;;) {
      const pending = reader.read();
      // If the timeout/cancel arm wins, this read is abandoned; a later
      // cancel() settles it, and this catch keeps that from surfacing as an
      // unhandled rejection.
      pending.catch(() => {});
      const next: ReadableStreamReadResult<Uint8Array> | 'timeout' | 'cancelled' =
        await Promise.race([pending, timeout, cancelled]);
      if (typeof next === 'string') {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: next };
      }
      if (next.done) break;
      if (next.value && next.value.byteLength > 0) {
        total += next.value.byteLength;
        if (total > STREAM_CAP) {
          await reader.cancel().catch(() => {});
          return { ok: false, reason: 'too-large' };
        }
        chunks.push(next.value);
      }
    }
  } catch {
    return { ok: false, reason: 'unreadable' };
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) request.signal.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* already released by cancel */
    }
  }

  if (total === 0) return { ok: false, reason: 'empty' };
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/** Local-only deployment gate plus a browser CSRF guard. CLI clients send
 *  neither Origin nor Sec-Fetch-Site and are allowed on a loopback host. */
function originGuard(request: Request): Response | null {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const loopback =
    host === 'localhost' ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    host === '::1' ||
    host === '[::1]' ||
    host === '[::ffff:127.0.0.1]' ||
    host === '[::ffff:7f00:1]';
  if (!loopback) {
    return failure(403, 'forbidden', 'Smart retarget is available only from localhost.');
  }

  const origin = request.headers.get('origin');
  if (origin !== null && origin !== url.origin) {
    return failure(403, 'forbidden', 'Cross-origin requests are not allowed.');
  }

  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return failure(403, 'forbidden', 'Cross-site requests are not allowed.');
  }
  return null;
}

interface ConverterResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  spawnFailed: boolean;
  overflow: boolean;
}

/**
 * Run the converter and resolve only after the child actually closes.
 * execFile's callback can fire (with AbortError) before `close`; cleaning up
 * the workspace at that point can race a still-open file handle on Windows.
 */
function runConverter(meshPath: string, outPath: string, signal: AbortSignal): Promise<ConverterResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let callbackDone = false;
    let closed = false;
    let settled = false;
    let callbackError: { code?: string | number | null } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (exitCode: number | null) => {
      if (settled || !callbackDone || !closed) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        code: exitCode,
        stdout,
        stderr,
        timedOut,
        // A normal exit keeps cancelled false even if the request aborted late.
        cancelled: signal.aborted && exitCode === null && !timedOut,
        spawnFailed: callbackError?.code === 'ENOENT',
        overflow: callbackError?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      });
    };

    const python = (process.env.MO2_PYTHON ?? '').trim() || 'python';
    const child = execFile(
      python,
      ['-I', SCRIPT_PATH, '--mesh', meshPath, '--base', BASE_PATH, '--out', outPath],
      {
        cwd: PROJECT_ROOT,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        signal,
        env: {
          ...process.env,
          OPENBLAS_NUM_THREADS: '1',
          OMP_NUM_THREADS: '1',
          PYTHONDONTWRITEBYTECODE: '1',
        },
      },
      (error, out, err) => {
        callbackError = error;
        stdout = out ?? '';
        stderr = err ?? '';
        callbackDone = true;
        // A spawn failure (missing interpreter, EACCES) never produced a
        // process, so Node emits no `close` and there is nothing to clean up
        // that could still be open. A post-spawn abort does emit `close`; we
        // wait for it so the workspace is not removed under a dying process.
        if (error && child.pid === undefined) closed = true;
        settle(child.exitCode);
      },
    );

    child.once('close', (code) => {
      closed = true;
      settle(code ?? child.exitCode);
    });

    timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        timedOut = true;
        child.kill('SIGKILL');
      }
    }, PROCESS_TIMEOUT_MS);
  });
}

interface ClassifiedFailure {
  status: number;
  code: ErrorCode;
  message: string;
}

/** Fixed user-facing messages only: no stderr text, paths or metrics echo. */
function classifyFailure(result: ConverterResult): ClassifiedFailure {
  if (result.cancelled) {
    return { status: 499, code: 'cancelled', message: 'Conversion was cancelled.' };
  }
  if (result.timedOut) {
    return { status: 504, code: 'timeout', message: 'Conversion timed out. Try a simpler or decimated head mesh.' };
  }
  if (result.spawnFailed) {
    return { status: 503, code: 'unavailable', message: 'Conversion requires a Python interpreter on the server.' };
  }
  if (result.overflow) {
    return { status: 502, code: 'invalid-output', message: 'Converter produced unexpected output.' };
  }

  const stderr = result.stderr;
  if (/No module named ['"]?numpy/i.test(stderr)) {
    return { status: 503, code: 'unavailable', message: 'Conversion requires Python with NumPy available to the server.' };
  }
  if (/OBJ exceeds 64 MiB/i.test(stderr)) {
    return { status: 413, code: 'too-large', message: 'The OBJ exceeds the 64 MiB limit.' };
  }
  if (/Fit rejected:|Expected an isolated, upright|No face vertices available/i.test(stderr)) {
    return {
      status: 422,
      code: 'rejected-fit',
      message: 'The uploaded head could not be fitted. Use an isolated, upright head OBJ with no torso or shoulders.',
    };
  }
  if (/OBJ line|OBJ needs vertices|OBJ contains|OBJ too dense|degenerate triangles|Pathological OBJ topology|face index out of range|homogeneous vertex/i.test(stderr)) {
    return { status: 422, code: 'invalid-request', message: 'The uploaded file is not a usable OBJ head mesh.' };
  }
  if (/Base must be the canonical|Base vertex order|Cannot read canonical UBE|Output already exists|Report directory already exists/i.test(stderr)) {
    return {
      status: 500,
      code: 'conversion-failed',
      message: 'Converter configuration is invalid; regenerate the preset pack and retry.',
    };
  }
  return { status: 500, code: 'conversion-failed', message: 'Conversion failed on the server.' };
}

export async function POST(request: Request): Promise<Response> {
  const blocked = originGuard(request);
  if (blocked) return blocked;

  // Acquire synchronously before touching the request body. Release happens
  // in `finally`, after the child has closed and the workspace is removed.
  if (conversionInFlight) {
    return new Response(JSON.stringify({ ok: false, code: 'busy', error: 'Another head conversion is already running. Try again when it finishes.' }), {
      status: 429, headers: { ...HEADERS, 'Retry-After': '5' },
    });
  }
  conversionInFlight = true;

  let workspace: string | null = null;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!/^multipart\/form-data\b/i.test(contentType)) {
      return failure(415, 'unsupported', 'Upload the .obj as a multipart form field named "file".');
    }

    const declared = Number(request.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > STREAM_CAP) {
      return failure(413, 'too-large', 'The upload exceeds the 64 MiB limit.');
    }

    const body = await readCappedBody(request);
    if (!body.ok) {
      switch (body.reason) {
        case 'too-large':
          return failure(413, 'too-large', 'The upload exceeds the 64 MiB limit.');
        case 'timeout':
          return failure(408, 'timeout', 'Uploading the file took too long.');
        case 'cancelled':
          return failure(499, 'cancelled', 'Upload cancelled.');
        case 'empty':
          return failure(400, 'invalid-request', 'The request body is empty.');
        default:
          return failure(400, 'invalid-request', 'Could not read the request body.');
      }
    }

    // Parse only the bounded copy. Never call formData() on the unbounded
    // original request.
    let form: FormData;
    try {
      const bounded = new Request(request.url, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: new Blob([new Uint8Array(body.bytes)], { type: contentType }),
      });
      form = await bounded.formData();
    } catch {
      return failure(400, 'invalid-request', 'Could not read the uploaded form data.');
    }

    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return failure(400, 'invalid-request', 'Send the head as a multipart field named "file".');
    }
    if (!/\.obj$/i.test(file.name)) {
      return failure(415, 'unsupported', 'Smart Customization accepts .obj only. Export the isolated head as OBJ.');
    }
    if (file.size === 0) {
      return failure(400, 'invalid-request', 'The uploaded OBJ is empty.');
    }
    if (file.size > MAX_OBJ_BYTES) {
      return failure(413, 'too-large', 'The OBJ exceeds the 64 MiB limit.');
    }

    // Converter and canonical base are deployment inputs, checked before any
    // temp workspace exists so a missing sync fails fast.
    try {
      const [scriptInfo, baseInfo] = await Promise.all([fs.stat(SCRIPT_PATH), fs.stat(BASE_PATH)]);
      if (!scriptInfo.isFile() || !baseInfo.isFile() || baseInfo.size === 0) {
        throw new Error('missing converter input');
      }
    } catch {
      return failure(503, 'unavailable', 'The head converter is unavailable; run `npm run sync:presets` and retry.');
    }

    if (request.signal.aborted) return failure(499, 'cancelled', 'Conversion was cancelled.');

    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ube-retarget-'));
    const inputPath = path.join(workspace, 'input.obj');
    const outputPath = path.join(workspace, 'out.jslot');

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) {
      return failure(400, 'invalid-request', 'The uploaded OBJ is empty.');
    }
    if (bytes.byteLength > MAX_OBJ_BYTES) {
      return failure(413, 'too-large', 'The OBJ exceeds the 64 MiB limit.');
    }
    // Generated name, exclusive create. The client name never reaches disk.
    await fs.writeFile(inputPath, bytes, { flag: 'wx' });

    if (request.signal.aborted) return failure(499, 'cancelled', 'Conversion was cancelled.');

    const result = await runConverter(inputPath, outputPath, request.signal);
    if (result.code !== 0) {
      const classified = classifyFailure(result);
      return failure(classified.status, classified.code, classified.message);
    }

    // Bound the output before reading it; the sculpt is ~400 KiB, so 8 MiB is
    // already generous and anything larger is a contract violation.
    let outputInfo: Stats;
    try {
      outputInfo = await fs.stat(outputPath);
    } catch {
      return failure(502, 'invalid-output', 'Converter produced no sculpt output.');
    }
    if (!outputInfo.isFile() || outputInfo.size <= 0 || outputInfo.size > MAX_OUTPUT_BYTES) {
      return failure(502, 'invalid-output', 'Converter produced no valid sculpt output.');
    }

    let rawSculpt: unknown;
    try {
      rawSculpt = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    } catch {
      return failure(502, 'invalid-output', 'Converter produced unreadable sculpt output.');
    }
    const sculpt = validateSculptPayload(rawSculpt);
    if (!sculpt.ok) {
      return failure(502, 'invalid-output', 'Converter produced an invalid sculpt payload.');
    }

    // stdout is one JSON line. Whitelisting happens in validateFitMetrics, so
    // `output` and any extra converter fields are dropped here.
    const line = result.stdout.trim().split(/\r?\n/).pop() ?? '';
    let metrics: ReturnType<typeof validateFitMetrics>;
    try {
      metrics = validateFitMetrics(JSON.parse(line));
    } catch {
      return failure(502, 'invalid-output', 'Converter returned out-of-contract fitting metrics.');
    }

    sculpt.payload.name = file.name.replace(/\.obj$/i, '').replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 128).trim() || 'Smart sculpt';
    return json({ ok: true, sculpt: sculpt.payload, metrics }, 200);
  } catch {
    return failure(500, 'conversion-failed', 'Conversion failed on the server.');
  } finally {
    if (workspace) {
      await fs
        .rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        .catch(() => {});
    }
    conversionInFlight = false;
  }
}
