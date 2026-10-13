const { test } = require('node:test');
const assert = require('node:assert/strict');
const foil = require('../foil.js');
const result = { width: 300, height: 400, dpi: 150, placement: { x: 10, y: 10, width: 280, height: 380 }, sourceBounds: { x: 20, y: 30, width: 100, height: 160 } };
const effect = { type: 'magic', x: 70, y: 110, sizeMm: 12, lineMm: 0.3, rotation: 0, color: '#d6ae55' };
test('foil gallery provides six game particle effects and six symbols', () => {
  assert.equal(foil.templates.length, 12);
  assert.equal(foil.templates.filter(item => item.particle).length, 6);
  assert.equal(new Set(foil.templates.map(item => item.id)).size, 12);
  assert.ok(foil.templates.every(item => typeof item.draw === 'function' && item.name));
});
test('particle distributions are deterministic and stay stable when moving or recoloring', () => {
  const e = { ...effect, type: 'particle-magic', count: 100, seed: 123 };
  const original = foil.particles(e);
  assert.equal(original.length, 100);
  assert.deepEqual(foil.particles({ ...e, x: 20, color: '#abcdef', rotation: 45 }), original);
  assert.notDeepEqual(foil.particles({ ...e, seed: 456 }), original);
  assert.deepEqual(foil.particles({ ...e, count: 50 }), original.slice(0, 50));
  const wide = foil.particles({ ...e, spread: 100 }), narrow = foil.particles({ ...e, spread: 25 });
  assert.ok(wide.reduce((s,p) => s + Math.hypot(p.x,p.y),0) > narrow.reduce((s,p) => s + Math.hypot(p.x,p.y),0) * 2);
});
test('particle halos and trails fit the export bounds even with maximum controls', () => {
  for (const template of foil.templates.filter(item => item.particle)) for (const sizeMm of [4, 24, 60]) for (const glow of [0, 100]) {
    for (const p of foil.particles({ ...effect, type: template.id, sizeMm, glow, particleMm: 1.5, spread: 100, count: 180 })) {
      assert.ok(Math.hypot(p.x,p.y) + Math.max(p.halo, p.radius * 1.5) < 0.5);
      assert.ok(Math.hypot(p.tx,p.ty) + p.radius * 2 < 0.5);
    }
  }
  for (const invalid of [{ count: 181 }, { count: 10.5 }, { spread: 101 }, { particleMm: 0 }, { glow: NaN }, { seed: -1 }]) assert.throws(() => foil.validate([{ ...effect, ...invalid }]), /Partículas inválidas/);
});
test('foil positions follow the source crop and artwork placement rather than the export padding', () => {
  const point = foil.position(result, effect);
  assert.ok(Math.abs(point.x - 150.9) < 1e-9); assert.ok(Math.abs(point.y - 200.6875) < 1e-9);
  const resized = { ...result, placement: { ...result.placement, width: 560, height: 760 } };
  const larger = foil.position(resized, effect);
  assert.equal(larger.x, 10 + (effect.x - 20 + 0.5) / 100 * 560 - 0.5);
});
test('effects inside the canvas retain dimensions; overflowing effects grow shared transparent margins', () => {
  assert.deepEqual(foil.layout(result, []), { width: 300, height: 400, offsetX: 0, offsetY: 0 });
  assert.deepEqual(foil.layout(result, [effect]), { width: 300, height: 400, offsetX: 0, offsetY: 0 });
  const before = JSON.stringify(result), edge = { ...effect, x: 20, y: 30 };
  const frame = foil.layout(result, [edge]), point = foil.position(result, edge);
  const radius = (edge.sizeMm + edge.lineMm) / 25.4 * result.dpi / 2 + 3;
  assert.ok(frame.offsetX > 0 && frame.offsetY > 0);
  assert.ok(point.x + frame.offsetX - radius >= 0 && point.y + frame.offsetY - radius >= 0);
  assert.equal(frame.width, result.width + frame.offsetX);
  assert.equal(frame.height, result.height + frame.offsetY);
  assert.deepEqual(foil.layout(result, [{ ...edge, rotation: 137 }]), frame);
  assert.equal(JSON.stringify(result), before);
});
test('invalid foil settings and oversized or distant effects cannot produce clipped exports', () => {
  assert.throws(() => foil.layout(result, [{ ...effect, type: 'invalid' }]), /inválido/);
  assert.throws(() => foil.layout(result, [{ ...effect, sizeMm: 100 }]), /inválido/);
  assert.throws(() => foil.layout(result, [{ ...effect, x: NaN }]), /inválido/);
  assert.throws(() => foil.layout(result, [{ ...effect, x: 100000 }]), /ampliou demais/);
  assert.throws(() => foil.layout(result, Array.from({ length: 41 }, () => effect)), /40 efeitos/);
});
