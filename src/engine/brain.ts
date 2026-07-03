// 大脑:浏览器直连中转平台的 Anthropic 兼容接口。取代原 server/providers/anthropic.ts。
import { MAX_TOKENS, MODEL, PROXY_KEY, PROXY_URL } from "../config";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | unknown[];
}
interface ProxyReq {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  stream?: boolean;
}

const HEADERS = {
  "content-type": "application/json",
  "x-api-key": PROXY_KEY,
  "anthropic-version": "2023-06-01",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 非流式:返回完整文本(用于写笔记等后台调用)。网络波动自动重试。 */
export async function callProxy(req: ProxyReq): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${PROXY_URL}/v1/messages`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ ...req, stream: false }),
      });
      if (!r.ok) throw new Error(`proxy ${r.status}`);
      const j = await r.json();
      const blocks: { type: string; text?: string }[] = j.content ?? [];
      return blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** 流式:逐段吐出文本 delta */
export async function* streamProxy(
  req: ProxyReq,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const r = await fetch(`${PROXY_URL}/v1/messages`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ ...req, stream: true }),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`proxy ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        const l = line.trim();
        if (!l.startsWith("data:")) continue;
        const payload = l.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            yield ev.delta.text as string;
          }
        } catch {
          /* 忽略脏行 */
        }
      }
    }
  }
}

/** 取题图并转 base64(视觉读题用) */
export async function imageToBase64(imgUrl: string): Promise<{ data: string; mediaType: string }> {
  const r = await fetch(imgUrl);
  const blob = await r.blob();
  const mediaType = blob.type || (imgUrl.endsWith(".webp") ? "image/webp" : "image/png");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return { data, mediaType };
}

export { MODEL, MAX_TOKENS };
