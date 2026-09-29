/**
 * critique —— 合并层：规则层（数值解释权）+ VL 层（主观定性）→ 一份批改。
 *
 * 红线（spec 7.3）：
 *  1. VL 不稳定时批改仍有可信骨架（规则层）；
 *  2. 数值只能来自规则层；VL 的分只作主观参考并与规则分加权融合；
 *  3. VL 结论与规则数据冲突时以规则为准并改写措辞；
 *  4. 未配置 LLM → degraded:true，纯规则批语。
 */
import type { StrokeAnalysis, StrokeMetrics, RuleFinding } from './strokeAnalyzer.ts';
import type { ColorStats, CrossCheckResult } from './colorAnalyzer.ts';
import type { VLResult } from './vision.ts';
import { pickAssignment, type Assignment } from './assignments.ts';

export type Verdict = 'good' | 'ok' | 'needs-work';

export interface ReviewSection {
  key: string;
  title: string;
  verdict: Verdict;
  comment: string;
  evidence: string[];
}

export interface ReviewMetrics {
  strokeCount: number;
  forceAvailable: boolean | null;
  avgForce: number | null;
  forceContrast: number | null;
  hatchAngleStdDeg: number | null;
  reworkRegions: number | null;
  earlyDetailRatio: number | null;
  rhythmPauses: number | null;
  completion: number | null;
  hueBuckets: number[] | null;
  avgSaturation: number | null;
  avgValue: number | null;
  warmRatio: number | null;
  neutralRatio: number | null;
  dominantColors: { hex: string; ratio: number }[] | null;
}

export interface ReviewResponse {
  ok: boolean;
  reviewId: string;
  createdAt: string;
  imageUrl: string | null;
  summary: string;
  scores: { shape: number; value: number; line: number; completeness: number };
  sections: ReviewSection[];
  metrics: ReviewMetrics;
  weaknesses: string[];
  nextAssignment: {
    id: string;
    title: string;
    goal: string;
    durationMin: number;
    referenceImageUrl: string | null;
  };
  degraded: boolean;
}

const clampScore = (v: number) => Math.round(Math.min(100, Math.max(0, v)));

/** VL 分 + 规则分加权融合（规则只对有数据的维度出手） */
function fuseScores(vl: VLResult | null, m: StrokeMetrics): ReviewResponse['scores'] {
  const base = vl
    ? { shape: vl.shape, value: vl.value, line: vl.line, completeness: vl.completeness }
    : { shape: 60, value: 55, line: 60, completeness: 50 };
  const out = { ...base };
  if (m.hatchAngleStdDeg !== null) {
    const ruleLine = Math.min(95, Math.max(35, 95 - m.hatchAngleStdDeg));
    out.line = 0.5 * out.line + 0.5 * ruleLine;
  }
  if (m.forceAvailable && m.forceContrast !== null) {
    const ruleValue = Math.min(95, Math.max(30, 40 + m.forceContrast * 180));
    out.value = 0.5 * out.value + 0.5 * ruleValue;
  }
  if (m.completion !== null) {
    out.completeness = 0.6 * out.completeness + Math.min(40, m.completion * 160);
  }
  if ((m.reworkRegions ?? 0) >= 6) out.shape -= 6; // 反复涂改通常意味着造型没吃准
  return {
    shape: clampScore(out.shape),
    value: clampScore(out.value),
    line: clampScore(out.line),
    completeness: clampScore(out.completeness),
  };
}

/** 证据校验：VL 说"明暗不足"但规则 forceContrast 很高 → 以规则为准改判 */
function validateVLSections(
  vlSections: ReviewSection[],
  m: StrokeMetrics
): ReviewSection[] {
  return vlSections.map((s) => {
    if (s.key === 'value' && s.verdict === 'needs-work' && m.forceAvailable && (m.forceContrast ?? 0) >= 0.2) {
      return {
        ...s,
        verdict: 'ok' as const,
        comment: `${s.comment}（笔迹数据显示暗/亮压感差 ${m.forceContrast!.toFixed(2)}，已达标准；图像观感偏灰可能是拍照/导出原因，此处以笔迹数据为准）`,
        evidence: [...s.evidence, 'rule:override-value'],
      };
    }
    return s;
  });
}

function ruleSummary(findings: RuleFinding[], m: StrokeMetrics, degraded: boolean): string {
  if (findings.length === 0) {
    return degraded
      ? '未配置视觉模型，本次仅按笔迹过程指标给出规则批语：过程数据无异常项，请继续按课程推进。'
      : '过程数据无异常项。';
  }
  const main = findings.find((f) => f.verdict === 'needs-work') ?? findings[0]!;
  const extra =
    m.strokeCount > 0 ? `本次共 ${m.strokeCount} 笔` : '';
  return `${main.comment}${extra ? `，${extra}。` : ''}`;
}

export interface BuildReviewInput {
  reviewId: string;
  createdAt: string;
  imageUrl: string | null;
  vl: VLResult | null;
  stroke: StrokeAnalysis;
  color: ColorStats | null;
  crossCheck: CrossCheckResult | null;
  lastTaskId: string | null;
}

export function buildReview(input: BuildReviewInput): ReviewResponse {
  const { vl, stroke, color } = input;
  const m = stroke.metrics;
  const degraded = vl === null;

  // sections = 校验后的 VL 定性段 + 规则过程段（规则在后，数值解释权在规则）
  const vlSections: ReviewSection[] = (vl?.sections ?? []).map((s) => ({
    key: s.key,
    title: s.title,
    verdict: s.verdict,
    comment: s.comment,
    evidence: [`vl:${s.key}`],
  }));
  const ruleSections: ReviewSection[] = stroke.findings.map((f) => ({
    key: f.key,
    title: f.title,
    verdict: f.verdict,
    comment: f.comment,
    evidence: f.evidence,
  }));
  const sections = [...validateVLSections(vlSections, m), ...ruleSections];

  // weaknesses：needs-work 段的标题（去重、保序）——给档案页做词频聚合
  const weaknesses: string[] = [];
  for (const s of sections) {
    if (s.verdict === 'needs-work' && !weaknesses.includes(s.title)) weaknesses.push(s.title);
  }

  const next: Assignment = pickAssignment(
    [...stroke.findings.flatMap((f) => f.evidence), ...weaknesses],
    input.lastTaskId
  );

  return {
    ok: true,
    reviewId: input.reviewId,
    createdAt: input.createdAt,
    imageUrl: input.imageUrl,
    summary: degraded ? ruleSummary(stroke.findings, m, true) : vl!.summary,
    scores: fuseScores(vl, m),
    sections,
    metrics: {
      strokeCount: m.strokeCount,
      forceAvailable: m.forceAvailable,
      avgForce: m.avgForce,
      forceContrast: m.forceContrast,
      hatchAngleStdDeg: m.hatchAngleStdDeg,
      reworkRegions: m.reworkRegions,
      earlyDetailRatio: m.earlyDetailRatio,
      rhythmPauses: m.rhythmPauses,
      completion: m.completion,
      hueBuckets: color?.hueBuckets ?? null,
      avgSaturation: color?.avgSaturation ?? null,
      avgValue: color?.avgValue ?? null,
      warmRatio: color?.warmRatio ?? null,
      neutralRatio: color?.neutralRatio ?? null,
      dominantColors: color?.dominantColors ?? null,
    },
    weaknesses,
    nextAssignment: {
      id: next.id,
      title: next.title,
      goal: next.goal,
      durationMin: next.durationMin,
      referenceImageUrl: null, // 路由层补绝对 URL
    },
    degraded,
  };
}
