/**
 * 配置加载 —— config.json 放端口/数据目录/模型名；密钥只走环境变量或
 * ~/.pi/agent/models.json（opencode-luna），绝不入库。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './env.ts';

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)));

export interface AppConfig {
  port: number;
  dataDir: string; // ~ 开头会展开为 $HOME
  llm: {
    baseUrl: string;
    api: 'openai-compatible';
    textModel: string;
    visionModel: string;
  };
}

const raw = JSON.parse(readFileSync(resolve(SERVER_DIR, 'config.json'), 'utf8')) as AppConfig;

export const config: AppConfig = {
  ...raw,
  dataDir: raw.dataDir.replace(/^~(?=$|\/)/, process.env.HOME ?? ''),
};

/** 读 pi 模型配置里 opencode-luna provider 的 apiKey（密钥不进 git / 构建产物）。 */
function opencodeLunaApiKey(): string {
  const home = process.env.HOME ?? '';
  for (const p of [join(home, '.pi', 'agent', 'models.json'), join(home, '.pi', 'models.json')]) {
    try {
      const j = JSON.parse(readFileSync(p, 'utf8')) as {
        providers?: Record<string, { apiKey?: string }>;
      };
      const key = j?.providers?.['opencode-luna']?.apiKey;
      if (key) return key;
    } catch {
      /* 文件不存在/解析失败，尝试下一个 */
    }
  }
  return '';
}

/**
 * LLM 网关密钥。优先级：LLM_API_KEY 环境变量 > GLM_API_KEY（兼容旧名）>
 * ~/.pi/agent/models.json 的 opencode-luna apiKey。
 * PENCIL_NO_LLM=1 可强制禁用（调试降级路径）。
 */
export const LLM_API_KEY =
  process.env.PENCIL_NO_LLM === '1'
    ? ''
    : (process.env.LLM_API_KEY ?? process.env.GLM_API_KEY ?? opencodeLunaApiKey());

export const LLM_BASE_URL = process.env.LLM_BASE_URL ?? config.llm.baseUrl;

export const SERVER_DIR_PATH = SERVER_DIR;
