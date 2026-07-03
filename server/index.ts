import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { getCrops, getKpMap, getQuestionIndex, getSeeds, getTree } from "./lib/content";
import { masteryState, MODE_NAMES, pickMode, type Mode } from "./lib/pedagogy";
import { getStudent, resetStudent, sanitizeCode, saveStudent, touchMastery, type Student } from "./lib/store";
import { getBrain, getConfig } from "./providers";
import type { BrainEvent, Chip } from "./providers/types";

// 极简 .env 加载(不引依赖):KEY=VALUE 每行;已有的环境变量优先
try {
  const envText = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf-8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  /* 没有 .env 文件时跳过 */
}

const app = express();
app.use(cors());
app.use(express.json());
app.use("/qimg", express.static(path.resolve(process.cwd(), "content", "questions", "img"), { maxAge: "1d" }));

// ---------------- 基础信息 ----------------

app.get("/api/health", (_req, res) => {
  const config = getConfig();
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || config.apiKey);
  res.json({ ok: true, provider: config.provider, model: config.model, hasKey });
});

// ---------------- 内容 ----------------

app.get("/api/content/tree", (_req, res) => {
  const tree = getTree();
  if (!tree) return res.status(404).json({ error: "知识树文件缺失(content/tree/kp-tree.json)" });
  res.json(tree);
});

/** 单题元信息(讲题页显示题图用) */
app.get("/api/questions/meta", (req, res) => {
  const qid = String(req.query.qid ?? "");
  const q = getQuestionIndex().find((x) => x.qid === qid);
  if (!q) return res.status(404).json({ error: "题目不存在" });
  const crop = getCrops()[qid];
  res.json({
    qid,
    page: q.page,
    label: q.label,
    qtype: q.qtype,
    kp_primary: q.kp_primary,
    kpName: getKpMap().get(q.kp_primary)?.name ?? q.kp_primary,
    image: crop ? `/qimg/${crop.file}` : null,
  });
});

app.get("/api/questions/stats", (_req, res) => {
  const index = getQuestionIndex();
  const seeds = getSeeds();
  const perKp: Record<string, { total: number; seeded: number }> = {};
  for (const q of index) {
    const e = (perKp[q.kp_primary] ??= { total: 0, seeded: 0 });
    e.total += 1;
  }
  for (const s of seeds) {
    if (s.kp_primary && perKp[s.kp_primary]) perKp[s.kp_primary].seeded += 1;
  }
  res.json({ perKp, indexTotal: index.length, seedTotal: seeds.length });
});

// ---------------- 学生档案 ----------------

function publicStudent(s: Student) {
  const { chat, ...rest } = s;
  return rest;
}

/** 每个请求按 X-Student-Code 头定位学生档案(无头=default,本机自用) */
function codeOf(req: express.Request): string {
  return sanitizeCode(req.header("x-student-code"));
}

app.get("/api/student", (req, res) => res.json(publicStudent(getStudent(codeOf(req)))));

app.post("/api/student/profile", (req, res) => {
  const code = codeOf(req);
  const s = getStudent(code);
  const allowed = ["newConcept", "onWrong", "practice"] as const;
  for (const k of allowed) {
    if (k in req.body) {
      (s.styleProfile as unknown as Record<string, unknown>)[k] = req.body[k];
      s.styleLog.push({ at: new Date().toISOString(), change: `${k}=${req.body[k]}(设置页修改)` });
    }
  }
  saveStudent(code, s);
  res.json(publicStudent(s));
});

app.post("/api/student/reset", (req, res) => {
  res.json(publicStudent(resetStudent(codeOf(req))));
});

// ---------------- 对话 ----------------

app.get("/api/chat/history", (req, res) => {
  res.json({ chat: getStudent(codeOf(req)).chat });
});

interface SSEWriter {
  readonly closed: boolean;
  send: (ev: BrainEvent) => void;
  end: () => void;
}

