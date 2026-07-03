import type { Mode } from "../lib/pedagogy";

// 大脑接口:三个通道(mock / anthropic / claude-cli)实现同一协议,切换只改 server/config.json。

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface Chip {
  label: string;
  nav?: string; // 存在时点击跳转页面,否则作为消息发送
}

export interface BrainRequest {
  code: string; // 学生访问码(定位档案)
  history: ChatTurn[];
  message: string;
  kpId?: string | null;
  mode: Mode;
  /** 讲题上下文:题目截图(base64)+ 元信息,由真大脑用视觉读题 */
  questionImage?: { dataB64: string; mediaType: string; caption: string } | null;
}

export type BrainEvent =
  | { type: "meta"; mode: Mode; modeName: string; chips?: Chip[]; kpId?: string; kpName?: string }
  | { type: "delta"; text: string }
  | { type: "done" };

export type Brain = (req: BrainRequest) => AsyncGenerator<BrainEvent>;

export interface ProviderConfig {
  provider: string;
  model: string;
  maxTokens: number;
  apiKey?: string;
  baseUrl?: string; // 第三方中转平台的接口地址(留空=官方)
}
