/** 极简 .env 加载器：从 server/.env 读本地密钥（不入库、不覆盖已存在的环境变量）。
 *  无 .env 或读取失败时静默忽略，不影响确定性兜底路径。
 *  显式调用（由 config.ts 在读取环境变量前触发），不再是 import 副作用。 */
import fs from 'node:fs';
import path from 'node:path';

const ENV_FILE = path.resolve(import.meta.dirname, '.env');

export function loadEnv(): void {
  try {
    const text = fs.readFileSync(ENV_FILE, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const key = m[1]!;
      const raw = m[2] ?? '';
      if (process.env[key] == null) {
        process.env[key] = raw.replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* 没有 .env 时正常走环境变量 / ~/.pi/agent/models.json 兜底 */
  }
}