function openSSE(res: express.Response): SSEWriter {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  let closed = false;
  let ended = false;
  res.on("close", () => {
    closed = true; // 客户端断开:循环据此提前退出,不再空转
  });
  return {
    get closed() {
      return closed;
    },
    send: (ev) => {
      if (closed || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    },
    end: () => {
      if (ended) return; // 幂等:finally 兜底调用不会重复收尾
      ended = true;
      if (!closed && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();
      }
    },
  };
}

/** 三问初始化:首次使用时由 Stellairs 按剧本问偏好,答案写入档案 */
const ONBOARDING: { q: string; key: "newConcept" | "onWrong" | "practice"; chips: [string, string]; values: [string, string] }[] = [
  {
    q: "第一个问题:学一个**新东西**的时候,你更喜欢哪种开场?",
    key: "newConcept",
    chips: ["先听你讲解", "先自己试着做"],
    values: ["listen", "try"],
  },
  {
    q: "第二个问题:**做错题**的时候,你希望我怎么处理?",
    key: "onWrong",
    chips: ["直接讲我哪错了", "引导我自己找错"],
    values: ["explain", "guided"],
  },
  {
    q: "最后一个:**练习**你偏好什么节奏?",
    key: "practice",
    chips: ["大量刷题,快节奏", "精讲一题,抠深度"],
    values: ["drill", "deep"],
  },
];

async function replyScripted(sse: SSEWriter, s: Student, text: string, mode: Mode, chips?: Chip[]) {
  sse.send({ type: "meta", mode, modeName: MODE_NAMES[mode], chips });
  const step = 18;
  for (let i = 0; i < text.length; i += step) {
    if (sse.closed) break; // 客户端已断开,别再空转打字
    sse.send({ type: "delta", text: text.slice(i, i + step) });
    await new Promise((r) => setTimeout(r, 18));
  }
  s.chat.push({ role: "assistant", text, at: new Date().toISOString(), mode, chips });
}

app.post("/api/chat", async (req, res) => {
  const message: string = String(req.body.message ?? "").trim();
  const kpId: string | null = req.body.kp ?? null;
  const qid: string | null = req.body.q ?? req.body.qid ?? null;
  const isStart = message === "__start__";

  const code = codeOf(req);
  const s = getStudent(code);
  const sse = openSSE(res);

  // 防护层:async 路由里任何未预期的抛错(如写盘失败)都不能崩进程或让请求悬死
  try {
    await handleChat();
  } catch (e) {
    console.error("[chat] 处理出错", e);
    sse.send({
      type: "delta",
      text: `(服务端出错:${e instanceof Error ? e.message : String(e)}。这条对话可能没有存档。)`,
    });
  } finally {
    sse.end(); // 幂等,保证前端一定收到 done
  }
  return;

  async function handleChat() {
  const pushed = !isStart && message.length > 0;
  if (pushed) {
    s.chat.push({ role: "user", text: message, at: new Date().toISOString() });
  }

  // —— 首次使用:三问初始化 ——
  if (!s.onboarding.done) {
    const step = Math.min(s.onboarding.step, ONBOARDING.length - 1);
    if (isStart || s.chat.filter((c) => c.role === "assistant").length === 0) {
      // 刷新/回访时从当前进度续问,而不是永远重播第一问
      const cur = ONBOARDING[step];
      const intro =
        step === 0
          ? "你好,我是 **Stellairs**,你的物理私教。开始之前我想用三个问题弄清楚你喜欢怎么学——你的回答会存进档案,以后我就按你的方式教(随时可以改)。\n\n" + cur.q
          : "接着上次没问完的:\n\n" + cur.q;
      await replyScripted(sse, s, intro, "chat", cur.chips.map((label) => ({ label })));
      saveStudent(code, s);
      return;
    }
    const current = ONBOARDING[step];
    const idx = current.chips.findIndex((c) => message.includes(c.slice(0, 4)));
    if (idx >= 0) {
      (s.styleProfile as unknown as Record<string, unknown>)[current.key] = current.values[idx];
      s.styleLog.push({ at: new Date().toISOString(), change: `${current.key}=${current.values[idx]}(初始三问)` });
      s.onboarding.step += 1;
      if (s.onboarding.step >= ONBOARDING.length) {
        s.onboarding.done = true;
        const done =
          "记住了。你的偏好档案建好了——在**设置**里随时能看能改,对话里一句话(比如\"别让我猜,直接讲\")也能改。\n\n现在可以开始了:我目前跑在演示通道上,能完整上一节**玻意耳定律**;也可以先去学习地图看看整个切片的 41 个考点。";
        await replyScripted(sse, s, done, "chat", [
          { label: "讲玻意耳定律" },
          { label: "去学习地图", nav: "/map" },
        ]);
      } else {
        const nxt = ONBOARDING[s.onboarding.step];
        await replyScripted(sse, s, nxt.q, "chat", nxt.chips.map((label) => ({ label })));
      }
      saveStudent(code, s);
      return;
    }
    await replyScripted(sse, s, "用下面的选项回答就行(以后聊什么都可以,先把这三问走完)。\n\n" + current.q, "chat", current.chips.map((label) => ({ label })));
    saveStudent(code, s);
    return;
  }

  if (isStart) {
    // 已完成三问的回访:不重复问,给一句轻的欢迎
    const back = "回来了。继续上次的进度,还是换个考点?";
    await replyScripted(sse, s, back, "chat", [
      { label: "讲玻意耳定律" },
      { label: "去学习地图", nav: "/map" },
      { label: "去练习", nav: "/practice" },
    ]);
    saveStudent(code, s);
    return;
  }

  // —— 教学偏好的一句话永久调整(所有通道通用,这就是"别让我猜"通道)——
  if (/别让我猜|直接讲|别提问|少提问|不要引导/.test(message) && !/别直接讲/.test(message)) {
    s.styleProfile.onWrong = "explain";
    if (/概念|新/.test(message)) s.styleProfile.newConcept = "listen";
    s.styleLog.push({ at: new Date().toISOString(), change: "onWrong=explain(对话中一句话修改)" });
    saveStudent(code, s);
    await replyScripted(
      sse,
      s,
      "好,改过来了,而且是**永久生效**:以后新概念我直接讲清楚,你做错时我直接指出错在哪,不再让你猜。做题时如果你想要回引导式,说一声\"引导我\"就换回来。",
      "chat",
    );
    saveStudent(code, s);
    return;
  }
  if (/引导我|多提问|苏格拉底|让我自己想/.test(message)) {
    s.styleProfile.onWrong = "guided";
    s.styleLog.push({ at: new Date().toISOString(), change: "onWrong=guided(对话中一句话修改)" });
    saveStudent(code, s);
    await replyScripted(sse, s, "好,记住了:做题时我用提问一步步引导你,不直接报答案。想换回直讲随时说。", "chat");
    saveStudent(code, s);
    return;
  }

  // —— 讲题上下文:载入题目截图(真大脑用视觉读题)——
  let questionImage: { dataB64: string; mediaType: string; caption: string } | null = null;
  let effectiveKp = kpId;
  if (qid) {
    const qmeta = getQuestionIndex().find((x) => x.qid === qid);
    const crop = getCrops()[qid];
    const imgPath = crop
      ? path.resolve(process.cwd(), "content", "questions", "img", crop.file)
      : null;
    if (qmeta && imgPath && fs.existsSync(imgPath)) {
      const kpName = getKpMap().get(qmeta.kp_primary)?.name ?? qmeta.kp_primary;
      questionImage = {
        dataB64: fs.readFileSync(imgPath).toString("base64"),
        mediaType: crop!.file.endsWith(".webp") ? "image/webp" : "image/png",
        caption: `讲义第${qmeta.page}页 ${qmeta.label},考点:${kpName},题型:${qmeta.qtype}。截图可能带到相邻内容,只讲 ${qmeta.label} 这道题。此题标准答案未录入,请你独立解出后按苏格拉底阶梯带学生做,最终答案要自己验算。`,
      };
      if (!effectiveKp) effectiveKp = qmeta.kp_primary;
    }
  }

  // —— 正常教学轮:模式矩阵选模式,交给当前大脑通道 ——
  const state = masteryState(effectiveKp, s);
  const mode: Mode = questionImage ? "socratic" : effectiveKp ? pickMode(state, s) : "chat";
  const { brain } = getBrain();

  const history = s.chat
    .filter((c) => c.text !== "__start__")
    .slice(0, pushed ? -1 : undefined) // 只有真的 push 过用户消息才裁掉最后一条
    .slice(-30)
    .map((c) => ({ role: c.role, text: c.text }));

  let assistantText = "";
  let lastMode: Mode = mode;
  let lastChips: Chip[] | undefined;
  try {
    for await (const ev of brain({ code, history, message, kpId: effectiveKp, mode, questionImage })) {
      if (sse.closed) break; // 客户端断开就停止消费(真大脑时=不再白烧 token)
      if (ev.type === "delta") assistantText += ev.text;
      if (ev.type === "meta") {
        lastMode = ev.mode;
        lastChips = ev.chips;
      }
      sse.send(ev);
    }
  } catch (e) {
    const errText = `(出了点问题:${e instanceof Error ? e.message : String(e)})`;
    assistantText += errText;
    sse.send({ type: "delta", text: errText });
  }

  // store 是进程内单例:大脑通道与本路由改的是同一个对象,直接收尾保存
  if (assistantText) {
    s.chat.push({
      role: "assistant",
      text: assistantText,
      at: new Date().toISOString(),
      mode: lastMode,
      chips: lastChips,
    });
  }
  saveStudent(code, s);
  }
});

// ---------------- 练习 ----------------

/**
 * 练习候选池 = 文本种子题(有标答,可判分)+ 已裁图的题(截图呈现;
 * 选择题可作答暂存待判分,大题走"让 Stellairs 讲"通道)。
 */
interface Candidate {
  kind: "text" | "image";
  qid: string;
  page: number;
  label: string;
  qtype: string;
  multi: boolean;
  choice: boolean;
  kp_primary?: string;
  stage?: string;
  difficulty?: string;
  answerable: boolean;
  // text 专有
  stem_md?: string;
  options?: Record<string, string>;
  review_status?: string;
  // image 专有
  image?: string;
}

function buildPool(): Candidate[] {
  const seeds = getSeeds();
  const crops = getCrops();
  const seedQids = new Set(seeds.map((x) => x.qid!));
  const cands: Candidate[] = [];
  for (const q of seeds) {
    cands.push({
      kind: "text",
      qid: q.qid!,
      page: q.page,
      label: q.label,
      qtype: q.qtype,
      multi: (q.qtype ?? "").includes("多"),
      choice: true,
      kp_primary: q.kp_primary,
      stage: q.stage,
      difficulty: q.difficulty,
      answerable: true,
      stem_md: q.stem_md,
      options: q.options,
      review_status: q.review_status,
    });
  }
  for (const q of getQuestionIndex()) {
    if (q.informal || seedQids.has(q.qid) || !crops[q.qid]) continue;
    const choice = /选/.test(q.qtype);
    cands.push({
      kind: "image",
      qid: q.qid,
      page: q.page,
      label: q.label,
      qtype: q.qtype,
      multi: q.qtype.includes("多"),
      choice,
      kp_primary: q.kp_primary,
      stage: q.stage,
      difficulty: q.difficulty,
      answerable: false,
      image: `/qimg/${crops[q.qid].file}`,
    });
  }
  return cands;
}

app.get("/api/practice/next", (req, res) => {
  const kp = req.query.kp ? String(req.query.kp) : null;
  const qid = req.query.qid ? String(req.query.qid) : null;
  const s = getStudent(codeOf(req));
  const all = buildPool();

  if (qid) {
    const hit = all.find((x) => x.qid === qid);
    return hit ? res.json({ question: hit }) : res.status(404).json({ error: "题目不存在" });
  }

  let pool = kp ? all.filter((x) => x.kp_primary === kp) : all;
  if (pool.length === 0) {
    return res.json({ question: null, reason: kp ? "该考点暂时没有可呈现的题(截图与题干都缺)" : "题库为空" });
  }
  // 优先:没做过的 > 做过的;可判分文本题 > 图题;难度由低到高爬
  const fresh = pool.filter((x) => !(x.qid in s.answers));
  if (fresh.length > 0) pool = fresh;
  const rank: Record<string, number> = { D1: 1, D2: 2, D3: 3, D4: 4, D5: 5 };
  pool.sort(
    (a, b) =>
      (rank[a.difficulty ?? "D3"] ?? 3) - (rank[b.difficulty ?? "D3"] ?? 3) ||
      Number(b.answerable) - Number(a.answerable),
  );
  const top = pool.slice(0, Math.min(3, pool.length));
  const pick = top[Math.floor(Math.random() * top.length)];
  res.json({ question: pick });
});

app.post("/api/practice/answer", (req, res) => {
  const { qid, given } = req.body as { qid: string; given: string[] };
  const seeds = getSeeds();
  const q = seeds.find((x) => x.qid === qid);
  if (!q) return res.status(404).json({ error: "题目不存在" });

  const answer = String(q.answer_draft ?? "")
    .toUpperCase()
    .replace(/[^A-D]/g, "")
    .split("")
    .filter(Boolean);
  if (answer.length === 0) return res.status(400).json({ error: "该题答案待录入,暂不能判分" });

  const chosen = [...new Set(
    (Array.isArray(given) ? given : [])
      .map((g) => String(g).toUpperCase())
      .filter((g) => /^[A-D]$/.test(g)),
  )].sort();
  if (chosen.length === 0) return res.status(400).json({ error: "没有有效的选项" });
  const correct = answer.slice().sort().join("") === chosen.join("");

  const code = codeOf(req);
  const s = getStudent(code);
  s.answers[qid] = { correct, at: new Date().toISOString() };
  if (q.kp_primary) touchMastery(s, q.kp_primary, correct);
  if (!correct) {
    s.mistakes.unshift({
      qid,
      page: q.page,
      label: q.label,
      kp: q.kp_primary ?? null,
      stem: q.stem_md.slice(0, 80),
      given: chosen.join(""),
      answer: answer.join(""),
      at: new Date().toISOString(),
    });
  }
  saveStudent(code, s);
  res.json({ correct, answer: answer.join(""), rationale: q.rationale_draft, review_status: q.review_status });
});

// ---------------- 生产模式静态托管 ----------------

const dist = path.resolve(process.cwd(), "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const PORT = Number(process.env.PORT) || 8787; // 托管平台(Render/Zeabur)会注入 PORT
app.listen(PORT, () => {
  const kpCount = getKpMap().size;
  console.log(`[Stellairs] 服务已启动 http://localhost:${PORT} · provider=${getConfig().provider} · 知识点=${kpCount}`);
});
