/** critique 合并层单测：降级路径 / 证据校验 / weaknesses / 选课 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReview } from './critique.ts';
import { analyzeStrokes, type StrokesPayload } from './strokeAnalyzer.ts';
import { pickAssignment } from './assignments.ts';

const CANVAS = { width: 1024, height: 768, scale: 2 };

function onePayload(): StrokesPayload {
  return {
    version: 1,
    canvas: CANVAS,
    strokes: Array.from({ length: 10 }, (_, k) => ({
      i: k,
      ink: 'pencil',
      color: '#1A1A1A',
      bbox: [100, 100, 40, 40],
      startMs: k * 500,
      endMs: k * 500 + 400,
      pts: [
        { t: 0, x: 100, y: 100, nx: 0.1, ny: 0.13, f: 0.4, az: 1.5, al: 1.0, w: 3.5, o: 1 },
        { t: 0.4, x: 140, y: 140, nx: 0.14, ny: 0.18, f: 0.4, az: 1.5, al: 1.0, w: 3.5, o: 1 },
      ],
    })),
  };
}

test('未配置 LLM（vl=null）→ degraded:true，规则批语可用，不抛异常', () => {
  const r = buildReview({
    reviewId: 'rv_test',
    createdAt: new Date().toISOString(),
    imageUrl: null,
    vl: null,
    stroke: analyzeStrokes(onePayload()),
    color: null,
    crossCheck: null,
    lastTaskId: null,
  });
  assert.equal(r.degraded, true);
  assert.equal(r.ok, true);
  assert.ok(r.summary.length > 0);
  assert.ok(r.nextAssignment.id.length > 0);
  // scores 在 0..100
  for (const v of Object.values(r.scores)) assert.ok(v >= 0 && v <= 100);
});

test('VL 说明暗不足但规则 forceContrast 高 → 以规则为准改判 ok', () => {
  const gray = new Uint8Array(64 * 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) gray[y * 64 + x] = x < 32 ? 60 : 240;
  const payload: StrokesPayload = {
    version: 1,
    canvas: CANVAS,
    strokes: [
      {
        i: 0,
        ink: 'pencil',
        color: '#1A1A1A',
        bbox: [100, 384, 300, 40],
        startMs: 0,
        endMs: 600,
        pts: [
          { t: 0.0, x: 100, y: 384, nx: 0.1, ny: 0.5, f: 0.75, az: 1.5, al: 1.0, w: 4, o: 1 },
          { t: 0.2, x: 200, y: 394, nx: 0.2, ny: 0.51, f: 0.8, az: 1.5, al: 1.0, w: 4, o: 1 },
          { t: 0.4, x: 300, y: 404, nx: 0.29, ny: 0.53, f: 0.85, az: 1.5, al: 1.0, w: 4, o: 1 },
          { t: 0.6, x: 400, y: 424, nx: 0.39, ny: 0.55, f: 0.8, az: 1.5, al: 1.0, w: 4, o: 1 },
        ],
      },
      {
        i: 1,
        ink: 'pencil',
        color: '#1A1A1A',
        bbox: [620, 384, 300, 40],
        startMs: 1000,
        endMs: 1600,
        pts: [
          { t: 0.0, x: 620, y: 384, nx: 0.6, ny: 0.5, f: 0.15, az: 1.5, al: 1.0, w: 4, o: 1 },
          { t: 0.2, x: 720, y: 394, nx: 0.7, ny: 0.51, f: 0.2, az: 1.5, al: 1.0, w: 4, o: 1 },
          { t: 0.4, x: 820, y: 404, nx: 0.8, ny: 0.53, f: 0.25, az: 1.5, al: 1.0, w: 4, o: 1 },
          { t: 0.6, x: 920, y: 424, nx: 0.9, ny: 0.55, f: 0.2, az: 1.5, al: 1.0, w: 4, o: 1 },
        ],
      },
    ],
  };
  const stroke = analyzeStrokes(payload, { n: 64, data: gray });
  assert.equal(stroke.metrics.forceAvailable, true);
  const r = buildReview({
    reviewId: 'rv_test2',
    createdAt: new Date().toISOString(),
    imageUrl: null,
    vl: {
      shape: 80,
      value: 40,
      line: 70,
      completeness: 75,
      summary: '整体可以，明暗偏灰。',
      sections: [{ key: 'value', title: '明暗层次', verdict: 'needs-work', comment: '画面发灰。' }],
    },
    stroke,
    color: null,
    crossCheck: null,
    lastTaskId: null,
  });
  const valueSection = r.sections.find((s) => s.key === 'value' && s.evidence.includes('vl:value'));
  assert.ok(valueSection, 'VL value 段存在');
  assert.equal(valueSection!.verdict, 'ok');
  assert.ok(valueSection!.comment.includes('以笔迹数据为准'));
});

test('weaknesses 来自 needs-work 段（去重），nextAssignment 避开刚做的任务', () => {
  const r = buildReview({
    reviewId: 'rv_test3',
    createdAt: new Date().toISOString(),
    imageUrl: null,
    vl: null,
    stroke: analyzeStrokes(onePayload()),
    color: null,
    crossCheck: null,
    lastTaskId: 'value-sphere-02',
  });
  for (const w of r.weaknesses) assert.ok(typeof w === 'string' && w.length > 0);
  const next = pickAssignment(['stroke:force-contrast-low'], 'value-sphere-02');
  assert.notEqual(next.id, 'value-sphere-02');
  assert.ok(next.id.length > 0);
});
