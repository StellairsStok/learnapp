import fs from "node:fs";
import path from "node:path";

// 学生档案存储:每个学生一个访问码(code),一码一档案文件 data/students/{code}.json。
// 单写者模型:每个 code 在进程内只有一个 Student 实例,所有路由和大脑通道改同一个对象,
// 消除"读旧快照→写盘覆盖新数据"的竞态。文件创始人可直接打开阅读。

const DATA_DIR = path.resolve(process.cwd(), "data");
const STUDENTS_DIR = path.join(DATA_DIR, "students");
const LEGACY_FILE = path.join(DATA_DIR, "student.json");

export interface StyleProfile {
  newConcept: "listen" | "try" | null; // 新东西:先听讲解 / 先试着做
  onWrong: "explain" | "guided" | null; // 做错时:直接讲 / 引导找错
  practice: "drill" | "deep" | null; // 练习:大量刷 / 精讲一题
}

export interface ChatEntry {
  role: "user" | "assistant";
  text: string;
  at: string;
  mode?: string;
  chips?: { label: string; nav?: string }[];
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
  pending?: boolean; // 标答未录入,作答已保存、待判分
  at: string;
}

export interface Student {
  createdAt: string;
  styleProfile: StyleProfile;
  styleLog: { at: string; change: string }[];
  onboarding: { step: number; done: boolean };
  /** 当前正在学的考点(服务端记忆,换设备/刷新都还在) */
  currentKp: string | null;
  /** 老师的教学笔记:Stellairs 自己观察、自己维护的学生模型(修订制) */
  teacherNotes: { updatedAt: string; text: string } | null;
  /** 距上次写笔记的教学轮数 */
  turnsSinceNotes: number;
  mastery: Record<string, { seen: number; correct: number; wrong: number; lastAt: string }>;
  answers: Record<string, AnswerRecord>;
  mistakes: MistakeEntry[];
  chat: ChatEntry[];
  mockState: { phase: string; lessonStep: number; ladderStep: number };
}

function defaultStudent(): Student {
  return {
    createdAt: new Date().toISOString(),
    styleProfile: { newConcept: null, onWrong: null, practice: null },
    styleLog: [],
    onboarding: { step: 0, done: false },
    currentKp: null,
    teacherNotes: null,
    turnsSinceNotes: 0,
    mastery: {},
    answers: {},
    mistakes: [],
    chat: [],
    mockState: { phase: "idle", lessonStep: 0, ladderStep: 0 },
  };
}

/** 访问码清洗:只允许字母数字-_,最长 24;空则回退 default */
export function sanitizeCode(raw: unknown): string {
  const c = String(raw ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
  return c || "default";
}

function fileFor(code: string): string {
  return path.join(STUDENTS_DIR, `${code}.json`);
}

// 旧版单档案迁移:data/student.json → data/students/default.json
function migrateLegacy(): void {
  try {
    if (fs.existsSync(LEGACY_FILE) && !fs.existsSync(fileFor("default"))) {
      fs.mkdirSync(STUDENTS_DIR, { recursive: true });
      fs.renameSync(LEGACY_FILE, fileFor("default"));
      console.log("[store] 已迁移旧档案 → data/students/default.json");
    }
  } catch (e) {
    console.error("[store] 旧档案迁移失败", e);
  }
}
migrateLegacy();

const students = new Map<string, Student>();

function loadFromDisk(code: string): Student {
  const file = fileFor(code);
  try {
    const raw = fs.readFileSync(file, "utf-8");
    return { ...defaultStudent(), ...JSON.parse(raw) };
  } catch (e) {
    const errCode = (e as NodeJS.ErrnoException)?.code;
    if (errCode !== "ENOENT") {
      // 文件损坏:留底备份而不是无声清档
      try {
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
        console.error(`[store] ${code}.json 损坏,已留底`, e);
      } catch {
        /* 留底失败就只能放弃 */
      }
    }
    return defaultStudent();
  }
}

export function getStudent(code = "default"): Student {
  const c = sanitizeCode(code);
  let s = students.get(c);
  if (!s) {
    s = loadFromDisk(c);
    students.set(c, s);
  }
  return s;
}

export function saveStudent(code: string, s: Student): void {
  const c = sanitizeCode(code);
  students.set(c, s);
  fs.mkdirSync(STUDENTS_DIR, { recursive: true });
  if (s.chat.length > 400) s.chat = s.chat.slice(-400);
  if (s.mistakes.length > 200) s.mistakes = s.mistakes.slice(-200);
  // 原子写:先写临时文件再改名,断电/被杀不会留下半个 JSON
  const file = fileFor(c);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

export function resetStudent(code = "default"): Student {
  const c = sanitizeCode(code);
  const s = defaultStudent();
  students.set(c, s);
  saveStudent(c, s);
  return s;
}

export function touchMastery(s: Student, kpId: string, correct: boolean): void {
  const m = s.mastery[kpId] ?? { seen: 0, correct: 0, wrong: 0, lastAt: "" };
  m.seen += 1;
  if (correct) m.correct += 1;
  else m.wrong += 1;
  m.lastAt = new Date().toISOString();
  s.mastery[kpId] = m;
}
