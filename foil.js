/* Crisp procedural foil motifs: no external fonts, images or dependencies. */
(function (root) {
  'use strict';
  function line(ctx, points, close = false) {
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
    for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
    if (close) ctx.closePath(); ctx.stroke();
  }
  function star(ctx, x, y, radius, arms = 4, angle = 0) {
    ctx.beginPath();
    for (let i = 0; i < arms * 2; i++) {
      const a = angle + i * Math.PI / arms, r = i % 2 ? radius * 0.19 : radius;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }
  function circle(ctx, x, y, r, start = 0, end = Math.PI * 2) { ctx.beginPath(); ctx.arc(x, y, r, start, end); ctx.stroke(); }
  const templates = [
    { id: 'magic', name: 'Brilho mágico', draw(ctx) {
      star(ctx, 0, 0, 0.23);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; line(ctx, [[Math.cos(a) * 0.32, Math.sin(a) * 0.32], [Math.cos(a) * 0.44, Math.sin(a) * 0.44]]); }
      star(ctx, -0.23, -0.23, 0.055); star(ctx, 0.23, 0.23, 0.055);
    } },
    { id: 'stars', name: 'Estrelas', draw(ctx) {
      star(ctx, -0.23, -0.1, 0.13); star(ctx, 0.12, -0.23, 0.075); star(ctx, 0.2, 0.19, 0.16); star(ctx, -0.18, 0.25, 0.065);
      circle(ctx, 0.04, 0.01, 0.02); circle(ctx, -0.02, 0.31, 0.014);
    } },
    { id: 'lightning', name: 'Raios de energia', draw(ctx) {
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3, points = [[0.06, 0], [0.23, -0.06], [0.19, 0.06], [0.43, 0]];
        line(ctx, points.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]));
      }
      star(ctx, 0, 0, 0.06);
    } },
    { id: 'arcane', name: 'Círculo arcano', draw(ctx) {
      circle(ctx, 0, 0, 0.38); circle(ctx, 0, 0, 0.31);
      line(ctx, Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3) * 0.24, Math.sin(i * Math.PI / 3) * 0.24]), true);
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; star(ctx, Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0.037); }
      star(ctx, 0, 0, 0.1, 6);
    } },
    { id: 'aura', name: 'Aura luminosa', draw(ctx) {
      circle(ctx, 0, 0, 0.28); circle(ctx, 0, 0, 0.2, 0.3, Math.PI * 1.6);
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; ctx.beginPath(); ctx.arc(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0.014, 0, Math.PI * 2); ctx.fill(); }
      star(ctx, 0, 0, 0.09);
    } },
    { id: 'spiral', name: 'Espiral de magia', draw(ctx) {
      const points = Array.from({ length: 161 }, (_, i) => { const a = i / 160 * Math.PI * 4, r = 0.035 + i / 160 * 0.37; return [Math.cos(a) * r, Math.sin(a) * r]; });
      line(ctx, points); star(ctx, 0.22, -0.26, 0.065); star(ctx, -0.26, -0.18, 0.035);
    } }
  ];
  function validate(effects) {
    if (!Array.isArray(effects) || effects.length > 40) throw new Error('Use no máximo 40 efeitos foil por imagem.');
    for (const effect of effects) {
      if (!templates.some(item => item.id === effect.type) || !Number.isFinite(effect.x) || !Number.isFinite(effect.y) || !Number.isFinite(effect.sizeMm) || effect.sizeMm < 4 || effect.sizeMm > 60 || !Number.isFinite(effect.rotation) || effect.rotation < -180 || effect.rotation > 180 || !Number.isFinite(effect.lineMm) || effect.lineMm < 0.1 || effect.lineMm > 1.5 || !/^#[0-9a-f]{6}$/i.test(effect.color)) throw new Error('Efeito foil inválido. Ajuste tamanho, traço ou rotação, ou remova o efeito.');
    }
  }
  function position(result, effect) {
    const p = result.placement, b = result.sourceBounds;
    return { x: p.x + (effect.x - b.x + 0.5) / b.width * p.width - 0.5, y: p.y + (effect.y - b.y + 0.5) / b.height * p.height - 0.5 };
  }
  function layout(result, effects) {
    validate(effects);
    let left = 0, top = 0, right = result.width, bottom = result.height;
    for (const effect of effects) {
      const point = position(result, effect), radius = (effect.sizeMm + effect.lineMm) / 25.4 * result.dpi / 2 + 3;
      left = Math.min(left, Math.floor(point.x - radius)); top = Math.min(top, Math.floor(point.y - radius));
      right = Math.max(right, Math.ceil(point.x + radius)); bottom = Math.max(bottom, Math.ceil(point.y + radius));
    }
    const width = right - left, height = bottom - top;
    if (width > 4096 || height > 4096 || width * height > 12000000) throw new Error('O foil ampliou demais a imagem. Diminua ou aproxime os efeitos da arte (limite: 4096 px por lado e 12 megapixels).');
    return { width, height, offsetX: -left || 0, offsetY: -top || 0 };
  }
  function draw(ctx, result, effects, frame, black = false) {
    validate(effects);
    for (const effect of effects) {
      const point = position(result, effect), size = effect.sizeMm / 25.4 * result.dpi;
      ctx.save(); ctx.translate(point.x + frame.offsetX, point.y + frame.offsetY); ctx.rotate(effect.rotation * Math.PI / 180); ctx.scale(size, size);
      ctx.strokeStyle = black ? '#000000' : effect.color; ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = effect.lineMm / effect.sizeMm; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      templates.find(item => item.id === effect.type).draw(ctx); ctx.restore();
    }
  }
  const api = { templates, validate, position, layout, draw };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FoilEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
