/**
 * 批改路由 —— 契约见 spec 第 5 节（契约是唯一事实来源，前端只认这里）。
 *   POST /api/critic/review        multipart: image + strokes? + colorStats? + meta
 *   GET  /api/critic/history       ?limit=20&cursor=<reviewId>
 *   GET  /api/critic/review/:id    单次批改详情（含 imageUrl）
 *   GET  /api/critic/review/:id/inkml   调试：笔迹 → InkML
 *   GET  /api/critic/assignment/:id     下一课任务详情
 */
import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { upload, reviewUploadFields, firstFile } from './upload.ts';
import { absPath, ensureDir, saveReviewFiles, listReviewIds, readJsonOrNull } from './store.ts';
import { grayMapFromPng, analyzeStrokes, type StrokesPayload, type GrayMap } from './strokeAnalyzer.ts';
import { colorStatsFromPng, crossCheckColor, type ColorStats } from './colorAnalyzer.ts';
import { safeVisionCall } from './vision.ts';
import { buildReview, type ReviewResponse } from './critique.ts';
import { getAssignment, ASSIGNMENTS } from './assignments.ts';
import { toInkML } from './inkml.ts';

export const reviewRouter = Router();

const metaSchema = z.object({
  appVersion: z.string().default(''),
  deviceModel: z.string().default(''),
  systemVersion: z.string().default(''),
  canvasSize: z.object({ width: z.number().positive(), height: z.number().positive() }),
  scale: z.number().positive().default(2),
  taskId: z.string().nullable().default(null),
  durationSec: z.number().min(0).default(0),
  startedAt: z.string().default(''),
  finishedAt: z.string().default(''),
});

function publicBase(req: Request): string {
  return `http://${req.get('host') ?? 'localhost'}`;
}

function newReviewId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
  return `rv_${stamp}_${randomBytes(2).toString('hex')}`;
}

function parseJsonPart<T>(buf: Buffer | undefined): T | null {
  if (!buf || buf.length === 0) return null;
  try {
    return JSON.parse(buf.toString('utf8')) as T;
  } catch (e) {
    console.warn('[review] JSON part 解析失败，忽略：', (e as Error).message);
    return null;
  }
}

// ---------- POST /review ----------

reviewRouter.post('/review', upload.fields(reviewUploadFields), async (req, res) => {
  const imageFile = firstFile(req.files, 'image');
  if (!imageFile) {
    res.status(400).json({ ok: false, error: '缺少 image（PNG）' });
    return;
  }

  let metaRaw: unknown;
  try {
    metaRaw = JSON.parse(typeof req.body.meta === 'string' ? req.body.meta : '{}');
  } catch {
    res.status(400).json({ ok: false, error: 'meta 不是合法 JSON' });
    return;
  }
  const meta = metaSchema.safeParse(metaRaw);
  if (!meta.success) {
    res.status(400).json({ ok: false, error: `meta 校验失败: ${meta.error.message.slice(0, 200)}` });
    return;
  }

  const strokesPayload = parseJsonPart<StrokesPayload>(firstFile(req.files, 'strokes')?.buffer);
  const clientColorStats = parseJsonPart<ColorStats>(firstFile(req.files, 'colorStats')?.buffer);
  const png = imageFile.buffer;

  // 确定性层：灰度图 + 笔迹指标 + 服务端色彩统计（与前端互证）
  const gray: GrayMap | null = await grayMapFromPng(png).catch(() => null);
  const stroke = analyzeStrokes(strokesPayload, gray);
  const serverColor = await colorStatsFromPng(png).catch(() => null);
  const crossCheck = crossCheckColor(clientColorStats, serverColor);

  // VL 层（可能慢 / 可能降级）
  const vl = await safeVisionCall(png);

  const reviewId = newReviewId();
  const createdAt = new Date().toISOString();
  const imageUrl = `${publicBase(req)}/assets/reviews/${reviewId}/canvas.png`;
  const review = buildReview({
    reviewId,
    createdAt,
    imageUrl,
    vl,
    stroke,
    color: serverColor,
    crossCheck,
    lastTaskId: meta.data.taskId,
  });
  // nextAssignment 的参考图绝对地址（有 refSvg 的任务才有底图）
  const next = getAssignment(review.nextAssignment.id);
  if (next?.refSvg) {
    review.nextAssignment.referenceImageUrl = `${publicBase(req)}/assets/refs/${next.id}.png`;
  }

  saveReviewFiles(reviewId, review, png, strokesPayload ? JSON.stringify(strokesPayload) : null);

  console.log(
    `[review] ${reviewId} | 笔数=${stroke.metrics.strokeCount} avgForce=${stroke.metrics.avgForce} ` +
      `forceContrast=${stroke.metrics.forceContrast} hatchStd=${stroke.metrics.hatchAngleStdDeg}° ` +
      `rework=${stroke.metrics.reworkRegions} earlyDetail=${stroke.metrics.earlyDetailRatio} ` +
      `degraded=${review.degraded}`
  );

  res.json(review);
});

