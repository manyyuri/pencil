/**
 * strokeAnalyzer —— 笔迹过程分析（本项目核心资产，纯确定性，零 LLM、零 I/O）。
 *
 * 输入是 iPad 端 StrokeCollector 上传的笔迹 JSON（spec 5.4，语义对齐 W3C InkML 的
 * t/x/y/force/azimuth/altitude 通道）。输出 7 个过程指标 + 规则层 findings：
 *
 *   strokeCount        笔数
 *   forceAvailable     本次是否真的有压感（手指/模拟器 force 恒定 → false，隐藏压感维度）
 *   avgForce           全局平均压感
 *   forceContrast      暗部（灰度 Q1 区域）与亮部（Q3 区域）的平均压感差
 *   hatchAngleStdDeg   排线角度加权圆标准差（轴向数据双倍角法，0°=方向完全统一）
 *   reworkRegions      反复涂改网格数（8×8 网格内 ≥4 笔且方向杂乱）
 *   earlyDetailRatio   前 30% 作画时间里"小笔画"占比（高 = 过早抠细节）
 *   rhythmPauses       >8s 的停笔次数
 *   completion         画布非白像素覆盖率（需灰度图）
 *
 * 本模块刻意保持为纯函数集合（不 import sharp 等 I/O 依赖）：位图解码在 imageIO.ts。
 * 每个度量轴各自成函数，analyzeStrokes 只做编排——便于单测与复杂度控制。
 * 所有函数纯输入纯输出，空笔迹不抛异常。
 */

export interface StrokePointJson {
  t: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
  f: number;
  az: number;
  al: number;
  w: number;
  o: number;
}

export interface StrokeJson {
  i: number;
  ink: string;
  color: string;
  bbox: [number, number, number, number]; // x,y,w,h
  startMs: number;
  endMs: number;
  pts: StrokePointJson[];
}

export interface StrokesPayload {
  version: number;
  canvas: { width: number; height: number; scale: number };
  strokes: StrokeJson[];
}

/** 灰度图（64×64，0=黑 255=白），由 PNG 降采样得到 */
export interface GrayMap {
  n: number;
  data: Uint8Array;
}

export interface StrokeMetrics {
  strokeCount: number;
  forceAvailable: boolean;
  avgForce: number | null;
  forceContrast: number | null;
  hatchAngleStdDeg: number | null;
  reworkRegions: number | null;
  earlyDetailRatio: number | null;
  rhythmPauses: number | null;
  completion: number | null;
}

export type Verdict = 'good' | 'ok' | 'needs-work';

export interface RuleFinding {
  key: 'process' | 'value' | 'line' | 'completeness';
  title: string;
  verdict: Verdict;
  comment: string;
  evidence: string[];
}

export interface StrokeAnalysis {
  metrics: StrokeMetrics;
  findings: RuleFinding[];
}

const round = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;

