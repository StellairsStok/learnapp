import { getMockLesson, type MockLesson } from "../lib/content";
import { MODE_NAMES } from "../lib/pedagogy";
import { getStudent, saveStudent, touchMastery } from "../lib/store";
import type { Brain, BrainEvent, Chip } from "./types";

// mock 通道:无需任何账号与联网的演示大脑。
// 按教学策略卡的节拍演示一节完整的课(玻意耳定律):讲授(分段)→ 检查题 → 苏格拉底阶梯 → 变式。
// 状态机原则:先判意图(提问/能力咨询/续课/重开),再走阶段推进;每个阶段都有兜底,不存在死路。

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function* streamText(text: string): AsyncGenerator<BrainEvent> {
  const step = 18;
  for (let i = 0; i < text.length; i += step) {
    yield { type: "delta", text: text.slice(i, i + step) };
    await sleep(24);
  }
}

function formatQuestion(stem: string, options: Record<string, string>): string {
  const opts = Object.entries(options)
    .map(([k, v]) => `**${k}.** ${v}`)
    .join("\n\n");
  return `${stem}\n\n${opts}`;
}

/** 明确的肯定答复(排除"不好""不用了"这类含否定的) */
function confirmYes(msg: string): boolean {
  return /检查|来一道|计算|可以|好的|好啊|好|行|嗯|走|来吧/.test(msg) && !/不(想|用|要|好|会|了)/.test(msg);
}

/** 看起来像在报答案(短、含数字、不含疑问词)——"第2问看不懂"不算 */
function looksLikeAnswer(msg: string): boolean {
  return /\d/.test(msg) && msg.length <= 30 && !/问|懂|意思|为什么|哪|吗|什么/.test(msg);
}

const CAPABILITIES_TEXT =
  "现在是**演示通道**(还没接入真正的大脑),但整个教学流程是真的:\n\n" +
  "- **对话**里我能完整地上一节「玻意耳定律」:先讲授、再检查、然后带你做计算题(提示分层给,不直接报答案)\n" +
  "- **学习地图**是这个切片的 41 个考点,颜色代表掌握情况\n" +
  "- **练习**里有从讲义转录的真题,做错会进错题本\n" +
  "- **设置**里可以调教学偏好——或者对话里直接说\"别让我猜,直接讲\",我会记住\n\n" +
  "等 API key 配好换上真大脑,就能讲全部考点、自由答疑了。";

