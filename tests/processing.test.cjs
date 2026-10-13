const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../processing.js');
function image(width = 40, height = 50) {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  function rect(x, y, w, h, color) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) rgba.set(color, (yy * width + xx) * 4); }
  return { rgba, width, height, rect };
}
const config = { tolerance: 32, smoothing: 0, borderMm: 2, gradient: 'outward', cleanNoise: true, fillHoles: true, heightCm: 4, dpi: 150 };

function snowyArtwork() {
  const src = image(200, 240);
  src.rgba.fill(0);
  src.rect(20, 20, 160, 200, [35, 65, 110, 255]);
  src.rect(20, 175, 160, 45, [255, 255, 255, 255]); // Snow touches the transparent exterior.
  src.rect(35, 35, 55, 55, [248, 248, 248, 255]); // White detail belongs to the artwork.
  src.rect(110, 45, 50, 80, [0, 0, 0, 0]); // A real opening must remain eligible for cutting.
  return src;
}
test('automatic segmentation respects transparent exterior and opaque white artwork', () => {
  const src = snowyArtwork(), original = src.rgba.slice();
  const mask = engine.segment(src.rgba, src.width, src.height, 110);
  assert.equal(mask[200 * src.width + 25], 1);
  assert.equal(mask[50 * src.width + 50], 1);
  assert.equal(mask[70 * src.width + 130], 0);
  assert.equal(mask[0], 0);
  assert.deepEqual(src.rgba, original);
});
test('background mode can be overridden and only exterior transparency triggers automatic preservation', () => {
  const src = snowyArtwork();
  assert.equal(engine.resolveBackgroundMode(src.rgba, src.width, src.height), 'alpha');
  assert.equal(engine.segment(src.rgba, src.width, src.height, 32, 'white')[200 * src.width + 25], 0);
  const opaque = image(100, 100);
  opaque.rect(20, 20, 60, 60, [30, 60, 90, 255]);
  opaque.rect(40, 40, 20, 20, [0, 0, 0, 0]);
  assert.equal(engine.resolveBackgroundMode(opaque.rgba, 100, 100), 'white');
  assert.equal(engine.segment(opaque.rgba, 100, 100, 32)[0], 0);
  assert.equal(engine.segment(opaque.rgba, 100, 100, 32, 'alpha')[0], 1);
  assert.throws(() => engine.processImage({ ...src, settings: { ...config, backgroundMode: 'invalid' } }), /origem válida/);
});
test('white snow and enclosed white details survive internal filtering, gradients and final union', () => {
  const src = snowyArtwork(), original = src.rgba.slice();
  for (const gradient of ['outward', 'inward', 'solid']) {
    const out = engine.processImage({ ...src, settings: { ...config, tolerance: 110, borderMm: 0.5, joinBordersMm: 2, removeInternal: true, minInternalMm: 2, gradient } });
    assert.deepEqual(sourcePixel(out, 50, 200), [255, 255, 255, 255]);
    assert.deepEqual(sourcePixel(out, 50, 50), [248, 248, 248, 255]);
    assert.equal(sourcePixel(out, 130, 80)[3], 0);
    assert.equal(out.rgba[3], 0);
    for (let p = 3; p < out.rgba.length; p += 4) assert.equal(out.rgba[p], out.silhouette[p]);
  }
  assert.deepEqual(src.rgba, original);
});
test('removes only connected white background, preserving enclosed white artwork', () => {
  const src = image(); src.rect(8, 10, 24, 30, [30, 60, 100, 255]); src.rect(14, 16, 12, 18, [255, 255, 255, 255]);
  const mask = engine.segment(src.rgba, src.width, src.height, 32);
  assert.equal(mask[0], 0); assert.equal(mask[20 * src.width + 20], 1); assert.equal(mask[12 * src.width + 10], 1);
});
test('removal intensity handles off-white scans without removing saturated colors', () => {
  const src = image(10, 10); src.rect(0, 0, 10, 10, [240, 241, 243, 255]); src.rect(3, 3, 4, 4, [255, 180, 20, 255]);
  assert.equal(engine.segment(src.rgba, 10, 10, 10)[0], 1);
  const mask = engine.segment(src.rgba, 10, 10, 20); assert.equal(mask[0], 0); assert.equal(mask[44], 1);
});
test('exact distance transform agrees with geometric distance for arbitrary masks', () => {
  const width = 9, height = 7, mask = new Uint8Array(width * height); mask[13] = 1; mask[42] = 1;
  const distances = engine.distanceTo(mask, width, height, 1);
  for (let i = 0; i < mask.length; i++) {
    const x = i % width, y = Math.floor(i / width);
    const expected = Math.min(...[13, 42].map(j => Math.hypot(x - j % width, y - Math.floor(j / width))));
    assert.ok(Math.abs(expected - distances[i]) < 0.00001, `${i}: ${distances[i]} vs ${expected}`);
  }
});
test('cleaning removes specks but preserves separate substantive parts', () => {
  const mask = new Uint8Array(30 * 30); mask[0] = 1;
  for (let y = 4; y < 10; y++) for (let x = 4; x < 10; x++) mask[y * 30 + x] = 1;
  for (let y = 20; y < 26; y++) for (let x = 20; x < 26; x++) mask[y * 30 + x] = 1;
  const result = engine.removeSpecks(mask, 30, 30); assert.equal(result.removed, 1); assert.equal(result.kept, 2); assert.equal(mask[0], 0);
});
test('hole filling closes enclosed transparent regions but leaves the exterior open', () => {
  const mask = new Uint8Array(100);
  for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) mask[y * 10 + x] = 1;
  mask[44] = 0; engine.fillInterior(mask, 10, 10); assert.equal(mask[44], 1); assert.equal(mask[0], 0);
});
test('export has transparent margins, opaque outer black outline and outward gradient', () => {
  const src = image(); src.rect(8, 10, 24, 30, [230, 90, 50, 255]);
  const out = engine.processImage({ ...src, settings: config });
  assert.equal(out.height, Math.round(4 / 2.54 * 150)); assert.equal(out.rgba[3], 0);
  const y = Math.floor(out.height / 2), gray = [];
  for (let x = 0; x < out.margin; x++) { const p = (y * out.width + x) * 4; if (out.rgba[p + 3] === 255) gray.push(out.rgba[p]); }
  assert.ok(gray.length > 5); assert.ok(gray[0] < 15); assert.ok(gray.at(-1) > 180);
  for (let i = 3; i < out.rgba.length; i += 4) assert.equal(out.rgba[i], out.silhouette[i]);
  const center = (y * out.width + Math.floor(out.width / 2)) * 4;
  assert.deepEqual([...out.rgba.subarray(center, center + 4)], [230, 90, 50, 255]);
});
test('reversed and solid outlines keep the same cut geometry', () => {
  const src = image(); src.rect(8, 10, 24, 30, [30, 80, 120, 255]);
  const outward = engine.processImage({ ...src, settings: config });
  const inward = engine.processImage({ ...src, settings: { ...config, gradient: 'inward' } });
  const solid = engine.processImage({ ...src, settings: { ...config, gradient: 'solid' } });
  assert.deepEqual(outward.silhouette, inward.silhouette); assert.deepEqual(outward.silhouette, solid.silhouette);
  const y = Math.floor(solid.height / 2);
  for (let x = 0; x < solid.margin; x++) { const p = (y * solid.width + x) * 4; if (solid.rgba[p + 3]) assert.equal(solid.rgba[p], 0); }
});
test('transparent source holes can be preserved or filled independently', () => {
  const src = image(); src.rect(8, 10, 24, 30, [40, 90, 30, 255]); src.rect(14, 16, 12, 18, [0, 0, 0, 0]);
  for (const fillHoles of [false, true]) {
    const out = engine.processImage({ ...src, settings: { ...config, borderMm: 0, fillHoles } });
    const p = (Math.floor(out.height / 2) * out.width + Math.floor(out.width / 2)) * 4;
    assert.equal(out.rgba[p + 3], fillHoles ? 255 : 0);
    if (fillHoles) assert.equal(out.rgba[p], 218);
  }
});
test('smoothing bridges a narrow slit and rounds spurs without losing the main figure', () => {
  const width = 80, mask = new Uint8Array(width * width);
  for (let y = 15; y < 65; y++) for (let x = 15; x < 65; x++) mask[y * width + x] = 1;
  for (let y = 15; y < 35; y++) mask[y * width + 40] = 0;
  mask[14 * width + 25] = 1;
  const smooth = engine.smoothMask(mask, width, width, 3);
  assert.equal(smooth[25 * width + 40], 1); assert.equal(smooth[14 * width + 25], 0); assert.equal(smooth[40 * width + 40], 1);
});
test('rejects blank images and excessive export dimensions with useful errors', () => {
  const src = image(); assert.throws(() => engine.processImage({ ...src, settings: config }), /Nenhuma figura/);
  src.rect(8, 10, 24, 30, [10, 20, 30, 255]);
  assert.throws(() => engine.processImage({ ...src, settings: { ...config, heightCm: 100 } }), /muito grande/);
});

