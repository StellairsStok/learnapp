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

const TEACHING_QUALITY = `【把这节课讲好的要求】
- 先点破再展开:开头用一句话或一个图景点破这个考点的核心,别一上来堆公式。
- 公式要"讲活":每个公式都说清它的物理意义、成立条件、符号与单位约定,而不是只写出来。
- 该画就画:关键的抽象关系用示意图画出来(见下面的画图能力),不要只用文字描述图形。
- 举一个最小的具体例子走一遍,并就着易错点指出这里最容易踩的坑。
- 边讲边验:讲完一小节,用一个简短问题检查学生是否真懂(让他用自己的话复述,或做一步),再往下走——不要一口气讲到底。
- 口语、简洁、像面对面讲题;分点清楚,但不写成教科书。`;

const PLOT_GUIDE = `【画图能力:你可以在讲课中直接插入示意图】
需要示意图时(p-V 图、p-1/V 图、V-T / p-T 图、分子力 F-r 图、分子势能 Ep-r 图、循环过程等),不要用文字描述图形、更不要画 ASCII——输出一个 \`\`\`plot 代码块,里面是 JSON 参数,程序会替你画成标准物理图(坐标轴、比例、箭头都由程序负责,你只填参数)。
字段:
- title / xlabel / ylabel:标题与轴名(轴名写量符号加单位,如 "V/L"、"p/atm")
- curves:曲线数组,每条二选一:
  · {"type":"isotherm","k":6,"label":"T一定"} 等温线 p=k/V(k 即 pV 常量)
  · {"type":"line","m":6,"b":0,"label":"..."} 直线 y=m·x+b(用于 p-1/V 过原点直线、V-T 图等)
  · {"type":"curve","smooth":true,"data":[[x,y],…],"label":"F"} 自定义采样点(F-r、Ep-r 等示意曲线)
  · 可加 "dashed":true、"color":"red|blue|teal|gold|purple"、"from"/"to" 限定 x 范围
- points:状态点,如 [{"x":1,"y":6,"label":"A"},{"x":3,"y":2,"label":"B"}]
- segments:过程箭头,如 [{"from":"A","to":"B"}](可用状态点标签或 [x,y];默认带箭头)
- shade:做功阴影,如 [{"points":[[1,6],[3,2]],"toAxis":true}](toAxis 把区域连到横轴,示意 p-V 面积=功)
- 可选 xmin/xmax/ymin/ymax(默认自动;正的量默认从 0 起)
例(玻意耳等温线,标 A、B 两点体现 pV=常量):
\`\`\`plot
{"title":"玻意耳定律 p-V 图","xlabel":"V/L","ylabel":"p/atm","curves":[{"type":"isotherm","k":6,"label":"T一定"}],"points":[{"x":1,"y":6,"label":"A"},{"x":3,"y":2,"label":"B"}]}
\`\`\`
例(同一气体 p-1/V 是过原点直线):
\`\`\`plot
{"title":"p-1/V 图","xlabel":"1/V (L⁻¹)","ylabel":"p/atm","curves":[{"type":"line","m":6,"b":0,"label":"斜率=pV"}]}
\`\`\`
只在示意图真能帮理解时才画,画完配一句话点明它在说明什么。`;

const PRACTICE_OFFER = `【课后出题】当这个考点讲清楚、且学生看起来跟上了,主动提议练一道("要不要拿一道题练练手?我挑一道跟这节课对得上的")。你只需口头提出——学生点"做一道相关的题"后,程序会从题库挑一道匹配题、以图片形式呈现,你届时再据此带他做。若学生正在作答你出的练习题:先肯定做对的部分,精准指出错在哪一步、只补断的那一环,再让他自己重走一遍;不要一上来直接报标准答案。`;

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
    parts.push(PLOT_GUIDE);
    parts.push(PRACTICE_OFFER);
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
