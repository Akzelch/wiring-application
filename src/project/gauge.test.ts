import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GAUGES, gaugeLabel, stepGauge, wireWidth } from './gauge.ts';

test('each size is drawn wider than the one below it', () => {
  const widths = [undefined, ...GAUGES.map(g => g.mm2)].map(wireWidth);
  assert.ok(widths.every((w, i) => i === 0 || w > widths[i - 1]));
});

test('stepping walks the list, starts from not set, and stops at the ends', () => {
  assert.equal(stepGauge(undefined, 1), 0.5);
  assert.equal(stepGauge(0.5, 1), 0.75);
  assert.equal(stepGauge(0.75, -1), 0.5);
  assert.equal(stepGauge(0.5, -1), undefined);
  assert.equal(stepGauge(undefined, -1), undefined);
  assert.equal(stepGauge(10, 1), 10);
});

test('a label gives both mm² and AWG, and is empty when not set', () => {
  assert.equal(gaugeLabel(1.5), '1.5 mm² / AWG 16');
  assert.equal(gaugeLabel(undefined), '');
});
