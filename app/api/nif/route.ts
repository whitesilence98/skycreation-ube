import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export async function POST(request: NextRequest) {
  try {
    let buffer: Buffer;
    let fileName = 'custom.nif';

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file || !(file instanceof Blob)) {
        return NextResponse.json({ ok: false, error: 'No NIF file provided in form data' }, { status: 400 });
      }
      if ('name' in file && typeof file.name === 'string') {
        fileName = file.name;
      }
      buffer = Buffer.from(await file.arrayBuffer());
    } else {
      const headerName = request.headers.get('x-filename');
      const paramName = request.nextUrl.searchParams.get('name');
      if (headerName) fileName = headerName;
      else if (paramName) fileName = paramName;

      const arrayBuffer = await request.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        return NextResponse.json({ ok: false, error: 'Empty file payload' }, { status: 400 });
      }
      buffer = Buffer.from(arrayBuffer);
    }

    // Verify NIF magic header (Gamebryo File Format / NetImmerse File Format)
    const headerPrefix = buffer.subarray(0, 32).toString('latin1');
    if (!headerPrefix.startsWith('Gamebryo File Format') && !headerPrefix.startsWith('NetImmerse File Format')) {
      return NextResponse.json({ ok: false, error: 'Not a valid Bethesda NIF file' }, { status: 422 });
    }

    const tmpDir = os.tmpdir();
    const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tmpIn = path.join(tmpDir, `upload_${nonce}.nif`);
    const tmpOut = path.join(tmpDir, `upload_${nonce}.json`);

    await fs.writeFile(tmpIn, buffer);

    const scriptPath = path.resolve(process.cwd(), 'scripts', 'decode_nif.py');
    try {
      await execFileAsync('python', [scriptPath, tmpIn, tmpOut], {
        maxBuffer: 32 * 1024 * 1024,
      });

      const outText = await fs.readFile(tmpOut, 'utf8');
      const data = JSON.parse(outText);

      return NextResponse.json({
        ok: true,
        fileName,
        ...data,
      });
    } finally {
      // Clean up temp files
      await fs.unlink(tmpIn).catch(() => {});
      await fs.unlink(tmpOut).catch(() => {});
    }
  } catch (err) {
    console.error('[api/nif] Error decoding NIF:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to decode NIF file' },
      { status: 500 },
    );
  }
}
