# Stellairs · 高考物理 AI 私教

面向黑龙江省高三学生的物理私教应用。当前切片:人教版选择性必修第三册第 1-3 章(热学)。

## 怎么运行

**方式一(推荐)**:在 Claude 桌面版里让 Claude Code 启动预览(它会用 `.claude/launch.json`)。

**方式二**:双击项目根目录的 `dev.cmd`,然后浏览器打开 http://localhost:5173

## 项目结构(给创始人的地图)

```
content/          ← 教研资产(你的领地:改文件即改产品,无需碰代码)
  tree/kp-tree.json        知识树(41 个知识单位,已定稿)
  cards/*.md               知识卡片(现有 3 张示范卡,格式样板)
  pedagogy/*.md            教学策略卡 4 张(讲授/引导修复/苏格拉底/刷题)
  persona/stellairs.md     Stellairs 人设
  questions/index-x3.json  362 条题目索引(考点/难度/出题时机)
  questions/seed-x3.json   22 道已录题干的种子题(答案 AI 起草待你终审)
  mock/lesson-boyle.json   演示通道的玻意耳定律课剧本
docs/             ← 计划书、知识树文档、题目索引说明、研究资料
data/student.json ← 学习数据(对话/掌握度/错题/偏好),可直接打开看
server/           ← 后端:教学引擎、模式矩阵、判分、大脑接口层
src/              ← 前端:对话/学习地图/练习/错题本/设置 五个页面
```

## 大脑通道(server/config.json)

| provider | 说明 |
|---|---|
| `mock`(当前) | 演示通道:不联网不花钱,能完整演示教学流程 |
| `anthropic` | 正式大脑:把 API key 填进 `apiKey` 字段(或环境变量 `ANTHROPIC_API_KEY`),改 `provider` 为 `"anthropic"`,重启即切换 |
| `claude-cli` | 本机 Claude Code 无头模式(用现有订阅,仅限自测) |

## 设计原则

- **模型负责讲,清单负责边界**:讲什么由知识卡片限定,怎么教由策略卡限定,出哪道题由规则引擎决定——AI 不即兴决策
- **新概念永远直接讲授**,苏格拉底提问只用于解题;学生一句"别让我猜"可永久改写教学偏好
- **无标答不批改**:种子题答案是 AI 起草的 draft,创始人终审前界面会明确标注
