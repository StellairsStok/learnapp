// 对话编排引擎(客户端):三问初始化、章→单元→考点选课、偏好一句话调整、
// 真大脑讲课(流式)、视觉讲题、课后写笔记。取代原 server /api/chat。
import { MAX_TOKENS, MODEL } from "../config";
import { imageToBase64, streamProxy } from "./brain";
import { getCrops, getKpMap, getQuestionIndex, getTree, questionImageUrl } from "./content";
import { buildSystemPrompt, masteryState, MODE_NAMES, pickMode, plainName, type Mode } from "./pedagogy";
import { getStudent, saveStudent, type ChatEntry, type Student } from "./store";
import { maybeWriteNotes } from "./studentModel";

export interface Chip { label: string; nav?: string }
export interface ChatHandlers {
  onMeta?: (mode: string, modeName: string, chips?: Chip[], kpName?: string) => void;
  onDelta?: (text: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ONBOARDING = [
  { q: "第一个问题:学一个**新东西**的时候,你更喜欢哪种开场?", key: "newConcept", chips: ["先听你讲解", "先自己试着做"], values: ["listen", "try"] },
  { q: "第二个问题:**做错题**的时候,你希望我怎么处理?", key: "onWrong", chips: ["直接讲我哪错了", "引导我自己找错"], values: ["explain", "guided"] },
  { q: "最后一个:**练习**你偏好什么节奏?", key: "practice", chips: ["大量刷题,快节奏", "精讲一题,抠深度"], values: ["drill", "deep"] },
] as const;

const PANORAMA_TEXT =
  "记住了,你的偏好档案建好了——在**设置**里随时能看能改,对话里一句话(比如\"别让我猜,直接讲\")也能改。\n\n" +
  "现在看看我们要一起攻克的地盘:**人教版选择性必修第三册(热学)**,3 章、14 个单元、41 个考点——每一个我都备好了课,练习题也都就位。\n\n从哪一章开始?";

async function chapterChips(): Promise<Chip[]> {
  const tree = await getTree();
  return [...(tree?.chapters ?? []).map((c) => ({ label: c.name })), { label: "去学习地图挑", nav: "/map" }];
}
async function unitChipsOf(chapterName: string): Promise<{ text: string; chips: Chip[] } | null> {
  const ch = (await getTree())?.chapters.find((c) => c.name === chapterName);
  if (!ch) return null;
  return {
    text: `《${ch.name}》有 ${ch.units.length} 个单元,共 ${ch.units.reduce((n, u) => n + u.kps.length, 0)} 个考点:`,
    chips: [...ch.units.map((u) => ({ label: u.name })), { label: "重新选章" }],
  };
}
async function kpChipsOf(unitName: string): Promise<{ text: string; chips: Chip[] } | null> {
  for (const ch of (await getTree())?.chapters ?? []) {
    const u = ch.units.find((x) => x.name === unitName);
    if (u) return {
      text: `《${u.name}》包含这些考点,点一个,这节课马上开讲:`,
      chips: [...u.kps.map((k) => ({ label: `学:${plainName(k.name)}` })), { label: "重新选章" }],
    };
  }
  return null;
}
async function findKpByName(name: string): Promise<{ id: string; name: string } | null> {
  const target = plainName(name);
  for (const ch of (await getTree())?.chapters ?? [])
    for (const u of ch.units) for (const k of u.kps) if (plainName(k.name) === target) return { id: k.id, name: k.name };
  return null;
}

/** 打字机式脚本回复(不耗 token) */
async function scripted(h: ChatHandlers, s: Student, text: string, mode: Mode, chips?: Chip[], signal?: AbortSignal) {
  h.onMeta?.(mode, MODE_NAMES[mode], chips);
  const step = 18;
  for (let i = 0; i < text.length; i += step) {
    if (signal?.aborted) break;
    h.onDelta?.(text.slice(i, i + step));
    await sleep(18);
  }
  s.chat.push({ role: "assistant", text, at: new Date().toISOString(), mode, chips });
}

export async function runChat(
  body: { message: string; kp?: string | null; q?: string | null; qid?: string | null },
  h: ChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const message = String(body.message ?? "").trim();
  const kpId = body.kp ?? null;
  const qid = body.q ?? body.qid ?? null;
  const isStart = message === "__start__";
  const s = getStudent();

  const pushed = !isStart && message.length > 0;
  if (pushed) s.chat.push({ role: "user", text: message, at: new Date().toISOString() });

  // —— 三问初始化 ——
  if (!s.onboarding.done) {
    const step = Math.min(s.onboarding.step, ONBOARDING.length - 1);
    if (isStart || s.chat.filter((c) => c.role === "assistant").length === 0) {
      const cur = ONBOARDING[step];
      const intro = step === 0
        ? "你好,我是 **Stellairs**,你的物理私教。开始之前我想用三个问题弄清楚你喜欢怎么学——你的回答会存进档案,以后我就按你的方式教(随时可以改)。\n\n" + cur.q
        : "接着上次没问完的:\n\n" + cur.q;
      await scripted(h, s, intro, "chat", cur.chips.map((label) => ({ label })), signal);
      saveStudent(s); return;
    }
    const current = ONBOARDING[step];
    const idx = current.chips.findIndex((c) => message.includes(c.slice(0, 4)));
    if (idx >= 0) {
      (s.styleProfile as unknown as Record<string, unknown>)[current.key] = current.values[idx];
      s.styleLog.push({ at: new Date().toISOString(), change: `${current.key}=${current.values[idx]}(初始三问)` });
      s.onboarding.step += 1;
      if (s.onboarding.step >= ONBOARDING.length) {
        s.onboarding.done = true;
        await scripted(h, s, PANORAMA_TEXT, "chat", await chapterChips(), signal);
      } else {
        const nxt = ONBOARDING[s.onboarding.step];
        await scripted(h, s, nxt.q, "chat", nxt.chips.map((label) => ({ label })), signal);
      }
      saveStudent(s); return;
    }
    await scripted(h, s, "用下面的选项回答就行(以后聊什么都可以,先把这三问走完)。\n\n" + current.q, "chat", current.chips.map((label) => ({ label })), signal);
    saveStudent(s); return;
  }

  // —— 回访 ——
  if (isStart) {
    const cur = s.currentKp ? (await getKpMap()).get(s.currentKp) : null;
    if (cur) {
      await scripted(h, s, `回来了。上次我们学到《${plainName(cur.name)}》——继续,还是换一个?`, "chat", [
        { label: `继续学:${plainName(cur.name)}` }, { label: "换个考点" }, { label: "去练习", nav: "/practice" },
      ], signal);
    } else {
      await scripted(h, s, "回来了。今天从哪一章开始?", "chat", [...(await chapterChips()), { label: "去练习", nav: "/practice" }], signal);
    }
    saveStudent(s); return;
  }

  // —— 偏好一句话调整 ——
  if (/别让我猜|直接讲|别提问|少提问|不要引导/.test(message) && !/别直接讲/.test(message)) {
    s.styleProfile.onWrong = "explain";
    if (/概念|新/.test(message)) s.styleProfile.newConcept = "listen";
    s.styleLog.push({ at: new Date().toISOString(), change: "onWrong=explain(对话中一句话修改)" });
    await scripted(h, s, "好,改过来了,而且是**永久生效**:以后新概念我直接讲清楚,你做错时我直接指出错在哪,不再让你猜。做题时如果你想要回引导式,说一声\"引导我\"就换回来。", "chat", undefined, signal);
    saveStudent(s); return;
  }
  if (/引导我|多提问|苏格拉底|让我自己想/.test(message)) {
    s.styleProfile.onWrong = "guided";
    s.styleLog.push({ at: new Date().toISOString(), change: "onWrong=guided(对话中一句话修改)" });
    await scripted(h, s, "好,记住了:做题时我用提问一步步引导你,不直接报答案。想换回直讲随时说。", "chat", undefined, signal);
    saveStudent(s); return;
  }

  // —— 选课导航 ——
  if (/^(换个考点|重新选章|换一?章|重新挑)$/.test(message)) {
    s.currentKp = null;
    await scripted(h, s, "好,重新挑。从哪一章开始?", "chat", await chapterChips(), signal);
    saveStudent(s); return;
  }
  const unitReply = await unitChipsOf(message);
  if (unitReply) { await scripted(h, s, unitReply.text, "chat", unitReply.chips, signal); saveStudent(s); return; }
  const kpListReply = await kpChipsOf(message);
  if (kpListReply) { await scripted(h, s, kpListReply.text, "chat", kpListReply.chips, signal); saveStudent(s); return; }

  // 选中考点 → 记档案,真大脑开讲
  let teachKickoff: string | null = null;
  const pick = message.match(/^(继续)?学[::]\s*(.+)$/);
  if (pick) {
    const kp = await findKpByName(pick[2].trim());
    if (kp) {
      s.currentKp = kp.id;
      teachKickoff = pick[1] ? `我们继续学《${kp.name}》,接着上次的进度往下。` : `我选好了:《${kp.name}》。请从头开始教我这个考点。`;
    }
  }

  // 讲题上下文:题图视觉输入
  let questionImage: { dataB64: string; mediaType: string; caption: string } | null = null;
  let effectiveKp = kpId;
  if (qid) {
    const qmeta = (await getQuestionIndex()).find((x) => x.qid === qid);
    const crop = (await getCrops())[qid];
    if (qmeta && crop) {
      try {
        const { data, mediaType } = await imageToBase64(questionImageUrl(crop.file));
        const kpName = (await getKpMap()).get(qmeta.kp_primary)?.name ?? qmeta.kp_primary;
        questionImage = {
          dataB64: data, mediaType,
          caption: `讲义第${qmeta.page}页 ${qmeta.label},考点:${kpName},题型:${qmeta.qtype}。截图可能带到相邻内容,只讲 ${qmeta.label} 这道题。此题标准答案未录入,请你独立解出后按苏格拉底阶梯带学生做,最终答案要自己验算。`,
        };
      } catch { /* 图取不到就当普通讲课 */ }
      if (!effectiveKp) effectiveKp = qmeta.kp_primary;
    }
  }
  if (!effectiveKp) effectiveKp = s.currentKp;
  if (effectiveKp && effectiveKp !== s.currentKp) s.currentKp = effectiveKp;

  // —— 真教学轮:模式矩阵 + 真大脑流式 ——
  const state = masteryState(effectiveKp, s);
  const mode: Mode = questionImage ? "socratic" : effectiveKp ? pickMode(state, s) : "chat";
  const kpName = effectiveKp ? plainName((await getKpMap()).get(effectiveKp)?.name ?? effectiveKp) : undefined;
  h.onMeta?.(mode, MODE_NAMES[mode], undefined, kpName);

  const history = s.chat
    .filter((c) => c.text !== "__start__")
    .slice(0, pushed ? -1 : undefined)
    .slice(-30)
    .map((c): { role: "user" | "assistant"; content: string | unknown[] } => ({ role: c.role, content: c.text }));

  // 讲题轮把图片贴进当前消息
  const kickoff = teachKickoff ?? message;
  const lastUser: { role: "user"; content: string | unknown[] } = questionImage
    ? {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: questionImage.mediaType, data: questionImage.dataB64 } },
          { type: "text", text: `【当前正在讲的题目见上图。${questionImage.caption}】\n\n${kickoff}` },
        ],
      }
    : { role: "user", content: kickoff };

  const system = await buildSystemPrompt(effectiveKp, mode, s);
  const reqBody = { model: MODEL, max_tokens: MAX_TOKENS, system, messages: [...history, lastUser] };
  let assistantText = "";
  // 网络波动会概率性掐断到中转平台的连接:开讲前若失败,自动重试;已开始输出则不重试(避免重复)。
  const MAX_TRIES = 4;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    try {
      for await (const delta of streamProxy(reqBody, signal)) {
        assistantText += delta;
        h.onDelta?.(delta);
      }
      break; // 正常读完
    } catch (e) {
      if (signal?.aborted) return;
      if (assistantText.length > 0) break; // 已经在输出,不重试
      if (attempt < MAX_TRIES - 1) {
        await sleep(1500 * (attempt + 1));
        continue; // 静默重试
      }
      const err = `连接大脑时网络波动,试了几次都没连上。稍等一下再点一次发送——通常重试就好。`;
      assistantText = err;
      h.onDelta?.(err);
    }
  }

  if (assistantText) {
    const entry: ChatEntry = { role: "assistant", text: assistantText, at: new Date().toISOString(), mode };
    s.chat.push(entry);
    if (mode !== "chat" && !signal?.aborted) s.turnsSinceNotes += 1;
  }
  saveStudent(s);
  void maybeWriteNotes();
}
