# 任务书：练习册自动切题工具（qcut）

> 交给实现方（Codex）的完整任务说明。本文档自包含：背景、已验证的技术事实、踩过的坑、任务清单、输出规范、验收标准。
> 撰写：Claude（前期调研+可行性验证已完成），日期 2026-07-07。

## 0. 一句话目标

把整本练习册的扫描页自动切成"每道题一张完整图片"（含题干、小问、配图，跨栏/跨页自动拼接），按本仓库题库命名规范输出 webp + 清单 JSON，并生成一个人工校验页面。

## 1. 背景与现状

- 仓库：learnapp（高考物理 AI 私教）。题库图片在 `content/questions/img/`，命名 `q-wb1-pNNN-NN.webp`（书代号-扫描页号3位-页内序号2位），此前 p004~p013 是手工裁的。
- 测试素材：`tmp/wb1-pages/wb1-60-*.png`（《必刷题》选必三整页扫描，2654×3855 px，双栏排版），另有 `front-*.png`（前言目录）和 `preview-71~75.png`（书末答案部分，**不要切题**）。
- 旧手工清单：`tmp/wb1-crop-manifest.json`（307 条，含 qid/wbPage/printedPage/页内序号/栏位等字段，可作对照基准）。
- **已有可用的验证代码（重要，直接复用，不要从零重写）**：
  - `scripts/qcut-test.mjs` —— 已实测跑通的完整管线：TC3-HMAC-SHA256 签名调用腾讯云、嵌套结构解析、小问归组、跨栏重建、续段归并、多块拼接、画框总览图。**其中的解析与重建逻辑是数小时真实调试的成果，重构时保留算法原样**。
  - `scripts/qcut-dump.mjs` —— 打印 API 返回层级结构的排查工具。
  - `tmp/qcut/<页名>/raw.json` —— 5 页真实 API 返回，可作离线测试夹具（fixture），单元测试不要打真实 API。
- 密钥：`.secrets/tencent.json`（字段 SecretId/SecretKey/Region），已在 .gitignore。**任何情况下不得提交、不得打印到日志**。

## 2. 已验证的技术事实（不要重新踩坑）

### 2.1 接口

- 腾讯云 OCR「试卷切题」：Action `QuestionSplitOCR`，Version `2018-11-19`，POST `https://ocr.tencentcloudapi.com`，Region `ap-guangzhou`。签名 TC3-HMAC-SHA256（实现见 qcut-test.mjs 的 `tcCall`，SignedHeaders 只用 `content-type;host`，可用）。
- 入参：`ImageBase64`（base64 后 ≤10MB）。整页 PNG 太大，先用 sharp 转 JPEG quality 88（约 1.2~1.5MB/页）再发，实测无损效果。
- 账号已开通服务+后付费，免费资源包约 14000 次（2027-07 到期），整本书 75 页 = 75 次调用。**必须做响应缓存**（见任务 A），避免重复消耗。
- 已见过的错误码：`FailedOperation.UnOpenError`（服务未开通）、`ResourceUnavailable.ResourcePackageRunOut`（无额度）。频控错误未触发过，但批量跑请加 500ms 间隔 + 对 `RequestLimitExceeded` 指数退避重试。

### 2.2 返回结构（与官方文档有出入，以下是实测事实）

```
Response.QuestionInfo[]            // 每页一项
  .Angle/.Height/.Width/.OrgHeight/.OrgWidth
  .ImageBase64                     // 实测为空字符串 → 坐标相对原图
  .ResultList[]                    // 顶层"板块"（题型分组或独立题）
    .Coord                         // ⚠ 可能是四点对象，也可能是四点对象的【数组】
    .Question[] / .Option[] / .Figure[] / .Table[] / .Answer[] / .Parse[]
       每个元素有 .Text .Coord .GroupType .Index
       Question[i].ResultList[]    // ⚠ 嵌套下一层：板块→题；题→小问
```

- 四点格式：`LeftTop/RightTop/LeftBottom/RightBottom` 各含 X/Y，是四边形不是矩形，取外接矩形使用。
- `GroupType`：`multiple-choice` / `fill-in-the-blank` / `problem-solving` 等。
- 题干文字质量很好，公式自动转 LaTeX（如 `$PM_{2.5}$`），值得存进清单供 app 使用。

### 2.3 四类版式难题与已验证的解法（qcut-test.mjs 已实现）

1. **小问归组**：API 会把大题的 (1)(2)(3) 拆成嵌套子项。规则：向下递归时，若下一层子项的题干以 `（n）/(n)/①…` 开头（`isSubQ` 正则），停在当前层——大题整体算一道题，小问的 Coord 并入大题范围。
2. **跨栏题·形态一（元素完好）**：题目级 Coord 是跨双栏的并集大框（宽 >55% 页宽即判定），但题内元素（题干行/选项/配图）各有小框 → 按页面中线把元素分左右两簇，每簇取并集，一栏一块。
3. **跨栏题·形态二（元素也是并集框）**：某个小问自身的 Coord 就是跨栏并集（真实分栏几何已丢失）。解法（`spansMid` + 页面上下文重建）：
   - 左半段：顶 = 本题其他可信元素与其他题在左栏中"位于并集框底之上"的最大底边 + 12px；底 = 并集框底。
   - 右半段：顶 = 并集框顶；底 = 其他题在右栏中"位于并集框顶之下"的最小顶边 − 12px（没有则取并集框底）。
   - "可信矩形" = 不跨中线的框（`solidsOf`）。