function openingFixture(transparent = false) {
  const src = image(200, 240); src.rect(20, 20, 160, 200, [35, 65, 110, 255]);
  const empty = transparent ? [0, 0, 0, 0] : [255, 255, 255, 255];
  src.rect(40, 40, 8, 8, empty); // About 1.5 mm at 4 cm output height.
  src.rect(75, 80, 30, 30, empty); // About 6 mm.
  src.rect(145, 50, 3, 110, empty); // Long slot, narrower than 1 mm.
  return src;
}
function sourcePixel(out, x, y) {
  const b = out.sourceBounds, w = out.width - out.margin * 2;
  const ox = out.margin + Math.floor((x - b.x + 0.5) * w / b.width);
  const oy = out.margin + Math.floor((y - b.y + 0.5) * out.figurePixels / b.height);
  return [...out.rgba.subarray((oy * out.width + ox) * 4, (oy * out.width + ox) * 4 + 4)];
}
test('opens large internal white regions and preserves small dots and long narrow slots', () => {
  const out = engine.processImage({ ...openingFixture(), settings: { ...config, borderMm: 0, removeInternal: true, minInternalMm: 2 } });
  assert.equal(sourcePixel(out, 90, 95)[3], 0);
  assert.deepEqual(sourcePixel(out, 44, 44), [218, 218, 218, 255]);
  assert.deepEqual(sourcePixel(out, 146, 100), [218, 218, 218, 255]);
  assert.deepEqual(out.internalSpaces, { opened: 1, preserved: 2 });
});
test('physical internal-space threshold is independent of DPI and responds to final height', () => {
  for (const dpi of [150, 300]) {
    const out = engine.processImage({ ...openingFixture(), settings: { ...config, dpi, borderMm: 0, removeInternal: true, minInternalMm: 2 } });
    assert.equal(sourcePixel(out, 90, 95)[3], 0); assert.equal(sourcePixel(out, 44, 44)[3], 255);
  }
  const enlarged = engine.processImage({ ...openingFixture(), settings: { ...config, heightCm: 8, borderMm: 0, removeInternal: true, minInternalMm: 2 } });
  assert.equal(sourcePixel(enlarged, 44, 44)[3], 0);
});
test('outline thickness is deducted from the usable aperture and protected spaces stay opaque', () => {
  const src = openingFixture();
  const out = engine.processImage({ ...src, settings: { ...config, borderMm: 2, removeInternal: true, minInternalMm: 2 } });
  assert.deepEqual(sourcePixel(out, 90, 95), [218, 218, 218, 255]);
  assert.equal(out.internalSpaces.opened, 0);
});
test('threshold works for already-transparent holes and smoothing preserves a large opening', () => {
  const out = engine.processImage({ ...openingFixture(true), settings: { ...config, smoothing: 3, borderMm: 0.5, removeInternal: true, minInternalMm: 2 } });
  assert.equal(sourcePixel(out, 90, 95)[3], 0);
  assert.deepEqual(sourcePixel(out, 44, 44), [218, 218, 218, 255]);
});
test('zero threshold opens every internal white region, while disabling removal preserves whites', () => {
  const src = openingFixture();
  const all = engine.processImage({ ...src, settings: { ...config, borderMm: 0, removeInternal: true, minInternalMm: 0 } });
  assert.equal(sourcePixel(all, 44, 44)[3], 0); assert.equal(sourcePixel(all, 146, 100)[3], 0);
  const disabled = engine.processImage({ ...src, settings: { ...config, borderMm: 0, removeInternal: false, minInternalMm: 100 } });
  assert.deepEqual(sourcePixel(disabled, 90, 95), [255, 255, 255, 255]);
  assert.throws(() => engine.processImage({ ...src, settings: { ...config, removeInternal: true, minInternalMm: -1 } }), /entre 0 e 20 mm/);
});