export const mockBrain: Brain = async function* (req) {
  const lesson = getMockLesson();
  const student = getStudent(req.code);
  const msg = req.message.trim();
  const st = student.mockState;

  // 题图讲解需要真大脑的视觉能力,演示通道如实说明
  if (req.questionImage) {
    yield {
      type: "meta",
      mode: "socratic",
      modeName: MODE_NAMES.socratic,
      chips: [{ label: "去练习", nav: "/practice" }],
    };
    yield* streamText(
      "看题目图片讲题需要**真大脑**(视觉能力),演示通道做不到。API 接口配置好之后,你把任何一道题发我,我都能带你一步步做。",
    );
    return;
  }

  const meta = (mode: typeof req.mode, chips?: Chip[]): BrainEvent => ({
    type: "meta",
    mode,
    modeName: MODE_NAMES[mode],
    chips,
  });

  // —— 剧本课未就绪时的兜底 ——
  if (!lesson) {
    yield meta("chat");
    yield* streamText(
      "我是 Stellairs。演示课程的内容文件还没生成好(content/mock/lesson-boyle.json),稍后再试;你可以先去**学习地图**看看知识树,或去**练习**做几道题。",
    );
    return;
  }

  const inLesson = st.phase !== "idle";

  // ============ 一、意图优先于阶段推进 ============

  // 能力咨询:任何阶段都如实回答,不吞消息
  if (/能做什么|怎么用|是什么功能/.test(msg)) {
    yield meta("chat", inLesson ? [{ label: "继续上课" }] : [{ label: "讲玻意耳定律" }, { label: "去学习地图", nav: "/map" }]);
    yield* streamText(CAPABILITIES_TEXT + (inLesson ? "\n\n我们刚才的课还没上完,点下面继续。" : ""));
    return;
  }

  // 课中自由提问:诚实说明演示通道的边界,不把提问当"继续"吞掉
  if (inLesson && /问题|不懂|不明白|为什么|什么意思|[?？]/.test(msg) && !/继续|玻意耳|开始学|讲.*课|检查|来一道|计算/.test(msg) && !looksLikeAnswer(msg)) {
    yield meta("direct", [{ label: "继续上课" }]);
    yield* streamText(
      "抱歉,自由答疑是真大脑的活,演示通道我只会照着课稿讲。你的问题先记着,等 API key 配好我就能随时被打断提问了。先把这节课走完?",
    );
    saveStudent(req.code, student);
    return;
  }

  // 重新上这节课:显式重开才允许清进度
  if (/重新上|从头|重来/.test(msg) && inLesson) {
    st.phase = "lesson";
    st.lessonStep = 0;
    st.ladderStep = 0;
    // 落到下方 lesson 推进逻辑,直接发第一段
  }

  // 续课:按当前阶段恢复现场,而不是重置(修复"继续上课=从头再来"的坑)
  if (/继续上课|回到课/.test(msg) && inLesson && st.phase !== "lesson") {
    yield* resume(lesson, st, meta);
    saveStudent(req.code, student);
    return;
  }

  // 开新课:只有空闲状态才会开(课中说"讲玻意耳定律"不再清空进度)
  const wantLesson = /玻意耳|等温|讲.*课|开始学/.test(msg);
  if (wantLesson) {
    if (st.phase === "idle") {
      st.phase = "lesson";
      st.lessonStep = 0;
      st.ladderStep = 0;
    } else if (st.phase !== "lesson") {
      yield meta("direct", [{ label: "继续上课" }, { label: "重新上这节课" }]);
      yield* streamText("这节课正在进行中(还没走完)。点「继续上课」回到刚才的进度;想推倒重来就点「重新上这节课」。");
      saveStudent(req.code, student);
      return;
    }
  }

  // ============ 二、阶段推进(每个阶段都有兜底) ============

  if (st.phase === "lesson") {
    if (st.lessonStep < lesson.direct_lesson.length) {
      const seg = lesson.direct_lesson[st.lessonStep];
      st.lessonStep += 1;
      const last = st.lessonStep >= lesson.direct_lesson.length;
      yield meta("direct", last ? [{ label: "来一道检查题" }] : [{ label: "继续" }, { label: "我有问题" }]);
      yield* streamText(seg);
      if (last) st.phase = "check-offer";
      saveStudent(req.code, student);
      return;
    }
    st.phase = "check-offer"; // 理论不可达,防御性推进
  }

  if (st.phase === "check-offer") {
    if (confirmYes(msg)) {
      st.phase = "check";
      yield meta("direct", Object.keys(lesson.check_question.options).map((k) => ({ label: k })));
      yield* streamText(formatQuestion(lesson.check_question.stem, lesson.check_question.options));
    } else {
      yield meta("direct", [{ label: "来一道检查题" }]);
      yield* streamText("讲完了该检验一下——来道小题确认你真听懂了,准备好了点下面。");
    }
    saveStudent(req.code, student);
    return;
  }

  if (st.phase === "check") {
    const t = msg.toUpperCase();
    const pick = t.trim().match(/^([ABCD])$/)?.[1] ?? t.match(/(?:^|[^A-Z])([ABCD])(?=[^A-Z]|$)/)?.[1];
    if (pick) {
      const right = pick === lesson.check_question.answer.toUpperCase();
      touchMastery(student, lesson.kp, right);
      if (right) {
        st.phase = "ladder-offer";
        yield meta("direct", [{ label: "来一道计算题" }, { label: "去学习地图", nav: "/map" }]);
        yield* streamText(lesson.check_question.feedback_correct);
      } else {
        yield meta("direct", Object.keys(lesson.check_question.options).map((k) => ({ label: k })));
        yield* streamText(lesson.check_question.feedback_wrong);
      }
    } else {
      // 兜底:没识别出选项,重发题目而不是掉进开场白
      yield meta("direct", Object.keys(lesson.check_question.options).map((k) => ({ label: k })));
      yield* streamText("直接回 A / B / C / D 就行。再看一眼题目:\n\n" + formatQuestion(lesson.check_question.stem, lesson.check_question.options));
    }
    saveStudent(req.code, student);
    return;
  }

  if (st.phase === "ladder-offer") {
    if (confirmYes(msg)) {
      st.phase = "ladder";
      st.ladderStep = 0;
      yield meta("socratic", [{ label: "不太会,给点提示" }, { label: "我算出来了" }]);
      yield* streamText(`${lesson.socratic_ladder.problem}\n\n${lesson.socratic_ladder.probe}`);
    } else {
      yield meta("direct", [{ label: "来一道计算题" }, { label: "去学习地图", nav: "/map" }]);
      yield* streamText("会背定律和会用定律是两回事——来道计算题练一下,或者先去学习地图。");
    }
    saveStudent(req.code, student);
    return;
  }

  if (st.phase === "ladder") {
    const l = lesson.socratic_ladder;
    if (/提示|不太会|不会|卡/.test(msg)) {
      const hints = [l.hint_thinking, l.hint_method, l.hint_formula];
      if (st.ladderStep < hints.length) {
        const hint = hints[st.ladderStep];
        st.ladderStep += 1;
        const isLast = st.ladderStep >= hints.length;
        yield meta("socratic", [
          { label: isLast ? "还是不会,看解析" : "不太会,再提示一层" },
          { label: "我算出来了" },
        ]);
        yield* streamText(hint);
      } else {
        touchMastery(student, lesson.kp, false);
        st.phase = "variant-offer";
        yield meta("socratic", [{ label: "再来一道变式" }, { label: "今天先到这" }]);
        yield* streamText(l.solution);
      }
      saveStudent(req.code, student);
      return;
    }
    if (/算出来|做完|结果/.test(msg) && !looksLikeAnswer(msg)) {
      yield meta("socratic", [{ label: "不太会,给点提示" }]);
      yield* streamText("好,把你算出的结果直接发我(数字带单位)。");
      saveStudent(req.code, student);
      return;
    }
    if (looksLikeAnswer(msg)) {
      touchMastery(student, lesson.kp, true);
      st.phase = "variant-offer";
      yield meta("socratic", [{ label: "再来一道变式" }, { label: "今天先到这" }]);
      yield* streamText(`收到。对照一下完整步骤,确认每一步都清楚:\n\n${l.solution}`);
      saveStudent(req.code, student);
      return;
    }
    // 兜底
    yield meta("socratic", [{ label: "不太会,给点提示" }, { label: "我算出来了" }]);
    yield* streamText("卡住就点提示(我一层一层给,不直接报答案);算出来了就把结果(数字带单位)发我。");
    saveStudent(req.code, student);
    return;
  }

  if (st.phase === "variant-offer") {
    if (/变式|再来/.test(msg)) {
      st.phase = "variant";
      yield meta("socratic", [{ label: "不会,看解析" }, { label: "今天先到这" }]);
      yield* streamText(`${lesson.socratic_ladder.variant}\n\n独立做,做完把结果(数字带单位)发我。`);
      saveStudent(req.code, student);
      return;
    }
    if (/先到这|结束|休息|不做/.test(msg)) {
      yield* wrapUp(st, meta);
      saveStudent(req.code, student);
      return;
    }
    yield meta("socratic", [{ label: "再来一道变式" }, { label: "今天先到这" }]);
    yield* streamText("要不要换个数字再练一道?独立做出来才算真掌握。");
    saveStudent(req.code, student);
    return;
  }

  if (st.phase === "variant") {
    const va = lesson.socratic_ladder.variant_answer ?? "";
    if (/不会|解析|提示/.test(msg)) {
      touchMastery(student, lesson.kp, false);
      st.phase = "idle";
      yield meta("socratic", [{ label: "去学习地图", nav: "/map" }, { label: "去练习", nav: "/practice" }]);
      yield* streamText(
        `没关系,变式和原题同一个骨架,再走一遍思路:\n\n${lesson.socratic_ladder.solution}\n\n变式的答案是 **${va || "(见解析同思路)"}**。这个考点记为"还需巩固",下次复习会优先安排它。`,
      );
      saveStudent(req.code, student);
      return;
    }
    if (/先到这|结束|休息/.test(msg)) {
      yield* wrapUp(st, meta);
      saveStudent(req.code, student);
      return;
    }
    if (looksLikeAnswer(msg)) {
      touchMastery(student, lesson.kp, true);
      st.phase = "idle";
      yield meta("socratic", [{ label: "去学习地图", nav: "/map" }, { label: "去练习", nav: "/practice" }]);
      yield* streamText(`可以。核对一下:变式的答案是 **${va || "3×10⁵ Pa"}**。原题加变式都拿下,这个考点今天的练习量够了。`);
      saveStudent(req.code, student);
      return;
    }
    yield meta("socratic", [{ label: "不会,看解析" }, { label: "今天先到这" }]);
    yield* streamText("做完把结果(数字带单位)发我;不会的话点下面看解析。");
    saveStudent(req.code, student);
    return;
  }

  // ============ 三、空闲默认应答 ============
  yield meta("chat", [
    { label: "讲玻意耳定律" },
    { label: "这个 app 能做什么?" },
    { label: "去练习", nav: "/practice" },
  ]);
  yield* streamText(
    "我是 Stellairs。目前运行在演示通道上,能完整示范的课是**玻意耳定律**——想开始的话点下面,或者先去学习地图和练习页转转。",
  );
};