/** 笔画折线长度（点） */
function strokeLength(s: StrokeJson): number {
  let len = 0;
  for (let k = 1; k < s.pts.length; k++) {
    const a = s.pts[k - 1]!;
    const b = s.pts[k]!;
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

/** 笔画方向角（弧度，mod π —— 线没有头尾，属于轴向数据） */
function strokeAngle(s: StrokeJson): number {
  const a = s.pts[0]!;
  const b = s.pts[s.pts.length - 1]!;
  return Math.atan2(b.y - a.y, b.x - a.x) % Math.PI;
}

/** 轴向角度的加权圆标准差（双倍角法）：θ_i, w_i → std（度），0=完全同向 */
export function axialWeightedStdDeg(anglesRad: number[], weights: number[]): number | null {
  let sumW = 0;
  let mx = 0;
  let my = 0;
  for (let k = 0; k < anglesRad.length; k++) {
    const w = weights[k]!;
    const phi = 2 * anglesRad[k]!; // 轴向 → 圆向
    mx += w * Math.cos(phi);
    my += w * Math.sin(phi);
    sumW += w;
  }
  if (sumW <= 0) return null;
  const rBar = Math.hypot(mx, my) / sumW;
  const r = Math.min(1, Math.max(1e-12, rBar));
  // 圆标准差 s = sqrt(-2 ln R̄)；双倍角后除回 2
  const stdDeg = (Math.sqrt(-2 * Math.log(r)) * 180) / Math.PI / 2;
  return Math.min(90, round(stdDeg, 1));
}

// ---------- 各度量轴（纯函数，逐轴独立可测） ----------

interface ForceStats {
  forceAvailable: boolean;
  avgForce: number | null;
}

/** 压感可用性（force 恒定说明手指/模拟器）+ 全局平均压感 */
function computeForceStats(strokes: StrokeJson[]): ForceStats {
  const fSet = new Set<number>();
  let fSum = 0;
  let fCount = 0;
  for (const s of strokes) {
    for (const p of s.pts) {
      fSet.add(Math.round(p.f * 100) / 100);
      fSum += p.f;
      fCount++;
    }
  }
  return {
    forceAvailable: fSet.size > 3, // 手指/模拟器 force 恒定
    avgForce: fCount > 0 ? round(fSum / fCount) : null,
  };
}

interface HatchResult {
  stdDeg: number | null;
  sampleCount: number; // 参与计算的排线根数（供 findings 判断样本量）
}

/** 排线角度方差（长度加权；太短的点触不算排线） */
function computeHatchStd(strokes: StrokeJson[], canvasDiag: number): HatchResult {
  const angles: number[] = [];
  const weights: number[] = [];
  for (const s of strokes) {
    const len = strokeLength(s);
    if (len < canvasDiag * 0.02) continue; // 太短的点触不算排线
    angles.push(strokeAngle(s));
    weights.push(len);
  }
  return { stdDeg: axialWeightedStdDeg(angles, weights), sampleCount: angles.length };
}

/** 8×8 网格涂改热区数：网格内 ≥4 笔、方向杂乱且笔短 → 反复涂改 */
function computeReworkRegions(strokes: StrokeJson[], canvasDiag: number, G = 8): number {
  interface CellStat {
    strokes: Set<number>;
    angleSum: [number, number]; // 双倍角向量和，用于网格内方向方差
    lenSum: number;
  }
  const grid = new Map<number, CellStat>();
  for (const s of strokes) {
    const len = strokeLength(s);
    const phi = 2 * strokeAngle(s);
    const seen = new Set<number>();
    for (const p of s.pts) {
      const cx = Math.min(G - 1, Math.max(0, Math.floor(p.nx * G)));
      const cy = Math.min(G - 1, Math.max(0, Math.floor(p.ny * G)));
      const key = cy * G + cx;
      if (seen.has(key)) continue;
      seen.add(key);
      let c = grid.get(key);
      if (!c) {
        c = { strokes: new Set(), angleSum: [0, 0], lenSum: 0 };
        grid.set(key, c);
      }
      c.strokes.add(s.i);
      c.angleSum[0] += Math.cos(phi);
      c.angleSum[1] += Math.sin(phi);
      c.lenSum += len;
    }
  }
  let rework = 0;
  for (const c of grid.values()) {
    if (c.strokes.size < 4) continue;
    // 网格内方向杂乱（R̄ 小）→ 反复涂改；平行排线 R̄≈1 不计
    const rBar = Math.hypot(c.angleSum[0], c.angleSum[1]) / c.strokes.size;
    const meanLen = c.lenSum / c.strokes.size;
    if (rBar < 0.7 && meanLen < canvasDiag * 0.12) rework++;
  }
  return rework;
}

/** 前 30% 作画时间里"小笔画"占比（高 = 过早抠细节） */
function computeEarlyDetailRatio(strokes: StrokeJson[], canvasDiag: number): number {
  const durationMs = Math.max(...strokes.map((s) => s.endMs), 0);
  if (durationMs <= 0) return 0;
  const earlyWindow = durationMs * 0.3;
  const early = strokes.filter((s) => s.startMs <= earlyWindow);
  if (early.length === 0) return 0;
  const small = early.filter((s) => Math.hypot(s.bbox[2], s.bbox[3]) < canvasDiag * 0.08);
  return round(small.length / early.length);
}

/** >8s 的停笔次数 */
function computeRhythmPauses(strokes: StrokeJson[]): number {
  const starts = strokes.map((s) => s.startMs).sort((a, b) => a - b);
  let pauses = 0;
  for (let k = 1; k < starts.length; k++) {
    if (starts[k]! - starts[k - 1]! > 8000) pauses++;
  }
  return pauses;
}

/** 暗部（灰度 Q1 区域）与亮部（Q3 区域）的平均压感差；样本不足返回 null */
function computeForceContrast(strokes: StrokeJson[], gray: GrayMap): number | null {
  const pairs: { lum: number; f: number }[] = [];
  for (const s of strokes) {
    for (const p of s.pts) {
      const cx = Math.min(gray.n - 1, Math.max(0, Math.floor(p.nx * gray.n)));
      const cy = Math.min(gray.n - 1, Math.max(0, Math.floor(p.ny * gray.n)));
      pairs.push({ lum: gray.data[cy * gray.n + cx]!, f: p.f });
    }
  }
  if (pairs.length < 8) return null;
  const lums = pairs.map((p) => p.lum).sort((a, b) => a - b);
  const q1 = lums[Math.floor(lums.length * 0.25)]!;
  const q3 = lums[Math.floor(lums.length * 0.75)]!;
  const dark = pairs.filter((p) => p.lum <= q1);
  const bright = pairs.filter((p) => p.lum >= q3);
  if (dark.length === 0 || bright.length === 0) return null;
  const mean = (arr: { f: number }[]) => arr.reduce((a, p) => a + p.f, 0) / arr.length;
  return round(mean(dark) - mean(bright));
}

// ---------- 规则层 findings（数值解释权在这里，不在 VL） ----------

interface FindingContext {
  strokeCount: number;
  hatchSampleCount: number;
}

/**
 * 由指标生成规则 findings。判定顺序与文案是契约的一部分，不得改动：
 * value → line → earlyDetail → rework → rhythm → completeness。
 */
function buildFindings(m: StrokeMetrics, ctx: FindingContext): RuleFinding[] {
  const findings: RuleFinding[] = [];

  if (m.forceContrast !== null && m.forceAvailable) {
    if (m.forceContrast < 0.12) {
      findings.push({
        key: 'value',
        title: '明暗压感层次',
        verdict: 'needs-work',
        comment: `暗部与亮部的平均压感差只有 ${m.forceContrast.toFixed(2)}（建议 ≥0.20），画面容易发灰。练习时刻意"亮部轻扫、暗部压重"。`,
        evidence: ['stroke:force-contrast-low'],
      });
    } else if (m.forceContrast >= 0.25) {
      findings.push({
        key: 'value',
        title: '明暗压感层次',
        verdict: 'good',
        comment: `暗部与亮部平均压感差 ${m.forceContrast.toFixed(2)}，下笔轻重有层次，继续保持。`,
        evidence: ['stroke:force-contrast-ok'],
      });
    }
  } else if (!m.forceAvailable && ctx.strokeCount > 0) {
    findings.push({
      key: 'process',
      title: '压感数据不可用',
      verdict: 'ok',
      comment: '本次笔迹未检测到压感变化（手指绘制或非 Apple Pencil），跳过压感维度，仅看造型与过程指标。',
      evidence: ['stroke:force-unavailable'],
    });
  }

  if (m.hatchAngleStdDeg !== null) {
    if (m.hatchAngleStdDeg > 30) {
      findings.push({
        key: 'line',
        title: '排线方向',
        verdict: 'needs-work',
        comment: `排线角度方差 ${m.hatchAngleStdDeg.toFixed(1)}°（≤12° 为稳），手腕方向控制不稳或对结构理解不足，先做同方向排线格子练习。`,
        evidence: ['stroke:hatch-angle-scatter'],
      });
    } else if (m.hatchAngleStdDeg <= 12 && ctx.hatchSampleCount >= 8) {
      findings.push({
        key: 'line',
        title: '排线方向',
        verdict: 'good',
        comment: `排线角度方差仅 ${m.hatchAngleStdDeg.toFixed(1)}°，方向统一，线条控制稳。`,
        evidence: ['stroke:hatch-angle-steady'],
      });
    }
  }

  if ((m.earlyDetailRatio ?? 0) > 0.5 && ctx.strokeCount >= 10) {
    findings.push({
      key: 'process',
      title: '作画顺序',
      verdict: 'needs-work',
      comment: `前 30% 时间里 ${(m.earlyDetailRatio! * 100).toFixed(0)}% 的笔画是小范围刻画——大形还没锁定就开始抠细节。下一张先只画大外形与大明暗，细节留到最后 20% 时间。`,
      evidence: ['stroke:early-detail'],
    });
  }

  if ((m.reworkRegions ?? 0) >= 4) {
    findings.push({
      key: 'process',
      title: '反复涂改',
      verdict: 'needs-work',
      comment: `有 ${m.reworkRegions} 个区域被 ≥4 笔反复覆盖且方向杂乱，说明落笔前观察不够。改用"轻起稿、多比较、少修改"的节奏。`,
      evidence: ['stroke:rework-many'],
    });
  }

  if ((m.rhythmPauses ?? 0) > 5) {
    findings.push({
      key: 'process',
      title: '作画节奏',
      verdict: 'ok',
      comment: `观察到 ${m.rhythmPauses} 次超过 8 秒的停笔。停下来观察是好事，但如果停顿集中在纠结局部，就把计时器打开强制推进。`,
      evidence: ['stroke:rhythm-scattered'],
    });
  }

  if (m.completion !== null && m.completion < 0.04) {
    findings.push({
      key: 'completeness',
      title: '画面完成度',
      verdict: 'needs-work',
      comment: `画布覆盖率 ${(m.completion * 100).toFixed(1)}%，构图明显偏小或未铺开。起稿时先用长直线把主体顶到画面边缘 80% 的位置。`,
      evidence: ['stroke:coverage-low'],
    });
  }

  return findings;
}

// ---------- 编排 ----------

export function analyzeStrokes(payload: StrokesPayload | null, gray?: GrayMap | null): StrokeAnalysis {
  const strokes = payload?.strokes ?? [];
  const metrics: StrokeMetrics = {
    strokeCount: strokes.length,
    forceAvailable: false,
    avgForce: null,
    forceContrast: null,
    hatchAngleStdDeg: null,
    reworkRegions: null,
    earlyDetailRatio: null,
    rhythmPauses: null,
    completion: null,
  };
  if (strokes.length === 0) {
    if (gray) metrics.completion = completionFromGray(gray);
    return { metrics, findings: [] };
  }

  const canvas = payload!.canvas;
  const canvasDiag = Math.hypot(canvas.width, canvas.height);

  const force = computeForceStats(strokes);
  metrics.forceAvailable = force.forceAvailable;
  metrics.avgForce = force.avgForce;

  const hatch = computeHatchStd(strokes, canvasDiag);
  metrics.hatchAngleStdDeg = hatch.stdDeg;

  metrics.reworkRegions = computeReworkRegions(strokes, canvasDiag);
  metrics.earlyDetailRatio = computeEarlyDetailRatio(strokes, canvasDiag);
  metrics.rhythmPauses = computeRhythmPauses(strokes);

  if (gray) {
    metrics.completion = completionFromGray(gray);
    if (metrics.forceAvailable) metrics.forceContrast = computeForceContrast(strokes, gray);
  }

  const findings = buildFindings(metrics, {
    strokeCount: strokes.length,
    hatchSampleCount: hatch.sampleCount,
  });

  return { metrics, findings };
}

/** 灰度图非白覆盖率 */
export function completionFromGray(gray: GrayMap): number | null {
  let ink = 0;
  for (const v of gray.data) if (v < 245) ink++;
  return round(ink / gray.data.length);
}