test('inward gradient fills protected background gaps with black instead of creating white spots', () => {
  for (const transparent of [false, true]) {
    const out = engine.processImage({ ...openingFixture(transparent), settings: { ...config, gradient: 'inward', borderMm: 0.5, smoothing: 3, removeInternal: true, minInternalMm: 2 } });
    assert.deepEqual(sourcePixel(out, 44, 44), [0, 0, 0, 255]);
    assert.deepEqual(sourcePixel(out, 146, 100), [0, 0, 0, 255]);
    assert.equal(sourcePixel(out, 90, 95)[3], 0);
    assert.deepEqual(sourcePixel(out, 60, 150), [35, 65, 110, 255]);
  }
});

test('inward gradient does not paint white into exterior notches closed by smoothing', () => {
  const src = image(120, 150); src.rect(20, 20, 80, 110, [25, 30, 35, 255]);
  src.rect(59, 20, 2, 50, [255, 255, 255, 255]);
  const out = engine.processImage({ ...src, settings: { ...config, smoothing: 8, gradient: 'inward', removeInternal: true, minInternalMm: 2 } });
  assert.deepEqual(sourcePixel(out, 60, 45), [0, 0, 0, 255]);
});

test('original white artwork remains white when internal removal is disabled', () => {
  const out = engine.processImage({ ...openingFixture(), settings: { ...config, gradient: 'inward', removeInternal: false } });
  assert.deepEqual(sourcePixel(out, 44, 44), [255, 255, 255, 255]);
  assert.deepEqual(sourcePixel(out, 90, 95), [255, 255, 255, 255]);
});