/** 续课:按当前阶段恢复现场 */
async function* resume(
  lesson: MockLesson,
  st: { phase: string; lessonStep: number; ladderStep: number },
  meta: (mode: "direct" | "socratic" | "chat", chips?: Chip[]) => BrainEvent,
): AsyncGenerator<BrainEvent> {
  switch (st.phase) {
    case "check-offer":
      yield meta("direct", [{ label: "来一道检查题" }]);
      yield* streamText("我们讲完了规律,正要做检查题。准备好了点下面。");
      return;
    case "check":
      yield meta("direct", Object.keys(lesson.check_question.options).map((k) => ({ label: k })));
      yield* streamText("回到检查题:\n\n" + formatQuestion(lesson.check_question.stem, lesson.check_question.options));
      return;
    case "ladder-offer":
      yield meta("direct", [{ label: "来一道计算题" }, { label: "去学习地图", nav: "/map" }]);
      yield* streamText("检查题过了,下一步是计算题实战。");
      return;
    case "ladder":
      yield meta("socratic", [{ label: "不太会,给点提示" }, { label: "我算出来了" }]);
      yield* streamText(`回到那道计算题:\n\n${lesson.socratic_ladder.problem}\n\n卡住点提示,算出来把结果发我。`);
      return;
    case "variant-offer":
      yield meta("socratic", [{ label: "再来一道变式" }, { label: "今天先到这" }]);
      yield* streamText("刚讲完解析,要不要来道变式巩固一下?");
      return;
    case "variant":
      yield meta("socratic", [{ label: "不会,看解析" }, { label: "今天先到这" }]);
      yield* streamText(`回到变式题:\n\n${lesson.socratic_ladder.variant}\n\n做完把结果发我。`);
      return;
    default:
      yield meta("chat", [{ label: "讲玻意耳定律" }]);
      yield* streamText("当前没有进行中的课。想开始就点下面。");
  }
}

/** 收尾小结 */
async function* wrapUp(
  st: { phase: string },
  meta: (mode: "chat", chips?: Chip[]) => BrainEvent,
): AsyncGenerator<BrainEvent> {
  st.phase = "idle";
  yield meta("chat", [{ label: "去学习地图", nav: "/map" }, { label: "去练习", nav: "/practice" }]);
  yield* streamText(
    "好。今天走完了玻意耳定律的完整一课:讲授、检查、计算各一遍,记录都存进你的档案了。下次回来我们从你的薄弱点继续。",
  );
}
