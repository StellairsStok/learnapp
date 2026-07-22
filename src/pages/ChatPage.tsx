import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Md from "../components/Md";
import { getJSON, startPractice, streamChat } from "../lib/api";
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
  const [qMeta, setQMeta] = useState<{ image: string | null; page: number; label: string; kpName: string; sourceLabel?: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true); // 是否自动吸底;用户上滑看历史时暂停,滑回底部时恢复
  const progScrollRef = useRef(false); // 标记"这次滚动是程序触发的",避免自动吸底反过来把自己重新锁死
  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [retryKind, setRetryKind] = useState<"ratelimit" | "offline" | "network" | null>(null);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const lastUserRef = useRef("");

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
    getJSON<{ image: string | null; page: number; label: string; kpName: string; sourceLabel?: string }>(
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
      lastUserRef.current = message;
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
            onError: (kind) => setRetryKind(kind),
          },
          ctrl.signal,
        );
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // 用户切走了,静默
        appendToLast("(连接服务失败,确认应用正在运行后重试。)");
        setRetryKind("network");
      }
    },
    [kp, questionId, appendToLast],
  );

  const send = useCallback(
    async (text: string) => {
      if (busy || !text.trim()) return;
      setBusy(true);
      setRetryKind(null);
      setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: "" }]);
      try {
        await runStream(text);
      } finally {
        setBusy(false);
      }
    },
    [busy, runStream],
  );

  // 重试:去掉失败的用户气泡 + 错误气泡,用同一句话干净重发(失败轮未存进历史)
  const retry = useCallback(() => {
    const text = lastUserRef.current;
    if (!text || busy) return;
    setRetryKind(null);
    setMessages((m) => m.slice(0, -2));
    void send(text);
  }, [busy, send]);

  // 教学后出题:从题库挑一道匹配题,以带图消息进入对话
  const doPractice = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setRetryKind(null);
    try {
      const r = await startPractice(kp);
      if ("error" in r) {
        setMessages((m) => [...m, { role: "assistant", text: r.error }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", text: r.text, image: r.image, imageLabel: r.imageLabel, chips: r.chips }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "挑题时出了点问题,稍后再试。" }]);
    } finally {
      setBusy(false);
    }
  }, [busy, kp]);

  // 载入历史;首次访问触发 __start__ 问候
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const h = await getJSON<{
          chat: { role: "user" | "assistant"; text: string; mode?: string; chips?: Chip[]; image?: string; imageLabel?: string }[];
        }>("/api/chat/history");
        const visible = h.chat.filter((c) => c.text && c.text !== "__start__");
        setMessages(
          visible.map((c) => ({
            role: c.role,
            text: c.text,
            modeName: c.mode ? MODE_CN[c.mode] : undefined,
            chips: c.chips,
            image: c.image,
            imageLabel: c.imageLabel,
          })),
        );
        if (questionId) {
          const given = params.get("given");
          const ans = params.get("ans");
          const kickoff = given && ans
            ? `我刚在练习里做错了这道题:我选了 ${given},正确答案是 ${ans}。先别直接讲答案——带我找到我到底错在哪一步,再让我自己重走一遍。`
            : "请带我做这道题";
          setMessages((m) => [...m, { role: "user", text: kickoff }, { role: "assistant", text: "" }]);
          await runStream(kickoff);
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

  // 仅当用户本就在底部时才自动跟随;上滑查看历史时不再强制拉到底
  useEffect(() => {
    if (!stickRef.current) return;
    progScrollRef.current = true; // 这次是程序滚的,别让 onScroll 误判
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
    requestAnimationFrame(() => {
      progScrollRef.current = false;
    });
  }, [messages]);

  const onScrollArea = () => {
    if (progScrollRef.current) return; // 忽略程序自身触发的滚动
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const onChip = (c: Chip) => {
    if (c.nav) navigate(c.nav);
    else if (c.label === "做一道相关的题" || c.label === "换一道") void doPractice();
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

      <div className="chat-scroll" ref={scrollRef} onScroll={onScrollArea}>
        {questionId && qMeta?.image && (
          <div className="q-banner">
            <div className="q-banner-head">
              <span className="q-tag q-source">{qMeta.sourceLabel ?? `讲义 p${qMeta.page}`} · {qMeta.label}</span>
              <span className="q-tag">{qMeta.kpName}</span>
            </div>
            <img
              className="q-image"
              src={qMeta.image}
              alt={`${qMeta.label} 题图`}
              loading="lazy"
              onClick={() => qMeta.image && setZoomSrc(qMeta.image)}
              title="点击看大图"
            />
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
                {m.image && (
                  <div className="chat-qcard">
                    {m.imageLabel && <div className="chat-qcard-head">📄 {m.imageLabel}</div>}
                    <img src={m.image} alt="练习题题图" loading="lazy" onClick={() => m.image && setZoomSrc(m.image)} title="点击看大图" />
                  </div>
                )}
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
        {retryKind && !busy && (
          <div className="retry-row">
            <button className="retry-btn" onClick={retry}>重试</button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="composer-wrap">
        <div className="composer">
          <textarea
            value={input}
            placeholder="输入消息,Enter 发送(Shift+Enter 换行)"
            rows={1}
            enterKeyHint="send"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (busy || !input.trim()) return; // 回复中可以继续打字,内容留着,等这段讲完再发
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

      {zoomSrc && (
        <div className="img-lightbox" role="dialog" aria-label="放大的题目图片" onClick={() => setZoomSrc(null)}>
          <img src={zoomSrc} alt="放大的题目" />
          <button className="img-lightbox-close" aria-label="关闭大图" onClick={() => setZoomSrc(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