test('depth extends the dark band in both directions without changing the cut or original artwork', () => {
  const src = image(); src.rect(8, 10, 24, 30, [230, 90, 50, 255]);
  for (const gradient of ['inward', 'outward']) {
    const base = engine.processImage({ ...src, settings: { ...config, gradient } });
    const deep = engine.processImage({ ...src, settings: { ...config, gradient, gradientDepth: 70 } });
    const y = Math.floor(base.height / 2), p = (y * base.width + base.margin - 6) * 4;
    assert.ok(base.rgba[p] > deep.rgba[p], `${gradient}: deep outline should be darker`);
    assert.deepEqual(base.silhouette, deep.silhouette);
    assert.deepEqual(sourcePixel(deep, 20, 25), [230, 90, 50, 255]);
  }
});

test('intensity, light tone and transition change the exported outline colors while keeping opacity', () => {
  const src = image(); src.rect(8, 10, 24, 30, [230, 90, 50, 255]);
  const options = { ...config, gradient: 'inward' };
  const base = engine.processImage({ ...src, settings: options });
  const y = Math.floor(base.height / 2), p = (y * base.width + base.margin - 5) * 4;
  const weaker = engine.processImage({ ...src, settings: { ...options, gradientStrength: 40 } });
  const darkerLight = engine.processImage({ ...src, settings: { ...options, gradientLight: 100 } });
  assert.ok(weaker.rgba[p] > base.rgba[p]);
  assert.ok(darkerLight.rgba[p] < base.rgba[p]);
  for (const gradientCurve of ['linear', 'sharp']) {
    const variant = engine.processImage({ ...src, settings: { ...options, gradientCurve } });
    assert.notDeepEqual(variant.rgba, base.rgba);
    assert.deepEqual(variant.silhouette, base.silhouette);
    assert.deepEqual(sourcePixel(variant, 20, 25), [230, 90, 50, 255]);
  }
  assert.deepEqual(weaker.silhouette, base.silhouette); assert.deepEqual(darkerLight.silhouette, base.silhouette);
});

