/**
 * strokeAnalyzer 单测（node:test 零依赖，spec 7.2 四条硬要求）：
 *  1. 只在小区域画很多短笔 → earlyDetailRatio 高
 *  2. 同一网格反复重画 → reworkRegions ≥ 1
 *  3. 排线角度完全一致 → hatchAngleStdDeg ≈ 0
 *  4. strokes 为空 → 所有指标 null/0，不抛异常
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStrokes, axialWeightedStdDeg, type StrokesPayload, type StrokeJson } from './strokeAnalyzer.ts';

const CANVAS = { width: 1024, height: 768, scale: 2 };

function mkStroke(
  i: number,
  startMs: number,
  pts: [number, number][],
  opts: { f?: number; durMs?: number } = {}
): StrokeJson {
  const f = opts.f ?? 0.4;
  const durMs = opts.durMs ?? 400;
  const full = pts.map(([x, y], k) => ({
    t: (k / Math.max(1, pts.length - 1)) * (durMs / 1000),
    x,
    y,
    nx: x / CANVAS.width,
    ny: y / CANVAS.height,
    f,
    az: 1.5708,
    al: 1.0472,
    w: 3.5,
    o: 1.0,
  }));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    i,
    ink: 'pencil',
    color: '#1A1A1A',
    bbox: [minX, minY, maxX - minX, maxY - minY],
    startMs,
    endMs: startMs + durMs,
    pts: full,
  };
}

function payload(strokes: StrokeJson[]): StrokesPayload {
  return { version: 1, canvas: CANVAS, strokes };
}

test('只在小区域画很多短笔 → earlyDetailRatio 高', () => {
  // 前 30% 时间（0~1800ms 内）画 20 条小笔画（对角线 ~70pt << 8%×1280≈102pt）
  const early = Array.from({ length: 20 }, (_, k) =>
    mkStroke(k, k * 80, [
      [500, 400],
      [540 + (k % 5) * 6, 430 + (k % 3) * 6],
    ])
  );
  // 后面再画几条长笔撑时间轴（总时长 12000ms，早期窗口 3600ms 覆盖上面 20 条）
  const late = Array.from({ length: 6 }, (_, k) =>
    mkStroke(20 + k, 5000 + k * 1000, [
      [100, 100],
      [900, 700],
    ])
  );
  const r = analyzeStrokes(payload([...early, ...late]));
  assert.ok((r.metrics.earlyDetailRatio ?? 0) > 0.9, `earlyDetailRatio=${r.metrics.earlyDetailRatio}`);
  assert.ok(r.findings.some((f) => f.evidence.includes('stroke:early-detail')));
});

test('同一网格反复重画（方向杂乱）→ reworkRegions ≥ 1，平行排线不计', () => {
  // 5 个簇，每簇 8 条不同方向的短笔，簇心都落在 8×8 网格单一格内（格宽 128pt×高 96pt）
  const centers: [number, number][] = [
    [64, 144],
    [320, 336],
    [576, 528],
    [832, 144],
    [704, 624],
  ];
  const strokes: StrokeJson[] = [];
  let i = 0;
  for (const [cx, cy] of centers) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 8; // 方向各不相同
      const r = 30;
      strokes.push(
        mkStroke(i++, k * 300, [
          [cx - r * Math.cos(a), cy - r * Math.sin(a)],
          [cx + r * Math.cos(a), cy + r * Math.sin(a)],
        ])
      );
    }
  }
  const r = analyzeStrokes(payload(strokes));
  assert.ok((r.metrics.reworkRegions ?? 0) >= 1, `reworkRegions=${r.metrics.reworkRegions}`);
  assert.ok(r.findings.some((f) => f.evidence.includes('stroke:rework-many')));

  // 对照组：平行排线（长线、同向）不算涂改
  const parallel = Array.from({ length: 12 }, (_, k) => {
    const y = 100 + k * 50;
    const dx = 400;
    return mkStroke(k, k * 300, [
      [100, y],
      [100 + dx, y + dx * Math.tan(Math.PI / 6)],
    ]);
  });
  const r2 = analyzeStrokes(payload(parallel));
  assert.equal(r2.metrics.reworkRegions, 0);
});

test('排线角度完全一致 → hatchAngleStdDeg ≈ 0', () => {
  // 12 条平行长线（30° 方向）
  const strokes = Array.from({ length: 12 }, (_, k) => {
    const y = 100 + k * 50;
    const dx = 400;
    return mkStroke(k, k * 300, [
      [100, y],
      [100 + dx, y + dx * Math.tan(Math.PI / 6)],
    ]);
  });
  const r = analyzeStrokes(payload(strokes));
  const std = r.metrics.hatchAngleStdDeg;
  assert.ok(std !== null && std < 1.5, `hatchAngleStdDeg=${std}`);
});

test('strokes 为空 → 指标全部 0/null，不抛异常', () => {
  const r = analyzeStrokes({ version: 1, canvas: CANVAS, strokes: [] });
  assert.equal(r.metrics.strokeCount, 0);
  assert.equal(r.metrics.avgForce, null);
  assert.equal(r.metrics.hatchAngleStdDeg, null);
  assert.equal(r.metrics.reworkRegions, null);
  assert.equal(r.metrics.earlyDetailRatio, null);
  assert.deepEqual(r.findings, []);
  // null payload 也不炸
  const r2 = analyzeStrokes(null);
  assert.equal(r2.metrics.strokeCount, 0);
});

test('轴向加权圆标准差：均匀分布 → 大，同向 → ≈0', () => {
  const same = axialWeightedStdDeg([0.5, 0.5, 0.51], [10, 10, 10]);
  assert.ok(same !== null && same < 1, `same=${same}`);
  const scatter = axialWeightedStdDeg([0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4], [10, 10, 10, 10]);
  assert.ok(scatter !== null && scatter > 25, `scatter=${scatter}`);
});

test('force 恒定（手指/模拟器）→ forceAvailable=false 且不产生压感 finding', () => {
  const strokes = Array.from({ length: 10 }, (_, k) =>
    mkStroke(k, k * 400, [
      [100, 100],
      [900, 700],
    ])
  );
  const r = analyzeStrokes(payload(strokes));
  assert.equal(r.metrics.forceAvailable, false);
  assert.ok(r.findings.some((f) => f.evidence.includes('stroke:force-unavailable')));
  assert.ok(!r.findings.some((f) => f.evidence.includes('stroke:force-contrast-low')));
});

test('带灰度图：暗区重笔/亮区轻笔 → forceContrast 为正', () => {
  // 左半暗（gray=60）右半亮（gray=240），左半 force ~0.7 右半 ~0.2（点内变化保证 forceAvailable）
  const gray = new Uint8Array(64 * 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) gray[y * 64 + x] = x < 32 ? 60 : 240;
  const mk = (i: number, startMs: number, xs: number[], fs: number[]): StrokeJson => {
    const pts = xs.map((x, k) => ({
      t: k * 0.2,
      x,
      y: 384 + k * 10,
      nx: x / CANVAS.width,
      ny: (384 + k * 10) / CANVAS.height,
      f: fs[k]!,
      az: 1.5708,
      al: 1.0472,
      w: 4,
      o: 1,
    }));
    return {
      i,
      ink: 'pencil',
      color: '#1A1A1A',
      bbox: [Math.min(...xs), 384, Math.max(...xs) - Math.min(...xs), 30],
      startMs,
      endMs: startMs + 600,
      pts,
    };
  };
  const darkStroke = mk(0, 0, [100, 200, 300, 400], [0.65, 0.7, 0.75, 0.7]);
  const brightStroke = mk(1, 1000, [620, 720, 820, 920], [0.15, 0.2, 0.25, 0.2]);
  const r = analyzeStrokes(payload([darkStroke, brightStroke]), { n: 64, data: gray });
  assert.equal(r.metrics.forceAvailable, true);
  const fc = r.metrics.forceContrast;
  assert.ok(fc !== null && fc > 0.4, `forceContrast=${fc}`);
});
