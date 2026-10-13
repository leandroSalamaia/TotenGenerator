'use strict';
const $ = id => document.getElementById(id);
const state = { source: null, result: null, view: 'result', worker: null, revision: 0, loadRevision: 0, debounce: null, name: 'totem', originalSize: null, edits: [], foilEffects: [], foilRevision: 0, mirrorBeforeFoil: null, exporting: false };
const gradientControlIds = ['gradientDepth', 'gradientStrength', 'gradientLight', 'gradientCurve'];
const controlIds = ['backgroundMode', 'tolerance', 'smoothing', 'border', 'joinBorders', 'gradient', ...gradientControlIds, 'cleanNoise', 'removeInternal', 'minInternal', 'baseEnabled', 'baseShape', 'baseWidth', 'baseHeight', 'baseColor', 'height', 'dpi'];
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function settings() {
  return { backgroundMode: $('backgroundMode').value, tolerance: +$('tolerance').value, smoothing: +$('smoothing').value, borderMm: +$('border').value, joinBordersMm: +$('joinBorders').value, gradient: $('gradient').value, gradientDepth: +$('gradientDepth').value, gradientStrength: +$('gradientStrength').value, gradientLight: +$('gradientLight').value, gradientCurve: $('gradientCurve').value, cleanNoise: $('cleanNoise').checked, removeInternal: $('removeInternal').checked, minInternalMm: +$('minInternal').value, baseEnabled: $('baseEnabled').checked, baseShape: $('baseShape').value, baseWidthMm: +$('baseWidth').value, baseHeightMm: +$('baseHeight').value, baseColor: $('baseColor').value, heightCm: +$('height').value, dpi: +$('dpi').value };
}
function updateLabels() {
  for (const id of ['baseShape', 'baseWidth', 'baseHeight', 'baseColor']) $(id).disabled = !$('baseEnabled').checked;
  $('baseSettings').classList.toggle('inactive', !$('baseEnabled').checked);
  const requestedMode = $('backgroundMode').value;
  const mode = state.source ? TotemEngine.resolveBackgroundMode(state.source.data, state.source.width, state.source.height, requestedMode) : requestedMode;
  const preserveWhites = mode === 'alpha';
  $('tolerance').disabled = preserveWhites;
  $('removeInternalLabel').textContent = preserveWhites ? 'Recortar espaços transparentes internos' : 'Remover espaços brancos internos';
  $('backgroundModeNote').textContent = preserveWhites
    ? 'O recorte usa a transparência original. O branco da arte é preservado, inclusive nas bordas.'
    : mode === 'white' ? 'O branco é tratado como fundo. Para preservar neve e outros detalhes, prefira uma imagem já transparente.' : 'Imagens com fundo transparente preservam o branco da arte.';
  $('toleranceValue').value = $('tolerance').value;
  $('smoothingValue').value = $('smoothing').value;
  $('borderValue').value = (+$('border').value).toLocaleString('pt-BR', { minimumFractionDigits: 1 }) + ' mm';
  const join = (+$('joinBorders').value).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  $('joinBordersValue').value = (+$('joinBorders').value).toLocaleString('pt-BR', { minimumFractionDigits: 1 }) + ' mm';
  $('joinBordersNote').textContent = +$('joinBorders').value > 0 ? `Fecha frestas de até aproximadamente ${join} mm entre os contornos, preservando aberturas maiores.` : 'Sem união extra entre os contornos. O limite de espaços internos continua protegendo furos pequenos.';
  $('minInternal').disabled = !$('removeInternal').checked;
  const minimum = (+$('minInternal').value).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  document.querySelector('.internal-space-setting .setting-note').textContent = $('removeInternal').checked
    ? (+$('minInternal').value === 0 ? `Recorte todos os espaços ${preserveWhites ? 'transparentes' : 'brancos'} internos. O contorno pode fechar aberturas muito estreitas.` : `Abaixo de ${minimum} mm, preserve o espaço. O limite considera a abertura que sobra depois do contorno.`)
    : preserveWhites ? 'Mantenha os furos transparentes internos fechados no recorte. As cores da arte são preservadas.' : 'Preserve os espaços brancos internos e mantenha os furos internos fechados no recorte.';
  const gradient = $('gradient').value;
  $('gradientDepthValue').value = $('gradientDepth').value + '%';
  $('gradientStrengthValue').value = $('gradientStrength').value + '%';
  $('gradientLightValue').value = Math.round(+$('gradientLight').value / 255 * 100) + '%';
  const disabled = gradient === 'solid' || +$('border').value === 0;
  for (const id of gradientControlIds) $(id).disabled = disabled;
  $('gradientAdjustments').classList.toggle('inactive', disabled);
  $('gradientNote').textContent = gradient === 'solid' ? 'Escolha um degradê para ajustar os tons e a transição.' : +$('border').value === 0 ? 'Aumente a espessura do contorno para visualizar o degradê.' : 'A profundidade aumenta a faixa escura dentro do contorno.';
  const options = TotemEngine.gradientOptions(settings());
  const stops = Array.from({ length: 41 }, (_, index) => {
    const gray = TotemEngine.gradientGray(index / 40, gradient, options);
    return `rgb(${gray}, ${gray}, ${gray}) ${index * 2.5}%`;
  });
  $('gradientSwatch').querySelector('div').style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
}
function stopWorker() { if (state.worker) { state.worker.terminate(); state.worker = null; } }
function queueProcess() {
  TotemFoil.deactivate();
  updateLabels();
  if (!state.source) return;
  state.revision++;
  stopWorker();
  clearTimeout(state.debounce);
  $('exportButton').disabled = true;
  $('processing').hidden = false;
  TotemEditor.update(); TotemFoil.update();
  state.debounce = setTimeout(runProcessing, 180);
}
function runProcessing() {
  const config = settings(), id = state.revision;
  message('');
  if (!Number.isFinite(config.heightCm) || config.heightCm < 2 || config.heightCm > 30) { failed('Informe uma altura entre 2 e 30 cm.'); return; }
  if ($('removeInternal').checked && (!$('minInternal').value.trim() || !Number.isFinite(config.minInternalMm) || config.minInternalMm < 0 || config.minInternalMm > 20)) { failed('Informe um limite de espaços internos entre 0 e 20 mm.'); return; }
  const input = { rgba: state.source.data.slice(), width: state.source.width, height: state.source.height, settings: config, edits: state.edits };
  try {
    const url = URL.createObjectURL(new Blob([TotemEngine.workerSource()], { type: 'text/javascript' }));
    const worker = new Worker(url); URL.revokeObjectURL(url); state.worker = worker;
    worker.onmessage = event => {
      if (event.data.id !== state.revision) return;
      stopWorker();
      if (event.data.error) failed(event.data.error); else completed(event.data.result, config);
    };
    worker.onerror = () => { if (id === state.revision) { stopWorker(); failed('Não foi possível processar a imagem. Tente uma imagem menor ou abra pelo Iniciar.bat.'); } };
    worker.postMessage({ id, input }, [input.rgba.buffer]);
  } catch (error) {
    // A local file can still work in a browser that disallows Blob workers.
    stopWorker();
    setTimeout(() => { if (id !== state.revision) return; try { completed(TotemEngine.processImage(input), config); } catch (error) { failed(error.message); } }, 20);
  }
}
function failed(error) {
  state.result = null;
  $('processing').hidden = true;
  $('exportButton').disabled = true;
  $('exportInfo').textContent = 'Ajuste as opções para gerar um novo PNG.';
  $('imageInfo').textContent = 'Resultado indisponível';
  message(error, true);
  renderPreview();
}
function completed(result, config) {
  state.result = result;
  $('processing').hidden = true;
  $('exportButton').disabled = false;
  const wcm = result.width / result.dpi * 2.54, hcm = result.height / result.dpi * 2.54;
  $('imageInfo').textContent = `${result.width} × ${result.height} px · ${result.dpi} dpi`;
  $('exportInfo').textContent = `${wcm.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} × ${hcm.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} cm · PNG transparente`;
  const notes = [];
  if (result.backgroundMode === 'alpha') notes.push('Transparência original usada no recorte; brancos da arte preservados.');
  if (state.originalSize.height < result.figurePixels) notes.push('A imagem foi ampliada. Uma original maior preserva mais detalhes na impressão.');
  if (result.removed) notes.push(`${result.removed} ${result.removed === 1 ? 'ponto solto removido' : 'pontos soltos removidos'}.`);
  if (result.joinedPixels) notes.push('Frestas pequenas fechadas no contorno final.');
  if (state.edits.length) notes.push(`${state.edits.length} ${state.edits.length === 1 ? 'edição manual aplicada' : 'edições manuais aplicadas'}.`);
  if (result.base) notes.push('Base incluída na altura total.');
  if (result.internalSpaces && config.removeInternal) {
    const { opened, preserved } = result.internalSpaces;
    notes.push(`${opened} ${opened === 1 ? 'espaço interno aberto' : 'espaços internos abertos'}${preserved ? `; ${preserved} ${preserved === 1 ? 'preservado abaixo do limite' : 'preservados abaixo do limite'}` : ''}.`);
  }
  const b = result.sourceBounds;
  if (b.x === 0 || b.y === 0 || b.x + b.width === state.source.width || b.y + b.height === state.source.height) notes.push('A figura encosta na borda da imagem. Confira se o recorte está completo.');
  message(notes.join(' ')); renderPreview();
}
function renderPreview() {
  TotemEditor.update(); TotemFoil.update();
  const canvas = $('previewCanvas'), context = canvas.getContext('2d');
  const image = state.view === 'original' ? state.source : state.result;
  if (!image) { canvas.hidden = true; $('foilOverlayCanvas').hidden = true; $('viewBadge').hidden = true; $('emptyState').hidden = Boolean(state.source); return; }
  let frame = state.result ? { width: state.result.width, height: state.result.height, offsetX: 0, offsetY: 0 } : null;
  try { if (state.result) frame = TotemFoil.frame(state.result); }
  catch (error) { $('exportButton').disabled = true; message(error.message, true); }
  if (state.view === 'original') {
    canvas.width = image.width; canvas.height = image.height; context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  } else {
    canvas.width = frame.width; canvas.height = frame.height;
    if (state.view !== 'foil') context.putImageData(new ImageData(state.view === 'cut' ? image.silhouette : image.rgba, image.width, image.height), frame.offsetX, frame.offsetY);
    if (['foil', 'composite'].includes(state.view)) TotemFoil.draw(context, frame, state.view === 'foil');
  }
  TotemEditor.drawOverlay(canvas);
  canvas.hidden = false; $('emptyState').hidden = true;
  $('viewBadge').hidden = false;
  $('viewBadge').textContent = state.view === 'original' ? 'IMAGEM ORIGINAL' : state.view === 'cut' ? 'CONFIRA AS PARTES DO RECORTE' : state.view === 'foil' ? 'CAMADA FOIL ISOLADA' : state.view === 'composite' ? 'ARTE COM FOIL' : 'ARTE SEM FOIL';
  if (state.result) {
    $('imageInfo').textContent = `${frame.width} × ${frame.height} px · ${state.result.dpi} dpi`;
    $('exportInfo').textContent = `${(frame.width / state.result.dpi * 2.54).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} × ${(frame.height / state.result.dpi * 2.54).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} cm · PNG transparente`;
  }
  TotemFoil.drawSelection(canvas);
}
async function loadImage(file, demo = false) {
  if (!file) return;
  if (!demo && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { message('Escolha um arquivo PNG, JPG ou WEBP.', true); return; }
  if (file.size > 30 * 1024 * 1024) { message('O arquivo excede 30 MB. Escolha uma imagem menor.', true); return; }
  const loadId = ++state.loadRevision;
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url; await image.decode();
    if (loadId !== state.loadRevision) return;
    if (image.naturalWidth * image.naturalHeight > 80000000) throw new Error('Esta imagem é muito grande para abrir. Reduza para menos de 80 megapixels.');
    // Cap the analysis image to bound memory use. Output resolution is independent.
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    state.source = context.getImageData(0, 0, canvas.width, canvas.height);
    TotemEditor.reset();
    TotemFoil.reset();
    state.originalSize = { width: image.naturalWidth, height: image.naturalHeight };
    state.name = demo ? 'raposa-exemplo' : file.name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_ -]/gu, '').slice(0, 80) || 'totem';
    state.result = null;
    $('uploadTitle').textContent = demo ? 'Raposa · imagem de exemplo' : file.name;
    $('controls').disabled = false; $('emptyState').hidden = true; $('previewCanvas').hidden = true;
    setView('result'); queueProcess();
  } catch (error) {
    if (loadId === state.loadRevision) message(error.message.startsWith('Esta imagem') ? error.message : 'Não foi possível abrir esta imagem. O arquivo pode estar corrompido ou em um formato incompatível.', true);
  } finally { URL.revokeObjectURL(url); $('fileInput').value = ''; }
}
function setView(view) {
  if (['foil', 'composite'].includes(view)) TotemEditor.deactivate(); else TotemFoil.deactivate();
  state.view = view;
  for (const [id, value] of [['resultTab', 'result'], ['originalTab', 'original'], ['cutTab', 'cut'], ['compositeTab', 'composite'], ['foilTab', 'foil']]) { $(id).classList.toggle('active', value === view); $(id).setAttribute('aria-pressed', String(value === view)); }
  renderPreview();
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
async function withPngResolution(blob, dpi) {
  const png = new Uint8Array(await blob.arrayBuffer()), chunk = new Uint8Array(21), view = new DataView(chunk.buffer);
  view.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4);
  const ppm = Math.round(dpi / 0.0254); view.setUint32(8, ppm); view.setUint32(12, ppm); chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  // Insert pHYs after IHDR, remove any existing pHYs to avoid duplicate metadata.
  const parts = [png.subarray(0, 33), chunk];
  for (let offset = 33; offset < png.length;) {
    const length = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0), end = offset + length + 12;
    if (String.fromCharCode(...png.subarray(offset + 4, offset + 8)) !== 'pHYs') parts.push(png.subarray(offset, end));
    offset = end;
  }
  return new Blob(parts, { type: 'image/png' });
}
async function canvasPng(canvas, dpi) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Falha ao criar o PNG. Tente reduzir o tamanho.');
  return withPngResolution(blob, dpi);
}
// Store the already-compressed PNGs without adding an online ZIP dependency.
async function zipPngs(files) {
  const entries = await Promise.all(files.map(async file => ({ name: new TextEncoder().encode(file.name), data: new Uint8Array(await file.blob.arrayBuffer()) })));
  const localParts = [], centralParts = [];
  let offset = 0, centralSize = 0;
  const date = new Date();
  const dosDate = (Math.min(2107, Math.max(1980, date.getFullYear())) - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate();
  const dosTime = date.getHours() << 11 | date.getMinutes() << 5 | Math.floor(date.getSeconds() / 2);
  for (const entry of entries) {
    const crc = crc32(entry.data), local = new Uint8Array(30 + entry.name.length), central = new Uint8Array(46 + entry.name.length);
    const lv = new DataView(local.buffer), cv = new DataView(central.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.data.length, true); lv.setUint32(22, entry.data.length, true); lv.setUint16(26, entry.name.length, true);
    local.set(entry.name, 30);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.data.length, true); cv.setUint32(24, entry.data.length, true); cv.setUint16(28, entry.name.length, true); cv.setUint32(42, offset, true);
    central.set(entry.name, 46);
    localParts.push(local, entry.data); centralParts.push(central);
    offset += local.length + entry.data.length; centralSize += central.length;
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function updateExportMode(preferenceChanged = false) {
  const hasFoil = state.foilEffects.length > 0;
  if (hasFoil) {
    if (state.mirrorBeforeFoil === null || preferenceChanged) state.mirrorBeforeFoil = $('includeMirror').checked;
    $('includeMirror').checked = true;
  } else if (state.mirrorBeforeFoil !== null) { $('includeMirror').checked = state.mirrorBeforeFoil; state.mirrorBeforeFoil = null; }
  $('includeMirror').disabled = hasFoil;
  $('exportButtonLabel').textContent = hasFoil ? 'Baixar 4 PNGs' : $('includeMirror').checked ? 'Baixar 2 PNGs' : 'Baixar PNG';
  $('exportBundleNote').textContent = hasFoil ? 'Arte + espelho sem foil + foil isolado + arte com foil · 4 PNGs alinhados' : 'Original + espelho horizontal · 2 PNGs em um ZIP';
  $('exportBundleNote').hidden = !hasFoil && !$('includeMirror').checked;
}
async function exportPng() {
  const result = state.result;
  if (!result || $('exportButton').disabled) return;
  const revision = state.revision, name = state.name, includeMirror = $('includeMirror').checked;
  state.exporting = true; TotemEditor.update(); TotemFoil.update();
  $('exportButton').disabled = true;
  try {
    if (state.foilEffects.length) {
      const layers = TotemFoil.layers(result);
      const names = [`${name}-totem.png`, `${name}-totem-espelhado.png`, `${name}-foil.png`, `${name}-totem-com-foil.png`];
      const canvases = [layers.normal, layers.mirror, layers.foil, layers.composite];
      const files = await Promise.all(canvases.map(async (canvas, index) => ({ name: names[index], blob: await canvasPng(canvas, result.dpi) })));
      downloadBlob(await zipPngs(files), `${name}-totem-e-foil-4-pngs.zip`);
      message('ZIP exportado com 4 PNGs alinhados: arte e espelho sem foil, foil isolado e arte com foil.');
    } else if (includeMirror) {
      const canvas = document.createElement('canvas'); canvas.width = result.width; canvas.height = result.height;
      canvas.getContext('2d').putImageData(new ImageData(result.rgba, result.width, result.height), 0, 0);
      const mirror = document.createElement('canvas'); mirror.width = result.width; mirror.height = result.height;
      const context = mirror.getContext('2d'); context.translate(result.width, 0); context.scale(-1, 1); context.drawImage(canvas, 0, 0);
      const [originalPng, mirrorPng] = await Promise.all([canvasPng(canvas, result.dpi), canvasPng(mirror, result.dpi)]);
      const zip = await zipPngs([{ name: `${name}-totem.png`, blob: originalPng }, { name: `${name}-totem-espelhado.png`, blob: mirrorPng }]);
      downloadBlob(zip, `${name}-totem-original-e-espelho.zip`);
      message('ZIP exportado com 2 PNGs: original e espelhado horizontalmente. Extraia as imagens para importar no Design Space.');
    } else {
      const canvas = document.createElement('canvas'); canvas.width = result.width; canvas.height = result.height;
      canvas.getContext('2d').putImageData(new ImageData(result.rgba, result.width, result.height), 0, 0);
      downloadBlob(await canvasPng(canvas, result.dpi), `${name}-totem.png`);
      message('PNG exportado. No Design Space, confira o tamanho e a silhueta antes de imprimir e cortar.');
    }
  } catch (error) { message(error.message, true); }
  finally { state.exporting = false; if (revision === state.revision && state.result) $('exportButton').disabled = false; TotemEditor.update(); TotemFoil.update(); }
}
function sampleImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1200" viewBox="0 0 1000 1200"><rect width="1000" height="1200" fill="white"/><g stroke="#523726" stroke-width="8" stroke-linejoin="round"><path d="M604 728C913 647 951 879 798 989C747 1026 650 1035 558 954" fill="#d97934"/><path d="M880 759C914 838 877 936 798 989C759 1011 718 1019 680 1019C764 950 812 867 800 771" fill="#fff3dc"/><path d="M345 709C322 786 276 911 306 1010C360 1061 652 1061 695 1004C714 915 661 785 630 708Z" fill="#dc8239"/><path d="M462 749C406 823 408 974 450 1022H585C615 932 604 818 550 749" fill="#fff3dc"/><path d="M333 843 310 1005C319 1054 390 1056 409 1013L415 900M626 851 674 1005C665 1054 596 1056 577 1013L566 903" fill="#dc8239"/><path d="M253 478 244 164Q246 122 283 150L421 307M745 478 762 164Q760 122 723 150L580 307" fill="#d97934"/><path d="m279 386-6-187 113 149M716 386l18-187-121 149" fill="#f2b681"/><path d="M231 473C259 329 363 287 500 293C642 288 745 339 771 473L805 564C724 630 689 717 586 758C534 790 467 790 416 758C313 717 277 630 194 564Z" fill="#e5893d"/><path d="M199 557C275 527 353 559 441 649L499 706L559 648C646 559 726 527 799 557C721 635 690 716 586 758C534 790 467 790 416 758C313 717 277 630 199 557Z" fill="#fff3dc"/><path d="M449 648Q500 626 551 648Q531 685 500 688Q469 685 449 648Z" fill="#523726"/><path d="M500 689v28m-39 5q39 37 78 0" fill="none" stroke-linecap="round"/><path d="M331 520q34-43 67 0m205 0q34-43 67 0" fill="none" stroke-width="13" stroke-linecap="round"/></g><ellipse cx="329" cy="569" rx="27" ry="15" fill="#d16c40" opacity=".45"/><ellipse cx="671" cy="569" rx="27" ry="15" fill="#d16c40" opacity=".45"/><path d="m455 327 45 62 44-62" fill="#f4b876"/><g fill="#648163"><path d="M388 762q58-49 113 9q-67 64-113-9M611 762q-58-49-113 9q67 64 113-9"/><circle cx="500" cy="775" r="20" fill="#3d644b"/></g></svg>`;
  loadImage(new File([svg], 'exemplo.svg', { type: 'image/svg+xml' }), true);
}
$('fileInput').addEventListener('change', event => loadImage(event.target.files[0]));
$('chooseButton').addEventListener('click', () => $('fileInput').click());
$('dropZone').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('fileInput').click(); } });
for (const eventName of ['dragenter', 'dragover']) $('dropZone').addEventListener(eventName, event => { event.preventDefault(); $('dropZone').classList.add('dragging'); });
for (const eventName of ['dragleave', 'drop']) $('dropZone').addEventListener(eventName, event => { event.preventDefault(); $('dropZone').classList.remove('dragging'); });
$('dropZone').addEventListener('drop', event => loadImage(event.dataTransfer.files[0]));
// Prevent the browser from navigating away when an image is dropped outside the target.
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
$('sampleButton').addEventListener('click', sampleImage);
$('resetGradient').addEventListener('click', () => {
  const defaults = { gradientDepth: 0, gradientStrength: 100, gradientLight: 218, gradientCurve: 'smooth' };
  for (const [id, value] of Object.entries(defaults)) $(id).value = value;
  queueProcess();
});
for (const id of controlIds) $(id).addEventListener('input', queueProcess);
for (const [id, view] of [['resultTab', 'result'], ['originalTab', 'original'], ['cutTab', 'cut'], ['compositeTab', 'composite'], ['foilTab', 'foil']]) $(id).addEventListener('click', () => setView(view));
for (const button of document.querySelectorAll('[data-bg]')) button.addEventListener('click', () => {
  $('canvasStage').classList.remove('checker', 'white', 'dark'); $('canvasStage').classList.add(button.dataset.bg);
  for (const item of document.querySelectorAll('[data-bg]')) { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); }
});
$('exportButton').addEventListener('click', exportPng);
$('includeMirror').addEventListener('change', () => updateExportMode(true));
$('helpButton').addEventListener('click', () => $('helpDialog').showModal());
$('closeHelp').addEventListener('click', () => $('helpDialog').close());
$('helpDialog').addEventListener('click', event => { if (event.target === $('helpDialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
TotemEditor.init({ state, $, queueProcess, renderPreview, setView, controlIds, updateExportMode });
TotemFoil.init({ state, $, renderPreview, setView, updateExportMode, message });
updateLabels();
updateExportMode();
