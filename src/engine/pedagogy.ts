// 教学模式层(客户端):模式由内容状态×学生偏好的矩阵决定。取代原 server/lib/pedagogy.ts。
import { getFigures, getKnowledgeCard, getKpMap, getPedagogyInject, getPersonaInject } from "./content";
import { hasPracticeFor } from "./practice";
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

const TEACHING_QUALITY = `【把这节课讲好的要求】
- 先点破再展开:开头用一句话或一个图景点破这个考点的核心,别一上来堆公式。
- 公式要"讲活":每个公式都说清它的物理意义、成立条件、符号与单位约定,而不是只写出来。
- 有配图就用:若下方列出了本考点的真实配图,在讲到对应内容时插入,不要只用文字描述图形;没有配图时用文字把图景讲清楚即可,不要凭空编图。
- 举一个最小的具体例子走一遍,并就着易错点指出这里最容易踩的坑。
- 边讲边验:讲完一小节,用一个简短问题检查学生是否真懂(让他用自己的话复述,或做一步),再往下走——不要一口气讲到底。
- 口语、简洁、像面对面讲题;分点清楚,但不写成教科书。`;

const PRACTICE_OFFER = `【课后出题】当这个考点讲清楚、且学生看起来跟上了,主动提议练一道("要不要拿一道题练练手?我挑一道跟这节课对得上的")。你只需口头提出——学生点"做一道相关的题"后,程序会从题库挑一道匹配题、以图片形式呈现,你届时再据此带他做。若学生正在作答你出的练习题:先肯定做对的部分,精准指出错在哪一步、只补断的那一环,再让他自己重走一遍;不要一上来直接报标准答案。`;

const PRACTICE_OFFER_NO_BANK = `【课后检查】本考点题库暂时没有配套练习题,不要提议"从题库挑题"。这节课收尾时,自己出 1 道贴合本考点、难度适中的原创小题(选择或简答)当堂检查,学生答完按引导修复讲评;并提醒学生这道题是你现编的、非讲义真题。`;

// 概念配图:列出与当前考点相关的真实配图,让 AI 需要时插入(只用给定的图,不要自己画/描述图形)。
async function figureGuideFor(kpId: string | null | undefined): Promise<string | null> {
  const figs = await getFigures();
  if (figs.length === 0) return null;
  const kp = kpId ? (await getKpMap()).get(kpId) : null;
  const hay = kp ? `${kp.name} ${kp.formulas.join(" ")} ${kp.pitfalls.join(" ")}` : "";
  const relevant = figs.filter(
    (f) => (kpId && f.kps.includes(kpId)) || f.keywords.some((k) => hay.includes(k)),
  );
  if (relevant.length === 0) return null;
  const list = relevant.map((f) => `- \`${f.id}\`:${f.caption}`).join("\n");
  return `【可用配图(真实教材/真题里的标准图)】\n讲到相关内容时,需要展示图就单独用一行代码块插入图 id,程序会显示对应真实图片:\n\`\`\`figure\n图id\n\`\`\`\n不要自己用文字描述图形、更不要凭空画图;只用下面列出的图,别编造不存在的 id:\n${list}`;
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
    parts.push(TEACHING_QUALITY);
    const figGuide = await figureGuideFor(kpId);
    if (figGuide) parts.push(figGuide);
    parts.push((await hasPracticeFor(kpId)) ? PRACTICE_OFFER : PRACTICE_OFFER_NO_BANK);
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
