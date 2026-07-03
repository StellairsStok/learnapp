// 静态站的"虚拟后端":页面照旧调 getJSON/postJSON/streamChat,这里在浏览器本地执行,
// AI 调用直连中转平台。取代原来打到 Node 服务器的 fetch。
import { MODEL } from "../config";
import { runChat } from "../engine/chat";
import { getTree } from "../engine/content";
import { gradeAnswer, nextQuestion, questionMeta, stats } from "../engine/practice";
import { getStudent, resetStudent, saveStudent, type Student } from "../engine/store";
import { studentSignals } from "../engine/studentModel";
import type { Chip } from "./types";

// —— 访问码(静态站:每浏览器一个档案,码仅作显示;跨设备无法同步)——
export function studentCode(): string {
  let c = localStorage.getItem("stellairs-code");
  if (!c) { c = "s" + Math.random().toString(36).slice(2, 8); localStorage.setItem("stellairs-code", c); }
  return c;
}
export function setStudentCode(code: string): void {
  localStorage.setItem("stellairs-code", code);
}

function publicStudent(s: Student) {
  const { chat, ...rest } = s;
  void chat;
  return rest;
}

function parseQuery(url: string): URLSearchParams {
  const q = url.indexOf("?");
  return new URLSearchParams(q >= 0 ? url.slice(q + 1) : "");
}

/** GET 路由 */
export async function getJSON<T>(url: string): Promise<T> {
  const path = url.split("?")[0];
  const p = parseQuery(url);
  switch (path) {
    case "/api/health":
      return { ok: true, provider: "anthropic", model: MODEL, hasKey: true } as T;
    case "/api/content/tree": {
      const tree = await getTree();
      if (!tree) throw new Error("知识树加载失败");
      return tree as T;
    }
    case "/api/questions/stats":
      return (await stats()) as T;
    case "/api/student":
      return publicStudent(getStudent()) as T;
    case "/api/student/model": {
      const s = getStudent();
      return { signals: await studentSignals(s), notes: s.teacherNotes?.text ?? null, notesUpdatedAt: s.teacherNotes?.updatedAt ?? null } as T;
    }
    case "/api/chat/history":
      return { chat: getStudent().chat } as T;
    case "/api/questions/meta":
      return (await questionMeta(p.get("qid") ?? "")) as T;
    case "/api/practice/next":
      return (await nextQuestion(p)) as T;
    default:
      throw new Error("未知接口: " + path);
  }
}

/** POST 路由 */
export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const path = url.split("?")[0];
  switch (path) {
    case "/api/student/profile": {
      const s = getStudent();
      const b = (body ?? {}) as Record<string, unknown>;
      for (const k of ["newConcept", "onWrong", "practice"] as const) {
        if (k in b) {
          (s.styleProfile as unknown as Record<string, unknown>)[k] = b[k];
          s.styleLog.push({ at: new Date().toISOString(), change: `${k}=${b[k]}(设置页修改)` });
        }
      }
      saveStudent(s);
      return publicStudent(s) as T;
    }
    case "/api/student/reset":
      return publicStudent(resetStudent()) as T;
    case "/api/practice/answer": {
      const b = body as { qid: string; given: string[] };
      const r = await gradeAnswer(b.qid, b.given);
      if (r.error) throw new Error(r.error);
      return r as T;
    }
    default:
      throw new Error("未知接口: " + path);
  }
}

export interface StreamHandlers {
  onMeta?: (mode: string, modeName: string, chips?: Chip[], kpName?: string) => void;
  onDelta?: (text: string) => void;
  onDone?: () => void;
}

/** 对话:本地编排 + 直连大脑流式 */
export async function streamChat(
  body: { message: string; kp?: string | null; q?: string | null; qid?: string | null },
  h: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await runChat(body, { onMeta: h.onMeta, onDelta: h.onDelta }, signal);
  } finally {
    h.onDone?.();
  }
}
