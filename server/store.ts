/**
 * 工作区存储 —— 无 DB，文件即数据库。
 * 1. 原子写：先写 .tmp 再 rename，进程崩溃不会留下半截 JSON；
 * 2. dataDir 下：reviews/<id>/{review.json,canvas.png,strokes.json} + refs/（参考图）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config.ts';

export function absPath(relPath: string): string {
  return join(config.dataDir, relPath);
}

export function ensureDir(relPath: string): string {
  const abs = absPath(relPath);
  if (!existsSync(abs)) mkdirSync(abs, { recursive: true });
  return abs;
}

/** 原子写任意文件（JSON / PNG 都走这条路） */
export function writeAtomic(abs: string, data: string | Buffer): void {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = abs + '.tmp';
  writeFileSync(tmp, data);
  renameSync(tmp, abs); // 同目录 rename = 原子操作
}

/** 读 JSON；不存在/损坏时返回 null（调用方决定 initial） */
export function readJsonOrNull<T>(abs: string): T | null {
  try {
    return JSON.parse(readFileSync(abs, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** 保存一份批改记录（review.json + canvas.png + strokes.json） */
export function saveReviewFiles(
  reviewId: string,
  reviewJson: unknown,
  png: Buffer,
  strokesJson: string | null
): void {
  const dir = ensureDir(join('reviews', reviewId));
  writeAtomic(join(dir, 'review.json'), JSON.stringify(reviewJson, null, 2));
  writeAtomic(join(dir, 'canvas.png'), png);
  if (strokesJson) writeAtomic(join(dir, 'strokes.json'), strokesJson);
}

export interface ReviewIndexEntry {
  reviewId: string;
  createdAt: string;
}

/** 列出所有 reviewId（按目录名），最新在前（reviewId 含时间戳，字典序≈时间序，再按 createdAt 校正） */
export function listReviewIds(): string[] {
  const dir = absPath('reviews');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();
}
