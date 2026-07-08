# AGENTS.md — 终端 AI 助手项目说明

> 本文档面向 AI 编程工具（Copilot、Cursor、Claude 等），描述项目架构、约定、扩展要点，帮助 AI 快速理解并安全地修改本项目。

---

## 项目一句话描述

一个用自然语言驱动的终端 AI 助手 CLI 工具，基于 OpenAI function calling 实现多步 Agent 循环，用 Bun 运行，默认避免外部 npm 依赖。

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
| 外部依赖 | 默认不用；安全解析等高风险边界可引入小型、锁定版本依赖 |
| 默认模型 | `glm-5`（可通过 `--model` 或环境变量切换） |

---

## 目录结构

```
TAI/
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
│   └── safety.ts          # 命令安全守卫（BLOCKED / IRREVERSIBLE / DANGEROUS）
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

### 1. 依赖克制
默认不引入 npm 包，普通功能优先只用：
- `child_process`（exec）
- `readline`（终端确认）
- `util`（promisify）
- `path`（路径处理）

安全解析、命令边界等高风险场景可以放松此约束，但必须：
- 说明为什么内置能力不足
- 同步 `package.json`、`bun.lock`、`package-lock.json`
- 添加覆盖危险输入形状的回归测试

### 2. 安全守卫不可绕过
`guard/safety.ts` 的三级检查是硬性约束：

- **BLOCKED**：直接返回拒绝消息，永远不执行，不可通过 `--auto` 或用户 allowlist 绕过。
- **IRREVERSIBLE**：不可逆/破坏性操作，必须确认，`--auto` 也不能跳过。
- **DANGEROUS**：危险但可恢复操作，`--auto` 模式跳过确认，其他情况必须调用 `confirm()`。

新增 shell 命令能力时，如果涉及破坏性操作，**必须**在 `safety.ts` 补充对应规则。
涉及 shell 解析、控制符、包装器（如 `sudo`/`env`/`timeout`）时，必须同步补充 `guard/safety.test.ts`。

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
  apiUrl:      process.env.LLM_API_URL  ?? "http://localhost:9527/v1/chat/completions",
  apiKey:      process.env.LLM_API_KEY  ?? "<key>",
  model:       process.env.LLM_MODEL   ?? "glm-5",
  maxSteps:    12,     // Agent 每次任务最大工具调用轮数
  temperature: 0.3,    // 低温度，精确任务要求
};
```

---

## 添加新工具的步骤

1. 在 `tools/` 新建文件，例如 `tools/k8s.ts`
2. 导出 `k8sDef`（JSON Schema）和 `k8sRun(args)`
3. 在 `tools/registry.ts` 中注册工具：
   ```ts
   k8s: {
     def: k8sDef,
     run: k8sRun,
     summarize: (a) => `${a.action} ${a.resource || ""}`,
   },
   ```
4. 如有危险操作，在 `guard/safety.ts` 补充对应 BLOCKED / DANGEROUS 规则

---

## CLI 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `--model <name>` | string | 覆盖默认模型 |
| `--auto` | flag | 跳过 DANGEROUS 确认（BLOCKED 拦截，IRREVERSIBLE 仍确认） |
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
| 三级安全守卫 | ✅ |
| JSON 输出 / Debug 模式 | ✅ |
| 单文件编译 | ✅ |
| Memory（`~/.ai-agent/` 历史记录） | ⬜ v2 |
| k8s / ssh / ansible / grafana 工具 | ⬜ v2 |
| 流式输出（streaming） | ⬜ v2 |
