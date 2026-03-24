# AGENTS.md — AI 运维助手项目说明

> 本文档面向 AI 编程工具（Copilot、Cursor、Claude 等），描述项目架构、约定、扩展要点，帮助 AI 快速理解并安全地修改本项目。

---

## 项目一句话描述

一个用自然语言驱动的 AI SRE CLI 工具，基于 OpenAI function calling 实现多步 Agent 循环，用 Bun 运行，零外部 npm 依赖。

```
ai fix nginx          # 自动诊断 + 修复
ai doctor             # 系统健康检查 + AI 分析
ai "check disk"       # 任意自然语言任务
```

---

## 技术栈

| 项目 | 选型 |
|------|------|
| 语言 | TypeScript |
| 运行时 | Bun |
| LLM 接入 | OpenAI 兼容 API（function calling） |
| 外部依赖 | **无**（仅使用 Node.js 内置模块） |
| 默认模型 | `DeepSeek-V3.1`（可通过 `--model` 或环境变量切换） |

---

## 目录结构

```
aiTui/
├── ai.ts                  # 入口（3 行）：import main → main()
├── cli/
│   └── index.ts           # 解析 argv，打印帮助，调用 Agent
├── agent/
│   └── agent.ts           # Agent 主循环（LLM + tool routing + 对话历史）
├── tools/
│   ├── shell.ts           # 执行 shell 命令
│   ├── doctor.ts          # 系统健康检查
│   ├── logs.ts            # 读日志文件
│   ├── docker.ts          # Docker 容器管理
│   └── fs.ts              # 只读文件系统操作
├── guard/
│   └── safety.ts          # 命令安全守卫（两级：BLOCKED / DANGEROUS）
├── utils/
│   └── prompt.ts          # 终端 y/n 确认对话框
└── config/
    └── model.ts           # API 地址、Key、模型、温度等配置
```

---

## 核心数据流

```
argv
 └─ cli/index.ts        解析参数（task / --model / --auto / --debug / --json）
       └─ Agent.run(task)
             ├─ callLLM(messages)          POST /v1/chat/completions
             │    └─ 带全部工具的 JSON Schema
             ├─ 如果 reply.tool_calls 存在
             │    └─ executeTool(name, args)
             │         ├─ shell   → guard 检查 → execAsync
             │         ├─ doctor  → 并发 exec 多条命令
             │         ├─ logs    → tail -n
             │         ├─ docker  → docker 子命令
             │         └─ filesystem → ls/cat/du
             │    └─ 结果追加为 tool role message → 继续循环
             └─ 如果无 tool_calls → 打印最终回答，退出
```

---

## 重要约定（修改代码时必须遵守）

### 1. 零外部依赖
不引入任何 npm 包。所有功能只用：
- `child_process`（exec）
- `readline`（终端确认）
- `util`（promisify）
- `path`（路径处理）

### 2. 安全守卫不可绕过
`guard/safety.ts` 的两级检查是硬性约束：

- **BLOCKED**：正则匹配即直接返回拒绝消息，永远不执行，不可通过 `--auto` 绕过。
- **DANGEROUS**：`--auto` 模式跳过确认，其他情况必须调用 `confirm()`。

新增 shell 命令能力时，如果涉及破坏性操作，**必须**在 `safety.ts` 补充对应规则。

### 3. 工具定义格式
每个工具文件导出两个内容：
- `xxxDef`：OpenAI function calling JSON Schema（type/function/name/description/parameters）
- `xxxRun(args, opts?)`：实际执行函数，返回 `Promise<string>`

在 `agent/agent.ts` 的 `callLLM` 里注册 `xxxDef`，在 `executeTool` 的 switch 里注册 `xxxRun`。

### 4. 工具输出约定
- 成功：返回命令输出字符串
- 失败：返回以 `ERROR:` 或 `Exit N:` 开头的字符串（LLM 会据此推理修复方案）
- 不要 `throw`，失败信息直接作为字符串返回

### 5. 路径安全
`logs.ts` 和 `fs.ts` 中所有路径必须经过 `path.normalize()` 处理，并拒绝非绝对路径，防止路径穿越攻击。

---

## 配置

配置集中在 `config/model.ts`，**不要在其他文件硬编码 API 地址或 Key**：

```ts
export const defaultConfig = {
  apiUrl:      process.env.AI_API_URL  ?? "http://localhost:9527/v1/chat/completions",
  apiKey:      process.env.AI_API_KEY  ?? "<key>",
  model:       process.env.AI_MODEL   ?? "DeepSeek-V3.1",
  maxSteps:    12,     // Agent 每次任务最大工具调用轮数
  temperature: 0.3,    // 低温度，运维任务要求精确
};
```

---

## 添加新工具的步骤

1. 在 `tools/` 新建文件，例如 `tools/k8s.ts`
2. 导出 `k8sDef`（JSON Schema）和 `k8sRun(args)`
3. 在 `agent/agent.ts` 的 `callLLM` 方法中把 `k8sDef` 加入 `tools` 数组
4. 在 `executeTool` 的 `switch` 中添加 `case "k8s": return k8sRun(args)`
5. 如有危险操作，在 `guard/safety.ts` 补充对应 BLOCKED / DANGEROUS 规则

---

## CLI 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `--model <name>` | string | 覆盖默认模型 |
| `--auto` | flag | 跳过危险命令确认（BLOCKED 仍然拦截） |
| `--debug` | flag | 打印 token 用量和工具调用入参到 stderr |
| `--json` | flag | 最终结果以 JSON `{ result }` 输出，适合脚本集成 |

---

## 编译

```bash
bun run build
# 产出 ./ai 单文件可执行二进制（macOS ARM64）
```

跨平台编译只需修改 `package.json` 中 `--target` 参数：
- `bun-macos-arm64`
- `bun-linux-x64`
- `bun-linux-arm64`

---

## 已实现 vs 待实现

| 功能 | 状态 |
|------|------|
| CLI + 参数解析 | ✅ |
| Agent Loop（function calling） | ✅ |
| shell / doctor / logs / docker / filesystem 工具 | ✅ |
| 两级安全守卫 | ✅ |
| JSON 输出 / Debug 模式 | ✅ |
| 单文件编译 | ✅ |
| Memory（`~/.ai-agent/` 历史记录） | ⬜ v2 |
| k8s / ssh / ansible / grafana 工具 | ⬜ v2 |
| 流式输出（streaming） | ⬜ v2 |
