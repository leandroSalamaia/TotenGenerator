'use strict';
window.TotemFoil = (() => {
  let app, selected = '', pending = '', drag = null, nextId = 1;
  let history = [[]], historyIndex = 0, cached = null, lastResult = null, lastRevision = -1;
  const particleIds = ['foilCount', 'foilSpread', 'foilParticleSize', 'foilGlow'];
  const styleIds = ['foilSize', 'foilRotation', 'foilLine', 'foilColor', ...particleIds];
  function active() { return Boolean(pending || drag || (selected && ['foil', 'composite'].includes(app?.state.view))); }
  function ready() { return Boolean(app?.state.result) && app.$('processing').hidden && !app.state.exporting; }
  function frame(result) {
    if (drag) return drag.frame;
    if (!cached || result !== lastResult || lastRevision !== app.state.foilRevision) {
      cached = FoilEngine.layout(result, app.state.foilEffects); lastResult = result; lastRevision = app.state.foilRevision;
    }
    return cached;
  }
  function cloneEffects() { return app.state.foilEffects.map(effect => ({ ...effect })); }
  function current() { return app.state.foilEffects.find(effect => effect.id === selected); }
  function commit() {
    const effects = cloneEffects();
    if (JSON.stringify(effects) === JSON.stringify(history[historyIndex])) return;
    history = history.slice(0, historyIndex + 1); history.push(effects);
    if (history.length > 101) history.shift(); historyIndex = history.length - 1;
  }
  function changed(note = '', record = false) {
    app.state.foilRevision++; cached = null;
    if (record) commit();
    if (note) app.$('foilNote').textContent = note;
    if (ready()) { app.$('exportButton').disabled = false; app.message(''); }
    app.updateExportMode(); app.renderPreview();
  }
  function syncStyle() {
    const effect = current(); if (!effect) return;
    const p = FoilEngine.particleOptions(effect);
    for (const [id, value] of Object.entries({ foilSize: effect.sizeMm, foilRotation: effect.rotation, foilLine: effect.lineMm, foilColor: effect.color, foilCount: p.count, foilSpread: p.spread, foilParticleSize: p.particleMm, foilGlow: p.glow })) app.$(id).value = value;
  }
  function update() {
    if (!app) return;
    const { $, state } = app, enabled = ready(), effect = current();
    for (const id of [...styleIds, 'foilExportColor']) $(id).disabled = !enabled || Boolean(drag);
    for (const button of document.querySelectorAll('[data-foil-template]')) {
      button.disabled = !enabled || state.foilEffects.length >= 40;
      button.classList.toggle('active', button.dataset.foilTemplate === pending);
      button.setAttribute('aria-pressed', String(button.dataset.foilTemplate === pending));
    }
    for (const button of document.querySelectorAll('[data-foil-color]')) button.disabled = !enabled || Boolean(drag);
    const select = $('foilSelect'); select.replaceChildren(new Option('Nenhum efeito', ''));
    state.foilEffects.forEach((item, index) => select.add(new Option(`${index + 1}. ${FoilEngine.templates.find(template => template.id === item.type).name}`, item.id)));
    select.value = effect ? selected : ''; select.disabled = !enabled || !state.foilEffects.length || Boolean(drag);
    $('duplicateFoil').disabled = !enabled || !effect || state.foilEffects.length >= 40;
    $('removeFoil').disabled = !enabled || !effect; $('clearFoil').disabled = !enabled || !state.foilEffects.length;
    $('undoFoil').disabled = !enabled || historyIndex === 0; $('redoFoil').disabled = !enabled || historyIndex === history.length - 1;
    const particle = FoilEngine.templates.find(template => template.id === (pending || effect?.type))?.particle;
    $('foilParticleSettings').hidden = !particle;
    $('varyFoil').disabled = !enabled || !effect || !FoilEngine.templates.find(template => template.id === effect.type)?.particle || Boolean(drag);
    $('foilCountValue').value = $('foilCount').value;
    $('foilSpreadValue').value = $('foilSpread').value + '%';
    $('foilParticleSizeValue').value = (+$('foilParticleSize').value).toLocaleString('pt-BR') + ' mm';
    $('foilGlowValue').value = $('foilGlow').value + '%';
    $('foilSizeValue').value = (+$('foilSize').value).toLocaleString('pt-BR') + ' mm';
    $('foilRotationValue').value = $('foilRotation').value + '°';
    $('foilLineValue').value = (+$('foilLine').value).toLocaleString('pt-BR') + ' mm';
    $('previewCanvas').classList.toggle('foil-placing', Boolean(pending));
    $('previewCanvas').classList.toggle('foil-moving', !pending && ['foil', 'composite'].includes(state.view) && state.foilEffects.length > 0);
    $('foilTab').disabled = !state.result; $('compositeTab').disabled = !state.result;
  }
  function deactivate() {
    pending = '';
    if (drag) {
      const gesture = drag; drag = null; app.state.foilEffects = gesture.before;
      if (app.$('previewCanvas').hasPointerCapture(gesture.pointerId)) app.$('previewCanvas').releasePointerCapture(gesture.pointerId);
      app.state.foilRevision++; cached = null;
    }
    update();
  }
  function reset() {
    deactivate(); selected = ''; nextId = 1; app.state.foilEffects = [];
    history = [[]]; historyIndex = 0; app.state.foilRevision++; cached = null;
    app.$('foilNote').textContent = 'Com foil, o ZIP contém 4 PNGs alinhados: arte, espelho, foil isolado e arte com foil.';
    app.updateExportMode(); update();
  }
  function defaults() {
    const { $ } = app;
    return { sizeMm: +$('foilSize').value, rotation: +$('foilRotation').value, lineMm: +$('foilLine').value, color: $('foilColor').value, count: +$('foilCount').value, spread: +$('foilSpread').value, particleMm: +$('foilParticleSize').value, glow: +$('foilGlow').value };
  }
  function point(event, frozen = null) {
    const canvas = app.$('previewCanvas'), rect = frozen?.rect ?? canvas.getBoundingClientRect(), f = frozen?.frame ?? frame(app.state.result);
    const x = (event.clientX - rect.left) / rect.width * f.width - 0.5, y = (event.clientY - rect.top) / rect.height * f.height - 0.5;
    const r = app.state.result, p = r.placement, b = r.sourceBounds;
    return { canvasX: x, canvasY: y, x: b.x + (x - f.offsetX - p.x + 0.5) / p.width * b.width - 0.5, y: b.y + (y - f.offsetY - p.y + 0.5) / p.height * b.height - 0.5 };
  }
  function begin(event) {
    if (!ready() || event.button !== 0 || !['composite', 'foil'].includes(app.state.view)) return;
    let location, f;
    try { f = frame(app.state.result); location = point(event); } catch { return; }
    if (pending) {
      event.preventDefault();
      if (app.state.foilEffects.length >= 40) return;
      const effect = { id: `foil-${nextId++}`, type: pending, x: location.x, y: location.y, seed: Math.floor(Math.random() * 4294967296), ...defaults() };
      FoilEngine.validate([effect]); selected = effect.id; pending = '';
      app.state.foilEffects = [...app.state.foilEffects, effect];
      changed('Efeito adicionado. Arraste para mover ou ajuste tamanho e rotação. O download inclui os 4 PNGs.', true); return;
    }
    const result = app.state.result;
    const hit = [...app.state.foilEffects].reverse().find(effect => {
      const center = FoilEngine.position(result, effect);
      return Math.hypot(location.canvasX - center.x - f.offsetX, location.canvasY - center.y - f.offsetY) <= effect.sizeMm / 25.4 * result.dpi / 2 + 4;
    });
    if (!hit) { selected = ''; update(); drawSelection(app.$('previewCanvas')); return; }
    event.preventDefault(); selected = hit.id; syncStyle();
    drag = { pointerId: event.pointerId, start: location, x: hit.x, y: hit.y, frame: f, rect: app.$('previewCanvas').getBoundingClientRect(), before: cloneEffects() };
    app.$('previewCanvas').setPointerCapture(event.pointerId); app.renderPreview();
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault(); const location = point(event, drag);
    app.state.foilEffects = app.state.foilEffects.map(effect => effect.id === selected ? { ...effect, x: drag.x + location.x - drag.start.x, y: drag.y + location.y - drag.start.y } : effect);
    changed();
  }
  function end(event, cancel = false) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!cancel) move(event);
    const gesture = drag; drag = null;
    if (cancel) app.state.foilEffects = gesture.before;
    if (app.$('previewCanvas').hasPointerCapture(gesture.pointerId)) app.$('previewCanvas').releasePointerCapture(gesture.pointerId);
    changed(cancel ? 'Movimento cancelado.' : 'Posição do foil ajustada.', !cancel);
  }
  function draw(ctx, f, isolated = false) {
    FoilEngine.draw(ctx, app.state.result, app.state.foilEffects, f, isolated && app.$('foilExportColor').value === 'black');
  }
  function drawSelection(canvas) {
    const overlay = app.$('foilOverlayCanvas'), effect = current();
    overlay.hidden = !effect || !['foil', 'composite'].includes(app.state.view) || canvas.hidden;
    if (overlay.hidden) return;
    let f; try { f = frame(app.state.result); } catch { overlay.hidden = true; return; }
    overlay.width = canvas.width; overlay.height = canvas.height;
    const rect = canvas.getBoundingClientRect(), stage = app.$('canvasStage').getBoundingClientRect();
    Object.assign(overlay.style, { left: `${rect.left - stage.left}px`, top: `${rect.top - stage.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const ctx = overlay.getContext('2d'), center = FoilEngine.position(app.state.result, effect), radius = effect.sizeMm / 25.4 * app.state.result.dpi / 2;
    const x = center.x + f.offsetX, y = center.y + f.offsetY, unit = canvas.width / Math.max(1, rect.width);
    ctx.strokeStyle = '#1774b8'; ctx.lineWidth = 1.4 * unit; ctx.setLineDash([4 * unit, 3 * unit]);
    ctx.beginPath(); ctx.arc(x, y, radius + 2 * unit, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x - 5 * unit, y); ctx.lineTo(x + 5 * unit, y); ctx.moveTo(x, y - 5 * unit); ctx.lineTo(x, y + 5 * unit); ctx.stroke();
  }
  function layers(result) {
    const f = frame(result), make = () => { const canvas = document.createElement('canvas'); canvas.width = f.width; canvas.height = f.height; return canvas; };
    const normal = make(); normal.getContext('2d').putImageData(new ImageData(result.rgba, result.width, result.height), f.offsetX, f.offsetY);
    const mirror = make(), mirrorContext = mirror.getContext('2d'); mirrorContext.translate(f.width, 0); mirrorContext.scale(-1, 1); mirrorContext.drawImage(normal, 0, 0);
    const foil = make(); draw(foil.getContext('2d'), f, true);
    const composite = make(), ctx = composite.getContext('2d');
    // Use the same raw artwork backing as the preview before compositing.
    ctx.putImageData(new ImageData(result.rgba, result.width, result.height), f.offsetX, f.offsetY); draw(ctx, f);
    return { normal, mirror, foil, composite };
  }
  function styleChanged(record = false) {
    const effect = current();
    if (effect) {
      app.state.foilEffects = app.state.foilEffects.map(item => item.id === selected ? { ...item, ...defaults() } : item);
      changed('', record);
    } else update();
  }
  function undo(delta) {
    if (!ready() || drag) return;
    const next = historyIndex + delta; if (next < 0 || next >= history.length) return;
    historyIndex = next; app.state.foilEffects = history[next].map(effect => ({ ...effect }));
    if (!current()) selected = app.state.foilEffects.at(-1)?.id ?? '';
    pending = ''; syncStyle(); changed('Histórico do foil atualizado.');
  }
  function init(context) {
    app = context; const { $, state } = app;
    const groups = {};
    for (const [key, title] of [['particles', 'Partículas de jogos'], ['symbols', 'Símbolos e traços']]) {
      const heading = document.createElement('h3'); heading.className = 'foil-group-title'; heading.textContent = title;
      const grid = document.createElement('div'); grid.className = 'foil-palette'; $('foilPalette').append(heading, grid); groups[key] = grid;
    }
    for (const template of FoilEngine.templates) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.foilTemplate = template.id; button.setAttribute('aria-pressed', 'false');
      const thumbnail = document.createElement('canvas'); thumbnail.width = 60; thumbnail.height = 60; thumbnail.setAttribute('aria-hidden', 'true');
      const ctx = thumbnail.getContext('2d'); ctx.translate(30, 30); ctx.scale(55, 55); ctx.strokeStyle = '#a77b25'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 0.027; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; template.draw(ctx);
      button.classList.toggle('particle-template', Boolean(template.particle));
      const name = document.createElement('span'); name.textContent = template.name; button.append(thumbnail, name); groups[template.particle ? 'particles' : 'symbols'].append(button);
      button.addEventListener('click', () => {
        if (!ready()) return;
        TotemEditor.deactivate(); deactivate(); selected = ''; pending = template.id;
        if (template.particle) { $('foilColor').value = template.color; if (+$('foilSize').value < 24) $('foilSize').value = 24; }
        $('foilNote').textContent = `${template.name}: clique no local desejado na arte. Esc cancela a colocação.`;
        app.setView('composite'); $('previewCanvas').scrollIntoView({ block: 'center' });
      });
    }
    for (const id of styleIds) { $(id).addEventListener('input', () => styleChanged()); $(id).addEventListener('change', () => styleChanged(true)); }
    for (const button of document.querySelectorAll('[data-foil-color]')) button.addEventListener('click', () => { $('foilColor').value = button.dataset.foilColor; styleChanged(true); });
    $('foilExportColor').addEventListener('change', () => changed());
    $('varyFoil').addEventListener('click', () => {
      const effect = current(); if (!effect || !ready() || drag) return;
      app.state.foilEffects = app.state.foilEffects.map(item => item.id === selected ? { ...item, seed: (item.seed ?? FoilEngine.particleOptions(item).seed) + 2654435761 >>> 0 } : item);
      changed('Nova distribuição de partículas. A posição e os ajustes foram mantidos.', true);
    });
    $('foilSelect').addEventListener('change', () => { const id = $('foilSelect').value; TotemEditor.deactivate(); deactivate(); selected = id; syncStyle(); app.setView('composite'); });
    $('removeFoil').addEventListener('click', () => { state.foilEffects = state.foilEffects.filter(effect => effect.id !== selected); selected = ''; changed('Efeito removido.', true); });
    $('clearFoil').addEventListener('click', () => { deactivate(); state.foilEffects = []; selected = ''; changed('Foil removido da arte. Você pode desfazer esta ação.', true); });
    $('duplicateFoil').addEventListener('click', () => {
      const effect = current(); if (!effect || state.foilEffects.length >= 40) return;
      const r = state.result, copy = { ...effect, id: `foil-${nextId++}`, x: effect.x + 2 / 25.4 * r.dpi / (r.placement.width / r.sourceBounds.width) };
      selected = copy.id; state.foilEffects = [...state.foilEffects, copy]; changed('Efeito duplicado. Arraste para posicionar.', true);
    });
    $('undoFoil').addEventListener('click', () => undo(-1)); $('redoFoil').addEventListener('click', () => undo(1));
    const canvas = $('previewCanvas');
    canvas.addEventListener('pointerdown', begin); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', event => end(event));
    canvas.addEventListener('pointercancel', event => end(event, true)); canvas.addEventListener('lostpointercapture', event => end(event, true));
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || (!pending && !drag)) return;
      event.preventDefault(); if (drag) end({ pointerId: drag.pointerId }, true); else { pending = ''; app.renderPreview(); }
    });
    new ResizeObserver(() => drawSelection(canvas)).observe(canvas); update();
  }
  return { init, reset, update, deactivate, active, frame, draw, drawSelection, layers };
})();
