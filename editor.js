/* Manual editing and local presets. Artwork never leaves the browser. */
'use strict';
window.TotemEditor = (() => {
  let app, tool = 'none', draft = null, pointerId = null, frame = null;
  let history = [[]], historyIndex = 0, presets = [], builtins = [];
  const storageKey = 'totem-studio-presets-v1';
  const colors = { preserve: '#2b9860', erase: '#dd4747', bridge: '#327bca' };
  const hints = {
    none: 'Preserve detalhes, apague sobras ou arraste uma ponte entre duas partes.',
    preserve: 'Pinte sobre o detalhe original para preservá-lo. Verde marca a correção; confira a aba Resultado.',
    erase: 'Pinte para apagar. Vermelho marca a área; ela continuará apagada mesmo com a união automática.',
    bridge: 'Arraste de uma parte até outra para criar uma ponte. Confira a ligação na Silhueta de corte.'
  };
  function refresh() { if (frame === null) frame = requestAnimationFrame(() => { frame = null; app.renderPreview(); }); }
  function update() {
    if (!app) return;
    const { $, state } = app, ready = Boolean(state.source) && $('processing').hidden && !state.exporting;
    $('editorControls').disabled = !ready;
    $('undoEdit').disabled = historyIndex === 0;
    $('redoEdit').disabled = historyIndex === history.length - 1;
    $('clearEdits').disabled = !state.edits.length;
    for (const button of document.querySelectorAll('[data-tool]')) {
      button.classList.toggle('active', button.dataset.tool === tool);
      button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
      button.disabled = button.dataset.tool === 'bridge' && !state.result;
    }
    $('brushSizeField').hidden = tool === 'bridge' || tool === 'none';
    $('bridgeWidthField').hidden = tool !== 'bridge';
    $('brushSizeValue').value = $('brushSize').value + ' px';
    $('previewCanvas').classList.toggle('editing', tool !== 'none');
    $('editorHint').textContent = hints[tool] + (state.edits.length ? ` ${state.edits.length}/200 traços.` : '');
  }
  function reset() {
    draft = null; pointerId = null; tool = 'none';
    app.state.edits = []; history = [[]]; historyIndex = 0;
    update();
  }
  function deactivate() {
    if (draft) endStroke({ pointerId }, true);
    tool = 'none'; update();
  }
  function remember(edits) {
    history = history.slice(0, historyIndex + 1);
    history.push(edits.slice());
    if (history.length > 101) history.shift();
    historyIndex = history.length - 1;
    app.state.edits = edits.slice();
    app.queueProcess(); app.renderPreview();
  }
  function moveHistory(delta) {
    if (draft) return;
    const next = historyIndex + delta;
    if (next < 0 || next >= history.length) return;
    historyIndex = next; app.state.edits = history[next].slice();
    app.queueProcess(); app.renderPreview();
  }
  function sourcePoint(event) {
    const { state, $ } = app, canvas = $('previewCanvas'), rect = canvas.getBoundingClientRect();
    let x = (event.clientX - rect.left) / rect.width * canvas.width - 0.5;
    let y = (event.clientY - rect.top) / rect.height * canvas.height - 0.5;
    if (state.view !== 'original') {
      if (!state.result) return null;
      const { placement, sourceBounds: b } = state.result;
      let frame; try { frame = TotemFoil.frame(state.result); } catch { return null; }
      x -= frame.offsetX; y -= frame.offsetY;
      x = b.x + (x - placement.x + 0.5) / placement.width * b.width - 0.5;
      y = b.y + (y - placement.y + 0.5) / placement.height * b.height - 0.5;
    }
    return { x: Math.max(0, Math.min(state.source.width - 1, x)), y: Math.max(0, Math.min(state.source.height - 1, y)) };
  }
  function startStroke(event) {
    const { $, state } = app;
    if (tool === 'none' || !state.source || !$('processing').hidden || state.exporting || ['foil', 'composite'].includes(state.view) || draft || event.button !== 0) return;
    if (state.edits.length >= 200) { $('editorHint').textContent = 'Limite de 200 traços atingido. Desfaça ou limpe as edições para continuar.'; return; }
    const point = sourcePoint(event);
    if (!point) return;
    const size = tool === 'bridge' ? +$('bridgeWidth').value : +$('brushSize').value / 2;
    if (!Number.isFinite(size) || size <= 0 || (tool === 'bridge' && size < 0.5) || size > (tool === 'bridge' ? 10 : 60)) { $('editorHint').textContent = 'Ajuste o tamanho do pincel ou a largura da ponte antes de desenhar.'; return; }
    event.preventDefault();
    pointerId = event.pointerId;
    draft = { kind: tool, radius: size, widthMm: size, points: [point] };
    $('previewCanvas').setPointerCapture(pointerId); refresh();
  }
  function moveStroke(event) {
    if (!draft || event.pointerId !== pointerId) return;
    event.preventDefault();
    const point = sourcePoint(event), last = draft.points[draft.points.length - 1];
    if (!point) return;
    if (draft.kind === 'bridge') draft.points = [draft.points[0], point];
    else if (Math.hypot(point.x - last.x, point.y - last.y) >= 0.5 && draft.points.length < 4096) draft.points.push(point);
    refresh();
  }
  function endStroke(event, cancelled = false) {
    if (!draft || event.pointerId !== pointerId) return;
    if (!cancelled) moveStroke(event);
    const stroke = draft; draft = null;
    const canvas = app.$('previewCanvas');
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    pointerId = null;
    if (cancelled) app.renderPreview();
    else remember([...app.state.edits, stroke]);
  }
  function drawOverlay(canvas) {
    if (!app || !app.state.source) return;
    const { state } = app, ctx = canvas.getContext('2d');
    const strokes = state.view === 'original' ? [...state.edits, ...(draft ? [draft] : [])] : draft ? [draft] : [];
    ctx.save(); ctx.globalAlpha = 0.45; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const stroke of strokes) {
      let scale = 1;
      const project = point => {
        if (state.view === 'original') return point;
        const { placement: p, sourceBounds: b } = state.result;
        const frame = TotemFoil.frame(state.result);
        scale = Math.min(p.width / b.width, p.height / b.height);
        return { x: frame.offsetX + p.x + (point.x - b.x + 0.5) * p.width / b.width - 0.5, y: frame.offsetY + p.y + (point.y - b.y + 0.5) * p.height / b.height - 0.5 };
      };
      const points = stroke.points.map(project);
      const sourceScale = state.result ? state.result.placement.height / state.result.sourceBounds.height : 1;
      const diameter = stroke.kind === 'bridge' ? stroke.widthMm / 25.4 * (state.result?.dpi ?? 150) / sourceScale : stroke.radius * 2;
      ctx.strokeStyle = colors[stroke.kind]; ctx.fillStyle = colors[stroke.kind]; ctx.lineWidth = diameter * scale;
      if (points.length === 1) { ctx.beginPath(); ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); for (const point of points.slice(1)) ctx.lineTo(point.x, point.y); ctx.stroke(); }
    }
    ctx.restore();
  }
  function presetIds() { return [...app.controlIds, 'includeMirror']; }
  function snapshot() {
    return Object.fromEntries(presetIds().map(id => [id, id === 'includeMirror' && app.state.mirrorBeforeFoil !== null ? app.state.mirrorBeforeFoil : app.$(id).type === 'checkbox' ? app.$(id).checked : app.$(id).value]));
  }
  function validValues(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
    for (const id of presetIds()) {
      if (!Object.hasOwn(values, id)) return false;
      const element = app.$(id), value = values[id];
      if (element.type === 'checkbox') { if (typeof value !== 'boolean') return false; }
      else if (element.tagName === 'SELECT') { if (![...element.options].some(option => option.value === value)) return false; }
      else if (element.type === 'color') { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return false; }
      else { const number = Number(value); if (typeof value !== 'string' || !value.trim() || !Number.isFinite(number) || number < +element.min || number > +element.max) return false; }
    }
    return true;
  }
  function selectedPreset() {
    return [...builtins, ...presets].find(preset => preset.id === app.$('presetSelect').value);
  }
  function updatePresetActions() {
    const selected = selectedPreset();
    app.$('applyPreset').disabled = !selected;
    app.$('deletePreset').disabled = !selected || selected.builtin;
  }
  function listPresets(selected = '') {
    const select = app.$('presetSelect'); select.replaceChildren(new Option('Escolha um preset', ''));
    for (const preset of [...builtins, ...presets]) select.add(new Option(preset.name + (preset.builtin ? ' · padrão' : ''), preset.id));
    select.value = selected; updatePresetActions();
  }
  function storePresets(next) {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); presets = next; return true; }
    catch { app.$('presetNote').textContent = 'O navegador não permitiu salvar. Ative o armazenamento local para guardar seus presets.'; return false; }
  }
  function savePreset() {
    const { $ } = app, name = $('presetName').value.trim().slice(0, 48), values = snapshot();
    if (!name) { $('presetNote').textContent = 'Dê um nome ao preset antes de salvar.'; $('presetName').focus(); return; }
    if (!validValues(values)) { $('presetNote').textContent = 'Corrija os valores de tamanho e acabamento antes de salvar.'; return; }
    const existing = presets.find(preset => preset.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
    if (!existing && presets.length >= 30) { $('presetNote').textContent = 'Limite de 30 presets. Exclua um preset para salvar outro.'; return; }
    const preset = { id: existing?.id ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, values };
    const next = [...presets.filter(item => item.id !== preset.id), preset].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (!storePresets(next)) return;
    listPresets(preset.id); $('presetNote').textContent = existing ? `Preset “${name}” atualizado.` : `Preset “${name}” salvo neste navegador.`;
  }
  function applyPreset() {
    const preset = selectedPreset();
    if (!preset) return;
    for (const id of presetIds()) {
      const element = app.$(id);
      if (element.type === 'checkbox') element.checked = preset.values[id]; else element.value = preset.values[id];
    }
    app.updateExportMode(true); app.queueProcess();
    app.$('presetNote').textContent = `Preset “${preset.name}” aplicado. As edições da arte foram mantidas.`;
  }
  function init(context) {
    app = context;
    const { $, state } = app, defaults = snapshot();
    builtins = [
      { id: 'builtin-smooth', name: 'Contorno suave', builtin: true, values: { ...defaults, smoothing: '3', border: '2', gradient: 'outward', baseEnabled: false } },
      { id: 'builtin-black', name: 'Preto firme', builtin: true, values: { ...defaults, smoothing: '2', border: '2', gradient: 'solid', baseEnabled: false } },
      { id: 'builtin-base', name: 'Totem com base', builtin: true, values: { ...defaults, baseEnabled: true, baseWidth: '60', baseHeight: '8' } }
    ];
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      if (Array.isArray(stored)) presets = stored.filter(preset => preset && typeof preset.id === 'string' && preset.id.startsWith('user-') && typeof preset.name === 'string' && preset.name.trim() && preset.name.length <= 48 && validValues(preset.values)).slice(0, 30);
    } catch { $('presetNote').textContent = 'Presets indisponíveis no armazenamento. Os modelos padrão continuam disponíveis.'; }
    listPresets();
    $('presetSelect').addEventListener('change', updatePresetActions);
    $('savePreset').addEventListener('click', savePreset);
    $('applyPreset').addEventListener('click', applyPreset);
    $('deletePreset').addEventListener('click', () => {
      const preset = selectedPreset();
      if (!preset || preset.builtin || !storePresets(presets.filter(item => item.id !== preset.id))) return;
      listPresets(); $('presetNote').textContent = `Preset “${preset.name}” excluído.`;
    });
    for (const button of document.querySelectorAll('[data-tool]')) button.addEventListener('click', () => {
      TotemFoil.deactivate();
      draft = null; tool = button.dataset.tool; update();
      if (tool !== 'none' && state.source) app.setView('original'); else app.renderPreview();
    });
    $('brushSize').addEventListener('input', update);
    $('undoEdit').addEventListener('click', () => moveHistory(-1));
    $('redoEdit').addEventListener('click', () => moveHistory(1));
    $('clearEdits').addEventListener('click', () => { if (state.edits.length) remember([]); });
    const canvas = $('previewCanvas');
    canvas.addEventListener('pointerdown', startStroke);
    canvas.addEventListener('pointermove', moveStroke);
    canvas.addEventListener('pointerup', event => endStroke(event));
    canvas.addEventListener('pointercancel', event => endStroke(event, true));
    canvas.addEventListener('lostpointercapture', event => endStroke(event, true));
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && draft) { event.preventDefault(); endStroke({ pointerId }, true); return; }
      if (!(event.ctrlKey || event.metaKey) || event.target.closest('input, select, textarea, [contenteditable="true"]') || !state.source || !$('processing').hidden || state.exporting || TotemFoil.active() || $('helpDialog').open) return;
      const key = event.key.toLowerCase();
      if (key === 'z' || key === 'y') { event.preventDefault(); moveHistory(key === 'y' || event.shiftKey ? 1 : -1); }
    });
    update();
  }
  return { init, reset, update, drawOverlay, deactivate };
})();
