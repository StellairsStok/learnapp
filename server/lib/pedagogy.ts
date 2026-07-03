import { getKnowledgeCard, getKpMap, getPedagogyInject, getPersonaInject } from "./content";
import type { Student } from "./store";
import { teacherModelBlock } from "./student-model";

// 教学模式层:模式由「内容状态 × 学生偏好」的规则矩阵决定,不靠模型即兴发挥。
// 详见 docs/02-切片一-选必三热学.md 第二节。

export type Mode = "direct" | "guided-repair" | "socratic" | "drill" | "chat";

export const MODE_NAMES: Record<Mode, string> = {
  direct: "讲授模式",
  "guided-repair": "引导修复",
  socratic: "苏格拉底",
  drill: "刷题模式",
  chat: "自由对话",
};

export type ContentState = "new" | "weak" | "apply" | "solid";

/** 内容状态:来自掌握度记录 */
export function masteryState(kpId: string | null | undefined, s: Student): ContentState {
  if (!kpId) return "apply";
  const m = s.mastery[kpId];
  if (!m || m.seen === 0) return "new";
  if (m.wrong > m.correct) return "weak";
  if (m.correct >= 4 && m.correct >= m.wrong * 3) return "solid";
  return "apply";
}

/** 模式选择矩阵。注意:新概念的讲授本身不可被"猜谜"替代(不接受偏好覆盖为提问式)。 */
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
  // state === "new" 时不做覆盖:讲授模式是教学法底线
  return mode;
}

/** 组装 system prompt(anthropic / claude-cli 通道用):人设 + 策略卡 + 知识卡 + 学生画像 */
export function buildSystemPrompt(kpId: string | null | undefined, mode: Mode, s: Student): string {
  const parts: string[] = [];

  const persona = getPersonaInject();
  parts.push(persona ?? "你是 Stellairs,一位面向黑龙江省高三学生的高考物理私教。耐心、直接、不糊弄。");

  if (mode !== "chat") {
    const inject = getPedagogyInject(mode);
    if (inject) parts.push(`【当前教学模式:${MODE_NAMES[mode]}】\n${inject}`);
  }

  if (kpId) {
    const card = getKnowledgeCard(kpId);
    const kp = getKpMap().get(kpId);
    if (card) {
      parts.push(`【当前知识点卡片(你的教学边界:严格按卡片内容与超纲边界教,卡片没写的方法不要教)】\n${card}`);
    } else if (kp) {
      parts.push(
        `【当前知识点:${kp.name}(${kpId})】\n核心公式:${kp.formulas.join(";")}\n易错点:${kp.pitfalls.join(";")}\n注意:该知识点的完整卡片尚未编写,讲课限制在高考范围内,不使用微积分等超纲方法。`,
      );
    }
  }

  // 学生模型:客观学情 + 老师自己维护的教学笔记(取代原来的浅层偏好三选项)
  parts.push(teacherModelBlock(s));

  parts.push(
    "【硬性规则】所有数学公式用 $...$ 或 $$...$$ 的 LaTeX 书写;不聊与物理学习无关的话题(礼貌拉回);不确定的知识坦率承认,不要编造。",
  );

  return parts.join("\n\n");
}
