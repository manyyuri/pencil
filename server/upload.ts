/**
 * multipart 上传 —— multer(memoryStorage) 收包：
 *   image (png, 必填) / strokes (json, 可选) / colorStats (json, 可选) / meta (text, 必填)
 * 文件都在内存里（≤2048px PNG + 抽稀后的笔迹 JSON，几 MB 量级），随后由 store.ts 落盘。
 */
import multer from 'multer';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024, files: 3, fields: 8 },
});

export const reviewUploadFields = [
  { name: 'image', maxCount: 1 },
  { name: 'strokes', maxCount: 1 },
  { name: 'colorStats', maxCount: 1 },
  { name: 'meta', maxCount: 1 },
] as const;

/** 从 multer 的 files 字典里安全取第一个文件（multer v2 的类型是 File[] | 字典 联合） */
export function firstFile(
  files: Record<string, Express.Multer.File[]> | Express.Multer.File[] | undefined,
  field: string
) {
  if (!files || Array.isArray(files)) return undefined;
  const arr = files[field];
  return arr && arr.length > 0 ? arr[0] : undefined;
}
