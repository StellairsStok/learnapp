import type { Chip } from "./types";

/** 学生访问码:一台设备一个码,档案按码分开存;换设备输入同一个码即可继续 */
export function studentCode(): string {
  let c = localStorage.getItem("stellairs-code");
  if (!c) {
    c = "s" + Math.random().toString(36).slice(2, 8);
    localStorage.setItem("stellairs-code", c);
  }
  return c;
}

export function setStudentCode(code: string): void {
  localStorage.setItem("stellairs-code", code);
}

function baseHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", "X-Student-Code": studentCode() };
}

export async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: baseHeaders() });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

export interface StreamHandlers {
  onMeta?: (mode: string, modeName: string, chips?: Chip[], kpName?: string) => void;
  onDelta?: (text: string) => void;
  onDone?: () => void;
}

/** POST /api/chat 的 SSE 读取器;传入 AbortSignal 可在路由切换/卸载时中断 */
export async function streamChat(
  body: { message: string; kp?: string | null; q?: string | null; qid?: string | null },
  h: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`chat → ${r.status}`);

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneFired = false;
  const fireDone = () => {
    if (!doneFired) {
      doneFired = true;
      h.onDone?.();
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data: ")) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        if (ev.type === "meta") h.onMeta?.(ev.mode, ev.modeName, ev.chips, ev.kpName);
        else if (ev.type === "delta") h.onDelta?.(ev.text);
        else if (ev.type === "done") fireDone();
      } catch {
        // 忽略脏行
      }
    }
  }
  fireDone();
}
