// Run: node scripts/check_overlay_layers.cjs
//
// Regression for the makeup blend + coverage feature. Three contracts:
//
//   1. Preset / session validation accepts the new *optional* keys, so every
//      file written before this feature still imports, and rejects blends and
//      coverages that would reach the compositor unchecked.
//   2. The store setters clamp coverage, validate the blend vocabulary, ignore
//      non-finite values, and keep `activeOverlay` out of presets.
//   3. The compositor really thresholds mask alpha by coverage and really
//      draws with the requested canvas blend mode — checked against a minimal
//      2D-canvas mock so this adds no dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const cache = new Map();

function load(name, extraGlobals = {}) {
  const file = path.join(root, name + '.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      module,
      exports: module.exports,
      console,
      process,
      ...extraGlobals,
      require: (id) => (id.startsWith('@/') ? load(id.slice(2), extraGlobals) : require(id)),
    },
    { filename: file },
  );
  return module.exports;
}

// ── a minimal 2D canvas mock ───────────────────────────────────────────────
// Only the operations `compositeOverlays` performs are implemented. Every
// mocked canvas is 32×32 (the size the probe already samples at), so the
// mask pixel grids below are read back verbatim.
const SIZE = 32;
const created = [];

function createMockCtx(canvas) {
  return {
    canvas,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000000',
    _pixels: null,
    _saved: null,
    _ops: [],
    _readCalls: 0,
    save() {
      this._saved = { alpha: this.globalAlpha, op: this.globalCompositeOperation };
    },
    restore() {
      if (!this._saved) return;
      this.globalAlpha = this._saved.alpha;
      this.globalCompositeOperation = this._saved.op;
      this._saved = null;
    },
    drawImage(source) {
      const src =
        source && source.__kind === 'mask'
          ? source.pixels
          : source && source.__kind === 'canvas' && source._ctx._pixels
            ? source._ctx._pixels
            : null;
      this._ops.push({
        op: 'drawImage',
        alpha: this.globalAlpha,
        composite: this.globalCompositeOperation,
        source: source?.__kind ?? 'image',
      });
      if (!src) return;
      const w = this.canvas.width || SIZE;
      const h = this.canvas.height || SIZE;
      const out = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          // Nearest-neighbour: every source here is already 32×32 or a scaled
          // copy of one, which is all the probe reads.
          const si = (y * SIZE + x) * 4;
          if (si + 3 >= src.length) continue;
          const di = (y * w + x) * 4;
          out[di] = src[si];
          out[di + 1] = src[si + 1];
          out[di + 2] = src[si + 2];
          out[di + 3] = src[si + 3];
        }
      }
      this._pixels = out;
    },
    getImageData(x, y, w, h) {
      this._readCalls += 1;
      const data = this._pixels
        ? new Uint8ClampedArray(this._pixels)
        : new Uint8ClampedArray(w * h * 4);
      return { width: w, height: h, data };
    },
    putImageData(imgData) {
      this._pixels = new Uint8ClampedArray(imgData.data);
    },
    fillRect() {
      this._ops.push({ op: 'fillRect', composite: this.globalCompositeOperation });
      if (this.globalCompositeOperation !== 'source-in' || !this._pixels) return;
      const hex = String(this.fillStyle);
      if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const d = this._pixels;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
      }
    },
  };
}

function createMockCanvas() {
  const canvas = {
    __kind: 'canvas',
    width: SIZE,
    height: SIZE,
    _ctx: null,
    getContext(type) {
      return type === '2d' ? this._ctx : null;
    },
  };
  canvas._ctx = createMockCtx(canvas);
  return canvas;
}

const documentMock = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    const canvas = createMockCanvas();
    created.push(canvas);
    return canvas;
  },
};

/** An alpha-bearing mask; `alphas` cycles across the 32×32 grid. */
function alphaMask(alphas) {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const o = i * 4;
    pixels[o] = 255;
    pixels[o + 1] = 255;
    pixels[o + 2] = 255;
    pixels[o + 3] = alphas[i % alphas.length];
  }
  return { __kind: 'mask', pixels };
}

