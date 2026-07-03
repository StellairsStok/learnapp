import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, MODE_NAMES } from "../lib/pedagogy";
import { getStudent } from "../lib/store";
import type { Brain, ProviderConfig } from "./types";

// anthropic 通道:正式大脑。创始人提供 API key 后,把 server/config.json 的
// provider 改为 "anthropic" 即启用(key 填 config.apiKey 或环境变量 ANTHROPIC_API_KEY)。

export function makeAnthropicBrain(config: ProviderConfig): Brain {
  return async function* (req) {
    const apiKey = process.env.ANTHROPIC_API_KEY || config.apiKey;
    yield { type: "meta", mode: req.mode, modeName: MODE_NAMES[req.mode] };

    if (!apiKey) {
      yield {
        type: "delta",
        text: "**API key 还没配置。** 把 key 填进 `server/config.json` 的 `apiKey` 字段(或设置环境变量 `ANTHROPIC_API_KEY`)并重启,我就能用真大脑和你上课了。临时想看流程演示的话,把 `provider` 改回 `\"mock\"`。",
      };
      return;
    }

    const baseURL = process.env.ANTHROPIC_BASE_URL || config.baseUrl || undefined;
    const client = new Anthropic({ apiKey, baseURL });
    const student = getStudent(req.code);
    const system = buildSystemPrompt(req.kpId, req.mode, student);

    // 历史清洗:去空消息;API 要求首条必须是 user,裁掉开头的 assistant 轮(如首次问候)
    const turns = req.history.filter((t) => t.text.trim().length > 0).slice(-30);
    while (turns.length > 0 && turns[0].role !== "user") turns.shift();

    // 讲题上下文:把题目截图作为视觉输入,随当前消息一起发(API 无状态,每轮都要带)
    const userContent: Anthropic.MessageParam["content"] = req.questionImage
      ? [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: req.questionImage.mediaType as "image/png" | "image/webp",
              data: req.questionImage.dataB64,
            },
          },
          {
            type: "text",
            text: `【当前正在讲的题目见上图。${req.questionImage.caption}】\n\n${req.message}`,
          },
        ]
      : req.message;

    const messages: Anthropic.MessageParam[] = [
      ...turns.map((t): Anthropic.MessageParam => ({ role: t.role, content: t.text })),
      { role: "user", content: userContent },
    ];

    try {
      const stream = client.messages.stream({
        model: config.model,
        max_tokens: config.maxTokens,
        system,
        messages,
      });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "delta", text: event.delta.text };
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      yield {
        type: "delta",
        text: `\n\n(连接大脑时出错了:${msg}。检查网络与 API key 后重试。)`,
      };
    }
  };
}
