/** Local HDRI limits protect decoding and PMREM memory; no upload/network service. */
export const HDR_MAX_BYTES = 32 * 1024 * 1024;
export const HDR_MAX_PIXELS = 8 * 1024 * 1024;
export const HDR_MAX_EDGE = 4096;
export type HdrFormat = 'hdr' | 'exr';

export function hdrFormat(name: string, size: number): HdrFormat {
  const format = name.toLowerCase().split('.').pop();
  if (format !== 'hdr' && format !== 'exr') throw new Error('Choose a Radiance .hdr or OpenEXR .exr file.');
  if (!Number.isFinite(size) || size <= 0 || size > HDR_MAX_BYTES) throw new Error('HDR files must be nonempty and no larger than 32 MiB.');
  return format;
}
export function checkHdrDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      width > HDR_MAX_EDGE || height > HDR_MAX_EDGE || width * height > HDR_MAX_PIXELS) {
    throw new Error('Use an HDRI up to 4096 pixels per edge and 8 megapixels (for example 4096 × 2048).');
  }
}

/** Check the allocation dimensions in the header before invoking a decoder. */
export function inspectHdrHeader(buffer: ArrayBuffer, format: HdrFormat) {
  const bytes = new Uint8Array(buffer);
  let width = 0, height = 0;
  if (format === 'hdr') {
    const header = new TextDecoder().decode(bytes.subarray(0, 65536));
    if (!/^#\?(RADIANCE|RGBE)\r?\n/.test(header)) throw new Error('Invalid Radiance HDR header.');
    const match = header.match(/(?:^|\n)-Y\s+(\d+)\s+\+X\s+(\d+)(?:\r?\n|$)/);
    if (!match) throw new Error('Unsupported HDR orientation; use a standard -Y +X equirectangular export.');
    height = Number(match[1]); width = Number(match[2]);
  } else {
    const view = new DataView(buffer);
    if (bytes.length < 8 || view.getUint32(0, true) !== 20000630) throw new Error('Invalid OpenEXR header.');
    const version = view.getUint32(4, true);
    if ((version & 255) !== 2 || (version & (0x200 | 0x800 | 0x1000))) {
      throw new Error('Use a single-part, scanline, non-deep OpenEXR panorama.');
    }
    let offset = 8;
    const limit = Math.min(bytes.length, 1024 * 1024);
    const string = () => {
      const start = offset;
      while (offset < limit && bytes[offset] !== 0) offset++;
      if (offset >= limit) throw new Error('Truncated or oversized EXR header.');
      const value = new TextDecoder().decode(bytes.subarray(start, offset));
      offset++;
      return value;
    };
    let ended = false, foundWindow = false;
    while (offset < limit) {
      const name = string();
      if (!name) { ended = true; break; }
      const type = string();
      if (offset + 4 > limit) throw new Error('Truncated EXR attribute.');
      const size = view.getUint32(offset, true); offset += 4;
      if (offset + size > limit) throw new Error('Invalid EXR attribute size.');
      if (name === 'dataWindow') {
        if (foundWindow || type !== 'box2i' || size !== 16) throw new Error('Invalid EXR data window.');
        width = view.getInt32(offset + 8, true) - view.getInt32(offset, true) + 1;
        height = view.getInt32(offset + 12, true) - view.getInt32(offset + 4, true) + 1;
        foundWindow = true;
      }
      offset += size;
    }
    if (!ended || !foundWindow) throw new Error('Missing EXR data window or header terminator.');
  }
  checkHdrDimensions(width, height);
  return { width, height };
}