/** An opaque greyscale mask: coverage is carried in luminance, alpha is 255. */
function luminanceMask(lums) {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const o = i * 4;
    const lum = lums[i % lums.length];
    pixels[o] = lum;
    pixels[o + 1] = lum;
    pixels[o + 2] = lum;
    pixels[o + 3] = 255;
  }
  return { __kind: 'mask', pixels };
}

const overlay = load('lib/head/overlayLayers', {
  document: documentMock,
  Image: function ImageStub() {},
});
const { compositeOverlays, coverageAlpha, overlayCoverage } = overlay;

function compositeOne(layer, mask) {
  created.length = 0;
  const main = createMockCanvas();
  const ctx = main.getContext('2d');
  const drawn = compositeOverlays(ctx, [{ layer, mask }], SIZE);
  return { drawn, ctx, scratch: created[0], probe: created[1], created: created.slice() };
}

const alphaAt = (result, pixel) => result.ctx._pixels[pixel * 4 + 3];
const rgbAt = (result, pixel) => [
  result.ctx._pixels[pixel * 4],
  result.ctx._pixels[pixel * 4 + 1],
  result.ctx._pixels[pixel * 4 + 2],
];

const baseLayer = {
  kind: 'makeup',
  id: 'layer-a',
  color: '#123456',
  opacity: 0.5,
};

// ── 1. validation: optional keys, closed vocabularies ─────────────────────
const io = load('lib/presetIO');
assert.deepEqual(Array.from(io.OVERLAY_BLENDS), ['normal', 'multiply', 'screen', 'overlay']);
assert.equal(io.isOverlayLayers([baseLayer]), true, 'a pre-feature layer is still valid');
assert.equal(
  io.isOverlayLayers([{ ...baseLayer, blend: 'multiply', coverage: 0.25 }]),
  true,
  'the new keys are accepted',
);
for (const blend of ['normal', 'multiply', 'screen', 'overlay']) {
  assert.equal(io.isOverlayLayers([{ ...baseLayer, blend }]), true, `blend ${blend} is valid`);
}
assert.equal(io.isOverlayLayers([{ ...baseLayer, blend: 'bogus' }]), false, 'unknown blend rejected');
assert.equal(io.isOverlayLayers([{ ...baseLayer, coverage: 1.5 }]), false, 'coverage > 1 rejected');
assert.equal(io.isOverlayLayers([{ ...baseLayer, coverage: -0.1 }]), false, 'coverage < 0 rejected');
assert.equal(io.isOverlayLayers([{ ...baseLayer, coverage: NaN }]), false, 'NaN coverage rejected');
assert.equal(io.isOverlayLayers([{ ...baseLayer, coverage: '0.5' }]), false, 'string coverage rejected');

// A full LYRA export parses with the optional keys, and an old one without
// them keeps importing exactly as before.
const regions = load('lib/regions');
const regionData = Object.fromEntries(
  regions.REGIONS.map((r) => [
    r.id,
    {
      sliders: r.defaults,
      pose: { offset: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] },
    },
  ]),
);
const exportFile = (overlays) => JSON.stringify({
  format: io.PRESET_FORMAT,
  version: 2,
  name: 'overlay-check',
  regions: regionData,
  overlays,
});
const parsedNew = io.parsePreset(exportFile([{ ...baseLayer, blend: 'screen', coverage: 0.3 }]));
assert.deepEqual(JSON.parse(JSON.stringify(parsedNew.overlays)), [
  { ...baseLayer, blend: 'screen', coverage: 0.3 },
]);
const parsedOld = io.parsePreset(exportFile([baseLayer]));
assert.deepEqual(JSON.parse(JSON.stringify(parsedOld.overlays)), [baseLayer]);
const parsedBad = io.parsePreset(exportFile([{ ...baseLayer, blend: 'bogus' }]));
assert.equal(JSON.stringify(parsedBad.overlays), '[]', 'invalid rows are removed, even when none survive');
console.log('overlay validation (optional blend/coverage): ok');

