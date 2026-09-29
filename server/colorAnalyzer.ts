/**
 * colorAnalyzer —— 服务端用 sharp 对上传 PNG 复算一份色彩统计，
 * 与 iPad 端 CoreGraphics 的结果互证（差异 > 5% 记日志，以后端为准）。
 * 算法口径与前端 ColorAnalyzer 完全一致（spec 8.2）：
 *   64×64 采样 / HSV / 12 个 30° 色相桶 / 暖色 h≥0.917||h≤0.25 / 近灰 s<0.10 / 跳过 v<0.05。
 */

export interface DominantColor {
  hex: string;
  ratio: number;
}

export interface ColorStats {
  version: number;
  sampleSize: number;
  hueBuckets: number[]; // 12 桶
  avgSaturation: number;
  avgValue: number;
  warmRatio: number;
  neutralRatio: number;
  dominantColors: DominantColor[];
}

const round = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;

function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    if (h < 0) h += 6;
    h /= 6;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

/** 从 64×64 RGB 原始像素算 ColorStats（与服务端/iOS 共用口径的纯函数） */
export function colorStatsFromRawRGB(raw: Uint8Array, n: number): ColorStats | null {
  const hue = new Array<number>(12).fill(0);
  let sSum = 0;
  let vSum = 0;
  let warm = 0;
  let neutral = 0;
  let total = 0;
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  let nonWhite = 0;

  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i]! / 255;
    const g = raw[i + 1]! / 255;
 const b = raw[i + 2]! / 255;
    const [h, s, v] = rgb2hsv(r, g, b);
    if (v > 0.92 && s < 0.1) continue; // 跳过纸面白（HSV 的 v 是亮度，白纸 v≈1）
    total++;
    sSum += s;
    vSum += v;
    if (s >= 0.15) {
      // 灰像素色相无意义，只有彩色像素计入色相桶
      const hIdx = Math.min(11, Math.floor(h * 12));
      hue[hIdx] = (hue[hIdx] ?? 0) + 1;
    }
    if (s < 0.1) neutral++;
    if (h >= 0.917 || h <= 0.25) warm++;
    // 主色：3bit/通道量化（8³=512 桶），跳过近白
    if (!(v > 0.92 && s < 0.1)) {
      nonWhite++;
      const q = (x: number) => Math.min(7, Math.floor(x * 8));
      const k2 = (q(r) << 6) | (q(g) << 3) | q(b);
      const cur = bins.get(k2) ?? { count: 0, r: 0, g: 0, b: 0 };
      cur.count++;
      cur.r += r;
      cur.g += g;
      cur.b += b;
      bins.set(k2, cur);
    }
  }
  if (total === 0) return null;

  const dominant = [...bins.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((c) => {
      const r = Math.round((c.r / c.count) * 255);
      const g = Math.round((c.g / c.count) * 255);
      const b = Math.round((c.b / c.count) * 255);
      return { hex: `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`, ratio: round(c.count / Math.max(1, nonWhite)) };
    });

  return {
    version: 1,
    sampleSize: n,
    hueBuckets: hue,
    avgSaturation: round(sSum / total),
    avgValue: round(vSum / total),
    warmRatio: round(warm / total),
    neutralRatio: round(neutral / total),
    dominantColors: dominant,
  };
}

/** PNG → 服务端 ColorStats（sharp 降采样 64×64） */
export async function colorStatsFromPng(png: Buffer, n = 64): Promise<ColorStats | null> {
  const sharp = (await import('sharp')).default;
  const { data } = await sharp(png, { failOn: 'none' })
    .removeAlpha()
    .resize(n, n, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return colorStatsFromRawRGB(new Uint8Array(data), n);
}

export interface CrossCheckResult {
  ok: boolean;
  diffs: { field: string; client: number; server: number; relDiff: number }[];
}

/** 前后端色彩统计互证：warmRatio / avgSaturation / avgValue 相对差 > 5% 视为不一致（以后端为准） */
export function crossCheckColor(client: ColorStats | null, server: ColorStats | null): CrossCheckResult {
  if (!client || !server) return { ok: true, diffs: [] };
  const fields: (keyof ColorStats)[] = ['warmRatio', 'avgSaturation', 'avgValue', 'neutralRatio'];
  const diffs: CrossCheckResult['diffs'] = [];
  for (const f of fields) {
    const c = client[f] as number;
    const s = server[f] as number;
    const relDiff = Math.abs(c - s) / Math.max(0.01, Math.abs(s));
    if (relDiff > 0.05) diffs.push({ field: String(f), client: c, server: s, relDiff: round(relDiff, 4) });
  }
  if (diffs.length > 0) console.warn('[color] 前后端色彩统计差异 >5%（以服务端为准）：', diffs);
  return { ok: diffs.length === 0, diffs };
}
