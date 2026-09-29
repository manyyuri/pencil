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

// ---------- 特征化测试（characterization）：锁定 analyzeStrokes 的完整输出，防止重构回归 ----------
test('特征化：analyzeStrokes 端到端输出快照（refactor guard）', () => {
  // 左半暗（60）右半亮（240）的灰度图，用于触发 completion / forceContrast
  const halfGray = () => {
    const n = 64;
    const data = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) data[y * n + x] = x < n / 2 ? 60 : 240;
    return { n, data };
  };

  // rich：压感可用 / 排线不一致 / 网格涂改 / 过早细节 / 长停笔 / 压感差低
  const rich: StrokeJson[] = [
    mkStroke(0, 0, [[100, 100], [600, 100]], { f: 0.8 }),
    mkStroke(1, 400, [[100, 160], [600, 160]], { f: 0.8 }),
    mkStroke(2, 800, [[100, 220], [600, 220]], { f: 0.8 }),
    mkStroke(3, 1200, [[700, 500], [740, 540]], { f: 0.3 }),
    mkStroke(4, 1400, [[700, 500], [700, 560]], { f: 0.3 }),
    mkStroke(5, 1600, [[700, 500], [660, 540]], { f: 0.3 }),
    mkStroke(6, 1800, [[700, 500], [740, 460]], { f: 0.3 }),
    mkStroke(7, 200, [[40, 400], [60, 420]], { f: 0.2 }),
    mkStroke(8, 300, [[40, 440], [60, 460]], { f: 0.2 }),
    mkStroke(9, 20000, [[900, 700], [960, 720]], { f: 0.5 }),
  ];

  // parallel：平行排线（line good）+ 暗区重笔/亮区轻笔（value good）
  const parallel: StrokeJson[] = [
    ...Array.from({ length: 5 }, (_, k) =>
      mkStroke(k, k * 500, [[100, 100 + k * 60], [400, 100 + k * 60]], { f: 0.85 + k * 0.02 })
    ),
    ...Array.from({ length: 5 }, (_, k) =>
      mkStroke(5 + k, 3000 + k * 500, [[600, 100 + k * 60], [900, 100 + k * 60]], { f: 0.1 + k * 0.02 })
    ),
  ];

  // finger：压感恒定 → forceAvailable=false（无灰度图 → completion 为 null）
  const finger: StrokeJson[] = Array.from({ length: 10 }, (_, k) =>
    mkStroke(k, k * 500, [[100 + k * 40, 100], [300 + k * 40, 140]], { f: 0.4 })
  );

  const expected = {
    rich: {
      metrics: {
        strokeCount: 10,
        forceAvailable: true,
        avgForce: 0.45,
        forceContrast: 0.011,
        hatchAngleStdDeg: 18.8,
        reworkRegions: 1,
        earlyDetailRatio: 0.667,
        rhythmPauses: 1,
        completion: 1,
      },
      findings: [
        {
          key: 'value',
          title: '明暗压感层次',
          verdict: 'needs-work',
          comment:
            '暗部与亮部的平均压感差只有 0.01（建议 ≥0.20），画面容易发灰。练习时刻意"亮部轻扫、暗部压重"。',
          evidence: ['stroke:force-contrast-low'],
        },
        {
          key: 'process',
          title: '作画顺序',
          verdict: 'needs-work',
          comment:
            '前 30% 时间里 67% 的笔画是小范围刻画——大形还没锁定就开始抠细节。下一张先只画大外形与大明暗，细节留到最后 20% 时间。',
          evidence: ['stroke:early-detail'],
        },
      ],
    },
    parallel: {
      metrics: {
        strokeCount: 10,
        forceAvailable: true,
        avgForce: 0.515,
        forceContrast: 0.75,
        hatchAngleStdDeg:  0,
        reworkRegions: 0,
        earlyDetailRatio: 0,
        rhythmPauses: 0,
        completion: 1,
      },
      findings: [
        {
          key: 'value',
          title: '明暗压感层次',
          verdict: 'good',
          comment: '暗部与亮部平均压感差 0.75，下笔轻重有层次，继续保持。',
          evidence: ['stroke:force-contrast-ok'],
        },
        {
          key: 'line',
          title: '排线方向',
          verdict: 'good',
          comment: '排线角度方差仅 0.0°，方向统一，线条控制稳。',
          evidence: ['stroke:hatch-angle-steady'],
        },
      ],
    },
    finger: {
      metrics: {
        strokeCount: 10,
        forceAvailable: false,
        avgForce: 0.4,
        forceContrast: null,
        hatchAngleStdDeg:  0,
        reworkRegions: 0,
        earlyDetailRatio: 0,
        rhythmPauses: 0,
        completion: null,
      },
      findings: [
        {
          key: 'process',
          title: '压感数据不可用',
          verdict: 'ok',
          comment:
            '本次笔迹未检测到压感变化（手指绘制或非 Apple Pencil），跳过压感维度，仅看造型与过程指标。',
          evidence: ['stroke:force-unavailable'],
        },
        {
          key: 'line',
          title: '排线方向',
          verdict: 'good',
          comment: '排线角度方差仅 0.0°，方向统一，线条控制稳。',
          evidence: ['stroke:hatch-angle-steady'],
        },
      ],
    },
  };

  const actual = {
    rich: analyzeStrokes(payload(rich), halfGray()),
    parallel: analyzeStrokes(payload(parallel), halfGray()),
    finger: analyzeStrokes(payload(finger), null),
  };
  // 走 JSON 序列化对比（等同线上响应口径，-0 与 0 序列化一致）
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
});

test('>8s 停笔次数统计正确', () => {
  const strokes = [
    mkStroke(0, 0, [[100, 100], [400, 100]]),
    mkStroke(1, 1000, [[100, 200], [400, 200]]),
    mkStroke(2, 12000, [[100, 300], [400, 300]]), // 与上一笔相隔 11000ms > 8000
  ];
  const r = analyzeStrokes(payload(strokes));
  assert.equal(r.metrics.rhythmPauses, 1);
});

test('画面覆盖率低（<4%）→ completion 偏低且给出完成度 finding', () => {
  const n = 64;
  const data = new Uint8Array(n * n).fill(255);
  for (let i = 0; i < 128; i++) data[i] = 0; // 128/4096 = 0.03125
  const r = analyzeStrokes(payload([mkStroke(0, 0, [[100, 100], [400, 400]])]), { n, data });
  assert.equal(r.metrics.completion, 0.031);
  assert.ok(r.findings.some((f) => f.evidence.includes('stroke:coverage-low')));
});
