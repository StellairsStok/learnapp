# qcut 第二轮整改任务书（验收反馈）

> 背景：qcut 第一轮实现已验收（五路核查：代码审查/清单核对/难例页看图/fallback抽查/仓库卫生）。
> 总体结论 **pass-with-issues**：难例页 20 张中 18 张完好，工程主体合格；但抽查发现 3 张坏图（已由验收方手工修复）、
> 若干真实 bug 和统计口径问题。本文档是整改清单，按优先级排列。
> 第一轮任务书 `docs/qcut-codex-task.md` 的约定继续有效。

## 0. 验收方已完成的修复（不要覆盖回去）

以下 3 张坏图已手工重裁并写入 `tmp/qcut-overrides.json`（rect 已视觉验证）：

| qid | 原问题 | 根因 |
|---|---|---|
| q-wb1-p021-03 | 弹簧配图整体缺失，题干写"如图所示"却无图 | API 题目框未包含下方配图（y2675-2890），工具无内容完整性自检 |
| q-wb1-p035-05 | 选项 D 末行答案"1:31"被裁掉 | `tightenVertical` 页脚丢弃启发式（qcut.mjs:253-258）把底部孤立短行误判为页脚 |
| q-wb1-p044-04 | 整图零题目内容（只有页脚/页码/下一章标题） | 旧清单该条是 loose-ocr 错误坐标（y3684 是页脚）；真实题目完整在扫描页48右栏 y1845-3645，**不跨页** |

另已处理：删除孤儿文件 `q-wb1-p031-06.webp`（上轮测试残留，磁盘现为 307 张与 manifest 一致）；`.gitignore` 已加 `tmp/`（964MB 中间产物差点被 git add 全量提交）。

⚠ 因此整改后重跑时：**必须先修 Bug 1（override 失效），确保这 3 个 override 真正生效**，否则重跑会把坏图写回去。

## 1. P0 必修 bug（都有行号证据）

1. **override 机制实际不可用**（qcut.mjs:656-667 + 670）：override 替换 pieces 后，因 outFile 已存在且无 `--force` 而跳过重裁——"对坏图加 override 重跑"无任何效果。改法：带 override 的 qid 无条件重裁；override rect 做越界钳制；`sharp.extract` 加 try/catch，单题失败记 anomaly 不崩整轮。
2. **页脚丢弃启发式误杀内容**（qcut.mjs:253-258，p035-05 的根因）：`tail 在 84% 高度以下 + <90px + gap>45px` 会命中公式行/答案行。改法：只丢真正落在页面页脚带（源页 y > 3700 附近）的 run，且凡是丢了 run 的题在 manifest 记 note（如 `trimmed-tail`）并在审查页高亮，人工可查。
3. **跨页合并不校验页相邻性**（qcut.mjs:565-577）：previous 取"循环中最后成功页"的最后一题，前页失败/输入不连续时会把续段并进错误的页。改法：仅当 `previous.wbPage === 当前页-1` 才合并，否则单独成题 + anomaly=`contPrev-orphan`；该 anomaly 要参与 confidenceOf 降级（现在 qcut.mjs:324-336 不参与，审查页不高亮）；多 QuestionInfo 块时不能只看 pageEntries[0]。
4. **fallback 从"页级"改"题级"**（qcut.mjs:611-635）：现在该页任一异常就丢弃全页 OCR 结果（含正确检出的题）盲切，95/307=31% 是盲切且无 OCR 文本。改法：逐题对齐旧清单（按 y 坐标/序号匹配），只对缺失/异常的题兜底，检出正确的题保留 OCR 结果；fallback 的真实 diff（检出X/期望Y）写进 manifest；`FALLBACK_TOP/BOTTOM/COLS` 硬编码几何至少参数化。
5. **内容完整性自检（新增，p021-03/p035-05 的教训）**：每题最终 rect 下边界之下 ~300px 同栏范围内做墨迹检测，若存在**未被本页任何题覆盖**的墨迹块，标 anomaly=`possible-truncation` 并在审查页高亮。这能捕获"配图/末行被丢"这一类当前完全盲的缺陷（两张坏图当时都标 confidence:high）。

