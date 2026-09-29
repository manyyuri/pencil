/**
 * Express 入口 —— 监听 0.0.0.0，打印局域网地址（iPad 直连）。
 * /assets 托管工作区静态文件（作业 PNG / 参考图）。
 */
import express from 'express';
import os from 'node:os';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, LLM_API_KEY, LLM_BASE_URL } from './config.ts';
import { ensureDir } from './store.ts';
import { reviewRouter, ensureRefsDir } from './review.ts';
import { ASSIGNMENTS } from './assignments.ts';

const app = express();
app.disable('x-powered-by');

// 局域网跨域（iPad 直连场景）
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: '2mb' }));

app.use('/api/critic', reviewRouter);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    llm: !!LLM_API_KEY,
    gateway: LLM_BASE_URL,
    visionModel: config.llm.visionModel,
    dataDir: config.dataDir,
  });
});

// 工作区静态托管（作业 PNG / 参考图）
app.use('/assets', express.static(config.dataDir, { maxAge: '7d', immutable: true }));

// 统一错误出口（Express 5 自动把 async 抛错路由到这里）
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ ok: false, error: (err as Error)?.message ?? '服务内部错误' });
});

/** 启动时把带 refSvg 的任务光栅化为 refs/<id>.png（零素材文件依赖） */
async function ensureReferenceAssets(): Promise<void> {
  const dir = ensureRefsDir();
  for (const a of ASSIGNMENTS) {
    if (!a.refSvg) continue;
    const out = join(dir, `${a.id}.png`);
    if (existsSync(out)) continue;
    try {
      await sharp(Buffer.from(a.refSvg)).png().toFile(out);
      console.log(`[refs] 生成参考图 ${a.id}.png`);
    } catch (e) {
      console.warn(`[refs] ${a.id} 生成失败：`, (e as Error).message);
    }
  }
}

ensureDir('');
ensureReferenceAssets().then(() => {
  app.listen(config.port, '0.0.0.0', () => {
    const nets = Object.values(os.networkInterfaces())
      .flat()
      .filter((n) => n?.family === 'IPv4' && !n.internal);
    const lan = nets[0]?.address ?? '?';
    console.log(`
┌────────────────────────────────────────────────────┐
│  iPad 美术私教 · 批改后端  art-coach               │
├────────────────────────────────────────────────────┤
│  iPad App baseURL:  http://${lan}:${config.port}                │
│  工作区:            ${config.dataDir}  │
│  视觉模型:          ${LLM_API_KEY ? config.llm.visionModel : '⚠ 未配置 LLM key，纯规则降级可用'}  │
└────────────────────────────────────────────────────┘
  （把 ArtCoach/Config.swift 里的 baseURL 改成上面的局域网地址；
    远程访问：Mac 与 iPad 都开 Tailscale，用 100.x IP 访问同端口）
`);
  });
});
