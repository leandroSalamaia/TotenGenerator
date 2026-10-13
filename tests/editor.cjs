const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const artifacts = path.resolve(__dirname, '../test-results');
async function ready(page) {
  await page.waitForFunction(() => document.getElementById('processing').hidden && !document.getElementById('exportButton').disabled, { timeout: 30000 });
}
async function pixel(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const result = state.result, p = result.placement, b = result.sourceBounds;
    const ox = p.x + Math.floor((x - b.x + 0.5) / b.width * p.width), oy = p.y + Math.floor((y - b.y + 0.5) / b.height * p.height);
    return [...result.rgba.slice((oy * result.width + ox) * 4, (oy * result.width + ox) * 4 + 4)];
  }, { x, y });
}
async function stroke(page, kind, points) {
  await page.locator(`[data-tool="${kind}"]`).click();
  const positions = await page.locator('#previewCanvas').evaluate((canvas, points) => {
    const rect = canvas.getBoundingClientRect();
    return points.map(p => ({ x: rect.left + (p.x + 0.5) / canvas.width * rect.width, y: rect.top + (p.y + 0.5) / canvas.height * rect.height }));
  }, points);
  await page.mouse.move(positions[0].x, positions[0].y); await page.mouse.down();
  for (const point of positions.slice(1)) await page.mouse.move(point.x, point.y, { steps: 5 });
  await page.mouse.up(); await ready(page);
  await page.locator('#resultTab').click();
}
function zipPngs(zip) {
  const entries = [];
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const length = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extra;
    entries.push(zip.subarray(start, start + length)); offset = start + length;
  }
  return entries;
}
async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1150 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    assert.equal(await page.locator('#editorControls').evaluate(fieldset => fieldset.disabled), true);
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 240;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 200, 240);
      ctx.fillStyle = '#1e4678'; ctx.fillRect(20, 20, 60, 200); ctx.fillRect(120, 20, 60, 200);
      ctx.fillStyle = 'white'; ctx.fillRect(35, 45, 35, 40); ctx.fillRect(20, 175, 60, 45);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const upload = () => page.locator('#fileInput').setInputFiles({ name: 'editor.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await upload(); await ready(page);
    await page.locator('#height').fill('4'); await page.locator('#dpi').selectOption('150');
    await page.locator('#border').fill('1'); await page.locator('#smoothing').fill('0'); await page.locator('#joinBorders').fill('2');
    await ready(page);
    assert.equal((await pixel(page, 52, 65))[3], 0);
    assert.equal((await pixel(page, 100, 140))[3], 0);
    await page.locator('[data-tool="preserve"]').click(); await page.locator('#brushSize').fill('50');
    const cancelledPoint = await page.locator('#previewCanvas').evaluate(canvas => {
      const r = canvas.getBoundingClientRect(); return { x: r.left + 100.5 / canvas.width * r.width, y: r.top + 65.5 / canvas.height * r.height };
    });
    await page.mouse.move(cancelledPoint.x, cancelledPoint.y); await page.mouse.down();
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert.equal(await page.evaluate(() => state.edits.length), 0);
    await stroke(page, 'preserve', [{ x: 52, y: 65 }]);
    assert.deepEqual(await pixel(page, 52, 65), [255, 255, 255, 255]);
    await stroke(page, 'preserve', [{ x: 40, y: 195 }, { x: 60, y: 195 }]);
    assert.deepEqual(await pixel(page, 50, 195), [255, 255, 255, 255]);
    await stroke(page, 'bridge', [{ x: 65, y: 140 }, { x: 130, y: 140 }]);
    assert.deepEqual(await pixel(page, 100, 140), [0, 0, 0, 255]);
    await page.locator('[data-tool="erase"]').click(); await page.locator('#brushSize').fill('10');
    await stroke(page, 'erase', [{ x: 45, y: 120 }, { x: 55, y: 120 }]);
    assert.equal((await pixel(page, 50, 120))[3], 0);
    assert.equal(await page.evaluate(() => state.edits.length), 4);
    await page.locator('#undoEdit').click(); await ready(page);
    assert.deepEqual(await pixel(page, 50, 120), [30, 70, 120, 255]);
    await page.locator('#redoEdit').click(); await ready(page); assert.equal((await pixel(page, 50, 120))[3], 0);
    await page.locator('#clearEdits').click(); await ready(page);
    assert.equal(await page.evaluate(() => state.edits.length), 0);
    assert.equal((await pixel(page, 52, 65))[3], 0); assert.equal((await pixel(page, 100, 140))[3], 0);
    await page.locator('#undoEdit').click(); await ready(page);
    assert.equal(await page.evaluate(() => state.edits.length), 4); assert.equal((await pixel(page, 50, 120))[3], 0);
    await page.locator('#resultTab').click(); await page.keyboard.press('Control+z'); await ready(page);
    assert.equal(await page.evaluate(() => state.edits.length), 3);
    assert.deepEqual(await pixel(page, 50, 120), [30, 70, 120, 255]);
    await page.keyboard.press('Control+Shift+z'); await ready(page);
    assert.equal(await page.evaluate(() => state.edits.length), 4);
    // Add a physical base without changing the requested total height.
    await page.locator('#baseEnabled').check(); await page.locator('#baseWidth').fill('60');
    await page.locator('#baseHeight').fill('8'); await page.locator('#baseColor').fill('#b04020'); await ready(page);
    const base = await page.evaluate(() => {
      const r = state.result, b = r.base, x = b.x + Math.floor(b.width / 2), y = b.y + Math.floor(b.height / 2);
      return { height: r.height, color: [...r.rgba.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)], alphaMatches: r.silhouette.every((value, index) => index % 4 !== 3 || value === r.rgba[index]) };
    });
    assert.deepEqual(base, { height: 236, color: [176, 64, 32, 255], alphaMatches: true });
    assert.deepEqual(await pixel(page, 52, 65), [255, 255, 255, 255]);
    assert.equal((await pixel(page, 50, 120))[3], 0);
    // Presets include output and base settings, retain manual edits and safely
    // render literal names. A reload must retain presets but clear image edits.
    await page.locator('#includeMirror').check();
    await page.locator('#presetName').fill('Neve <e> pontes'); await page.locator('#savePreset').click();
    const presetId = await page.locator('#presetSelect').inputValue();
    assert.ok(presetId.startsWith('user-'));
    assert.match(await page.locator('#presetNote').textContent(), /salvo/);
    await page.locator('#baseEnabled').uncheck(); await page.locator('#border').fill('0');
    await page.locator('#height').fill('6'); await page.locator('#includeMirror').uncheck(); await ready(page);
    await page.locator('#applyPreset').click(); await ready(page);
    assert.equal(await page.locator('#baseEnabled').isChecked(), true);
    assert.equal(await page.locator('#height').inputValue(), '4'); assert.equal(await page.locator('#border').inputValue(), '1');
    assert.equal(await page.locator('#includeMirror').isChecked(), true); assert.equal(await page.evaluate(() => state.edits.length), 4);
    // Export both edited images and verify exact colors, alpha and horizontal reversal.
    const downloadPromise = page.waitForEvent('download'); await page.locator('#exportButton').click();
    const download = await downloadPromise, exportPath = path.join(artifacts, 'edited-original-and-mirror.zip');
    await download.saveAs(exportPath);
    const entries = zipPngs(await fs.readFile(exportPath)); assert.equal(entries.length, 2);
    const decoded = await page.evaluate(async urls => {
      const images = await Promise.all(urls.map(async url => {
        const image = new Image(); image.src = url; await image.decode();
        const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
        const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
        return { width: c.width, height: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
      }));
      const [a, b] = images; let mirrorErrors = 0;
      for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) for (let c = 0; c < 4; c++) if (a.data[(y * a.width + x) * 4 + c] !== b.data[(y * b.width + b.width - 1 - x) * 4 + c]) mirrorErrors++;
      const preview = document.getElementById('previewCanvas').getContext('2d').getImageData(0, 0, a.width, a.height).data;
      return { mirrorErrors, exactExport: a.data.every((value, index) => value === preview[index]) };
    }, entries.map(entry => `data:image/png;base64,${entry.toString('base64')}`));
    assert.deepEqual(decoded, { mirrorErrors: 0, exactExport: true });
    await page.locator('[data-tool="none"]').click(); await page.screenshot({ path: path.join(artifacts, 'editor-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(artifacts, 'editor-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1150 });
    await page.reload();
    assert.match(await page.locator('#presetSelect').textContent(), /Neve <e> pontes/);
    await upload(); await ready(page); await page.locator('#presetSelect').selectOption(presetId);
    await page.locator('#applyPreset').click(); await ready(page);
    assert.equal(await page.evaluate(() => state.edits.length), 0);
    assert.equal(await page.locator('#baseEnabled').isChecked(), true);
    assert.equal(await page.locator('#height').inputValue(), '4');
    await page.locator('#deletePreset').click(); assert.doesNotMatch(await page.locator('#presetSelect').textContent(), /Neve <e> pontes/);
    await page.locator('#presetSelect').selectOption('builtin-black'); assert.equal(await page.locator('#deletePreset').isDisabled(), true);
    await page.locator('#applyPreset').click(); await ready(page); assert.equal(await page.locator('#gradient').inputValue(), 'solid');
    // Exercise the optional HTTP entry point too: every new script must be
    // served, and the painter must accept touch pointers on a mobile viewport.
    const server = require('../server.js').createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
      mobile.on('pageerror', error => errors.push(error.message));
      const origin = `http://127.0.0.1:${server.address().port}`;
      assert.equal((await mobile.request.get(`${origin}/editor.js`)).status(), 200);
      assert.equal((await mobile.request.get(`${origin}/.git/config`)).status(), 404);
      await mobile.goto(origin);
      await mobile.locator('#fileInput').setInputFiles({ name: 'touch.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }); await ready(mobile);
      await mobile.locator('#height').fill('4'); await mobile.locator('#dpi').selectOption('150'); await ready(mobile);
      await mobile.locator('[data-tool="preserve"]').click(); await mobile.locator('#brushSize').fill('50');
      const touchPoint = await mobile.locator('#previewCanvas').evaluate(canvas => {
        const r = canvas.getBoundingClientRect(); return { x: r.left + 52.5 / canvas.width * r.width, y: r.top + 65.5 / canvas.height * r.height };
      });
      await mobile.touchscreen.tap(touchPoint.x, touchPoint.y); await ready(mobile);
      assert.equal(await mobile.evaluate(() => state.edits.length), 1);
      assert.deepEqual(await pixel(mobile, 52, 65), [255, 255, 255, 255]);
      await mobile.close();
    } finally { await new Promise(resolve => server.close(resolve)); }
    assert.deepEqual(errors, []);
    console.log('Editor passed: real brush/bridge gestures + touch, Escape, original white restoration, eraser priority, undo/redo/clear/keyboard, physical base, preset persistence/application/deletion, exact edited PNG + mirror, file/HTTP loading, mobile layout.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
