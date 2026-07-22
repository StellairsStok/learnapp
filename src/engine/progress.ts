// 学习动力引擎:会遗忘的掌握度、间隔复习排期、连续学习天数、今日计划。
// 设计原则:简单、可解释、诚实——不搞黑箱算法,每个数字学生都能理解。
import { EXAM_DATE } from "../config";
import { getTree } from "./content";
import type { MasteryEntry, Student } from "./store";

/** 本地日期 YYYY-MM-DD(中国时区语义,避免 UTC 跨日错位) */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 掌握度分数 [0,1]:答题正确率(拉普拉斯平滑)× 样本置信 + 讲课加成,再按遗忘曲线衰减。
 * 只讲过没练过 ≈ 0.4("学过但未验证");久不碰会向 0.3(不确定)回归,半衰期约 3 周。
 */
export function masteryScore(m: MasteryEntry | undefined, now = Date.now()): number {
  if (!m) return 0;
  const taught = m.taught ?? 0;
  if (m.seen === 0 && taught === 0) return 0;
  const base = m.seen > 0 ? (m.correct + 1) / (m.seen + 2) : 0.4;
  const conf = Math.min(1, (m.seen + taught * 0.5) / 5);
  const raw = 0.3 + (base - 0.3) * conf + Math.min(0.1, taught * 0.03);
  const lastMs = Date.parse(m.lastAt || m.lastTaughtAt || "") || now;
  const days = Math.max(0, (now - lastMs) / 86400000);
  const decay = Math.exp(-days / 30);
  return Math.max(0, Math.min(1, 0.3 + (raw - 0.3) * decay));
}

export type Level = "none" | "learning" | "weak" | "solid";
export function masteryLevel(m: MasteryEntry | undefined, now = Date.now()): Level {
  if (!m || (m.seen === 0 && !(m.taught ?? 0))) return "none";
  if (m.seen > 0 && m.wrong > m.correct) return "weak";
  const s = masteryScore(m, now);
  if (s >= 0.7 && m.correct >= 3) return "solid";
  return "learning";
}

/** 间隔复习排期(SM-2 简化版):对了间隔翻倍(1→3→6→12→24→30天封顶),错了回到 1 天。 */
export function scheduleReview(m: MasteryEntry, correct: boolean, now = Date.now()): void {
  if (correct) {
    m.reps = (m.reps ?? 0) + 1;
    m.intervalDays = m.reps === 1 ? 1 : m.reps === 2 ? 3 : Math.min(30, (m.intervalDays ?? 3) * 2);
  } else {
    m.reps = 0;
    m.intervalDays = 1;
  }
  m.dueAt = new Date(now + m.intervalDays * 86400000).toISOString();
}

/** 讲课留痕:讲过一轮就"点亮"这个考点,并排一次 2 天后的首轮复习。 */
export function touchTaught(s: Student, kpId: string, now = Date.now()): void {
  const m: MasteryEntry = s.mastery[kpId] ?? { seen: 0, correct: 0, wrong: 0, lastAt: "" };
  m.taught = (m.taught ?? 0) + 1;
  m.lastTaughtAt = new Date(now).toISOString();
  if (!m.dueAt) {
    m.intervalDays = 2;
    m.dueAt = new Date(now + 2 * 86400000).toISOString();
  }
  s.mastery[kpId] = m;
}

/** 连续学习天数:当天首次有效学习(讲课轮/判题)时 +1;隔天清零重计。 */
export function touchStreak(s: Student): void {
  const today = localDate();
  const st = s.streak ?? { last: "", days: 0 };
  if (st.last === today) return;
  const y = localDate(new Date(Date.now() - 86400000));
  st.days = st.last === y ? st.days + 1 : 1;
  st.last = today;
  s.streak = st;
}

/** 到期待复习的考点 id(按逾期程度排序) */
export function dueKpIds(s: Student, now = Date.now()): string[] {
  return Object.entries(s.mastery)
    .filter(([, m]) => m.dueAt && Date.parse(m.dueAt) <= now)
    .sort((a, b) => Date.parse(a[1].dueAt!) - Date.parse(b[1].dueAt!))
    .map(([kp]) => kp);
}

/** 全书总掌握度 %(对树上全部考点取均值,没学过=0,诚实呈现) */
export async function overallMastery(s: Student, now = Date.now()): Promise<{ pct: number; total: number; touched: number }> {
  const tree = await getTree();
  const ids: string[] = [];
  for (const ch of tree?.chapters ?? []) for (const u of ch.units) for (const k of u.kps) ids.push(k.id);
  if (ids.length === 0) return { pct: 0, total: 0, touched: 0 };
  let sum = 0, touched = 0;
  for (const id of ids) {
    const sc = masteryScore(s.mastery[id], now);
    sum += sc;
    if (sc > 0) touched++;
  }
  return { pct: Math.round((sum / ids.length) * 100), total: ids.length, touched };
}

/** 距高考天数 */
export function examCountdown(now = new Date()): number {
  const exam = new Date(EXAM_DATE + "T00:00:00");
  return Math.max(0, Math.ceil((exam.getTime() - now.getTime()) / 86400000));
}

/** 今日计划:到期复习 + 待攻克错题 + 继续学,拼成一张能打完勾的小清单。 */
export interface DailyPlan {
  due: string[]; // 到期复习考点 id(最多5)
  mistakes: number; // 待攻克错题数
  continueKp: string | null; // 继续学的考点
  streakDays: number;
  examDays: number;
}
export function dailyPlan(s: Student): DailyPlan {
  const unresolved = s.mistakes.filter((m) => !m.resolvedAt).length;
  return {
    due: dueKpIds(s).slice(0, 5),
    mistakes: unresolved,
    continueKp: s.currentKp,
    streakDays: s.streak?.days ?? 0,
    examDays: examCountdown(),
  };
}
