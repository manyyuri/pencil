/**
 * strokeAnalyzer —— 笔迹过程分析（本项目核心资产，纯确定性，零 LLM）。
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
 * 所有函数纯输入纯输出，空笔迹不抛异常。
 */
import sharp from 'sharp';

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
  const findings: RuleFinding[] = [];
  if (strokes.length === 0) {
    if (gray) metrics.completion = completionFromGray(gray);
    return { metrics, findings };
  }

  const canvas = payload!.canvas;
  const canvasDiag = Math.hypot(canvas.width, canvas.height);

  // ---------- forceAvailable / avgForce ----------
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
  metrics.forceAvailable = fSet.size > 3; // 手指/模拟器 force 恒定
  if (fCount > 0) metrics.avgForce = round(fSum / fCount);

  // ---------- hatchAngleStdDeg（排线角度方差，长度加权） ----------
  const angles: number[] = [];
  const weights: number[] = [];
  for (const s of strokes) {
    const len = strokeLength(s);
    if (len < canvasDiag * 0.02) continue; // 太短的点触不算排线
    angles.push(strokeAngle(s));
    weights.push(len);
  }
  metrics.hatchAngleStdDeg = axialWeightedStdDeg(angles, weights);

  // ---------- reworkRegions（8×8 网格涂改检测） ----------
  const G = 8;
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
  metrics.reworkRegions = rework;

  // ---------- earlyDetailRatio（过早抠细节） ----------
  const durationMs = Math.max(...strokes.map((s) => s.endMs), 0);
  if (durationMs > 0) {
    const earlyWindow = durationMs * 0.3;
    const early = strokes.filter((s) => s.startMs <= earlyWindow);
    if (early.length > 0) {
      const small = early.filter((s) => Math.hypot(s.bbox[2], s.bbox[3]) < canvasDiag * 0.08);
      metrics.earlyDetailRatio = round(small.length / early.length);
    } else {
      metrics.earlyDetailRatio = 0;
    }
  } else {
    metrics.earlyDetailRatio = 0;
  }

  // ---------- rhythmPauses ----------
  const starts = strokes.map((s) => s.startMs).sort((a, b) => a - b);
  let pauses = 0;
  for (let k = 1; k < starts.length; k++) {
    if (starts[k]! - starts[k - 1]! > 8000) pauses++;
  }
  metrics.rhythmPauses = pauses;

  // ---------- completion + forceContrast（需要灰度图） ----------
  if (gray) {
    metrics.completion = completionFromGray(gray);
    if (metrics.forceAvailable) {
      const pairs: { lum: number; f: number }[] = [];
      for (const s of strokes) {
        for (const p of s.pts) {
          const cx = Math.min(gray.n - 1, Math.max(0, Math.floor(p.nx * gray.n)));
          const cy = Math.min(gray.n - 1, Math.max(0, Math.floor(p.ny * gray.n)));
          pairs.push({ lum: gray.data[cy * gray.n + cx]!, f: p.f });
        }
      }
      if (pairs.length >= 8) {
        const lums = pairs.map((p) => p.lum).sort((a, b) => a - b);
        const q1 = lums[Math.floor(lums.length * 0.25)]!;
        const q3 = lums[Math.floor(lums.length * 0.75)]!;
        const dark = pairs.filter((p) => p.lum <= q1);
        const bright = pairs.filter((p) => p.lum >= q3);
        if (dark.length > 0 && bright.length > 0) {
          const mean = (arr: { f: number }[]) => arr.reduce((a, p) => a + p.f, 0) / arr.length;
          metrics.forceContrast = round(mean(dark) - mean(bright));
        }
      }
    }
  }

  // ---------- 规则层 findings（数值解释权在这里，不在 VL） ----------
  if (metrics.forceContrast !== null && metrics.forceAvailable) {
    if (metrics.forceContrast < 0.12) {
      findings.push({
        key: 'value',
        title: '明暗压感层次',
        verdict: 'needs-work',
        comment: `暗部与亮部的平均压感差只有 ${metrics.forceContrast.toFixed(2)}（建议 ≥0.20），画面容易发灰。练习时刻意"亮部轻扫、暗部压重"。`,
        evidence: ['stroke:force-contrast-low'],
      });
    } else if (metrics.forceContrast >= 0.25) {
      findings.push({
        key: 'value',
        title: '明暗压感层次',
        verdict: 'good',
        comment: `暗部与亮部平均压感差 ${metrics.forceContrast.toFixed(2)}，下笔轻重有层次，继续保持。`,
        evidence: ['stroke:force-contrast-ok'],
      });
    }
  } else if (!metrics.forceAvailable && strokes.length > 0) {
    findings.push({
      key: 'process',
      title: '压感数据不可用',
      verdict: 'ok',
      comment: '本次笔迹未检测到压感变化（手指绘制或非 Apple Pencil），跳过压感维度，仅看造型与过程指标。',
      evidence: ['stroke:force-unavailable'],
    });
  }

  if (metrics.hatchAngleStdDeg !== null) {
    if (metrics.hatchAngleStdDeg > 30) {
      findings.push({
        key: 'line',
        title: '排线方向',
        verdict: 'needs-work',
        comment: `排线角度方差 ${metrics.hatchAngleStdDeg.toFixed(1)}°（≤12° 为稳），手腕方向控制不稳或对结构理解不足，先做同方向排线格子练习。`,
        evidence: ['stroke:hatch-angle-scatter'],
      });
    } else if (metrics.hatchAngleStdDeg <= 12 && angles.length >= 8) {
      findings.push({
        key: 'line',
        title: '排线方向',
        verdict: 'good',
        comment: `排线角度方差仅 ${metrics.hatchAngleStdDeg.toFixed(1)}°，方向统一，线条控制稳。`,
        evidence: ['stroke:hatch-angle-steady'],
      });
    }
  }

  if ((metrics.earlyDetailRatio ?? 0) > 0.5 && strokes.length >= 10) {
    findings.push({
      key: 'process',
      title: '作画顺序',
      verdict: 'needs-work',
      comment: `前 30% 时间里 ${(metrics.earlyDetailRatio! * 100).toFixed(0)}% 的笔画是小范围刻画——大形还没锁定就开始抠细节。下一张先只画大外形与大明暗，细节留到最后 20% 时间。`,
      evidence: ['stroke:early-detail'],
    });
  }

  if ((metrics.reworkRegions ?? 0) >= 4) {
    findings.push({
      key: 'process',
      title: '反复涂改',
      verdict: 'needs-work',
      comment: `有 ${metrics.reworkRegions} 个区域被 ≥4 笔反复覆盖且方向杂乱，说明落笔前观察不够。改用"轻起稿、多比较、少修改"的节奏。`,
      evidence: ['stroke:rework-many'],
    });
  }

  if ((metrics.rhythmPauses ?? 0) > 5) {
    findings.push({
      key: 'process',
      title: '作画节奏',
      verdict: 'ok',
      comment: `观察到 ${metrics.rhythmPauses} 次超过 8 秒的停笔。停下来观察是好事，但如果停顿集中在纠结局部，就把计时器打开强制推进。`,
      evidence: ['stroke:rhythm-scattered'],
    });
  }

  if (metrics.completion !== null && metrics.completion < 0.04) {
    findings.push({
      key: 'completeness',
      title: '画面完成度',
      verdict: 'needs-work',
      comment: `画布覆盖率 ${(metrics.completion * 100).toFixed(1)}%，构图明显偏小或未铺开。起稿时先用长直线把主体顶到画面边缘 80% 的位置。`,
      evidence: ['stroke:coverage-low'],
    });
  }

  return { metrics, findings };
}

/** 灰度图非白覆盖率 */
export function completionFromGray(gray: GrayMap): number | null {
  let ink = 0;
  for (const v of gray.data) if (v < 245) ink++;
  return round(ink / gray.data.length);
}

/** PNG Buffer → 64×64 灰度图（sharp 降采样） */
export async function grayMapFromPng(png: Buffer, n = 64): Promise<GrayMap> {
  const { data } = await sharp(png, { failOn: 'none' })
    .grayscale()
    .resize(n, n, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { n, data: new Uint8Array(data) };
}
