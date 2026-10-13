const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { crc32 } = require('node:zlib');
const artifactDir = path.resolve(__dirname, '../test-results');
function zipEntries(zip) {
  const entries = [], end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50); assert.equal(zip.readUInt16LE(end + 8), 2); assert.equal(zip.readUInt16LE(end + 10), 2);
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const length = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28);
    assert.equal(zip.readUInt16LE(offset + 6), 0x0800); assert.equal(zip.readUInt16LE(offset + 8), 0);
    const name = zip.toString('utf8', offset + 30, offset + 30 + nameLength), start = offset + 30 + nameLength + extraLength;
    const data = zip.subarray(start, start + length);
    assert.equal(crc32(data), zip.readUInt32LE(offset + 14));
    entries.push({ name, data, offset }); offset = start + length;
  }
  assert.equal(offset, zip.readUInt32LE(end + 16));
  const centralStart = offset;
  for (const entry of entries) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50); assert.equal(zip.readUInt32LE(offset + 42), entry.offset);
    const nameLength = zip.readUInt16LE(offset + 28);
    assert.equal(zip.toString('utf8', offset + 46, offset + 46 + nameLength), entry.name);
    assert.equal(zip.readUInt32LE(offset + 20), entry.data.length);
    offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
  }
  assert.equal(offset, end); assert.equal(offset - centralStart, zip.readUInt32LE(end + 12));
  return entries;
}
function pngResolution(png) {
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'pHYs') return png.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
  }
  throw new Error('PNG resolution metadata missing');
}
async function main() {
  await fs.mkdir(artifactDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    assert.equal(await page.locator('#exportButton').isDisabled(), true);
    await page.locator('#sampleButton').click();
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled, { timeout: 30000 });
    assert.match(await page.locator('#imageInfo').textContent(), /1417 px/);
    // Tune all gradient controls, compare the actual pixels and cut geometry,
    // then verify the downloaded PNG uses exactly the preview colors.
    await page.locator('#previewCanvas').evaluate(canvas => { window.gradientBaseline = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; });
    const oldSwatch = await page.locator('#gradientSwatch div').evaluate(element => element.style.background);
    await page.locator('#gradientDepth').fill('70');
    await page.locator('#gradientStrength').fill('55');
    await page.locator('#gradientLight').fill('170');
    await page.locator('#gradientCurve').selectOption('sharp');
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    assert.equal(await page.locator('#gradientDepthValue').textContent(), '70%');
    assert.equal(await page.locator('#gradientStrengthValue').textContent(), '55%');
    assert.notEqual(await page.locator('#gradientSwatch div').evaluate(element => element.style.background), oldSwatch);
    const comparison = await page.locator('#previewCanvas').evaluate(canvas => {
      const current = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let changed = 0, alphaChanges = 0;
      for (let i = 0; i < current.length; i += 4) { if (current[i] !== window.gradientBaseline[i]) changed++; if (current[i + 3] !== window.gradientBaseline[i + 3]) alphaChanges++; }
      return { changed, alphaChanges };
    });
    assert.ok(comparison.changed > 100); assert.equal(comparison.alphaChanges, 0);
    const adjustedDownloadPromise = page.waitForEvent('download'); await page.locator('#exportButton').click();
    const adjustedDownload = await adjustedDownloadPromise, adjustedPath = path.join(artifactDir, 'gradient-adjusted.png'); await adjustedDownload.saveAs(adjustedPath);
    const adjustedPng = await fs.readFile(adjustedPath);
    const matchesPreview = await page.evaluate(async data => {
      const image = new Image(); image.src = data; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const decoded = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const preview = document.getElementById('previewCanvas').getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return decoded.every((value, index) => value === preview[index]);
    }, `data:image/png;base64,${adjustedPng.toString('base64')}`);
    assert.equal(matchesPreview, true);
    assert.equal(await page.locator('#includeMirror').isChecked(), false);
    await page.locator('#includeMirror').check();
    assert.equal(await page.locator('#exportButtonLabel').textContent(), 'Baixar 2 PNGs');
    assert.equal(await page.locator('#exportBundleNote').isVisible(), true);
    assert.equal(await page.locator('#exportButton').isDisabled(), false);
    const pairDownloadPromise = page.waitForEvent('download'); await page.locator('#exportButton').click();
    const pairDownload = await pairDownloadPromise;
    assert.equal(pairDownload.suggestedFilename(), 'raposa-exemplo-totem-original-e-espelho.zip');
    const pairPath = path.join(artifactDir, pairDownload.suggestedFilename()); await pairDownload.saveAs(pairPath);
    const entries = zipEntries(await fs.readFile(pairPath));
    assert.deepEqual(entries.map(entry => entry.name), ['raposa-exemplo-totem.png', 'raposa-exemplo-totem-espelhado.png']);
    for (const entry of entries) {
      assert.deepEqual([...entry.data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(entry.data.readUInt32BE(20), 1417);
      assert.equal(pngResolution(entry.data).readUInt32BE(0), 11811);
      assert.equal(pngResolution(entry.data).readUInt32BE(4), 11811);
      assert.equal(pngResolution(entry.data)[8], 1);
    }
    assert.equal(entries[0].data.readUInt32BE(16), entries[1].data.readUInt32BE(16));
    const pairComparison = await page.evaluate(async urls => {
      const decoded = await Promise.all(urls.map(async url => {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return { width: image.width, height: image.height, rgba: context.getImageData(0, 0, image.width, image.height).data };
      }));
      const [original, mirror] = decoded;
      const preview = document.getElementById('previewCanvas').getContext('2d').getImageData(0, 0, original.width, original.height).data;
      let mismatches = 0, asymmetric = false;
      for (let y = 0; y < original.height; y++) for (let x = 0; x < original.width; x++) for (let c = 0; c < 4; c++) {
        const p = (y * original.width + x) * 4 + c, mirroredP = (y * original.width + original.width - 1 - x) * 4 + c;
        if (original.rgba[p] !== mirror.rgba[mirroredP]) mismatches++;
        if (original.rgba[p] !== mirror.rgba[p]) asymmetric = true;
      }
      return { mismatches, asymmetric, originalMatchesPreview: original.rgba.every((value, i) => value === preview[i]), transparentMargins: original.rgba[3] === 0 && mirror.rgba[3] === 0 };
    }, entries.map(entry => `data:image/png;base64,${entry.data.toString('base64')}`));
    assert.deepEqual(pairComparison, { mismatches: 0, asymmetric: true, originalMatchesPreview: true, transparentMargins: true });
    await page.locator('#includeMirror').uncheck();
    assert.equal(await page.locator('#exportButtonLabel').textContent(), 'Baixar PNG');
    assert.equal(await page.locator('#exportBundleNote').isVisible(), false);
    await page.locator('#resetGradient').click();
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    assert.equal(await page.locator('#gradientDepth').inputValue(), '0');
    assert.equal(await page.locator('#gradientStrength').inputValue(), '100');
    assert.equal(await page.locator('#gradientLight').inputValue(), '218');
    assert.equal(await page.locator('#gradientCurve').inputValue(), 'smooth');
    assert.equal(await page.locator('#previewCanvas').evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.every((value, index) => value === window.gradientBaseline[index])), true);
    await page.evaluate(() => { window.scrollTo(0, 0); return new Promise(requestAnimationFrame); });
    await page.screenshot({ path: path.join(artifactDir, 'desktop.png'), fullPage: true });
    await page.locator('#originalTab').click(); assert.equal(await page.locator('#viewBadge').textContent(), 'IMAGEM ORIGINAL');
    await page.locator('#cutTab').click(); assert.match(await page.locator('#viewBadge').textContent(), /RECORTE/);
    const cornerAlpha = await page.locator('#previewCanvas').evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3]); assert.equal(cornerAlpha, 0);
    await page.locator('#gradient').selectOption('solid');
    for (const id of ['gradientDepth', 'gradientStrength', 'gradientLight', 'gradientCurve']) assert.equal(await page.locator(`#${id}`).isDisabled(), true);
    assert.equal(await page.locator('#exportButton').isDisabled(), true);
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    await page.locator('#resultTab').click();
    const downloadPromise = page.waitForEvent('download'); await page.locator('#exportButton').click();
    const download = await downloadPromise, pngPath = path.join(artifactDir, download.suggestedFilename()); await download.saveAs(pngPath);
    const png = await fs.readFile(pngPath);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20); assert.equal(height, 1417); assert.ok(width > 100);
    let phys = 0;
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
      if (type === 'pHYs') { phys++; assert.equal(png.readUInt32BE(offset + 8), 11811); assert.equal(png.readUInt32BE(offset + 12), 11811); assert.equal(png[offset + 16], 1); }
      offset += length + 12;
    }
    assert.equal(phys, 1);
    const exportedAlpha = await page.evaluate(async data => { const image = new Image(); image.src = data; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, 1, 1).data[3]; }, `data:image/png;base64,${png.toString('base64')}`);
    assert.equal(exportedAlpha, 0);
    // Invalid settings must clear the old export, then recover after correction.
    await page.locator('#height').fill('1'); await page.waitForFunction(() => document.getElementById('status').classList.contains('error'));
    assert.equal(await page.locator('#exportButton').isDisabled(), true);
    await page.locator('#height').fill('8'); await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    // Test actual PNG upload, including an enclosed white feature and a transparent output.
    const sourcePng = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 300; const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 240, 300); ctx.fillStyle = '#3567aa'; ctx.fillRect(40, 40, 160, 220); ctx.fillStyle = 'white'; ctx.fillRect(90, 110, 60, 80); return canvas.toDataURL('image/png').split(',')[1]; });
    await page.locator('#fileInput').setInputFiles({ name: 'figura-branca.png', mimeType: 'image/png', buffer: Buffer.from(sourcePng, 'base64') });
    await page.waitForFunction(() => document.getElementById('uploadTitle').textContent === 'figura-branca.png' && !document.getElementById('exportButton').disabled);
    assert.equal(await page.locator('#uploadTitle').textContent(), 'figura-branca.png');
    const centerPixel = () => page.locator('#previewCanvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]);
    assert.equal((await centerPixel())[3], 0); // A large enclosed white region is now removed by default.
    await page.locator('#minInternal').fill('20');
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    assert.deepEqual(await centerPixel(), [0, 0, 0, 255]);
    // Regression: a protected white background opening must use the black
    // backing in the inward gradient, in the preview and the downloaded PNG.
    await page.locator('#gradient').selectOption('inward');
    for (const id of ['gradientDepth', 'gradientStrength', 'gradientLight', 'gradientCurve']) assert.equal(await page.locator(`#${id}`).isDisabled(), false);
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    assert.deepEqual(await centerPixel(), [0, 0, 0, 255]);
    const artPixel = await page.locator('#previewCanvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 4), 1, 1).data]);
    assert.deepEqual(artPixel, [53, 103, 170, 255]);
    await page.locator('#originalTab').click();
    assert.deepEqual(await centerPixel(), [255, 255, 255, 255]);
    await page.locator('#resultTab').click();
    const protectedDownloadPromise = page.waitForEvent('download'); await page.locator('#exportButton').click();
    const protectedDownload = await protectedDownloadPromise;
    const protectedPath = path.join(artifactDir, 'inward-protected-spaces.png'); await protectedDownload.saveAs(protectedPath);
    const protectedBuffer = await fs.readFile(protectedPath);
    const protectedPixel = await page.evaluate(async data => { const image = new Image(); image.src = data; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return [...ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]; }, `data:image/png;base64,${protectedBuffer.toString('base64')}`);
    assert.deepEqual(protectedPixel, [0, 0, 0, 255]);
    await page.locator('#minInternal').fill('2');
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    assert.equal((await centerPixel())[3], 0);
    const openingDownload = page.waitForEvent('download'); await page.locator('#exportButton').click();
    const openedPng = await openingDownload; const openedPath = path.join(artifactDir, openedPng.suggestedFilename()); await openedPng.saveAs(openedPath);
    const openedBuffer = await fs.readFile(openedPath);
    const exportedOpening = await page.evaluate(async data => { const image = new Image(); image.src = data; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3]; }, `data:image/png;base64,${openedBuffer.toString('base64')}`);
    assert.equal(exportedOpening, 0);
    await page.locator('#minInternal').fill('');
    await page.waitForFunction(() => document.getElementById('status').classList.contains('error'));
    assert.equal(await page.locator('#exportButton').isDisabled(), true);
    await page.locator('#removeInternal').uncheck();
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    assert.equal(await page.locator('#minInternal').isDisabled(), true);
    assert.deepEqual(await centerPixel(), [255, 255, 255, 255]);
    await page.locator('#removeInternal').check(); await page.locator('#minInternal').fill('2');
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    await page.locator('#tolerance').fill('45'); await page.locator('#tolerance').fill('22'); await page.locator('#tolerance').fill('32');
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    // Model an exterior slot between two pieces whose contours almost meet.
    // Verify the actual result, cut preview and exported PNG all receive union.
    await page.locator('#height').fill('4'); await page.locator('#dpi').selectOption('150');
    await page.locator('#smoothing').fill('0'); await page.locator('#border').fill('1');
    await page.locator('#joinBorders').fill('0'); await page.locator('#gradient').selectOption('outward');
    const joinSource = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 240;
      const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 200, 240);
      context.fillStyle = '#23416e'; context.fillRect(20, 20, 60, 200); context.fillRect(100, 20, 80, 200);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#fileInput').setInputFiles({ name: 'teste-uniao.png', mimeType: 'image/png', buffer: Buffer.from(joinSource, 'base64') });
    await page.waitForFunction(() => document.getElementById('uploadTitle').textContent === 'teste-uniao.png' && !document.getElementById('exportButton').disabled);
    const gapAlpha = () => page.locator('#previewCanvas').evaluate(canvas => {
      const margin = 9, figureHeight = canvas.height - 2 * margin, figureWidth = canvas.width - 2 * margin;
      const x = margin + Math.floor(70.5 / 160 * figureWidth), y = margin + Math.floor(100.5 / 200 * figureHeight);
      return canvas.getContext('2d').getImageData(x, y, 1, 1).data[3];
    });
    assert.equal(await gapAlpha(), 0);
    await page.locator('#joinBorders').fill('2');
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    assert.equal(await page.locator('#joinBordersValue').textContent(), '2,0 mm');
    assert.equal(await gapAlpha(), 255);
    await page.locator('#cutTab').click(); assert.equal(await gapAlpha(), 255);
    await page.locator('#resultTab').click();
    const unionDownloadPromise = page.waitForEvent('download'); await page.locator('#exportButton').click();
    const unionDownload = await unionDownloadPromise, unionPath = path.join(artifactDir, unionDownload.suggestedFilename());
    await unionDownload.saveAs(unionPath); const unionPng = await fs.readFile(unionPath);
    const downloadedGap = await page.evaluate(async url => {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const margin = 9, x = margin + Math.floor(70.5 / 160 * (canvas.width - margin * 2)), y = margin + Math.floor(100.5 / 200 * (canvas.height - margin * 2));
      return [...context.getImageData(x, y, 1, 1).data];
    }, `data:image/png;base64,${unionPng.toString('base64')}`);
    assert.deepEqual(downloadedGap, [0, 0, 0, 255]);
    await page.locator('#joinBorders').fill('0');
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    assert.equal(await gapAlpha(), 0);
    await page.locator('#joinBorders').fill('2');
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    // A transparent cutout with white snow touching its exterior must preserve
    // that artwork while still cutting a genuinely transparent internal hole.
    const snowSource = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 240;
      const context = canvas.getContext('2d'); context.fillStyle = '#23416e'; context.fillRect(20, 20, 160, 200);
      context.fillStyle = 'white'; context.fillRect(20, 175, 160, 45);
      context.fillStyle = '#f8f8f8'; context.fillRect(35, 35, 55, 55);
      context.clearRect(110, 45, 50, 80);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#backgroundMode').selectOption('auto');
    await page.locator('#gradient').selectOption('inward');
    await page.locator('#fileInput').setInputFiles({ name: 'arte-com-neve.png', mimeType: 'image/png', buffer: Buffer.from(snowSource, 'base64') });
    await page.waitForFunction(() => document.getElementById('uploadTitle').textContent === 'arte-com-neve.png' && !document.getElementById('exportButton').disabled);
    assert.equal(await page.locator('#tolerance').isDisabled(), true);
    assert.match(await page.locator('#backgroundModeNote').textContent(), /branco da arte é preservado/);
    assert.match(await page.locator('#removeInternalLabel').textContent(), /transparentes/);
    const snowPixels = () => page.locator('#previewCanvas').evaluate(canvas => {
      const ctx = canvas.getContext('2d');
      const at = (x, y) => [...ctx.getImageData(9 + Math.floor((x - 20 + 0.5) / 160 * (canvas.width - 18)), 9 + Math.floor((y - 20 + 0.5) / 200 * (canvas.height - 18)), 1, 1).data];
      return { snow: at(50, 200), whiteDetail: at(50, 50), hole: at(130, 80)[3] };
    });
    assert.deepEqual(await snowPixels(), { snow: [255, 255, 255, 255], whiteDetail: [248, 248, 248, 255], hole: 0 });
    await page.locator('#cutTab').click();
    const snowyCut = await snowPixels(); assert.equal(snowyCut.snow[3], 255); assert.equal(snowyCut.whiteDetail[3], 255); assert.equal(snowyCut.hole, 0);
    await page.locator('#resultTab').click();
    const snowDownloadPromise = page.waitForEvent('download'); await page.locator('#exportButton').click();
    const snowDownload = await snowDownloadPromise, snowPath = path.join(artifactDir, 'white-art-preserved.png');
    await snowDownload.saveAs(snowPath);
    const snowPng = await fs.readFile(snowPath);
    const exportedSnow = await page.evaluate(async url => {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const at = (x, y) => [...context.getImageData(9 + Math.floor((x - 20 + 0.5) / 160 * (canvas.width - 18)), 9 + Math.floor((y - 20 + 0.5) / 200 * (canvas.height - 18)), 1, 1).data];
      return { snow: at(50, 200), whiteDetail: at(50, 50), hole: at(130, 80)[3], corner: context.getImageData(0, 0, 1, 1).data[3] };
    }, `data:image/png;base64,${snowPng.toString('base64')}`);
    assert.deepEqual(exportedSnow, { snow: [255, 255, 255, 255], whiteDetail: [248, 248, 248, 255], hole: 0, corner: 0 });
    await page.locator('#backgroundMode').selectOption('white');
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    assert.equal(await page.locator('#tolerance').isDisabled(), false);
    await page.locator('#backgroundMode').selectOption('alpha');
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    assert.equal(await page.locator('#tolerance').isDisabled(), true);
    assert.deepEqual(await snowPixels(), { snow: [255, 255, 255, 255], whiteDetail: [248, 248, 248, 255], hole: 0 });
    await page.locator('#backgroundMode').selectOption('auto');
    await page.waitForFunction(() => !document.getElementById('exportButton').disabled);
    await page.screenshot({ path: path.join(artifactDir, 'white-art-preserved.png-preview.png'), fullPage: true });
    await page.locator('#helpButton').click(); assert.equal(await page.locator('#helpDialog').isVisible(), true); await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(artifactDir, 'mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`Browser passed: opaque white artwork preserved in transparent inputs (preview/cut/export), background mode overrides, finished border union, original PNG or ZIP with mirrored PNGs, ZIP CRCs, dimensions/transparency/DPI, gradients, error recovery, mobile layout.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