test('advanced inward gradient keeps protected spaces dark and solid mode ignores gradient tuning', () => {
  const out = engine.processImage({ ...openingFixture(), settings: { ...config, gradient: 'inward', gradientDepth: 85, gradientLight: 240, gradientCurve: 'sharp', removeInternal: true, minInternalMm: 2 } });
  assert.deepEqual(sourcePixel(out, 44, 44), [0, 0, 0, 255]);
  const src = image(); src.rect(8, 10, 24, 30, [230, 90, 50, 255]);
  const solid = engine.processImage({ ...src, settings: { ...config, gradient: 'solid' } });
  const tunedSolid = engine.processImage({ ...src, settings: { ...config, gradient: 'solid', gradientDepth: 85, gradientStrength: 0, gradientLight: 240, gradientCurve: 'sharp' } });
  assert.deepEqual(tunedSolid.rgba, solid.rgba);
});

function barFixture(gap = 6) {
  const src = image(200, 240);
  src.rect(20, 20, 60, 200, [35, 65, 110, 255]);
  src.rect(80 + gap, 20, 100 - gap, 200, [35, 65, 110, 255]);
  return src;
}
test('joins nearby finished contours, preserving larger gaps and original artwork', () => {
  const opts = { ...config, borderMm: 0, removeInternal: true, minInternalMm: 2 };
  const separate = engine.processImage({ ...barFixture(), settings: { ...opts, joinBordersMm: 0 } });
  const joined = engine.processImage({ ...barFixture(), settings: { ...opts, joinBordersMm: 2 } });
  assert.equal(sourcePixel(separate, 83, 120)[3], 0);
  assert.equal(sourcePixel(joined, 83, 120)[3], 255);
  assert.deepEqual(sourcePixel(joined, 50, 120), [35, 65, 110, 255]);
  assert.equal(joined.rgba[3], 0);
  const wider = engine.processImage({ ...barFixture(20), settings: { ...opts, joinBordersMm: 2 } });
  assert.equal(sourcePixel(wider, 90, 120)[3], 0);
  for (let i = 3; i < joined.rgba.length; i += 4) assert.equal(joined.rgba[i], joined.silhouette[i]);
});
test('joining width applies to the gap left after the outline expands', () => {
  const src = barFixture(20), opts = { ...config, borderMm: 1, removeInternal: true, minInternalMm: 2 };
  const separate = engine.processImage({ ...src, settings: { ...opts, joinBordersMm: 0 } });
  const joined = engine.processImage({ ...src, settings: { ...opts, joinBordersMm: 2 } });
  assert.equal(sourcePixel(separate, 90, 120)[3], 0);
  assert.equal(sourcePixel(joined, 90, 120)[3], 255);
});
test('protects small holes created only after offsetting an exterior opening', () => {
  for (const size of [20, 40]) {
    const src = image(200, 240); src.rect(20, 20, 160, 200, [35, 65, 110, 255]);
    src.rect(75, 80, size, size, [255, 255, 255, 255]);
    src.rect(80, 20, 3, 61, [255, 255, 255, 255]);
    const out = engine.processImage({ ...src, settings: { ...config, borderMm: 1, removeInternal: true, minInternalMm: 2, joinBordersMm: 0 } });
    assert.equal(sourcePixel(out, 75 + size / 2, 80 + size / 2)[3], size === 20 ? 255 : 0);
  }
});
test('joining uses physical dimensions consistently at 150 and 300 dpi', () => {
  for (const dpi of [150, 300]) for (const heightCm of [4, 8]) {
    const out = engine.processImage({ ...barFixture(), settings: { ...config, borderMm: 0, dpi, heightCm, joinBordersMm: 2, removeInternal: true, minInternalMm: 2 } });
    assert.equal(sourcePixel(out, 83, 120)[3], heightCm === 4 ? 255 : 0);
  }
});
test('wide joining preserves every opaque pixel without clipping the export edges', () => {
  const src = barFixture(), opts = { ...config, borderMm: 0, removeInternal: true, minInternalMm: 2 };
  const original = engine.processImage({ ...src, settings: { ...opts, joinBordersMm: 0 } });
  const joined = engine.processImage({ ...src, settings: { ...opts, joinBordersMm: 6 } });
  assert.equal(joined.width, original.width); assert.equal(joined.height, original.height);
  for (let p = 0; p < original.rgba.length; p += 4) if (original.rgba[p + 3] === 255) assert.deepEqual(joined.rgba.subarray(p, p + 4), original.rgba.subarray(p, p + 4));
  assert.equal(joined.rgba[3], 0);
});
