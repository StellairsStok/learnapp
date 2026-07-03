import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Md from "../components/Md";
import { getJSON, streamChat } from "../lib/api";
import type { Chip, ChatMsg, KpTree } from "../lib/types";

const MODE_CN: Record<string, string> = {
  direct: "讲授模式",
  "guided-repair": "引导修复",
  socratic: "苏格拉底",
  drill: "刷题模式",
};

export default function ChatPage() {
  const [params] = useSearchParams();
  const kp = params.get("kp");
  const questionId = params.get("q") ?? params.get("qid");
  const navigate = useNavigate();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(true); // 历史加载完成前禁用输入,防止与首次问候流并发
  const [kpName, setKpName] = useState<string | null>(null);
  const [modeName, setModeName] = useState<string | null>(null);
  const [qMeta, setQMeta] = useState<{ image: string | null; page: number; label: string; kpName: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // 卸载时中断进行中的流
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // 知识点上下文名称:URL 参数优先,否则用服务端记忆的 currentKp(带过期保护)
  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        let target = kp;
        if (!target) {
          const stu = await getJSON<{ currentKp?: string | null }>("/api/student");
          target = stu.currentKp ?? null;
        }
        if (stale) return;
        if (!target) {
          setKpName(null);
          return;
        }
        const tree = await getJSON<KpTree>("/api/content/tree");
        if (stale) return;
        let found: string | null = null;
        for (const ch of tree.chapters)
          for (const u of ch.units)
            for (const k of u.kps) if (k.id === target) found = k.name;
        setKpName(found ?? target);
      } catch {
        if (!stale && kp) setKpName(kp);
      }
    })();
    return () => {
      stale = true;
    };
  }, [kp]);

  // 讲题模式:取题图与元信息,把题目直接呈现在对话上方
  useEffect(() => {
    if (!questionId) {
      setQMeta(null);
      return;
    }
    let stale = false;
    getJSON<{ image: string | null; page: number; label: string; kpName: string }>(
      `/api/questions/meta?qid=${questionId}`,
    )
      .then((m) => {
        if (!stale) setQMeta(m);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [questionId]);

  const appendToLast = useCallback((t: string) => {
    setMessages((m) => {
      const copy = [...m];
      const last = copy[copy.length - 1];
      copy[copy.length - 1] = { ...last, text: last.text + t };
      return copy;
    });
  }, []);

  const runStream = useCallback(
    async (message: string) => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        await streamChat(
          { message, kp, q: questionId },
          {
            onMeta: (_mode, name, newChips, metaKpName) => {
              setModeName(name);
              if (metaKpName !== undefined) setKpName(metaKpName || null);
              setMessages((m) => {
                if (m.length === 0) return m;
                const copy = [...m];
                copy[copy.length - 1] = { ...copy[copy.length - 1], modeName: name, chips: newChips ?? [] };
                return copy;
              });
            },
            onDelta: appendToLast,
          },
          ctrl.signal,
        );
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // 用户切走了,静默
        appendToLast("(连接服务失败,确认应用正在运行后重试。)");
      }
    },
    [kp, questionId, appendToLast],
  );

  const send = useCallback(
    async (text: string) => {
      if (busy || !text.trim()) return;
      setBusy(true);
      setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: "" }]);
      try {
        await runStream(text);
      } finally {
        setBusy(false);
      }
    },
    [busy, runStream],
  );

  // 载入历史;首次访问触发 __start__ 问候
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const h = await getJSON<{
          chat: { role: "user" | "assistant"; text: string; mode?: string; chips?: Chip[] }[];
        }>("/api/chat/history");
        const visible = h.chat.filter((c) => c.text && c.text !== "__start__");
        setMessages(
          visible.map((c) => ({
            role: c.role,
            text: c.text,
            modeName: c.mode ? MODE_CN[c.mode] : undefined,
            chips: c.chips,
          })),
        );
        if (questionId) {
          setMessages((m) => [...m, { role: "user", text: "请带我做这道题" }, { role: "assistant", text: "" }]);
          await runStream("请带我做这道题");
        } else if (visible.length === 0) {
          setMessages([{ role: "assistant", text: "" }]);
          await runStream("__start__");
        }
      } catch {
        setMessages([
          { role: "assistant", text: "连接不上服务(后端未启动?)。启动应用后刷新这个页面。" },
        ]);
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const onChip = (c: Chip) => {
    if (c.nav) navigate(c.nav);
    else void send(c.label);
  };

  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  })();

  return (
    <div className="chat-page">
      <header className="page-head">
        <div>
          <h1>{kpName ? kpName : "和 Stellairs 对话"}</h1>
          {questionId ? (
            <div className="head-sub">讲题模式 · {questionId}</div>
          ) : (
            kpName && kp && <div className="head-sub">当前考点上下文 · {kp}</div>
          )}
        </div>
        <div className="head-actions">
          {kpName && !questionId && (
            <button className="ghost-btn small" onClick={() => void send("换个考点")} disabled={busy}>
              换个考点
            </button>
          )}
          {modeName && <span className="mode-badge">{modeName}</span>}
        </div>
      </header>

      <div className="chat-scroll">
        {questionId && qMeta?.image && (
          <div className="q-banner">
            <div className="q-banner-head">
              <span className="q-tag q-source">讲义 p{qMeta.page} · {qMeta.label}</span>
              <span className="q-tag">{qMeta.kpName}</span>
            </div>
            <img className="q-image" src={qMeta.image} alt={`${qMeta.label} 题图`} />
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="msg-user">
              <div className="bubble-user">{m.text}</div>
            </div>
          ) : (
            <div key={i} className="msg-ai">
              <div className="ai-avatar">✦</div>
              <div className="ai-body">
                <div className="ai-name">
                  Stellairs
                  {m.modeName && <span className="ai-mode">{m.modeName}</span>}
                </div>
                {m.text ? <Md>{m.text}</Md> : <div className="typing"><span /><span /><span /></div>}
                {m.chips?.length && i === lastAssistantIndex && !busy ? (
                  <div className="message-chips" aria-label="可选择的回答">
                    {m.chips.map((c) => (
                      <button key={c.label} className="message-chip" onClick={() => onChip(c)}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <div className="composer-wrap">
        <div className="composer">
          <textarea
            value={input}
            placeholder={busy ? "Stellairs 正在回复…" : "输入消息,Enter 发送(Shift+Enter 换行)"}
            disabled={busy}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const t = input;
                setInput("");
                void send(t);
              }
            }}
          />
          <button
            className="send-btn"
            disabled={busy || !input.trim()}
            onClick={() => {
              const t = input;
              setInput("");
              void send(t);
            }}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
