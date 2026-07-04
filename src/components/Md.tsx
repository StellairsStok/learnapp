import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import PhysicsPlot, { type PlotSpec } from "./PhysicsPlot";

// 拦截 ```plot 代码块 → 渲染成物理示意图;其余代码原样。
const components: Components = {
  code({ className, children }) {
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    if (lang === "plot") {
      const raw = String(children ?? "").trim();
      try {
        return <PhysicsPlot spec={JSON.parse(raw) as PlotSpec} />;
      } catch {
        // 流式过程中 JSON 还没吐完:显示占位,不闪现原始代码
        return <div className="plot-fallback">{raw.endsWith("}") ? "（示意图参数有误)" : "示意图生成中…"}</div>;
      }
    }
    return <code className={className}>{children}</code>;
  },
};

/** 统一的 markdown + LaTeX 渲染器(含物理示意图) */
export default function Md({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
