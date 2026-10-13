/* Image processing shared by the local browser worker and the Node tests. */
(function (root) {
  'use strict';
  function floodExterior(passable, width, height) {
    const n = width * height, visited = new Uint8Array(n), queue = new Int32Array(n);
    let head = 0, tail = 0;
    function add(i) { if (passable[i] && !visited[i]) { visited[i] = 1; queue[tail++] = i; } }
    for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
    while (head < tail) {
      const i = queue[head++], x = i % width;
      if (x) add(i - 1); if (x < width - 1) add(i + 1);
      if (i >= width) add(i - width); if (i + width < n) add(i + width);
    }
    return visited;
  }
  function segment(rgba, width, height, tolerance) {
    const n = width * height, candidate = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      candidate[i] = rgba[p + 3] <= 16 || Math.min(rgba[p], rgba[p + 1], rgba[p + 2]) >= 255 - tolerance ? 1 : 0;
    }
    const exterior = floodExterior(candidate, width, height), mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = !exterior[i] && rgba[i * 4 + 3] > 16 ? 1 : 0;
    return mask;
  }
  function removeSpecks(mask, width, height) {
    const n = mask.length, visited = new Uint8Array(n), queue = new Int32Array(n);
    const minimum = Math.max(8, Math.floor(n * 0.000025));
    let removed = 0, kept = 0;
    for (let start = 0; start < n; start++) {
      if (!mask[start] || visited[start]) continue;
      let head = 0, tail = 1; queue[0] = start; visited[start] = 1;
      while (head < tail) {
        const i = queue[head++], x = i % width, y = Math.floor(i / width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
          const next = i + dy * width + dx;
          if (mask[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
        }
      }
      if (tail < minimum) { for (let j = 0; j < tail; j++) mask[queue[j]] = 0; removed++; } else kept++;
    }
    return { removed, kept };
  }
  function fillInterior(mask, width, height) {
    const inverse = Uint8Array.from(mask, value => value ? 0 : 1);
    const exterior = floodExterior(inverse, width, height);
    for (let i = 0; i < mask.length; i++) if (!exterior[i]) mask[i] = 1;
    return mask;
  }
  // Keep internal openings only when a circle of the requested physical width
  // fits after the outline. This protects long, thin slots as well as tiny dots.
  function filterInternalSpaces(mask, candidate, width, height, minimumPixels, borderPixels, remove, pixels = null) {
    const visited = floodExterior(candidate, width, height), queue = new Int32Array(mask.length);
    const distances = remove && minimumPixels > 0 ? distanceTo(candidate, width, height, 0) : null;
    let opened = 0, preserved = 0;
    for (let start = 0; start < mask.length; start++) {
      if (!candidate[start] || visited[start]) continue;
      let head = 0, tail = 1, maximumRadius = 0;
      queue[0] = start; visited[start] = 1;
      while (head < tail) {
        const i = queue[head++], x = i % width;
        if (distances) maximumRadius = Math.max(maximumRadius, distances[i] - 0.5);
        const neighbors = [x ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i + width < mask.length ? i + width : -1];
        for (const next of neighbors) if (next >= 0 && candidate[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
      }
      const shouldOpen = remove && (minimumPixels === 0 || maximumRadius * 2 - borderPixels * 2 >= minimumPixels);
      for (let j = 0; j < tail; j++) {
        const i = queue[j];
        mask[i] = shouldOpen ? 0 : 1;
        // Keep protected background gaps opaque in the cut mask, but let the
        // outline provide their color instead of printing the source white.
        if (remove && pixels) pixels[i * 4 + 3] = 0;
      }
      if (shouldOpen) opened++; else preserved++;
    }
    return { opened, preserved };
  }
  function maskBounds(mask, width, height) {
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }
  // Exact Euclidean distance transform, linear in the number of pixels.
  function distanceTo(mask, width, height, target) {
    const n = width * height, result = new Float32Array(n), length = Math.max(width, height);
    const f = new Float64Array(length), d = new Float64Array(length), v = new Int32Array(length), z = new Float64Array(length + 1);
    function transform(count) {
      let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
      for (let q = 1; q < count; q++) {
        let s;
        do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * (q - p)); if (s <= z[k]) k--; else break; } while (k >= 0);
        k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
      }
      k = 0;
      for (let q = 0; q < count; q++) { while (z[k + 1] < q) k++; const diff = q - v[k]; d[q] = diff * diff + f[v[k]]; }
    }
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) f[y] = mask[y * width + x] === target ? 0 : 1e12;
      transform(height);
      for (let y = 0; y < height; y++) result[y * width + x] = d[y];
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) f[x] = result[y * width + x];
      transform(width);
      for (let x = 0; x < width; x++) result[y * width + x] = Math.sqrt(d[x]);
    }
    return result;
  }
  function boxBlur(values, width, height, radius) {
    if (radius < 1) return Float32Array.from(values);
    const temp = new Float32Array(values.length), output = new Float32Array(values.length), size = radius * 2 + 1;
    for (let y = 0; y < height; y++) {
      let sum = 0, base = y * width;
      for (let x = -radius; x <= radius; x++) sum += values[base + Math.max(0, Math.min(width - 1, x))];
      for (let x = 0; x < width; x++) {
        temp[base + x] = sum / size;
        sum += values[base + Math.min(width - 1, x + radius + 1)] - values[base + Math.max(0, x - radius)];
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += temp[Math.max(0, Math.min(height - 1, y)) * width + x];
      for (let y = 0; y < height; y++) {
        output[y * width + x] = sum / size;
        sum += temp[Math.min(height - 1, y + radius + 1) * width + x] - temp[Math.max(0, y - radius) * width + x];
      }
    }
    return output;
  }
  function smoothMask(mask, width, height, radius) {
    if (radius <= 0) return mask.slice();
    const closeRadius = Math.max(1, radius * 0.6), outside = distanceTo(mask, width, height, 1);
    let closed = Uint8Array.from(outside, distance => distance <= closeRadius ? 1 : 0);
    const inside = distanceTo(closed, width, height, 0);
    for (let i = 0; i < closed.length; i++) closed[i] = inside[i] > closeRadius ? 1 : 0;
    let blurred = boxBlur(closed, width, height, Math.max(1, Math.round(radius)));
    blurred = boxBlur(blurred, width, height, Math.max(1, Math.round(radius * 0.5)));
    return Uint8Array.from(blurred, value => value >= 0.5 ? 1 : 0);
  }
  function resizeArtwork(rgba, mask, width, height, bounds, outputWidth, outputHeight, margin, figureWidth, figureHeight) {
    const pixels = new Uint8ClampedArray(outputWidth * outputHeight * 4), resizedMask = new Uint8Array(outputWidth * outputHeight);
    for (let y = 0; y < figureHeight; y++) for (let x = 0; x < figureWidth; x++) {
      const sx = Math.max(bounds.x, Math.min(bounds.x + bounds.width - 1, bounds.x + (x + 0.5) * bounds.width / figureWidth - 0.5));
      const sy = Math.max(bounds.y, Math.min(bounds.y + bounds.height - 1, bounds.y + (y + 0.5) * bounds.height / figureHeight - 0.5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
      const indices = [y0 * width + x0, y0 * width + x1, y1 * width + x0, y1 * width + x1];
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      let coverage = 0, alpha = 0, r = 0, g = 0, b = 0;
      for (let k = 0; k < 4; k++) {
        const i = indices[k], p = i * 4, weight = weights[k], a = mask[i] * rgba[p + 3] / 255 * weight;
        coverage += mask[i] * weight; alpha += a; r += rgba[p] * a; g += rgba[p + 1] * a; b += rgba[p + 2] * a;
      }
      const i = (y + margin) * outputWidth + x + margin, p = i * 4;
      resizedMask[i] = coverage >= 0.5 ? 1 : 0;
      if (alpha > 0) { pixels[p] = r / alpha; pixels[p + 1] = g / alpha; pixels[p + 2] = b / alpha; pixels[p + 3] = alpha * 255; }
    }
    return { pixels, mask: resizedMask };
  }
  function gradientOptions(settings = {}) {
    const depth = settings.gradientDepth ?? 0, strength = settings.gradientStrength ?? 100, light = settings.gradientLight ?? 218;
    const curve = settings.gradientCurve ?? 'smooth';
    if (!Number.isFinite(depth) || depth < 0 || depth > 85 || !Number.isFinite(strength) || strength < 0 || strength > 100 || !Number.isFinite(light) || light < 0 || light > 240 || !['smooth', 'linear', 'sharp'].includes(curve)) {
      throw new Error('Os ajustes do degradê são inválidos. Use Restaurar para voltar ao padrão.');
    }
    return { depth: depth / 100, strength: strength / 100, light, curve };
  }
  function gradientGray(position, direction, options) {
    if (direction === 'solid') return 0;
    // Depth reserves a solid dark band at the selected dark end of the outline.
    const fromDark = direction === 'inward' ? position : 1 - position;
    const t = Math.max(0, Math.min(1, (fromDark - options.depth) / (1 - options.depth)));
    let transition = t;
    if (options.curve === 'smooth') transition = t * t * (3 - 2 * t);
    if (options.curve === 'sharp') {
      const a = t * t * t, b = (1 - t) * (1 - t) * (1 - t);
      transition = a / (a + b);
    }
    return Math.round(options.light * (1 - options.strength + options.strength * transition));
  }
  function renderArtwork(pixels, mask, width, height, borderPixels, gradient, options) {
    const outside = distanceTo(mask, width, height, 1), inside = distanceTo(mask, width, height, 0);
    const output = new Uint8ClampedArray(pixels.length), silhouette = new Uint8ClampedArray(pixels.length);
    for (let i = 0; i < mask.length; i++) {
      const p = i * 4, signed = mask[i] ? -(inside[i] - 0.5) : outside[i] - 0.5;
      const coverage = Math.max(0, Math.min(1, borderPixels - signed + 0.5));
      if (coverage <= 0) continue;
      const t = borderPixels > 0 ? Math.max(0, Math.min(1, Math.max(0, signed) / borderPixels)) : 0;
      const gray = gradientGray(t, gradient, options);
      // Extend the selected outline color into areas added by smoothing or hole
      // protection. Original opaque artwork covers this backing unchanged.
      const artAlpha = pixels[p + 3] / 255 * Math.max(0, Math.min(1, 0.5 - signed));
      for (let c = 0; c < 3; c++) output[p + c] = pixels[p + c] * artAlpha + gray * (1 - artAlpha);
      output[p + 3] = Math.round(coverage * 255);
      silhouette[p] = 36; silhouette[p + 1] = 62; silhouette[p + 2] = 52; silhouette[p + 3] = output[p + 3];
    }
    return { output, silhouette };
  }
  function processImage(input) {
    const { rgba, width, height, settings } = input;
    if (!width || !height || rgba.length !== width * height * 4) throw new Error('Imagem inválida. Escolha outro arquivo.');
    let mask = segment(rgba, width, height, settings.tolerance);
    const cleanup = settings.cleanNoise ? removeSpecks(mask, width, height) : { removed: 0, kept: null };
    const bounds = maskBounds(mask, width, height);
    if (!bounds) throw new Error('Nenhuma figura encontrada. Diminua a remoção do branco ou desative a limpeza de pontos.');
    const dpi = settings.dpi, outputHeight = Math.round(settings.heightCm / 2.54 * dpi), borderPixels = settings.borderMm / 25.4 * dpi;
    const smoothRadius = settings.smoothing * dpi / 300, margin = Math.ceil(borderPixels + smoothRadius * 2 + 3);
    const figureHeight = outputHeight - 2 * margin, figureWidth = Math.round(bounds.width / bounds.height * figureHeight), outputWidth = figureWidth + 2 * margin;
    if (figureHeight < 10 || figureWidth < 1) throw new Error('O contorno está grande para esta altura. Aumente a altura ou diminua o contorno.');
    if (outputWidth > 4096 || outputHeight > 4096 || outputWidth * outputHeight > 12000000) throw new Error('O PNG ficou muito grande. Diminua a altura ou escolha 150 dpi (limite: 4096 px por lado e 12 megapixels).');
    const resized = resizeArtwork(rgba, mask, width, height, bounds, outputWidth, outputHeight, margin, figureWidth, figureHeight);
    let internalSpaces = null;
    const useInternalFilter = typeof settings.removeInternal === 'boolean';
    const minimumMm = settings.removeInternal ? settings.minInternalMm ?? 2 : 0;
    if (useInternalFilter) {
      if (!Number.isFinite(minimumMm) || minimumMm < 0 || minimumMm > 20) throw new Error('Informe um limite de espaços internos entre 0 e 20 mm.');
      const candidate = new Uint8Array(resized.mask.length);
      for (let i = 0; i < candidate.length; i++) {
        const p = i * 4;
        candidate[i] = !resized.mask[i] || resized.pixels[p + 3] <= 16 || Math.min(resized.pixels[p], resized.pixels[p + 1], resized.pixels[p + 2]) >= 255 - settings.tolerance ? 1 : 0;
      }
      internalSpaces = filterInternalSpaces(resized.mask, candidate, outputWidth, outputHeight, minimumMm / 25.4 * dpi, borderPixels, settings.removeInternal, resized.pixels);
    }
    mask = smoothMask(resized.mask, outputWidth, outputHeight, smoothRadius);
    if (useInternalFilter) {
      // Check again after smoothing, which can narrow an opening near the limit.
      const candidate = Uint8Array.from(mask, value => value ? 0 : 1);
      const finalSpaces = filterInternalSpaces(mask, candidate, outputWidth, outputHeight, minimumMm / 25.4 * dpi, borderPixels, settings.removeInternal);
      internalSpaces.opened = finalSpaces.opened;
      internalSpaces.preserved += finalSpaces.preserved;
    } else if (settings.fillHoles) fillInterior(mask, outputWidth, outputHeight);
    if (!maskBounds(mask, outputWidth, outputHeight)) throw new Error('A suavização apagou uma figura muito fina. Reduza a suavização.');
    const rendered = renderArtwork(resized.pixels, mask, outputWidth, outputHeight, borderPixels, settings.gradient, gradientOptions(settings));
    return { width: outputWidth, height: outputHeight, rgba: rendered.output, silhouette: rendered.silhouette, dpi, removed: cleanup.removed, sourceBounds: bounds, figurePixels: figureHeight, margin, internalSpaces };
  }
  function workerSource() {
    return '"use strict";\n' + [floodExterior, segment, removeSpecks, fillInterior, filterInternalSpaces, maskBounds, distanceTo, boxBlur, smoothMask, resizeArtwork, gradientOptions, gradientGray, renderArtwork, processImage].map(fn => fn.toString()).join('\n') + '\nself.onmessage = function(event) { const { id, input } = event.data; try { const result = processImage(input); self.postMessage({ id, result }, [result.rgba.buffer, result.silhouette.buffer]); } catch (error) { self.postMessage({ id, error: error.message }); } };';
  }
  const api = { processImage, workerSource, segment, distanceTo, smoothMask, fillInterior, maskBounds, removeSpecks, gradientOptions, gradientGray };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TotemEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
