// 教学模式层(客户端):模式由内容状态×学生偏好的矩阵决定。取代原 server/lib/pedagogy.ts。
import { getBeats, getFigures, getKnowledgeCard, getKpMap, getPedagogyInject, getPersonaInject } from "./content";
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

const TEACHING_QUALITY = `【小步教学法——这是讲课方式的铁律】
你不是在"播讲义",是在一对一带学生。节奏永远是:讲一小步 → 用一个小问题收口 → 等学生回应 → 再进下一步。
- 每轮回复只推进一小步(一到两个微知识点),篇幅短;绝对禁止把整个考点一口气讲完、禁止一次抛出全部公式。
- 每轮结尾必须落在一个具体的检查问题上(让学生复述、判断或算一小步),不要用"明白了吗"这种空问。
- 学生答对→一句具体的肯定(点出他对在哪),进下一步;答错→先用引导修复补断点,修好再前进;学生连续轻松答对→可以合并加速,但检查不能省。
- 开课(学生刚选中考点)只用三四句话开场:这节课要拿下什么、高考怎么考它、大概分几步——然后直接进第一步,不要报菜单式罗列全部内容。
- 公式出场时要"讲活":物理意义、成立条件、符号单位,一次只立一个公式。
- 有配图就用:讲到对应内容时插入下方列出的真实配图,不要只用文字描述图形;没有配图就用文字把图景讲清楚,不要凭空编图。
- 口语、像面对面;可以用"来""你看""注意"这类口头语,不写教科书腔。`;

// 微知识点清单:小步教学的骨架。有清单时按清单逐条落实;从对话历史自行判断进度。
async function beatsGuideFor(kpId: string | null | undefined): Promise<string | null> {
  if (!kpId) return null;
  const beats = await getBeats(kpId);
  if (!beats || beats.length === 0) return null;
  const rows = beats
    .map((b) => `${b.n}. ${b.point}\n   检查:${b.check}${b.trap ? `\n   易错:${b.trap}` : ""}`)
    .join("\n");
  return `【本考点必须逐条落实的微知识点清单(只给你看,不要展示给学生)】
${rows}

清单用法:
- 这是这节课的行军路线:按序号逐条教,每条就是一小步,讲完用该条"检查"收口。
- 从对话历史判断已经落实到第几条,接着往下,不要从头重复;学生已答对的检查不再重问。
- 学生的提问若跳到了后面的条目,可以先答,但答完回到主线补齐中间的条目。
- 全部条目落实后:带学生做 1 分钟串联复盘(让他自己把主线复述一遍),然后按【课后出题】提议练题。`;
}

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
    const beatsGuide = await beatsGuideFor(kpId);
    if (beatsGuide) parts.push(beatsGuide);
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
