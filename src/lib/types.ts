export interface Kp {
  id: string;
  name: string;
  type: string;
  formulas: string[];
  pitfalls: string[];
  pages: string;
}
export interface Unit {
  id: string;
  name: string;
  pages: string;
  kps: Kp[];
}
export interface Chapter {
  id: string;
  name: string;
  units: Unit[];
}
export interface KpTree {
  version: string;
  scope: string;
  chapters: Chapter[];
}

export interface Chip {
  label: string;
  nav?: string;
}

export interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  mode?: string;
  modeName?: string;
  chips?: Chip[];
  image?: string;
  imageLabel?: string;
}

export interface Mastery {
  seen: number;
  correct: number;
  wrong: number;
  lastAt: string;
}

export interface StudentPublic {
  styleProfile: {
    newConcept: "listen" | "try" | null;
    onWrong: "explain" | "guided" | null;
    practice: "drill" | "deep" | null;
  };
  mastery: Record<string, Mastery>;
  answers: Record<string, { correct: boolean; at: string }>;
  mistakes: {
    qid: string;
    page: number;
    label: string;
    kp: string | null;
    stem: string;
    given: string;
    answer: string;
    at: string;
    resolvedAt?: string;
  }[];
}

export type DifficultyLevel = "basic" | "advanced" | "challenge";

export interface PracticeQuestion {
  kind: "text" | "image";
  qid: string;
  page: number;
  label: string;
  qtype: string;
  stem_md?: string;
  options?: Record<string, string>;
  multi: boolean;
  choice?: boolean;
  kp_primary?: string;
  stage?: string;
  difficulty?: string;
  difficultyLevel?: DifficultyLevel;
  review_status?: string;
  answerable: boolean;
  image?: string;
  source?: string;
  sourceLabel?: string;
}

export interface Health {
  ok: boolean;
  provider: string;
  model: string;
  hasKey: boolean;
}
