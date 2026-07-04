// 客户端学生档案:localStorage(每个浏览器=一个学生,无需服务器)。
// 取代原 server/lib/store.ts 的文件存储。

export interface StyleProfile {
  newConcept: "listen" | "try" | null;
  onWrong: "explain" | "guided" | null;
  practice: "drill" | "deep" | null;
}
export interface ChatEntry {
  role: "user" | "assistant";
  text: string;
  at: string;
  mode?: string;
  chips?: { label: string; nav?: string }[];
  image?: string; // 内嵌图片(如教学后出的练习题题图)
  imageLabel?: string; // 图片题的来源标注,如 "讲义 p12 · 例3"
}
export interface MistakeEntry {
  qid: string;
  page: number;
  label: string;
  kp: string | null;
  stem: string;
  given: string;
  answer: string;
  at: string;
}
export interface AnswerRecord {
  correct?: boolean;
  given?: string;
  at: string;
}
export interface Student {
  createdAt: string;
  styleProfile: StyleProfile;
  styleLog: { at: string; change: string }[];
  onboarding: { step: number; done: boolean };
  currentKp: string | null;
  activeQid: string | null; // 正在对话里做的练习题;学生作答时把它的题图带给 AI 批改
  teacherNotes: { updatedAt: string; text: string } | null;
  turnsSinceNotes: number;
  mastery: Record<string, { seen: number; correct: number; wrong: number; lastAt: string }>;
  answers: Record<string, AnswerRecord>;
  mistakes: MistakeEntry[];
  chat: ChatEntry[];
}

function defaultStudent(): Student {
  return {
    createdAt: new Date().toISOString(),
    styleProfile: { newConcept: null, onWrong: null, practice: null },
    styleLog: [],
    onboarding: { step: 0, done: false },
    currentKp: null,
    activeQid: null,
    teacherNotes: null,
    turnsSinceNotes: 0,
    mastery: {},
    answers: {},
    mistakes: [],
    chat: [],
  };
}

const KEY = "stellairs-student";
let current: Student | null = null;

export function getStudent(): Student {
  if (current) return current;
  let loaded: Student;
  try {
    const raw = localStorage.getItem(KEY);
    loaded = raw ? { ...defaultStudent(), ...JSON.parse(raw) } : defaultStudent();
  } catch {
    loaded = defaultStudent();
  }
  current = loaded;
  return loaded;
}

export function saveStudent(s: Student): void {
  current = s;
  if (s.chat.length > 400) s.chat = s.chat.slice(-400);
  if (s.mistakes.length > 200) s.mistakes = s.mistakes.slice(-200);
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    // 不能再静默:写满或被禁用时,学生以为在存、其实全丢。发个事件让界面提醒去导出备份。
    const quota = e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22);
    console.warn("[store] 保存失败" + (quota ? "(本地存储已满)" : "(存储被禁用?)"), e);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("stellairs-storage-full", { detail: { quota } }));
    }
  }
}

/** 导出当前档案为 JSON 字符串(用于备份下载) */
export function exportStudent(): string {
  return JSON.stringify(getStudent(), null, 2);
}

/** 从导出的 JSON 覆盖当前档案。校验最小结构后保存并返回。 */
export function importStudent(data: unknown): Student {
  if (!data || typeof data !== "object") throw new Error("这个文件看起来不是学习档案");
  const d = data as Partial<Student>;
  if (!Array.isArray(d.chat) || typeof d.mastery !== "object" || d.mastery === null) {
    throw new Error("这不是 Stellairs 的学习档案文件");
  }
  const merged = { ...defaultStudent(), ...d } as Student;
  current = merged;
  saveStudent(merged);
  return merged;
}

export function resetStudent(): Student {
  current = defaultStudent();
  saveStudent(current);
  return current;
}

export function touchMastery(s: Student, kpId: string, correct: boolean): void {
  const m = s.mastery[kpId] ?? { seen: 0, correct: 0, wrong: 0, lastAt: "" };
  m.seen += 1;
  if (correct) m.correct += 1;
  else m.wrong += 1;
  m.lastAt = new Date().toISOString();
  s.mastery[kpId] = m;
}