// ---------- GET /history ----------

reviewRouter.get('/history', (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  const ids = listReviewIds();
  const start = cursor ? Math.max(0, ids.indexOf(cursor) + 1) : 0;
  const page = ids.slice(start, start + limit);
  const items = page
    .map((id) => readJsonOrNull<ReviewResponse>(absPath(`reviews/${id}/review.json`)))
    .filter((r): r is ReviewResponse => r !== null)
    .map((r) => ({
      reviewId: r.reviewId,
      createdAt: r.createdAt,
      summary: r.summary,
      scores: r.scores,
      thumbUrl: `${publicBase(req)}/assets/reviews/${r.reviewId}/canvas.png`,
    }));
  const nextCursor = start + limit < ids.length ? page[page.length - 1] : undefined;
  res.json({ ok: true, items, nextCursor });
});

// ---------- GET /review/:id ----------

reviewRouter.get('/review/:id', (req, res) => {
  const r = readJsonOrNull<ReviewResponse>(absPath(`reviews/${req.params.id}/review.json`));
  if (!r) {
    res.status(404).json({ ok: false, error: '没有这份批改记录' });
    return;
  }
  if (!r.imageUrl) r.imageUrl = `${publicBase(req)}/assets/reviews/${r.reviewId}/canvas.png`;
  const next = getAssignment(r.nextAssignment.id);
  if (next?.refSvg && !r.nextAssignment.referenceImageUrl) {
    r.nextAssignment.referenceImageUrl = `${publicBase(req)}/assets/refs/${next.id}.png`;
  }
  res.json(r);
});

// ---------- GET /review/:id/inkml（调试） ----------

reviewRouter.get('/review/:id/inkml', (req, res) => {
  const strokes = readJsonOrNull<StrokesPayload>(absPath(`reviews/${req.params.id}/strokes.json`));
  if (!strokes) {
    res.status(404).json({ ok: false, error: '该记录没有笔迹数据（可能是阶段1上传）' });
    return;
  }
  res.type('application/xml').send(toInkML(strokes));
});

// ---------- GET /assignment/:id ----------

reviewRouter.get('/assignment/:id', (req, res) => {
  const a = getAssignment(req.params.id);
  if (!a) {
    res.status(404).json({ ok: false, error: `没有任务 ${req.params.id}` });
    return;
  }
  res.json({
    ok: true,
    id: a.id,
    title: a.title,
    goal: a.goal,
    steps: a.steps,
    durationMin: a.durationMin,
    referenceImageUrl: a.refSvg ? `${publicBase(req)}/assets/refs/${a.id}.png` : null,
  });
});

// 任务总目录（App 端「档案」页可用）
reviewRouter.get('/assignments', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    items: ASSIGNMENTS.map((a) => ({ id: a.id, title: a.title, trains: a.trains, durationMin: a.durationMin })),
  });
});

// 启动时确保 refs 目录存在（index.ts 会生成参考图）
export function ensureRefsDir(): string {
  return ensureDir('refs');
}
