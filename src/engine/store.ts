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
  } catch {
    /* localStorage 满或禁用:忽略 */
  }
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
