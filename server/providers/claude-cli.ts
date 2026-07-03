import { spawn } from "node:child_process";
import { buildSystemPrompt, MODE_NAMES } from "../lib/pedagogy";
import { getStudent } from "../lib/store";
import type { Brain } from "./types";

// claude-cli 通道:本机 Claude Code 无头模式(用创始人现有的 Claude 登录,零新增成本)。
// 仅限创始人本机自测使用;给真实学生用必须换 anthropic 通道。
// 需要本机安装 Claude Code 命令行且已登录。

export const claudeCliBrain: Brain = async function* (req) {
  yield { type: "meta", mode: req.mode, modeName: MODE_NAMES[req.mode] };

  const student = getStudent(req.code);
  const system = buildSystemPrompt(req.kpId, req.mode, student);
  const transcript = req.history
    .slice(-20)
    .map((t) => `${t.role === "user" ? "学生" : "Stellairs"}:${t.text}`)
    .join("\n\n");
  const prompt = `${system}\n\n===== 对话历史 =====\n${transcript}\n\n学生:${req.message}\n\n请以 Stellairs 的身份直接输出对学生的回复(不要输出任何其他内容):`;

  const text = await new Promise<string>((resolve) => {
    // 提示词走 stdin(命令行参数在 Windows 有 ~8K 长度限制且引号易碎)
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      shell: true,
      windowsHide: true,
    });
    // setEncoding 内部用 StringDecoder,避免中文多字节字符在 chunk 边界被切成乱码
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      child.kill();
      resolve("__CLI_TIMEOUT__");
    }, 120_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve("__CLI_MISSING__");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out.trim() : `__CLI_ERROR__${err.slice(0, 300)}`);
    });
    // CLI 未登录/参数错会立刻退出并关闭管道,写入会触发 EPIPE——必须兜住,否则崩整个服务
    child.stdin.on("error", () => {});
    try {
      child.stdin.write(prompt, "utf-8");
      child.stdin.end();
    } catch {
      /* 管道已关,close 事件会带出错误信息 */
    }
  });

  if (text === "__CLI_MISSING__") {
    yield {
      type: "delta",
      text: "本机没找到 Claude Code 命令行(`claude`)。安装并登录后重启即可用这个免费通道;或者把 `server/config.json` 的 provider 改回 `\"mock\"`。",
    };
  } else if (text.startsWith("__CLI_ERROR__")) {
    const detail = text.slice(13);
    const missing = /not recognized|不是内部或外部命令|not found/i.test(detail);
    yield {
      type: "delta",
      text: missing
        ? "本机没找到 Claude Code 命令行(`claude`)。安装并登录后重启即可用这个免费通道;或者把 `server/config.json` 的 provider 改回 `\"mock\"`。"
        : `Claude Code 通道出错:${detail}`,
    };
  } else if (text === "__CLI_TIMEOUT__") {
    yield { type: "delta", text: "Claude Code 通道超时了,重试一次看看。" };
  } else {
    yield { type: "delta", text };
  }
};
