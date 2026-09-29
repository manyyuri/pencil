/**
 * VL 视觉层 —— 看 PNG 成品图，只做主观定性评价（造型/比例/明暗/透视/完成度）。
 *
 * 设计红线（spec 7.3）：LLM 绝不算数、不编造数值——它给的 0-100 分只作主观参考，
 * 线条数/时间/压感/色彩数值全部由 strokeAnalyzer / colorAnalyzer 的确定性代码给出。
 * 失败重试 1 次；再失败返回 null，走纯规则降级。
 *
 * 接缝：具体网关（OpenAI 兼容客户端）被 createVision 关在内部，对外只暴露
 * VisionFn 这一个人能力函数——未配 key 时直接返回恒定降级的实现，便于单测替换。
 */
import { z } from 'zod';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { config, LLM_API_KEY, LLM_BASE_URL } from './config.ts';
import { toDataUrl } from './imageIO.ts';

export const visionSchema = z.object({
  shape: z.number().min(0).max(100),
  value: z.number().min(0).max(100),
  line: z.number().min(0).max(100),
  completeness: z.number().min(0).max(100),
  summary: z.string().min(1),
  sections: z
    .array(
      z.object({
        key: z.enum(['shape', 'value', 'line', 'completeness']).catch('shape'),
        title: z.string(),
        verdict: z.enum(['good', 'ok', 'needs-work']),
        comment: z.string(),
      })
    )
    .max(6)
    .catch([]),
});
export type VLResult = z.infer<typeof visionSchema>;

/** 视觉能力端口：输入 PNG，输出定性批语；失败/未配置返回 null（调用方降级） */
export type VisionFn = (png: Buffer) => Promise<VLResult | null>;

export interface VisionOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const SYSTEM_PROMPT = `你是一位有二十年教学经验的素描老师。你会收到一张学生的画作（可能含色彩练习）。
请只评价你能从图像上看到的：整体造型与比例、明暗大关系、结构/透视、画面完成度。
不要猜测学生的绘画过程，不要编造任何数值（线条数量、时间、压感、颜色占比等都由规则层提供，你不知道也不要猜）。
语气：具体、克制、可执行，像私教在旁边说话，不写空话。
输出严格 JSON（不要 markdown 围栏）：
{ "shape": 0-100, "value": 0-100, "line": 0-100, "completeness": 0-100, "summary": "一句话总评",
  "sections": [ { "key": "shape|value|line|completeness", "title": "造型与比例", "verdict": "good|ok|needs-work", "comment": "具体点评" } ] }
verdict 含义：good=达标，ok=基本可以，needs-work=需要改进。sections 给 3-4 条。`;

/** 从 LLM 回复里稳健抠出 JSON（容忍 ```json 围栏与前后废话） */
function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1]! : text;
  const start = Math.min(
    ...['{', '['].map((c) => {
      const i = raw.indexOf(c);
      return i === -1 ? Infinity : i;
    })
  );
  if (!isFinite(start)) throw new Error('回复中无 JSON');
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * 装配一个视觉能力函数。
 * 未配 key → 恒定降级（永不联网）；配置了则返回真正的网关调用实现。
 * 任何失败都返回 null（调用方降级），绝不抛出影响主流程。
 */
export function createVision(opts: VisionOptions): VisionFn {
  if (!opts.apiKey) return async () => null;

  // opencode-luna 网关要求每次请求带 x-opencode-session（对齐 stylist-agent/server/llm.ts）
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseUrl,
    timeout: 120_000,
    defaultHeaders: { 'x-opencode-session': randomUUID() },
  });

  return async (png: Buffer): Promise<VLResult | null> => {
    try {
      const dataUrl = await toDataUrl(png);
      const content: unknown[] = [
        { type: 'text', text: SYSTEM_PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ];
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await client.chat.completions.create({
          model: opts.model,
          messages: [{ role: 'user', content } as never],
          max_tokens: 8192, // reasoning 模型：留足 token 给 content
          temperature: 0.2,
          thinking: { type: 'disabled' },
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
        const text = res.choices[0]?.message?.content ?? '';
        try {
          const parsed = visionSchema.safeParse(extractJSON(text));
          if (parsed.success) return parsed.data;
          lastErr = new Error(`vision schema 校验失败: ${parsed.error.message.slice(0, 200)}`);
        } catch (e) {
          lastErr = e;
        }
      }
      console.warn('[vision] 两次输出均未通过校验，降级：', lastErr);
      return null;
    } catch (e) {
      console.warn('[vision] 调用失败，降级：', (e as Error)?.message);
      return null;
    }
  };
}

/** 生产实例：由 config 装配，行为与重构前一致 */
export const safeVisionCall: VisionFn = createVision({
  apiKey: LLM_API_KEY,
  baseUrl: LLM_BASE_URL,
  model: config.llm.visionModel,
});
