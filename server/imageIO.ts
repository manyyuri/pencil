/**
 * imageIO —— 位图适配层：本项目唯一 import sharp 的地方。
 *
 * 把「PNG → 灰度图 / 色彩统计 / VL 压缩图」这些 I/O 从纯分析模块里隔离出来，
 * 让 strokeAnalyzer / colorAnalyzer / vision 保持无位图库依赖（可单测、无副作用）。
 * 算法口径本身在纯函数里（completionFromGray / colorStatsFromRawRGB），本文件只解码。
 */
import sharp from 'sharp';
import type { GrayMap } from './strokeAnalyzer.ts';
import { colorStatsFromRawRGB, type ColorStats } from './colorAnalyzer.ts';

/** PNG Buffer → 64×64 灰度图（sharp 降采样） */
export async function grayMapFromPng(png: Buffer, n = 64): Promise<GrayMap> {
  const { data } = await sharp(png, { failOn: 'none' })
    .grayscale()
    .resize(n, n, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { n, data: new Uint8Array(data) };
}

/** PNG → ≤1280px JPEG data URL（隐私：云端只收压缩图；reasoning 视觉模型提速） */
export async function toDataUrl(png: Buffer): Promise<string> {
  const jpg = await sharp(png, { failOn: 'none' })
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

/** PNG → 服务端 ColorStats（sharp 降采样 64×64，口径与前端一致） */
export async function colorStatsFromPng(png: Buffer, n = 64): Promise<ColorStats | null> {
  const { data } = await sharp(png, { failOn: 'none' })
    .removeAlpha()
    .resize(n, n, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return colorStatsFromRawRGB(new Uint8Array(data), n);
}
