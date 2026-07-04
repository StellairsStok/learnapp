// 学生模型(客户端):客观信号 + 老师维护的教学笔记。取代原 server/lib/student-model.ts。
import { MODEL, MAX_TOKENS } from "../config";
import { callProxy } from "./brain";
import { getKpMap } from "./content";
import { getStudent, saveStudent, type Student } from "./store";

const NOTES_EVERY = 6;

export async function studentSignals(s: Student): Promise<string> {
  const lines: string[] = [];
  const kpMap = await getKpMap();

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

export async function teacherModelBlock(s: Student): Promise<string> {
  const signals = await studentSignals(s);
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

const NOTE_WRITER_SYSTEM = `你是一位带过很多学生的物理特级教师 Stellairs,正在为一名学生更新你的私人教学笔记。这份笔记只有你看,用来记录"这个学生该怎么教",下次上课前你会重读它。

要求:
- 修订,不是堆砌:整合旧笔记与新观察,推翻被新证据否定的旧判断,合并重复项。整份笔记始终精炼(不超过 400 字)。
- 每条判断要有依据:基于对话里真实发生的事(他问了什么、卡在哪、什么解释让他懂了、是否装懂、情绪与投入度),不要凭空推测。
- 只写对"怎么教他"有用的:有效的解释方式/类比、反复出现的卡点、需要的鼓励程度、讲快讲慢、易不懂装懂的信号、知识漏洞。不要复述学过的考点清单(系统另有统计)。
- 用第二人称写给未来的自己(如"他对……类比反应好""讲到……要放慢,他会卡在符号")。
- 证据不足时,宁可少写也不编。只输出笔记正文,不要任何前后缀。`;

/** 课后异步写笔记:不阻塞对话。先归零计数以防并发重入,失败则恢复计数,下次教学轮再试。 */
export async function maybeWriteNotes(): Promise<void> {
  const s = getStudent();
  if (s.turnsSinceNotes < NOTES_EVERY) return;
  const pending = s.turnsSinceNotes;
  s.turnsSinceNotes = 0;
  saveStudent(s);
  try {
    await writeNotes();
  } catch (e) {
    // 写失败(网络/限额)不能把这批学情丢掉——恢复计数,下次达到阈值会再写一次。
    console.error("[notes] 写笔记失败,已恢复计数以便重试", e);
    const cur = getStudent();
    cur.turnsSinceNotes = Math.max(cur.turnsSinceNotes, pending);
    saveStudent(cur);
  }
}

async function writeNotes(): Promise<void> {
  const s = getStudent();
  const transcript = s.chat
    .filter((c) => c.text && c.text !== "__start__")
    .slice(-18)
    .map((c) => `${c.role === "user" ? "学生" : "Stellairs"}:${c.text}`)
    .join("\n\n");
  if (!transcript.trim()) return;

  const user = `【客观学情】\n${await studentSignals(s)}\n\n【你现有的教学笔记】\n${s.teacherNotes?.text ?? "(还没有)"}\n\n【最近的教学对话】\n${transcript}\n\n请据此更新你的教学笔记。`;

  const text = await callProxy({
    model: MODEL,
    max_tokens: 700,
    system: NOTE_WRITER_SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  if (!text.trim()) return;

  const cur = getStudent();
  cur.teacherNotes = { updatedAt: new Date().toISOString(), text: text.trim() };
  saveStudent(cur);
}

export { NOTES_EVERY, MAX_TOKENS };
