import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { figureUrl } from "../engine/content";

// 拦截 ```figure 代码块 → 显示从真题裁出的标准概念配图(内容是图 id,如 fig-fr)。
const components: Components = {
  code({ className, children }) {
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    if (lang === "figure") {
      const id = String(children ?? "").trim().split(/\s+/)[0];
      if (/^[a-z0-9-]+$/.test(id)) {
        return (
          <figure className="concept-figure">
            <img src={figureUrl(id)} alt="示意图" loading="lazy" />
          </figure>
        );
      }
      return null;
    }
    return <code className={className}>{children}</code>;
  },
};

/** 统一的 markdown + LaTeX 渲染器(含概念配图) */
export default function Md({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
