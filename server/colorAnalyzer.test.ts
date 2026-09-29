/** colorAnalyzer 单测：纯函数口径 + sharp PNG 复算 + 互证 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorStatsFromRawRGB, crossCheckColor, type ColorStats } from './colorAnalyzer.ts';

test('纯白画布 → null（无有效像素）', () => {
  const raw = new Uint8Array(64 * 64 * 4).fill(255);
  assert.equal(colorStatsFromRawRGB(raw, 64), null);
});

test('暖色画布 → warmRatio 接近 1，色相桶落在暖区', () => {
  const raw = new Uint8Array(64 * 64 * 4).fill(255);
  for (let i = 0; i < raw.length; i += 4) {
    raw[i] = 220; // R
    raw[i + 1] = 60; // G
    raw[i + 2] = 40; // B —— 橙红
  }
  const s = colorStatsFromRawRGB(raw, 64)!;
  assert.ok(s, 'stats 不为 null');
  assert.ok(s.warmRatio > 0.95, `warmRatio=${s.warmRatio}`);
  assert.ok(s.neutralRatio < 0.05);
  assert.equal(s.hueBuckets.length, 12);
  assert.ok(s.hueBuckets.reduce((a, b) => a + b, 0) > 0);
});

test('近灰画布 → neutralRatio 接近 1', () => {
  const raw = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < raw.length; i += 4) {
    raw[i] = 128;
    raw[i + 1] = 129;
    raw[i + 2] = 128;
  }
  const s = colorStatsFromRawRGB(raw, 64)!;
  assert.ok(s.neutralRatio > 0.95, `neutralRatio=${s.neutralRatio}`);
});

test('crossCheck：差异 <5% → ok；>5% → 不 ok', () => {
  const a: ColorStats = {
    version: 1,
    sampleSize: 64,
    hueBuckets: new Array(12).fill(0),
    avgSaturation: 0.31,
    avgValue: 0.58,
    warmRatio: 0.72,
    neutralRatio: 0.18,
    dominantColors: [],
  };
  const okRes = crossCheckColor({ ...a, warmRatio: 0.73 }, a);
  assert.equal(okRes.ok, true);
  const badRes = crossCheckColor({ ...a, warmRatio: 0.5 }, a);
  assert.equal(badRes.ok, false);
  assert.ok(badRes.diffs.some((d) => d.field === 'warmRatio'));
});
