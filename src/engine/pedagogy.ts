// 教学模式层(客户端):模式由内容状态×学生偏好的矩阵决定。取代原 server/lib/pedagogy.ts。
import { getKnowledgeCard, getKpMap, getPedagogyInject, getPersonaInject } from "./content";
import type { Student } from "./store";
import { teacherModelBlock } from "./studentModel";

export type Mode = "direct" | "guided-repair" | "socratic" | "drill" | "chat";

export const MODE_NAMES: Record<Mode, string> = {
  direct: "讲授模式",
  "guided-repair": "引导修复",
  socratic: "苏格拉底",
  drill: "刷题模式",
  chat: "自由对话",
};

export type ContentState = "new" | "weak" | "apply" | "solid";

export function masteryState(kpId: string | null | undefined, s: Student): ContentState {
  if (!kpId) return "apply";
  const m = s.mastery[kpId];
  if (!m || m.seen === 0) return "new";
  if (m.wrong > m.correct) return "weak";
  if (m.correct >= 4 && m.correct >= m.wrong * 3) return "solid";
  return "apply";
}

export function pickMode(state: ContentState, s: Student): Mode {
  const p = s.styleProfile;
  const base: Record<ContentState, Mode> = {
    new: "direct",
    weak: "guided-repair",
    apply: "socratic",
    solid: "drill",
  };
  let mode = base[state];
  if (mode === "guided-repair" && p.onWrong === "explain") mode = "direct";
  if (mode === "socratic" && p.onWrong === "explain") mode = "direct";
  if (mode === "drill" && p.practice === "deep") mode = "socratic";
  return mode; // new 时不覆盖:讲授是底线
}

/** 考点名净化:纯文本位置去掉 LaTeX 记号 */
export function plainName(name: string): string {
  return name.replace(/\\frac1V/g, "1/V").replace(/\\frac\{1\}\{V\}/g, "1/V").replace(/[$\\]/g, "");
}

export async function buildSystemPrompt(
  kpId: string | null | undefined,
  mode: Mode,
  s: Student,
): Promise<string> {
  const parts: string[] = [];

  const persona = await getPersonaInject();
  parts.push(persona ?? "你是 Stellairs,一位面向黑龙江省高三学生的高考物理私教。耐心、直接、不糊弄。");

  if (mode !== "chat") {
    const inject = await getPedagogyInject(mode);
    if (inject) parts.push(`【当前教学模式:${MODE_NAMES[mode]}】\n${inject}`);
  }

  if (kpId) {
    const card = await getKnowledgeCard(kpId);
    const kp = (await getKpMap()).get(kpId);
    if (card) {
      parts.push(`【当前知识点卡片(你的教学边界:严格按卡片内容与超纲边界教,卡片没写的方法不要教)】\n${card}`);
    } else if (kp) {
      parts.push(
        `【当前知识点:${kp.name}(${kpId})】\n核心公式:${kp.formulas.join(";")}\n易错点:${kp.pitfalls.join(";")}\n注意:该知识点的完整卡片尚未编写,讲课限制在高考范围内,不使用微积分等超纲方法。`,
      );
    }
  }

  parts.push(await teacherModelBlock(s));

  parts.push(
    "【硬性规则】所有数学公式用 $...$ 或 $$...$$ 的 LaTeX 书写;不聊与物理学习无关的话题(礼貌拉回);不确定的知识坦率承认,不要编造。",
  );

  return parts.join("\n\n");
}
