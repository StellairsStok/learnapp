import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { getKpMap } from "./content";
import { getStudent, saveStudent, type Student } from "./store";

// 直接读配置(不 import providers,避免 pedagogy↔providers 循环依赖)
function readConfig(): { provider: string; model: string; apiKey?: string; baseUrl?: string } {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "server", "config.json"), "utf-8"));
  } catch {
    return { provider: "mock", model: "claude-opus-4-8" };
  }
}

// 学生模型:老师维护的对学生的理解。三层——
//   ① 冷启动先验(三问,起点)  ② 客观信号(代码统计)  ③ 教学笔记(Stellairs 观察撰写)
// 核心思想:适配学生不是让学生填表,而是让老师在教学中观察、记录、修订。

const NOTES_EVERY = 6; // 每 N 个教学轮,老师课后写一次笔记

// ---------- 客观信号:代码自动统计,无需模型 ----------

export function studentSignals(s: Student): string {
  const lines: string[] = [];
  const kpMap = getKpMap();

  const answered = Object.keys(s.answers).length;
  if (answered > 0) {
    const correct = Object.values(s.answers).filter((a) => a.correct).length;
    lines.push(`已做 ${answered} 题,正确率 ${Math.round((correct / answered) * 100)}%`);
  }

  const weak: string[] = [];
  const solid: string[] = [];
  for (const [kpId, m] of Object.entries(s.mastery)) {
    const name = kpMap.get(kpId)?.name ?? kpId;
    if (m.wrong > m.correct) weak.push(name);
    else if (m.correct >= 4 && m.correct >= m.wrong * 3) solid.push(name);
  }
  if (weak.length) lines.push(`薄弱考点:${weak.slice(0, 6).join("、")}`);
  if (solid.length) lines.push(`已较稳:${solid.slice(0, 6).join("、")}`);

  if (s.mistakes.length) {
    const recent = s.mistakes.slice(0, 5).map((m) => m.label).join("、");
    lines.push(`近期错题 ${s.mistakes.length} 道,最近:${recent}`);
  }

  const p = s.styleProfile;
  const prefs: string[] = [];
  if (p.newConcept) prefs.push(p.newConcept === "listen" ? "新概念倾向先听讲" : "新概念倾向先试做");
  if (p.onWrong) prefs.push(p.onWrong === "explain" ? "错题要直讲" : "错题要引导");
  if (p.practice) prefs.push(p.practice === "drill" ? "偏好刷题快节奏" : "偏好精讲深抠");
  if (prefs.length) lines.push(`入学自述:${prefs.join("、")}`);

  return lines.length ? lines.join(";") : "(暂无学习数据)";
}

// ---------- 教学笔记:注入老师大脑的观察档案 ----------

export function teacherModelBlock(s: Student): string {
  const signals = studentSignals(s);
  const notes = s.teacherNotes?.text?.trim();
  const parts = [`【客观学情(系统统计)】\n${signals}`];
  if (notes) {
    parts.push(
      `【你的教学笔记(你在过往教学中对这名学生的观察,持续修订)】\n${notes}\n\n据此调整你的讲法、语气、节奏与切入点——像一个越来越懂这个学生的老师。`,
    );
  } else {
    parts.push(
      "【你的教学笔记】\n暂无——这名学生你还不熟。在教学中留意:哪种解释让他开窍、他常卡在哪类环节、他需要多少鼓励、是否会不懂装懂。这些观察系统会定期让你沉淀成笔记。",
    );
  }
  return parts.join("\n\n");
}

// ---------- 课后写笔记:老师观察最近这段教学,修订对学生的理解 ----------

const NOTE_WRITER_SYSTEM = `你是一位带过很多学生的物理特级教师 Stellairs,正在为一名学生更新你的私人教学笔记。这份笔记只有你看,用来记录"这个学生该怎么教",下次上课前你会重读它。

要求:
- 修订,不是堆砌:整合旧笔记与新观察,推翻被新证据否定的旧判断,合并重复项。整份笔记始终精炼(不超过 400 字)。
- 每条判断要有依据:基于对话里真实发生的事(他问了什么、卡在哪、什么解释让他懂了、是否装懂、情绪与投入度),不要凭空推测。
- 只写对"怎么教他"有用的:有效的解释方式/类比、反复出现的卡点、需要的鼓励程度、讲快讲慢、易不懂装懂的信号、知识漏洞。不要复述学过的考点清单(系统另有统计)。
- 用第二人称写给未来的自己(如"他对……类比反应好""讲到……要放慢,他会卡在符号")。
- 证据不足时,宁可少写也不编。只输出笔记正文,不要任何前后缀。`;

/** 异步写笔记:不阻塞对话响应。失败静默(不影响教学)。 */
export function maybeWriteNotes(code: string): void {
  const s = getStudent(code);
  if (s.turnsSinceNotes < NOTES_EVERY) return;
  s.turnsSinceNotes = 0; // 立即清零,防并发重复触发
  saveStudent(code, s);
  void writeNotes(code).catch((e) => console.error("[notes] 写笔记失败", e));
}

async function writeNotes(code: string): Promise<void> {
  const config = readConfig();
  if (config.provider !== "anthropic") return; // 只有真大脑通道才写笔记
  const apiKey = process.env.ANTHROPIC_API_KEY || config.apiKey;
  if (!apiKey) return;

  const s = getStudent(code);
  const transcript = s.chat
    .filter((c) => c.text && c.text !== "__start__")
    .slice(-18)
    .map((c) => `${c.role === "user" ? "学生" : "Stellairs"}:${c.text}`)
    .join("\n\n");
  if (!transcript.trim()) return;

  const client = new Anthropic({ apiKey, baseURL: process.env.ANTHROPIC_BASE_URL || config.baseUrl || undefined });
  const user = `【客观学情】\n${studentSignals(s)}\n\n【你现有的教学笔记】\n${s.teacherNotes?.text ?? "(还没有)"}\n\n【最近的教学对话】\n${transcript}\n\n请据此更新你的教学笔记。`;

  const r = await client.messages.create({
    model: config.model,
    max_tokens: 700,
    system: NOTE_WRITER_SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  const text = r.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) return;

  // 单例:直接写回同一对象
  const cur = getStudent(code);
  cur.teacherNotes = { updatedAt: new Date().toISOString(), text };
  saveStudent(code, cur);
  console.log(`[notes] 已为 ${code} 更新教学笔记(${text.length}字)`);
}