// ── 2. store: setters clamp, validate, and stay UI-only ───────────────────
const { useCharacter } = load('lib/store');
const state = () => useCharacter.getState();
state().setOverlayLayers([baseLayer]);

state().setOverlayBlend('makeup', 'layer-a', 'multiply');
assert.equal(state().overlayLayers[0].blend, 'multiply');
state().setOverlayBlend('makeup', 'layer-a', 'bogus');
assert.equal(state().overlayLayers[0].blend, 'multiply', 'an unknown blend must not overwrite a valid one');
state().setOverlayBlend('makeup', 'missing', 'screen');
assert.equal(state().overlayLayers.length, 1, 'a missing layer is a no-op');

state().setOverlayCoverage('makeup', 'layer-a', 1.7);
assert.equal(state().overlayLayers[0].coverage, 1, 'coverage clamps to 1');
state().setOverlayCoverage('makeup', 'layer-a', -2);
assert.equal(state().overlayLayers[0].coverage, 0, 'coverage clamps to 0');
state().setOverlayCoverage('makeup', 'layer-a', 0.4);
assert.equal(state().overlayLayers[0].coverage, 0.4);
state().setOverlayCoverage('makeup', 'layer-a', NaN);
assert.equal(state().overlayLayers[0].coverage, 0.4, 'NaN coverage is ignored, not coerced to 0');
state().setOverlayCoverage('makeup', 'layer-a', Infinity);
assert.equal(state().overlayLayers[0].coverage, 0.4, 'infinite coverage is ignored');
state().setOverlayCoverage('makeup', 'layer-a', 0.4);
assert.equal(state().overlayLayers[0].coverage, 0.4);

state().setOverlayBlend('makeup', 'layer-a', 'screen');
state().setActiveOverlay('makeup:layer-a');
assert.equal(state().activeOverlay, 'makeup:layer-a');

const exported = state().snapshotPreset();
assert.equal(Object.hasOwn(exported, 'activeOverlay'), false, 'activeOverlay is UI-only');
assert.equal(JSON.stringify(exported).includes('activeOverlay'), false);
assert.deepEqual(JSON.parse(JSON.stringify(exported.overlays)), [
  { ...baseLayer, blend: 'screen', coverage: 0.4 },
]);
assert.deepEqual(
  JSON.parse(JSON.stringify(io.parsePreset(JSON.stringify(exported)).overlays)),
  JSON.parse(JSON.stringify(exported.overlays)),
  'blend + coverage survive the preset round-trip',
);

// Replacing the stack clears the panel's selection; a file with no overlays
// leaves both the stack and the selection alone.
state().loadPreset(io.parsePreset(JSON.stringify(exported)));
assert.equal(state().activeOverlay, null, 'loading a stack clears the UI selection');
state().setActiveOverlay('makeup:layer-a');
const withoutOverlays = JSON.parse(JSON.stringify(exported));
delete withoutOverlays.overlays;
state().loadPreset(io.parsePreset(JSON.stringify(withoutOverlays)));
assert.equal(state().activeOverlay, 'makeup:layer-a', 'a file with no overlays keeps the selection');
state().setActiveOverlay(null);
assert.equal(state().activeOverlay, null);
console.log('overlay store setters and preset round-trip: ok');

// ── 3. compositor: coverage threshold + blend mode ────────────────────────
assert.equal(overlayCoverage(baseLayer), 1, 'absent coverage means full coverage');
assert.equal(overlayCoverage({ coverage: NaN }), 1);
assert.equal(overlayCoverage({ coverage: -1 }), 0);
assert.equal(overlayCoverage({ coverage: 9 }), 1);

// The documented threshold, at its edges.
assert.equal(coverageAlpha(0, 1), 0);
assert.equal(coverageAlpha(255, 1), 255);
assert.equal(coverageAlpha(0, 0.5), 0);
assert.equal(coverageAlpha(64, 0.5), 0, 'alpha at/below t is erased');
assert.equal(coverageAlpha(128, 0.5), 1, 'alpha just above t survives at ~0');
assert.equal(coverageAlpha(255, 0.5), 255);
assert.equal(coverageAlpha(200, 0), 0, 'coverage 0 erases every pixel');

