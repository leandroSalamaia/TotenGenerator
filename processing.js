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
  function resolveBackgroundMode(rgba, width, height, requested = 'auto') {
    if (!['auto', 'white', 'alpha'].includes(requested)) throw new Error('Escolha uma origem válida para o recorte.');
    if (requested !== 'auto') return requested;
    // Only exterior transparency identifies a cutout. An isolated transparent
    // hole in an otherwise opaque white background must not change the mode.
    const transparent = new Uint8Array(width * height);
    for (let i = 0; i < transparent.length; i++) transparent[i] = rgba[i * 4 + 3] <= 16 ? 1 : 0;
    const exterior = floodExterior(transparent, width, height);
    let count = 0;
    for (const value of exterior) count += value;
    return count >= Math.max(4, Math.ceil(transparent.length * 0.001)) ? 'alpha' : 'white';
  }
  function segment(rgba, width, height, tolerance, backgroundMode = 'auto') {
    const n = width * height, candidate = new Uint8Array(n);
    const mode = resolveBackgroundMode(rgba, width, height, backgroundMode);
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      candidate[i] = rgba[p + 3] <= 16 || (mode === 'white' && Math.min(rgba[p], rgba[p + 1], rgba[p + 2]) >= 255 - tolerance) ? 1 : 0;
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
  function resizeArtwork(rgba, mask, width, height, bounds, outputWidth, outputHeight, margin, figureWidth, figureHeight, offsetX = margin) {
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
      const i = (y + margin) * outputWidth + x + offsetX, p = i * 4;
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
  function closeOutline(mask, width, height, radius) {
    if (radius <= 0) return mask.slice();
    // Padding prevents dilation from being clipped by the export canvas before
    // erosion. The union can then safely preserve artwork near an image edge.
    const padding = Math.ceil(radius) + 2, pw = width + padding * 2, ph = height + padding * 2;
    const padded = new Uint8Array(pw * ph);
    for (let y = 0; y < height; y++) padded.set(mask.subarray(y * width, (y + 1) * width), (y + padding) * pw + padding);
    const outside = distanceTo(padded, pw, ph, 1);
    const dilated = Uint8Array.from(outside, value => value <= radius ? 1 : 0);
    const inside = distanceTo(dilated, pw, ph, 0), closed = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      closed[i] = mask[i] || inside[(y + padding) * pw + x + padding] > radius ? 1 : 0;
    }
    return closed;
  }
  function uniteRenderedBorders(rendered, width, height, settings) {
    const joinMm = settings.joinBordersMm ?? 0;
    if (!Number.isFinite(joinMm) || joinMm < 0 || joinMm > 6) throw new Error('Informe uma união de bordas entre 0 e 6 mm.');
    if (!joinMm && !settings.removeInternal) return { addedPixels: 0, spaces: null };
    const original = new Uint8Array(width * height);
    for (let i = 0; i < original.length; i++) original[i] = rendered.output[i * 4 + 3] >= 128 ? 1 : 0;
    const closed = closeOutline(original, width, height, joinMm / 25.4 * settings.dpi / 2);
    let spaces = null;
    if (settings.removeInternal) {
      // Offsetting can seal an exterior opening and leave a new tiny internal
      // hole. Apply the size rule to the finished contour as well as the art.
      const candidate = Uint8Array.from(closed, value => value ? 0 : 1);
      spaces = filterInternalSpaces(closed, candidate, width, height, (settings.minInternalMm ?? 2) / 25.4 * settings.dpi, 0, true);
    }
    const added = new Uint8Array(original.length);
    let addedPixels = 0;
    for (let i = 0; i < added.length; i++) if (closed[i] && !original[i]) { added[i] = 1; addedPixels++; }
    if (!addedPixels) return { addedPixels, spaces };
    // Blend the existing contour into the new bridges. Only transparent or
    // partially transparent pixels are touched; opaque artwork stays intact.
    const gray = gradientGray(1, settings.gradient, gradientOptions(settings));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, p = i * 4, oldAlpha = rendered.output[p + 3];
      if (oldAlpha === 255) continue;
      let covered = 0, hasAddition = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        covered += closed[next]; hasAddition ||= Boolean(added[next]);
      }
      if (!hasAddition) continue;
      const coverage = Math.max(closed[i] ? 0.5 : 0, Math.min(1, Math.max(0, (covered / 9 - 0.25) * 2)));
      const alpha = Math.max(oldAlpha, Math.round(coverage * 255));
      if (alpha === oldAlpha) continue;
      for (let c = 0; c < 3; c++) rendered.output[p + c] = (rendered.output[p + c] * oldAlpha + gray * (alpha - oldAlpha)) / alpha;
      rendered.output[p + 3] = alpha;
      rendered.silhouette[p] = 36; rendered.silhouette[p + 1] = 62; rendered.silhouette[p + 2] = 52; rendered.silhouette[p + 3] = alpha;
    }
    return { addedPixels, spaces };
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
  // Rasterize continuous circular strokes rather than isolated mouse samples.
  // The last stroke wins where tools overlap; coordinates remain in source pixels.
  function rasterEdits(edits, width, height, transform = null, dpi = 150) {
    const values = new Int8Array(width * height), coverage = new Float32Array(width * height);
    for (const stroke of edits) {
      const value = stroke.kind === 'preserve' ? 1 : stroke.kind === 'erase' ? -1 : 2;
      if (!transform && value === 2) continue;
      const points = stroke.points.map(point => transform ? { x: transform.x + (point.x - transform.bounds.x + 0.5) * transform.scaleX - 0.5, y: transform.y + (point.y - transform.bounds.y + 0.5) * transform.scaleY - 0.5 } : point);
      const radius = value === 2 ? stroke.widthMm / 25.4 * dpi / 2 : stroke.radius * (transform ? Math.min(transform.scaleX, transform.scaleY) : 1);
      for (let k = 0; k < points.length; k++) {
        const a = points[Math.max(0, k - 1)], b = points[k], dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
        const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius - 1)), x1 = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + radius + 1));
        const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius - 1)), y1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + radius + 1));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const t = squared ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / squared)) : 0;
          const alpha = Math.max(0, Math.min(1, radius + 0.5 - Math.hypot(x - a.x - t * dx, y - a.y - t * dy)));
          if (!alpha) continue;
          const i = y * width + x;
          coverage[i] = values[i] === value ? Math.max(coverage[i], alpha) : alpha;
          values[i] = value;
        }
      }
    }
    return { values, coverage };
  }
  function validateEdits(edits, width, height) {
    if (!Array.isArray(edits) || edits.length > 200) throw new Error('Use no máximo 200 traços por imagem.');
    for (const stroke of edits) {
      if (!['preserve', 'erase', 'bridge'].includes(stroke.kind) || !Array.isArray(stroke.points) || !stroke.points.length || stroke.points.length > 4096) throw new Error('Traço inválido. Desfaça a última edição.');
      const size = stroke.kind === 'bridge' ? stroke.widthMm : stroke.radius;
      if (!Number.isFinite(size) || size <= 0 || (stroke.kind === 'bridge' && size < 0.5) || size > (stroke.kind === 'bridge' ? 10 : 120)) throw new Error('Tamanho de pincel ou ponte inválido.');
      for (const point of stroke.points) if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) throw new Error('O traço precisa ficar dentro da imagem original.');
    }
  }
  function addBase(mask, pixels, width, height, margin, options, dpi) {
    if (!options) return null;
    const bw = Math.round(options.widthMm / 25.4 * dpi), bh = Math.round(options.heightMm / 25.4 * dpi);
    const left = Math.floor((width - bw) / 2), top = height - margin - bh, radius = options.shape === 'rounded' ? Math.min(bw, bh) / 2 : 0;
    const color = options.color.match(/\w\w/g).map(value => parseInt(value, 16));
    // Find the bottommost artwork point nearest the center and connect it to
    // the base, including figures with uneven feet or a narrow pedestal.
    let anchor = -1, nearest = Infinity;
    for (let y = top + 1; y >= 0 && anchor < 0; y--) for (let x = 0; x < width; x++) if (mask[y * width + x]) {
      const distance = Math.abs(x - width / 2);
      if (distance < nearest) { nearest = distance; anchor = y * width + x; }
    }
    function paint(i) {
      mask[i] = 1;
      const p = i * 4;
      if (!pixels[p + 3]) { pixels.set(color, p); pixels[p + 3] = 255; }
    }
    for (let y = top; y < top + bh; y++) for (let x = left; x < left + bw; x++) {
      const cx = Math.max(left + radius - 0.5, Math.min(left + bw - radius - 0.5, x));
      const cy = Math.max(top + radius - 0.5, Math.min(top + bh - radius - 0.5, y));
      if (!radius || Math.hypot(x - cx, y - cy) <= radius) paint(y * width + x);
    }
    if (anchor >= 0) {
      const ax = anchor % width, ay = Math.floor(anchor / width), bx = Math.max(left + radius, Math.min(left + bw - radius - 1, ax)), by = top + bh / 2;
      const stroke = { kind: 'bridge', widthMm: 2, points: [{ x: ax, y: ay }, { x: bx, y: by }] };
      const bridge = rasterEdits([stroke], width, height, { x: 0, y: 0, bounds: { x: 0, y: 0 }, scaleX: 1, scaleY: 1 }, dpi);
      for (let i = 0; i < mask.length; i++) if (bridge.coverage[i] >= 0.5) paint(i);
    }
    return { x: left, y: top, width: bw, height: bh };
  }
  function processImage(input) {
    const { rgba, width, height, settings } = input;
    if (!width || !height || rgba.length !== width * height * 4) throw new Error('Imagem inválida. Escolha outro arquivo.');
    const backgroundMode = resolveBackgroundMode(rgba, width, height, settings.backgroundMode);
    let mask = segment(rgba, width, height, settings.tolerance, backgroundMode);
    const cleanup = settings.cleanNoise ? removeSpecks(mask, width, height) : { removed: 0, kept: null };
    const edits = input.edits ?? [];
    validateEdits(edits, width, height);
    const sourceEdits = edits.length ? rasterEdits(edits, width, height) : null;
    if (sourceEdits) for (let i = 0; i < mask.length; i++) if (sourceEdits.values[i] === 1 && sourceEdits.coverage[i] >= 0.5 && rgba[i * 4 + 3] > 16) mask[i] = 1;
    let bounds = maskBounds(mask, width, height);
    if (!bounds) throw new Error('Nenhuma figura encontrada. Diminua a remoção do branco ou desative a limpeza de pontos.');
    for (const stroke of edits) if (stroke.kind === 'bridge') for (const point of stroke.points) {
      const x = Math.floor(point.x), y = Math.floor(point.y), right = Math.max(bounds.x + bounds.width, x + 1), bottom = Math.max(bounds.y + bounds.height, y + 1);
      bounds.x = Math.min(bounds.x, x); bounds.y = Math.min(bounds.y, y); bounds.width = right - bounds.x; bounds.height = bottom - bounds.y;
    }
    const dpi = settings.dpi, outputHeight = Math.round(settings.heightCm / 2.54 * dpi), borderPixels = settings.borderMm / 25.4 * dpi;
    let baseOptions = null;
    if (settings.baseEnabled) {
      baseOptions = { widthMm: settings.baseWidthMm ?? 60, heightMm: settings.baseHeightMm ?? 8, shape: settings.baseShape ?? 'rounded', color: settings.baseColor ?? '#000000' };
      if (!Number.isFinite(baseOptions.widthMm) || baseOptions.widthMm < 10 || baseOptions.widthMm > 250 || !Number.isFinite(baseOptions.heightMm) || baseOptions.heightMm < 2 || baseOptions.heightMm > 40 || !['rounded', 'rectangle'].includes(baseOptions.shape) || !/^#[0-9a-f]{6}$/i.test(baseOptions.color)) throw new Error('A base precisa de largura entre 10 e 250 mm, altura entre 2 e 40 mm e uma cor válida.');
    }
    const bridgeRadius = edits.reduce((maximum, stroke) => stroke.kind === 'bridge' ? Math.max(maximum, stroke.widthMm / 25.4 * dpi / 2) : maximum, 0);
    const smoothRadius = settings.smoothing * dpi / 300, margin = Math.ceil(borderPixels + Math.max(smoothRadius * 2, bridgeRadius, baseOptions ? dpi / 25.4 : 0) + 3);
    const baseHeight = baseOptions ? Math.round(baseOptions.heightMm / 25.4 * dpi) : 0;
    const figureHeight = outputHeight - 2 * margin - Math.max(0, baseHeight - 1), figureWidth = Math.round(bounds.width / bounds.height * figureHeight);
    const outputWidth = Math.max(figureWidth, baseOptions ? Math.round(baseOptions.widthMm / 25.4 * dpi) : 0) + 2 * margin, offsetX = Math.floor((outputWidth - figureWidth) / 2);
    if (figureHeight < 10 || figureWidth < 1) throw new Error('O contorno ou a base estão grandes para esta altura. Aumente a altura ou diminua o contorno e a base.');
    if (outputWidth > 4096 || outputHeight > 4096 || outputWidth * outputHeight > 12000000) throw new Error('O PNG ficou muito grande. Diminua a altura ou escolha 150 dpi (limite: 4096 px por lado e 12 megapixels).');
    const resized = resizeArtwork(rgba, mask, width, height, bounds, outputWidth, outputHeight, margin, figureWidth, figureHeight, offsetX);
    const placement = { x: offsetX, y: margin, width: figureWidth, height: figureHeight };
    const manual = edits.length ? rasterEdits(edits, outputWidth, outputHeight, { x: offsetX, y: margin, bounds, scaleX: figureWidth / bounds.width, scaleY: figureHeight / bounds.height }, dpi) : null;
    const protectedPixels = manual ? resized.pixels.slice() : null;
    let internalSpaces = null;
    const useInternalFilter = typeof settings.removeInternal === 'boolean';
    const minimumMm = settings.removeInternal ? settings.minInternalMm ?? 2 : 0;
    if (useInternalFilter) {
      if (!Number.isFinite(minimumMm) || minimumMm < 0 || minimumMm > 20) throw new Error('Informe um limite de espaços internos entre 0 e 20 mm.');
      const candidate = new Uint8Array(resized.mask.length);
      for (let i = 0; i < candidate.length; i++) {
        const p = i * 4;
        const protectedArt = manual && manual.values[i] === 1 && manual.coverage[i] >= 0.5 && protectedPixels[p + 3] > 16;
        candidate[i] = !protectedArt && (!resized.mask[i] || resized.pixels[p + 3] <= 16 || (backgroundMode === 'white' && Math.min(resized.pixels[p], resized.pixels[p + 1], resized.pixels[p + 2]) >= 255 - settings.tolerance)) ? 1 : 0;
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
    if (manual) for (let i = 0; i < mask.length; i++) {
      if (manual.coverage[i] < 0.5) continue;
      const value = manual.values[i], p = i * 4;
      if (value === 1 && protectedPixels[p + 3] <= 16) continue;
      mask[i] = value === -1 ? 0 : 1;
      if (value === 1) resized.pixels.set(protectedPixels.subarray(p, p + 4), p);
      if (value === 2 && !resized.mask[i]) { resized.pixels[p] = 0; resized.pixels[p + 1] = 0; resized.pixels[p + 2] = 0; resized.pixels[p + 3] = 255; }
    }
    const base = addBase(mask, resized.pixels, outputWidth, outputHeight, margin, baseOptions, dpi);
    if (!maskBounds(mask, outputWidth, outputHeight)) throw new Error('A suavização apagou uma figura muito fina. Reduza a suavização.');
    const rendered = renderArtwork(resized.pixels, mask, outputWidth, outputHeight, borderPixels, settings.gradient, gradientOptions(settings));
    const union = uniteRenderedBorders(rendered, outputWidth, outputHeight, settings);
    // An explicit eraser must win over automatic closing and outline growth.
    if (manual) for (let i = 0; i < mask.length; i++) if (manual.values[i] === -1) {
      const p = i * 4, alpha = Math.round(rendered.output[p + 3] * (1 - manual.coverage[i]));
      rendered.output[p + 3] = alpha; rendered.silhouette[p + 3] = alpha;
      if (!alpha) { rendered.output[p] = 0; rendered.output[p + 1] = 0; rendered.output[p + 2] = 0; }
    }
    if (internalSpaces && union.spaces) {
      internalSpaces.opened = union.spaces.opened;
      internalSpaces.preserved += union.spaces.preserved;
    }
    return { width: outputWidth, height: outputHeight, rgba: rendered.output, silhouette: rendered.silhouette, dpi, removed: cleanup.removed, sourceBounds: bounds, figurePixels: figureHeight, margin, internalSpaces, joinedPixels: union.addedPixels, backgroundMode, placement, base };
  }
  function workerSource() {
    return '"use strict";\n' + [floodExterior, resolveBackgroundMode, segment, removeSpecks, fillInterior, filterInternalSpaces, maskBounds, distanceTo, boxBlur, smoothMask, resizeArtwork, gradientOptions, closeOutline, uniteRenderedBorders, gradientGray, renderArtwork, rasterEdits, validateEdits, addBase, processImage].map(fn => fn.toString()).join('\n') + '\nself.onmessage = function(event) { const { id, input } = event.data; try { const result = processImage(input); self.postMessage({ id, result }, [result.rgba.buffer, result.silhouette.buffer]); } catch (error) { self.postMessage({ id, error: error.message }); } };';
  }
  const api = { processImage, workerSource, segment, resolveBackgroundMode, distanceTo, smoothMask, fillInterior, maskBounds, removeSpecks, gradientOptions, gradientGray };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TotemEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
