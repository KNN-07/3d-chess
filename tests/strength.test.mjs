import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STRENGTH, STRENGTH_PRESETS, getStrength, restoreStrength } from '../dist/strength.js';

test('legacy difficulty saves migrate to supported Elo settings', () => {
  assert.equal(restoreStrength({ level: 1 }), '1320');
  assert.equal(restoreStrength({ level: 2 }), '1500');
  assert.equal(restoreStrength({ level: 3 }), '2100');
  assert.equal(restoreStrength({ strength: '2800', level: 1 }), '2800');
  assert.equal(restoreStrength({ strength: 'full' }), 'full');
  assert.equal(restoreStrength({ strength: 3190 }), '3190');
  assert.equal(restoreStrength({ strength: 'unsupported', level: 99 }), DEFAULT_STRENGTH);
  assert.equal(restoreStrength(null), DEFAULT_STRENGTH);
});

test('every offered Elo is in the engine-supported range and full strength remains unlimited', () => {
  assert.equal(new Set(STRENGTH_PRESETS.map(value => value.id)).size, STRENGTH_PRESETS.length);
  for (const preset of STRENGTH_PRESETS.filter(value => value.elo !== null)) {
    assert.ok(Number.isInteger(preset.elo) && preset.elo >= 1320 && preset.elo <= 3190);
    assert.equal(getStrength(preset.id), preset);
  }
  assert.equal(getStrength('full').elo, null);
  assert.equal(getStrength('unsupported').id, DEFAULT_STRENGTH);
});