const alphas = [0, 64, 128, 192, 255];
const mask = alphaMask(alphas);

// Full coverage on a real-alpha mask: no pixel work at all, alpha untouched.
const full = compositeOne(baseLayer, mask);
assert.equal(full.drawn, 1);
assert.equal(full.scratch._ctx._readCalls, 0, 'alpha mask at coverage 1 must skip getImageData');
assert.equal(alphaAt(full, 0), 0);
assert.equal(alphaAt(full, 1), 64, 'full coverage keeps the soft edge');
assert.deepEqual(rgbAt(full, 1), [0x12, 0x34, 0x56], 'the layer colour floods the mask');

// Half coverage: pixel work runs, the bottom half of the alpha range is cut.
const half = compositeOne({ ...baseLayer, coverage: 0.5 }, mask);
assert.equal(half.scratch._ctx._readCalls, 1, 'coverage < 1 must read the mask pixels');
assert.equal(alphaAt(half, 0), 0);
assert.equal(alphaAt(half, 1), 0);
assert.equal(alphaAt(half, 2), 1);
assert.equal(alphaAt(half, 3), 129);
assert.equal(alphaAt(half, 4), 255);

// Coverage 0 yields nothing: no scratch canvas, no draw.
created.length = 0;
const main = createMockCanvas();
const zero = compositeOverlays(main.getContext('2d'), [{ layer: { ...baseLayer, coverage: 0 }, mask }], SIZE);
assert.equal(zero, 0, 'coverage 0 draws nothing');
assert.equal(created.length, 0, 'coverage 0 does no canvas work');

// Blend mode maps onto the canvas operation; unknown values fall back to normal.
const opFor = (blend) => {
  const result = compositeOne({ ...baseLayer, blend }, mask);
  const last = result.ctx._ops[result.ctx._ops.length - 1];
  return last.composite;
};
assert.equal(opFor('normal'), 'source-over');
assert.equal(opFor('multiply'), 'multiply');
assert.equal(opFor('screen'), 'screen');
assert.equal(opFor('overlay'), 'overlay');
assert.equal(opFor(undefined), 'source-over', 'an absent blend is source-over');
assert.equal(opFor('bogus'), 'source-over', 'an unknown blend falls back to source-over');

// The layer opacity still rides globalAlpha beside the blend mode.
const blended = compositeOne({ ...baseLayer, blend: 'multiply' }, mask);
const blendedOp = blended.ctx._ops[blended.ctx._ops.length - 1];
assert.equal(blendedOp.alpha, 0.5);
assert.equal(blended.ctx.globalCompositeOperation, 'source-over', 'the main context is restored after the draw');
assert.equal(blended.ctx.globalAlpha, 1, 'the main context globalAlpha is restored');

// Opaque greyscale masks keep their luminance → alpha conversion (and its
// background-noise floor) before coverage applies.
const lumMask = luminanceMask([0, 40, 200]);
const lum = compositeOne(baseLayer, lumMask);
assert.equal(lum.scratch._ctx._readCalls, 1, 'a luminance mask always needs the pixel pass');
assert.equal(alphaAt(lum, 0), 0, 'luminance below the noise floor is erased');
assert.equal(alphaAt(lum, 1), 40, 'luminance becomes alpha');
assert.equal(alphaAt(lum, 2), 200);
assert.deepEqual(rgbAt(lum, 2), [0x12, 0x34, 0x56]);

const lumHalf = compositeOne({ ...baseLayer, coverage: 0.5 }, lumMask);
assert.equal(alphaAt(lumHalf, 1), 0, 'coverage thresholds converted luminance too');
assert.equal(alphaAt(lumHalf, 2), 145);
console.log('compositor coverage threshold and blend modes: ok');

console.log('overlay layers: ok');