4. **续段归并**：右栏开头的 B/C/D 选项有时被 API 当成独立"题"。规则：条目题干不以题号开头（`isNewQuestion` 正则：`数字.` / `一、` / `例n`）→ 归并给上一条目。
5. **跨页题**：页首条目不以题号开头 → 标记 `contPrev`（已实现标记，**合并逻辑是本次任务**）。

### 2.4 已知残留小瑕疵（本次任务中修复）

- 跨栏重建的右栏块左边取的是页面中线，会带进 ~10px 左栏文字残影 → 应改用"其他题右栏可信矩形的最小 left"作为右栏左边界（同理左栏右边界）。
- 页尾题会把页脚装饰文字（如"先成为自己的山…"）带进裁剪 → 裁剪后对块的上下边缘做空白行吸附/收缩（水平投影找整行空白）。

## 3. 任务清单

### A. 正式工具 `scripts/qcut.mjs`（CLI）

- 用法示例：`node scripts/qcut.mjs --book wb1 --pages "tmp/wb1-pages/wb1-60-*.png" --out content/questions/img --report tmp/qcut-review`
- 输入支持：图片 glob / 目录 / PDF（PDF 用仓库已有依赖 pdfjs-dist 渲染 300 DPI，或等价方案；不新增重型依赖）。
- **响应缓存**：按图片内容 hash 存 `tmp/qcut-cache/<hash>.json`，命中则不调 API。这是硬性要求（省额度 + 可离线重跑调参）。
- 复用 qcut-test.mjs 的解析/重建算法（可抽成 `scripts/lib/qcut-core.mjs` 供两者共用）。

### B. 跨页题合并

- 按页序处理；页 N+1 首条目带 `contPrev` 标记时，其块并入页 N 最后一题，跨页拼接成一张图。
- 归属：跨页题的 qid 归它**起始**的那一页。
- 边界保护：若上一页不存在或上一页是答案页/章节末，则该条目单独成题并在报告中标 ⚠ 供人工确认。

### C. 输出规范

- 每题一张 `q-<book>-pNNN-NN.webp`（sharp webp quality 90；NN 按页内阅读顺序从 01 起）。
- **已存在的同名文件默认跳过不覆盖**（p004~p013 有手工成品），提供 `--force` 才覆盖。
- 多块题额外保留分块图（`-a/-b` 后缀）到 report 目录（不进 content）。
- 清单 `tmp/qcut-manifest-<book>.json`，每题记录：qid、扫描页号、页内序号、GroupType、块数、是否跨栏/跨页、OCR 题干全文（含 LaTeX）、选项文本、置信信息、来源图文件。字段风格参考 `tmp/wb1-crop-manifest.json` 与 `content/questions/crops.json`。

### D. 校验页面

- 生成静态 `tmp/qcut-review/index.html`（无服务器、无外链依赖，双击可开）：
  - 每页：画框总览图（含题号标签）+ 该页所有裁剪图缩略列表（点击看大图）。
  - 每题一个"有问题"勾选框 + 备注输入，页面上有"导出问题清单"按钮（浏览器端生成 JSON 下载）。
  - 支持读取 `tmp/qcut-overrides.json`（qid → 手工矩形数组），重跑工具时 override 优先于自动结果——这是人工修正回路。

### E. 页号映射验证（先做）

- `wb1-60-XX.png` 的 XX 与 qid 用的 wbPage 不是同一个数：已知 wb1-60-10.png 印刷页码是 3，而旧清单里 printedPage 3 ↔ wbPage 6，推测 `wbPage = XX - 4`，**必须先验证**（对照页面右下角印刷页码与 `tmp/wb1-crop-manifest.json` 的 printedPage/y 值，抽 3~5 页核对）再定 qid。front-*.png 与 preview-71~75.png 不参与切题。

### F. 质量兜底

- 每页切完做自检并写进报告：题号连续性（本页题号序列与上页衔接）、任一题面积占页面比例异常(>60%)、块重叠检测。异常题在校验页里高亮。
- API 报错/超时的页：重试 3 次后记入失败清单，不中断整本任务。

### G.（收尾，可选）抽成独立开源项目

- 全书跑通、人工校验后，把工具抽到独立仓库：去密钥（读环境变量）、README（中英）、示例图、MIT 协议。此步做完请先停下等创始人确认再发布。

## 4. 验收标准

1. 一条命令跑完 `tmp/wb1-pages/wb1-60-05~70`（正文题目页），无人工干预产出全部题图 + 清单 + 校验页。
2. 抽查页 wb1-60-10 / 15 / 25 / 40 / 55（已知难例都在这几页）：跨栏题拼接完整、大题含全部小问、无相邻题内容混入。
3. 与 `tmp/wb1-crop-manifest.json` 对照：每页题数一致率 ≥95%，不一致的页在报告中列出原因。
4. 断网状态下用缓存重跑，结果一致（证明缓存与解析分离）。
5. `git status` 中无任何密钥或 .secrets 文件。

## 5. 约束

- Windows 11 + PowerShell 环境；Node ESM（package.json `"type":"module"`）；图像处理用已有依赖 sharp，不新增原生依赖。
- 单元测试用 `tmp/qcut/*/raw.json` 夹具离线跑，不打真实 API。
- 中文注释，风格与 qcut-test.mjs 一致。
- 创始人不写代码：所有交互入口保持"一条命令 + 双击打开的校验页"。
