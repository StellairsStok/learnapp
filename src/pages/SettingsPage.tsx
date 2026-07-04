import { useEffect, useRef, useState } from "react";
import { exportStudentData, getJSON, importStudentData, postJSON } from "../lib/api";
import type { Health, StudentPublic } from "../lib/types";

const QUESTIONS = [
  {
    key: "newConcept" as const,
    title: "学新东西时",
    options: [
      { value: "listen", label: "先听讲解" },
      { value: "try", label: "先试着做" },
    ],
  },
  {
    key: "onWrong" as const,
    title: "做错题时",
    options: [
      { value: "explain", label: "直接讲哪错了" },
      { value: "guided", label: "引导我自己找" },
    ],
  },
  {
    key: "practice" as const,
    title: "练习节奏",
    options: [
      { value: "drill", label: "大量刷题" },
      { value: "deep", label: "精讲一题" },
    ],
  },
];

interface StudentModel {
  signals: string;
  notes: string | null;
  notesUpdatedAt: string | null;
}

export default function SettingsPage() {
  const [student, setStudent] = useState<StudentPublic | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [model, setModel] = useState<StudentModel | null>(null);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    getJSON<StudentPublic>("/api/student").then(setStudent).catch(() => {});
    getJSON<Health>("/api/health").then(setHealth).catch(() => {});
    getJSON<StudentModel>("/api/student/model").then(setModel).catch(() => {});
  }, []);

  const showFlash = (text: string, ok: boolean) => {
    setFlash({ text, ok });
    setTimeout(() => setFlash(null), 2200);
  };

  const setPref = async (key: string, value: string) => {
    try {
      const s = await postJSON<StudentPublic>("/api/student/profile", { [key]: value });
      setStudent(s);
      showFlash("已保存", true);
    } catch {
      showFlash("保存失败:服务未连接", false);
    }
  };

  const reset = async () => {
    if (!window.confirm("重置会清空:对话记录、掌握度、错题本、偏好档案。确定吗?")) return;
    try {
      const s = await postJSON<StudentPublic>("/api/student/reset", {});
      setStudent(s);
      showFlash("已重置", true);
    } catch {
      showFlash("重置失败:服务未连接", false);
    }
  };

  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = () => {
    try {
      const blob = new Blob([exportStudentData()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stellairs-备份-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showFlash("已导出备份文件", true);
    } catch {
      showFlash("导出失败", false);
    }
  };

  const doImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importStudentData(String(reader.result));
        showFlash("已导入,正在刷新…", true);
        setTimeout(() => window.location.reload(), 700);
      } catch (e) {
        showFlash("导入失败:" + (e instanceof Error ? e.message : "文件无法识别"), false);
      }
    };
    reader.onerror = () => showFlash("读取文件失败", false);
    reader.readAsText(file);
  };

  return (
    <div className="page settings-page">
      <header className="page-head">
        <div>
          <h1>设置</h1>
          <div className="head-sub">老师的观察 · 系统状态</div>
        </div>
        {flash && <span className={flash.ok ? "saved-flash" : "saved-flash fail"}>{flash.text}</span>}
      </header>

      <div className="panel">
        <h2 className="panel-title">老师对你的了解</h2>
        <p className="panel-desc">
          这不是你填的表——是 Stellairs 在教你的过程中,一节课一节课观察、记下来的。它据此决定怎么教你,并且会随着更了解你而不断修正。
        </p>
        {model?.notes ? (
          <div className="teacher-notes">{model.notes}</div>
        ) : (
          <div className="teacher-notes teacher-notes-empty">
            我还不太了解你。多上几节课、多做几道题,我会慢慢摸清你的路子——哪种讲法让你开窍、你常卡在哪、要给你多少提示。
          </div>
        )}
        {model?.signals && <div className="teacher-signals">学情快照 · {model.signals}</div>}
        {model?.notesUpdatedAt && (
          <div className="teacher-notes-time">
            笔记更新于 {new Date(model.notesUpdatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">入学起点</h2>
        <p className="panel-desc">
          你刚进来时的自述,只是老师了解你的起点——真正怎么教,以上面的观察为准。想临时纠正,对话里直接说(比如"别让我猜,直接讲")最快。
        </p>
        {QUESTIONS.map((qc) => (
          <div key={qc.key} className="pref-row">
            <span className="pref-label">{qc.title}</span>
            <div className="segmented">
              {qc.options.map((o) => (
                <button
                  key={o.value}
                  className={"segment" + (student?.styleProfile?.[qc.key] === o.value ? " on" : "")}
                  onClick={() => void setPref(qc.key, o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2 className="panel-title">大脑通道</h2>
        {health ? (
          <>
            <div className="pref-row">
              <span className="pref-label">当前通道</span>
              <span>
                {health.provider === "mock" && <b>演示通道</b>}
                {health.provider === "anthropic" && <b>正式大脑(Anthropic API)</b>}
                {health.provider === "claude-cli" && <b>Claude Code 本机通道</b>}
                {" · 模型 "}{health.model}
              </span>
            </div>
            {health.provider === "mock" && (
              <p className="panel-desc">
                演示通道不联网、不花钱,能完整演示教学流程(玻意耳定律一课)。拿到 API key 后:填进
                <code> server/config.json </code>的 <code>apiKey</code>,并把 <code>provider</code> 改为
                <code> "anthropic"</code>,重启即切换成真大脑——或者把 key 交给 Claude Code,它来配置。
              </p>
            )}
            {health.provider === "anthropic" && !health.hasKey && (
              <p className="panel-desc">API key 尚未配置,对话会提示配置方法。</p>
            )}
          </>
        ) : (
          <p className="panel-desc">服务未连接。</p>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">备份与恢复</h2>
        <p className="panel-desc">
          你的学习档案(对话、掌握度、错题本、老师笔记)<b>只存在这一个浏览器里</b>——换设备、清缓存、无痕模式都会让它消失,而且找不回来。所以请定期<b>导出备份</b>;换设备或重装后,用备份文件<b>导入</b>就能接着学。
        </p>
        <div className="backup-row">
          <button className="ghost-btn" onClick={doExport}>导出备份</button>
          <button className="ghost-btn" onClick={() => fileRef.current?.click()}>从备份导入</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doImport(f);
              e.target.value = "";
            }}
          />
        </div>
        <p className="q-hint" style={{ marginTop: 12 }}>
          导入会<b>覆盖</b>当前这个浏览器里的档案,导入前建议先导出当前进度以防万一。
        </p>
      </div>

      <div className="panel">
        <h2 className="panel-title">重置</h2>
        <p className="panel-desc">
          清空这个浏览器里的全部学习数据,从头开始。此操作不可撤销——需要保留的话先导出备份。
        </p>
        <button className="danger-btn" onClick={() => void reset()}>
          重置全部学习数据
        </button>
      </div>
    </div>
  );
}
