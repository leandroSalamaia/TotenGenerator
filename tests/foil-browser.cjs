const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { crc32 } = require('node:zlib');
const artifacts = path.resolve(__dirname, '../test-results');
async function ready(page) { await page.waitForFunction(() => document.getElementById('processing').hidden && !document.getElementById('exportButton').disabled, { timeout: 30000 }); }
function entries(zip) {
  const result = [], end = zip.length - 22; let offset = 0;
  assert.equal(zip.readUInt32LE(end), 0x06054b50); assert.equal(zip.readUInt16LE(end + 8), 4); assert.equal(zip.readUInt16LE(end + 10), 4);
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const length = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28), start = offset + 30 + nameLength + extra;
    const data = zip.subarray(start, start + length); assert.equal(crc32(data), zip.readUInt32LE(offset + 14));
    result.push({ name: zip.toString('utf8', offset + 30, offset + 30 + nameLength), data }); offset = start + length;
  }
  assert.equal(offset, zip.readUInt32LE(end + 16)); return result;
}
function resolution(png) {
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'pHYs') return [...png.subarray(offset + 8, offset + 17)];
    offset += length + 12;
  }
  throw new Error('Missing PNG resolution');
}
async function sourceClient(page, x, y) {
  return page.locator('#previewCanvas').evaluate((canvas, { x, y }) => {
    const rect = canvas.getBoundingClientRect(), frame = TotemFoil.frame(state.result), p = state.result.placement, b = state.result.sourceBounds;
    const cx = frame.offsetX + p.x + (x - b.x + 0.5) / b.width * p.width - 0.5, cy = frame.offsetY + p.y + (y - b.y + 0.5) / b.height * p.height - 0.5;
    return { x: rect.left + (cx + 0.5) / frame.width * rect.width, y: rect.top + (cy + 0.5) / frame.height * rect.height };
  }, { x, y });
}
async function add(page, type, x, y) {
  await page.locator(`[data-foil-template="${type}"]`).click();
  const p = await sourceClient(page, x, y); await page.mouse.click(p.x, p.y);
}
async function download(page, filename) {
  const promise = page.waitForEvent('download'); await page.locator('#exportButton').click();
  const d = await promise; await d.saveAs(path.join(artifacts, filename)); await ready(page);
  return { name: d.suggestedFilename(), entries: entries(await fs.readFile(path.join(artifacts, filename))) };
}
async function validateBundle(page, bundle, black = true) {
  const files = bundle.entries;
  assert.deepEqual(files.map(item => item.name), ['mago-totem.png', 'mago-totem-espelhado.png', 'mago-foil.png', 'mago-totem-com-foil.png']);
  const sizes = files.map(item => [item.data.readUInt32BE(16), item.data.readUInt32BE(20)]);
  assert.ok(sizes.every(item => item[0] === sizes[0][0] && item[1] === sizes[0][1]));
  const resolutions = files.map(item => resolution(item.data)); assert.ok(resolutions.every(item => JSON.stringify(item) === JSON.stringify(resolutions[0])));
  assert.equal(Buffer.from(resolutions[0]).readUInt32BE(0), 5906);
  const comparison = await page.evaluate(async ({ urls, black }) => {
    const decoded = await Promise.all(urls.map(async url => {
      const img = new Image(); img.src = url; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height).data;
    }));
    const [art, mirror, foil, composite] = decoded, frame = TotemFoil.frame(state.result), { width, height } = frame;
    const expectedArt = document.createElement('canvas'); expectedArt.width = width; expectedArt.height = height;
    const ctx = expectedArt.getContext('2d'); ctx.putImageData(new ImageData(state.result.rgba, state.result.width, state.result.height), frame.offsetX, frame.offsetY);
    const expected = ctx.getImageData(0, 0, width, height).data;
    // Compare the preview through the same PNG encode/decode path as the export.
    // Semi-transparent RGB can round by one channel value during PNG decoding.
    const previewImage = new Image(); previewImage.src = document.getElementById('previewCanvas').toDataURL('image/png'); await previewImage.decode();
    const previewCanvas = document.createElement('canvas'); previewCanvas.width = width; previewCanvas.height = height;
    const previewContext = previewCanvas.getContext('2d'); previewContext.drawImage(previewImage, 0, 0);
    const preview = previewContext.getImageData(0, 0, width, height).data;
    let mirrorErrors = 0, foilPixels = 0, changedPixels = 0, foilColorErrors = 0, edgeErrors = 0, outsideArt = 0;
    const color = state.foilEffects[0].color.match(/\w\w/g).map(v => parseInt(v, 16)), particleMode = FoilEngine.templates.find(item => item.id === state.foilEffects[0].type).particle;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4, m = (y * width + width - 1 - x) * 4;
      for (let c = 0; c < 4; c++) if (art[p + c] !== mirror[m + c]) mirrorErrors++;
      if (foil[p + 3]) {
        foilPixels++;
        if (!art[p + 3]) outsideArt++;
        for (let c = 0; c < 3; c++) if ((black && foil[p + c] !== 0) || (!black && foil[p + 3] === 255 && (particleMode ? foil[p + c] < color[c] - 1 : foil[p + c] !== color[c]))) foilColorErrors++;
      }
      if (art[p] !== composite[p] || art[p + 3] !== composite[p + 3]) changedPixels++;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) for (const image of decoded) if (image[p + 3]) edgeErrors++;
    }
    const mismatch = composite.findIndex((v, i) => v !== preview[i]);
    return { mirrorErrors, foilPixels, changedPixels, foilColorErrors, edgeErrors, outsideArt, view: state.view, mismatch, differences: composite.reduce((n,v,i) => n + (v !== preview[i] ? 1 : 0),0), sample: mismatch < 0 ? [] : [Array.from(composite.slice(mismatch - mismatch % 4, mismatch - mismatch % 4 + 4)), Array.from(preview.slice(mismatch - mismatch % 4, mismatch - mismatch % 4 + 4))], artUnchanged: art.every((v, i) => v === expected[i]), compositeMatchesPreview: composite.every((v, i) => v === preview[i]), baseUnchanged: state.result.rgba.every((v, i) => v === window.beforeFoil[i]) };
  }, { urls: files.map(file => `data:image/png;base64,${file.data.toString('base64')}`), black });
  assert.equal(comparison.mirrorErrors, 0); assert.equal(comparison.foilColorErrors, 0); assert.equal(comparison.edgeErrors, 0);
  assert.ok(comparison.foilPixels > 50 && comparison.changedPixels > 50 && comparison.outsideArt > 10);
  assert.equal(comparison.artUnchanged, true); assert.equal(comparison.baseUnchanged, true); assert.equal(comparison.compositeMatchesPreview, true, JSON.stringify(comparison));
}
async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1150 }, hasTouch: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    assert.equal(await page.locator('[data-foil-template]').count(), 12);
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 220; c.height = 260; const ctx = c.getContext('2d');
      ctx.fillStyle = '#84776b'; ctx.fillRect(50, 225, 145, 15);
      ctx.strokeStyle = '#78512e'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(170, 20); ctx.lineTo(170, 230); ctx.stroke();
      ctx.fillStyle = '#513478'; ctx.beginPath(); ctx.moveTo(85, 70); ctx.lineTo(115, 70); ctx.lineTo(150, 225); ctx.lineTo(50, 225); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#513478'; ctx.lineWidth = 15; ctx.beginPath(); ctx.moveTo(110, 105); ctx.lineTo(170, 88); ctx.stroke();
      ctx.fillStyle = '#dab993'; ctx.beginPath(); ctx.arc(100, 55, 19, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#38265f'; ctx.beginPath(); ctx.moveTo(68, 43); ctx.lineTo(100, 10); ctx.lineTo(132, 43); ctx.closePath(); ctx.fill();
      return c.toDataURL('image/png').split(',')[1];
    });
    const upload = () => page.locator('#fileInput').setInputFiles({ name: 'mago.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await upload(); await ready(page); await page.locator('#height').fill('8'); await page.locator('#dpi').selectOption('150'); await ready(page);
    await page.evaluate(() => { window.beforeFoil = state.result.rgba.slice(); });
    await page.locator('#foilSize').fill('12');
    await add(page, 'magic', 170, 20);
    assert.equal(await page.evaluate(() => state.foilEffects.length), 1);
    assert.equal(await page.locator('#includeMirror').isChecked(), true); assert.equal(await page.locator('#includeMirror').isDisabled(), true);
    assert.equal(await page.locator('#exportButtonLabel').textContent(), 'Baixar 4 PNGs');
    assert.ok(await page.evaluate(() => TotemFoil.frame(state.result).offsetY > 0));
    assert.equal(await page.locator('#foilOverlayCanvas').isVisible(), true);
    const first = await download(page, 'mago-foil-black.zip'); assert.equal(first.name, 'mago-totem-e-foil-4-pngs.zip'); await validateBundle(page, first);
    await page.locator('#foilTab').click(); assert.equal(await page.locator('#viewBadge').textContent(), 'CAMADA FOIL ISOLADA');
    const foilPixels = await page.locator('#previewCanvas').evaluate(c => { const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; return data.some((v, i) => i % 4 === 3 && v > 0); }); assert.equal(foilPixels, true);
    await page.locator('#compositeTab').click();
    // Change color, size and rotation, then drag the actual motif.
    await page.locator('#foilSize').fill('16'); await page.locator('#foilRotation').fill('30'); await page.locator('#foilLine').fill('0.5'); await page.locator('[data-foil-color="#c6804d"]').click();
    const start = await sourceClient(page, 170, 20), finish = await sourceClient(page, 150, 45);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(finish.x, finish.y, { steps: 5 }); await page.mouse.up();
    const moved = await page.evaluate(() => state.foilEffects[0]); assert.ok(Math.abs(moved.x - 150) < 1 && Math.abs(moved.y - 45) < 1);
    assert.equal(moved.rotation, 30); assert.equal(moved.sizeMm, 16); assert.equal(moved.color, '#c6804d');
    await page.locator('#foilExportColor').selectOption('preview');
    const colored = await download(page, 'mago-foil-color.zip'); await validateBundle(page, colored, false);
    // Each library motif renders nonempty, distinct geometry without clipping.
    const gallery = await page.evaluate(() => FoilEngine.templates.map(template => {
      const c = document.createElement('canvas'); c.width = 180; c.height = 180;
      const r = { width: 180, height: 180, dpi: 150, placement: { x: 0, y: 0, width: 180, height: 180 }, sourceBounds: { x: 0, y: 0, width: 180, height: 180 } };
      FoilEngine.draw(c.getContext('2d'), r, [{ type: template.id, x: 90, y: 90, sizeMm: 12, lineMm: 0.3, rotation: 23, color: '#d6ae55' }], { offsetX: 0, offsetY: 0 }, true);
      const data = c.getContext('2d').getImageData(0, 0, 180, 180).data;
      let count = 0, hash = 0; for (let i = 3; i < data.length; i += 4) { if (data[i]) count++; hash = ((hash * 31) ^ data[i]) >>> 0; }
      return { count, hash };
    }));
    assert.ok(gallery.every(item => item.count > 30)); assert.equal(new Set(gallery.map(item => item.hash)).size, 12);
    await page.locator('#duplicateFoil').click(); assert.equal(await page.evaluate(() => state.foilEffects.length), 2);
    const ids = await page.evaluate(() => state.foilEffects.map(effect => effect.id));
    await page.locator('#foilSelect').selectOption(ids[0]); assert.equal(await page.locator('#foilSelect').inputValue(), ids[0]);
    await page.locator('#removeFoil').click(); assert.equal(await page.evaluate(() => state.foilEffects.length), 1);
    await page.locator('#undoFoil').click(); assert.equal(await page.evaluate(() => state.foilEffects.length), 2);
    await page.locator('#redoFoil').click(); assert.equal(await page.evaluate(() => state.foilEffects.length), 1);
    await page.locator('#clearFoil').click(); assert.equal(await page.evaluate(() => state.foilEffects.length), 0);
    assert.equal(await page.locator('#includeMirror').isChecked(), false); assert.equal(await page.locator('#exportButtonLabel').textContent(), 'Baixar PNG');
    await page.locator('#undoFoil').click(); assert.equal(await page.locator('#exportButtonLabel').textContent(), 'Baixar 4 PNGs');
    // The mandatory mirrored foil bundle must not change the saved mirror preference.
    await page.locator('#presetName').fill('Acabamento com foil'); await page.locator('#savePreset').click();
    const presetId = await page.locator('#presetSelect').inputValue();
    assert.equal(await page.evaluate(id => JSON.parse(localStorage.getItem('totem-studio-presets-v1')).find(preset => preset.id === id).values.includeMirror, presetId), false);
    const beforePreset = await page.evaluate(() => state.foilEffects.map(effect => ({ ...effect })));
    await page.locator('#applyPreset').click(); await ready(page);
    assert.deepEqual(await page.evaluate(() => state.foilEffects), beforePreset);
    assert.equal(await page.locator('#includeMirror').isChecked(), true);
    // Effects track the same source point across resolution, base and presets.
    const before = await page.evaluate(() => state.foilEffects.map(effect => ({ ...effect })));
    await page.locator('#dpi').selectOption('300'); await ready(page); await page.locator('#baseEnabled').check(); await ready(page);
    assert.deepEqual(await page.evaluate(() => state.foilEffects), before);
    await page.locator('#dpi').selectOption('150'); await page.locator('#baseEnabled').uncheck(); await ready(page);
    await page.locator('#compositeTab').click(); await page.screenshot({ path: path.join(artifacts, 'foil-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(artifacts, 'foil-mobile.png'), fullPage: true });
    await page.locator('[data-foil-template="stars"]').click();
    const touch = await sourceClient(page, 100, 55); await page.touchscreen.tap(touch.x, touch.y);
    assert.equal(await page.evaluate(() => state.foilEffects.length), 2);
    await page.locator('#removeFoil').click(); assert.equal(await page.evaluate(() => state.foilEffects.length), 1);
    await page.setViewportSize({ width: 1440, height: 1150 });
    // Loading a different source resets foil and restores standard downloads.
    await upload(); await ready(page); assert.equal(await page.evaluate(() => state.foilEffects.length), 0);
    assert.equal(await page.locator('#exportButtonLabel').textContent(), 'Baixar PNG');
    // Game particles use a frozen seed, so the preview and both foil export modes agree.
    await page.evaluate(() => { window.beforeFoil = state.result.rgba.slice(); });
    await add(page, 'particle-magic', 170, 20);
    assert.equal(await page.locator('#foilParticleSettings').isVisible(), true);
    await page.locator('#foilCount').fill('120'); await page.locator('#foilSpread').fill('90'); await page.locator('#foilParticleSize').fill('0.65'); await page.locator('#foilGlow').fill('80');
    const parameters = await page.evaluate(() => ({ ...state.foilEffects[0] }));
    assert.equal(parameters.count, 120); assert.equal(parameters.spread, 90); assert.equal(parameters.particleMm, 0.65); assert.equal(parameters.glow, 80);
    const stable = await page.locator('#previewCanvas').evaluate(c => c.toDataURL());
    await page.evaluate(() => renderPreview()); assert.equal(await page.locator('#previewCanvas').evaluate(c => c.toDataURL()), stable);
    await page.locator('#foilExportColor').selectOption('black'); await validateBundle(page, await download(page, 'mago-particulas-black.zip'));
    await page.locator('#foilExportColor').selectOption('preview'); await validateBundle(page, await download(page, 'mago-particulas-color.zip'), false);
    const footprint = () => page.evaluate(() => { const c = TotemFoil.layers(state.result).foil, data = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count++; return count; });
    const glowing = await footprint(); await page.locator('#foilGlow').fill('0'); assert.ok(await footprint() < glowing * 0.7);
    await page.locator('#foilGlow').fill('80');
    await page.locator('#varyFoil').click(); const varied = await page.evaluate(() => state.foilEffects[0].seed); assert.notEqual(varied, parameters.seed);
    const variant = await page.locator('#previewCanvas').evaluate(c => c.toDataURL()); assert.notEqual(variant, stable);
    await page.locator('#undoFoil').click(); assert.equal(await page.evaluate(() => state.foilEffects[0].seed), parameters.seed);
    await page.locator('#redoFoil').click(); assert.equal(await page.evaluate(() => state.foilEffects[0].seed), varied);
    const sheet = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 740; const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#101725'; ctx.fillRect(0,0,1080,740);
      FoilEngine.templates.filter(t => t.particle).forEach((t,i) => {
        const x = (i % 3) * 360, y = Math.floor(i / 3) * 370;
        ctx.save(); ctx.translate(x + 180,y + 170); ctx.scale(325,325); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        t.draw(ctx,{ sizeMm:24, lineMm:0.3, color:t.color, count:100, particleMm:0.6, spread:90, glow:85, seed:12345 }); ctx.restore();
        ctx.font = '18px sans-serif'; ctx.fillStyle = '#e0e5f0'; ctx.textAlign = 'center'; ctx.fillText(t.name,x + 180,y + 338);
      }); return canvas.toDataURL('image/png').split(',')[1];
    });
    await fs.writeFile(path.join(artifacts,'particulas-galeria.png'), Buffer.from(sheet,'base64'));
    await page.locator('[data-bg="dark"]').click(); await page.locator('#previewCanvas').screenshot({ path: path.join(artifacts,'particulas-mago.png') });
    assert.deepEqual(errors, []);
    console.log('Foil passed: six particle presets + six symbols, real placement/drag/style controls, aligned four-PNG ZIP/CRCs/DPI, exact foil-free original + mirror, black/color foil layer, composite preview/export, stable particle seeds, density/spread/size/glow controls, variation/undo/redo, transparent margins, base/DPI tracking, mobile layout and image reset.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
