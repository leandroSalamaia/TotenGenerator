/* Deterministic particle effects and foil motifs, with no external assets. */
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
  const particleDefaults = { count: 80, spread: 85, particleMm: 0.5, glow: 70, seed: 12345 };
  function particleOptions(effect = {}) { return { ...particleDefaults, ...Object.fromEntries(Object.keys(particleDefaults).filter(key => effect[key] !== undefined).map(key => [key, effect[key]])) }; }
  function randomGenerator(seed) {
    let value = seed >>> 0;
    return () => { value = (value + 0x6d2b79f5) >>> 0; let n = value; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
  }
  function particles(effect) {
    const options = particleOptions(effect), random = randomGenerator(options.seed), result = [], spread = options.spread / 100;
    for (let i = 0; i < options.count; i++) {
      const radius = Math.min(0.032, options.particleMm / (effect.sizeMm || 18) / 2 * (0.4 + random() * 1.1));
      const halo = radius * (1 + options.glow / 100 * 3.5), reach = Math.max(0.05, 0.43 * spread - halo);
      let angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * reach, x, y, tail = 0;
      const variant = random();
      if (effect.type === 'particle-sparks') { angle = -Math.PI / 2 + (random() - 0.5) * 2; distance = (0.12 + random() * 0.88) * reach; tail = 0.018 + random() * 0.07; }
      if (effect.type === 'particle-fire') {
        const height = random(); x = (random() - 0.5) * 0.38 * (1 - height) * spread; y = (0.07 - height * 0.44) * spread; angle = -Math.PI / 2; tail = 0.008 + random() * 0.035;
      } else {
        if (effect.type === 'particle-vortex') { distance = (0.08 + random() * 0.92) * reach; angle = distance / reach * Math.PI * 5 + (random() - 0.5) * 0.7; tail = 0.015 + random() * 0.025; }
        x = Math.cos(angle) * distance; y = Math.sin(angle) * distance;
      }
      if (effect.type === 'particle-lightning' && variant < 0.4) tail = 0.018 + random() * 0.045;
      if (effect.type === 'particle-vortex') angle += Math.PI / 2;
      const limit = 0.44 - halo, length = Math.hypot(x, y);
      if (length > limit) { x *= limit / length; y *= limit / length; }
      let tx = x - Math.cos(angle) * tail, ty = y - Math.sin(angle) * tail;
      const tailLength = Math.hypot(tx, ty); if (tailLength > limit) { tx *= limit / tailLength; ty *= limit / tailLength; }
      result.push({ x, y, radius, halo, tx, ty, variant, angle, opacity: 0.5 + random() * 0.5 });
    }
    return result;
  }
  function drawParticles(ctx, effect, black) {
    const options = particleOptions(effect), color = effect.color || '#b277ff';
    const rgb = color.match(/\w\w/g).map(value => parseInt(value, 16));
    const rgba = (alpha, brighten = 0) => black ? `rgba(0,0,0,${alpha})` : `rgba(${rgb.map(value => Math.round(value + (255 - value) * brighten)).join(',')},${alpha})`;
    const particleList = particles(effect);
    // Soft halos, followed by crisp cores and short streaks, suggest one frame of a game emitter.
    if (options.glow) for (const p of particleList) {
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.halo);
      gradient.addColorStop(0, rgba(0.55 * p.opacity * options.glow / 100)); gradient.addColorStop(0.35, rgba(0.22 * p.opacity * options.glow / 100)); gradient.addColorStop(1, rgba(0));
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(p.x, p.y, p.halo, 0, Math.PI * 2); ctx.fill();
    }
    for (const p of particleList) {
      ctx.fillStyle = rgba(p.opacity, 0.25); ctx.strokeStyle = rgba(p.opacity, 0.35);
      if (p.x !== p.tx || p.y !== p.ty) {
        ctx.lineWidth = Math.max(0.0015, Math.min(p.radius, (effect.lineMm || 0.3) / (effect.sizeMm || 18)));
        if (effect.type === 'particle-lightning') line(ctx, [[p.tx, p.ty], [(p.x + p.tx) / 2 + p.radius, (p.y + p.ty) / 2 - p.radius], [p.x, p.y]]);
        else line(ctx, [[p.tx, p.ty], [p.x, p.y]]);
      }
      if (effect.type === 'particle-frost' && p.variant < 0.35) star(ctx, p.x, p.y, p.radius * 1.2, 6, p.angle);
      else if (p.variant < 0.16 && effect.type !== 'particle-fire') star(ctx, p.x, p.y, p.radius * 1.35, 4, p.angle);
      else { ctx.beginPath(); ctx.ellipse(p.x, p.y, p.radius, p.radius * (effect.type === 'particle-fire' ? 1.5 : 0.8), p.angle, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = rgba(p.opacity, 0.8); ctx.beginPath(); ctx.arc(p.x, p.y, p.radius * 0.42, 0, Math.PI * 2); ctx.fill();
    }
  }
  const templates = [
    ...[
      ['particle-magic', 'Poeira mágica', '#b277ff'], ['particle-sparks', 'Faíscas', '#ffca55'], ['particle-fire', 'Chama arcana', '#ff803b'],
      ['particle-frost', 'Cristais de gelo', '#73ddff'], ['particle-lightning', 'Energia elétrica', '#55cfff'], ['particle-vortex', 'Vórtice mágico', '#9c70ff']
    ].map(([id, name, color]) => ({ id, name, color, particle: true, draw(ctx, effect = {}, black = false) { drawParticles(ctx, { ...effect, type: id, color: effect.color || color }, black); } })),
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
      const p = particleOptions(effect);
      if (!Number.isInteger(p.count) || p.count < 10 || p.count > 180 || !Number.isFinite(p.spread) || p.spread < 25 || p.spread > 100 || !Number.isFinite(p.particleMm) || p.particleMm < 0.15 || p.particleMm > 1.5 || !Number.isFinite(p.glow) || p.glow < 0 || p.glow > 100 || !Number.isInteger(p.seed) || p.seed < 0 || p.seed > 4294967295) throw new Error('Partículas inválidas. Ajuste quantidade, dispersão, tamanho ou brilho.');
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
      templates.find(item => item.id === effect.type).draw(ctx, effect, black); ctx.restore();
    }
  }
  const api = { templates, validate, position, layout, draw, particleOptions, particles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FoilEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
