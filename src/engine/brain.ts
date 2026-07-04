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

/** 带 HTTP 状态码的中转错误。让上层区分"限额用满(429)"和普通网络波动。 */
export class ProxyError extends Error {
  status: number;
  constructor(status: number) {
    super(`proxy ${status}`);
    this.name = "ProxyError";
    this.status = status;
  }
}

/** 非流式:返回完整文本(用于写笔记等后台调用)。网络波动自动重试;4xx(含 429 限额)不重试。 */
export async function callProxy(req: ProxyReq): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${PROXY_URL}/v1/messages`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ ...req, stream: false }),
      });
      if (!r.ok) throw new ProxyError(r.status);
      const j = await r.json();
      const blocks: { type: string; text?: string }[] = j.content ?? [];
      return blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    } catch (e) {
      lastErr = e;
      // 客户端错误(限额/鉴权)重试没意义,反而加重限额——直接抛出。
      if (e instanceof ProxyError && e.status >= 400 && e.status < 500) throw e;
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
  if (!r.ok) throw new ProxyError(r.status);
  if (!r.body) throw new Error("proxy no body");
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  // 空闲超时:中转平台偶尔连接开着(200)却迟迟不吐数据。超过 IDLE_MS 没有新数据就当失败,
  // 让上层进入重试/提示,而不是永远卡在"正在输入"。每收到一段数据就重置。
  const IDLE_MS = 30000;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("stream idle timeout")), IDLE_MS);
        }),
      ]);
    } catch (e) {
      try { await reader.cancel(); } catch { /* 已断开 */ }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const { done, value } = chunk;
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