## 2. P1 应修

6. **统计口径**：`pageConsistency 100%` 是自证式统计（fallback 页抄对照清单必然一致，真实 OCR 一致率 48/68≈70.6%）。分开输出：`ocrPageConsistency`（真实检测 vs 旧清单）与 `finalPageConsistency`（产出 vs 旧清单）；`detectedCount=286` 含 20 个兜底页上被弃用的 74 块，补 `keptDetectedCount=212`，避免 286+95≠307 的误导。
7. **任务书 F 的三项自检补齐**（第一轮未实现）：题号连续性（解析题干首个题号，检查页内与跨页衔接）、单题面积占页 >60% 告警、题块重叠检测。检出→anomaly+审查页高亮，**不要**自动触发替换。
8. **PDF 输入**：现在 shell 出 `pdftoppm`（Windows 无 Poppler 即崩），违背任务书 A（应使用已有依赖 pdfjs-dist）。二选一：改用 pdfjs-dist 渲染；或明确不支持 PDF 并从 package.json 移除死依赖 `pdfjs-dist`、`jszip`（当前全仓库零引用）。
9. **数据文件位置**：`tmp/` 现已被 gitignore，但两份 load-bearing 数据在里面——`tmp/wb1-crop-manifest.json`（fallback 对照源）和 `tmp/qcut-overrides.json`（人工修正）。移到会被提交的位置（建议 `content/questions/` 或 `scripts/data/`）并更新代码路径，否则换机/误删即丢。
10. 杂项：`ROOT` 用 `fileURLToPath` 替代手工 pathname 去斜杠（qcut.mjs:17，路径含空格/中文即坏）；网络异常也应重试（现仅重试特定错误码，qcut.mjs:195-206）；全缓存命中时不应强制要求 .secrets 存在（qcut.mjs:530 无条件 loadCreds，改 lazy）；`--force` 时清理输出目录中不在 manifest 的同书旧文件（防孤儿）；`scripts/ocr-wb1.ps1` 等去掉硬编码个人绝对路径默认值；`sources` 常驻全部整页 buffer（~700MB）改为按需加载/及时释放。
11. **crossColumn 元数据错误**：多 pieces 拼接的题（如 q-wb1-p021-02）crossColumn 仍标 false，统计/筛选会漏。按 pieces 的源栏位实际判定。

## 3. P2 数据复查（代码修完后跑一轮，产出复查报告）

- **95 张 fallback 题逐张复查**（改题级 fallback 后应大幅减少）。抽查已知问题：p014-03、p037-02（题目中部夹二维码/页脚/节标题整块）、p017-04（约70%面积是尾部透印垃圾）；轻度头尾污染：p027-06、p031-05、p008-01、p057-01、p010-04、p035-03。
- p006-06 跨页拼接处夹了上页页脚标语行（"先成为自己的山…"），页脚剔除逻辑修好后重裁。
- 2 张超长图人工确认是否裁进无关内容：p013-02（5707px）、p040-02（5082px）；2500-4000px 区间另有 20 张作次级抽查（清单见验收记录）。
- 验收方修复的 3 张（p021-03/p035-05/p044-04）重跑后逐张比对，确认 override 生效且效果不劣于当前版本。

## 4. 验收标准（第二轮）

1. Bug 1-5 各附最小复现/验证说明（如：删掉一张 override 目标图后重跑，override 生效；构造相邻页缺失场景，续段不误并）。
2. 修复后全书重跑（走缓存，0 次新 API 调用），fallback 题数显著下降且逐题给出 diff 依据；3 张 override 题保持验收方版本效果。
3. 新 manifest 输出 `ocrPageConsistency` / `finalPageConsistency` / `keptDetectedCount`，数字自洽。
4. `possible-truncation` 自检对 p021-03（用未修复的坐标模拟）能报警。
5. 磁盘图片数 == manifest 条数，无孤儿；`git status` 无 tmp/、无密钥。
